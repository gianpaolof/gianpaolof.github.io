/**
 * Caustics Renderer - Computes physical caustics using the Jacobian technique
 *
 * Based on Evan Wallace's WebGL water demo.
 * Renders water surface mesh projected along refracted light rays,
 * then measures area distortion to compute light intensity.
 */
export class CausticsRenderer {
    constructor(gl, resolution = 512) {
        this.gl = gl;
        this.resolution = resolution;

        // Caustic framebuffer
        this._fbo = null;
        this._texture = null;

        // Water mesh for caustic rendering
        // Resolution should match simulation for accurate gradient sampling
        this._meshVAO = null;
        this._meshIndexCount = 0;
        this._meshResolution = 256;

        // Shader program (set externally)
        this.program = null;

        this._createFBO();
        this._createMesh();
    }

    /**
     * Creates the caustic framebuffer
     */
    _createFBO() {
        const gl = this.gl;
        const res = this.resolution;

        // Create texture
        this._texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this._texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, res, res, 0, gl.RED, gl.HALF_FLOAT, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

        // Create framebuffer
        this._fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, this._fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this._texture, 0);

        // Check completeness
        const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
        if (status !== gl.FRAMEBUFFER_COMPLETE) {
            console.error('Caustic FBO incomplete:', status);
        }

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    /**
     * Creates a mesh for caustic rendering
     * This is a grid that matches the water surface
     */
    _createMesh() {
        const gl = this.gl;
        const res = this._meshResolution;

        const vertices = [];
        const texCoords = [];
        const indices = [];

        // Generate grid vertices (same as water mesh)
        for (let z = 0; z <= res; z++) {
            for (let x = 0; x <= res; x++) {
                // Position in [-1, 1] range
                const px = (x / res) * 2 - 1;
                const pz = (z / res) * 2 - 1;

                vertices.push(px, 0, pz);

                // Texture coordinates [0, 1]
                texCoords.push(x / res, z / res);
            }
        }

        // Generate indices
        for (let z = 0; z < res; z++) {
            for (let x = 0; x < res; x++) {
                const topLeft = z * (res + 1) + x;
                const topRight = topLeft + 1;
                const bottomLeft = (z + 1) * (res + 1) + x;
                const bottomRight = bottomLeft + 1;

                // Two triangles per quad
                indices.push(topLeft, bottomLeft, topRight);
                indices.push(topRight, bottomLeft, bottomRight);
            }
        }

        // Create VAO
        this._meshVAO = gl.createVertexArray();
        gl.bindVertexArray(this._meshVAO);

        // Position buffer
        const posBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

        // TexCoord buffer
        const texBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, texBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(texCoords), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);

        // Index buffer (use Uint32 for large meshes)
        const indexBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(indices), gl.STATIC_DRAW);

        gl.bindVertexArray(null);

        this._meshIndexCount = indices.length;
    }

    /**
     * Renders caustics to the caustic texture
     *
     * @param {WebGLTexture} heightTexture - Water heightfield texture
     * @param {number[]} lightDir - Normalized light direction (pointing up toward light)
     * @param {number} poolDepth - Pool depth
     * @param {number} heightScale - Height scale factor
     * @param {number} simResolution - Simulation resolution for texel size
     */
    render(heightTexture, lightDir, poolDepth, heightScale, simResolution) {
        const gl = this.gl;

        if (!this.program) {
            console.error('Caustics program not set');
            return;
        }

        // Bind caustic FBO
        gl.bindFramebuffer(gl.FRAMEBUFFER, this._fbo);
        gl.viewport(0, 0, this.resolution, this.resolution);

        // Clear to black (no light)
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);

        // Enable additive blending for overlapping triangles
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);

        // Disable depth testing for caustic pass
        gl.disable(gl.DEPTH_TEST);

        // Use caustics shader
        this.program.use();

        // Bind height texture
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, heightTexture);
        gl.uniform1i(this.program.uniforms.u_heightTexture, 0);

        // Set uniforms
        gl.uniform3f(this.program.uniforms.u_lightDir, lightDir[0], lightDir[1], lightDir[2]);
        gl.uniform1f(this.program.uniforms.u_poolDepth, poolDepth);
        gl.uniform1f(this.program.uniforms.u_heightScale, heightScale);
        gl.uniform2f(this.program.uniforms.u_texelSize, 1.0 / simResolution, 1.0 / simResolution);

        // Draw water mesh (UNSIGNED_INT for large meshes)
        gl.bindVertexArray(this._meshVAO);
        gl.drawElements(gl.TRIANGLES, this._meshIndexCount, gl.UNSIGNED_INT, 0);
        gl.bindVertexArray(null);

        // Restore state
        gl.disable(gl.BLEND);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    /**
     * Returns the caustic texture for use in other shaders
     */
    get texture() {
        return this._texture;
    }

    /**
     * Cleans up resources
     */
    destroy() {
        const gl = this.gl;
        if (this._fbo) gl.deleteFramebuffer(this._fbo);
        if (this._texture) gl.deleteTexture(this._texture);
        if (this._meshVAO) gl.deleteVertexArray(this._meshVAO);
    }
}
