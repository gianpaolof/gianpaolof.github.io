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
 * Uses manual bilinear filtering for higher quality (like Pavel).
 *
 * IMPORTANT: u_texelSize is for velocity lookup/backtrace (1/gridSize)
 *            u_sourceTexelSize is for sampling the source texture (could be 1/dyeSize)
 */
const ADVECT_FRAG = `#version 300 es
precision highp float;

uniform sampler2D u_velocity;
uniform sampler2D u_source;
uniform vec2 u_texelSize;        // For velocity lookup and backtrace step (1/gridSize)
uniform vec2 u_sourceTexelSize;  // For sampling source texture (may differ for dye)
uniform float u_dt;
uniform float u_dissipation;

in vec2 v_texCoord;
out vec4 fragColor;

// Manual bilinear filtering for better quality (CRITICAL for smooth advection!)
vec4 bilerp(sampler2D sam, vec2 uv, vec2 tsize) {
    vec2 st = uv / tsize - 0.5;
    vec2 iuv = floor(st);
    vec2 fuv = fract(st);
    vec4 a = texture(sam, (iuv + vec2(0.5, 0.5)) * tsize);
    vec4 b = texture(sam, (iuv + vec2(1.5, 0.5)) * tsize);
    vec4 c = texture(sam, (iuv + vec2(0.5, 1.5)) * tsize);
    vec4 d = texture(sam, (iuv + vec2(1.5, 1.5)) * tsize);
    return mix(mix(a, b, fuv.x), mix(c, d, fuv.x), fuv.y);
}

void main() {
    vec2 velocity = texture(u_velocity, v_texCoord).xy;
    // Backtrace uses velocity-scale texelSize
    vec2 coord = v_texCoord - u_dt * velocity * u_texelSize;

    // USE BILINEAR FILTERING with SOURCE texture's texelSize!
    vec4 result = bilerp(u_source, coord, u_sourceTexelSize);

    // Pavel's dissipation formula: divide instead of multiply
    float decay = 1.0 + u_dissipation * u_dt;
    fragColor = result / decay;
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
 * Curl shader - computes vorticity (separate pass like Pavel).
 */
const CURL_FRAG = `#version 300 es
precision highp float;

uniform sampler2D u_velocity;
uniform vec2 u_texelSize;

in vec2 v_texCoord;
out float fragColor;

void main() {
    float L = texture(u_velocity, v_texCoord - vec2(u_texelSize.x, 0.0)).y;
    float R = texture(u_velocity, v_texCoord + vec2(u_texelSize.x, 0.0)).y;
    float T = texture(u_velocity, v_texCoord + vec2(0.0, u_texelSize.y)).x;
    float B = texture(u_velocity, v_texCoord - vec2(0.0, u_texelSize.y)).x;
    float vorticity = R - L - T + B;
    fragColor = 0.5 * vorticity;
}
`;

/**
 * Vorticity confinement shader (uses precomputed curl).
 * Adds rotational force to amplify existing swirls.
 * EXACTLY like Pavel's implementation.
 */
const VORTICITY_FRAG = `#version 300 es
precision highp float;

uniform sampler2D u_velocity;
uniform sampler2D u_curl;
uniform vec2 u_texelSize;
uniform float u_curlStrength;
uniform float u_dt;

in vec2 v_texCoord;
out vec2 fragColor;

void main() {
    float L = texture(u_curl, v_texCoord - vec2(u_texelSize.x, 0.0)).x;
    float R = texture(u_curl, v_texCoord + vec2(u_texelSize.x, 0.0)).x;
    float T = texture(u_curl, v_texCoord + vec2(0.0, u_texelSize.y)).x;
    float B = texture(u_curl, v_texCoord - vec2(0.0, u_texelSize.y)).x;
    float C = texture(u_curl, v_texCoord).x;

    vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
    force /= length(force) + 0.0001;
    force *= u_curlStrength * C;
    force.y *= -1.0;

    vec2 velocity = texture(u_velocity, v_texCoord).xy;
    velocity += force * u_dt;
    velocity = min(max(velocity, -1000.0), 1000.0);
    fragColor = velocity;
}
`;

/**
 * Display shader - renders dye field with shading, bloom, sunrays, and dithering.
 * Pavel-style rendering with 3D lighting effect.
 */
const DISPLAY_FRAG = `#version 300 es
precision highp float;

