#version 300 es
precision highp float;

/**
 * Sunrays shader - volumetric light scattering from screen center.
 * Based on GPU Gems 3 - Volumetric Light Scattering.
 */

uniform sampler2D u_texture;
uniform float u_weight;

in vec2 v_texCoord;
out vec4 fragColor;

#define ITERATIONS 16

void main() {
    float Density = 0.3;
    float Decay = 0.95;
    float Exposure = 0.7;

    vec2 coord = v_texCoord;
    vec2 dir = v_texCoord - 0.5; // Direction from center
    dir *= 1.0 / float(ITERATIONS) * Density;

    float illuminationDecay = 1.0;
    float color = texture(u_texture, v_texCoord).r;

    for (int i = 0; i < ITERATIONS; i++) {
        coord -= dir;
        float sample_ = texture(u_texture, coord).r;
        sample_ *= illuminationDecay * u_weight;
        color += sample_;
        illuminationDecay *= Decay;
    }

    fragColor = vec4(vec3(color * Exposure), 1.0);
}
