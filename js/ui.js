/**
 * UIManager - Handles controls and preferences for WebGL fluid simulation
 * Pavel-style controls with all simulation parameters
 */

/**
 * Linear interpolation between two values
 */
function lerp(a, b, t) {
    return a + (b - a) * t;
}

class UIManager {
    constructor(solver, config) {
        this.solver = solver;
        this.config = config;
        this.wasPlaying = true;
        this.fpsCounter = null;

        this.initControls();
        this.initVisibilityHandling();
        this.checkReducedMotion();
    }

    initControls() {
        this.fpsCounter = document.getElementById('fps');
    }

    initVisibilityHandling() {
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                this.wasPlaying = !this.solver.paused;
                this.solver.pause();
            } else if (this.wasPlaying) {
                this.solver.resume();
            }
        });
    }

    checkReducedMotion() {
        const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

        const handleMotionPreference = (e) => {
            if (e.matches) {
                this.enableStaticMode();
            }
        };

        handleMotionPreference(mediaQuery);
        mediaQuery.addEventListener('change', handleMotionPreference);
    }

    enableStaticMode() {
        this.solver.pause();
        const canvas = document.getElementById('fluid-canvas');
        const fallback = document.querySelector('.static-fallback');

        if (canvas) canvas.style.display = 'none';
        if (fallback) fallback.style.display = 'block';
    }

    updateFPS(fps) {
        if (this.fpsCounter) {
            this.fpsCounter.textContent = `${Math.round(fps)} FPS`;
        }
    }

    showFPS(show) {
        if (this.fpsCounter) {
            this.fpsCounter.style.display = show ? 'block' : 'none';
        }
    }
}

/**
 * AdvancedControlPanel - Pavel-style control panel with all parameters
 */
class AdvancedControlPanel {
    constructor(solver, defaultConfig) {
        this.solver = solver;
        this.defaultConfig = { ...defaultConfig };
        this.isOpen = true;
        this.colorfulEnabled = true;
        this.colorUpdateTimer = 0;

        // Parameter definitions matching Pavel's UI
        this.params = {
            // Simulation
            gridSize: {
                type: 'select',
                options: [32, 64, 128, 256],
                configKey: 'gridSize'
            },
            dyeDissipation: {
                type: 'range',
                min: 0, max: 4, step: 0.01, decimals: 2,
                configKey: 'dyeDissipation'
            },
            velocityDissipation: {
                type: 'range',
                min: 0, max: 1, step: 0.01, decimals: 2,
                configKey: 'velocityDissipation'
            },
            pressure: {
                type: 'range',
                min: 0, max: 1, step: 0.01, decimals: 2,
                configKey: 'pressure'
            },
            curl: {
                type: 'range',
                min: 0, max: 50, step: 1, decimals: 0,
                configKey: 'curl'
            },
            splatRadius: {
                type: 'range',
                min: 0.01, max: 1, step: 0.01, decimals: 2,
                // NOTE: UI shows 0.25, but actual value is 0.25/100 = 0.0025
                transform: (v) => v / 100,
                inverseTransform: (v) => v * 100,
                configKey: 'splatRadius'
            },
            // Toggles
            shadingEnabled: {
                type: 'checkbox',
                configKey: 'shadingEnabled'
            },
            colorfulEnabled: {
                type: 'checkbox',
                // This is handled separately, not in solver config
                configKey: null
            },
            paused: {
                type: 'checkbox',
                configKey: null // Handled via solver.pause/resume
            },
            // Bloom
            bloomEnabled: {
                type: 'checkbox',
                configKey: 'bloomEnabled'
            },
            bloomIntensity: {
                type: 'range',
                min: 0.1, max: 2, step: 0.1, decimals: 1,
                configKey: 'bloomIntensity'
            },
            bloomThreshold: {
                type: 'range',
                min: 0, max: 1, step: 0.1, decimals: 1,
                configKey: 'bloomThreshold'
            },
            // Sunrays
            sunraysEnabled: {
                type: 'checkbox',
                configKey: 'sunraysEnabled'
            },
            sunraysWeight: {
                type: 'range',
                min: 0.3, max: 1, step: 0.1, decimals: 1,
                configKey: 'sunraysWeight'
            }
        };

        this.init();
    }

