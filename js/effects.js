/**
 * Visual Effects Module
 *
 * Post-processing effects for the fluid simulation.
 * Implements bloom and volumetric light scattering (sunrays).
 *
 * @module effects
 *
 * @description
 * ## Post-Processing Pipeline
 *
 * After the fluid simulation renders to the dye texture, these
 * effects are applied to enhance the visual output:
 *
 * 1. **Bloom** - Adds a glow effect around bright areas
 * 2. **Sunrays** - Creates volumetric light beams radiating from center
 *
 * Both effects are composited in the final display shader.
 *
 * ## Bloom Effect
 *
 * Bloom simulates camera lens artifacts by making bright pixels
 * bleed light into neighboring areas. Implementation:
 *
 * 1. **Prefilter** - Extract pixels above brightness threshold
 *    - Uses soft knee curve for gradual falloff
 *    - knee = threshold * softKnee
 *    - contribution = quadratic(brightness - threshold + knee)
 *
 * 2. **Downsample** - Create mipmap pyramid
 *    - Each level is half resolution of previous
 *    - Blur at each level for smooth falloff
 *
 * 3. **Blur** - Gaussian blur (separable, 2-pass)
 *    - 5-tap kernel with optimized weights
 *    - Horizontal pass, then vertical pass
 *    - Multiple iterations per level for smoother result
 *
 * 4. **Upsample** - Combine pyramid with additive blending
 *    - Progressively add smaller levels to larger
 *    - Creates smooth halo effect
 *
 * ## Sunrays Effect (Volumetric Light Scattering)
 *
 * Based on "GPU Gems 3 - Volumetric Light Scattering as a Post-Process".
 * Creates the illusion of light rays emanating from bright areas.
 *
 * Algorithm:
 * 1. Create a brightness mask from the dye texture
 * 2. For each pixel, sample along the ray toward screen center
 * 3. Accumulate samples with exponential decay
 *
 * ```
 * for each sample:
 *     coord -= direction_to_center
 *     illumination *= decay
 *     color += texture(coord) * illumination * weight
 * ```
 *
 * This creates the characteristic "god rays" effect.
 */

import { createTexture, createFramebuffer } from './gl-utils.js';

/**
 * Manages post-processing visual effects.
 */
export class EffectsRenderer {
    /**
     * Creates a new EffectsRenderer.
     *
     * @param {WebGL2RenderingContext} gl - WebGL context
     * @param {Object} programs - Shader programs for effects
     * @param {Object} formats - Texture formats
     * @param {Object} config - Effects configuration
     */
    constructor(gl, programs, formats, config) {
        this._gl = gl;
        this._programs = programs;
        this._formats = formats;
        this._config = config;

        // FBO storage
        this._bloomFBOs = [];
        this._bloomTempFBOs = [];
        this._sunraysFBO = null;
        this._sunraysTemp = null;
    }

    /**
     * Updates the configuration.
     * @param {Object} config - New configuration values
     */
    setConfig(config) {
        this._config = { ...this._config, ...config };
    }

    /**
     * Initializes effect framebuffers.
     *
     * @param {number} canvasWidth - Canvas width for bloom pyramid
     * @param {number} canvasHeight - Canvas height for bloom pyramid
     */
    initFBOs(canvasWidth, canvasHeight) {
        this._createBloomFBOs(canvasWidth, canvasHeight);
        this._createSunraysFBOs();
    }

    /**
     * Creates bloom framebuffer pyramid.
     *
     * The bloom pyramid consists of progressively smaller textures:
     * - Level 0: canvas/2 resolution
     * - Level 1: canvas/4 resolution
     * - ...
     * - Level N: minimum 32x32
     *
     * Each level has a main FBO and a temp FBO for ping-pong blur.
     *
     * @private
     * @param {number} canvasWidth
     * @param {number} canvasHeight
     */
    _createBloomFBOs(canvasWidth, canvasHeight) {
        const gl = this._gl;
        const { bloomIterations } = this._config;
        const { DYE_FORMAT } = this._formats;

        // Start with half resolution
        let width = Math.floor(canvasWidth / 2);
        let height = Math.floor(canvasHeight / 2);

        const minSize = 32;

        this._bloomFBOs = [];
        this._bloomTempFBOs = [];

        for (let i = 0; i < bloomIterations; i++) {
            if (width < minSize || height < minSize) break;

            // Main FBO for this pyramid level
            const texture = createTexture(gl, width, height, DYE_FORMAT);
            this._bloomFBOs.push({
                texture,
                framebuffer: createFramebuffer(gl, texture),
                width,
                height
            });

            // Temp FBO for ping-pong blur
            const tempTex = createTexture(gl, width, height, DYE_FORMAT);
            this._bloomTempFBOs.push({
                texture: tempTex,
                framebuffer: createFramebuffer(gl, tempTex),
                width,
                height
            });

            width = Math.floor(width / 2);
            height = Math.floor(height / 2);
        }
    }

