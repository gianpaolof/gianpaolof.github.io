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

// =============================================================================
// SHADER SOURCES
// =============================================================================

/**
 * Fullscreen quad vertex shader (attribute-less).
 * Uses gl_VertexID to generate vertices.
 */
const QUAD_VERT = `#version 300 es

out vec2 v_texCoord;

void main() {
    float x = float((gl_VertexID & 1) << 2) - 1.0;
    float y = float((gl_VertexID & 2) << 1) - 1.0;
    v_texCoord = vec2(x, y) * 0.5 + 0.5;
    gl_Position = vec4(x, y, 0.0, 1.0);
}
`;

/**
 * Semi-Lagrangian advection shader.
 * Traces particles backward in time and samples the source field.
 */
const ADVECT_FRAG = `#version 300 es
precision highp float;

uniform sampler2D u_velocity;
uniform sampler2D u_source;
uniform vec2 u_texelSize;
uniform float u_dt;
uniform float u_dissipation;

in vec2 v_texCoord;
out vec4 fragColor;

void main() {
    vec2 velocity = texture(u_velocity, v_texCoord).xy;
    vec2 prevPos = v_texCoord - u_dt * velocity * u_texelSize;
    vec4 result = texture(u_source, prevPos);
    fragColor = result * u_dissipation;
}
`;

/**
 * External force injection shader.
 * Applies Gaussian splat forces from user input.
 */
const FORCES_FRAG = `#version 300 es
precision highp float;

uniform sampler2D u_velocity;
uniform vec2 u_texelSize;
uniform float u_aspectRatio;

uniform vec2 u_forcePosition;
uniform vec2 u_forceDirection;
uniform float u_forceRadius;

uniform float u_time;
uniform float u_noiseScale;
uniform float u_noiseStrength;

in vec2 v_texCoord;
out vec4 fragColor;

vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute(vec3 x) { return mod289(((x * 34.0) + 1.0) * x); }

float snoise(vec2 v) {
    const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                        -0.577350269189626, 0.024390243902439);
    vec2 i = floor(v + dot(v, C.yy));
    vec2 x0 = v - i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod289(i);
    vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
    m = m * m * m * m;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
    vec3 g;
    g.x = a0.x * x0.x + h.x * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
}

void main() {
    vec2 velocity = texture(u_velocity, v_texCoord).xy;

    vec2 delta = v_texCoord - u_forcePosition;
    delta.x *= u_aspectRatio;
    float dist = length(delta);

    float influence = exp(-dist * dist / (2.0 * u_forceRadius * u_forceRadius));
    velocity += u_forceDirection * influence;

    if (u_noiseStrength > 0.0) {
        vec2 noiseCoord = v_texCoord * u_noiseScale;
        vec2 noiseForce = vec2(
            snoise(vec2(noiseCoord.x, noiseCoord.y + u_time * 0.1)),
            snoise(vec2(noiseCoord.x + 100.0, noiseCoord.y + u_time * 0.1))
        ) * u_noiseStrength;
        velocity += noiseForce;
    }

    float speed = length(velocity);
    if (speed > 10.0) {
        velocity = velocity / speed * 10.0;
    }

    fragColor = vec4(velocity, 0.0, 1.0);
}
`;

/**
 * Dye injection shader.
 * Adds color splat at specified position.
 */
const DYE_FRAG = `#version 300 es
precision highp float;

uniform sampler2D u_dye;
uniform vec2 u_dyePosition;
uniform vec3 u_dyeColor;
uniform float u_dyeRadius;
uniform float u_aspectRatio;

in vec2 v_texCoord;
out vec4 fragColor;

void main() {
    vec3 dye = texture(u_dye, v_texCoord).rgb;

    vec2 delta = v_texCoord - u_dyePosition;
    delta.x *= u_aspectRatio;
    float dist = length(delta);

    float influence = exp(-dist * dist / (2.0 * u_dyeRadius * u_dyeRadius));
    dye += u_dyeColor * influence;

    fragColor = vec4(clamp(dye, 0.0, 1.0), 1.0);
}
`;

/**
 * Divergence calculation shader.
 * Computes divergence using central differences.
 */
