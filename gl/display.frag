#version 300 es
precision highp float;

/**
 * Display shader - renders dye field with shading, bloom, sunrays, and dithering.
 * Pavel-style rendering with 3D lighting effect.
 */

uniform sampler2D u_texture;
uniform sampler2D u_bloom;
uniform sampler2D u_sunrays;
uniform vec2 u_texelSize;
uniform float u_bloomIntensity;
uniform bool u_bloomEnabled;
uniform bool u_shadingEnabled;
uniform bool u_sunraysEnabled;

in vec2 v_texCoord;
out vec4 fragColor;

// Gamma correction like Pavel (sRGB)
vec3 linearToGamma(vec3 color) {
    color = max(color, vec3(0.0));
    return max(1.055 * pow(color, vec3(0.416666667)) - 0.055, vec3(0.0));
}

void main() {
    vec3 c = texture(u_texture, v_texCoord).rgb;

    // SHADING - creates 3D "oily" effect from color gradients (like Pavel)
    // STRONGER contrast than before!
    if (u_shadingEnabled) {
        vec3 lc = texture(u_texture, v_texCoord - vec2(u_texelSize.x, 0.0)).rgb;
        vec3 rc = texture(u_texture, v_texCoord + vec2(u_texelSize.x, 0.0)).rgb;
        vec3 tc = texture(u_texture, v_texCoord + vec2(0.0, u_texelSize.y)).rgb;
        vec3 bc = texture(u_texture, v_texCoord - vec2(0.0, u_texelSize.y)).rgb;

        float dx = length(rc) - length(lc);
        float dy = length(tc) - length(bc);

        // Pavel's exact normal and lighting formula
        vec3 n = normalize(vec3(dx, dy, length(u_texelSize)));
        vec3 l = vec3(0.0, 0.0, 1.0);
        float diffuse = clamp(dot(n, l) + 0.7, 0.7, 1.0);
        c *= diffuse;
    }

    // SUNRAYS first (Pavel's order: shading -> sunrays -> bloom)
    float sunrays = 1.0;
    if (u_sunraysEnabled) {
        sunrays = texture(u_sunrays, v_texCoord).r;
        c *= sunrays;  // Pavel's exact formula: pure multiply
    }

    // BLOOM - additive glow (also modulated by sunrays like Pavel)
    if (u_bloomEnabled) {
        vec3 bloom = texture(u_bloom, v_texCoord).rgb * u_bloomIntensity;
        if (u_sunraysEnabled) {
            bloom *= sunrays;  // Pavel also multiplies bloom by sunrays
        }
        c += bloom;
    }

    // Gamma correction for final output (do BEFORE dithering)
    c = linearToGamma(c);

    // DITHERING - better algorithm (triangular distribution)
    // Reduces banding artifacts in gradients
    vec2 uv = v_texCoord * vec2(1920.0, 1080.0);
    float noise = fract(52.9829189 * fract(dot(uv, vec2(0.06711056, 0.00583715))));
    c += (noise - 0.5) / 255.0;

    // Output with alpha based on brightness
    float a = max(c.r, max(c.g, c.b));
    fragColor = vec4(c, a);
}