    /**
     * Creates sunrays framebuffers.
     *
     * Sunrays use lower resolution for performance.
     * Two FBOs: one for the mask, one for the final result.
     *
     * @private
     */
    _createSunraysFBOs() {
        const gl = this._gl;
        const { sunraysResolution } = this._config;
        const { DYE_FORMAT } = this._formats;

        const res = sunraysResolution || 196;

        // Main sunrays FBO
        const sunraysTexture = createTexture(gl, res, res, DYE_FORMAT);
        this._sunraysFBO = {
            texture: sunraysTexture,
            framebuffer: createFramebuffer(gl, sunraysTexture),
            width: res,
            height: res
        };

        // Temp FBO for mask
        const sunraysTempTexture = createTexture(gl, res, res, DYE_FORMAT);
        this._sunraysTemp = {
            texture: sunraysTempTexture,
            framebuffer: createFramebuffer(gl, sunraysTempTexture),
            width: res,
            height: res
        };
    }

    /**
     * Resizes bloom FBOs when canvas size changes.
     *
     * @param {number} canvasWidth
     * @param {number} canvasHeight
     */
    resize(canvasWidth, canvasHeight) {
        const gl = this._gl;

        // Cleanup old bloom FBOs
        this._destroyBloomFBOs();

        // Recreate at new size
        this._createBloomFBOs(canvasWidth, canvasHeight);
    }

    /**
     * Applies bloom effect to dye texture.
     *
     * Bloom Pipeline:
     * 1. Prefilter - Extract bright pixels using soft knee curve
     * 2. Downsample + Blur - Create blurred pyramid
     * 3. Upsample - Combine levels with additive blending
     *
     * @param {WebGLTexture} dyeTexture - Source dye texture
     * @param {Function} drawQuad - Function to draw fullscreen quad
     */
    applyBloom(dyeTexture, drawQuad) {
        if (this._bloomFBOs.length === 0) return;

        const gl = this._gl;
        const { bloomThreshold, bloomSoftKnee } = this._config;

        // Number of blur iterations per level
        const BLUR_ITERATIONS = 2;

        // =====================================================================
        // PASS 1: PREFILTER - Extract bright areas
        //
        // The soft knee curve provides smooth transition around threshold:
        // - Below (threshold - knee): no contribution
        // - Between (threshold - knee) and (threshold + knee): gradual ramp
        // - Above (threshold + knee): full contribution
        // =====================================================================
        const knee = bloomThreshold * bloomSoftKnee;
        const curve = [
            bloomThreshold - knee,           // curve[0]: start of ramp
            knee * 2,                         // curve[1]: ramp width
            0.25 / (knee + 0.00001)          // curve[2]: ramp steepness
        ];

        const prefilterProgram = this._programs.bloomPrefilter;
        prefilterProgram.use();

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, dyeTexture);
        gl.uniform1i(prefilterProgram.uniforms.u_texture, 0);
        gl.uniform3f(prefilterProgram.uniforms.u_curve, curve[0], curve[1], curve[2]);
        gl.uniform1f(prefilterProgram.uniforms.u_threshold, bloomThreshold);

        gl.bindFramebuffer(gl.FRAMEBUFFER, this._bloomFBOs[0].framebuffer);
        gl.viewport(0, 0, this._bloomFBOs[0].width, this._bloomFBOs[0].height);
        drawQuad();

        // =====================================================================
        // PASS 2: DOWNSAMPLE AND BLUR
        //
        // For each pyramid level:
        // 1. If level > 0, downsample from previous level
        // 2. Apply separable Gaussian blur (horizontal, then vertical)
        // 3. Repeat blur for smoother result
        // =====================================================================
        const blurProgram = this._programs.blur;
        blurProgram.use();

        let lastSource = this._bloomFBOs[0];

        for (let i = 0; i < this._bloomFBOs.length; i++) {
            const level = this._bloomFBOs[i];
            const temp = this._bloomTempFBOs[i];
            const texelSize = [1.0 / level.width, 1.0 / level.height];

            gl.viewport(0, 0, level.width, level.height);
            gl.uniform2f(blurProgram.uniforms.u_texelSize, texelSize[0], texelSize[1]);

            // Downsample from previous level (skip for level 0)
            if (i > 0) {
                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_2D, lastSource.texture);
                gl.uniform1i(blurProgram.uniforms.u_texture, 0);
                gl.uniform2f(blurProgram.uniforms.u_direction, 1.0, 0.0);
                gl.bindFramebuffer(gl.FRAMEBUFFER, temp.framebuffer);
                drawQuad();

                gl.bindTexture(gl.TEXTURE_2D, temp.texture);
                gl.uniform2f(blurProgram.uniforms.u_direction, 0.0, 1.0);
                gl.bindFramebuffer(gl.FRAMEBUFFER, level.framebuffer);
                drawQuad();
            }

            // Multiple blur iterations for smoother bloom
            for (let iter = 0; iter < BLUR_ITERATIONS; iter++) {
                // Horizontal blur: level -> temp
                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_2D, level.texture);
                gl.uniform1i(blurProgram.uniforms.u_texture, 0);
                gl.uniform2f(blurProgram.uniforms.u_direction, 1.0, 0.0);
                gl.bindFramebuffer(gl.FRAMEBUFFER, temp.framebuffer);
                drawQuad();

