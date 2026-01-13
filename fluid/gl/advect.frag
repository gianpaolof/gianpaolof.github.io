#version 300 es
precision highp float;

// Semi-Lagrangian advection shader
// Traces particles backward in time and samples the source field

uniform sampler2D u_velocity;    // Velocity field for tracing
uniform sampler2D u_source;      // Field to advect (can be same as velocity)
uniform vec2 u_texelSize;        // 1.0 / resolution
uniform float u_dt;              // Timestep
uniform float u_dissipation;     // Decay factor (0.98-1.0)

in vec2 v_texCoord;
out vec4 fragColor;

void main() {
    // Sample velocity at current position
    vec2 velocity = texture(u_velocity, v_texCoord).xy;

    // Trace backward in time (semi-Lagrangian method)
    // pos_prev = pos_current - dt * velocity
    vec2 prevPos = v_texCoord - u_dt * velocity * u_texelSize;

    // Sample source field at previous position
    // Bilinear interpolation is handled by GL_LINEAR filtering
    vec4 result = texture(u_source, prevPos);

    // Apply dissipation to prevent accumulation
    fragColor = result * u_dissipation;
}
