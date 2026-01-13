#version 300 es
precision highp float;

// Gradient subtraction shader (projection step)
// Subtracts pressure gradient from velocity to enforce incompressibility
// v_new = v - gradient(p)

uniform sampler2D u_pressure;
uniform sampler2D u_velocity;

in vec2 v_texCoord;
out vec2 fragColor;

void main() {
    // Sample neighboring pressures using textureOffset
    float pL = textureOffset(u_pressure, v_texCoord, ivec2(-1, 0)).x;  // Left
    float pR = textureOffset(u_pressure, v_texCoord, ivec2( 1, 0)).x;  // Right
    float pB = textureOffset(u_pressure, v_texCoord, ivec2( 0,-1)).x;  // Bottom
    float pT = textureOffset(u_pressure, v_texCoord, ivec2( 0, 1)).x;  // Top

    // Compute pressure gradient using central differences
    // Factor of 0.5 comes from 1/(2*dx) where dx=1 grid cell
    vec2 gradient = vec2(pR - pL, pT - pB) * 0.5;

    // Sample current velocity
    vec2 velocity = texture(u_velocity, v_texCoord).xy;

    // Subtract gradient to make velocity divergence-free
    // This is the "projection" step that enforces incompressibility
    fragColor = velocity - gradient;
}