                // Vertical blur: temp -> level
                gl.bindTexture(gl.TEXTURE_2D, temp.texture);
                gl.uniform2f(blurProgram.uniforms.u_direction, 0.0, 1.0);
                gl.bindFramebuffer(gl.FRAMEBUFFER, level.framebuffer);
                drawQuad();
            }

            lastSource = level;
        }

        // =====================================================================
        // PASS 3: UPSAMPLE AND COMBINE
        //
        // Progressive additive blending from smallest to largest level:
        // result = level[n-1] + level[n] + level[n+1] + ...
        //
        // This creates smooth bloom falloff from bright centers.
        // =====================================================================
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);

        for (let i = this._bloomFBOs.length - 1; i > 0; i--) {
            const target = this._bloomFBOs[i - 1];
            const source = this._bloomFBOs[i];

            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, source.texture);

            gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
            gl.viewport(0, 0, target.width, target.height);
            drawQuad();
        }

        gl.disable(gl.BLEND);
    }

    /**
     * Applies sunrays (volumetric light scattering) effect.
     *
     * Creates "god rays" emanating from bright areas toward screen center.
     *
     * Algorithm:
     * 1. Create brightness mask from dye texture
     * 2. Radial blur toward center with exponential decay
     *
     * @param {WebGLTexture} dyeTexture - Source dye texture
     * @param {Function} drawQuad - Function to draw fullscreen quad
     */
    applySunrays(dyeTexture, drawQuad) {
        if (!this._sunraysFBO) return;

        const gl = this._gl;
        const { sunraysWeight } = this._config;

        // =====================================================================
        // STEP 1: CREATE MASK
        //
        // Convert dye colors to luminance values.
        // Bright pixels become "light sources" for the rays.
        // =====================================================================
        const maskProgram = this._programs.sunraysMask;
        maskProgram.use();

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, dyeTexture);
        gl.uniform1i(maskProgram.uniforms.u_texture, 0);

        gl.bindFramebuffer(gl.FRAMEBUFFER, this._sunraysTemp.framebuffer);
        gl.viewport(0, 0, this._sunraysTemp.width, this._sunraysTemp.height);
        drawQuad();

        // =====================================================================
        // STEP 2: RADIAL BLUR (LIGHT SCATTERING)
        //
        // For each pixel:
        // 1. Calculate direction toward screen center
        // 2. Sample texture along that direction
        // 3. Accumulate with exponential decay
        //
        // This simulates light scattering through a participating medium.
        // =====================================================================
        const sunraysProgram = this._programs.sunrays;
        sunraysProgram.use();

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this._sunraysTemp.texture);
        gl.uniform1i(sunraysProgram.uniforms.u_texture, 0);
        gl.uniform1f(sunraysProgram.uniforms.u_weight, sunraysWeight || 1.0);

        gl.bindFramebuffer(gl.FRAMEBUFFER, this._sunraysFBO.framebuffer);
        gl.viewport(0, 0, this._sunraysFBO.width, this._sunraysFBO.height);
        drawQuad();

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    /**
     * Gets the bloom texture for compositing.
     * @returns {WebGLTexture|null}
     */
    get bloomTexture() {
        return this._bloomFBOs.length > 0 ? this._bloomFBOs[0].texture : null;
    }

    /**
     * Gets the sunrays texture for compositing.
     * @returns {WebGLTexture|null}
     */
    get sunraysTexture() {
        return this._sunraysFBO ? this._sunraysFBO.texture : null;
    }

    /**
     * Checks if bloom FBOs are initialized.
     * @returns {boolean}
     */
    get hasBloom() {
        return this._bloomFBOs.length > 0;
    }

    /**
     * Checks if sunrays FBOs are initialized.
     * @returns {boolean}
     */
    get hasSunrays() {
        return this._sunraysFBO !== null;
    }

    /**
     * Destroys bloom FBOs.
     * @private
     */
    _destroyBloomFBOs() {
        const gl = this._gl;

        for (const fbo of this._bloomFBOs) {
            gl.deleteTexture(fbo.texture);
            gl.deleteFramebuffer(fbo.framebuffer);
        }
        for (const fbo of this._bloomTempFBOs) {
            gl.deleteTexture(fbo.texture);
            gl.deleteFramebuffer(fbo.framebuffer);
        }

        this._bloomFBOs = [];
        this._bloomTempFBOs = [];
    }

    /**
     * Destroys all effect resources.
     */
    destroy() {
        const gl = this._gl;

        this._destroyBloomFBOs();

        if (this._sunraysFBO) {
            gl.deleteTexture(this._sunraysFBO.texture);
            gl.deleteFramebuffer(this._sunraysFBO.framebuffer);
            this._sunraysFBO = null;
        }

        if (this._sunraysTemp) {
            gl.deleteTexture(this._sunraysTemp.texture);
            gl.deleteFramebuffer(this._sunraysTemp.framebuffer);
            this._sunraysTemp = null;
        }
    }
}
