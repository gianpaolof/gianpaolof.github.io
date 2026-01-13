#version 300 es
precision highp float;

/**
 * Gradient subtraction shader.
 * Projects velocity to divergence-free field.
 */

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