uniform sampler2D u_texture;
uniform sampler2D u_bloom;
uniform sampler2D u_sunrays;
uniform vec2 u_texelSize;
uniform float u_bloomIntensity;
uniform bool u_bloomEnabled;
uniform bool u_shadingEnabled;
uniform bool u_sunraysEnabled;

in vec2 v_texCoord;
out vec4 fragColor;

// Gamma correction like Pavel (sRGB)
vec3 linearToGamma(vec3 color) {
    color = max(color, vec3(0.0));
    return max(1.055 * pow(color, vec3(0.416666667)) - 0.055, vec3(0.0));
}

void main() {
    vec3 c = texture(u_texture, v_texCoord).rgb;

    // SHADING - creates 3D "oily" effect from color gradients (like Pavel)
    // STRONGER contrast than before!
    if (u_shadingEnabled) {
        vec3 lc = texture(u_texture, v_texCoord - vec2(u_texelSize.x, 0.0)).rgb;
        vec3 rc = texture(u_texture, v_texCoord + vec2(u_texelSize.x, 0.0)).rgb;
        vec3 tc = texture(u_texture, v_texCoord + vec2(0.0, u_texelSize.y)).rgb;
        vec3 bc = texture(u_texture, v_texCoord - vec2(0.0, u_texelSize.y)).rgb;

        float dx = length(rc) - length(lc);
        float dy = length(tc) - length(bc);

        // Pavel's exact normal and lighting formula
        vec3 n = normalize(vec3(dx, dy, length(u_texelSize)));
        vec3 l = vec3(0.0, 0.0, 1.0);
        float diffuse = clamp(dot(n, l) + 0.7, 0.7, 1.0);
        c *= diffuse;
    }

    // SUNRAYS first (Pavel's order: shading -> sunrays -> bloom)
    float sunrays = 1.0;
    if (u_sunraysEnabled) {
        sunrays = texture(u_sunrays, v_texCoord).r;
        c *= sunrays;  // Pavel's exact formula: pure multiply
    }

    // BLOOM - additive glow (also modulated by sunrays like Pavel)
    if (u_bloomEnabled) {
        vec3 bloom = texture(u_bloom, v_texCoord).rgb * u_bloomIntensity;
        if (u_sunraysEnabled) {
            bloom *= sunrays;  // Pavel also multiplies bloom by sunrays
        }
        c += bloom;
    }

    // Gamma correction for final output (do BEFORE dithering)
    c = linearToGamma(c);

    // DITHERING - better algorithm (triangular distribution)
    // Reduces banding artifacts in gradients
    vec2 uv = v_texCoord * vec2(1920.0, 1080.0);
    float noise = fract(52.9829189 * fract(dot(uv, vec2(0.06711056, 0.00583715))));
    c += (noise - 0.5) / 255.0;

    // Output with alpha based on brightness
    float a = max(c.r, max(c.g, c.b));
    fragColor = vec4(c, a);
}
`;

/**
 * Bloom prefilter - extracts bright areas with soft knee.
 */
const BLOOM_PREFILTER_FRAG = `#version 300 es
precision highp float;

uniform sampler2D u_texture;
uniform vec3 u_curve;  // threshold, knee, knee*2
uniform float u_threshold;

in vec2 v_texCoord;
out vec4 fragColor;

void main() {
    vec3 color = texture(u_texture, v_texCoord).rgb;

    // Soft knee curve
    float brightness = max(max(color.r, color.g), color.b);
    float soft = brightness - u_curve.x + u_curve.y;
    soft = clamp(soft, 0.0, u_curve.z);
    soft = soft * soft / (4.0 * u_curve.y + 0.00001);

    float contribution = max(soft, brightness - u_threshold);
    contribution /= max(brightness, 0.00001);

    fragColor = vec4(color * contribution, 1.0);
}
`;

/**
 * Gaussian blur shader for bloom.
 */
const BLUR_FRAG = `#version 300 es
precision highp float;

uniform sampler2D u_texture;
uniform vec2 u_texelSize;
uniform vec2 u_direction;

in vec2 v_texCoord;
out vec4 fragColor;

