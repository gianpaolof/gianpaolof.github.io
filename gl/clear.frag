#version 300 es
precision mediump float;

/**
 * Clear shader - scales previous pressure by coefficient (Pavel's approach).
 * This helps Jacobi solver converge faster by starting closer to solution.
 */

uniform sampler2D u_texture;
uniform float u_value;

in vec2 v_texCoord;
out float fragColor;

void main() {
    // Sample previous pressure and scale it (Pavel uses 0.8)
    // This keeps 80% of previous pressure for faster convergence
    fragColor = u_value * texture(u_texture, v_texCoord).r;
}
