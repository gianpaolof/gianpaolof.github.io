/**
 * Configuration Module
 *
 * Contains all configuration constants and defaults for the fluid simulation.
 *
 * @module config
 */

/**
 * Aurora Borealis color palette.
 * Used for random splat generation.
 *
 * @type {Object.<string, number[]>}
 */
export const COLORS = {
    bg: [0.02, 0.02, 0.04],        // #050510
    primary: [0.0, 1.0, 0.53],     // #00FF87
    secondary: [0.49, 0.23, 0.93], // #7C3AED
    accent: [0.0, 0.83, 1.0]       // #00D4FF
};

/**
 * Default simulation configuration.
 *
 * Based on Pavel Dobryakov's WebGL Fluid implementation
 * with optimizations for modern GPUs.
 *
 * @type {Object}
 */
export const DEFAULT_CONFIG = {
    // Grid resolution
    gridSize: 128,              // SIM_RESOLUTION - velocity field resolution
    dyeSize: 1024,              // DYE_RESOLUTION - color field resolution (higher = sharper details)

    // Pressure solver
    pressureIterations: 20,     // Number of Jacobi iterations
    pressure: 0.8,              // Pressure coefficient for convergence acceleration

    // Dissipation
    velocityDissipation: 0.2,   // Velocity decay rate (lower = more persistent)
    dyeDissipation: 1.0,        // Dye decay rate (1.0 = no dissipation)

    // Vorticity confinement
    curl: 30,                   // Vorticity strength (creates swirls)

    // Splat settings (for user interaction)
    splatRadius: 0.0025,        // Radius of color/force injection
    splatForce: 6000,           // Force magnitude when injecting

    // Legacy force settings (for procedural noise)
    forceRadius: 0.0025,
    forceStrength: 6000,
    noiseScale: 4.0,
    noiseStrength: 0.0,
    intensity: 1.0,

    // Bloom effect
    bloomEnabled: true,
    bloomIntensity: 0.8,
    bloomThreshold: 0.6,
    bloomSoftKnee: 0.7,
    bloomIterations: 8,

    // Sunrays effect (volumetric light scattering)
    sunraysEnabled: true,
    sunraysResolution: 196,
    sunraysWeight: 1.0,

    // Display options
    shadingEnabled: true,       // 3D "oily" effect

    // Color animation
    colorUpdateSpeed: 10
};

/**
 * Quality presets for different device capabilities.
 * Detected automatically based on GPU features.
 *
 * @type {Object.<string, Object>}
 */
export const QUALITY_PRESETS = {
    desktop: {
        gridSize: 128,
        dyeSize: 1024,
        pressureIterations: 20,
        targetFPS: 60
    },
    mobile: {
        gridSize: 128,
        dyeSize: 512,
        pressureIterations: 20,
        targetFPS: 30
    },
    fallback: {
        gridSize: 64,
        dyeSize: 256,
        pressureIterations: 10,
        targetFPS: 30
    }
};

/**
 * Clamps a configuration value to valid range.
 *
 * @param {string} key - Configuration key
 * @param {number} value - Value to clamp
 * @returns {number} Clamped value
 */
export function clampConfigValue(key, value) {
    const ranges = {
        gridSize: [32, 512],
        dyeSize: [256, 2048],
        pressureIterations: [1, 100],
        pressure: [0.0, 1.0],
        velocityDissipation: [0.0, 5.0],
        dyeDissipation: [0.0, 5.0],
        curl: [0, 100],
        splatRadius: [0.0001, 0.1],
        splatForce: [100, 20000],
        bloomIntensity: [0.0, 3.0],
        bloomThreshold: [0.0, 1.0],
        sunraysWeight: [0.0, 3.0]
    };

    if (ranges[key]) {
        const [min, max] = ranges[key];
        return Math.max(min, Math.min(max, value));
    }

    return value;
}

/**
 * Merges user config with defaults.
 *
 * @param {Object} userConfig - User-provided configuration
 * @returns {Object} Merged configuration
 */
export function mergeConfig(userConfig = {}) {
    const merged = { ...DEFAULT_CONFIG };

    for (const [key, value] of Object.entries(userConfig)) {
        if (key in DEFAULT_CONFIG) {
            merged[key] = typeof value === 'number'
                ? clampConfigValue(key, value)
                : value;
        }
    }

    return merged;
}
