#version 300 es
/**
 * Caustics Fragment Shader - EXACT port from Evan Wallace's WebGL Water
 * https://github.com/evanw/webgl-water
 */

precision highp float;

in vec3 v_oldPos;
in vec3 v_newPos;

out vec4 fragColor;

void main() {
    // EXACT Evan Wallace formula:
    // if the triangle gets smaller, it gets brighter, and vice versa
    float oldArea = length(dFdx(v_oldPos)) * length(dFdy(v_oldPos));
    float newArea = length(dFdx(v_newPos)) * length(dFdy(v_newPos));

    // Brightness with 0.2 multiplier as per original
    float brightness = oldArea / newArea * 0.2;

    fragColor = vec4(brightness, brightness, brightness, 1.0);
}
