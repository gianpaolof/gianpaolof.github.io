#version 300 es
precision highp float;

/**
 * Divergence calculation shader.
 * Computes divergence using central differences with boundary conditions.
 */

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