void main() {
    vec4 color = vec4(0.0);
    vec2 off1 = vec2(1.3846153846) * u_direction * u_texelSize;
    vec2 off2 = vec2(3.2307692308) * u_direction * u_texelSize;

    color += texture(u_texture, v_texCoord) * 0.2270270270;
    color += texture(u_texture, v_texCoord + off1) * 0.3162162162;
    color += texture(u_texture, v_texCoord - off1) * 0.3162162162;
    color += texture(u_texture, v_texCoord + off2) * 0.0702702703;
    color += texture(u_texture, v_texCoord - off2) * 0.0702702703;

    fragColor = color;
}
`;

/**
 * Bloom final composite - combines bloom mips.
 */
const BLOOM_FINAL_FRAG = `#version 300 es
precision highp float;

uniform sampler2D u_texture;
uniform float u_intensity;

in vec2 v_texCoord;
out vec4 fragColor;

void main() {
    vec3 color = texture(u_texture, v_texCoord).rgb * u_intensity;
    fragColor = vec4(color, 1.0);
}
`;

/**
 * Copy shader - simple texture copy.
 */
const COPY_FRAG = `#version 300 es
precision highp float;

uniform sampler2D u_texture;

in vec2 v_texCoord;
out vec4 fragColor;

void main() {
    fragColor = texture(u_texture, v_texCoord);
}
`;

/**
 * Sunrays mask shader - converts dye brightness to mask.
 * Pavel's technique: where there's bright fluid, we create light sources.
 */
const SUNRAYS_MASK_FRAG = `#version 300 es
precision highp float;

uniform sampler2D u_texture;

in vec2 v_texCoord;
out vec4 fragColor;

void main() {
    vec4 c = texture(u_texture, v_texCoord);
    float brightness = max(c.r, max(c.g, c.b));
    // Higher brightness = more light contribution
    // We want bright fluid to emit light rays
    fragColor = vec4(vec3(brightness), 1.0);
}
`;

/**
 * Sunrays shader - volumetric light scattering from screen center.
 * Based on GPU Gems 3 - Volumetric Light Scattering.
 */
const SUNRAYS_FRAG = `#version 300 es
precision highp float;

uniform sampler2D u_texture;
uniform float u_weight;

in vec2 v_texCoord;
out vec4 fragColor;

#define ITERATIONS 16

void main() {
    float Density = 0.3;
    float Decay = 0.95;
    float Exposure = 0.7;

    vec2 coord = v_texCoord;
    vec2 dir = v_texCoord - 0.5; // Direction from center
    dir *= 1.0 / float(ITERATIONS) * Density;

    float illuminationDecay = 1.0;
    float color = texture(u_texture, v_texCoord).r;

    for (int i = 0; i < ITERATIONS; i++) {
        coord -= dir;
        float sample_ = texture(u_texture, coord).r;
        sample_ *= illuminationDecay * u_weight;
        color += sample_;
        illuminationDecay *= Decay;
    }

    fragColor = vec4(vec3(color * Exposure), 1.0);
}
`;

/**
 * Clear shader - scales previous pressure by coefficient (Pavel's approach).
 * This helps Jacobi solver converge faster by starting closer to solution.
 */
const CLEAR_FRAG = `#version 300 es
precision mediump float;

uniform sampler2D u_texture;
uniform float u_value;

in vec2 v_texCoord;
out float fragColor;

void main() {
    // Sample previous pressure and scale it (Pavel uses 0.8)
    // This keeps 80% of previous pressure for faster convergence
    fragColor = u_value * texture(u_texture, v_texCoord).r;
}
`;

/**
 * Splat shader - injects color at a position.
 */
const SPLAT_FRAG = `#version 300 es
precision highp float;

uniform sampler2D u_target;
uniform vec2 u_point;
uniform vec3 u_color;
uniform float u_radius;
uniform float u_aspectRatio;

in vec2 v_texCoord;
out vec4 fragColor;

