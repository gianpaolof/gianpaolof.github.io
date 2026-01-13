/**
 * UIManager - Handles controls and preferences for WebGL fluid simulation
 * Manages intensity slider, pause toggle, FPS display, visibility handling,
 * and reduced motion preferences.
 */

/**
 * Linear interpolation between two values
 * @param {number} a - Start value
 * @param {number} b - End value
 * @param {number} t - Interpolation factor (0-1)
 * @returns {number} Interpolated value
 */
function lerp(a, b, t) {
    return a + (b - a) * t;
}

class UIManager {
    /**
     * Create a UIManager instance
     * @param {Object} solver - The fluid solver instance
     * @param {Object} config - Configuration object for simulation parameters
     */
    constructor(solver, config) {
        this.solver = solver;
        this.config = config;
        this.wasPlaying = true;

        // DOM element references
        this.intensitySlider = null;
        this.intensityValue = null;
        this.pauseToggle = null;
        this.fpsCounter = null;

        this.initControls();
        this.initVisibilityHandling();
        this.checkReducedMotion();
    }

    /**
     * Initialize UI controls and attach event listeners
     */
    initControls() {
        // Get DOM elements
        this.intensitySlider = document.getElementById('intensity-slider');
        this.intensityValue = document.getElementById('intensity-value');
        this.pauseToggle = document.getElementById('pause-toggle');
        this.fpsCounter = document.getElementById('fps');

        // Add slider input listener
        if (this.intensitySlider) {
            this.intensitySlider.addEventListener('input', (e) => {
                const value = parseFloat(e.target.value);
                this.setIntensity(value);
                if (this.intensityValue) {
                    this.intensityValue.textContent = value.toFixed(1);
                }
            });
        }

        // Add pause toggle listener
        if (this.pauseToggle) {
            this.pauseToggle.addEventListener('change', (e) => {
                if (e.target.checked) {
                    this.solver.pause();
                } else {
                    this.solver.resume();
                }
            });
        }
    }

    /**
     * Map slider value to simulation parameters
     * @param {number} value - Slider value in range [0.2, 2.0]
     */
    setIntensity(value) {
        // Update render intensity directly
        // This controls how strongly vorticity maps to color
        this.config.intensity = value;

        // Also update the solver's config
        if (this.solver && this.solver.setConfig) {
            this.solver.setConfig({ intensity: value });
        }
    }

    /**
     * Initialize visibility and resize event handling
     */
    initVisibilityHandling() {
        // Tab visibility handling
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                this.solver.pause();
                this.wasPlaying = !this.pauseToggle?.checked;
            } else if (this.wasPlaying) {
                this.solver.resume();
            }
        });

        // Window resize handling (debounced)
        let resizeTimeout;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                this.solver.resize(window.innerWidth, window.innerHeight);
            }, 150);
        });
    }

    /**
     * Check and handle reduced motion preference
     */
    checkReducedMotion() {
        const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

        const handleMotionPreference = (e) => {
            if (e.matches) {
                this.enableStaticMode();
            } else {
                this.disableStaticMode();
            }
        };

        // Check initial preference
        handleMotionPreference(mediaQuery);

        // Listen for preference changes
        mediaQuery.addEventListener('change', handleMotionPreference);
    }

    /**
     * Enable static mode for users who prefer reduced motion
     * Pauses animation and shows static fallback
     */
    enableStaticMode() {
        this.solver.pause();

        const canvas = document.getElementById('fluid-canvas');
        const fallback = document.querySelector('.static-fallback');

        if (canvas) {
            canvas.style.display = 'none';
        }

        if (fallback) {
            fallback.style.display = 'block';
        }

        if (this.intensitySlider) {
            this.intensitySlider.disabled = true;
        }
    }

    /**
     * Disable static mode and restore animation
     */
    disableStaticMode() {
        const canvas = document.getElementById('fluid-canvas');
        const fallback = document.querySelector('.static-fallback');

        if (fallback) {
            fallback.style.display = 'none';
        }

        if (canvas) {
            canvas.style.display = 'block';
        }

        if (this.intensitySlider) {
            this.intensitySlider.disabled = false;
        }

        this.solver.resume();
    }

    /**
     * Update the FPS counter display
     * @param {number} fps - Current frames per second
     */
    updateFPS(fps) {
        if (this.fpsCounter) {
            this.fpsCounter.textContent = `${Math.round(fps)} FPS`;
        }
    }

    /**
     * Show or hide the FPS counter
     * @param {boolean} show - Whether to show the FPS counter
     */
    showFPS(show) {
        if (this.fpsCounter) {
            this.fpsCounter.style.display = show ? 'block' : 'none';
        }
    }
}

export { UIManager, lerp };
