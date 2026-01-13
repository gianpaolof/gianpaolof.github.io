#version 300 es
precision highp float;

/**
 * Bloom prefilter - extracts bright areas with soft knee.
 */

uniform sampler2D u_texture;
uniform vec3 u_curve;  // threshold, knee, knee*2
uniform float u_threshold;

in vec2 v_texCoord;
out vec4 fragColor;

void main() {
    vec3 color = texture(u_texture, v_texCoord).rgb;

    // Soft knee curve
    float brightness = max(max(color.r, color.g), color.b);
    float soft = brightness - u_curve.x + u_curve.y;
    soft = clamp(soft, 0.0, u_curve.z);
    soft = soft * soft / (4.0 * u_curve.y + 0.00001);

    float contribution = max(soft, brightness - u_threshold);
    contribution /= max(brightness, 0.00001);

    fragColor = vec4(color * contribution, 1.0);
}
