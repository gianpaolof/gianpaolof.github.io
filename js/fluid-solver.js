/**
 * Fluid Solver Orchestration Module
 *
 * WebGL2-based Navier-Stokes fluid simulation solver.
 * Implements semi-Lagrangian advection, pressure projection,
 * and external force injection with dye transport.
 *
 * @module fluid-solver
 */

import {
    createContext,
    getExtensions,
    compileShader,
    createProgram,
    getTextureFormats,
    createTexture,
    createFramebuffer,
    DoubleFBO,
    detectQuality,
    QUALITY_PRESETS
} from './gl-utils.js';

import { loadShaders, SHADER_PATHS } from './shader-loader.js';
import { COLORS, DEFAULT_CONFIG, mergeConfig } from './config.js';
import { EffectsRenderer } from './effects.js';
import { FluidSimulation } from './simulation.js';

// =============================================================================
// FLUID SOLVER CLASS
// =============================================================================

/**
 * WebGL2-based Navier-Stokes fluid simulation solver.
 *
 * Implements the following simulation steps:
 * 1. Self-advection of velocity field
 * 2. External force injection
 * 3. Divergence calculation
 * 4. Pressure solve (Jacobi iteration)
 * 5. Gradient subtraction (projection)
 * 6. Dye advection
 *
 * @class FluidSolver
 */
export class FluidSolver {
    /**
     * Creates a new FluidSolver instance.
     *
     * @param {HTMLCanvasElement} canvas - Target canvas element
     * @param {Object} [config={}] - Simulation configuration
     * @param {number} [config.gridSize=256] - Velocity grid resolution
     * @param {number} [config.dyeSize=512] - Dye texture resolution
     * @param {number} [config.pressureIterations=20] - Jacobi iterations
     * @param {number} [config.velocityDissipation=1.0] - Velocity decay factor
     * @param {number} [config.dyeDissipation=0.99] - Dye decay factor
     * @param {number} [config.forceRadius=0.05] - Force splat radius
     * @param {number} [config.forceStrength=1.0] - Force magnitude multiplier
     * @param {number} [config.noiseScale=4.0] - Procedural noise frequency
     * @param {number} [config.noiseStrength=0.0] - Ambient noise force
     * @param {number} [config.intensity=1.0] - Render intensity
     */
    constructor(canvas, config = {}) {
        this.canvas = canvas;
        this.config = mergeConfig(config);

        // Create WebGL context
        const contextResult = createContext(canvas);
        this.gl = contextResult.gl;
        this.isWebGL2 = contextResult.isWebGL2;

        if (!this.isWebGL2) {
            throw new Error('FluidSolver requires WebGL2 support');
        }

        // Get extensions
        this.extensions = getExtensions(this.gl, this.isWebGL2);

        // Get texture formats
        this.formats = getTextureFormats(this.gl, this.isWebGL2);

        // State
        this._paused = false;
        this._time = 0;
        this._lastTime = 0;
        this._initialized = false;

        // Pending forces and dye to apply
        this._pendingForces = [];
        this._pendingDye = [];

        // WebGL resources (populated in init)
        this._programs = {};
        this._fbos = {};
        this._vao = null;
        this._shaders = null; // Loaded shader sources

        // Effects renderer (initialized after programs are created)
        this._effects = null;
    }

    /**
     * Initializes the fluid solver.
     * Loads external shaders, creates programs, FBOs, and VAO.
     *
     * @async
     * @returns {Promise<void>}
     * @throws {Error} If initialization fails
     */
    async init() {
        const gl = this.gl;

        // Load external shaders
        console.log('Loading shaders...');
        this._shaders = await loadShaders(SHADER_PATHS);
        console.log('Shaders loaded successfully');

        // Create shader programs
        this._createPrograms();

        // Create framebuffer objects
        this._createFBOs();

        // Initialize effects renderer with effect programs
        this._effects = new EffectsRenderer(gl, {
            bloomPrefilter: this._programs.bloomPrefilter,
            blur: this._programs.blur,
            bloomFinal: this._programs.bloomFinal,
            sunraysMask: this._programs.sunraysMask,
            sunrays: this._programs.sunrays
        }, this.formats, this.config);
        this._effects.initFBOs(this.canvas.width, this.canvas.height);

        // Initialize physics simulation (for future use)
        this._simulation = new FluidSimulation(gl, {
            advect: this._programs.advect,
            divergence: this._programs.divergence,
            pressure: this._programs.pressure,
            gradient: this._programs.gradient,
            curl: this._programs.curl,
            vorticity: this._programs.vorticity,
            splat: this._programs.splat,
            clear: this._programs.clear,
            hurricane: this._programs.hurricane
        }, this._fbos, this.config);

        // Create VAO for attribute-less rendering
        this._vao = gl.createVertexArray();
        gl.bindVertexArray(this._vao);
        gl.bindVertexArray(null);

        // Clear initial state
        this._clearFBO(this._fbos.velocity);
        this._clearFBO(this._fbos.pressure);
        this._clearFBO(this._fbos.dye);

        this._initialized = true;
        this._lastTime = performance.now();

        // Add initial splats for visual interest (like Pavel's multipleSplats)
        this._addInitialSplats(parseInt(Math.random() * 20) + 5);
    }

