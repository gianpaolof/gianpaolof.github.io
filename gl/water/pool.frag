#version 300 es
/**
 * Pool Environment Fragment Shader
 * Renders tiled pool floor and walls with lighting
 */

precision highp float;

in vec3 v_worldPos;
in vec3 v_normal;
in vec2 v_texCoord;

uniform vec3 u_lightDir;
uniform vec3 u_cameraPos;
uniform float u_causticStrength;
uniform sampler2D u_causticTexture;
uniform float u_time;

out vec4 fragColor;

// Procedural tile pattern
vec3 getTileColor(vec2 uv) {
    // Tile size (smaller = more tiles)
    vec2 tileUV = uv * 8.0;

    // Grid lines (grout)
    vec2 grid = abs(fract(tileUV) - 0.5);
    float grout = smoothstep(0.42, 0.48, min(grid.x, grid.y));

    // Tile color variation
    vec2 tileID = floor(tileUV);
    float variation = fract(sin(dot(tileID, vec2(12.9898, 78.233))) * 43758.5453);

    // Base tile colors (cyan/turquoise pool tiles)
    vec3 tileColor1 = vec3(0.0, 0.65, 0.7);   // Turquoise
    vec3 tileColor2 = vec3(0.1, 0.7, 0.75);   // Lighter turquoise
    vec3 tileColor3 = vec3(0.0, 0.6, 0.65);   // Darker turquoise

    vec3 tileColor = mix(tileColor1, tileColor2, variation);
    tileColor = mix(tileColor, tileColor3, fract(variation * 7.0) * 0.3);

    // Grout color (dark gray)
    vec3 groutColor = vec3(0.15, 0.18, 0.2);

    return mix(groutColor, tileColor, grout);
}

void main() {
    vec3 normal = normalize(v_normal);
    vec3 lightDir = normalize(u_lightDir);

    // Get tile color
    vec3 baseColor = getTileColor(v_texCoord);

    // Simple diffuse lighting
    float diffuse = max(dot(normal, lightDir), 0.0);
    float ambient = 0.3;

    vec3 color = baseColor * (ambient + diffuse * 0.7);

    // Add slight specular for wet look
    vec3 viewDir = normalize(u_cameraPos - v_worldPos);
    vec3 halfVec = normalize(lightDir + viewDir);
    float specular = pow(max(dot(normal, halfVec), 0.0), 32.0);
    color += vec3(1.0) * specular * 0.15;

    // Gamma correction
    color = pow(color, vec3(1.0 / 2.2));

    fragColor = vec4(color, 1.0);
}
