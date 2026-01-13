/**
 * Main entry point for the WebGL Fluid Simulation
 * Initializes all components and starts the animation loop
 */

import { FluidSolver, DEFAULT_CONFIG } from './fluid-solver.js';
import { InputManager } from './input.js';
import { UIManager, AdvancedControlPanel } from './ui.js';
import { detectQuality, QUALITY_PRESETS } from './gl-utils.js';

// Global state
let solver = null;
let inputManager = null;
let uiManager = null;
let advancedPanel = null;
let animationId = null;
let lastTime = 0;
let frameCount = 0;
let fpsTime = 0;

/**
 * Initialize the fluid simulation
 */
async function init() {
    const canvas = document.getElementById('fluid-canvas');
    const loadingOverlay = document.getElementById('loading');

    if (!canvas) {
        console.error('Canvas element not found');
        showStaticFallback();
        return;
    }

    try {
        // Detect device capabilities
        const quality = detectQuality();
        console.log('Detected quality tier:', quality.tier);

        if (quality.tier === 'none') {
            console.warn('WebGL not supported');
            showStaticFallback();
            hideLoading(loadingOverlay);
            return;
        }

        // Get quality preset
        const preset = QUALITY_PRESETS[quality.tier] || QUALITY_PRESETS.fallback;

        // Create configuration - use Pavel's values for best visuals
        const config = {
            ...preset,
            // DON'T override these! Use defaults from fluid-solver.js
            // velocityDissipation: 0.2 (default - lower = persists longer)
            // dyeDissipation: 1.0 (default - no dissipation)
            // splatRadius: 0.25 (default - visible splats)
            // curl: 30 (default - vorticity strength)
        };

        console.log('Using config:', config);

        // Size canvas
        resizeCanvas(canvas);

        // Initialize fluid solver
        solver = new FluidSolver(canvas, config);
        await solver.init();

        // Initialize input manager with solver reference (for live config access)
        inputManager = new InputManager(canvas, solver);

        // Initialize UI manager
        uiManager = new UIManager(solver, config);

        // Initialize advanced control panel
        advancedPanel = new AdvancedControlPanel(solver, DEFAULT_CONFIG);

        // Set up context loss handling
        setupContextLossHandling(canvas);

        // Hide loading overlay
        hideLoading(loadingOverlay);

        // Start animation loop
        lastTime = performance.now();
        fpsTime = lastTime;
        animate(lastTime);

        console.log('Fluid simulation initialized successfully');

    } catch (error) {
        console.error('Failed to initialize fluid simulation:', error);
        showStaticFallback();
        hideLoading(loadingOverlay);
    }
}

/**
 * Animation loop
 */
function animate(currentTime) {
    animationId = requestAnimationFrame(animate);

    // Calculate delta time
    let dt = (currentTime - lastTime) / 1000;
    lastTime = currentTime;

    // Cap dt to prevent instability (30fps minimum)
    dt = Math.min(dt, 0.033);

    // Skip if paused
    if (solver.paused) {
        return;
    }

    // Get forces from input manager
    const forces = inputManager.getForces();
    const dyes = inputManager.getDyes();

    // Apply forces and dyes
    forces.forEach(force => {
        solver.addForce(
            [force.position.x, force.position.y],
            [force.direction.x, force.direction.y],
            force.radius,
            force.strength
        );
    });

    dyes.forEach(dye => {
        solver.addDye(
            [dye.position.x, dye.position.y],
            dye.color,
            dye.radius
        );
    });

    // Step simulation
    solver.step(dt);

    // Render
    solver.render();

    // Update FPS counter
    frameCount++;
    if (currentTime - fpsTime >= 1000) {
        const fps = frameCount;
        frameCount = 0;
        fpsTime = currentTime;

        if (uiManager) {
            uiManager.updateFPS(fps);
        }
    }
}

/**
 * Resize canvas to fill viewport
 */
function resizeCanvas(canvas) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = window.innerWidth;
    const height = window.innerHeight;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
}

/**
 * Hide loading overlay with animation
 */
function hideLoading(overlay) {
    if (overlay) {
        overlay.classList.add('hidden');
        // Remove from DOM after animation
        setTimeout(() => {
            overlay.style.display = 'none';
        }, 500);
    }
}

/**
 * Show static fallback background
 */
function showStaticFallback() {
    const canvas = document.getElementById('fluid-canvas');
    const fallback = document.querySelector('.static-fallback');

    if (canvas) {
        canvas.style.display = 'none';
    }
    if (fallback) {
        fallback.style.display = 'block';
    }
}

/**
 * Handle WebGL context loss/restore
 */
function setupContextLossHandling(canvas) {
    canvas.addEventListener('webglcontextlost', (event) => {
        event.preventDefault();
        console.warn('WebGL context lost');

        if (animationId) {
            cancelAnimationFrame(animationId);
            animationId = null;
        }

        if (solver) {
            solver.pause();
        }
    });

    canvas.addEventListener('webglcontextrestored', async () => {
        console.log('WebGL context restored');

        try {
            // Reinitialize solver
            await solver.init();
            solver.resume();

            // Restart animation
            lastTime = performance.now();
            animate(lastTime);
        } catch (error) {
            console.error('Failed to restore WebGL context:', error);
            showStaticFallback();
        }
    });
}

/**
 * Handle window resize
 */
window.addEventListener('resize', (() => {
    let timeout;
    return () => {
        clearTimeout(timeout);
        timeout = setTimeout(() => {
            const canvas = document.getElementById('fluid-canvas');
            if (canvas && solver) {
                resizeCanvas(canvas);
                solver.resize(canvas.width, canvas.height);
            }
        }, 150);
    };
})());

// Initialize on DOM load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

// Export for debugging
window.fluidSim = {
    get solver() { return solver; },
    get inputManager() { return inputManager; },
    get uiManager() { return uiManager; },
    get advancedPanel() { return advancedPanel; },
    showFPS: (show) => uiManager?.showFPS(show),
    clear: () => solver?.clear(),
    pause: () => solver?.pause(),
    resume: () => solver?.resume(),
    setParam: (name, value) => advancedPanel?.setParam(name, value),
    getParams: () => advancedPanel?.getParams()
};
