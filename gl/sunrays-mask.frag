#version 300 es
precision highp float;

/**
 * Sunrays mask shader - converts dye brightness to mask.
 * Pavel's technique: where there's bright fluid, we create light sources.
 */

uniform sampler2D u_texture;

in vec2 v_texCoord;
out vec4 fragColor;

void main() {
    vec4 c = texture(u_texture, v_texCoord);
    float brightness = max(c.r, max(c.g, c.b));
    // Higher brightness = more light contribution
    // We want bright fluid to emit light rays
    fragColor = vec4(vec3(brightness), 1.0);
}
