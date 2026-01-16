#version 300 es
/**
 * Wave Normal Calculation Fragment Shader
 *
 * Computes surface normals from the heightfield using central differences.
 * Normal = normalize(-dh/dx, 1, -dh/dz)
 */

precision highp float;

uniform sampler2D u_height;      // Height texture
uniform vec2 u_texelSize;        // 1.0 / resolution
uniform float u_heightScale;     // Scale factor for height gradients

out vec4 fragColor;

void main() {
    vec2 uv = gl_FragCoord.xy * u_texelSize;

    // Sample neighboring heights for gradient calculation
    float hL = texture(u_height, uv + vec2(-u_texelSize.x, 0.0)).r;
    float hR = texture(u_height, uv + vec2( u_texelSize.x, 0.0)).r;
    float hD = texture(u_height, uv + vec2(0.0, -u_texelSize.y)).r;
    float hU = texture(u_height, uv + vec2(0.0,  u_texelSize.y)).r;

    // Central differences for gradient
    // dh/dx = (hR - hL) / (2 * dx)
    // dh/dz = (hU - hD) / (2 * dz)
    // We multiply by heightScale to convert to world units
    float dhdx = (hR - hL) * u_heightScale;
    float dhdz = (hU - hD) * u_heightScale;

    // Normal = normalize(-dh/dx, 1, -dh/dz)
    vec3 normal = normalize(vec3(-dhdx, 1.0, -dhdz));

    // Encode normal for storage (map from [-1,1] to [0,1])
    vec3 encodedNormal = normal * 0.5 + 0.5;

    // Also output the height in alpha for convenience
    float h = texture(u_height, uv).r;

    fragColor = vec4(encodedNormal, h);
}
