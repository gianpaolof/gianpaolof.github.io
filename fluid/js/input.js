/**
 * InputManager - Handles mouse and touch input for WebGL fluid simulation
 * Converts pointer events into forces and dye injection data
 */
class InputManager {
    /**
     * Create an InputManager instance
     * @param {HTMLCanvasElement} canvas - The canvas element to attach listeners to
     * @param {Object} solver - The fluid solver instance (to get live config)
     */
    constructor(canvas, solver = null) {
        this.canvas = canvas;
        this.solver = solver;
        this.forces = [];
        this.dyeColors = [];
        this.lastPosition = null;
        this.isPressed = false;
        this.currentDyeColor = null;

        // Bind event handlers to preserve context
        this._onMouseDown = this.onMouseDown.bind(this);
        this._onMouseMove = this.onMouseMove.bind(this);
        this._onMouseUp = this.onMouseUp.bind(this);
        this._onMouseLeave = this.onMouseUp.bind(this);
        this._onTouchStart = this.onTouchStart.bind(this);
        this._onTouchMove = this.onTouchMove.bind(this);
        this._onTouchEnd = this.onTouchEnd.bind(this);
        this._onTouchCancel = this.onTouchEnd.bind(this);

        // Attach mouse event listeners
        this.canvas.addEventListener('mousedown', this._onMouseDown);
        this.canvas.addEventListener('mousemove', this._onMouseMove);
        this.canvas.addEventListener('mouseup', this._onMouseUp);
        this.canvas.addEventListener('mouseleave', this._onMouseLeave);

        // Attach touch event listeners with passive: false to allow preventDefault
        this.canvas.addEventListener('touchstart', this._onTouchStart, { passive: false });
        this.canvas.addEventListener('touchmove', this._onTouchMove, { passive: false });
        this.canvas.addEventListener('touchend', this._onTouchEnd, { passive: false });
        this.canvas.addEventListener('touchcancel', this._onTouchCancel, { passive: false });
    }

    /**
     * Handle pointer down event
     * @param {number} x - Client X coordinate
     * @param {number} y - Client Y coordinate
     */
    onPointerDown(x, y) {
        this.isPressed = true;
        this.lastPosition = { x, y };
        this.currentDyeColor = this.generateDyeColor();
    }

    /**
     * Handle pointer move event
     * Pavel's approach: single splat with delta * SPLAT_FORCE
     * @param {number} x - Client X coordinate
     * @param {number} y - Client Y coordinate
     */
    onPointerMove(x, y) {
        if (!this.isPressed || !this.lastPosition) {
            return;
        }

        // Calculate normalized coordinates (texcoord style, 0-1)
        const rect = this.canvas.getBoundingClientRect();
        const texcoordX = (x - rect.left) / rect.width;
        const texcoordY = 1.0 - (y - rect.top) / rect.height; // Flip Y for WebGL

        // Calculate delta in normalized coords
        const prevTexcoordX = (this.lastPosition.x - rect.left) / rect.width;
        const prevTexcoordY = 1.0 - (this.lastPosition.y - rect.top) / rect.height;

        let deltaX = texcoordX - prevTexcoordX;
        let deltaY = texcoordY - prevTexcoordY;

        // Correct delta for aspect ratio (Pavel's correctDeltaX/Y)
        const aspectRatio = this.canvas.width / this.canvas.height;
        if (aspectRatio < 1) {
            deltaX *= aspectRatio;
        }
        if (aspectRatio > 1) {
            deltaY /= aspectRatio;
        }

        // Single splat with force proportional to movement (Pavel's approach)
        // Get LIVE config from solver (not stale reference)
        const config = this.solver ? this.solver.config : {};
        const SPLAT_FORCE = config.splatForce || 6000;
        const SPLAT_RADIUS = config.splatRadius || 0.0025;  // Pavel: 0.25 / 100 = 0.0025

        this.forces.push({
            position: { x: texcoordX, y: texcoordY },
            direction: { x: deltaX * SPLAT_FORCE, y: deltaY * SPLAT_FORCE },
            radius: SPLAT_RADIUS
        });

        // Dye splat at same position - same radius as velocity
        this.dyeColors.push({
            position: { x: texcoordX, y: texcoordY },
            color: this.currentDyeColor,
            radius: SPLAT_RADIUS
        });

        // Update last position
        this.lastPosition = { x, y };
    }

