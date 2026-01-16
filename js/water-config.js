/**
 * Water Simulation Configuration Module
 *
 * Contains all configuration constants and defaults for the water simulation.
 *
 * @module water-config
 */

/**
 * Default water simulation configuration.
 *
 * @type {Object}
 */
export const WATER_CONFIG = {
    // Simulation parameters
    resolution: 256,           // Heightfield resolution (256x256)
    waveSpeed: 2.0,           // Wave propagation speed (m/s)
    damping: 0.998,           // Wave amplitude decay per step
    substeps: 3,              // Simulation substeps per frame (for CFL stability)

    // Interaction
    dropRadius: 0.04,         // Default drop radius (normalized)
    dropStrength: 0.008,      // Default drop strength (very small for subtle waves)

    // Rendering
    meshResolution: 128,      // Water surface mesh resolution
    heightScale: 0.04,        // Height displacement scale (very small!)
    poolDepth: 1.0,           // Pool depth for refraction

    // Effects
    reflectionEnabled: true,
    refractionEnabled: true,
    causticsEnabled: false,   // Advanced feature (Phase 5)

    // Colors and absorption
    waterColor: [0.1, 0.3, 0.5],
    absorptionCoeff: [0.2, 0.1, 0.05],  // RGB absorption for Beer's law

    // Fresnel
    refractiveIndex: 1.33,    // Water IOR
    fresnelR0: 0.02           // Schlick R0 for air-water interface
};

/**
 * Quality presets for different device capabilities.
 *
 * @type {Object.<string, Object>}
 */
export const WATER_QUALITY_PRESETS = {
    desktop: {
        resolution: 256,
        meshResolution: 128,
        substeps: 3,
        causticsEnabled: true,
        targetFPS: 60
    },
    mobile: {
        resolution: 128,
        meshResolution: 64,
        substeps: 2,
        causticsEnabled: false,
        targetFPS: 30
    },
    fallback: {
        resolution: 64,
        meshResolution: 32,
        substeps: 1,
        causticsEnabled: false,
        targetFPS: 30
    }
};

/**
 * Clamps a water configuration value to valid range.
 *
 * @param {string} key - Configuration key
 * @param {number} value - Value to clamp
 * @returns {number} Clamped value
 */
export function clampWaterConfigValue(key, value) {
    const ranges = {
        resolution: [64, 512],
        waveSpeed: [0.1, 10.0],
        damping: [0.9, 1.0],
        substeps: [1, 10],
        dropRadius: [0.005, 0.2],
        dropStrength: [0.001, 2.0],
        meshResolution: [32, 256],
        heightScale: [0.01, 1.0],
        poolDepth: [0.1, 5.0],
        refractiveIndex: [1.0, 2.0]
    };

    if (ranges[key]) {
        const [min, max] = ranges[key];
        return Math.max(min, Math.min(max, value));
    }

    return value;
}

/**
 * Merges user config with water defaults.
 *
 * @param {Object} userConfig - User-provided configuration
 * @returns {Object} Merged configuration
 */
export function mergeWaterConfig(userConfig = {}) {
    const merged = { ...WATER_CONFIG };

    for (const [key, value] of Object.entries(userConfig)) {
        if (key in WATER_CONFIG) {
            merged[key] = typeof value === 'number'
                ? clampWaterConfigValue(key, value)
                : value;
        }
    }

    return merged;
}