    init() {
        this.toggleBtn = document.getElementById('panel-toggle');
        this.content = document.getElementById('panel-content');
        this.resetBtn = document.getElementById('reset-btn');
        this.randomSplatsBtn = document.getElementById('random-splats-btn');
        this.closeBtn = document.getElementById('close-controls-btn');

        if (!this.toggleBtn || !this.content) {
            console.warn('Control panel elements not found');
            return;
        }

        // Toggle panel
        this.toggleBtn.addEventListener('click', () => this.toggle());

        // Reset button
        if (this.resetBtn) {
            this.resetBtn.addEventListener('click', () => this.reset());
        }

        // Random splats button
        if (this.randomSplatsBtn) {
            this.randomSplatsBtn.addEventListener('click', () => {
                console.log('Random splats clicked');
                if (this.solver.addRandomSplats) {
                    const amount = Math.floor(Math.random() * 20) + 5;
                    console.log('Adding', amount, 'random splats');
                    this.solver.addRandomSplats(amount);
                } else {
                    console.error('addRandomSplats method not found on solver');
                }
            });
        }

        // Close button
        if (this.closeBtn) {
            this.closeBtn.addEventListener('click', () => this.close());
        }

        // Collapsible sections
        document.querySelectorAll('.section-title.clickable').forEach(title => {
            title.addEventListener('click', () => {
                const targetId = title.dataset.target;
                const content = document.getElementById(targetId);
                const arrow = title.querySelector('.collapse-arrow');

                if (content) {
                    content.classList.toggle('collapsed');
                    if (arrow) {
                        arrow.textContent = content.classList.contains('collapsed') ? '▶' : '▼';
                    }
                }
            });
        });

        // Initialize all controls
        this.initControls();

        // Start with panel closed
        this.close();
    }

    initControls() {
        console.log('AdvancedControlPanel.initControls() - initializing', Object.keys(this.params).length, 'params');

        for (const [paramName, paramDef] of Object.entries(this.params)) {
            const element = document.getElementById(`param-${paramName}`);
            const valueDisplay = document.getElementById(`value-${paramName}`);

            if (!element) {
                console.warn(`Element not found: param-${paramName}`);
                continue;
            }
            console.log(`Found element: param-${paramName}`, element.tagName);

            // Set initial value
            if (paramDef.type === 'select') {
                const currentValue = this.solver.config[paramDef.configKey];
                element.value = currentValue;
            } else if (paramDef.type === 'checkbox') {
                if (paramName === 'paused') {
                    element.checked = this.solver.paused;
                } else if (paramName === 'colorfulEnabled') {
                    element.checked = this.colorfulEnabled;
                } else if (paramDef.configKey) {
                    element.checked = this.solver.config[paramDef.configKey];
                }
            } else if (paramDef.type === 'range') {
                let currentValue = paramDef.configKey ? this.solver.config[paramDef.configKey] : 0;
                // Apply inverse transform for display
                if (paramDef.inverseTransform) {
                    currentValue = paramDef.inverseTransform(currentValue);
                }
                element.value = currentValue;
                if (valueDisplay) {
                    valueDisplay.textContent = currentValue.toFixed(paramDef.decimals);
                }
            }

            // Add event listener
            element.addEventListener(paramDef.type === 'checkbox' ? 'change' : 'input', (e) => {
                this.handleParamChange(paramName, paramDef, e.target);
            });
        }
    }

