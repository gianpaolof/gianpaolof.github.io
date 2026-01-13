#version 300 es
precision mediump float;  // Lower precision OK for iterative solver

// Jacobi iteration pressure solver
// Solves Poisson equation: Laplacian(p) = divergence
// Run this shader multiple times (10-40 iterations) for convergence

uniform sampler2D u_pressure;     // Previous iteration pressure
uniform sampler2D u_divergence;   // Divergence field (constant during solve)

in vec2 v_texCoord;
out float fragColor;

void main() {
    // Sample neighboring pressures using textureOffset
    float pL = textureOffset(u_pressure, v_texCoord, ivec2(-1, 0)).x;  // Left
    float pR = textureOffset(u_pressure, v_texCoord, ivec2( 1, 0)).x;  // Right
    float pB = textureOffset(u_pressure, v_texCoord, ivec2( 0,-1)).x;  // Bottom
    float pT = textureOffset(u_pressure, v_texCoord, ivec2( 0, 1)).x;  // Top

    // Sample divergence at current position
    float div = texture(u_divergence, v_texCoord).x;

    // Jacobi iteration formula:
    // p_new = (p_left + p_right + p_bottom + p_top - divergence) / 4
    float pressure = (pL + pR + pB + pT - div) * 0.25;

    fragColor = pressure;
}
