#version 300 es
precision highp float;

// External force injection shader
// Applies Gaussian splat forces from user input and procedural noise

uniform sampler2D u_velocity;
uniform vec2 u_texelSize;
uniform float u_aspectRatio;     // width / height

// Force input uniforms
uniform vec2 u_forcePosition;    // Normalized [0,1] coords
uniform vec2 u_forceDirection;   // Direction vector (scaled by strength)
uniform float u_forceRadius;     // Radius in texture coords (~0.05)

// Procedural noise uniforms
uniform float u_time;
uniform float u_noiseScale;      // Spatial frequency
uniform float u_noiseStrength;   // Force magnitude

in vec2 v_texCoord;
out vec4 fragColor;

// Simplex noise implementation
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute(vec3 x) { return mod289(((x * 34.0) + 1.0) * x); }

float snoise(vec2 v) {
    const vec4 C = vec4(0.211324865405187,   // (3.0 - sqrt(3.0)) / 6.0
                        0.366025403784439,   // 0.5 * (sqrt(3.0) - 1.0)
                        -0.577350269189626,  // -1.0 + 2.0 * C.x
                        0.024390243902439);  // 1.0 / 41.0

    vec2 i = floor(v + dot(v, C.yy));
    vec2 x0 = v - i + dot(i, C.xx);

    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;

    i = mod289(i);
    vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));

    vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
    m = m * m;
    m = m * m;

    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;

    m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);

    vec3 g;
    g.x = a0.x * x0.x + h.x * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;

    return 130.0 * dot(m, g);
}

void main() {
    vec2 velocity = texture(u_velocity, v_texCoord).xy;

    // Calculate distance to force position (aspect-corrected)
    vec2 delta = v_texCoord - u_forcePosition;
    delta.x *= u_aspectRatio;
    float dist = length(delta);

    // Gaussian splat for force injection
    float influence = exp(-dist * dist / (2.0 * u_forceRadius * u_forceRadius));

    // Add force from user input
    velocity += u_forceDirection * influence;

    // Add procedural noise for ambient motion
    if (u_noiseStrength > 0.0) {
        vec2 noiseCoord = v_texCoord * u_noiseScale;
        vec2 noiseForce = vec2(
            snoise(vec3(noiseCoord, u_time * 0.1).xy),
            snoise(vec3(noiseCoord + 100.0, u_time * 0.1).xy)
        ) * u_noiseStrength;
        velocity += noiseForce;
    }

    // Clamp velocity magnitude to prevent explosion
    float speed = length(velocity);
    if (speed > 10.0) {
        velocity = velocity / speed * 10.0;
    }

    fragColor = vec4(velocity, 0.0, 1.0);
}
