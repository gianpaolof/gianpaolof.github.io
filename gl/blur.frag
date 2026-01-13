#version 300 es
precision highp float;

/**
 * Gaussian blur shader for bloom.
 */

uniform sampler2D u_texture;
uniform vec2 u_texelSize;
uniform vec2 u_direction;

in vec2 v_texCoord;
out vec4 fragColor;

void main() {
    vec4 color = vec4(0.0);
    vec2 off1 = vec2(1.3846153846) * u_direction * u_texelSize;
    vec2 off2 = vec2(3.2307692308) * u_direction * u_texelSize;

    color += texture(u_texture, v_texCoord) * 0.2270270270;
    color += texture(u_texture, v_texCoord + off1) * 0.3162162162;
    color += texture(u_texture, v_texCoord - off1) * 0.3162162162;
    color += texture(u_texture, v_texCoord + off2) * 0.0702702703;
    color += texture(u_texture, v_texCoord - off2) * 0.0702702703;

    fragColor = color;
}
