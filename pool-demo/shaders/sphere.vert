#version 300 es
/**
 * Sphere Vertex Shader
 * Transforms sphere vertices and passes data to fragment shader.
 */

precision highp float;

layout(location = 0) in vec3 a_position;
layout(location = 1) in vec3 a_normal;

uniform mat4 u_mvp;
uniform mat4 u_model;
uniform vec3 u_sphereCenter;
uniform float u_sphereRadius;

out vec3 v_worldPos;
out vec3 v_normal;

void main() {
    // Transform unit sphere to world position
    vec3 worldPos = a_position * u_sphereRadius + u_sphereCenter;
    v_worldPos = worldPos;
    v_normal = a_normal;  // For unit sphere, normal = position

    gl_Position = u_mvp * vec4(worldPos, 1.0);
}
