#version 300 es
precision highp float;

/**
 * Spiral Density Shader
 *
 * Generates procedural spiral arm density for hurricane visualization.
 * Uses logarithmic spiral mathematics to create realistic hurricane band patterns.
 * This texture is composited with the dye field in the display shader.
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

in vec2 v_texCoord;
out vec4 fragColor;

// ============================================================================
// NOISE FUNCTIONS
// ============================================================================

// Simple hash function for noise
float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

// 2D noise
float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);

    // Smooth interpolation
    vec2 u = f * f * (3.0 - 2.0 * f);

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

    for (int i = 0; i < 6; i++) {
        if (i >= octaves) break;
        value += amplitude * noise(p * frequency);
        frequency *= 2.0;
        amplitude *= 0.5;
    }

    return value;
}

// ============================================================================
// SPIRAL ARM FUNCTIONS
// ============================================================================

/**
 * Computes density contribution from spiral arms.
 * Uses logarithmic spiral: r = a * e^(b * theta)
 * Inverse: theta_spiral = log(r/a) / b
 */
float spiralArmDensity(vec2 pos, float r, float theta) {
    // Logarithmic spiral coordinate
    // The "expected" angle for a point at distance r on the spiral
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
 * Computes secondary rainbands (thinner, more numerous)
 */
float secondaryBands(vec2 pos, float r, float theta) {
    float spiralPhase = theta - u_tightness * 0.7 * log(max(r / (u_eyeRadius * 0.3), 0.01));
    spiralPhase += u_time * 0.25 * u_rotation + 0.5;  // Offset from primary

    float armSpacing = 6.28318 / (u_numArms * 2.0);  // More bands
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

    float r = length(pos);
    float theta = atan(pos.y, pos.x);

    // Outside maximum radius: no density
    if (r > u_maxRadius) {
        fragColor = vec4(0.0, 0.0, 0.0, 0.0);
        return;
    }

    // =========================================================================
    // RADIAL STRUCTURE
    // =========================================================================

    // Eye zone - clear center
    float eyeFade = smoothstep(u_eyeRadius * 0.6, u_eyeRadius * 1.5, r);

    // Eye wall - peak density ring around eye
    float eyeWallDist = abs(r - u_eyeRadius * 1.2);
    float eyeWall = exp(-eyeWallDist * eyeWallDist / 0.003) * 1.5;

    // Outer falloff
    float outerFade = 1.0 - smoothstep(u_maxRadius * 0.6, u_maxRadius, r);

    // =========================================================================
    // SPIRAL ARM STRUCTURE
    // =========================================================================

    // Primary spiral arms
    float primaryArms = spiralArmDensity(pos, r, theta);

    // Secondary bands
    float secondary = secondaryBands(pos, r, theta);

    // =========================================================================
    // CLOUD TEXTURE
    // =========================================================================

    // Domain warped noise for organic cloud look
    vec2 noiseCoord = pos * 8.0;
    noiseCoord += vec2(
        fbm(pos * 3.0 + u_time * 0.02, 3),
        fbm(pos * 3.0 + vec2(5.2, 1.3) + u_time * 0.02, 3)
    ) * 0.5;

    float clouds = fbm(noiseCoord + u_time * 0.03, 5);
    clouds = clouds * 0.5 + 0.5;  // Remap to 0-1

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
    density += 0.15 * eyeFade;

    // Apply outer falloff
    density *= outerFade;

    // Modulate with cloud texture for organic look
    density *= (1.0 - u_noiseStrength) + u_noiseStrength * clouds;

    // Clamp final density
    density = clamp(density, 0.0, 1.0);

    // Output density in red channel (single channel output)
    // Alpha channel also carries density for blending
    fragColor = vec4(density, density, density, density);
}
