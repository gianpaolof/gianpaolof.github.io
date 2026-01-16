/**
 * Water Simulation Module
 *
 * Implements the 2D wave equation physics using GPU shaders.
 * Uses leapfrog time integration for stability.
 *
 * @module water-simulation
 */

/**
 * WaterSimulation class handles wave physics computation.
 */
export class WaterSimulation {
    /**
     * Creates a new WaterSimulation instance.
     *
     * @param {WebGL2RenderingContext} gl - WebGL2 context
     * @param {Object} programs - Compiled shader programs
     * @param {Object} fbos - Framebuffer objects
     * @param {Object} config - Simulation configuration
     */
    constructor(gl, programs, fbos, config) {
        this.gl = gl;
        this.programs = programs;
        this.fbos = fbos;
        this.config = config;

        // Pending drops to apply
        this._pendingDrops = [];

        // Calculate c²Δt² for wave equation
        // CFL condition: c*dt/dx <= 1/sqrt(2) for 2D
        // dx = 1/resolution, so dt_max = dx / (c * sqrt(2))
        this._updateWaveConstants();
    }

    /**
     * Updates wave equation constants based on config.
     */
    _updateWaveConstants() {
        const { resolution, waveSpeed, substeps } = this.config;

        // Grid spacing (normalized)
        const dx = 1.0 / resolution;

        // Time step per substep (conservative for stability)
        // CFL: dt <= dx / (c * sqrt(2))
        const dt_max = dx / (waveSpeed * 1.414);
        this._dt = dt_max * 0.8; // 80% of max for safety

        // Precompute c² * dt²
        this._c2dt2 = waveSpeed * waveSpeed * this._dt * this._dt;

        // Substeps per frame
        this._substeps = substeps;
    }

    /**
     * Queues a drop to be applied next step.
     *
     * @param {number} x - X position (0-1)
     * @param {number} y - Y position (0-1)
     * @param {number} radius - Drop radius (normalized)
     * @param {number} strength - Drop strength
     */
    addDrop(x, y, radius = null, strength = null) {
        this._pendingDrops.push({
            x,
            y,
            radius: radius ?? this.config.dropRadius,
            strength: strength ?? this.config.dropStrength
        });
    }

    /**
     * Applies a single drop to the height field.
     *
     * @param {Object} drop - Drop parameters
     * @param {Function} drawQuad - Function to draw fullscreen quad
     */
    _applyDrop(drop, drawQuad) {
        const { gl, programs, fbos } = this;
        const program = programs.waveDrop;

        // Render to current height texture
        fbos.height.bindWrite();
        gl.viewport(0, 0, this.config.resolution, this.config.resolution);

        program.use();
        gl.uniform1i(program.uniforms.u_height, 0);
        gl.uniform2f(program.uniforms.u_dropPosition, drop.x, drop.y);
        gl.uniform1f(program.uniforms.u_dropRadius, drop.radius);
        gl.uniform1f(program.uniforms.u_dropStrength, drop.strength);
        gl.uniform2f(program.uniforms.u_texelSize,
            1.0 / this.config.resolution,
            1.0 / this.config.resolution
        );
        gl.uniform1f(program.uniforms.u_aspectRatio, 1.0);

        fbos.height.bindRead(0);
        drawQuad();

        fbos.height.swap();
    }

    /**
     * Performs one wave equation update step.
     *
     * @param {Function} drawQuad - Function to draw fullscreen quad
     */
    _updateWaves(drawQuad) {
        const { gl, programs, fbos } = this;
        const program = programs.waveUpdate;

        // Bind write target
        fbos.height.bindWrite();
        gl.viewport(0, 0, this.config.resolution, this.config.resolution);

        program.use();

        // Bind current height to unit 0
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, fbos.height.texture);
        gl.uniform1i(program.uniforms.u_heightCurrent, 0);

