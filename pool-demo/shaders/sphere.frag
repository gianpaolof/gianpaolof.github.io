#version 300 es
/**
 * Sphere Fragment Shader
 * Renders a submerged sphere with caustics and underwater effects.
 */

precision highp float;

uniform vec3 u_cameraPos;
uniform vec3 u_lightDir;
uniform sampler2D u_causticTexture;
uniform float u_poolDepth;
uniform float u_causticIntensity;

in vec3 v_worldPos;
in vec3 v_normal;

out vec4 fragColor;

void main() {
    vec3 normal = normalize(v_normal);
    vec3 viewDir = normalize(u_cameraPos - v_worldPos);
    vec3 lightDir = normalize(u_lightDir);

    // Base sphere color (white/pale blue ball)
    vec3 baseColor = vec3(0.85, 0.88, 0.92);

    // Diffuse lighting
    float diffuse = max(dot(normal, lightDir), 0.0);

    // Specular (Blinn-Phong)
    vec3 halfVec = normalize(lightDir + viewDir);
    float specular = pow(max(dot(normal, halfVec), 0.0), 64.0);

    vec3 color = baseColor * (0.25 + 0.6 * diffuse);
    color += vec3(1.0) * specular * 0.4;

    // Apply caustics to the sphere surface
    if (v_worldPos.y < 0.01) {  // Underwater
        // Project caustic sampling based on surface position
        // Offset by refracted light direction for correct caustic placement
        vec3 refractedLight = refract(-lightDir, vec3(0.0, 1.0, 0.0), 1.0/1.33);
        float yOffset = v_worldPos.y;  // Distance from water surface
        vec2 causticUV = v_worldPos.xz - yOffset * refractedLight.xz / refractedLight.y;
        causticUV = causticUV * 0.5 + 0.5;

        float caustic = texture(u_causticTexture, causticUV).r;
        color += vec3(0.85, 0.9, 1.0) * caustic * u_causticIntensity * 0.8;

        // Underwater color absorption (Beer's law)
        float depth = max(0.0, -v_worldPos.y);
        vec3 absorption = exp(-vec3(0.35, 0.08, 0.04) * depth);
        color *= absorption;

        // Add subtle blue tint for underwater feel
        color = mix(color, vec3(0.15, 0.35, 0.5), 0.1);
    }

    // Fresnel rim effect (subtle)
    float fresnel = pow(1.0 - max(dot(viewDir, normal), 0.0), 3.0);
    color += vec3(0.3, 0.4, 0.5) * fresnel * 0.15;

    // Gamma correction
    color = pow(color, vec3(1.0 / 2.2));

    fragColor = vec4(color, 1.0);
}
