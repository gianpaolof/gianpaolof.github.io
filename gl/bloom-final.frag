#version 300 es
precision highp float;

/**
 * Bloom final composite - combines bloom mips.
 */

uniform sampler2D u_texture;
uniform float u_intensity;

in vec2 v_texCoord;
out vec4 fragColor;

void main() {
    vec3 color = texture(u_texture, v_texCoord).rgb * u_intensity;
    fragColor = vec4(color, 1.0);
}