    /**
     * Adds random splats with color (Pavel's multipleSplats).
     * Public method for UI button.
     * @param {number} amount - Number of splats to add
     */
    addRandomSplats(amount = 5) {
        this._addInitialSplats(amount);
    }

    /**
     * Adds initial splats with color (Pavel's multipleSplats).
     * @param {number} amount - Number of splats to add
     * @private
     */
    _addInitialSplats(amount = 5) {
        const aspectRatio = this.canvas.width / this.canvas.height;
        // Use config splat radius, slightly larger for random splats
        const splatRadius = (this.config.splatRadius || 0.0025) * 2;

        for (let i = 0; i < amount; i++) {
            // Random position across entire screen
            const x = Math.random();
            const y = Math.random();

            // Random velocity direction (Pavel-style)
            const angle = Math.random() * Math.PI * 2;
            const speed = 200 + Math.random() * 200; // Moderate speed
            const dx = Math.cos(angle) * speed;
            const dy = Math.sin(angle) * speed;

            // Generate color (Pavel-style: bright but not blinding)
            const color = this._generateColor();

            // Apply force (velocity splat) via simulation module
            const forceRadius = (this.config.splatRadius || 0.0025) * 2;
            this._simulation.applyForceSplat(
                [x, y],
                [dx, dy],
                forceRadius,
                aspectRatio,
                this._drawQuad.bind(this)
            );

            // Apply colored dye with reasonable radius
            this._applySplat([x, y], color, splatRadius, aspectRatio);
        }
    }

    /**
     * Generates a random vibrant color using HSV (Pavel's method).
     * @private
     * @returns {number[]} RGB color array - BRIGHT and saturated!
     */
    _generateColor() {
        // Pavel uses random hue, full saturation, full value
        const hue = Math.random();
        const sat = 1.0;
        const val = 1.0;

        // HSV to RGB conversion
        const i = Math.floor(hue * 6);
        const f = hue * 6 - i;
        const p = val * (1 - sat);
        const q = val * (1 - f * sat);
        const t = val * (1 - (1 - f) * sat);

        let r, g, b;
        switch (i % 6) {
            case 0: r = val; g = t; b = p; break;
            case 1: r = q; g = val; b = p; break;
            case 2: r = p; g = val; b = t; break;
            case 3: r = p; g = q; b = val; break;
            case 4: r = t; g = p; b = val; break;
            case 5: r = val; g = p; b = q; break;
        }

        // Reduced intensity to prevent white blowout when colors mix
        return [r * 0.7, g * 0.7, b * 0.7];
    }

    /**
     * Applies a color splat to the dye field.
     * @private
     */
    _applySplat(pos, color, radius, aspectRatio) {
        const gl = this.gl;
        const program = this._programs.splat;

        program.use();

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this._fbos.dye.texture);
        gl.uniform1i(program.uniforms.u_target, 0);

        gl.uniform2f(program.uniforms.u_point, pos[0], pos[1]);
        gl.uniform3f(program.uniforms.u_color, color[0], color[1], color[2]);

        // Pass radius directly - aspect correction is done in shader via p.x
        gl.uniform1f(program.uniforms.u_radius, radius);
        gl.uniform1f(program.uniforms.u_aspectRatio, aspectRatio);

