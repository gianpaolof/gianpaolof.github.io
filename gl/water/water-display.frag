#version 300 es
/**
 * Water Display Fragment Shader (2D Fallback)
 *
 * Simple 2D visualization of the water surface for testing.
 * Shows height as color intensity with normal-based shading.
 */

precision highp float;

uniform sampler2D u_height;
uniform sampler2D u_normal;
uniform vec2 u_texelSize;
uniform float u_time;

in vec2 v_texCoord;

out vec4 fragColor;

void main() {

    // Sample height and normal
    float height = texture(u_height, v_texCoord).r;
    vec3 normal = texture(u_normal, v_texCoord).rgb * 2.0 - 1.0;

    // Simple directional lighting
    vec3 lightDir = normalize(vec3(0.5, 1.0, 0.3));
    float diffuse = max(dot(normal, lightDir), 0.0);

    // Water color based on height
    vec3 deepColor = vec3(0.0, 0.2, 0.4);
    vec3 shallowColor = vec3(0.0, 0.6, 0.8);
    vec3 foamColor = vec3(0.9, 0.95, 1.0);

    // Map height to color
    float heightNorm = height * 5.0 + 0.5;  // Scale for visibility
    vec3 baseColor = mix(deepColor, shallowColor, clamp(heightNorm, 0.0, 1.0));

    // Add foam on wave peaks
    float foam = smoothstep(0.6, 0.8, heightNorm);
    baseColor = mix(baseColor, foamColor, foam * 0.5);

    // Apply lighting
    vec3 color = baseColor * (0.3 + 0.7 * diffuse);

    // Add specular highlight
    vec3 viewDir = vec3(0.0, 1.0, 0.0);  // Top-down view
    vec3 halfVec = normalize(lightDir + viewDir);
    float specular = pow(max(dot(normal, halfVec), 0.0), 64.0);
    color += vec3(1.0) * specular * 0.3;

    // Gamma correction
    color = pow(color, vec3(1.0 / 2.2));

    fragColor = vec4(color, 1.0);
}
