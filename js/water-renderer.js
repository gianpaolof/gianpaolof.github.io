/**
 * Water Renderer Module
 *
 * Handles 3D rendering of the water surface including:
 * - Water mesh generation and rendering
 * - 2D fallback display mode
 * - Environment mapping (cubemap)
 *
 * @module water-renderer
 */

/**
 * WaterRenderer class handles water surface visualization.
 */
export class WaterRenderer {
    /**
     * Creates a new WaterRenderer instance.
     *
     * @param {WebGL2RenderingContext} gl - WebGL2 context
     * @param {Object} programs - Compiled shader programs
     * @param {Object} config - Renderer configuration
     */
    constructor(gl, programs, config) {
        this.gl = gl;
        this.programs = programs;
        this.config = config;

        // Mesh data
        this._meshVAO = null;
        this._meshVertexCount = 0;
        this._meshIndexCount = 0;

        // Fullscreen quad for 2D display
        this._quadVAO = null;

        // Textures
        this._cubemap = null;
        this._floorTexture = null;

        // Camera/view matrices (simple defaults)
        this._viewMatrix = new Float32Array(16);
        this._projMatrix = new Float32Array(16);
        this._modelMatrix = new Float32Array(16);
        this._mvpMatrix = new Float32Array(16);

        // Camera position - looking down at water from above (like Evan Wallace's demo)
        this._cameraPos = [0, 2.5, 1.5];
        this._cameraTarget = [0, 0, 0];

        // Use 3D mode for realistic water rendering
        this._use3DMode = true;

        this._initMatrices();
    }

    /**
     * Initializes default matrices.
     */
    _initMatrices() {
        // Model matrix with scale to make mesh larger (3x3 units)
        // In column-major: m[0]=scaleX, m[5]=scaleY, m[10]=scaleZ
        this._setIdentity(this._modelMatrix);
        this._modelMatrix[0] = 2.0;   // Scale X
        this._modelMatrix[5] = 1.0;   // Scale Y (height)
        this._modelMatrix[10] = 2.0;  // Scale Z

        // Simple view matrix (looking down at water from angle)
        this._setLookAt(
            this._viewMatrix,
            this._cameraPos,
            this._cameraTarget,
            [0, 1, 0]
        );

        // Perspective projection with wider FOV
        this._setPerspective(
            this._projMatrix,
            Math.PI / 3,  // 60 degree FOV
            1.0,          // Aspect (updated on resize)
            0.1,          // Near
            100.0         // Far
        );
    }

    /**
     * Creates the water surface mesh.
     *
     * @param {number} resolution - Grid resolution
     */
    createMesh(resolution) {
        const gl = this.gl;

        // Generate grid vertices
        const vertices = [];
        const texCoords = [];
        const indices = [];

        const size = 2.0;  // -1 to 1
        const halfSize = size / 2;
        const step = size / resolution;

        // Generate vertices
        for (let z = 0; z <= resolution; z++) {
            for (let x = 0; x <= resolution; x++) {
                // Position (y = 0, will be displaced by shader)
                vertices.push(x * step - halfSize);
                vertices.push(0);
                vertices.push(z * step - halfSize);

                // Texture coordinates (0 to 1)
                texCoords.push(x / resolution);
                texCoords.push(z / resolution);
            }
        }

        // Generate indices for triangles
        for (let z = 0; z < resolution; z++) {
            for (let x = 0; x < resolution; x++) {
                const topLeft = z * (resolution + 1) + x;
                const topRight = topLeft + 1;
                const bottomLeft = (z + 1) * (resolution + 1) + x;
                const bottomRight = bottomLeft + 1;

                // First triangle
                indices.push(topLeft);
                indices.push(bottomLeft);
                indices.push(topRight);

                // Second triangle
                indices.push(topRight);
                indices.push(bottomLeft);
                indices.push(bottomRight);
            }
        }

        // Create VAO
        this._meshVAO = gl.createVertexArray();
        gl.bindVertexArray(this._meshVAO);

        // Position buffer
        const posBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);  // a_position
        gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

