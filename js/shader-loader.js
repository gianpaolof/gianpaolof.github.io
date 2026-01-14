/**
 * Shader Loader Module
 *
 * Provides utilities for loading external GLSL shader files.
 * Uses fetch API for async loading.
 *
 * @module shader-loader
 */

/**
 * Cache for loaded shader sources
 * @type {Map<string, string>}
 */
const shaderCache = new Map();

/**
 * Loads a single shader file from the given path.
 *
 * @param {string} path - Path to the shader file
 * @returns {Promise<string>} The shader source code
 * @throws {Error} If the shader file cannot be loaded
 */
export async function loadShader(path) {
    // Check cache first
    if (shaderCache.has(path)) {
        return shaderCache.get(path);
    }

    const response = await fetch(path);
    if (!response.ok) {
        throw new Error(`Failed to load shader: ${path} (${response.status} ${response.statusText})`);
    }

    const source = await response.text();
    shaderCache.set(path, source);
    return source;
}

/**
 * Loads multiple shader files in parallel.
 *
 * @param {Object<string, string>} paths - Map of shader names to file paths
 * @returns {Promise<Object<string, string>>} Map of shader names to source code
 * @throws {Error} If any shader file cannot be loaded
 *
 * @example
 * const shaders = await loadShaders({
 *     quadVert: './gl/quad.vert',
 *     advectFrag: './gl/advect.frag'
 * });
 */
export async function loadShaders(paths) {
    const entries = await Promise.all(
        Object.entries(paths).map(async ([name, path]) => {
            const source = await loadShader(path);
            return [name, source];
        })
    );
    return Object.fromEntries(entries);
}

/**
 * Clears the shader cache.
 * Useful for hot-reloading during development.
 */
export function clearShaderCache() {
    shaderCache.clear();
}

/**
 * Gets a cached shader source if available.
 *
 * @param {string} path - Path to the shader file
 * @returns {string|undefined} The cached shader source, or undefined
 */
export function getCachedShader(path) {
    return shaderCache.get(path);
}

/**
 * Default shader paths for the fluid simulation.
 * These are relative to the project root.
 */
export const SHADER_PATHS = {
    // Vertex shader
    quadVert: './gl/quad.vert',

    // Simulation shaders
    advectFrag: './gl/advect.frag',
    forcesFrag: './gl/forces.frag',
    dyeFrag: './gl/dye.frag',
    divergenceFrag: './gl/divergence.frag',
    pressureFrag: './gl/pressure.frag',
    gradientFrag: './gl/gradient.frag',
    curlFrag: './gl/curl.frag',
    vorticityFrag: './gl/vorticity.frag',
    clearFrag: './gl/clear.frag',
    splatFrag: './gl/splat.frag',
    copyFrag: './gl/copy.frag',

    // Hurricane shader
    hurricaneFrag: './gl/hurricane.frag',

    // Display and effects shaders
    displayFrag: './gl/display.frag',
    bloomPrefilterFrag: './gl/bloom-prefilter.frag',
    blurFrag: './gl/blur.frag',
    bloomFinalFrag: './gl/bloom-final.frag',
    sunraysMaskFrag: './gl/sunrays-mask.frag',
    sunraysFrag: './gl/sunrays.frag'
};
