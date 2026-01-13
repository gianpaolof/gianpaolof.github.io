#version 300 es
precision highp float;

// Karl Sims style fluid visualization
// Maps vorticity (curl) to a thermal blue-orange-yellow colormap
// Creates beautiful swirling patterns like fluid art

uniform sampler2D u_velocity;
uniform sampler2D u_dye;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_intensity;

in vec2 v_texCoord;
out vec4 fragColor;

// Compute vorticity (curl) - measures local rotation
float computeVorticity(vec2 uv) {
    vec2 texel = 1.0 / u_resolution;

    // Sample velocity at neighboring points
    float vL = texture(u_velocity, uv - vec2(texel.x, 0.0)).y;
    float vR = texture(u_velocity, uv + vec2(texel.x, 0.0)).y;
    float vB = texture(u_velocity, uv - vec2(0.0, texel.y)).x;
    float vT = texture(u_velocity, uv + vec2(0.0, texel.y)).x;

    // Curl = dVy/dx - dVx/dy
    return (vR - vL) - (vT - vB);
}

// Thermal colormap: Blue -> Cyan -> Yellow -> Orange -> Red
// Based on vorticity sign and magnitude
vec3 thermalColormap(float value) {
    // value in range [-1, 1]
    // -1 = deep blue (clockwise rotation)
    // 0 = cyan/light blue (no rotation)
    // +1 = orange/yellow (counter-clockwise rotation)

    float t = value * 0.5 + 0.5; // Map to [0, 1]

    vec3 color;

    if (t < 0.25) {
        // Deep blue to blue
        float s = t / 0.25;
        color = mix(vec3(0.0, 0.0, 0.5), vec3(0.0, 0.3, 1.0), s);
    } else if (t < 0.5) {
        // Blue to cyan
        float s = (t - 0.25) / 0.25;
        color = mix(vec3(0.0, 0.3, 1.0), vec3(0.0, 0.8, 1.0), s);
    } else if (t < 0.65) {
        // Cyan to yellow
        float s = (t - 0.5) / 0.15;
        color = mix(vec3(0.0, 0.8, 1.0), vec3(1.0, 0.95, 0.2), s);
    } else if (t < 0.8) {
        // Yellow to orange
        float s = (t - 0.65) / 0.15;
        color = mix(vec3(1.0, 0.95, 0.2), vec3(1.0, 0.6, 0.0), s);
    } else {
        // Orange to deep orange/red
        float s = (t - 0.8) / 0.2;
        color = mix(vec3(1.0, 0.6, 0.0), vec3(0.9, 0.3, 0.0), s);
    }

    return color;
}

// Alternative: Smooth thermal colormap using cosine interpolation
vec3 smoothThermalColormap(float value) {
    // value in range [-1, 1]
    float t = value * 0.5 + 0.5; // Map to [0, 1]

    // Color stops inspired by Karl Sims fluid art
    vec3 c0 = vec3(0.0, 0.1, 0.4);   // Deep blue
    vec3 c1 = vec3(0.0, 0.5, 1.0);   // Bright blue
    vec3 c2 = vec3(0.2, 0.85, 1.0);  // Cyan
    vec3 c3 = vec3(1.0, 0.9, 0.3);   // Yellow
    vec3 c4 = vec3(1.0, 0.55, 0.0);  // Orange
    vec3 c5 = vec3(0.8, 0.25, 0.0);  // Deep orange

    vec3 color;
    if (t < 0.2) {
        color = mix(c0, c1, t / 0.2);
    } else if (t < 0.4) {
        color = mix(c1, c2, (t - 0.2) / 0.2);
    } else if (t < 0.5) {
        color = mix(c2, c3, (t - 0.4) / 0.1);
    } else if (t < 0.7) {
        color = mix(c3, c4, (t - 0.5) / 0.2);
    } else {
        color = mix(c4, c5, (t - 0.7) / 0.3);
    }

    return color;
}

// Compute velocity magnitude for additional detail
float computeSpeed(vec2 uv) {
    vec2 vel = texture(u_velocity, uv).xy;
    return length(vel);
}

// Simple blur for smoother gradients
float blurredVorticity(vec2 uv) {
    vec2 texel = 1.0 / u_resolution;
    float sum = 0.0;
    float weight = 0.0;

    // 5x5 Gaussian-like kernel
    for (int x = -2; x <= 2; x++) {
        for (int y = -2; y <= 2; y++) {
            float w = 1.0 / (1.0 + float(x*x + y*y));
            sum += computeVorticity(uv + vec2(float(x), float(y)) * texel) * w;
            weight += w;
        }
    }

    return sum / weight;
}

void main() {
    vec2 uv = v_texCoord;

    // Compute vorticity with slight blur for smoother look
    float vorticity = blurredVorticity(uv);

    // Scale vorticity for better color range
    // Adjust this multiplier based on simulation intensity
    float scaledVorticity = vorticity * 3.0 * u_intensity;

    // Clamp to [-1, 1] range
    scaledVorticity = clamp(scaledVorticity, -1.0, 1.0);

    // Apply non-linear curve for more contrast
    // This makes the colors more vivid and the transitions sharper
    float sign = scaledVorticity >= 0.0 ? 1.0 : -1.0;
    scaledVorticity = sign * pow(abs(scaledVorticity), 0.7);

    // Get color from thermal colormap
    vec3 color = smoothThermalColormap(scaledVorticity);

    // Add velocity-based brightness modulation
    float speed = computeSpeed(uv);
    float brightness = 0.85 + speed * 0.3;
    color *= brightness;

    // Boost saturation for more vivid colors
    float gray = dot(color, vec3(0.299, 0.587, 0.114));
    color = mix(vec3(gray), color, 1.3); // 1.3 = saturation boost

    // Clamp to valid range
    color = clamp(color, 0.0, 1.0);

    // Output final color (full opacity - no background blending)
    fragColor = vec4(color, 1.0);
}
