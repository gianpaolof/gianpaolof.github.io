#version 300 es
/**
 * Caustics Vertex Shader - Simplified debug version
 * Based on Evan Wallace's WebGL Water
 */

precision highp float;

layout(location = 0) in vec3 a_position;
layout(location = 1) in vec2 a_texCoord;

uniform sampler2D u_heightTexture;
uniform vec3 u_lightDir;
uniform float u_poolDepth;
uniform float u_heightScale;
uniform vec2 u_texelSize;

out vec3 v_oldPos;
out vec3 v_newPos;

const float IOR_AIR = 1.0;
const float IOR_WATER = 1.333;

void main() {
    // Sample height
    vec4 info = texture(u_heightTexture, a_texCoord);
    float height = info.r;

    // Get neighboring heights for normal (forward difference like Evan)
    float hRight = texture(u_heightTexture, a_texCoord + vec2(u_texelSize.x, 0.0)).r;
    float hUp = texture(u_heightTexture, a_texCoord + vec2(0.0, u_texelSize.y)).r;

    // Compute tangent vectors (Evan's method)
    vec3 dx = vec3(u_texelSize.x, (hRight - height) * u_heightScale, 0.0);
    vec3 dy = vec3(0.0, (hUp - height) * u_heightScale, u_texelSize.y);

    // Cross product for normal, then scale by 0.5
    vec3 crossP = cross(dy, dx);
    vec2 normalXZ = normalize(crossP).xz * 0.5;

    // Reconstruct normal
    vec3 normal = vec3(normalXZ.x, sqrt(1.0 - dot(normalXZ, normalXZ)), normalXZ.y);

    // Light direction
    vec3 light = normalize(u_lightDir);

    // Refracted light through flat water
    vec3 refractedLight = refract(-light, vec3(0.0, 1.0, 0.0), IOR_AIR / IOR_WATER);

    // Refracted ray through wavy surface
    vec3 ray = refract(-light, normal, IOR_AIR / IOR_WATER);

    // Simple projection to floor at y = -1
    // Water surface position (a_position is in XZ, Y=0)
    vec3 surfacePos = vec3(a_position.x, height * u_heightScale, a_position.z);
    vec3 flatPos = vec3(a_position.x, 0.0, a_position.z);

    // Project to floor (y = -1)
    float floorY = -1.0;

    // Old position: flat water projected along refracted light
    float t1 = (floorY - flatPos.y) / refractedLight.y;
    v_oldPos = flatPos + refractedLight * t1;

    // New position: wavy water projected along actual ray
    float t2 = (floorY - surfacePos.y) / ray.y;
    v_newPos = surfacePos + ray * t2;

    // Evan's exact gl_Position formula
    gl_Position = vec4(0.75 * (v_newPos.xz + refractedLight.xz / refractedLight.y), 0.0, 1.0);
}
