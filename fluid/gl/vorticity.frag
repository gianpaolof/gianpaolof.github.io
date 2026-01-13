#version 300 es
precision highp float;

// Vorticity confinement shader
// Amplifies vortices to counteract numerical dissipation
// Creates sharper, more defined swirls like in Karl Sims fluid art

uniform sampler2D u_velocity;
uniform vec2 u_texelSize;
uniform float u_curl;       // Vorticity confinement strength (0.0 - 50.0)
uniform float u_dt;

in vec2 v_texCoord;
out vec2 fragColor;

// Compute curl (vorticity) at a point
float curl(vec2 uv) {
    float vL = texture(u_velocity, uv - vec2(u_texelSize.x, 0.0)).y;
    float vR = texture(u_velocity, uv + vec2(u_texelSize.x, 0.0)).y;
    float vB = texture(u_velocity, uv - vec2(0.0, u_texelSize.y)).x;
    float vT = texture(u_velocity, uv + vec2(0.0, u_texelSize.y)).x;
    return (vR - vL) - (vT - vB);
}

void main() {
    vec2 uv = v_texCoord;

    // Get current velocity
    vec2 velocity = texture(u_velocity, uv).xy;

    // Compute curl at current position and neighbors
    float curlC = curl(uv);
    float curlL = curl(uv - vec2(u_texelSize.x, 0.0));
    float curlR = curl(uv + vec2(u_texelSize.x, 0.0));
    float curlB = curl(uv - vec2(0.0, u_texelSize.y));
    float curlT = curl(uv + vec2(0.0, u_texelSize.y));

    // Compute gradient of curl magnitude
    vec2 curlGrad = vec2(
        abs(curlR) - abs(curlL),
        abs(curlT) - abs(curlB)
    );

    // Normalize gradient (avoid division by zero)
    float len = length(curlGrad);
    if (len > 0.0001) {
        curlGrad /= len;
    }

    // Vorticity confinement force
    // Force is perpendicular to gradient, proportional to curl
    vec2 force = vec2(curlGrad.y, -curlGrad.x) * curlC * u_curl;

    // Apply force to velocity
    velocity += force * u_dt;

    fragColor = velocity;
}
