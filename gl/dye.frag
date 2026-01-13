#version 300 es
precision highp float;

/**
 * Dye injection shader.
 * Adds color splat at specified position.
 */

uniform sampler2D u_dye;
uniform vec2 u_dyePosition;
uniform vec3 u_dyeColor;
uniform float u_dyeRadius;
uniform float u_aspectRatio;

in vec2 v_texCoord;
out vec4 fragColor;

void main() {
    vec3 dye = texture(u_dye, v_texCoord).rgb;

    vec2 delta = v_texCoord - u_dyePosition;
    delta.x *= u_aspectRatio;
    float dist = length(delta);

    float influence = exp(-dist * dist / (2.0 * u_dyeRadius * u_dyeRadius));
    dye += u_dyeColor * influence;

    fragColor = vec4(clamp(dye, 0.0, 1.0), 1.0);
}
