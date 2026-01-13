/**
 * Fluid Simulation Physics Module
 *
 * Implements the core Navier-Stokes fluid dynamics solver.
 * This module handles all physics computations including:
 * - Velocity advection (semi-Lagrangian)
 * - Pressure projection (Jacobi iteration)
 * - Vorticity confinement
 * - Force and dye injection
 *
 * @module simulation
 *
 * @description
 * ## Navier-Stokes Equations
 *
 * The simulation solves the incompressible Navier-Stokes equations:
 *
 * ```
 * ∂u/∂t + (u·∇)u = -∇p/ρ + ν∇²u + f    (Momentum equation)
 * ∇·u = 0                                (Incompressibility)
 * ```
 *
 * Where:
 * - u = velocity field
 * - p = pressure
 * - ρ = density (constant for incompressible flow)
 * - ν = kinematic viscosity
 * - f = external forces
 *
 * ## Simulation Pipeline (per frame)
 *
 * 1. **Force Injection**: Add user input forces to velocity field
 * 2. **Vorticity Confinement**: Amplify rotational motion
 * 3. **Pressure Projection**: Make velocity divergence-free
 *    a. Compute divergence: div = ∇·u
 *    b. Solve Poisson equation: ∇²p = div (Jacobi iteration)
 *    c. Subtract gradient: u = u - ∇p
 * 4. **Advection**: Transport velocity and dye fields
 *
 * ## Key Algorithms
 *
 * ### Semi-Lagrangian Advection
 * Instead of solving the advection equation directly, we trace
 * particles backward in time and sample the field at the previous
 * position. This is unconditionally stable regardless of timestep.
 *
 * ### Jacobi Pressure Solver
 * Iteratively solves the Poisson equation using the formula:
 * p_new = (p_left + p_right + p_bottom + p_top - divergence) / 4
 *
 * ### Vorticity Confinement
 * Counteracts numerical dissipation by adding rotational forces
 * proportional to the curl of the velocity field.
 */

/**
 * Fluid simulation step manager.
 * Orchestrates the physics pipeline for one simulation frame.
 */
export class FluidSimulation {
    /**
     * Creates a new FluidSimulation instance.
     *
     * @param {WebGL2RenderingContext} gl - WebGL context
     * @param {Object} programs - Compiled shader programs
     * @param {Object} fbos - Framebuffer objects
     * @param {Object} config - Simulation configuration
     */
    constructor(gl, programs, fbos, config) {
        this._gl = gl;
        this._programs = programs;
        this._fbos = fbos;
        this._config = config;
        this._time = 0;
    }

    /**
     * Updates the configuration.
     * @param {Object} config - New configuration values
     */
    setConfig(config) {
        this._config = { ...this._config, ...config };
    }

    /**
     * Updates FBO references (used after resize).
     * @param {Object} fbos - New FBO references
     */
    setFBOs(fbos) {
        this._fbos = fbos;
    }

    /**
     * Gets the current simulation time.
     * @returns {number}
     */
    get time() {
        return this._time;
    }

