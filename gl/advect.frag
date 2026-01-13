#version 300 es
precision highp float;

/**
 * Semi-Lagrangian advection shader.
 * Traces particles backward in time and samples the source field.
 * Uses manual bilinear filtering for higher quality (like Pavel).
 *
 * IMPORTANT: u_texelSize is for velocity lookup/backtrace (1/gridSize)
 *            u_sourceTexelSize is for sampling the source texture (could be 1/dyeSize)
 */

uniform sampler2D u_velocity;
uniform sampler2D u_source;
uniform vec2 u_texelSize;        // For velocity lookup and backtrace step (1/gridSize)
uniform vec2 u_sourceTexelSize;  // For sampling source texture (may differ for dye)
uniform float u_dt;
uniform float u_dissipation;

in vec2 v_texCoord;
out vec4 fragColor;

// Manual bilinear filtering for better quality (CRITICAL for smooth advection!)
vec4 bilerp(sampler2D sam, vec2 uv, vec2 tsize) {
    vec2 st = uv / tsize - 0.5;
    vec2 iuv = floor(st);
    vec2 fuv = fract(st);
    vec4 a = texture(sam, (iuv + vec2(0.5, 0.5)) * tsize);
    vec4 b = texture(sam, (iuv + vec2(1.5, 0.5)) * tsize);
    vec4 c = texture(sam, (iuv + vec2(0.5, 1.5)) * tsize);
    vec4 d = texture(sam, (iuv + vec2(1.5, 1.5)) * tsize);
    return mix(mix(a, b, fuv.x), mix(c, d, fuv.x), fuv.y);
}

void main() {
    vec2 velocity = texture(u_velocity, v_texCoord).xy;
    // Backtrace uses velocity-scale texelSize
    vec2 coord = v_texCoord - u_dt * velocity * u_texelSize;

    // USE BILINEAR FILTERING with SOURCE texture's texelSize!
    vec4 result = bilerp(u_source, coord, u_sourceTexelSize);

    // Pavel's dissipation formula: divide instead of multiply
    float decay = 1.0 + u_dissipation * u_dt;
    fragColor = result / decay;
}
