/**
 * Pool Scene - Generates and renders pool geometry (floor, walls, sphere)
 */
export class PoolScene {
    constructor(gl, poolWidth = 2.0, poolDepth = 1.0) {
        this.gl = gl;
        this.poolWidth = poolWidth;
        this.poolDepth = poolDepth;

        // Sphere properties
        this.sphereRadius = 0.25;
        this.sphereCenter = [0, -poolDepth + this.sphereRadius, 0];

        // VAOs
        this._floorVAO = null;
        this._wallsVAO = null;
        this._sphereVAO = null;

        // Index counts
        this._floorIndexCount = 0;
        this._wallsIndexCount = 0;
        this._sphereIndexCount = 0;

        this._createFloor();
        this._createWalls();
        this._createSphere();
    }

    /**
     * Creates the pool floor (a quad at y = -poolDepth)
     */
    _createFloor() {
        const gl = this.gl;
        const hw = this.poolWidth / 2;  // Half width
        const d = -this.poolDepth;

        // Vertices: position (3), normal (3), texCoord (2)
        const vertices = new Float32Array([
            // Position          Normal           TexCoord
            -hw, d, -hw,         0, 1, 0,         0, 0,
             hw, d, -hw,         0, 1, 0,         1, 0,
             hw, d,  hw,         0, 1, 0,         1, 1,
            -hw, d,  hw,         0, 1, 0,         0, 1,
        ]);

        const indices = new Uint16Array([
            0, 1, 2,
            0, 2, 3
        ]);

        this._floorVAO = this._createVAO(vertices, indices);
        this._floorIndexCount = indices.length;
    }

    /**
     * Creates the four pool walls
     */
    _createWalls() {
        const gl = this.gl;
        const hw = this.poolWidth / 2;
        const d = -this.poolDepth;

        // All 4 walls: each wall is a quad from floor to water surface (y=0)
        const vertices = [];
        const indices = [];
        let vertexOffset = 0;

        // Wall helper: adds a wall quad
        const addWall = (p1, p2, p3, p4, normal, u1, u2) => {
            const baseVertex = vertexOffset;

            // 4 vertices per wall
            vertices.push(
                ...p1, ...normal, 0, 0,
                ...p2, ...normal, u1, 0,
                ...p3, ...normal, u1, u2,
                ...p4, ...normal, 0, u2
            );

            // 2 triangles per wall
            indices.push(
                baseVertex, baseVertex + 1, baseVertex + 2,
                baseVertex, baseVertex + 2, baseVertex + 3
            );

            vertexOffset += 4;
        };

        // Front wall (z = hw, facing -Z)
        addWall(
            [-hw, d, hw], [hw, d, hw], [hw, 0, hw], [-hw, 0, hw],
            [0, 0, -1], this.poolWidth, this.poolDepth
        );

        // Back wall (z = -hw, facing +Z)
        addWall(
            [hw, d, -hw], [-hw, d, -hw], [-hw, 0, -hw], [hw, 0, -hw],
            [0, 0, 1], this.poolWidth, this.poolDepth
        );

        // Left wall (x = -hw, facing +X)
        addWall(
            [-hw, d, -hw], [-hw, d, hw], [-hw, 0, hw], [-hw, 0, -hw],
            [1, 0, 0], this.poolWidth, this.poolDepth
        );

        // Right wall (x = hw, facing -X)
        addWall(
            [hw, d, hw], [hw, d, -hw], [hw, 0, -hw], [hw, 0, hw],
            [-1, 0, 0], this.poolWidth, this.poolDepth
        );

        this._wallsVAO = this._createVAO(new Float32Array(vertices), new Uint16Array(indices));
        this._wallsIndexCount = indices.length;
    }

    /**
     * Creates a UV sphere for the submerged ball
     */
    _createSphere() {
        const gl = this.gl;
        const segments = 32;
        const rings = 16;

        const vertices = [];
        const indices = [];

        // Generate vertices
        for (let ring = 0; ring <= rings; ring++) {
            const phi = (ring / rings) * Math.PI;  // 0 to PI
            const sinPhi = Math.sin(phi);
            const cosPhi = Math.cos(phi);

            for (let seg = 0; seg <= segments; seg++) {
                const theta = (seg / segments) * Math.PI * 2;  // 0 to 2*PI
                const sinTheta = Math.sin(theta);
                const cosTheta = Math.cos(theta);

                // Position on unit sphere
                const x = cosTheta * sinPhi;
                const y = cosPhi;
                const z = sinTheta * sinPhi;

                // Normal = position for unit sphere
                // Position, Normal (same), TexCoord (not used)
                vertices.push(
                    x, y, z,    // position
                    x, y, z,    // normal
                    seg / segments, ring / rings  // texCoord
                );
            }
        }

        // Generate indices
        for (let ring = 0; ring < rings; ring++) {
            for (let seg = 0; seg < segments; seg++) {
                const current = ring * (segments + 1) + seg;
                const next = current + segments + 1;

                // Two triangles per quad
                indices.push(current, next, current + 1);
                indices.push(current + 1, next, next + 1);
            }
        }

        this._sphereVAO = this._createVAO(new Float32Array(vertices), new Uint16Array(indices));
        this._sphereIndexCount = indices.length;
    }

