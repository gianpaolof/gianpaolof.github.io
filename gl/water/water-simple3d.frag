#version 300 es
/**
 * Simple 3D Water Surface Fragment Shader
 * Realistic water with Fresnel and lighting
 */

precision highp float;

uniform float u_time;

in vec3 v_worldPos;
in vec3 v_normal;
in vec2 v_texCoord;

out vec4 fragColor;

void main() {
    vec3 normal = normalize(v_normal);

    // Camera position (should match renderer)
    vec3 cameraPos = vec3(0.0, 2.5, 1.5);
    vec3 viewDir = normalize(cameraPos - v_worldPos);

    // Sun light direction
    vec3 lightDir = normalize(vec3(0.3, 1.0, 0.5));

    // Diffuse lighting
    float diffuse = max(dot(normal, lightDir), 0.0);

    // Specular highlight (Blinn-Phong)
    vec3 halfVec = normalize(lightDir + viewDir);
    float specular = pow(max(dot(normal, halfVec), 0.0), 64.0);

    // Fresnel effect (simplified Schlick)
    float fresnel = pow(1.0 - max(dot(viewDir, normal), 0.0), 4.0);

    // Water colors
    vec3 deepColor = vec3(0.0, 0.15, 0.3);
    vec3 shallowColor = vec3(0.0, 0.4, 0.5);
    vec3 skyColor = vec3(0.6, 0.8, 1.0);

    // Base water color
    vec3 waterColor = mix(deepColor, shallowColor, 0.5 + v_worldPos.y * 5.0);

    // Add sky reflection based on fresnel
    waterColor = mix(waterColor, skyColor, fresnel * 0.6);

    // Apply lighting
    vec3 color = waterColor * (0.4 + 0.6 * diffuse);

    // Add specular highlights (sun reflection)
    color += vec3(1.0, 0.95, 0.8) * specular * 0.5;

    // Foam on wave peaks
    float foam = smoothstep(0.02, 0.08, v_worldPos.y);
    color = mix(color, vec3(1.0), foam * 0.4);

    // Gamma correction
    color = pow(color, vec3(1.0 / 2.2));

    fragColor = vec4(color, 0.92);
}
