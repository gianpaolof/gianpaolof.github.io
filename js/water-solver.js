/**
 * Water Solver Orchestration Module
 *
 * Main entry point for the water simulation.
 * Coordinates simulation, rendering, and input handling.
 *
 * @module water-solver
 */

import { DoubleFBO, createProgram, getTextureFormats } from './gl-utils.js';
import { WaterSimulation } from './water-simulation.js';
import { WaterRenderer } from './water-renderer.js';
import { WATER_CONFIG, mergeWaterConfig, WATER_QUALITY_PRESETS } from './water-config.js';

/**
 * Shader paths for water simulation.
 */
export const WATER_SHADER_PATHS = {
    // Vertex shaders
    quadVert: './gl/quad.vert',
    waterMeshVert: './gl/water/water-mesh.vert',

    // Simulation shaders
    waveUpdateFrag: './gl/water/wave-update.frag',
    waveDropFrag: './gl/water/wave-drop.frag',
    waveNormalFrag: './gl/water/wave-normal.frag',

    // Rendering shaders
    waterDisplayFrag: './gl/water/water-display.frag',
    waterSurfaceFrag: './gl/water/water-surface.frag',

    // Utility
    copyFrag: './gl/copy.frag'
};

/**
 * WaterSolver class - main orchestrator for water simulation.
 */
export class WaterSolver {
    /**
     * Creates a new WaterSolver instance.
     *
     * @param {HTMLCanvasElement} canvas - Target canvas element
     * @param {Object} [config={}] - Simulation configuration
     * @param {Object} [sharedContext=null] - Shared WebGL context (optional)
     */
    constructor(canvas, config = {}, sharedContext = null) {
        this.canvas = canvas;
        this.config = mergeWaterConfig(config);

        // Use shared context if provided, otherwise create new
        if (sharedContext) {
            this.gl = sharedContext.gl;
            this.isWebGL2 = sharedContext.isWebGL2;
        } else {
            this.gl = canvas.getContext('webgl2', {
                alpha: false,
                antialias: false,
                preserveDrawingBuffer: false
            });
            this.isWebGL2 = true;
        }

        if (!this.gl) {
            throw new Error('WaterSolver requires WebGL2 support');
        }

        // State
        this._paused = false;
        this._time = 0;
        this._initialized = false;

        // Pending drops
        this._pendingDrops = [];

        // Components (initialized in init())
        this._programs = {};
        this._fbos = {};
        this._simulation = null;
        this._renderer = null;

        // Fullscreen quad VAO
        this._quadVAO = null;
    }

    /**
     * Loads shader source from URL.
     *
     * @param {string} path - Shader path
     * @returns {Promise<string>} Shader source
     */
    async _loadShader(path) {
        const response = await fetch(path);
        if (!response.ok) {
            throw new Error(`Failed to load shader: ${path}`);
        }
        return response.text();
    }

    /**
     * Loads all water shaders.
     *
     * @returns {Promise<Object>} Loaded shader sources
     */
    async _loadShaders() {
        const sources = {};
        const entries = Object.entries(WATER_SHADER_PATHS);

        await Promise.all(entries.map(async ([key, path]) => {
            sources[key] = await this._loadShader(path);
        }));

        return sources;
    }

    /**
     * Initializes the water solver.
     */
    async init() {
        if (this._initialized) return;

        const gl = this.gl;

        // Load shaders
        const shaderSources = await this._loadShaders();

        // Create shader programs
        this._programs = {
            waveUpdate: createProgram(gl, shaderSources.quadVert, shaderSources.waveUpdateFrag),
            waveDrop: createProgram(gl, shaderSources.quadVert, shaderSources.waveDropFrag),
            waveNormal: createProgram(gl, shaderSources.quadVert, shaderSources.waveNormalFrag),
            waterDisplay: createProgram(gl, shaderSources.quadVert, shaderSources.waterDisplayFrag),
            waterMesh: createProgram(gl, shaderSources.waterMeshVert, shaderSources.waterSurfaceFrag),
            copy: createProgram(gl, shaderSources.quadVert, shaderSources.copyFrag)
        };

        // Get texture formats
        const formats = getTextureFormats(gl, this.isWebGL2);

        // Create FBOs for simulation
        const resolution = this.config.resolution;

        // Height field (double-buffered for leapfrog)
        this._fbos = {
            height: new DoubleFBO(gl, resolution, resolution, formats.VELOCITY_FORMAT),
            heightPrev: new DoubleFBO(gl, resolution, resolution, formats.VELOCITY_FORMAT),
            normal: new DoubleFBO(gl, resolution, resolution, formats.DYE_FORMAT)
        };

        // Create fullscreen quad VAO
        this._createQuadVAO();

        // Initialize simulation
        this._simulation = new WaterSimulation(
            gl,
            this._programs,
            this._fbos,
            this.config
        );

        // Initialize renderer
        this._renderer = new WaterRenderer(
            gl,
            this._programs,
            this.config
        );

        // Create renderer resources
        this._renderer.createQuad();
        this._renderer.createMesh(this.config.meshResolution);
        this._renderer.createCubemap();
        this._renderer.createFloorTexture();

        // Clear initial state
        this._simulation.reset();

        this._initialized = true;
    }