    /**
     * Performs one complete simulation step.
     *
     * This executes the full Navier-Stokes pipeline:
     * 1. Apply external forces (user input)
     * 2. Apply dye (color injection)
     * 3. Compute curl (for vorticity)
     * 4. Apply vorticity confinement
     * 5. Compute divergence
     * 6. Scale pressure (for faster convergence)
     * 7. Solve pressure (Jacobi iteration)
     * 8. Subtract pressure gradient (projection)
     * 9. Advect velocity field
     * 10. Advect dye field
     *
     * @param {number} dt - Delta time in seconds
     * @param {Array} forces - Array of force objects [{position, direction, radius}]
     * @param {Array} dyes - Array of dye objects [{position, color, radius}]
     * @param {number} aspectRatio - Canvas aspect ratio (width/height)
     * @param {Function} drawQuad - Function to draw fullscreen quad
     */
    step(dt, forces, dyes, aspectRatio, drawQuad) {
        const gl = this._gl;
        const config = this._config;

        // Cap dt to prevent instability
        dt = Math.min(dt, 0.016666);
        this._time += dt;

        const { gridSize, dyeSize } = config;
        const texelSize = [1.0 / gridSize, 1.0 / gridSize];
        const dyeTexelSize = [1.0 / dyeSize, 1.0 / dyeSize];

        // =====================================================================
        // STEP 1: Apply external forces (user input)
        // =====================================================================
        for (const force of forces) {
            this._applyForce(force, aspectRatio, drawQuad);
        }

        // =====================================================================
        // STEP 2: Apply dye (color injection)
        // =====================================================================
        for (const dye of dyes) {
            this._applyDye(dye, aspectRatio, drawQuad);
        }

        // =====================================================================
        // STEP 3: Compute curl (vorticity scalar field)
        // The curl measures local rotation in the fluid.
        // curl(u) = ∂v/∂x - ∂u/∂y (in 2D, this is a scalar)
        // =====================================================================
        if (config.curl > 0) {
            this._computeCurl(texelSize, drawQuad);
        }

        // =====================================================================
        // STEP 4: Apply vorticity confinement
        // This counteracts numerical dissipation by adding rotational force.
        // f_vort = ε * (N × ω) where N = ∇|ω|/|∇|ω||
        // =====================================================================
        if (config.curl > 0) {
            this._applyVorticity(dt, texelSize, drawQuad);
        }

        // =====================================================================
        // STEP 5: Compute divergence
        // div(u) = ∂u/∂x + ∂v/∂y
        // This measures how much fluid is "created" or "destroyed" at each point.
        // For incompressible flow, this should be zero everywhere.
        // =====================================================================
        this._computeDivergence(texelSize, drawQuad);

        // =====================================================================
        // STEP 6: Scale pressure (Pavel's optimization)
        // Keep 80% of previous pressure for faster Jacobi convergence.
        // This assumes pressure doesn't change drastically between frames.
        // =====================================================================
        this._clearPressure(drawQuad);

        // =====================================================================
        // STEP 7: Solve pressure using Jacobi iteration
        // Solve the Poisson equation: ∇²p = div(u)
        // p_new = (p_L + p_R + p_B + p_T - div) / 4
        // =====================================================================
        this._solvePressure(drawQuad);

        // =====================================================================
        // STEP 8: Subtract pressure gradient (projection step)
        // u_new = u - ∇p
        // This makes the velocity field divergence-free (incompressible).
        // =====================================================================
        this._subtractGradient(drawQuad);

        // =====================================================================
        // STEP 9: Advect velocity field (self-advection)
        // Velocity transports itself: u_new(x) = u_old(x - dt*u(x))
        // This is done AFTER projection to maintain incompressibility.
        // =====================================================================
        this._advect(
            this._fbos.velocity,
            this._fbos.velocity,
            dt,
            config.velocityDissipation,
            texelSize,
            texelSize,
            drawQuad
        );

        // =====================================================================
        // STEP 10: Advect dye field
        // Dye follows the velocity: dye_new(x) = dye_old(x - dt*u(x))
        // Uses velocity texelSize for backtrace, dye texelSize for sampling.
        // =====================================================================
        this._advect(
            this._fbos.dye,
            this._fbos.dye,
            dt,
            config.dyeDissipation,
            texelSize,      // velocity texelSize for backtrace
            dyeTexelSize,   // dye texelSize for bilerp sampling
            drawQuad
        );
    }

    // =========================================================================
    // ADVECTION
    // =========================================================================

    /**
     * Advects a field using semi-Lagrangian method.
     *
     * Semi-Lagrangian advection traces particles backward in time:
     * 1. At each grid point x, compute previous position: x_prev = x - dt * u(x)
     * 2. Sample the field at x_prev using bilinear interpolation
     * 3. Apply dissipation to simulate viscosity
     *
     * This method is unconditionally stable regardless of timestep,
     * but introduces some numerical diffusion.
     *
     * @private
     * @param {DoubleFBO} targetFBO - Where to write the result
     * @param {DoubleFBO} sourceFBO - Field to advect
     * @param {number} dt - Delta time
     * @param {number} dissipation - Decay rate (higher = faster decay)
     * @param {number[]} velocityTexelSize - 1/gridSize for backtrace
     * @param {number[]} sourceTexelSize - 1/sourceSize for sampling
     * @param {Function} drawQuad - Quad drawing function
     */
    _advect(targetFBO, sourceFBO, dt, dissipation, velocityTexelSize, sourceTexelSize, drawQuad) {
        const gl = this._gl;
        const program = this._programs.advect;

        program.use();

        // Velocity texture for computing backtrace position
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this._fbos.velocity.texture);
        gl.uniform1i(program.uniforms.u_velocity, 0);

