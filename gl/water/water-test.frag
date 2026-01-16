#version 300 es
/**
 * Test Fragment Shader - Simple colored output to verify mesh rendering
 */

precision highp float;

in vec3 v_worldPos;
in vec3 v_normal;
in vec2 v_texCoord;

out vec4 fragColor;

void main() {
    // Simple gradient based on texture coordinates to verify mesh is working
    vec3 color = vec3(v_texCoord.x, 0.3, v_texCoord.y);

    // Add some shading based on normal
    vec3 lightDir = normalize(vec3(0.5, 1.0, 0.3));
    float diffuse = max(dot(normalize(v_normal), lightDir), 0.0);
    color *= (0.5 + 0.5 * diffuse);

    fragColor = vec4(color, 1.0);
}
