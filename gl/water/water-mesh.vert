#version 300 es
/**
 * Water Mesh Vertex Shader
 *
 * Displaces a grid mesh based on heightfield texture.
 * Computes normals from the height gradients.
 */

layout(location = 0) in vec3 a_position;
layout(location = 1) in vec2 a_texCoord;

uniform sampler2D u_heightfield;
uniform mat4 u_modelViewProjection;
uniform mat4 u_modelMatrix;
uniform float u_heightScale;
uniform vec2 u_texelSize;

out vec3 v_worldPos;
out vec3 v_normal;
out vec2 v_texCoord;

void main() {
    // Sample height at this vertex
    float height = texture(u_heightfield, a_texCoord).r;

    // Displace vertex in Y direction
    vec3 displaced = vec3(a_position.x, a_position.y + height * u_heightScale, a_position.z);

    // Compute normal from height gradients (vertex texture fetch)
    float hL = texture(u_heightfield, a_texCoord + vec2(-u_texelSize.x, 0.0)).r;
    float hR = texture(u_heightfield, a_texCoord + vec2( u_texelSize.x, 0.0)).r;
    float hD = texture(u_heightfield, a_texCoord + vec2(0.0, -u_texelSize.y)).r;
    float hU = texture(u_heightfield, a_texCoord + vec2(0.0,  u_texelSize.y)).r;

    // Gradient scaled by height scale
    float dhdx = (hR - hL) * u_heightScale;
    float dhdz = (hU - hD) * u_heightScale;

    // Normal = normalize(-dh/dx, 1, -dh/dz)
    v_normal = normalize(vec3(-dhdx, 1.0, -dhdz));

    // World position for lighting/reflection calculations
    v_worldPos = displaced;

    // Pass through texture coordinates
    v_texCoord = a_texCoord;

    // Final clip position with MVP transformation
    gl_Position = u_modelViewProjection * vec4(displaced, 1.0);
}
