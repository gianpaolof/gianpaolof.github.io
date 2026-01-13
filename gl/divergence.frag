#version 300 es
precision highp float;

// Divergence calculation shader
// Computes the divergence of the velocity field using central differences
// div(v) = dv_x/dx + dv_y/dy

uniform sampler2D u_velocity;
uniform vec2 u_texelSize;

in vec2 v_texCoord;
out float fragColor;

void main() {
    // Sample neighboring velocities using textureOffset for better cache locality
    float vL = textureOffset(u_velocity, v_texCoord, ivec2(-1, 0)).x;  // Left
    float vR = textureOffset(u_velocity, v_texCoord, ivec2( 1, 0)).x;  // Right
    float vB = textureOffset(u_velocity, v_texCoord, ivec2( 0,-1)).y;  // Bottom
    float vT = textureOffset(u_velocity, v_texCoord, ivec2( 0, 1)).y;  // Top

    // Central difference divergence
    // Factor of 0.5 comes from 1/(2*dx) where dx=1 grid cell
    float divergence = 0.5 * (vR - vL + vT - vB);

    // Output divergence (positive = source, negative = sink)
    fragColor = divergence;
}
