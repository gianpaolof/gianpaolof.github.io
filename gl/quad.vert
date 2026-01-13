#version 300 es

// Fullscreen quad vertex shader (attribute-less)
// Uses gl_VertexID to generate vertices - call with gl.drawArrays(gl.TRIANGLES, 0, 3)

out vec2 v_texCoord;

void main() {
    // Generate fullscreen triangle that covers the entire clip space
    // Vertex 0: (-1, -1), Vertex 1: (3, -1), Vertex 2: (-1, 3)
    // This single triangle covers the entire viewport

    float x = float((gl_VertexID & 1) << 2) - 1.0;  // -1, 3, -1
    float y = float((gl_VertexID & 2) << 1) - 1.0;  // -1, -1, 3

    // Texture coordinates [0,1] range
    v_texCoord = vec2(x, y) * 0.5 + 0.5;

    gl_Position = vec4(x, y, 0.0, 1.0);
}
