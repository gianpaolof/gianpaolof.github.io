/**
 * WebGL Utilities for Fluid Simulation
 *
 * Provides comprehensive WebGL context management, shader compilation,
 * texture handling, and quality detection for fluid dynamics rendering.
 *
 * @module gl-utils
 */

// =============================================================================
// QUALITY PRESETS
// =============================================================================

/**
 * Quality configuration presets for different device capabilities.
 * @type {Object.<string, {gridSize: number, dyeSize: number, pressureIterations: number, targetFPS: number}>}
 */
export const QUALITY_PRESETS = {
    desktop: {
        gridSize: 256,
        dyeSize: 512,
        pressureIterations: 20,
        targetFPS: 60
    },
    mobile: {
        gridSize: 128,
        dyeSize: 256,
        pressureIterations: 12,
        targetFPS: 30
    },
    fallback: {
        gridSize: 96,
        dyeSize: 192,
        pressureIterations: 6,
        targetFPS: 30
    }
};

// =============================================================================
// CONTEXT CREATION
// =============================================================================

/**
 * Creates a WebGL context from a canvas element.
 * Attempts WebGL2 first, falls back to WebGL1 if unavailable.
 *
 * @param {HTMLCanvasElement} canvas - The canvas element to create context from
 * @returns {{gl: WebGLRenderingContext|WebGL2RenderingContext, isWebGL2: boolean}}
 * @throws {Error} If no WebGL context can be created
 */
export function createContext(canvas) {
    const contextOptions = {
        alpha: false,
        depth: false,
        stencil: false,
        antialias: false,
        preserveDrawingBuffer: false,
        powerPreference: 'high-performance'
    };

    // Try WebGL2 first
    let gl = canvas.getContext('webgl2', contextOptions);
    if (gl) {
        return { gl, isWebGL2: true };
    }

    // Fall back to WebGL1
    gl = canvas.getContext('webgl', contextOptions) ||
         canvas.getContext('experimental-webgl', contextOptions);

    if (gl) {
        return { gl, isWebGL2: false };
    }

    throw new Error('WebGL is not supported in this browser');
}

// =============================================================================
// EXTENSION MANAGEMENT
// =============================================================================

/**
 * Gets and enables required WebGL extensions based on context version.
 *
 * @param {WebGLRenderingContext|WebGL2RenderingContext} gl - The WebGL context
 * @param {boolean} isWebGL2 - Whether the context is WebGL2
 * @returns {{
 *   colorBufferFloat: EXT_color_buffer_float|null,
 *   halfFloat: OES_texture_half_float|null,
 *   halfFloatLinear: OES_texture_half_float_linear|null,
 *   hasFloatTextures: boolean,
 *   hasLinearFiltering: boolean
 * }}
 */
export function getExtensions(gl, isWebGL2) {
    const extensions = {
        colorBufferFloat: null,
        halfFloat: null,
        halfFloatLinear: null,
        hasFloatTextures: false,
        hasLinearFiltering: false
    };

    if (isWebGL2) {
        // WebGL2 extensions
        extensions.colorBufferFloat = gl.getExtension('EXT_color_buffer_float');
        extensions.hasFloatTextures = extensions.colorBufferFloat !== null;

        // WebGL2 has linear filtering for half floats by default
        extensions.hasLinearFiltering = true;

        // Also try to get EXT_color_buffer_half_float for broader support
        const halfFloatExt = gl.getExtension('EXT_color_buffer_half_float');
        if (!extensions.hasFloatTextures && halfFloatExt) {
            extensions.hasFloatTextures = true;
        }
    } else {
        // WebGL1 extensions
        extensions.halfFloat = gl.getExtension('OES_texture_half_float');
        extensions.halfFloatLinear = gl.getExtension('OES_texture_half_float_linear');

        extensions.hasFloatTextures = extensions.halfFloat !== null;
        extensions.hasLinearFiltering = extensions.halfFloatLinear !== null;

        // Also try float textures as fallback
        if (!extensions.hasFloatTextures) {
            const floatExt = gl.getExtension('OES_texture_float');
            const floatLinearExt = gl.getExtension('OES_texture_float_linear');
            extensions.hasFloatTextures = floatExt !== null;
            extensions.hasLinearFiltering = floatLinearExt !== null;
        }
    }

    return extensions;
}

