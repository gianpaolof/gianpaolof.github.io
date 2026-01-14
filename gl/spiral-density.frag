#version 300 es
precision highp float;

/**
 * Spiral Density Shader with Domain Warping
 *
 * Generates procedural spiral arm density for hurricane visualization.
 * Uses logarithmic spiral mathematics with domain warping for organic,
 * churning atmospheric effects that mimic real satellite imagery.
 */

uniform vec2 u_center;           // Hurricane center (normalized 0-1)
uniform float u_eyeRadius;       // Eye radius
uniform float u_maxRadius;       // Maximum influence radius
uniform float u_numArms;         // Number of spiral arms
uniform float u_tightness;       // Spiral tightness (how wound it is)
uniform float u_time;            // Animation time
uniform float u_rotation;        // Rotation direction (1 CCW, -1 CW)
uniform float u_aspectRatio;     // Canvas aspect ratio
uniform float u_armWidth;        // Width of spiral arms
uniform float u_noiseStrength;   // Cloud noise intensity
uniform float u_warpStrength;    // Domain warping intensity (0-1)

in vec2 v_texCoord;
out vec4 fragColor;

// ============================================================================
// NOISE FUNCTIONS
// ============================================================================

// Simple hash function for noise
float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

// Smooth 2D noise
float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);

    // Quintic interpolation for smoother results
    vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);

    // Four corners
    float a = hash(i + vec2(0.0, 0.0));
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));

    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Fractal Brownian Motion
float fbm(vec2 p, int octaves) {
    float value = 0.0;
    float amplitude = 0.5;
    float frequency = 1.0;
    float maxValue = 0.0;

    for (int i = 0; i < 6; i++) {
        if (i >= octaves) break;
        value += amplitude * noise(p * frequency);
        maxValue += amplitude;
        frequency *= 2.0;
        amplitude *= 0.5;
    }

    return value / maxValue;  // Normalize to 0-1
}

// ============================================================================
// DOMAIN WARPING
// ============================================================================

/**
 * Multi-layer domain warping for organic atmospheric turbulence.
 * Creates the "churning" effect seen in real hurricane satellite imagery.
 */
vec2 domainWarp(vec2 pos, float strength) {
    // Base warp - large scale atmospheric movement
    float time1 = u_time * 0.015;
    vec2 warp1 = vec2(
        fbm(pos * 2.0 + vec2(0.0, time1), 4),
        fbm(pos * 2.0 + vec2(5.2, 1.3) + time1, 4)
    ) - 0.5;  // Center around zero

    // Secondary warp - medium scale turbulence
    float time2 = u_time * 0.025;
    vec2 warp2 = vec2(
        fbm(pos * 4.0 + warp1 * 0.5 + vec2(1.7, 9.2) + time2, 3),
        fbm(pos * 4.0 + warp1 * 0.5 + vec2(8.3, 2.8) + time2, 3)
    ) - 0.5;

    // Tertiary warp - fine detail churning
    float time3 = u_time * 0.04;
    vec2 warp3 = vec2(
        fbm(pos * 8.0 + warp2 * 0.3 + time3, 2),
        fbm(pos * 8.0 + warp2 * 0.3 + vec2(3.1, 7.4) + time3, 2)
    ) - 0.5;

    // Combine warps with decreasing influence
    vec2 totalWarp = warp1 * 0.06 + warp2 * 0.03 + warp3 * 0.015;

    return pos + totalWarp * strength;
}

// ============================================================================
// SPIRAL ARM FUNCTIONS
// ============================================================================

/**
 * Computes density contribution from spiral arms.
 * Uses logarithmic spiral: r = a * e^(b * theta)
 */
float spiralArmDensity(float r, float theta) {
    // Logarithmic spiral coordinate
    float spiralPhase = theta - u_tightness * log(max(r / (u_eyeRadius * 0.5), 0.01));

    // Add rotation animation
    spiralPhase += u_time * 0.2 * u_rotation;

    // Wrap to arm spacing and find distance to nearest arm
    float armSpacing = 6.28318 / u_numArms;
    float toNearestArm = mod(spiralPhase + armSpacing * 0.5, armSpacing) - armSpacing * 0.5;

    // Gaussian profile for arm density
    float armWidthScaled = u_armWidth * (1.0 + r * 0.5);  // Arms widen outward
    float armDensity = exp(-toNearestArm * toNearestArm / (armWidthScaled * armWidthScaled));

    return armDensity;
}