    handleParamChange(paramName, paramDef, element) {
        console.log('handleParamChange:', paramName, paramDef.type, element.value || element.checked);
        const valueDisplay = document.getElementById(`value-${paramName}`);

        if (paramDef.type === 'select') {
            const value = parseInt(element.value);
            if (paramDef.configKey) {
                this.solver.setConfig({ [paramDef.configKey]: value });
            }
        } else if (paramDef.type === 'checkbox') {
            const checked = element.checked;

            if (paramName === 'paused') {
                if (checked) {
                    this.solver.pause();
                } else {
                    this.solver.resume();
                }
            } else if (paramName === 'colorfulEnabled') {
                this.colorfulEnabled = checked;
            } else if (paramDef.configKey) {
                this.solver.setConfig({ [paramDef.configKey]: checked });
            }
        } else if (paramDef.type === 'range') {
            let value = parseFloat(element.value);

            // Update display
            if (valueDisplay) {
                valueDisplay.textContent = value.toFixed(paramDef.decimals);
            }

            // Apply transform for actual config value
            if (paramDef.transform) {
                value = paramDef.transform(value);
            }

            if (paramDef.configKey) {
                this.solver.setConfig({ [paramDef.configKey]: value });
            }
        }
    }

    toggle() {
        if (this.isOpen) {
            this.close();
        } else {
            this.open();
        }
    }

    open() {
        this.isOpen = true;
        this.content.classList.add('open');
        this.toggleBtn.classList.add('active');
    }

    close() {
        this.isOpen = false;
        this.content.classList.remove('open');
        this.toggleBtn.classList.remove('active');
    }

    reset() {
        // Reset all controls to default values
        for (const [paramName, paramDef] of Object.entries(this.params)) {
            const element = document.getElementById(`param-${paramName}`);
            const valueDisplay = document.getElementById(`value-${paramName}`);

            if (!element) continue;

            if (paramDef.type === 'select') {
                const defaultValue = this.defaultConfig[paramDef.configKey];
                if (defaultValue !== undefined) {
                    element.value = defaultValue;
                }
            } else if (paramDef.type === 'checkbox') {
                if (paramName === 'paused') {
                    element.checked = false;
                    this.solver.resume();
                } else if (paramName === 'colorfulEnabled') {
                    element.checked = true;
                    this.colorfulEnabled = true;
                } else if (paramDef.configKey) {
                    const defaultValue = this.defaultConfig[paramDef.configKey];
                    element.checked = defaultValue !== false;
                }
            } else if (paramDef.type === 'range') {
                let defaultValue = this.defaultConfig[paramDef.configKey];
                if (paramDef.inverseTransform && defaultValue !== undefined) {
                    defaultValue = paramDef.inverseTransform(defaultValue);
                }
                if (defaultValue !== undefined) {
                    element.value = defaultValue;
                    if (valueDisplay) {
                        valueDisplay.textContent = defaultValue.toFixed(paramDef.decimals);
                    }
                }
            }
        }

        // Reset solver to default config
        this.solver.setConfig(this.defaultConfig);
    }

    /**
     * Update colors if colorful mode is enabled (call from animation loop)
     */
    updateColors(dt, inputManager) {
        if (!this.colorfulEnabled || !inputManager) return;

        this.colorUpdateTimer += dt * 10; // COLOR_UPDATE_SPEED = 10
        if (this.colorUpdateTimer >= 1) {
            this.colorUpdateTimer -= 1;
            // Generate new color for next splat
            if (inputManager.currentDyeColor) {
                inputManager.currentDyeColor = inputManager.generateDyeColor();
            }
        }
    }

    setParam(paramName, value) {
        const element = document.getElementById(`param-${paramName}`);
        const paramDef = this.params[paramName];
        const valueDisplay = document.getElementById(`value-${paramName}`);

        if (element && paramDef) {
            if (paramDef.type === 'range') {
                let displayValue = value;
                if (paramDef.inverseTransform) {
                    displayValue = paramDef.inverseTransform(value);
                }
                element.value = displayValue;
                if (valueDisplay) {
                    valueDisplay.textContent = displayValue.toFixed(paramDef.decimals);
                }
            } else if (paramDef.type === 'checkbox') {
                element.checked = value;
            } else if (paramDef.type === 'select') {
                element.value = value;
            }

            if (paramDef.configKey) {
                this.solver.setConfig({ [paramDef.configKey]: value });
            }
        }
    }

    getParams() {
        const result = {};
        for (const [paramName, paramDef] of Object.entries(this.params)) {
            if (paramDef.configKey) {
                result[paramName] = this.solver.config[paramDef.configKey];
            }
        }
        return result;
    }
}

export { UIManager, AdvancedControlPanel, lerp };