const DIVERGENCE_FRAG = `#version 300 es
precision highp float;

uniform sampler2D u_velocity;
uniform vec2 u_texelSize;

in vec2 v_texCoord;
out float fragColor;

void main() {
    // Sample neighbor velocities
    float L = textureOffset(u_velocity, v_texCoord, ivec2(-1, 0)).x;
    float R = textureOffset(u_velocity, v_texCoord, ivec2( 1, 0)).x;
    float B = textureOffset(u_velocity, v_texCoord, ivec2( 0,-1)).y;
    float T = textureOffset(u_velocity, v_texCoord, ivec2( 0, 1)).y;

    // Sample center velocity for boundary conditions
    vec2 C = texture(u_velocity, v_texCoord).xy;

    // Free-slip boundary conditions (Pavel's approach)
    // At boundaries, flip velocity to prevent penetration
    vec2 coordL = v_texCoord - vec2(u_texelSize.x, 0.0);
    vec2 coordR = v_texCoord + vec2(u_texelSize.x, 0.0);
    vec2 coordT = v_texCoord + vec2(0.0, u_texelSize.y);
    vec2 coordB = v_texCoord - vec2(0.0, u_texelSize.y);

    if (coordL.x < 0.0) { L = -C.x; }
    if (coordR.x > 1.0) { R = -C.x; }
    if (coordT.y > 1.0) { T = -C.y; }
    if (coordB.y < 0.0) { B = -C.y; }

    float divergence = 0.5 * (R - L + T - B);
    fragColor = divergence;
}
`;

/**
 * Jacobi pressure solver shader.
 * Iteratively solves Poisson equation.
 */
const PRESSURE_FRAG = `#version 300 es
precision mediump float;

uniform sampler2D u_pressure;
uniform sampler2D u_divergence;

in vec2 v_texCoord;
out float fragColor;

void main() {
    float pL = textureOffset(u_pressure, v_texCoord, ivec2(-1, 0)).x;
    float pR = textureOffset(u_pressure, v_texCoord, ivec2( 1, 0)).x;
    float pB = textureOffset(u_pressure, v_texCoord, ivec2( 0,-1)).x;
    float pT = textureOffset(u_pressure, v_texCoord, ivec2( 0, 1)).x;

    float div = texture(u_divergence, v_texCoord).x;
    float pressure = (pL + pR + pB + pT - div) * 0.25;

    fragColor = pressure;
}
`;

/**
 * Gradient subtraction shader.
 * Projects velocity to divergence-free field.
 */
const GRADIENT_FRAG = `#version 300 es
precision highp float;

uniform sampler2D u_pressure;
uniform sampler2D u_velocity;

in vec2 v_texCoord;
out vec2 fragColor;

void main() {
    float L = textureOffset(u_pressure, v_texCoord, ivec2(-1, 0)).x;
    float R = textureOffset(u_pressure, v_texCoord, ivec2( 1, 0)).x;
    float B = textureOffset(u_pressure, v_texCoord, ivec2( 0,-1)).x;
    float T = textureOffset(u_pressure, v_texCoord, ivec2( 0, 1)).x;

    vec2 velocity = texture(u_velocity, v_texCoord).xy;

    // Pavel's formula: subtract gradient directly (no 0.5 factor)
    // This matches his pressure/divergence scaling convention
    velocity -= vec2(R - L, T - B);

    fragColor = velocity;
}
`;

/**
 * Vorticity confinement shader.
 * Amplifies vortices to counteract numerical dissipation.
 */
const VORTICITY_FRAG = `#version 300 es
precision highp float;

uniform sampler2D u_velocity;
uniform vec2 u_texelSize;
uniform float u_curl;
uniform float u_dt;

in vec2 v_texCoord;
out vec2 fragColor;

float curl(vec2 uv) {
    float vL = texture(u_velocity, uv - vec2(u_texelSize.x, 0.0)).y;
    float vR = texture(u_velocity, uv + vec2(u_texelSize.x, 0.0)).y;
    float vB = texture(u_velocity, uv - vec2(0.0, u_texelSize.y)).x;
    float vT = texture(u_velocity, uv + vec2(0.0, u_texelSize.y)).x;
    return (vR - vL) - (vT - vB);
}

void main() {
    vec2 uv = v_texCoord;
    vec2 velocity = texture(u_velocity, uv).xy;

    float curlC = curl(uv);
    float curlL = curl(uv - vec2(u_texelSize.x, 0.0));
    float curlR = curl(uv + vec2(u_texelSize.x, 0.0));
    float curlB = curl(uv - vec2(0.0, u_texelSize.y));
    float curlT = curl(uv + vec2(0.0, u_texelSize.y));

    vec2 curlGrad = vec2(abs(curlR) - abs(curlL), abs(curlT) - abs(curlB));
    float len = length(curlGrad);
    if (len > 0.0001) curlGrad /= len;

    vec2 force = vec2(curlGrad.y, -curlGrad.x) * curlC * u_curl;
    velocity += force * u_dt;

    fragColor = velocity;
}
`;

