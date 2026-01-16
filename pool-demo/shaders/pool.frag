#version 300 es
/**
 * Pool Geometry Fragment Shader
 * Renders tiled floor and walls with caustic overlay.
 */

precision highp float;

uniform sampler2D u_causticTexture;
uniform vec3 u_lightDir;
uniform float u_poolDepth;
uniform float u_causticIntensity;

in vec3 v_worldPos;
in vec3 v_normal;
in vec2 v_texCoord;

out vec4 fragColor;

// Procedural tile color (matches water-surface.frag)
vec3 getTileColor(vec2 uv) {
    vec2 tileUV = uv * 8.0;
    vec2 grid = abs(fract(tileUV) - 0.5);
    float grout = smoothstep(0.42, 0.48, min(grid.x, grid.y));

    vec2 tileID = floor(tileUV);
    float variation = fract(sin(dot(tileID, vec2(12.9898, 78.233))) * 43758.5453);

    vec3 tileColor1 = vec3(0.0, 0.65, 0.7);   // Cyan
    vec3 tileColor2 = vec3(0.1, 0.7, 0.75);   // Lighter cyan
    vec3 tileColor3 = vec3(0.05, 0.6, 0.65);  // Darker cyan
    vec3 tileColor = mix(tileColor1, tileColor2, variation);
    tileColor = mix(tileColor, tileColor3, fract(variation * 7.0) * 0.2);
    vec3 groutColor = vec3(0.15, 0.18, 0.2);

    return mix(groutColor, tileColor, grout);
}

void main() {
    vec3 normal = normalize(v_normal);
    vec3 lightDir = normalize(u_lightDir);

    // Tile pattern
    vec3 tileColor = getTileColor(v_texCoord);

    // Basic diffuse lighting
    float diffuse = max(dot(normal, lightDir), 0.0);
    vec3 color = tileColor * (0.3 + 0.6 * diffuse);

    // Apply caustics (only for surfaces underwater, facing up or sideways)
    if (v_worldPos.y < 0.01) {  // Underwater threshold
        // Sample caustic texture
        // Map world XZ to caustic UV [0, 1]
        vec2 causticUV = v_worldPos.xz * 0.5 + 0.5;
        float caustic = texture(u_causticTexture, causticUV).r;

        // Apply caustics with intensity control
        vec3 causticColor = vec3(0.9, 0.95, 1.0);  // Slightly blue-white
        color += causticColor * caustic * u_causticIntensity;
    }

    // Underwater color tint (Beer's law - light absorption)
    float depth = max(0.0, -v_worldPos.y);
    vec3 absorption = exp(-vec3(0.3, 0.07, 0.03) * depth);
    color *= absorption;

    // Add slight ambient to prevent pure black
    color = max(color, vec3(0.02));

    // Gamma correction
    color = pow(color, vec3(1.0 / 2.2));

    fragColor = vec4(color, 1.0);
}