        this._fbos.dye.bindWrite();
        this._drawQuad();
        this._fbos.dye.swap();

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    /**
     * Creates all shader programs using loaded external shaders.
     * @private
     */
    _createPrograms() {
        const gl = this.gl;
        const s = this._shaders;

        // Simulation programs
        this._programs.advect = createProgram(gl, s.quadVert, s.advectFrag);
        this._programs.forces = createProgram(gl, s.quadVert, s.forcesFrag);
        this._programs.dye = createProgram(gl, s.quadVert, s.dyeFrag);
        this._programs.divergence = createProgram(gl, s.quadVert, s.divergenceFrag);
        this._programs.pressure = createProgram(gl, s.quadVert, s.pressureFrag);
        this._programs.gradient = createProgram(gl, s.quadVert, s.gradientFrag);
        this._programs.curl = createProgram(gl, s.quadVert, s.curlFrag);
        this._programs.vorticity = createProgram(gl, s.quadVert, s.vorticityFrag);

        // Rendering programs
        this._programs.display = createProgram(gl, s.quadVert, s.displayFrag);
        this._programs.copy = createProgram(gl, s.quadVert, s.copyFrag);
        this._programs.splat = createProgram(gl, s.quadVert, s.splatFrag);
        this._programs.clear = createProgram(gl, s.quadVert, s.clearFrag);

        // Bloom programs
        this._programs.bloomPrefilter = createProgram(gl, s.quadVert, s.bloomPrefilterFrag);
        this._programs.blur = createProgram(gl, s.quadVert, s.blurFrag);
        this._programs.bloomFinal = createProgram(gl, s.quadVert, s.bloomFinalFrag);

        // Sunrays programs - Pavel's volumetric light effect
        this._programs.sunraysMask = createProgram(gl, s.quadVert, s.sunraysMaskFrag);
        this._programs.sunrays = createProgram(gl, s.quadVert, s.sunraysFrag);

        // Hurricane spiral shader
        this._programs.hurricane = createProgram(gl, s.quadVert, s.hurricaneFrag);
    }

    /**
     * Creates all framebuffer objects.
     * @private
     */
    _createFBOs() {
        const gl = this.gl;
        const { gridSize, dyeSize, bloomIterations } = this.config;
        const { VELOCITY_FORMAT, PRESSURE_FORMAT, DYE_FORMAT } = this.formats;

        // Velocity field (double-buffered)
        this._fbos.velocity = new DoubleFBO(
            gl, gridSize, gridSize, VELOCITY_FORMAT
        );

        // Pressure field (double-buffered)
        this._fbos.pressure = new DoubleFBO(
            gl, gridSize, gridSize, PRESSURE_FORMAT
        );

        // Divergence field (single buffer)
        const divergenceTexture = createTexture(
            gl, gridSize, gridSize, PRESSURE_FORMAT
        );
        this._fbos.divergence = {
            texture: divergenceTexture,
            framebuffer: createFramebuffer(gl, divergenceTexture),
            width: gridSize,
            height: gridSize
        };

        // Curl field (single buffer) - for vorticity confinement
        const curlTexture = createTexture(
            gl, gridSize, gridSize, PRESSURE_FORMAT
        );
        this._fbos.curl = {
            texture: curlTexture,
            framebuffer: createFramebuffer(gl, curlTexture),
            width: gridSize,
            height: gridSize
        };

        // Dye field (double-buffered, higher resolution)
        this._fbos.dye = new DoubleFBO(
            gl, dyeSize, dyeSize, DYE_FORMAT
        );

        // Note: Bloom and sunrays FBOs are now managed by EffectsRenderer
    }