// =============================================================================
// SHADER COMPILATION
// =============================================================================

/**
 * Compiles a WebGL shader with detailed error reporting.
 *
 * @param {WebGLRenderingContext|WebGL2RenderingContext} gl - The WebGL context
 * @param {number} type - Shader type (gl.VERTEX_SHADER or gl.FRAGMENT_SHADER)
 * @param {string} source - GLSL shader source code
 * @returns {WebGLShader} The compiled shader
 * @throws {Error} If compilation fails, includes line numbers and error details
 */
export function compileShader(gl, type, source) {
    const shader = gl.createShader(type);
    if (!shader) {
        throw new Error('Failed to create shader object');
    }

    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const info = gl.getShaderInfoLog(shader);
        const typeName = type === gl.VERTEX_SHADER ? 'VERTEX' : 'FRAGMENT';

        // Parse and format error with line numbers
        const formattedError = formatShaderError(source, info, typeName);

        gl.deleteShader(shader);
        throw new Error(formattedError);
    }

    return shader;
}

/**
 * Formats shader compilation errors with source line context.
 *
 * @param {string} source - The shader source code
 * @param {string} errorLog - The error log from WebGL
 * @param {string} shaderType - 'VERTEX' or 'FRAGMENT'
 * @returns {string} Formatted error message
 */
function formatShaderError(source, errorLog, shaderType) {
    const lines = source.split('\n');
    const errors = [];

    // Parse error log for line numbers (format varies by browser)
    // Common formats: "ERROR: 0:15:" or "15:0:" or "Line 15:"
    const linePattern = /(?:ERROR:\s*\d+:(\d+)|^(\d+):\d+|Line\s+(\d+))/gmi;
    const matches = [...errorLog.matchAll(linePattern)];

    const errorLines = new Set();
    for (const match of matches) {
        const lineNum = parseInt(match[1] || match[2] || match[3], 10);
        if (!isNaN(lineNum)) {
            errorLines.add(lineNum);
        }
    }

    errors.push(`${shaderType} SHADER COMPILATION ERROR:`);
    errors.push('');
    errors.push(errorLog.trim());
    errors.push('');
    errors.push('Source context:');
    errors.push('-'.repeat(60));

    // Show relevant source lines with context
    const contextRange = 2;
    const shownRanges = new Set();

    for (const errorLine of errorLines) {
        const start = Math.max(1, errorLine - contextRange);
        const end = Math.min(lines.length, errorLine + contextRange);

        for (let i = start; i <= end; i++) {
            if (!shownRanges.has(i)) {
                shownRanges.add(i);
                const lineContent = lines[i - 1] || '';
                const prefix = i === errorLine ? '>>>' : '   ';
                const lineNumStr = String(i).padStart(4, ' ');
                errors.push(`${prefix} ${lineNumStr} | ${lineContent}`);
            }
        }
        errors.push('');
    }

    // If no line numbers were parsed, show first 20 lines
    if (errorLines.size === 0) {
        const showLines = Math.min(20, lines.length);
        for (let i = 0; i < showLines; i++) {
            const lineNumStr = String(i + 1).padStart(4, ' ');
            errors.push(`    ${lineNumStr} | ${lines[i]}`);
        }
        if (lines.length > showLines) {
            errors.push(`    ... (${lines.length - showLines} more lines)`);
        }
    }

    errors.push('-'.repeat(60));
    return errors.join('\n');
}

// =============================================================================
// PROGRAM CREATION
// =============================================================================

/**
 * Creates a WebGL program with cached uniform and attribute locations.
 *
 * @param {WebGLRenderingContext|WebGL2RenderingContext} gl - The WebGL context
 * @param {string} vertexSource - Vertex shader GLSL source
 * @param {string} fragmentSource - Fragment shader GLSL source
 * @returns {{
 *   program: WebGLProgram,
 *   uniforms: Object.<string, WebGLUniformLocation>,
 *   attributes: Object.<string, number>,
 *   use: function(): void,
 *   destroy: function(): void
 * }}
 * @throws {Error} If shader compilation or program linking fails
 */
