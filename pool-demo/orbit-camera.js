/**
 * Orbit Camera - Mouse-controlled camera orbiting around a target point
 */
export class OrbitCamera {
    constructor(canvas) {
        this.canvas = canvas;

        // Spherical coordinates
        this.azimuth = Math.PI / 4;      // Horizontal angle (45 degrees)
        this.elevation = Math.PI / 6;     // Vertical angle (30 degrees)
        this.distance = 4.0;              // Distance from target

        // Target point (center of pool)
        this.target = [0, -0.3, 0];

        // Limits
        this.minElevation = 0.1;
        this.maxElevation = Math.PI / 2 - 0.1;
        this.minDistance = 2.0;
        this.maxDistance = 10.0;

        // Mouse state
        this._isDragging = false;
        this._lastMouseX = 0;
        this._lastMouseY = 0;

        // Matrices
        this._viewMatrix = new Float32Array(16);
        this._projMatrix = new Float32Array(16);
        this._position = [0, 0, 0];

        this._setupControls();
        this._updatePosition();
    }

    _setupControls() {
        const canvas = this.canvas;

        // Mouse down - start drag (only on right-click or with modifier)
        canvas.addEventListener('mousedown', (e) => {
            // Right-click or middle-click for camera rotation
            if (e.button === 2 || e.button === 1 || e.shiftKey) {
                this._isDragging = true;
                this._lastMouseX = e.clientX;
                this._lastMouseY = e.clientY;
                e.preventDefault();
            }
        });

        // Mouse move - rotate camera
        canvas.addEventListener('mousemove', (e) => {
            if (!this._isDragging) return;

            const dx = e.clientX - this._lastMouseX;
            const dy = e.clientY - this._lastMouseY;

            this.azimuth -= dx * 0.01;
            this.elevation += dy * 0.01;

            // Clamp elevation
            this.elevation = Math.max(this.minElevation, Math.min(this.maxElevation, this.elevation));

            this._lastMouseX = e.clientX;
            this._lastMouseY = e.clientY;

            this._updatePosition();
        });

        // Mouse up - end drag
        window.addEventListener('mouseup', () => {
            this._isDragging = false;
        });

        // Scroll - zoom
        canvas.addEventListener('wheel', (e) => {
            this.distance += e.deltaY * 0.01;
            this.distance = Math.max(this.minDistance, Math.min(this.maxDistance, this.distance));
            this._updatePosition();
            e.preventDefault();
        }, { passive: false });

        // Prevent context menu
        canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    _updatePosition() {
        // Convert spherical to Cartesian
        const cosEl = Math.cos(this.elevation);
        const sinEl = Math.sin(this.elevation);
        const cosAz = Math.cos(this.azimuth);
        const sinAz = Math.sin(this.azimuth);

        this._position[0] = this.target[0] + this.distance * cosEl * sinAz;
        this._position[1] = this.target[1] + this.distance * sinEl;
        this._position[2] = this.target[2] + this.distance * cosEl * cosAz;

        this._computeViewMatrix();
    }

    _computeViewMatrix() {
        const eye = this._position;
        const target = this.target;
        const up = [0, 1, 0];

        // Compute view matrix (lookAt)
        const zAxis = this._normalize([
            eye[0] - target[0],
            eye[1] - target[1],
            eye[2] - target[2]
        ]);
        const xAxis = this._normalize(this._cross(up, zAxis));
        const yAxis = this._cross(zAxis, xAxis);

        const m = this._viewMatrix;
        m[0] = xAxis[0];  m[4] = xAxis[1];  m[8] = xAxis[2];   m[12] = -this._dot(xAxis, eye);
        m[1] = yAxis[0];  m[5] = yAxis[1];  m[9] = yAxis[2];   m[13] = -this._dot(yAxis, eye);
        m[2] = zAxis[0];  m[6] = zAxis[1];  m[10] = zAxis[2];  m[14] = -this._dot(zAxis, eye);
        m[3] = 0;         m[7] = 0;         m[11] = 0;         m[15] = 1;
    }

    setPerspective(fov, aspect, near, far) {
        const f = 1.0 / Math.tan(fov / 2);
        const nf = 1 / (near - far);
        const m = this._projMatrix;

        m.fill(0);
        m[0] = f / aspect;
        m[5] = f;
        m[10] = (far + near) * nf;
        m[11] = -1;
        m[14] = 2 * far * near * nf;
    }

    resize(width, height) {
        this.setPerspective(Math.PI / 3, width / height, 0.1, 100.0);
    }

    get viewMatrix() {
        return this._viewMatrix;
    }

    get projectionMatrix() {
        return this._projMatrix;
    }

    get position() {
        return this._position;
    }

    get isDragging() {
        return this._isDragging;
    }

    // Vector utilities
    _normalize(v) {
        const len = Math.sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2]);
        return [v[0]/len, v[1]/len, v[2]/len];
    }

    _cross(a, b) {
        return [
            a[1]*b[2] - a[2]*b[1],
            a[2]*b[0] - a[0]*b[2],
            a[0]*b[1] - a[1]*b[0]
        ];
    }

    _dot(a, b) {
        return a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
    }
}