        // Texcoord buffer
        const texBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, texBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(texCoords), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(1);  // a_texCoord
        gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);

        // Index buffer
        const indexBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);

        gl.bindVertexArray(null);

        this._meshVertexCount = vertices.length / 3;
        this._meshIndexCount = indices.length;
    }

    /**
     * Creates a fullscreen quad VAO for 2D display.
     * Uses attribute-less rendering (vertices generated in shader via gl_VertexID).
     */
    createQuad() {
        const gl = this.gl;

        // Attribute-less quad VAO (matches quad.vert which uses gl_VertexID)
        this._quadVAO = gl.createVertexArray();
        // No buffers needed - quad.vert generates vertices from gl_VertexID
    }

    /**
     * Creates a simple procedural floor texture.
     *
     * @returns {WebGLTexture} Floor texture
     */
    createFloorTexture() {
        const gl = this.gl;
        const size = 256;

        // Generate tile pattern
        const data = new Uint8Array(size * size * 4);
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const i = (y * size + x) * 4;

                // Tile pattern
                const tileSize = 32;
                const tileX = Math.floor(x / tileSize);
                const tileY = Math.floor(y / tileSize);
                const isLight = (tileX + tileY) % 2 === 0;

                // Grout lines
                const inGrout = (x % tileSize < 2) || (y % tileSize < 2);

                if (inGrout) {
                    // Dark grout
                    data[i] = 40;
                    data[i + 1] = 50;
                    data[i + 2] = 60;
                } else {
                    // Tile color
                    const base = isLight ? 180 : 140;
                    const variation = Math.random() * 20 - 10;
                    data[i] = Math.min(255, Math.max(0, base + variation));
                    data[i + 1] = Math.min(255, Math.max(0, base + 10 + variation));
                    data[i + 2] = Math.min(255, Math.max(0, base + 20 + variation));
                }
                data[i + 3] = 255;
            }
        }

        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.generateMipmap(gl.TEXTURE_2D);

        this._floorTexture = texture;
        return texture;
    }

    /**
     * Creates a simple procedural cubemap.
     *
     * @returns {WebGLTexture} Cubemap texture
     */
    createCubemap() {
        const gl = this.gl;
        const size = 64;

        const faces = [
            gl.TEXTURE_CUBE_MAP_POSITIVE_X,
            gl.TEXTURE_CUBE_MAP_NEGATIVE_X,
            gl.TEXTURE_CUBE_MAP_POSITIVE_Y,
            gl.TEXTURE_CUBE_MAP_NEGATIVE_Y,
            gl.TEXTURE_CUBE_MAP_POSITIVE_Z,
            gl.TEXTURE_CUBE_MAP_NEGATIVE_Z
        ];

        // Face colors (simple sky)
        const faceColors = [
            [135, 206, 235],  // +X: sky blue
            [135, 206, 235],  // -X: sky blue
            [200, 230, 255],  // +Y: light sky (top)
            [60, 80, 100],    // -Y: darker (bottom)
            [135, 206, 235],  // +Z: sky blue
            [135, 206, 235]   // -Z: sky blue
        ];

        const cubemap = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_CUBE_MAP, cubemap);

        for (let i = 0; i < 6; i++) {
            const data = new Uint8Array(size * size * 4);
            const [r, g, b] = faceColors[i];

            for (let y = 0; y < size; y++) {
                for (let x = 0; x < size; x++) {
                    const idx = (y * size + x) * 4;
                    // Add slight gradient for visual interest
                    const gradient = y / size * 0.3;
                    data[idx] = Math.min(255, r + gradient * 50);
                    data[idx + 1] = Math.min(255, g + gradient * 30);
                    data[idx + 2] = Math.min(255, b + gradient * 20);
                    data[idx + 3] = 255;
                }
            }

            gl.texImage2D(faces[i], 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
        }

        gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

        this._cubemap = cubemap;
        return cubemap;
    }

    /**
     * Renders the water in 2D mode (simple display).
     *
     * @param {WebGLTexture} heightTexture - Height field texture
     * @param {WebGLTexture} normalTexture - Normal map texture
     * @param {number} time - Current time
     */
    render2D(heightTexture, normalTexture, time) {
        const gl = this.gl;
        const program = this.programs.waterDisplay;

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

        program.use();

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, heightTexture);
        gl.uniform1i(program.uniforms.u_height, 0);

        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, normalTexture);
        gl.uniform1i(program.uniforms.u_normal, 1);

        gl.uniform2f(program.uniforms.u_texelSize,
            1.0 / this.config.resolution,
            1.0 / this.config.resolution
        );
        gl.uniform1f(program.uniforms.u_time, time);

        gl.bindVertexArray(this._quadVAO);
        gl.drawArrays(gl.TRIANGLES, 0, 3);  // Fullscreen triangle (matches quad.vert)
        gl.bindVertexArray(null);
    }

    /**
     * Renders the water in 3D mode (mesh with reflections).
     *
     * @param {WebGLTexture} heightTexture - Height field texture
     * @param {WebGLTexture} normalTexture - Normal map texture
     * @param {number} time - Current time
     */
    render3D(heightTexture, normalTexture, time) {
        const gl = this.gl;

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

        // Clear with dark background (area outside pool)
        gl.clearColor(0.1, 0.1, 0.15, 1.0);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

        gl.enable(gl.DEPTH_TEST);
        gl.disable(gl.CULL_FACE);  // Disable backface culling

        // Use water mesh shader
        const program = this.programs.waterMesh;
        if (!program) {
            console.error('waterMesh program not found!');
            return;
        }
        program.use();

        // Update MVP matrix
        this._multiplyMatrices(this._mvpMatrix, this._projMatrix, this._viewMatrix);
        this._multiplyMatrices(this._mvpMatrix, this._mvpMatrix, this._modelMatrix);

        gl.uniformMatrix4fv(program.uniforms.u_modelViewProjection, false, this._mvpMatrix);
        gl.uniformMatrix4fv(program.uniforms.u_modelMatrix, false, this._modelMatrix);

        gl.uniform1f(program.uniforms.u_heightScale, this.config.heightScale);
        gl.uniform2f(program.uniforms.u_texelSize,
            1.0 / this.config.resolution,
            1.0 / this.config.resolution
        );

        // New uniforms for water-surface.frag
        gl.uniform3f(program.uniforms.u_cameraPos,
            this._cameraPos[0], this._cameraPos[1], this._cameraPos[2]);
        gl.uniform3f(program.uniforms.u_lightDir, 0.3, 1.0, 0.5);  // Sun direction
        gl.uniform1f(program.uniforms.u_poolDepth, this.config.poolDepth || 0.5);
        gl.uniform1f(program.uniforms.u_time, time);

        // Bind heightfield
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, heightTexture);
        gl.uniform1i(program.uniforms.u_heightfield, 0);

        // Draw water mesh
        if (this._meshVAO && this._meshIndexCount > 0) {
            gl.bindVertexArray(this._meshVAO);
            gl.drawElements(gl.TRIANGLES, this._meshIndexCount, gl.UNSIGNED_SHORT, 0);
            gl.bindVertexArray(null);
        } else {
            console.error('Mesh not ready:', this._meshVAO, this._meshIndexCount);
        }

        gl.disable(gl.DEPTH_TEST);
    }

    /**
     * Main render function.
     *
     * @param {WebGLTexture} heightTexture - Height field texture
     * @param {WebGLTexture} normalTexture - Normal map texture
     * @param {number} time - Current time
     */
    render(heightTexture, normalTexture, time) {
        if (this._use3DMode && this._meshVAO) {
            this.render3D(heightTexture, normalTexture, time);
        } else {
            this.render2D(heightTexture, normalTexture, time);
        }
    }

    /**
     * Updates camera aspect ratio on resize.
     *
     * @param {number} width - Canvas width
     * @param {number} height - Canvas height
     */
    resize(width, height) {
        const aspect = width / height;
        this._setPerspective(this._projMatrix, Math.PI / 3, aspect, 0.1, 100.0);  // 60 degree FOV
    }

    /**
     * Sets whether to use 3D rendering mode.
     *
     * @param {boolean} use3D - True for 3D mode
     */
    set use3DMode(use3D) {
        this._use3DMode = use3D;
    }

    get use3DMode() {
        return this._use3DMode;
    }

    // =========================================================================
    // Matrix utility functions
    // =========================================================================

    _setIdentity(m) {
        m.fill(0);
        m[0] = m[5] = m[10] = m[15] = 1;
    }

    _setLookAt(m, eye, target, up) {
        const zAxis = this._normalize([
            eye[0] - target[0],
            eye[1] - target[1],
            eye[2] - target[2]
        ]);
        const xAxis = this._normalize(this._cross(up, zAxis));
        const yAxis = this._cross(zAxis, xAxis);

        // Column-major order for WebGL
        m[0] = xAxis[0];  m[4] = xAxis[1];  m[8] = xAxis[2];   m[12] = -this._dot(xAxis, eye);
        m[1] = yAxis[0];  m[5] = yAxis[1];  m[9] = yAxis[2];   m[13] = -this._dot(yAxis, eye);
        m[2] = zAxis[0];  m[6] = zAxis[1];  m[10] = zAxis[2];  m[14] = -this._dot(zAxis, eye);
        m[3] = 0;         m[7] = 0;         m[11] = 0;         m[15] = 1;
    }

    _setPerspective(m, fov, aspect, near, far) {
        const f = 1.0 / Math.tan(fov / 2);
        const nf = 1 / (near - far);

        // Column-major order for WebGL
        m.fill(0);
        m[0] = f / aspect;
        m[5] = f;
        m[10] = (far + near) * nf;
        m[11] = -1;
        m[14] = 2 * far * near * nf;
    }

    _multiplyMatrices(out, a, b) {
        // Column-major matrix multiplication for WebGL
        const result = new Float32Array(16);
        for (let col = 0; col < 4; col++) {
            for (let row = 0; row < 4; row++) {
                result[col * 4 + row] =
                    a[0 * 4 + row] * b[col * 4 + 0] +
                    a[1 * 4 + row] * b[col * 4 + 1] +
                    a[2 * 4 + row] * b[col * 4 + 2] +
                    a[3 * 4 + row] * b[col * 4 + 3];
            }
        }
        out.set(result);
    }

    _normalize(v) {
        const len = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
        return [v[0] / len, v[1] / len, v[2] / len];
    }

    _cross(a, b) {
        return [
            a[1] * b[2] - a[2] * b[1],
            a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0]
        ];
    }

    _dot(a, b) {
        return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    }

    /**
     * Cleans up WebGL resources.
     */
    destroy() {
        const gl = this.gl;
        if (this._meshVAO) gl.deleteVertexArray(this._meshVAO);
        if (this._quadVAO) gl.deleteVertexArray(this._quadVAO);
        if (this._cubemap) gl.deleteTexture(this._cubemap);
        if (this._floorTexture) gl.deleteTexture(this._floorTexture);
    }
}
