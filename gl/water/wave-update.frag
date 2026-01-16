#version 300 es
/**
 * Wave Update Fragment Shader - EXACT port from Evan Wallace
 * Uses height + velocity in a single texture (no leapfrog)
 *
 * info.r = height
 * info.g = velocity
 */

precision highp float;

uniform sampler2D u_heightCurrent;   // Contains height (r) and velocity (g)
uniform vec2 u_texelSize;            // 1.0 / resolution

out vec4 fragColor;

void main() {
    vec2 coord = gl_FragCoord.xy * u_texelSize;

    // Get current info
    vec4 info = texture(u_heightCurrent, coord);

    // Calculate average neighbor height (Evan's exact method)
    vec2 dx = vec2(u_texelSize.x, 0.0);
    vec2 dy = vec2(0.0, u_texelSize.y);

    float average = (
        texture(u_heightCurrent, coord - dx).r +
        texture(u_heightCurrent, coord - dy).r +
        texture(u_heightCurrent, coord + dx).r +
        texture(u_heightCurrent, coord + dy).r
    ) * 0.25;

    // Change the velocity to move toward the average
    info.g += (average - info.r) * 2.0;

    // Attenuate the velocity so waves don't last forever
    info.g *= 0.995;

    // Move the vertex along the velocity
    info.r += info.g;

    fragColor = info;
}
