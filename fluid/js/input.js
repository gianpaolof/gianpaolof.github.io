/**
 * InputManager - Handles mouse and touch input for WebGL fluid simulation
 * Converts pointer events into forces and dye injection data
 */
class InputManager {
    /**
     * Create an InputManager instance
     * @param {HTMLCanvasElement} canvas - The canvas element to attach listeners to
     */
    constructor(canvas) {
        this.canvas = canvas;
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
     * @param {number} x - Client X coordinate
     * @param {number} y - Client Y coordinate
     */
    onPointerMove(x, y) {
        if (!this.isPressed) {
            return;
        }

        // Calculate normalized coordinates
        const rect = this.canvas.getBoundingClientRect();
        const normX = (x - rect.left) / rect.width;
        const normY = 1.0 - (y - rect.top) / rect.height; // Flip Y for WebGL coords

        // Calculate delta from last position
        const lastRect = this.canvas.getBoundingClientRect();
        const lastNormX = (this.lastPosition.x - lastRect.left) / lastRect.width;
        const lastNormY = 1.0 - (this.lastPosition.y - lastRect.top) / lastRect.height;

        const dx = normX - lastNormX;
        const dy = normY - lastNormY;

        // Calculate speed
        const speed = Math.sqrt(dx * dx + dy * dy);

        // Only register movement if speed exceeds threshold
        if (speed > 0.001) {
            // Gentle forces like the CodePen
            this.forces.push({
                position: { x: normX, y: normY },
                direction: { x: dx * 8, y: dy * 8 },
                radius: 0.08,
                strength: Math.min(speed * 50, 0.8)
            });

            // Push dye object
            this.dyeColors.push({
                position: { x: normX, y: normY },
                color: this.currentDyeColor,
                radius: 0.06
            });
        }

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
     * Generate a random dye color from the Aurora palette
     * @returns {Array} RGB color array with values 0-1
     */
    generateDyeColor() {
        const colors = [
            [0.0, 1.0, 0.53],   // #00FF87 mint
            [0.0, 0.83, 1.0],   // #00D4FF cyan
            [0.49, 0.23, 0.93], // #7C3AED violet
            [1.0, 0.42, 0.61]   // #FF6B9D pink
        ];
        return colors[Math.floor(Math.random() * colors.length)];
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
