/**
 * Pool Demo - Main orchestrator for realistic 3D water pool simulation
 *
 * Features:
 * - Physical caustics using Jacobian technique
 * - 3D pool geometry (floor, walls, sphere)
 * - Orbit camera controls
 * - Reuses existing water simulation
 */

import { createContext, getExtensions, createProgram, getTextureFormats, DoubleFBO } from '../js/gl-utils.js';
import { OrbitCamera } from './orbit-camera.js';
import { PoolScene } from './pool-scene.js';
import { CausticsRenderer } from './caustics-renderer.js';

// Configuration
const CONFIG = {
    simResolution: 256,
    meshResolution: 128,
    causticResolution: 512,
    poolWidth: 2.0,
    poolDepth: 1.0,
    waveSpeed: 1.5,
    damping: 0.995,
    heightScale: 0.5,
    dropRadius: 0.08,
    dropStrength: 0.4
};

class PoolDemo {
    constructor(canvas) {
        this.canvas = canvas;

        // WebGL context
        const { gl, isWebGL2 } = createContext(canvas);
        if (!isWebGL2) {
            throw new Error('WebGL2 required for this demo');
        }
        this.gl = gl;

        // Enable extensions
        gl.getExtension('EXT_color_buffer_float');
        gl.getExtension('OES_texture_float_linear');

        // Get texture formats
        this.formats = getTextureFormats(gl, true);

        // Components
        this.camera = new OrbitCamera(canvas);
        this.poolScene = null;
        this.causticsRenderer = null;

        // Shader programs
        this.programs = {};

        // Simulation state
        this._heightFBO = null;
        this._prevHeightFBO = null;
        this._normalFBO = null;

        // Light direction (normalized, pointing toward light source)
        this._lightDir = [0.3, 1.0, 0.5];
        this._normalizeVec3(this._lightDir);

        // Caustic intensity
        this._causticIntensity = 1.0;

        // Matrices
        this._mvpMatrix = new Float32Array(16);
        this._modelMatrix = new Float32Array(16);
        this._setIdentity(this._modelMatrix);

        // Time tracking
        this._lastTime = 0;
        this._frameCount = 0;
        this._fpsTime = 0;

        // Pending drops
        this._pendingDrops = [];

        // Animation state
        this._animationId = null;
    }

    async init() {
        const gl = this.gl;

        // Load all shaders
        await this._loadShaders();

        // Create simulation FBOs
        this._createSimulationFBOs();

        // Create pool scene
        this.poolScene = new PoolScene(gl, CONFIG.poolWidth, CONFIG.poolDepth);

        // Create caustics renderer
        this.causticsRenderer = new CausticsRenderer(gl, CONFIG.causticResolution);
        this.causticsRenderer.program = this.programs.caustics;

        // Create water mesh
        this._createWaterMesh();

        // Setup input handlers
        this._setupInputHandlers();

        // Handle resize
        this._resize();
        window.addEventListener('resize', () => this._resize());

        // Add initial drops for some action
        setTimeout(() => {
            this.addDrop(0.5, 0.5);
        }, 300);
        setTimeout(() => {
            this.addDrop(0.3, 0.7);
            this.addDrop(0.7, 0.3);
        }, 800);

        // Add periodic automatic drops for continuous demo effect
        this._autoDropInterval = setInterval(() => {
            const x = 0.2 + Math.random() * 0.6;
            const y = 0.2 + Math.random() * 0.6;
            this.addDrop(x, y);
        }, 3000);
    }