/**
 * CodePen style render shader (FWeinb).
 * Maps velocity components directly to RGB channels.
 * Black background, colored fluid, no white.
 */
const RENDER_FRAG = `#version 300 es
precision highp float;

uniform sampler2D u_velocity;
uniform sampler2D u_dye;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_intensity;

in vec2 v_texCoord;
out vec4 fragColor;

void main() {
    // Sample velocity
    vec2 velocity = texture(u_velocity, v_texCoord).xy;

    // Speed threshold - below this, show black
    float speed = length(velocity);
    if (speed < 0.001) {
        fragColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
    }

    // CodePen style: velocity components → RGB
    // Lower multipliers to avoid saturation/white
    float r = abs(velocity.x) * u_intensity * 1.2;
    float b = abs(velocity.y) * u_intensity * 1.2;
    float g = (r + b) * 0.25;

    // Cap maximum brightness to 0.85 to avoid white
    float maxBrightness = 0.85;
    vec3 color = vec3(r, g, b);
    float brightness = max(max(color.r, color.g), color.b);
    if (brightness > maxBrightness) {
        color *= maxBrightness / brightness;
    }

    fragColor = vec4(color, 1.0);
}
`;

// =============================================================================
// COLOR PALETTE
// =============================================================================

/**
 * Aurora Borealis color palette.
 * @type {Object.<string, number[]>}
 */
const COLORS = {
    bg: [0.02, 0.02, 0.04],        // #050510
    primary: [0.0, 1.0, 0.53],     // #00FF87
    secondary: [0.49, 0.23, 0.93], // #7C3AED
    accent: [0.0, 0.83, 1.0]       // #00D4FF
};

// =============================================================================
// DEFAULT CONFIGURATION
// =============================================================================

/**
 * Default simulation configuration.
 * @type {Object}
 */
