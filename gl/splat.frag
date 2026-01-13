#version 300 es
precision highp float;

/**
 * Splat shader - injects color at a position.
 */

uniform sampler2D u_target;
uniform vec2 u_point;
uniform vec3 u_color;
uniform float u_radius;
uniform float u_aspectRatio;

in vec2 v_texCoord;
out vec4 fragColor;

void main() {
    vec2 p = v_texCoord - u_point;
    p.x *= u_aspectRatio;

    float splat = exp(-dot(p, p) / u_radius);
    vec3 base = texture(u_target, v_texCoord).rgb;

    fragColor = vec4(base + u_color * splat, 1.0);
}