void main() {
    vec2 p = v_texCoord - u_point;
    p.x *= u_aspectRatio;

    float splat = exp(-dot(p, p) / u_radius);
    vec3 base = texture(u_target, v_texCoord).rgb;

    fragColor = vec4(base + u_color * splat, 1.0);
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
    gridSize: 128,              // SIM_RESOLUTION like Pavel
    dyeSize: 1024,              // DYE_RESOLUTION like Pavel (high res!)
    pressureIterations: 20,
    pressure: 0.8,              // Like Pavel - pressure coefficient
    velocityDissipation: 0.2,   // Like Pavel - low = persists longer
    dyeDissipation: 1.0,        // Like Pavel - no dissipation (1.0 = none)
    curl: 30,                   // Like Pavel - vorticity strength
    // Splat settings - CRITICAL for visuals (Pavel: 0.25/100 = 0.0025)
    splatRadius: 0.0025,        // Like Pavel
    splatForce: 6000,           // Like Pavel
    // Legacy force settings (for noise)
    forceRadius: 0.0025,
    forceStrength: 6000,
    noiseScale: 4.0,
    noiseStrength: 0.0,
    intensity: 1.0,
    // Bloom settings - Like Pavel
    bloomEnabled: true,
    bloomIntensity: 0.8,
    bloomThreshold: 0.6,
    bloomSoftKnee: 0.7,
    bloomIterations: 8,
    // Sunrays - KEY visual effect from Pavel!
    sunraysEnabled: true,
    sunraysResolution: 196,
    sunraysWeight: 1.0,
    // Shading
    shadingEnabled: true,       // 3D effect like Pavel
    // Color settings
    colorUpdateSpeed: 10
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
     * Creates all shader programs.
     * @private
     */
    _createPrograms() {
        const gl = this.gl;

        // Simulation programs
        this._programs.advect = createProgram(gl, QUAD_VERT, ADVECT_FRAG);
        this._programs.forces = createProgram(gl, QUAD_VERT, FORCES_FRAG);
        this._programs.dye = createProgram(gl, QUAD_VERT, DYE_FRAG);
        this._programs.divergence = createProgram(gl, QUAD_VERT, DIVERGENCE_FRAG);
        this._programs.pressure = createProgram(gl, QUAD_VERT, PRESSURE_FRAG);
        this._programs.gradient = createProgram(gl, QUAD_VERT, GRADIENT_FRAG);
        this._programs.curl = createProgram(gl, QUAD_VERT, CURL_FRAG);
        this._programs.vorticity = createProgram(gl, QUAD_VERT, VORTICITY_FRAG);

        // Rendering programs
        this._programs.display = createProgram(gl, QUAD_VERT, DISPLAY_FRAG);
        this._programs.copy = createProgram(gl, QUAD_VERT, COPY_FRAG);
        this._programs.splat = createProgram(gl, QUAD_VERT, SPLAT_FRAG);
        this._programs.clear = createProgram(gl, QUAD_VERT, CLEAR_FRAG);

        // Bloom programs
        this._programs.bloomPrefilter = createProgram(gl, QUAD_VERT, BLOOM_PREFILTER_FRAG);
        this._programs.blur = createProgram(gl, QUAD_VERT, BLUR_FRAG);
        this._programs.bloomFinal = createProgram(gl, QUAD_VERT, BLOOM_FINAL_FRAG);

        // Sunrays programs - Pavel's volumetric light effect
        this._programs.sunraysMask = createProgram(gl, QUAD_VERT, SUNRAYS_MASK_FRAG);
        this._programs.sunrays = createProgram(gl, QUAD_VERT, SUNRAYS_FRAG);
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

        // Bloom FBOs - create pyramid of decreasing resolution
        this._createBloomFBOs();

        // Sunrays FBOs - Pavel's volumetric light effect
        this._createSunraysFBOs();
    }

    /**
     * Creates bloom framebuffer pyramid.
     * @private
     */
    _createBloomFBOs() {
        const gl = this.gl;
        const { bloomIterations } = this.config;
        const { DYE_FORMAT } = this.formats;

        // Start with half resolution of canvas
        let width = Math.floor(this.canvas.width / 2);
        let height = Math.floor(this.canvas.height / 2);

        // Minimum size
        const minSize = 32;

        this._bloomFBOs = [];
        this._bloomTempFBOs = []; // Temp FBOs for ping-pong blur at each level

        for (let i = 0; i < bloomIterations; i++) {
            if (width < minSize || height < minSize) break;

            const texture = createTexture(gl, width, height, DYE_FORMAT);
            this._bloomFBOs.push({
                texture,
                framebuffer: createFramebuffer(gl, texture),
                width,
                height
            });

            // Create matching temp FBO for this level
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

        // Keep legacy _bloomTemp for compatibility (points to first temp)
        if (this._bloomTempFBOs.length > 0) {
            this._bloomTemp = this._bloomTempFBOs[0];
        }
    }

    /**
     * Creates sunrays framebuffers for volumetric light effect.
     * @private
     */
    _createSunraysFBOs() {
        const gl = this.gl;
        const { sunraysResolution } = this.config;
        const { DYE_FORMAT } = this.formats;

        // Sunrays FBO at lower resolution for performance
        const res = sunraysResolution || 196;

        const sunraysTexture = createTexture(gl, res, res, DYE_FORMAT);
        this._sunraysFBO = {
            texture: sunraysTexture,
            framebuffer: createFramebuffer(gl, sunraysTexture),
            width: res,
            height: res
        };

        // Temp FBO for sunrays blur
        const sunraysTempTexture = createTexture(gl, res, res, DYE_FORMAT);
        this._sunraysTemp = {
            texture: sunraysTempTexture,
            framebuffer: createFramebuffer(gl, sunraysTempTexture),
            width: res,
            height: res
        };
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
     * Order matches Pavel's implementation.
     *
     * @param {number} dt - Delta time in seconds
     * @param {Array} [forces=[]] - Array of force objects
     */
    step(dt, forces = []) {
        if (!this._initialized || this._paused) {
            return;
        }

        const gl = this.gl;

        // Cap dt to prevent instability
        dt = Math.min(dt, 0.016666);

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
        // PASS 1: APPLY INPUT FORCES (splats)
        // =================================================================
        for (const force of allForces) {
            this._applyForce(force, texelSize, aspectRatio);
        }

        // =================================================================
        // PASS 2: APPLY INPUT DYE (colors)
        // =================================================================
        for (const dye of allDye) {
            this._applyDye(dye, aspectRatio);
        }

        // =================================================================
        // PASS 3: COMPUTE CURL (vorticity scalar field)
        // =================================================================
        if (this.config.curl > 0) {
            this._computeCurl(texelSize);
        }

        // =================================================================
        // PASS 4: APPLY VORTICITY CONFINEMENT
        // =================================================================
        if (this.config.curl > 0) {
            this._applyVorticity(dt, texelSize);
        }

        // =================================================================
        // PASS 5: COMPUTE DIVERGENCE
        // =================================================================
        this._computeDivergence(texelSize);

        // =================================================================
        // PASS 6: SCALE PRESSURE (Pavel's approach for faster convergence)
        // =================================================================
        this._clearPressure();

        // =================================================================
        // PASS 7: PRESSURE SOLVE (Jacobi iteration)
        // =================================================================
        this._solvePressure();

        // =================================================================
        // PASS 8: GRADIENT SUBTRACTION (projection)
        // =================================================================
        this._subtractGradient();

        // =================================================================
        // PASS 9: ADVECT VELOCITY (self-advection) - AFTER projection!
        // =================================================================
        this._advect(
            this._fbos.velocity,
            this._fbos.velocity,
            dt,
            this.config.velocityDissipation,
            texelSize
        );

        // =================================================================
        // PASS 10: ADVECT DYE
        // =================================================================
        const dyeSize = this.config.dyeSize;
        const dyeTexelSize = [1.0 / dyeSize, 1.0 / dyeSize];
        this._advectDye(dt, dyeTexelSize);
    }

    /**
     * Advects a field using the velocity field.
     * @private
     * @param {DoubleFBO} targetFBO - Target FBO to write to
     * @param {DoubleFBO} sourceFBO - Source FBO to sample from
     * @param {number} dt - Delta time
     * @param {number} dissipation - Dissipation rate
     * @param {number[]} velocityTexelSize - Texel size for velocity (1/gridSize)
     * @param {number[]} [sourceTexelSize] - Texel size for source texture (defaults to velocityTexelSize)
     */
    _advect(targetFBO, sourceFBO, dt, dissipation, velocityTexelSize, sourceTexelSize = null) {
        const gl = this.gl;
        const program = this._programs.advect;

        // If no source texel size provided, use velocity texel size
        const srcTexelSize = sourceTexelSize || velocityTexelSize;

        program.use();

        // Bind velocity texture to unit 0
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this._fbos.velocity.texture);
        gl.uniform1i(program.uniforms.u_velocity, 0);

        // Bind source texture to unit 1 (may be same as velocity)
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, sourceFBO.texture);
        gl.uniform1i(program.uniforms.u_source, 1);

        // Set uniforms - CRITICAL: use correct texelSize for each purpose!
        // u_texelSize: for velocity backtrace step (1/gridSize)
        // u_sourceTexelSize: for bilerp sampling source texture
        gl.uniform2f(program.uniforms.u_texelSize, velocityTexelSize[0], velocityTexelSize[1]);
        gl.uniform2f(program.uniforms.u_sourceTexelSize, srcTexelSize[0], srcTexelSize[1]);
        gl.uniform1f(program.uniforms.u_dt, dt);
        gl.uniform1f(program.uniforms.u_dissipation, dissipation);

        // Render to target
        targetFBO.bindWrite();
        this._drawQuad();
        targetFBO.swap();

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    /**
     * Applies a single force to the velocity field using splat shader (like Pavel).
     * @private
     */
    _applyForce(force, texelSize, aspectRatio) {
        const gl = this.gl;
        const program = this._programs.splat;

        program.use();

        // Bind velocity texture as target
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this._fbos.velocity.texture);
        gl.uniform1i(program.uniforms.u_target, 0);

        // Position
        gl.uniform2f(program.uniforms.u_point, force.position[0], force.position[1]);

        // Pass velocity delta as "color" (like Pavel does)
        const dx = force.direction[0];
        const dy = force.direction[1];
        gl.uniform3f(program.uniforms.u_color, dx, dy, 0.0);

        // Pass radius directly - aspect correction is done in shader via p.x
        const radius = force.radius || this.config.forceRadius;
        gl.uniform1f(program.uniforms.u_radius, radius);
        gl.uniform1f(program.uniforms.u_aspectRatio, aspectRatio);

        // Render to velocity
        this._fbos.velocity.bindWrite();
        this._drawQuad();
        this._fbos.velocity.swap();

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    /**
     * Applies dye at a position using splat shader.
     * @private
     */
    _applyDye(dye, aspectRatio) {
        // Use the splat method for consistent dye application
        this._applySplat(
            [dye.position[0], dye.position[1]],
            dye.color,
            dye.radius || this.config.splatRadius,
            aspectRatio
        );
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
     * Computes curl (vorticity) of the velocity field.
     * @private
     */
    _computeCurl(texelSize) {
        const gl = this.gl;
        const program = this._programs.curl;

        program.use();

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this._fbos.velocity.texture);
        gl.uniform1i(program.uniforms.u_velocity, 0);

        gl.uniform2f(program.uniforms.u_texelSize, texelSize[0], texelSize[1]);

        gl.bindFramebuffer(gl.FRAMEBUFFER, this._fbos.curl.framebuffer);
        gl.viewport(0, 0, this._fbos.curl.width, this._fbos.curl.height);
        this._drawQuad();

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    /**
     * Applies vorticity confinement using precomputed curl.
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

        // Bind curl texture
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this._fbos.curl.texture);
        gl.uniform1i(program.uniforms.u_curl, 1);

        // Set uniforms
        gl.uniform2f(program.uniforms.u_texelSize, texelSize[0], texelSize[1]);
        gl.uniform1f(program.uniforms.u_curlStrength, this.config.curl);
        gl.uniform1f(program.uniforms.u_dt, dt);

        // Render
        this._fbos.velocity.bindWrite();
        this._drawQuad();
        this._fbos.velocity.swap();

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    /**
     * Advects dye field using velocity.
     * Uses velocity-scale texelSize for backtrace, dye-scale for sampling.
     * @private
     */
    _advectDye(dt, dyeTexelSize) {
        // Velocity texelSize for backtrace calculation
        const { gridSize } = this.config;
        const velocityTexelSize = [1.0 / gridSize, 1.0 / gridSize];

        // Use the generalized _advect with both texel sizes
        this._advect(
            this._fbos.dye,
            this._fbos.dye,
            dt,
            this.config.dyeDissipation,
            velocityTexelSize,  // For backtrace step
            dyeTexelSize        // For bilerp sampling (1/dyeSize)
        );
    }

    /**
     * Renders the fluid visualization to the canvas.
     * Uses dye field with bloom and sunrays effects.
     */
    render() {
        if (!this._initialized) {
            return;
        }

        const gl = this.gl;
        const { bloomEnabled, bloomIntensity, sunraysEnabled, sunraysWeight } = this.config;

        // Apply bloom if enabled
        if (bloomEnabled && this._bloomFBOs && this._bloomFBOs.length > 0) {
            this._applyBloom();
        }

        // Apply sunrays if enabled - Pavel's key visual effect!
        if (sunraysEnabled && this._sunraysFBO) {
            this._applySunrays();
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
        if (bloomEnabled && this._bloomFBOs && this._bloomFBOs.length > 0) {
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, this._bloomFBOs[0].texture);
            gl.uniform1i(program.uniforms.u_bloom, 1);
        }

        // Bind sunrays texture if enabled
        if (sunraysEnabled && this._sunraysFBO) {
            gl.activeTexture(gl.TEXTURE2);
            gl.bindTexture(gl.TEXTURE_2D, this._sunraysFBO.texture);
            gl.uniform1i(program.uniforms.u_sunrays, 2);
        }

        // Debug: log uniform values periodically
        if (Math.random() < 0.001) {
            console.log('Render uniforms:', { bloomIntensity, bloomEnabled, sunraysEnabled, sunraysWeight });
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
     * Applies multi-pass bloom effect.
     * @private
     */
    _applyBloom() {
        const gl = this.gl;
        const { bloomThreshold, bloomSoftKnee, bloomIntensity } = this.config;

        // Number of blur iterations per level (Pavel does multiple for smoother bloom)
        const BLUR_ITERATIONS = 2;

        // Calculate soft knee curve
        const knee = bloomThreshold * bloomSoftKnee;
        const curve = [bloomThreshold - knee, knee * 2, 0.25 / (knee + 0.00001)];

        // Pass 1: Prefilter - extract bright areas into first bloom FBO
        const prefilterProgram = this._programs.bloomPrefilter;
        prefilterProgram.use();

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this._fbos.dye.texture);
        gl.uniform1i(prefilterProgram.uniforms.u_texture, 0);
        gl.uniform3f(prefilterProgram.uniforms.u_curve, curve[0], curve[1], curve[2]);
        gl.uniform1f(prefilterProgram.uniforms.u_threshold, bloomThreshold);

        gl.bindFramebuffer(gl.FRAMEBUFFER, this._bloomFBOs[0].framebuffer);
        gl.viewport(0, 0, this._bloomFBOs[0].width, this._bloomFBOs[0].height);
        this._drawQuad();

        // Pass 2: Downsample and blur at each pyramid level
        const blurProgram = this._programs.blur;
        blurProgram.use();

        let lastSource = this._bloomFBOs[0];

        for (let i = 0; i < this._bloomFBOs.length; i++) {
            const level = this._bloomFBOs[i];
            const temp = this._bloomTempFBOs[i];
            const texelSize = [1.0 / level.width, 1.0 / level.height];

            gl.viewport(0, 0, level.width, level.height);
            gl.uniform2f(blurProgram.uniforms.u_texelSize, texelSize[0], texelSize[1]);

            // For levels > 0, first copy from previous level (downsample)
            if (i > 0) {
                // Use copy program or just blur from previous level
                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_2D, lastSource.texture);
                gl.uniform1i(blurProgram.uniforms.u_texture, 0);
                gl.uniform2f(blurProgram.uniforms.u_direction, 1.0, 0.0);
                gl.bindFramebuffer(gl.FRAMEBUFFER, temp.framebuffer);
                this._drawQuad();

                gl.bindTexture(gl.TEXTURE_2D, temp.texture);
                gl.uniform2f(blurProgram.uniforms.u_direction, 0.0, 1.0);
                gl.bindFramebuffer(gl.FRAMEBUFFER, level.framebuffer);
                this._drawQuad();
            }

            // Multiple blur iterations for smoother bloom (Pavel's approach)
            for (let iter = 0; iter < BLUR_ITERATIONS; iter++) {
                // Horizontal blur: level → temp
                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_2D, level.texture);
                gl.uniform1i(blurProgram.uniforms.u_texture, 0);
                gl.uniform2f(blurProgram.uniforms.u_direction, 1.0, 0.0);
                gl.bindFramebuffer(gl.FRAMEBUFFER, temp.framebuffer);
                this._drawQuad();

                // Vertical blur: temp → level
                gl.bindTexture(gl.TEXTURE_2D, temp.texture);
                gl.uniform2f(blurProgram.uniforms.u_direction, 0.0, 1.0);
                gl.bindFramebuffer(gl.FRAMEBUFFER, level.framebuffer);
                this._drawQuad();
            }

            lastSource = level;
        }

        // Pass 3: Upsample and combine bloom levels (additive blending)
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);

        for (let i = this._bloomFBOs.length - 1; i > 0; i--) {
            const target = this._bloomFBOs[i - 1];
            const source = this._bloomFBOs[i];

            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, source.texture);

            gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
            gl.viewport(0, 0, target.width, target.height);
            this._drawQuad();
        }

        gl.disable(gl.BLEND);
    }

    /**
     * Applies sunrays (volumetric light scattering) effect.
     * Pavel's signature visual effect - creates glowing light beams from center.
     * @private
     */
    _applySunrays() {
        const gl = this.gl;
        const { sunraysWeight } = this.config;

        // Step 1: Create mask from dye (bright areas become light sources)
        const maskProgram = this._programs.sunraysMask;
        maskProgram.use();

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this._fbos.dye.texture);
        gl.uniform1i(maskProgram.uniforms.u_texture, 0);

        gl.bindFramebuffer(gl.FRAMEBUFFER, this._sunraysTemp.framebuffer);
        gl.viewport(0, 0, this._sunraysTemp.width, this._sunraysTemp.height);
        this._drawQuad();

        // Step 2: Apply volumetric light scattering
        const sunraysProgram = this._programs.sunrays;
        sunraysProgram.use();

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this._sunraysTemp.texture);
        gl.uniform1i(sunraysProgram.uniforms.u_texture, 0);
        gl.uniform1f(sunraysProgram.uniforms.u_weight, sunraysWeight || 1.0);

        gl.bindFramebuffer(gl.FRAMEBUFFER, this._sunraysFBO.framebuffer);
        gl.viewport(0, 0, this._sunraysFBO.width, this._sunraysFBO.height);
        this._drawQuad();

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
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

        // Recreate bloom FBOs since they're based on canvas size
        if (this._initialized && this.config.bloomEnabled) {
            const gl = this.gl;
            // Cleanup old bloom FBOs
            if (this._bloomFBOs) {
                for (const fbo of this._bloomFBOs) {
                    gl.deleteTexture(fbo.texture);
                    gl.deleteFramebuffer(fbo.framebuffer);
                }
            }
            if (this._bloomTempFBOs) {
                for (const fbo of this._bloomTempFBOs) {
                    gl.deleteTexture(fbo.texture);
                    gl.deleteFramebuffer(fbo.framebuffer);
                }
            }
            // Recreate at new size
            this._createBloomFBOs();
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

        // Debug: log config changes
        for (const [key, value] of Object.entries(newConfig)) {
            if (this.config[key] !== value) {
                console.log(`Config: ${key} = ${value}`);
            }
        }

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

        // Destroy bloom FBOs
        if (this._bloomFBOs) {
            for (const fbo of this._bloomFBOs) {
                gl.deleteTexture(fbo.texture);
                gl.deleteFramebuffer(fbo.framebuffer);
            }
        }
        // Destroy bloom temp FBOs (one per pyramid level)
        if (this._bloomTempFBOs) {
            for (const fbo of this._bloomTempFBOs) {
                gl.deleteTexture(fbo.texture);
                gl.deleteFramebuffer(fbo.framebuffer);
            }
        }
        this._bloomTemp = null; // Was just a reference to _bloomTempFBOs[0]

        // Destroy sunrays FBOs
        if (this._sunraysFBO) {
            gl.deleteTexture(this._sunraysFBO.texture);
            gl.deleteFramebuffer(this._sunraysFBO.framebuffer);
        }
        if (this._sunraysTemp) {
            gl.deleteTexture(this._sunraysTemp.texture);
            gl.deleteFramebuffer(this._sunraysTemp.framebuffer);
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