export function createProgram(gl, vertexSource, fragmentSource) {
    const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
    const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);

    const program = gl.createProgram();
    if (!program) {
        gl.deleteShader(vertexShader);
        gl.deleteShader(fragmentShader);
        throw new Error('Failed to create program object');
    }

    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        const info = gl.getProgramInfoLog(program);
        gl.deleteProgram(program);
        gl.deleteShader(vertexShader);
        gl.deleteShader(fragmentShader);
        throw new Error(`Program linking failed:\n${info}`);
    }

    // Shaders can be deleted after linking
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);

    // Cache uniform locations
    const uniforms = {};
    const numUniforms = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < numUniforms; i++) {
        const info = gl.getActiveUniform(program, i);
        if (info) {
            // Handle array uniforms - get base name without [0]
            const name = info.name.replace(/\[0\]$/, '');
            uniforms[name] = gl.getUniformLocation(program, info.name);
        }
    }

    // Cache attribute locations
    const attributes = {};
    const numAttributes = gl.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES);
    for (let i = 0; i < numAttributes; i++) {
        const info = gl.getActiveAttrib(program, i);
        if (info) {
            attributes[info.name] = gl.getAttribLocation(program, info.name);
        }
    }

    return {
        program,
        uniforms,
        attributes,

        /**
         * Binds this program for use.
         */
        use() {
            gl.useProgram(program);
        },

        /**
         * Destroys the program and releases WebGL resources.
         */
        destroy() {
            gl.deleteProgram(program);
        }
    };
}

// =============================================================================
// TEXTURE FORMATS
// =============================================================================

/**
 * Gets appropriate texture formats based on WebGL version.
 *
 * @param {WebGLRenderingContext|WebGL2RenderingContext} gl - The WebGL context
 * @param {boolean} isWebGL2 - Whether the context is WebGL2
 * @returns {{
 *   VELOCITY_FORMAT: {internalFormat: number, format: number, type: number, filter: number},
 *   PRESSURE_FORMAT: {internalFormat: number, format: number, type: number, filter: number},
 *   DYE_FORMAT: {internalFormat: number, format: number, type: number, filter: number}
 * }}
 */
export function getTextureFormats(gl, isWebGL2) {
    if (isWebGL2) {
        return {
            VELOCITY_FORMAT: {
                internalFormat: gl.RG16F,
                format: gl.RG,
                type: gl.HALF_FLOAT,
                filter: gl.LINEAR
            },
            PRESSURE_FORMAT: {
                internalFormat: gl.R16F,
                format: gl.RED,
                type: gl.HALF_FLOAT,
                filter: gl.LINEAR
            },
            DYE_FORMAT: {
                internalFormat: gl.RGBA8,
                format: gl.RGBA,
                type: gl.UNSIGNED_BYTE,
                filter: gl.LINEAR
            }
        };
    } else {
        // WebGL1 fallback - need OES_texture_half_float extension
        const halfFloatExt = gl.getExtension('OES_texture_half_float');
        const halfFloatType = halfFloatExt ? halfFloatExt.HALF_FLOAT_OES : gl.UNSIGNED_BYTE;

        // WebGL1 doesn't support RG or RED formats, use RGBA/LUMINANCE
        return {
            VELOCITY_FORMAT: {
                internalFormat: gl.RGBA,
                format: gl.RGBA,
                type: halfFloatType,
                filter: gl.LINEAR
            },
            PRESSURE_FORMAT: {
                internalFormat: gl.LUMINANCE,
                format: gl.LUMINANCE,
                type: halfFloatType,
                filter: gl.LINEAR
            },
            DYE_FORMAT: {
                internalFormat: gl.RGBA,
                format: gl.RGBA,
                type: gl.UNSIGNED_BYTE,
                filter: gl.LINEAR
            }
        };
    }
}

// =============================================================================
// TEXTURE CREATION
// =============================================================================

/**
 * Creates a WebGL texture with specified dimensions and format.
 *
 * @param {WebGLRenderingContext|WebGL2RenderingContext} gl - The WebGL context
 * @param {number} width - Texture width in pixels
 * @param {number} height - Texture height in pixels
 * @param {{internalFormat: number, format: number, type: number, filter?: number}} formatConfig - Texture format configuration
 * @returns {WebGLTexture} The created texture
 * @throws {Error} If texture creation fails
 */
