#version 300 es
/**
 * Water Surface Fragment Shader
 * Implements Fresnel reflection/refraction like Evan Wallace's demo
 * With physical caustics from Jacobian technique
 */

precision highp float;

uniform vec3 u_cameraPos;
uniform vec3 u_lightDir;
uniform float u_poolDepth;
uniform float u_time;
uniform sampler2D u_causticTexture;  // Physical caustic texture
uniform float u_causticIntensity;     // Caustic brightness control

in vec3 v_worldPos;
in vec3 v_normal;
in vec2 v_texCoord;

out vec4 fragColor;

// Fresnel (Schlick approximation)
float fresnel(float cosTheta) {
    float R0 = 0.02; // Air-water interface
    return R0 + (1.0 - R0) * pow(1.0 - cosTheta, 5.0);
}

// Procedural tile for pool floor
vec3 getTileColor(vec2 uv) {
    vec2 tileUV = uv * 8.0;
    vec2 grid = abs(fract(tileUV) - 0.5);
    float grout = smoothstep(0.42, 0.48, min(grid.x, grid.y));

    vec2 tileID = floor(tileUV);
    float variation = fract(sin(dot(tileID, vec2(12.9898, 78.233))) * 43758.5453);

    vec3 tileColor1 = vec3(0.0, 0.65, 0.7);
    vec3 tileColor2 = vec3(0.1, 0.7, 0.75);
    vec3 tileColor3 = vec3(0.05, 0.6, 0.65);
    vec3 tileColor = mix(tileColor1, tileColor2, variation);
    tileColor = mix(tileColor, tileColor3, fract(variation * 7.0) * 0.2);
    vec3 groutColor = vec3(0.15, 0.18, 0.2);

    return mix(groutColor, tileColor, grout);
}

void main() {
    vec3 normal = normalize(v_normal);
    vec3 viewDir = normalize(u_cameraPos - v_worldPos);
    vec3 lightDir = normalize(u_lightDir);

    // Fresnel factor
    float cosTheta = max(dot(viewDir, normal), 0.0);
    float F = fresnel(cosTheta);

    // === REFRACTION (see through water to pool floor) ===
    float eta = 1.0 / 1.33; // Air to water
    vec3 refractDir = refract(-viewDir, normal, eta);

    // Find where refracted ray hits pool floor (y = -poolDepth)
    float t = (-u_poolDepth - v_worldPos.y) / min(refractDir.y, -0.001);
    t = max(t, 0.0);
    vec3 floorHit = v_worldPos + refractDir * t;

    // Sample floor at refracted position
    vec2 floorUV = floorHit.xz * 0.5 + 0.5; // Map world coords to UV
    vec3 floorColor = getTileColor(floorUV);

    // Simple floor lighting
    float floorLight = 0.6 + 0.4 * max(dot(vec3(0.0, 1.0, 0.0), lightDir), 0.0);
    floorColor *= floorLight;

    // Water absorption (Beer's law) - more blue at depth
    float waterDepth = length(floorHit - v_worldPos);
    vec3 absorption = exp(-vec3(0.4, 0.08, 0.04) * waterDepth * 0.3);
    vec3 refractedColor = floorColor * absorption;

    // Add water tint
    refractedColor = mix(refractedColor, vec3(0.0, 0.25, 0.4), 0.1);

    // === CAUSTICS (Physical) ===
    // Sample from computed caustic texture
    float caustic = texture(u_causticTexture, floorUV).r;

    // Apply caustics with intensity and absorption
    vec3 causticLight = vec3(0.9, 0.95, 1.0) * caustic * u_causticIntensity;
    refractedColor += causticLight * absorption;

    // === REFLECTION (sky) ===
    vec3 reflectDir = reflect(-viewDir, normal);
    float skyGradient = reflectDir.y * 0.5 + 0.5;
    vec3 skyColor = mix(vec3(0.5, 0.7, 0.9), vec3(0.2, 0.4, 0.7), skyGradient);

    // Add some clouds
    float clouds = sin(reflectDir.x * 3.0 + u_time * 0.1) * sin(reflectDir.z * 2.0) * 0.5 + 0.5;
    skyColor = mix(skyColor, vec3(0.95), clouds * 0.2);

    vec3 reflectedColor = skyColor;

    // === COMBINE with Fresnel ===
    vec3 waterColor = mix(refractedColor, reflectedColor, F);

    // === SPECULAR highlight (sun) ===
    vec3 halfVec = normalize(lightDir + viewDir);
    float specular = pow(max(dot(normal, halfVec), 0.0), 512.0);
    waterColor += vec3(1.0, 0.98, 0.9) * specular;

    // Gamma correction
    waterColor = pow(waterColor, vec3(1.0 / 2.2));

    fragColor = vec4(waterColor, 1.0);
}
