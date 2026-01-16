#version 300 es
/**
 * Wave Drop Injection Fragment Shader - matches Evan Wallace
 *
 * Adds a cosine-shaped drop disturbance to the water height.
 * Preserves velocity (g channel).
 */

precision highp float;

uniform sampler2D u_height;      // Current water state (r=height, g=velocity)
uniform vec2 u_dropPosition;     // Drop center (normalized 0-1)
uniform float u_dropRadius;      // Drop radius (normalized)
uniform float u_dropStrength;    // Drop amplitude
uniform vec2 u_texelSize;        // 1.0 / resolution
uniform float u_aspectRatio;     // Width / Height

out vec4 fragColor;

void main() {
    vec2 coord = gl_FragCoord.xy * u_texelSize;

    // Get current water state
    vec4 info = texture(u_height, coord);

    // Distance from drop center
    vec2 delta = coord - u_dropPosition;
    delta.x *= u_aspectRatio;
    float dist = length(delta);

    // Add drop to height (Evan's exact formula)
    float drop = max(0.0, 1.0 - dist / u_dropRadius);
    drop = 0.5 - cos(drop * 3.14159265) * 0.5;
    info.r += drop * u_dropStrength;

    fragColor = info;
}