        // Source texture to sample from
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, sourceFBO.texture);
        gl.uniform1i(program.uniforms.u_source, 1);

        // Texel sizes for backtrace and sampling
        gl.uniform2f(program.uniforms.u_texelSize, velocityTexelSize[0], velocityTexelSize[1]);
        gl.uniform2f(program.uniforms.u_sourceTexelSize, sourceTexelSize[0], sourceTexelSize[1]);
        gl.uniform1f(program.uniforms.u_dt, dt);
        gl.uniform1f(program.uniforms.u_dissipation, dissipation);

        targetFBO.bindWrite();
        drawQuad();
        targetFBO.swap();

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    // =========================================================================
    // PRESSURE PROJECTION
    // =========================================================================

    /**
     * Computes divergence of the velocity field.
     *
     * Divergence measures the net flow out of each point:
     * div(u) = ∂u/∂x + ∂v/∂y
     *
     * Using central differences:
     * div ≈ (u_right - u_left + v_top - v_bottom) / 2
     *
     * The shader also applies boundary conditions to prevent
     * fluid from flowing through the domain boundaries.
     *
     * @private
     */
    _computeDivergence(texelSize, drawQuad) {
        const gl = this._gl;
        const program = this._programs.divergence;

        program.use();

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this._fbos.velocity.texture);
        gl.uniform1i(program.uniforms.u_velocity, 0);
        gl.uniform2f(program.uniforms.u_texelSize, texelSize[0], texelSize[1]);

        gl.bindFramebuffer(gl.FRAMEBUFFER, this._fbos.divergence.framebuffer);
        gl.viewport(0, 0, this._fbos.divergence.width, this._fbos.divergence.height);
        drawQuad();

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    /**
     * Scales pressure field for faster Jacobi convergence.
     *
     * Instead of clearing pressure to zero, we scale the previous
     * pressure by 0.8 (config.pressure). This provides a better
     * initial guess for the Jacobi solver since pressure doesn't
     * change drastically between frames.
     *
     * @private
     */
    _clearPressure(drawQuad) {
        const gl = this._gl;
        const program = this._programs.clear;

        program.use();

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this._fbos.pressure.texture);
        gl.uniform1i(program.uniforms.u_texture, 0);
        gl.uniform1f(program.uniforms.u_value, this._config.pressure);

        this._fbos.pressure.bindWrite();
        drawQuad();
        this._fbos.pressure.swap();

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    /**
     * Solves pressure using Jacobi iteration.
     *
     * Solves the Poisson equation: ∇²p = div(u)
     *
     * The Jacobi iteration formula for 2D Laplacian:
     * p_new(x,y) = (p(x-1,y) + p(x+1,y) + p(x,y-1) + p(x,y+1) - div(x,y)) / 4
     *
     * We iterate 20 times (config.pressureIterations) for convergence.
     * More iterations = more accurate but slower.
     *
     * @private
     */
    _solvePressure(drawQuad) {
        const gl = this._gl;
        const program = this._programs.pressure;

        program.use();

        // Divergence is constant during iteration
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this._fbos.divergence.texture);
        gl.uniform1i(program.uniforms.u_divergence, 1);

        // Jacobi iteration
        for (let i = 0; i < this._config.pressureIterations; i++) {
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, this._fbos.pressure.texture);
            gl.uniform1i(program.uniforms.u_pressure, 0);

            this._fbos.pressure.bindWrite();
            drawQuad();
            this._fbos.pressure.swap();
        }

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    /**
     * Subtracts pressure gradient from velocity (projection).
     *
     * This is the key step that enforces incompressibility.
     * By subtracting the pressure gradient:
     * u_new = u - ∇p
     *
     * We remove the compressible component of velocity,
     * making div(u_new) = 0 (approximately, limited by solver accuracy).
     *
     * @private
     */
    _subtractGradient(drawQuad) {
        const gl = this._gl;
        const program = this._programs.gradient;

        program.use();

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this._fbos.pressure.texture);
        gl.uniform1i(program.uniforms.u_pressure, 0);

        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this._fbos.velocity.texture);
        gl.uniform1i(program.uniforms.u_velocity, 1);

        this._fbos.velocity.bindWrite();
        drawQuad();
        this._fbos.velocity.swap();

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    // =========================================================================
    // VORTICITY CONFINEMENT
    // =========================================================================

    /**
     * Computes curl (vorticity) of the velocity field.
     *
     * In 2D, the curl is a scalar representing rotation:
     * curl(u) = ∂v/∂x - ∂u/∂y
     *
     * Positive curl = counter-clockwise rotation
     * Negative curl = clockwise rotation
     *
     * This is computed in a separate pass and stored in a texture
     * for use in the vorticity confinement step.
     *
     * @private
     */
    _computeCurl(texelSize, drawQuad) {
        const gl = this._gl;
        const program = this._programs.curl;

        program.use();

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this._fbos.velocity.texture);
        gl.uniform1i(program.uniforms.u_velocity, 0);
        gl.uniform2f(program.uniforms.u_texelSize, texelSize[0], texelSize[1]);

        gl.bindFramebuffer(gl.FRAMEBUFFER, this._fbos.curl.framebuffer);
        gl.viewport(0, 0, this._fbos.curl.width, this._fbos.curl.height);
        drawQuad();

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    /**
     * Applies vorticity confinement force.
     *
     * Numerical methods tend to dampen rotational motion over time.
     * Vorticity confinement counteracts this by adding force that
     * amplifies existing vortices.
     *
     * The force is computed as:
     * 1. N = normalize(∇|ω|) - points toward vortex centers
     * 2. f = ε * (N × ω) - force perpendicular to N, proportional to curl
     *
     * This creates sharper, more defined swirls that persist longer.
     *
     * @private
     */
    _applyVorticity(dt, texelSize, drawQuad) {
        const gl = this._gl;
        const program = this._programs.vorticity;

        program.use();

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this._fbos.velocity.texture);
        gl.uniform1i(program.uniforms.u_velocity, 0);

        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this._fbos.curl.texture);
        gl.uniform1i(program.uniforms.u_curl, 1);

        gl.uniform2f(program.uniforms.u_texelSize, texelSize[0], texelSize[1]);
        gl.uniform1f(program.uniforms.u_curlStrength, this._config.curl);
        gl.uniform1f(program.uniforms.u_dt, dt);

        this._fbos.velocity.bindWrite();
        drawQuad();
        this._fbos.velocity.swap();

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    // =========================================================================
    // FORCE AND DYE INJECTION
    // =========================================================================

    /**
     * Applies a force splat to the velocity field.
     *
     * Forces are injected using a Gaussian splat:
     * influence = exp(-dist² / (2 * radius²))
     *
     * This creates smooth, circular force distributions
     * that feel natural for user interaction.
     *
     * @private
     */
    _applyForce(force, aspectRatio, drawQuad) {
        const gl = this._gl;
        const program = this._programs.splat;

        program.use();

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this._fbos.velocity.texture);
        gl.uniform1i(program.uniforms.u_target, 0);

        gl.uniform2f(program.uniforms.u_point, force.position[0], force.position[1]);
        gl.uniform3f(program.uniforms.u_color, force.direction[0], force.direction[1], 0.0);
        gl.uniform1f(program.uniforms.u_radius, force.radius || this._config.forceRadius);
        gl.uniform1f(program.uniforms.u_aspectRatio, aspectRatio);

        this._fbos.velocity.bindWrite();
        drawQuad();
        this._fbos.velocity.swap();

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    /**
     * Applies a dye (color) splat to the dye field.
     *
     * Similar to force injection, but adds color instead of velocity.
     * The dye is then advected by the velocity field.
     *
     * @private
     */
    _applyDye(dye, aspectRatio, drawQuad) {
        const gl = this._gl;
        const program = this._programs.splat;

        program.use();

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this._fbos.dye.texture);
        gl.uniform1i(program.uniforms.u_target, 0);

        gl.uniform2f(program.uniforms.u_point, dye.position[0], dye.position[1]);
        gl.uniform3f(program.uniforms.u_color, dye.color[0], dye.color[1], dye.color[2]);
        gl.uniform1f(program.uniforms.u_radius, dye.radius || this._config.splatRadius);
        gl.uniform1f(program.uniforms.u_aspectRatio, aspectRatio);

        this._fbos.dye.bindWrite();
        drawQuad();
        this._fbos.dye.swap();

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    /**
     * Applies a generic splat (for initial random splats).
     *
     * @param {number[]} position - [x, y] in normalized coords
     * @param {number[]} color - [r, g, b] color values
     * @param {number} radius - Splat radius
     * @param {number} aspectRatio - Canvas aspect ratio
     * @param {Function} drawQuad - Quad drawing function
     */
    applySplat(position, color, radius, aspectRatio, drawQuad) {
        const gl = this._gl;
        const program = this._programs.splat;

        program.use();

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this._fbos.dye.texture);
        gl.uniform1i(program.uniforms.u_target, 0);

        gl.uniform2f(program.uniforms.u_point, position[0], position[1]);
        gl.uniform3f(program.uniforms.u_color, color[0], color[1], color[2]);
        gl.uniform1f(program.uniforms.u_radius, radius);
        gl.uniform1f(program.uniforms.u_aspectRatio, aspectRatio);

        this._fbos.dye.bindWrite();
        drawQuad();
        this._fbos.dye.swap();

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    /**
     * Applies a force splat (for initial random splats).
     *
     * @param {number[]} position - [x, y] in normalized coords
     * @param {number[]} direction - [dx, dy] velocity delta
     * @param {number} radius - Splat radius
     * @param {number} aspectRatio - Canvas aspect ratio
     * @param {Function} drawQuad - Quad drawing function
     */
    applyForceSplat(position, direction, radius, aspectRatio, drawQuad) {
        const gl = this._gl;
        const program = this._programs.splat;

        program.use();

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this._fbos.velocity.texture);
        gl.uniform1i(program.uniforms.u_target, 0);

        gl.uniform2f(program.uniforms.u_point, position[0], position[1]);
        gl.uniform3f(program.uniforms.u_color, direction[0], direction[1], 0.0);
        gl.uniform1f(program.uniforms.u_radius, radius);
        gl.uniform1f(program.uniforms.u_aspectRatio, aspectRatio);

        this._fbos.velocity.bindWrite();
        drawQuad();
        this._fbos.velocity.swap();

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
}