        // Bind previous height to unit 1
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, fbos.heightPrev.texture);
        gl.uniform1i(program.uniforms.u_heightPrevious, 1);

        // Wave equation constants
        gl.uniform1f(program.uniforms.u_c2dt2, this._c2dt2);
        gl.uniform1f(program.uniforms.u_damping, this.config.damping);
        gl.uniform2f(program.uniforms.u_texelSize,
            1.0 / this.config.resolution,
            1.0 / this.config.resolution
        );

        drawQuad();

        // Swap height buffers for leapfrog: prev <- current, current <- new
        // Copy current to prev before swapping
        this._copyTexture(fbos.height.texture, fbos.heightPrev, drawQuad);

        // Now swap main height buffer
        fbos.height.swap();
    }

    /**
     * Copies a texture to a framebuffer.
     *
     * @param {WebGLTexture} source - Source texture
     * @param {Object} targetFbo - Target framebuffer object
     * @param {Function} drawQuad - Function to draw fullscreen quad
     */
    _copyTexture(source, targetFbo, drawQuad) {
        const { gl, programs } = this;
        const program = programs.copy;

        targetFbo.bindWrite();
        gl.viewport(0, 0, this.config.resolution, this.config.resolution);

        program.use();
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, source);
        gl.uniform1i(program.uniforms.u_texture, 0);

        drawQuad();
        targetFbo.swap();
    }

    /**
     * Computes surface normals from the height field.
     *
     * @param {Function} drawQuad - Function to draw fullscreen quad
     */
    _computeNormals(drawQuad) {
        const { gl, programs, fbos } = this;
        const program = programs.waveNormal;

        fbos.normal.bindWrite();
        gl.viewport(0, 0, this.config.resolution, this.config.resolution);

        program.use();
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, fbos.height.texture);
        gl.uniform1i(program.uniforms.u_height, 0);
        gl.uniform2f(program.uniforms.u_texelSize,
            1.0 / this.config.resolution,
            1.0 / this.config.resolution
        );
        gl.uniform1f(program.uniforms.u_heightScale, this.config.heightScale);

        drawQuad();
        fbos.normal.swap();
    }

    /**
     * Performs a full simulation step.
     *
     * @param {number} dt - Delta time (unused, we use fixed substeps)
     * @param {Function} drawQuad - Function to draw fullscreen quad
     */
    step(dt, drawQuad) {
        // Apply any pending drops
        for (const drop of this._pendingDrops) {
            this._applyDrop(drop, drawQuad);
        }
        this._pendingDrops = [];

        // Run wave equation substeps
        for (let i = 0; i < this._substeps; i++) {
            this._updateWaves(drawQuad);
        }

        // Compute normals for rendering
        this._computeNormals(drawQuad);
    }

    /**
     * Updates configuration.
     *
     * @param {Object} newConfig - New configuration values
     */
    updateConfig(newConfig) {
        Object.assign(this.config, newConfig);
        this._updateWaveConstants();
    }

    /**
     * Resets the simulation to calm water.
     */
    reset() {
        const { gl, fbos } = this;
        const resolution = this.config.resolution;

        // Clear height textures to 0
        fbos.height.bindWrite();
        gl.viewport(0, 0, resolution, resolution);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        fbos.height.swap();

        fbos.height.bindWrite();
        gl.clear(gl.COLOR_BUFFER_BIT);
        fbos.height.swap();

        fbos.heightPrev.bindWrite();
        gl.clear(gl.COLOR_BUFFER_BIT);
        fbos.heightPrev.swap();

        fbos.heightPrev.bindWrite();
        gl.clear(gl.COLOR_BUFFER_BIT);
        fbos.heightPrev.swap();

        this._pendingDrops = [];
    }

    /**
     * Gets the current height texture.
     *
     * @returns {WebGLTexture} Height texture
     */
    get heightTexture() {
        return this.fbos.height.texture;
    }

    /**
     * Gets the current normal texture.
     *
     * @returns {WebGLTexture} Normal texture
     */
    get normalTexture() {
        return this.fbos.normal.texture;
    }
}