const DEFAULT_CONFIG = {
    gridSize: 64,            // Same as CodePen - low res = smooth
    dyeSize: 128,
    pressureIterations: 20,
    velocityDissipation: 0.97,  // More dissipation = calmer fluid
    dyeDissipation: 0.95,
    forceRadius: 0.1,
    forceStrength: 0.5,      // Much gentler forces
    noiseScale: 4.0,
    noiseStrength: 0.0,
    curl: 0.0,               // Disable vorticity confinement
    intensity: 1.0
};

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
        this.config = { ...DEFAULT_CONFIG, ...config };

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
    }

    /**
     * Initializes the fluid solver.
     * Creates shader programs, FBOs, and VAO.
     *
     * @async
     * @returns {Promise<void>}
     * @throws {Error} If initialization fails
     */
    async init() {
        const gl = this.gl;

        // Create shader programs
        this._createPrograms();

        // Create framebuffer objects
        this._createFBOs();

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

        // Add initial random forces to create immediate visual interest
        this._addInitialSplats();
    }

    /**
     * Adds initial motion for visual interest on load.
     * @private
     */
    _addInitialSplats() {
        const { gridSize } = this.config;
        const texelSize = [1.0 / gridSize, 1.0 / gridSize];
        const aspectRatio = this.canvas.width / this.canvas.height;

        // Stronger initial splats to be visible immediately
        const splats = [
            { pos: [0.25, 0.4], dir: [1.5, 0.8], radius: 0.2 },
            { pos: [0.75, 0.6], dir: [-1.2, 1.0], radius: 0.2 },
            { pos: [0.5, 0.25], dir: [0.8, -1.2], radius: 0.18 },
            { pos: [0.4, 0.75], dir: [-1.0, -0.6], radius: 0.18 },
            { pos: [0.6, 0.5], dir: [0.5, 1.5], radius: 0.15 },
        ];

        for (const s of splats) {
            this._applyForce({
                position: s.pos,
                direction: s.dir,
                radius: s.radius,
                strength: 1.0
            }, texelSize, aspectRatio);
        }
    }

    /**
     * Creates all shader programs.
     * @private
     */
    _createPrograms() {
        const gl = this.gl;

        this._programs.advect = createProgram(gl, QUAD_VERT, ADVECT_FRAG);
        this._programs.forces = createProgram(gl, QUAD_VERT, FORCES_FRAG);
        this._programs.dye = createProgram(gl, QUAD_VERT, DYE_FRAG);
        this._programs.divergence = createProgram(gl, QUAD_VERT, DIVERGENCE_FRAG);
        this._programs.pressure = createProgram(gl, QUAD_VERT, PRESSURE_FRAG);
        this._programs.gradient = createProgram(gl, QUAD_VERT, GRADIENT_FRAG);
        this._programs.vorticity = createProgram(gl, QUAD_VERT, VORTICITY_FRAG);
        this._programs.render = createProgram(gl, QUAD_VERT, RENDER_FRAG);
    }

    /**
     * Creates all framebuffer objects.
     * @private
     */
    _createFBOs() {
        const gl = this.gl;
        const { gridSize, dyeSize } = this.config;
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

        // Dye field (double-buffered, higher resolution)
        this._fbos.dye = new DoubleFBO(
            gl, dyeSize, dyeSize, DYE_FORMAT
        );
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
     *
     * @param {number} dt - Delta time in seconds
     * @param {Array} [forces=[]] - Array of force objects
     */
    step(dt, forces = []) {
        if (!this._initialized || this._paused) {
            return;
        }

        const gl = this.gl;

        // Cap dt to prevent instability (30fps minimum)
        dt = Math.min(dt, 0.033);

        // Accumulate simulation time
        this._time += dt;

        const { gridSize } = this.config;
        const texelSize = [1.0 / gridSize, 1.0 / gridSize];
        const aspectRatio = this.canvas.width / this.canvas.height;

        // Combine external forces with pending forces
        const allForces = [...forces, ...this._pendingForces];
        this._pendingForces = [];

        // Get pending dye and clear
        const allDye = [...this._pendingDye];
        this._pendingDye = [];

        // =================================================================
        // PASS 1: ADVECT VELOCITY (self-advection)
        // =================================================================
        this._advect(
            this._fbos.velocity,
            this._fbos.velocity,
            dt,
            this.config.velocityDissipation,
            texelSize
        );

        // =================================================================
        // PASS 2: APPLY FORCES
        // =================================================================
        for (const force of allForces) {
            this._applyForce(force, texelSize, aspectRatio);
        }

        // =================================================================
        // PASS 3: APPLY DYE
        // =================================================================
        for (const dye of allDye) {
            this._applyDye(dye, aspectRatio);
        }

        // =================================================================
        // PASS 4: COMPUTE DIVERGENCE
        // =================================================================
        this._computeDivergence(texelSize);

        // =================================================================
        // PASS 5: PRESSURE SOLVE (Jacobi iteration)
        // =================================================================
        this._solvePressure();

        // =================================================================
        // PASS 6: GRADIENT SUBTRACTION (projection)
        // =================================================================
        this._subtractGradient();

        // =================================================================
        // PASS 7: VORTICITY CONFINEMENT
        // =================================================================
        if (this.config.curl > 0) {
            this._applyVorticity(dt, texelSize);
        }

        // =================================================================
        // PASS 8: ADVECT DYE
        // =================================================================
        const dyeSize = this.config.dyeSize;
        const dyeTexelSize = [1.0 / dyeSize, 1.0 / dyeSize];
        this._advectDye(dt, dyeTexelSize);

        // Note: Continuous noise injection removed - it creates ugly patterns
        // The fluid should evolve naturally from user interaction
    }

    /**
     * Advects a field using the velocity field.
     * @private
     */
    _advect(targetFBO, sourceFBO, dt, dissipation, texelSize) {
        const gl = this.gl;
        const program = this._programs.advect;

        program.use();

        // Bind velocity texture to unit 0
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this._fbos.velocity.texture);
        gl.uniform1i(program.uniforms.u_velocity, 0);

        // Bind source texture to unit 1 (may be same as velocity)
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, sourceFBO.texture);
        gl.uniform1i(program.uniforms.u_source, 1);

        // Set uniforms
        gl.uniform2f(program.uniforms.u_texelSize, texelSize[0], texelSize[1]);
        gl.uniform1f(program.uniforms.u_dt, dt);
        gl.uniform1f(program.uniforms.u_dissipation, dissipation);

        // Render to target
        targetFBO.bindWrite();
        this._drawQuad();
        targetFBO.swap();

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    /**
     * Applies a single force to the velocity field.
     * @private
     */
    _applyForce(force, texelSize, aspectRatio) {
        const gl = this.gl;
        const program = this._programs.forces;

        program.use();

        // Bind velocity texture
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this._fbos.velocity.texture);
        gl.uniform1i(program.uniforms.u_velocity, 0);

        // Set uniforms
        gl.uniform2f(program.uniforms.u_texelSize, texelSize[0], texelSize[1]);
        gl.uniform1f(program.uniforms.u_aspectRatio, aspectRatio);

        gl.uniform2f(
            program.uniforms.u_forcePosition,
            force.position[0],
            force.position[1]
        );
        gl.uniform2f(
            program.uniforms.u_forceDirection,
            force.direction[0] * (force.strength || this.config.forceStrength),
            force.direction[1] * (force.strength || this.config.forceStrength)
        );
        gl.uniform1f(
            program.uniforms.u_forceRadius,
            force.radius || this.config.forceRadius
        );

        gl.uniform1f(program.uniforms.u_time, this._time);
        gl.uniform1f(program.uniforms.u_noiseScale, this.config.noiseScale);
        gl.uniform1f(program.uniforms.u_noiseStrength, this.config.noiseStrength);

        // Render
        this._fbos.velocity.bindWrite();
        this._drawQuad();
        this._fbos.velocity.swap();

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    /**
     * Applies dye at a position.
     * @private
     */
    _applyDye(dye, aspectRatio) {
        const gl = this.gl;
        const program = this._programs.dye;

        program.use();

        // Bind dye texture
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this._fbos.dye.texture);
        gl.uniform1i(program.uniforms.u_dye, 0);

        // Set uniforms
        gl.uniform1f(program.uniforms.u_aspectRatio, aspectRatio);
        gl.uniform2f(
            program.uniforms.u_dyePosition,
            dye.position[0],
            dye.position[1]
        );
        gl.uniform3f(
            program.uniforms.u_dyeColor,
            dye.color[0],
            dye.color[1],
            dye.color[2]
        );
        gl.uniform1f(
            program.uniforms.u_dyeRadius,
            dye.radius || this.config.forceRadius
        );

        // Render
        this._fbos.dye.bindWrite();
        this._drawQuad();
        this._fbos.dye.swap();

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    /**
     * Computes divergence of velocity field.
     * @private
     */
    _computeDivergence(texelSize) {
        const gl = this.gl;
        const program = this._programs.divergence;

        program.use();

        // Bind velocity texture
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this._fbos.velocity.texture);
        gl.uniform1i(program.uniforms.u_velocity, 0);

        gl.uniform2f(program.uniforms.u_texelSize, texelSize[0], texelSize[1]);

        // Render to divergence FBO
        gl.bindFramebuffer(gl.FRAMEBUFFER, this._fbos.divergence.framebuffer);
        gl.viewport(0, 0, this._fbos.divergence.width, this._fbos.divergence.height);
        this._drawQuad();

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    /**
     * Iteratively solves pressure using Jacobi method.
     * @private
     */
    _solvePressure() {
        const gl = this.gl;
        const program = this._programs.pressure;

        program.use();

        // Bind divergence texture (constant during solve)
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this._fbos.divergence.texture);
        gl.uniform1i(program.uniforms.u_divergence, 1);

        // Clear pressure to start fresh (optional - can skip for faster convergence)
        // this._clearFBO(this._fbos.pressure);

        // Iterate
        for (let i = 0; i < this.config.pressureIterations; i++) {
            // Bind current pressure
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, this._fbos.pressure.texture);
            gl.uniform1i(program.uniforms.u_pressure, 0);

            // Render to write buffer
            this._fbos.pressure.bindWrite();
            this._drawQuad();
            this._fbos.pressure.swap();
        }

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    /**
     * Subtracts pressure gradient from velocity.
     * @private
     */
    _subtractGradient() {
        const gl = this.gl;
        const program = this._programs.gradient;

        program.use();

        // Bind pressure texture
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this._fbos.pressure.texture);
        gl.uniform1i(program.uniforms.u_pressure, 0);

        // Bind velocity texture
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this._fbos.velocity.texture);
        gl.uniform1i(program.uniforms.u_velocity, 1);

        // Render
        this._fbos.velocity.bindWrite();
        this._drawQuad();
        this._fbos.velocity.swap();

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    /**
     * Applies vorticity confinement to amplify vortices.
     * @private
     */
    _applyVorticity(dt, texelSize) {
        const gl = this.gl;
        const program = this._programs.vorticity;

        program.use();

        // Bind velocity texture
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this._fbos.velocity.texture);
        gl.uniform1i(program.uniforms.u_velocity, 0);

        // Set uniforms
        gl.uniform2f(program.uniforms.u_texelSize, texelSize[0], texelSize[1]);
        gl.uniform1f(program.uniforms.u_curl, this.config.curl);
        gl.uniform1f(program.uniforms.u_dt, dt);

        // Render
        this._fbos.velocity.bindWrite();
        this._drawQuad();
        this._fbos.velocity.swap();

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    /**
     * Advects dye field using velocity.
     * @private
     */
    _advectDye(dt, texelSize) {
        const gl = this.gl;
        const program = this._programs.advect;

        program.use();

        // Bind velocity texture (for advection lookup)
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this._fbos.velocity.texture);
        gl.uniform1i(program.uniforms.u_velocity, 0);

        // Bind dye texture as source
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this._fbos.dye.texture);
        gl.uniform1i(program.uniforms.u_source, 1);

        // Set uniforms - scale velocity sampling for different resolution
        const velocityToGridScale = this.config.gridSize / this.config.dyeSize;
        gl.uniform2f(
            program.uniforms.u_texelSize,
            texelSize[0] * velocityToGridScale,
            texelSize[1] * velocityToGridScale
        );
        gl.uniform1f(program.uniforms.u_dt, dt);
        gl.uniform1f(program.uniforms.u_dissipation, this.config.dyeDissipation);

        // Render
        this._fbos.dye.bindWrite();
        this._drawQuad();
        this._fbos.dye.swap();

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    /**
     * Renders the fluid visualization to the canvas.
     */
    render() {
        if (!this._initialized) {
            return;
        }

        const gl = this.gl;
        const program = this._programs.render;

        // Render to canvas
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);

        program.use();

        // Bind velocity texture
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this._fbos.velocity.texture);
        gl.uniform1i(program.uniforms.u_velocity, 0);

        // Bind dye texture
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this._fbos.dye.texture);
        gl.uniform1i(program.uniforms.u_dye, 1);

        // Set uniforms - use velocity grid resolution, not canvas resolution
        // This is critical for correct vorticity computation
        gl.uniform2f(
            program.uniforms.u_resolution,
            this.config.gridSize,
            this.config.gridSize
        );
        gl.uniform1f(program.uniforms.u_time, this._time);
        gl.uniform1f(program.uniforms.u_intensity, this.config.intensity);

        // Color palette
        gl.uniform3fv(program.uniforms.u_colorBg, COLORS.bg);
        gl.uniform3fv(program.uniforms.u_colorPrimary, COLORS.primary);
        gl.uniform3fv(program.uniforms.u_colorSecondary, COLORS.secondary);
        gl.uniform3fv(program.uniforms.u_colorAccent, COLORS.accent);

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
     * @param {number} [radius] - Dye radius (default from config)
     */
    addDye(position, color, radius) {
        this._pendingDye.push({
            position,
            color,
            radius: radius || this.config.forceRadius
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
     * Adds random splats (public API for UI).
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

            // Apply force (velocity splat)
            this._applyForce({
                position: [x, y],
                direction: [dx, dy]
            }, null, aspectRatio);

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