    /**
     * Handle pointer up event
     */
    onPointerUp() {
        this.isPressed = false;
        this.lastPosition = null;
    }

    /**
     * Handle mouse down event
     * @param {MouseEvent} e - Mouse event
     */
    onMouseDown(e) {
        this.onPointerDown(e.clientX, e.clientY);
    }

    /**
     * Handle mouse move event
     * @param {MouseEvent} e - Mouse event
     */
    onMouseMove(e) {
        this.onPointerMove(e.clientX, e.clientY);
    }

    /**
     * Handle mouse up event
     * @param {MouseEvent} e - Mouse event
     */
    onMouseUp(e) {
        this.onPointerUp();
    }

    /**
     * Handle touch start event
     * @param {TouchEvent} e - Touch event
     */
    onTouchStart(e) {
        e.preventDefault();
        const touch = e.touches[0];
        this.onPointerDown(touch.clientX, touch.clientY);
    }

    /**
     * Handle touch move event
     * @param {TouchEvent} e - Touch event
     */
    onTouchMove(e) {
        e.preventDefault();
        const touch = e.touches[0];
        this.onPointerMove(touch.clientX, touch.clientY);
    }

    /**
     * Handle touch end event
     * @param {TouchEvent} e - Touch event
     */
    onTouchEnd(e) {
        this.onPointerUp();
    }

    /**
     * Get and clear accumulated forces
     * @returns {Array} Array of force objects
     */
    getForces() {
        const result = this.forces.slice();
        this.forces = [];
        return result;
    }

    /**
     * Get and clear accumulated dye colors
     * @returns {Array} Array of dye objects
     */
    getDyes() {
        const result = this.dyeColors.slice();
        this.dyeColors = [];
        return result;
    }

    /**
     * Convert HSV to RGB (Pavel's method)
     * @param {number} h - Hue (0-1)
     * @param {number} s - Saturation (0-1)
     * @param {number} v - Value (0-1)
     * @returns {Array} RGB array [r, g, b] with values 0-1
     */
    HSVtoRGB(h, s, v) {
        let r, g, b;
        const i = Math.floor(h * 6);
        const f = h * 6 - i;
        const p = v * (1 - s);
        const q = v * (1 - f * s);
        const t = v * (1 - (1 - f) * s);

        switch (i % 6) {
            case 0: r = v; g = t; b = p; break;
            case 1: r = q; g = v; b = p; break;
            case 2: r = p; g = v; b = t; break;
            case 3: r = p; g = q; b = v; break;
            case 4: r = t; g = p; b = v; break;
            case 5: r = v; g = p; b = q; break;
        }
        return [r, g, b];
    }

    /**
     * Generate a random dye color using HSV (Pavel's method)
     * Random hue, full saturation and value
     * @returns {Array} RGB color array - BRIGHT!
     */
    generateDyeColor() {
        // Random hue, full saturation, reduced value to avoid white blowout
        const rgb = this.HSVtoRGB(Math.random(), 1.0, 1.0);
        // Reduced intensity to prevent blinding white when colors mix
        return rgb.map(c => c * 0.7);
    }

    /**
     * Remove all event listeners and clean up
     */
    destroy() {
        // Remove mouse event listeners
        this.canvas.removeEventListener('mousedown', this._onMouseDown);
        this.canvas.removeEventListener('mousemove', this._onMouseMove);
        this.canvas.removeEventListener('mouseup', this._onMouseUp);
        this.canvas.removeEventListener('mouseleave', this._onMouseLeave);

        // Remove touch event listeners
        this.canvas.removeEventListener('touchstart', this._onTouchStart);
        this.canvas.removeEventListener('touchmove', this._onTouchMove);
        this.canvas.removeEventListener('touchend', this._onTouchEnd);
        this.canvas.removeEventListener('touchcancel', this._onTouchCancel);

        // Clear references
        this.canvas = null;
        this.forces = [];
        this.dyeColors = [];
        this.lastPosition = null;
        this.currentDyeColor = null;
    }
}

export { InputManager };