export function createTexture(gl, width, height, formatConfig) {
    const texture = gl.createTexture();
    if (!texture) {
        throw new Error('Failed to create texture');
    }

    gl.bindTexture(gl.TEXTURE_2D, texture);

    // Set wrapping to clamp (required for non-power-of-2 textures and fluid sim)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // Set filtering based on config or default to LINEAR
    const filter = formatConfig.filter !== undefined ? formatConfig.filter : gl.LINEAR;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);

    // Allocate texture with null data
    gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        formatConfig.internalFormat,
        width,
        height,
        0,
        formatConfig.format,
        formatConfig.type,
        null
    );

    gl.bindTexture(gl.TEXTURE_2D, null);

    return texture;
}

/**
 * Resizes an existing texture to new dimensions.
 *
 * @param {WebGLRenderingContext|WebGL2RenderingContext} gl - The WebGL context
 * @param {WebGLTexture} texture - The texture to resize
 * @param {number} width - New width in pixels
 * @param {number} height - New height in pixels
 * @param {{internalFormat: number, format: number, type: number, filter?: number}} formatConfig - Texture format configuration
 */
export function resizeTexture(gl, texture, width, height, formatConfig) {
    gl.bindTexture(gl.TEXTURE_2D, texture);

    gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        formatConfig.internalFormat,
        width,
        height,
        0,
        formatConfig.format,
        formatConfig.type,
        null
    );

    gl.bindTexture(gl.TEXTURE_2D, null);
}

// =============================================================================
// FRAMEBUFFER CREATION
// =============================================================================

/**
 * Creates a framebuffer with a texture attachment.
 *
 * @param {WebGLRenderingContext|WebGL2RenderingContext} gl - The WebGL context
 * @param {WebGLTexture} texture - The texture to attach
 * @returns {WebGLFramebuffer} The created framebuffer
 * @throws {Error} If framebuffer creation or completeness check fails
 */
export function createFramebuffer(gl, texture) {
    const framebuffer = gl.createFramebuffer();
    if (!framebuffer) {
        throw new Error('Failed to create framebuffer');
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        texture,
        0
    );

    // Verify completeness
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.deleteFramebuffer(framebuffer);
        throw new Error(`Framebuffer incomplete: ${getFramebufferStatusMessage(gl, status)}`);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    return framebuffer;
}

/**
 * Gets a human-readable message for framebuffer status.
 *
 * @param {WebGLRenderingContext|WebGL2RenderingContext} gl - The WebGL context
 * @param {number} status - The framebuffer status code
 * @returns {string} Human-readable status message
 */
function getFramebufferStatusMessage(gl, status) {
    const statusMessages = {
        [gl.FRAMEBUFFER_INCOMPLETE_ATTACHMENT]: 'INCOMPLETE_ATTACHMENT',
        [gl.FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT]: 'MISSING_ATTACHMENT',
        [gl.FRAMEBUFFER_INCOMPLETE_DIMENSIONS]: 'INCOMPLETE_DIMENSIONS',
        [gl.FRAMEBUFFER_UNSUPPORTED]: 'UNSUPPORTED'
    };

    // WebGL2 specific statuses
    if ('FRAMEBUFFER_INCOMPLETE_MULTISAMPLE' in gl) {
        statusMessages[gl.FRAMEBUFFER_INCOMPLETE_MULTISAMPLE] = 'INCOMPLETE_MULTISAMPLE';
    }

    return statusMessages[status] || `UNKNOWN (0x${status.toString(16)})`;
}

// =============================================================================
// DOUBLE FBO CLASS
// =============================================================================

/**
 * Double-buffered Framebuffer Object for ping-pong rendering.
 * Provides efficient buffer swapping for iterative fluid simulation steps.
 */
export class DoubleFBO {
    /**
     * Creates a DoubleFBO with two texture/framebuffer pairs.
     *
     * @param {WebGLRenderingContext|WebGL2RenderingContext} gl - The WebGL context
     * @param {number} width - Texture width in pixels
     * @param {number} height - Texture height in pixels
     * @param {{internalFormat: number, format: number, type: number, filter?: number}} formatConfig - Texture format configuration
     */
    constructor(gl, width, height, formatConfig) {
        this._gl = gl;
        this._width = width;
        this._height = height;
        this._formatConfig = formatConfig;

        // Create two texture/framebuffer pairs
        this._textures = [
            createTexture(gl, width, height, formatConfig),
            createTexture(gl, width, height, formatConfig)
        ];

        this._framebuffers = [
            createFramebuffer(gl, this._textures[0]),
            createFramebuffer(gl, this._textures[1])
        ];

        // Read from 0, write to 1
        this._readIndex = 0;
        this._writeIndex = 1;
    }