/**
 * Secondary rainbands (thinner, more numerous)
 */
float secondaryBands(float r, float theta) {
    float spiralPhase = theta - u_tightness * 0.7 * log(max(r / (u_eyeRadius * 0.3), 0.01));
    spiralPhase += u_time * 0.25 * u_rotation + 0.5;

    float armSpacing = 6.28318 / (u_numArms * 2.0);
    float toNearestArm = mod(spiralPhase + armSpacing * 0.5, armSpacing) - armSpacing * 0.5;

    float bandWidth = u_armWidth * 0.5;
    return exp(-toNearestArm * toNearestArm / (bandWidth * bandWidth)) * 0.4;
}

// ============================================================================
// MAIN
// ============================================================================

void main() {
    // Position relative to hurricane center, aspect corrected
    vec2 pos = v_texCoord - u_center;
    pos.x *= u_aspectRatio;

    // Original radius for boundary checks (before warping)
    float originalR = length(pos);

    // Outside maximum radius: no density
    if (originalR > u_maxRadius * 1.2) {
        fragColor = vec4(0.0);
        return;
    }

    // =========================================================================
    // DOMAIN WARPING - Creates organic atmospheric churning
    // =========================================================================

    // Apply domain warping with distance-based falloff
    // Less warping near eye (more stable), more in outer bands
    float warpFalloff = smoothstep(u_eyeRadius * 0.8, u_eyeRadius * 2.0, originalR);
    warpFalloff *= smoothstep(u_maxRadius, u_maxRadius * 0.7, originalR);

    vec2 warpedPos = domainWarp(pos, u_warpStrength * warpFalloff);

    // Calculate warped polar coordinates
    float r = length(warpedPos);
    float theta = atan(warpedPos.y, warpedPos.x);

    // =========================================================================
    // RADIAL STRUCTURE
    // =========================================================================

    // Eye zone - clear center
    float eyeFade = smoothstep(u_eyeRadius * 0.6, u_eyeRadius * 1.5, r);

    // Eye wall - peak density ring around eye
    float eyeWallDist = abs(r - u_eyeRadius * 1.2);
    float eyeWall = exp(-eyeWallDist * eyeWallDist / 0.003) * 1.5;

    // Outer falloff (use original radius for clean boundary)
    float outerFade = 1.0 - smoothstep(u_maxRadius * 0.6, u_maxRadius, originalR);

    // =========================================================================
    // SPIRAL ARM STRUCTURE (using warped coordinates)
    // =========================================================================

    float primaryArms = spiralArmDensity(r, theta);
    float secondary = secondaryBands(r, theta);

    // =========================================================================
    // CLOUD TEXTURE OVERLAY
    // =========================================================================

    // Additional fine-detail cloud noise
    vec2 cloudCoord = warpedPos * 12.0 + u_time * 0.02;
    float clouds = fbm(cloudCoord, 4);
    clouds = clouds * 0.6 + 0.4;  // Remap to 0.4-1.0

    // =========================================================================
    // COMBINE ALL COMPONENTS
    // =========================================================================

    float density = 0.0;

    // Eye wall (always visible, brightest part)
    density += eyeWall;

    // Primary spiral arms
    density += primaryArms * 0.8 * eyeFade;

    // Secondary bands
    density += secondary * eyeFade;

    // Base cloud layer (fills in between arms)
    density += 0.12 * eyeFade;

    // Apply outer falloff
    density *= outerFade;

    // Modulate with cloud texture for organic look
    float noiseMix = (1.0 - u_noiseStrength) + u_noiseStrength * clouds;
    density *= noiseMix;

    // Clamp final density
    density = clamp(density, 0.0, 1.0);

    // Output density
    fragColor = vec4(density, density, density, density);
}