    /**
     * Creates the fullscreen quad VAO.
     */
    _createQuadVAO() {
        const gl = this.gl;

        // Attribute-less quad (uses gl_VertexID in shader)
        this._quadVAO = gl.createVertexArray();
        gl.bindVertexArray(this._quadVAO);
        gl.bindVertexArray(null);
    }

    /**
     * Draws a fullscreen quad.
     */
    _drawQuad() {
        const gl = this.gl;
        gl.bindVertexArray(this._quadVAO);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.bindVertexArray(null);
    }

    /**
     * Adds a drop at the specified position.
     *
     * @param {number} x - X position (0-1)
     * @param {number} y - Y position (0-1)
     * @param {number} [radius] - Drop radius
     * @param {number} [strength] - Drop strength
     */
    addDrop(x, y, radius = null, strength = null) {
        if (this._simulation) {
            this._simulation.addDrop(x, y, radius, strength);
        } else {
            this._pendingDrops.push({ x, y, radius, strength });
        }
    }

    /**
     * Performs one simulation step.
     *
     * @param {number} dt - Delta time
     */
    step(dt) {
        if (this._paused || !this._initialized) return;

        // Apply any pending drops
        for (const drop of this._pendingDrops) {
            this._simulation.addDrop(drop.x, drop.y, drop.radius, drop.strength);
        }
        this._pendingDrops = [];

        // Run simulation
        this._simulation.step(dt, () => this._drawQuad());

        this._time += dt;
    }

    /**
     * Renders the water.
     */
    render() {
        if (!this._initialized) return;

        this._renderer.render(
            this._simulation.heightTexture,
            this._simulation.normalTexture,
            this._time
        );
    }

    /**
     * Performs a full update (step + render).
     *
     * @param {number} dt - Delta time
     */
    update(dt) {
        this.step(dt);
        this.render();
    }

    /**
     * Resets the simulation to calm water.
     */
    reset() {
        if (this._simulation) {
            this._simulation.reset();
        }
        this._pendingDrops = [];
        this._time = 0;
    }

    /**
     * Pauses the simulation.
     */
    pause() {
        this._paused = true;
    }

    /**
     * Resumes the simulation.
     */
    resume() {
        this._paused = false;
    }

    /**
     * Checks if paused.
     *
     * @returns {boolean} True if paused
     */
    get paused() {
        return this._paused;
    }

    /**
     * Resizes the canvas.
     *
     * @param {number} width - New width
     * @param {number} height - New height
     */
    resize(width, height) {
        if (this._renderer) {
            this._renderer.resize(width, height);
        }
    }

    /**
     * Updates configuration.
     *
     * @param {Object} newConfig - New configuration values
     */
    updateConfig(newConfig) {
        Object.assign(this.config, mergeWaterConfig(newConfig));
        if (this._simulation) {
            this._simulation.updateConfig(this.config);
        }
    }

    /**
     * Sets 3D rendering mode.
     *
     * @param {boolean} use3D - True for 3D mode
     */
    set use3DMode(use3D) {
        if (this._renderer) {
            this._renderer.use3DMode = use3D;
        }
    }

    get use3DMode() {
        return this._renderer ? this._renderer.use3DMode : false;
    }

    /**
     * Cleans up WebGL resources.
     */
    destroy() {
        const gl = this.gl;

        // Destroy FBOs
        for (const fbo of Object.values(this._fbos)) {
            fbo.destroy();
        }

        // Destroy programs
        for (const program of Object.values(this._programs)) {
            program.destroy();
        }

        // Destroy renderer
        if (this._renderer) {
            this._renderer.destroy();
        }

        // Destroy quad VAO
        if (this._quadVAO) {
            gl.deleteVertexArray(this._quadVAO);
        }

        this._initialized = false;
    }

    /**
     * Gets the current time.
     *
     * @returns {number} Current time
     */
    get time() {
        return this._time;
    }

    /**
     * Checks if initialized.
     *
     * @returns {boolean} True if initialized
     */
    get initialized() {
        return this._initialized;
    }
}