    /**
     * Gets the current width.
     * @returns {number}
     */
    get width() {
        return this._width;
    }

    /**
     * Gets the current height.
     * @returns {number}
     */
    get height() {
        return this._height;
    }

    /**
     * Gets the current read texture.
     * @returns {WebGLTexture}
     */
    get texture() {
        return this._textures[this._readIndex];
    }

    /**
     * Gets the current read framebuffer.
     * @returns {WebGLFramebuffer}
     */
    get readFramebuffer() {
        return this._framebuffers[this._readIndex];
    }

    /**
     * Gets the current write framebuffer.
     * @returns {WebGLFramebuffer}
     */
    get writeFramebuffer() {
        return this._framebuffers[this._writeIndex];
    }

    /**
     * Swaps read and write buffers. O(1) pointer swap operation.
     */
    swap() {
        const temp = this._readIndex;
        this._readIndex = this._writeIndex;
        this._writeIndex = temp;
    }

    /**
     * Binds the read texture to a specified texture unit.
     *
     * @param {number} unit - Texture unit index (0-15 typically)
     */
    bindRead(unit) {
        const gl = this._gl;
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, this._textures[this._readIndex]);
    }

    /**
     * Binds the write framebuffer and sets the viewport.
     */
    bindWrite() {
        const gl = this._gl;
        gl.bindFramebuffer(gl.FRAMEBUFFER, this._framebuffers[this._writeIndex]);
        gl.viewport(0, 0, this._width, this._height);
    }

    /**
     * Resizes both buffers to new dimensions.
     * Note: This clears the buffer contents.
     *
     * @param {number} width - New width in pixels
     * @param {number} height - New height in pixels
     */
    resize(width, height) {
        if (width === this._width && height === this._height) {
            return;
        }

        this._width = width;
        this._height = height;

        // Resize both textures
        resizeTexture(this._gl, this._textures[0], width, height, this._formatConfig);
        resizeTexture(this._gl, this._textures[1], width, height, this._formatConfig);
    }

    /**
     * Destroys all WebGL resources held by this DoubleFBO.
     */
    destroy() {
        const gl = this._gl;

        for (const fb of this._framebuffers) {
            gl.deleteFramebuffer(fb);
        }

        for (const tex of this._textures) {
            gl.deleteTexture(tex);
        }

        this._framebuffers = [];
        this._textures = [];
    }
}

// =============================================================================
// QUALITY DETECTION
// =============================================================================

/**
 * Detects device capabilities and returns recommended quality tier.
 *
 * @returns {{
 *   tier: 'desktop'|'mobile'|'fallback'|'none',
 *   isWebGL2: boolean,
 *   hasFloatTextures: boolean,
 *   isMobile: boolean,
 *   maxTextureSize: number,
 *   renderer: string
 * }}
 */
export function detectQuality() {
    const result = {
        tier: 'none',
        isWebGL2: false,
        hasFloatTextures: false,
        isMobile: false,
        maxTextureSize: 0,
        renderer: 'unknown'
    };

    // Detect mobile via User-Agent
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
    result.isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua) ||
                      (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1);

    // Create temporary canvas for capability detection
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;

    let gl = null;
    let isWebGL2 = false;

    // Try WebGL2 first
    try {
        gl = canvas.getContext('webgl2');
        if (gl) {
            isWebGL2 = true;
        }
    } catch (e) {
        // WebGL2 not available
    }

    // Fall back to WebGL1
    if (!gl) {
        try {
            gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
        } catch (e) {
            // WebGL not available at all
            return result;
        }
    }

    if (!gl) {
        return result;
    }

    result.isWebGL2 = isWebGL2;
    result.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);

    // Get renderer info
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    if (debugInfo) {
        result.renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
    }

    // Check float texture support
    const extensions = getExtensions(gl, isWebGL2);
    result.hasFloatTextures = extensions.hasFloatTextures;

    // Determine quality tier
    if (isWebGL2 && extensions.hasFloatTextures) {
        if (result.isMobile) {
            result.tier = 'mobile';
        } else {
            result.tier = 'desktop';
        }
    } else if (extensions.hasFloatTextures) {
        // WebGL1 with float textures
        result.tier = result.isMobile ? 'mobile' : 'fallback';
    } else {
        // No float textures - very limited
        result.tier = 'fallback';
    }

    // Clean up
    const loseContext = gl.getExtension('WEBGL_lose_context');
    if (loseContext) {
        loseContext.loseContext();
    }

    return result;
}