    async _loadShaders() {
        const gl = this.gl;

        // Helper to load shader source
        const loadShader = async (path) => {
            const response = await fetch(path);
            if (!response.ok) throw new Error(`Failed to load shader: ${path}`);
            return response.text();
        };

        // Load all shader sources in parallel
        const [
            // Common shaders
            quadVert,
            copyFrag,

            // Water simulation shaders
            waveUpdateFrag,
            waveDropFrag,
            waveNormalFrag,

            // Caustics shaders
            causticsVert,
            causticsFrag,

            // Pool shaders
            poolVert,
            poolFrag,

            // Sphere shaders
            sphereVert,
            sphereFrag,

            // Water surface shaders
            waterMeshVert,
            waterSurfaceFrag
        ] = await Promise.all([
            // Common
            loadShader('../gl/quad.vert'),
            loadShader('../gl/copy.frag'),

            // Water simulation
            loadShader('../gl/water/wave-update.frag'),
            loadShader('../gl/water/wave-drop.frag'),
            loadShader('../gl/water/wave-normal.frag'),

            // Caustics
            loadShader('./shaders/caustics.vert'),
            loadShader('./shaders/caustics.frag'),

            // Pool
            loadShader('./shaders/pool.vert'),
            loadShader('./shaders/pool.frag'),

            // Sphere
            loadShader('./shaders/sphere.vert'),
            loadShader('./shaders/sphere.frag'),

            // Water surface
            loadShader('../gl/water/water-mesh.vert'),
            loadShader('../gl/water/water-surface.frag')
        ]);

        // Compile programs
        this.programs.waveUpdate = createProgram(gl, quadVert, waveUpdateFrag);
        this.programs.waveDrop = createProgram(gl, quadVert, waveDropFrag);
        this.programs.waveNormal = createProgram(gl, quadVert, waveNormalFrag);
        this.programs.copy = createProgram(gl, quadVert, copyFrag);
        this.programs.caustics = createProgram(gl, causticsVert, causticsFrag);
        this.programs.pool = createProgram(gl, poolVert, poolFrag);
        this.programs.sphere = createProgram(gl, sphereVert, sphereFrag);
        this.programs.waterSurface = createProgram(gl, waterMeshVert, waterSurfaceFrag);
    }

    _createSimulationFBOs() {
        const gl = this.gl;
        const res = CONFIG.simResolution;

        // Use RGBA16F like Evan - stores height(r), velocity(g), normal.x(b), normal.z(a)
        const waterFormat = {
            internalFormat: gl.RGBA16F,
            format: gl.RGBA,
            type: gl.HALF_FLOAT,
            filter: gl.LINEAR
        };

        const normalFormat = {
            internalFormat: gl.RGBA16F,
            format: gl.RGBA,
            type: gl.HALF_FLOAT,
            filter: gl.LINEAR
        };

        // Single water texture (height + velocity), no need for separate prev texture
        this._heightFBO = new DoubleFBO(gl, res, res, waterFormat);
        this._normalFBO = new DoubleFBO(gl, res, res, normalFormat);
    }

    _createWaterMesh() {
        const gl = this.gl;
        const res = CONFIG.meshResolution;

        const vertices = [];
        const texCoords = [];
        const indices = [];

        // Generate grid
        for (let z = 0; z <= res; z++) {
            for (let x = 0; x <= res; x++) {
                vertices.push((x / res) * 2 - 1, 0, (z / res) * 2 - 1);
                texCoords.push(x / res, z / res);
            }
        }

        for (let z = 0; z < res; z++) {
            for (let x = 0; x < res; x++) {
                const tl = z * (res + 1) + x;
                const tr = tl + 1;
                const bl = (z + 1) * (res + 1) + x;
                const br = bl + 1;
                indices.push(tl, bl, tr, tr, bl, br);
            }
        }

        this._waterMeshVAO = gl.createVertexArray();
        gl.bindVertexArray(this._waterMeshVAO);

        const posBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

        const texBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, texBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(texCoords), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);

