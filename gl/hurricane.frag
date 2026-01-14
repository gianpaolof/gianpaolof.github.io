#version 300 es
precision highp float;

/**
 * Hurricane spiral shader using Rankine Vortex model.
 * Generates realistic cyclonic flow patterns with:
 * - Inner core: solid body rotation (linear velocity profile)
 * - Outer region: irrotational vortex (1/r velocity decay)
 * - Radial expansion component for spiral arms
 */

uniform sampler2D u_velocity;
uniform vec2 u_center;
uniform float u_eyeRadius;
uniform float u_maxRadius;
uniform float u_strength;
uniform float u_expansion;
uniform float u_rotation;
uniform float u_aspectRatio;
uniform float u_blend;
uniform vec2 u_texelSize;

in vec2 v_texCoord;
out vec4 fragColor;

void main() {
    // Read existing velocity
    vec2 velocity = texture(u_velocity, v_texCoord).xy;

    // Vector from center (aspect-corrected)
    vec2 pos = v_texCoord - u_center;
    pos.x *= u_aspectRatio;

    // Distance from center
    float r = length(pos);

    // Early exit: outside influence radius or at center
    if (r > u_maxRadius || r < 0.0001) {
        fragColor = vec4(velocity, 0.0, 1.0);
        return;
    }

    // Rankine vortex profile
    float R_max = u_eyeRadius * 2.0;  // Eye wall at 2x eye radius
    float V_theta;

    if (r < R_max) {
        // Inner core: solid body rotation (linear increase)
        V_theta = u_strength * (r / R_max);
    } else {
        // Outer region: irrotational vortex (1/r decay)
        V_theta = u_strength * (R_max / r);
    }

    // Smooth falloff at outer edge (prevents sharp discontinuity)
    float edgeFalloff = smoothstep(u_maxRadius, u_maxRadius * 0.6, r);
    V_theta *= edgeFalloff;

    // Eye calm zone (very low velocity inside eye)
    float eyeCalm = smoothstep(0.0, u_eyeRadius, r);
    V_theta *= eyeCalm;

    // Compute angle
    float theta = atan(pos.y, pos.x);

    // Tangential unit vector (perpendicular to radius)
    // CCW: (-sin, cos), CW: (sin, -cos)
    vec2 tangent = u_rotation * vec2(-sin(theta), cos(theta));

    // Radial unit vector (outward from center)
    vec2 radial = vec2(cos(theta), sin(theta));

    // Combine tangential + radial components
    vec2 hurricaneVel = tangent * V_theta + radial * V_theta * u_expansion;

    // Scale by texel size for proper velocity magnitude
    hurricaneVel *= u_texelSize.x * 100.0;

    // Blend with existing velocity
    velocity = mix(velocity, velocity + hurricaneVel, u_blend);

    fragColor = vec4(velocity, 0.0, 1.0);
}