// =============================================================================
// ADDITIONAL UTILITY FUNCTIONS
// =============================================================================

/**
 * Creates a fullscreen quad vertex buffer.
 *
 * @param {WebGLRenderingContext|WebGL2RenderingContext} gl - The WebGL context
 * @returns {WebGLBuffer} Buffer containing fullscreen quad vertices
 */
export function createFullscreenQuadBuffer(gl) {
    const buffer = gl.createBuffer();
    if (!buffer) {
        throw new Error('Failed to create vertex buffer');
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);

    // Two triangles forming a fullscreen quad
    // Using clip space coordinates (-1 to 1)
    const vertices = new Float32Array([
        -1, -1,  // Bottom-left
         1, -1,  // Bottom-right
        -1,  1,  // Top-left
         1,  1   // Top-right
    ]);

    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    return buffer;
}

/**
 * Binds a fullscreen quad buffer and sets up vertex attributes.
 *
 * @param {WebGLRenderingContext|WebGL2RenderingContext} gl - The WebGL context
 * @param {WebGLBuffer} buffer - The quad buffer
 * @param {number} attributeLocation - The vertex attribute location
 */
export function bindFullscreenQuad(gl, buffer, attributeLocation) {
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(attributeLocation);
    gl.vertexAttribPointer(attributeLocation, 2, gl.FLOAT, false, 0, 0);
}

/**
 * Draws a fullscreen quad using triangle strip.
 *
 * @param {WebGLRenderingContext|WebGL2RenderingContext} gl - The WebGL context
 */
export function drawFullscreenQuad(gl) {
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

/**
 * Clears the current framebuffer with specified color.
 *
 * @param {WebGLRenderingContext|WebGL2RenderingContext} gl - The WebGL context
 * @param {number} r - Red component (0-1)
 * @param {number} g - Green component (0-1)
 * @param {number} b - Blue component (0-1)
 * @param {number} a - Alpha component (0-1)
 */
export function clear(gl, r = 0, g = 0, b = 0, a = 1) {
    gl.clearColor(r, g, b, a);
    gl.clear(gl.COLOR_BUFFER_BIT);
}

/**
 * Checks for WebGL errors and throws if any are found.
 *
 * @param {WebGLRenderingContext|WebGL2RenderingContext} gl - The WebGL context
 * @param {string} operation - Description of the operation being checked
 * @throws {Error} If a WebGL error is detected
 */
export function checkError(gl, operation = 'WebGL operation') {
    const error = gl.getError();
    if (error !== gl.NO_ERROR) {
        const errorMessages = {
            [gl.INVALID_ENUM]: 'INVALID_ENUM',
            [gl.INVALID_VALUE]: 'INVALID_VALUE',
            [gl.INVALID_OPERATION]: 'INVALID_OPERATION',
            [gl.INVALID_FRAMEBUFFER_OPERATION]: 'INVALID_FRAMEBUFFER_OPERATION',
            [gl.OUT_OF_MEMORY]: 'OUT_OF_MEMORY',
            [gl.CONTEXT_LOST_WEBGL]: 'CONTEXT_LOST_WEBGL'
        };
        const errorName = errorMessages[error] || `UNKNOWN (0x${error.toString(16)})`;
        throw new Error(`${operation} failed with error: ${errorName}`);
    }
}

/**
 * Gets the aspect ratio for a given width and height.
 *
 * @param {number} width - Width in pixels
 * @param {number} height - Height in pixels
 * @returns {number} Aspect ratio (width / height)
 */
export function getAspectRatio(width, height) {
    return width / height;
}

/**
 * Calculates simulation grid dimensions maintaining aspect ratio.
 *
 * @param {number} baseSize - Base grid size
 * @param {number} aspectRatio - Aspect ratio (width / height)
 * @returns {{width: number, height: number}}
 */
export function calculateGridSize(baseSize, aspectRatio) {
    if (aspectRatio >= 1) {
        return {
            width: Math.round(baseSize * aspectRatio),
            height: baseSize
        };
    } else {
        return {
            width: baseSize,
            height: Math.round(baseSize / aspectRatio)
        };
    }
}