        const indexBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);

        gl.bindVertexArray(null);

        this._waterMeshIndexCount = indices.length;

        // Create quad VAO for simulation passes (attribute-less rendering)
        this._quadVAO = gl.createVertexArray();
        // No buffers needed - quad.vert generates vertices from gl_VertexID
    }

    _setupInputHandlers() {
        const canvas = this.canvas;

        // Click to add drops (left click only when not dragging camera)
        canvas.addEventListener('click', (e) => {
            if (this.camera.isDragging) return;

            const rect = canvas.getBoundingClientRect();
            const x = (e.clientX - rect.left) / rect.width;
            const y = 1 - (e.clientY - rect.top) / rect.height;

            this.addDrop(x, y);
        });

        // Helper to bind slider
        const bindSlider = (paramId, valueId, callback) => {
            const slider = document.getElementById(paramId);
            const valueEl = document.getElementById(valueId);
            if (slider) {
                slider.addEventListener('input', (e) => {
                    const val = parseFloat(e.target.value);
                    if (valueEl) {
                        valueEl.textContent = val % 1 === 0 ? val : val.toFixed(val < 1 ? 3 : 1);
                    }
                    callback(val);
                });
            }
        };

        // Wave Physics
        bindSlider('param-waveSpeed', 'value-waveSpeed', (v) => { CONFIG.waveSpeed = v; });
        bindSlider('param-damping', 'value-damping', (v) => { CONFIG.damping = v; });
        bindSlider('param-heightScale', 'value-heightScale', (v) => { CONFIG.heightScale = v; });

        // Drop Settings
        bindSlider('param-dropRadius', 'value-dropRadius', (v) => { CONFIG.dropRadius = v; });
        bindSlider('param-dropStrength', 'value-dropStrength', (v) => { CONFIG.dropStrength = v; });

        // Lighting
        bindSlider('param-lightAngle', 'value-lightAngle', (v) => {
            const angle = v * Math.PI / 180;
            this._lightDir[0] = Math.sin(angle) * 0.5;
            this._lightDir[1] = Math.cos(angle);
            this._lightDir[2] = 0.3;
            this._normalizeVec3(this._lightDir);
        });
        bindSlider('param-causticIntensity', 'value-causticIntensity', (v) => { this._causticIntensity = v; });

        // Buttons
        document.getElementById('btn-reset')?.addEventListener('click', () => this._resetWater());
        document.getElementById('btn-drop')?.addEventListener('click', () => {
            const x = 0.3 + Math.random() * 0.4;
            const y = 0.3 + Math.random() * 0.4;
            this.addDrop(x, y);
        });

        // Presets
        const setPreset = (preset) => {
            document.querySelectorAll('.preset-btn').forEach(btn => btn.classList.remove('active'));
            document.getElementById(`preset-${preset}`)?.classList.add('active');

            const presets = {
                calm: { waveSpeed: 0.8, damping: 0.998, heightScale: 0.3, dropRadius: 0.06, dropStrength: 0.2 },
                normal: { waveSpeed: 1.5, damping: 0.995, heightScale: 0.5, dropRadius: 0.08, dropStrength: 0.4 },
                stormy: { waveSpeed: 3.0, damping: 0.99, heightScale: 1.0, dropRadius: 0.12, dropStrength: 0.8 }
            };

            const p = presets[preset];
            if (p) {
                CONFIG.waveSpeed = p.waveSpeed;
                CONFIG.damping = p.damping;
                CONFIG.heightScale = p.heightScale;
                CONFIG.dropRadius = p.dropRadius;
                CONFIG.dropStrength = p.dropStrength;

                // Update sliders
                this._updateSlider('param-waveSpeed', 'value-waveSpeed', p.waveSpeed);
                this._updateSlider('param-damping', 'value-damping', p.damping);
                this._updateSlider('param-heightScale', 'value-heightScale', p.heightScale);
                this._updateSlider('param-dropRadius', 'value-dropRadius', p.dropRadius);
                this._updateSlider('param-dropStrength', 'value-dropStrength', p.dropStrength);
            }
        };

        document.getElementById('preset-calm')?.addEventListener('click', () => setPreset('calm'));
        document.getElementById('preset-normal')?.addEventListener('click', () => setPreset('normal'));
        document.getElementById('preset-stormy')?.addEventListener('click', () => setPreset('stormy'));
    }

    _updateSlider(sliderId, valueId, value) {
        const slider = document.getElementById(sliderId);
        const valueEl = document.getElementById(valueId);
        if (slider) slider.value = value;
        if (valueEl) valueEl.textContent = value % 1 === 0 ? value : value.toFixed(value < 1 ? 3 : 1);
    }

    _resetWater() {
        const gl = this.gl;
        const res = CONFIG.simResolution;

        // Clear water FBO (both sides)
        gl.bindFramebuffer(gl.FRAMEBUFFER, this._heightFBO.writeFramebuffer);
        gl.viewport(0, 0, res, res);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        this._heightFBO.swap();

        gl.bindFramebuffer(gl.FRAMEBUFFER, this._heightFBO.writeFramebuffer);
        gl.clear(gl.COLOR_BUFFER_BIT);

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    addDrop(x, y) {
        this._pendingDrops.push({ x, y });
    }

    _resize() {
        const canvas = this.canvas;
        const dpr = window.devicePixelRatio || 1;
        const width = canvas.clientWidth * dpr;
        const height = canvas.clientHeight * dpr;

        if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
        }

        this.camera.resize(width, height);
    }

    start() {
        this._lastTime = performance.now();
        this._fpsTime = this._lastTime;
        this._frameCount = 0;
        this._animationId = requestAnimationFrame((t) => this._loop(t));
    }

    stop() {
        if (this._animationId) {
            cancelAnimationFrame(this._animationId);
            this._animationId = null;
        }
    }

    _loop(time) {
        const dt = Math.min((time - this._lastTime) / 1000, 0.033);
        this._lastTime = time;

        // FPS counter
        this._frameCount++;
        if (time - this._fpsTime >= 1000) {
            const fps = Math.round(this._frameCount * 1000 / (time - this._fpsTime));
            document.getElementById('fps').textContent = `FPS: ${fps}`;
            this._frameCount = 0;
            this._fpsTime = time;
        }

        // Simulation step
        this._simulationStep(dt);

        // Render
        this._render(time / 1000);

        this._animationId = requestAnimationFrame((t) => this._loop(t));
    }

    _simulationStep(dt) {
        // Apply pending drops
        for (const drop of this._pendingDrops) {
            this._applyDrop(drop.x, drop.y);
        }
        this._pendingDrops = [];

        // Evan's approach: call stepSimulation twice per frame
        this._updateWaves(dt);
        this._updateWaves(dt);

        // Compute normals from final height
        this._computeNormals();
    }

    _applyDrop(x, y) {
        const gl = this.gl;
        const program = this.programs.waveDrop;
        const res = CONFIG.simResolution;

        this._heightFBO.bindWrite();
        program.use();

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this._heightFBO.texture);
        gl.uniform1i(program.uniforms.u_height, 0);

        gl.uniform2f(program.uniforms.u_texelSize, 1.0 / res, 1.0 / res);
        gl.uniform2f(program.uniforms.u_dropPosition, x, y);
        gl.uniform1f(program.uniforms.u_dropRadius, CONFIG.dropRadius);
        gl.uniform1f(program.uniforms.u_dropStrength, CONFIG.dropStrength);
        gl.uniform1f(program.uniforms.u_aspectRatio, 1.0);  // Square simulation

        gl.bindVertexArray(this._quadVAO);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.bindVertexArray(null);

        this._heightFBO.swap();
    }

    _updateWaves(dt) {
        const gl = this.gl;
        const program = this.programs.waveUpdate;
        const res = CONFIG.simResolution;

        // Evan Wallace's simple approach - just update in place
        this._heightFBO.bindWrite();
        program.use();

        // Current water state (height in .r, velocity in .g)
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this._heightFBO.texture);
        gl.uniform1i(program.uniforms.u_heightCurrent, 0);

        gl.uniform2f(program.uniforms.u_texelSize, 1.0 / res, 1.0 / res);

        gl.bindVertexArray(this._quadVAO);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.bindVertexArray(null);

        // Swap so updated texture becomes readable
        this._heightFBO.swap();
    }

    _copyTexture(srcTexture, destFBO) {
        const gl = this.gl;
        const program = this.programs.copy;

        destFBO.bindWrite();
        program.use();

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, srcTexture);
        gl.uniform1i(program.uniforms.u_texture, 0);

        gl.bindVertexArray(this._quadVAO);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.bindVertexArray(null);

        destFBO.swap();
    }

    _computeNormals() {
        const gl = this.gl;
        const program = this.programs.waveNormal;
        const res = CONFIG.simResolution;

        this._normalFBO.bindWrite();
        program.use();

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this._heightFBO.texture);
        gl.uniform1i(program.uniforms.u_height, 0);

        gl.uniform2f(program.uniforms.u_texelSize, 1.0 / res, 1.0 / res);
        gl.uniform1f(program.uniforms.u_heightScale, CONFIG.heightScale);

        gl.bindVertexArray(this._quadVAO);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.bindVertexArray(null);

        this._normalFBO.swap();
    }

    _render(time) {
        const gl = this.gl;

        // Compute caustics
        this.causticsRenderer.render(
            this._heightFBO.texture,
            this._lightDir,
            CONFIG.poolDepth,
            CONFIG.heightScale,
            CONFIG.simResolution
        );

        // Setup main render
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        gl.clearColor(0.05, 0.08, 0.12, 1.0);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.enable(gl.DEPTH_TEST);

        // Compute MVP matrix
        this._multiplyMatrices(this._mvpMatrix, this.camera.projectionMatrix, this.camera.viewMatrix);
        this._multiplyMatrices(this._mvpMatrix, this._mvpMatrix, this._modelMatrix);

        // Render pool floor
        this.poolScene.renderFloor(
            this.programs.pool,
            this._mvpMatrix,
            this._modelMatrix,
            this.causticsRenderer.texture,
            this._lightDir,
            this._causticIntensity
        );

        // Render pool walls
        this.poolScene.renderWalls(
            this.programs.pool,
            this._mvpMatrix,
            this._modelMatrix,
            this.causticsRenderer.texture,
            this._lightDir,
            this._causticIntensity
        );

        // Render sphere
        this.poolScene.renderSphere(
            this.programs.sphere,
            this._mvpMatrix,
            this.causticsRenderer.texture,
            this._lightDir,
            this.camera.position,
            this._causticIntensity
        );

        // Render water surface
        this._renderWaterSurface(time);

        gl.disable(gl.DEPTH_TEST);
    }

    _renderWaterSurface(time) {
        const gl = this.gl;
        const program = this.programs.waterSurface;

        program.use();

        gl.uniformMatrix4fv(program.uniforms.u_modelViewProjection, false, this._mvpMatrix);
        gl.uniformMatrix4fv(program.uniforms.u_modelMatrix, false, this._modelMatrix);
        gl.uniform1f(program.uniforms.u_heightScale, CONFIG.heightScale);
        gl.uniform2f(program.uniforms.u_texelSize, 1.0 / CONFIG.simResolution, 1.0 / CONFIG.simResolution);

        gl.uniform3f(program.uniforms.u_cameraPos, ...this.camera.position);
        gl.uniform3f(program.uniforms.u_lightDir, ...this._lightDir);
        gl.uniform1f(program.uniforms.u_poolDepth, CONFIG.poolDepth);
        gl.uniform1f(program.uniforms.u_time, time);
        gl.uniform1f(program.uniforms.u_causticIntensity, this._causticIntensity);

        // Bind heightfield (texture unit 0)
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this._heightFBO.texture);
        gl.uniform1i(program.uniforms.u_heightfield, 0);

        // Bind caustic texture (texture unit 1)
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.causticsRenderer.texture);
        gl.uniform1i(program.uniforms.u_causticTexture, 1);

        // Draw water mesh
        gl.bindVertexArray(this._waterMeshVAO);
        gl.drawElements(gl.TRIANGLES, this._waterMeshIndexCount, gl.UNSIGNED_SHORT, 0);
        gl.bindVertexArray(null);
    }

    // Matrix utilities
    _setIdentity(m) {
        m.fill(0);
        m[0] = m[5] = m[10] = m[15] = 1;
    }

    _multiplyMatrices(out, a, b) {
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

    _normalizeVec3(v) {
        const len = Math.sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2]);
        v[0] /= len;
        v[1] /= len;
        v[2] /= len;
    }
}

// Initialize and start
async function main() {
    const canvas = document.getElementById('pool-canvas');
    if (!canvas) {
        console.error('Canvas not found');
        return;
    }

    try {
        const demo = new PoolDemo(canvas);
        await demo.init();
        demo.start();
        console.log('Pool demo started');
    } catch (error) {
        console.error('Failed to initialize pool demo:', error);
        document.body.innerHTML = `<div style="color: white; padding: 20px; font-family: sans-serif;">
            <h2>Error</h2>
            <p>${error.message}</p>
            <p>This demo requires WebGL2 support.</p>
        </div>`;
    }
}

main();