    /**
     * Clears a framebuffer to zero.
     * @private
     * @param {DoubleFBO|Object} fbo - Framebuffer to clear
     */
    _clearFBO(fbo) {
        const gl = this.gl;

        if (fbo instanceof DoubleFBO) {
            // Clear both buffers
            gl.bindFramebuffer(gl.FRAMEBUFFER, fbo.writeFramebuffer);
            gl.viewport(0, 0, fbo.width, fbo.height);
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);

            fbo.swap();

            gl.bindFramebuffer(gl.FRAMEBUFFER, fbo.writeFramebuffer);
            gl.clear(gl.COLOR_BUFFER_BIT);

            fbo.swap();
        } else {
            gl.bindFramebuffer(gl.FRAMEBUFFER, fbo.framebuffer);
            gl.viewport(0, 0, fbo.width, fbo.height);
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);
        }

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    /**
     * Clears pressure field by scaling previous values (Pavel's approach).
     * Uses config.pressure coefficient (default 0.8) to keep 80% of previous pressure.
     * This helps Jacobi solver converge faster.
     * @private
     */
    _clearPressure() {
        const gl = this.gl;
        const program = this._programs.clear;

        program.use();

        // Bind previous pressure texture
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this._fbos.pressure.texture);
        gl.uniform1i(program.uniforms.u_texture, 0);

        // Scale factor (Pavel uses 0.8 - keeps 80% of previous pressure)
        gl.uniform1f(program.uniforms.u_value, this.config.pressure);

        // Render to write buffer
        this._fbos.pressure.bindWrite();
        gl.viewport(0, 0, this._fbos.pressure.width, this._fbos.pressure.height);
        this._drawQuad();
        this._fbos.pressure.swap();

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    /**
     * Draws a fullscreen triangle using VAO.
     * @private
     */
    _drawQuad() {
        const gl = this.gl;
        gl.bindVertexArray(this._vao);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    /**
     * Performs one simulation step.
     * Delegates physics to FluidSimulation module.
     *
     * @param {number} dt - Delta time in seconds
     * @param {Array} [forces=[]] - Array of force objects
     */
    step(dt, forces = []) {
        if (!this._initialized || this._paused) {
            return;
        }

        // Combine external forces with pending forces
        const allForces = [...forces, ...this._pendingForces];
        this._pendingForces = [];

        // Get pending dye and clear
        const allDye = [...this._pendingDye];
        this._pendingDye = [];

        // Delegate physics to FluidSimulation
        const aspectRatio = this.canvas.width / this.canvas.height;
        this._simulation.step(
            dt,
            allForces,
            allDye,
            aspectRatio,
            this._drawQuad.bind(this)
        );

        // Sync time from simulation
        this._time = this._simulation.time;
    }

    // =========================================================================
    // Physics methods moved to simulation.js (FluidSimulation class)
    // =========================================================================

    /**
     * Renders the fluid visualization to the canvas.
     * Uses dye field with bloom and sunrays effects.
     */
    render() {
        if (!this._initialized) {
            return;
        }

        const gl = this.gl;
        const { bloomEnabled, bloomIntensity, sunraysEnabled } = this.config;

        // Apply post-processing effects via EffectsRenderer
        if (bloomEnabled && this._effects.hasBloom) {
            this._effects.applyBloom(this._fbos.dye.texture, this._drawQuad.bind(this));
        }

        if (sunraysEnabled && this._effects.hasSunrays) {
            this._effects.applySunrays(this._fbos.dye.texture, this._drawQuad.bind(this));
        }

        // Final display pass
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);

        const program = this._programs.display;
        program.use();

        // Bind dye texture
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this._fbos.dye.texture);
        gl.uniform1i(program.uniforms.u_texture, 0);

        // Bind bloom texture if enabled
        if (bloomEnabled && this._effects.hasBloom) {
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, this._effects.bloomTexture);
            gl.uniform1i(program.uniforms.u_bloom, 1);
        }

        // Bind sunrays texture if enabled
        if (sunraysEnabled && this._effects.hasSunrays) {
            gl.activeTexture(gl.TEXTURE2);
            gl.bindTexture(gl.TEXTURE_2D, this._effects.sunraysTexture);
            gl.uniform1i(program.uniforms.u_sunrays, 2);
        }

        gl.uniform1f(program.uniforms.u_bloomIntensity, bloomIntensity);
        gl.uniform1i(program.uniforms.u_bloomEnabled, bloomEnabled ? 1 : 0);
        gl.uniform1i(program.uniforms.u_shadingEnabled, this.config.shadingEnabled ? 1 : 0);
        gl.uniform1i(program.uniforms.u_sunraysEnabled, sunraysEnabled ? 1 : 0);
        gl.uniform2f(
            program.uniforms.u_texelSize,
            1.0 / this.config.dyeSize,
            1.0 / this.config.dyeSize
        );

        this._drawQuad();
    }

    /**
     * Pauses the simulation.
     */
    pause() {
        this._paused = true;
    }

    /**
     * Resumes the simulation.
     */
    resume() {
        if (this._paused) {
            this._paused = false;
            // Reset lastTime to prevent large dt jump
            this._lastTime = performance.now();
        }
    }

    /**
     * Checks if simulation is paused.
     * @returns {boolean}
     */
    get paused() {
        return this._paused;
    }

    /**
     * Gets the current simulation time.
     * @returns {number}
     */
    get time() {
        return this._time;
    }

    /**
     * Resizes simulation buffers.
     *
     * @param {number} width - New canvas width
     * @param {number} height - New canvas height
     */
    resize(width, height) {
        this.canvas.width = width;
        this.canvas.height = height;

        // Note: Grid resolution stays fixed, only canvas viewport changes
        // If you want to scale grid with resolution, call setConfig with new gridSize

        // Resize effect FBOs (bloom depends on canvas size)
        if (this._initialized && this._effects) {
            this._effects.resize(width, height);
        }
    }

    /**
     * Updates simulation configuration.
     *
     * @param {Object} newConfig - Configuration updates
     */
    setConfig(newConfig) {
        const oldGridSize = this.config.gridSize;
        const oldDyeSize = this.config.dyeSize;

        this.config = { ...this.config, ...newConfig };

        // Update effects renderer config
        if (this._effects) {
            this._effects.setConfig(this.config);
        }

        // Update simulation config
        if (this._simulation) {
            this._simulation.setConfig(this.config);
        }

        // Resize FBOs if grid size changed
        if (this._initialized) {
            if (this.config.gridSize !== oldGridSize) {
                this._fbos.velocity.resize(
                    this.config.gridSize,
                    this.config.gridSize
                );
                this._fbos.pressure.resize(
                    this.config.gridSize,
                    this.config.gridSize
                );

                // Recreate divergence FBO
                const gl = this.gl;
                gl.deleteTexture(this._fbos.divergence.texture);
                gl.deleteFramebuffer(this._fbos.divergence.framebuffer);

                const divergenceTexture = createTexture(
                    gl,
                    this.config.gridSize,
                    this.config.gridSize,
                    this.formats.PRESSURE_FORMAT
                );
                this._fbos.divergence = {
                    texture: divergenceTexture,
                    framebuffer: createFramebuffer(gl, divergenceTexture),
                    width: this.config.gridSize,
                    height: this.config.gridSize
                };
            }

            if (this.config.dyeSize !== oldDyeSize) {
                this._fbos.dye.resize(
                    this.config.dyeSize,
                    this.config.dyeSize
                );
            }

            // Sync FBOs with simulation after any resize
            if (this._simulation && (this.config.gridSize !== oldGridSize || this.config.dyeSize !== oldDyeSize)) {
                this._simulation.setFBOs(this._fbos);
            }
        }
    }

    /**
     * Adds a force to be applied in the next step.
     *
     * @param {number[]} position - [x, y] in normalized [0,1] coords
     * @param {number[]} direction - [dx, dy] direction vector
     * @param {number} [radius] - Force radius (default from config)
     * @param {number} [strength] - Force strength (default from config)
     */
    addForce(position, direction, radius, strength) {
        this._pendingForces.push({
            position,
            direction,
            radius: radius || this.config.forceRadius,
            strength: strength || this.config.forceStrength
        });
    }

    /**
     * Adds dye to be applied in the next step.
     *
     * @param {number[]} position - [x, y] in normalized [0,1] coords
     * @param {number[]} color - [r, g, b] color values (0-1)
     * @param {number} [radius] - Dye radius (default from config.splatRadius)
     */
    addDye(position, color, radius) {
        this._pendingDye.push({
            position,
            color,
            radius: radius || this.config.splatRadius
        });
    }

    /**
     * Clears all fluid fields.
     */
    clear() {
        if (this._initialized) {
            this._clearFBO(this._fbos.velocity);
            this._clearFBO(this._fbos.pressure);
            this._clearFBO(this._fbos.dye);
        }
    }

    /**
     * Destroys the solver and releases all WebGL resources.
     */
    destroy() {
        const gl = this.gl;

        // Destroy programs
        for (const program of Object.values(this._programs)) {
            program.destroy();
        }

        // Destroy FBOs
        this._fbos.velocity.destroy();
        this._fbos.pressure.destroy();
        this._fbos.dye.destroy();

        gl.deleteTexture(this._fbos.divergence.texture);
        gl.deleteFramebuffer(this._fbos.divergence.framebuffer);

        gl.deleteTexture(this._fbos.curl.texture);
        gl.deleteFramebuffer(this._fbos.curl.framebuffer);

        // Destroy effects renderer (handles bloom and sunrays FBOs)
        if (this._effects) {
            this._effects.destroy();
            this._effects = null;
        }

        // Destroy VAO
        if (this._vao) {
            gl.deleteVertexArray(this._vao);
        }

        this._initialized = false;
    }
}

// =============================================================================
// EXPORTS
// =============================================================================

export { COLORS, DEFAULT_CONFIG, QUALITY_PRESETS, detectQuality };