    /**
     * Creates a VAO from vertex and index data
     * Vertex format: position (3) + normal (3) + texCoord (2) = 8 floats
     */
    _createVAO(vertices, indices) {
        const gl = this.gl;

        const vao = gl.createVertexArray();
        gl.bindVertexArray(vao);

        // Vertex buffer
        const vbo = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
        gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

        const stride = 8 * 4;  // 8 floats * 4 bytes

        // Position (location 0)
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);

        // Normal (location 1)
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 3 * 4);

        // TexCoord (location 2)
        gl.enableVertexAttribArray(2);
        gl.vertexAttribPointer(2, 2, gl.FLOAT, false, stride, 6 * 4);

        // Index buffer
        const ebo = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ebo);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

        gl.bindVertexArray(null);

        return vao;
    }

    /**
     * Renders the pool floor
     */
    renderFloor(program, mvpMatrix, modelMatrix, causticTexture, lightDir, causticIntensity) {
        const gl = this.gl;

        program.use();

        gl.uniformMatrix4fv(program.uniforms.u_mvp, false, mvpMatrix);
        gl.uniformMatrix4fv(program.uniforms.u_model, false, modelMatrix);
        gl.uniform3f(program.uniforms.u_lightDir, lightDir[0], lightDir[1], lightDir[2]);
        gl.uniform1f(program.uniforms.u_poolDepth, this.poolDepth);
        gl.uniform1f(program.uniforms.u_causticIntensity, causticIntensity);

        // Bind caustic texture
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, causticTexture);
        gl.uniform1i(program.uniforms.u_causticTexture, 0);

        gl.bindVertexArray(this._floorVAO);
        gl.drawElements(gl.TRIANGLES, this._floorIndexCount, gl.UNSIGNED_SHORT, 0);
        gl.bindVertexArray(null);
    }

    /**
     * Renders the pool walls
     */
    renderWalls(program, mvpMatrix, modelMatrix, causticTexture, lightDir, causticIntensity) {
        const gl = this.gl;

        program.use();

        gl.uniformMatrix4fv(program.uniforms.u_mvp, false, mvpMatrix);
        gl.uniformMatrix4fv(program.uniforms.u_model, false, modelMatrix);
        gl.uniform3f(program.uniforms.u_lightDir, lightDir[0], lightDir[1], lightDir[2]);
        gl.uniform1f(program.uniforms.u_poolDepth, this.poolDepth);
        gl.uniform1f(program.uniforms.u_causticIntensity, causticIntensity);

        // Bind caustic texture
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, causticTexture);
        gl.uniform1i(program.uniforms.u_causticTexture, 0);

        gl.bindVertexArray(this._wallsVAO);
        gl.drawElements(gl.TRIANGLES, this._wallsIndexCount, gl.UNSIGNED_SHORT, 0);
        gl.bindVertexArray(null);
    }

    /**
     * Renders the submerged sphere
     */
    renderSphere(program, mvpMatrix, causticTexture, lightDir, cameraPos, causticIntensity) {
        const gl = this.gl;

        program.use();

        gl.uniformMatrix4fv(program.uniforms.u_mvp, false, mvpMatrix);
        gl.uniform3f(program.uniforms.u_sphereCenter, ...this.sphereCenter);
        gl.uniform1f(program.uniforms.u_sphereRadius, this.sphereRadius);
        gl.uniform3f(program.uniforms.u_lightDir, lightDir[0], lightDir[1], lightDir[2]);
        gl.uniform3f(program.uniforms.u_cameraPos, cameraPos[0], cameraPos[1], cameraPos[2]);
        gl.uniform1f(program.uniforms.u_poolDepth, this.poolDepth);
        gl.uniform1f(program.uniforms.u_causticIntensity, causticIntensity);

        // Bind caustic texture
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, causticTexture);
        gl.uniform1i(program.uniforms.u_causticTexture, 0);

        gl.bindVertexArray(this._sphereVAO);
        gl.drawElements(gl.TRIANGLES, this._sphereIndexCount, gl.UNSIGNED_SHORT, 0);
        gl.bindVertexArray(null);
    }

    /**
     * Cleans up WebGL resources
     */
    destroy() {
        const gl = this.gl;
        if (this._floorVAO) gl.deleteVertexArray(this._floorVAO);
        if (this._wallsVAO) gl.deleteVertexArray(this._wallsVAO);
        if (this._sphereVAO) gl.deleteVertexArray(this._sphereVAO);
    }
}
