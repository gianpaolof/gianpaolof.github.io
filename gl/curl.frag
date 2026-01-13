#version 300 es
precision highp float;

/**
 * Curl shader - computes vorticity (separate pass like Pavel).
 */

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
