#version 300 es
/**
 * Pool Geometry Vertex Shader
 * Transforms pool floor and wall vertices to clip space.
 */

precision highp float;

layout(location = 0) in vec3 a_position;
layout(location = 1) in vec3 a_normal;
layout(location = 2) in vec2 a_texCoord;

uniform mat4 u_mvp;
uniform mat4 u_model;

out vec3 v_worldPos;
out vec3 v_normal;
out vec2 v_texCoord;

void main() {
    vec4 worldPos = u_model * vec4(a_position, 1.0);
    v_worldPos = worldPos.xyz;
    v_normal = mat3(u_model) * a_normal;
    v_texCoord = a_texCoord;
    gl_Position = u_mvp * vec4(a_position, 1.0);
}
