#version 300 es
/**
 * Pool Environment Vertex Shader
 * Renders the pool floor and walls
 */

layout(location = 0) in vec3 a_position;
layout(location = 1) in vec2 a_texCoord;
layout(location = 2) in vec3 a_normal;

uniform mat4 u_modelViewProjection;
uniform mat4 u_modelMatrix;

out vec3 v_worldPos;
out vec3 v_normal;
out vec2 v_texCoord;

void main() {
    v_worldPos = (u_modelMatrix * vec4(a_position, 1.0)).xyz;
    v_normal = mat3(u_modelMatrix) * a_normal;
    v_texCoord = a_texCoord;
    gl_Position = u_modelViewProjection * vec4(a_position, 1.0);
}
