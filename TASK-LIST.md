# GPU Fluid Simulation - Ultra-Detailed Task List

> **Objective:** Create a breathtaking, GPU-accelerated 2D fluid simulation background for GitHub Pages with stunning visual impact.

---

## Color Palettes (Choose One)

### Aurora Borealis (Recommended)
| Role | Hex | RGB | Usage |
|------|-----|-----|-------|
| Background | `#050510` | 5, 5, 16 | Canvas base - deep void |
| Primary | `#00FF87` | 0, 255, 135 | High velocity regions - electric mint |
| Secondary | `#7C3AED` | 124, 58, 237 | Low velocity - electric violet |
| Accent | `#00D4FF` | 0, 212, 255 | Vortex cores - cyan glow |
| Highlight | `#FF6B9D` | 255, 107, 157 | Touch injection - aurora pink |

### Deep Ocean Bioluminescence
| Role | Hex | RGB | Usage |
|------|-----|-----|-------|
| Background | `#000814` | 0, 8, 20 | Deep ocean base |
| Primary | `#00F5D4` | 0, 245, 212 | Bioluminescent glow |
| Secondary | `#00BBF9` | 0, 187, 249 | Flow currents |
| Tertiary | `#0077B6` | 0, 119, 182 | Ambient field |
| Accent | `#9B5DE5` | 155, 94, 229 | Jellyfish purple |

### Cosmic Nebula
| Role | Hex | RGB | Usage |
|------|-----|-----|-------|
| Background | `#0D0221` | 13, 2, 33 | Cosmic void |
| Primary | `#FF006E` | 255, 0, 110 | Nebula magenta |
| Secondary | `#8338EC` | 131, 56, 236 | Cosmic purple |
| Tertiary | `#3A86FF` | 58, 134, 255 | Stellar blue |
| Hot Accent | `#FB5607` | 251, 86, 7 | Solar orange (high velocity) |

---

## Phase 1: WebGL Foundation

### Task 1.1: HTML Structure
**File:** `fluid/index.html`
**Priority:** P0 | **Complexity:** Low | **Dependencies:** None

- [ ] Create HTML5 document with `lang="en"` and UTF-8 charset
- [ ] Add viewport meta tag: `width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no`
- [ ] Add theme-color meta tag matching background color (`#050510`)
- [ ] Create full-screen `<canvas id="fluid-canvas">` element
- [ ] Add `aria-label="Interactive fluid simulation background"` for accessibility
- [ ] Add loading overlay with CSS spinner
- [ ] Create control panel container with:
  - [ ] Intensity slider (`range` input, min=0.2, max=2.0, step=0.1, default=1.0)
  - [ ] Pause toggle (checkbox styled as switch)
  - [ ] Value display span with `tabular-nums` font variant
- [ ] Add static fallback `<div>` with gradient background
- [ ] Include module script: `<script type="module" src="js/main.js"></script>`
- [ ] Add `touch-action: none` to canvas to prevent browser gestures

**Edge Cases:**
- Canvas must use `display: block` to prevent inline whitespace
- Set width/height attributes via JS, not CSS (prevents blurring)
- Include `prefers-reduced-motion` media query in CSS

---

### Task 1.2: WebGL Utilities
**File:** `fluid/js/gl-utils.js`
**Priority:** P0 | **Complexity:** High | **Dependencies:** None

#### Context Creation
- [ ] Implement `createContext(canvas, preferWebGL2)` function
- [ ] Request WebGL2 first with options:
  ```javascript
  {
    alpha: false,           // No alpha channel needed
    depth: false,           // 2D simulation
    stencil: false,         // Not needed
    antialias: false,       // Handle in shader
    preserveDrawingBuffer: false,  // Performance
    powerPreference: 'high-performance',
    failIfMajorPerformanceCaveat: false
  }
  ```
- [ ] Fall back to WebGL1 if WebGL2 unavailable
- [ ] Return `{ gl, isWebGL2, extensions }` object

#### Extension Management
- [ ] Check and enable `EXT_color_buffer_float` (WebGL2)
- [ ] Check and enable `OES_texture_half_float` (WebGL1 fallback)
- [ ] Check and enable `OES_texture_half_float_linear` (WebGL1 fallback)
- [ ] Check and enable `WEBGL_color_buffer_float` (WebGL1 fallback)
- [ ] Check `WEBGL_debug_renderer_info` for GPU detection

#### Shader Compilation
- [ ] Implement `compileShader(gl, type, source)` with detailed error reporting
- [ ] Parse shader info log for line numbers and errors
- [ ] Add `#version 300 es` header automatically for WebGL2
- [ ] Convert GLSL ES 3.0 to 1.0 for WebGL1 fallback:
  - `in` → `attribute`/`varying`
  - `out` → `varying`/`gl_FragColor`
  - `texture()` → `texture2D()`

#### Program Linking
- [ ] Implement `createProgram(gl, vertexSource, fragmentSource)`
- [ ] Cache uniform locations on creation
- [ ] Cache attribute locations on creation
- [ ] Return program object with cached locations

#### Texture Format Configuration
- [ ] Define `VELOCITY_FORMAT`:
  ```javascript
  {
    internalFormat: gl.RG16F,  // 4 bytes/texel (50% bandwidth savings)
    format: gl.RG,
    type: gl.HALF_FLOAT,
    filter: gl.LINEAR  // Required for smooth advection
  }
  ```
- [ ] Define `PRESSURE_FORMAT`:
  ```javascript
  {
    internalFormat: gl.R16F,  // 2 bytes/texel
    format: gl.RED,
    type: gl.HALF_FLOAT,
    filter: gl.NEAREST  // No interpolation needed
  }
  ```
- [ ] Define `DYE_FORMAT`:
  ```javascript
  {
    internalFormat: gl.RGBA8,  // 4 bytes/texel, sufficient for visualization
    format: gl.RGBA,
    type: gl.UNSIGNED_BYTE,
    filter: gl.LINEAR
  }
  ```
- [ ] Implement WebGL1 fallbacks (use `gl.RGBA` for all, `gl.LUMINANCE` for scalars)

#### Texture Creation
- [ ] Implement `createTexture(gl, width, height, formatConfig)`
- [ ] Set `CLAMP_TO_EDGE` wrapping (avoid boundary artifacts)
- [ ] Set appropriate filtering from format config
- [ ] Initialize with `null` data (GPU allocates without CPU transfer)

#### Framebuffer Management
- [ ] Implement `createFramebuffer(gl, texture)` for single FBO
- [ ] Verify framebuffer completeness with `checkFramebufferStatus`
- [ ] Log detailed error if incomplete

#### Double-Buffered FBO (Ping-Pong)
- [ ] Implement `DoubleFBO` class:
  ```javascript
  class DoubleFBO {
    constructor(gl, width, height, formatConfig)
    swap()        // O(1) pointer swap
    bindRead(unit)  // Bind read texture to texture unit
    bindWrite()     // Bind write FBO and set viewport
  }
  ```
- [ ] Pre-allocate both buffers on construction
- [ ] Cache viewport dimensions to avoid redundant `gl.viewport()` calls

#### State Caching
- [ ] Track current bound textures per unit
- [ ] Track current bound framebuffer
- [ ] Skip redundant `gl.bindTexture()` calls (~30% state change reduction)
- [ ] Skip redundant `gl.bindFramebuffer()` calls

**Edge Cases:**
- Safari requires explicit extension enabling before use
- Some Android devices falsely report WebGL2 support
- Context loss: add event listeners for `webglcontextlost` and `webglcontextrestored`
- Destroy test context after capability detection to prevent resource leaks

---

### Task 1.3: Fullscreen Quad Vertex Shader
**File:** `fluid/gl/quad.vert`
**Priority:** P0 | **Complexity:** Low | **Dependencies:** Task 1.2

- [ ] Implement attribute-less fullscreen quad for WebGL2:
  ```glsl
  #version 300 es
  out vec2 v_texCoord;

  void main() {
      // Generate quad from gl_VertexID (0,1,2)
      float x = float((gl_VertexID & 1) << 2);
      float y = float((gl_VertexID & 2) << 1);
      v_texCoord = vec2(x, y) * 0.5;
      gl_Position = vec4(x - 1.0, y - 1.0, 0.0, 1.0);
  }
  ```
- [ ] Implement buffer-based fallback for WebGL1:
  ```glsl
  attribute vec2 a_position;
  varying vec2 v_texCoord;

  void main() {
      v_texCoord = a_position * 0.5 + 0.5;
      gl_Position = vec4(a_position, 0.0, 1.0);
  }
  ```
- [ ] Create VAO for WebGL2 (required even for attribute-less)
- [ ] Create position buffer with vertices `[-1,-1, 1,-1, -1,1, 1,1]` for WebGL1

**Edge Cases:**
- WebGL1 does not have `gl_VertexID`
- Texture coordinate Y-flip may be needed when rendering to canvas vs FBO

---

### Task 1.4: Quality Detection System
**File:** `fluid/js/gl-utils.js` (continued)
**Priority:** P0 | **Complexity:** Medium | **Dependencies:** Task 1.2

#### Device Capability Detection
- [ ] Implement `detectQualityTier()` function
- [ ] Check WebGL2 availability first
- [ ] Check `EXT_color_buffer_float` extension
- [ ] Detect mobile via User-Agent: `/Android|iPhone|iPad|iPod/i`
- [ ] Check `navigator.maxTouchPoints` as secondary signal
- [ ] Get GPU renderer string via `WEBGL_debug_renderer_info`

#### GPU Tier Classification
- [ ] Define GPU patterns for each tier:
  ```javascript
  const GPU_TIERS = {
    high: [
      /NVIDIA.*RTX/i,
      /NVIDIA.*GTX\s*(10[6-8]0|1660|20[6-8]0|30[6-9]0|40[6-9]0)/i,
      /AMD.*RX\s*(5[6-9]00|6[6-9]00|7[6-9]00)/i,
      /Apple M[1-4]/i,
      /Apple GPU/i
    ],
    medium: [
      /Intel.*Iris/i,
      /Adreno.*[6-7][0-9][0-9]/i,
      /Mali-G[7-9]/i
    ],
    low: [
      /Intel.*HD/i,
      /Intel.*UHD/i,
      /Adreno.*[3-5][0-9][0-9]/i,
      /Mali-[TG][0-6]/i,
      /PowerVR/i
    ]
  };
  ```

#### Quality Presets
- [ ] Define preset configurations:
  | Tier | Grid Size | Pressure Iterations | Dye Resolution | Target FPS |
  |------|-----------|---------------------|----------------|------------|
  | Desktop | 256×256 (max 512) | 20-40 | 512-1024 | 60 |
  | Mobile | 128×128 | 10-15 | 256-512 | 30 |
  | Fallback | 96×96 | 6 | 128-256 | 30 |

- [ ] Apply mobile penalty (drop one tier if mobile)
- [ ] Return `{ tier, gridSize, iterations, webglVersion, floatTextures }`

**Edge Cases:**
- iPad reports as mobile but has desktop-class GPU (check screen size)
- Some browsers mask GPU info for privacy
- Thermal throttling may require runtime adjustment

---

## Phase 2: Simulation Shaders

### Task 2.1: Advection Shader
**File:** `fluid/gl/advect.frag`
**Priority:** P0 | **Complexity:** Medium | **Dependencies:** Task 1.2, 1.3

- [ ] Implement semi-Lagrangian advection:
  ```glsl
  #version 300 es
  precision highp float;

  uniform sampler2D u_velocity;
  uniform sampler2D u_source;      // Can be same as velocity (self-advection)
  uniform vec2 u_texelSize;        // 1.0 / resolution
  uniform float u_dt;              // Timestep
  uniform float u_dissipation;     // Decay factor (0.98-1.0)

  in vec2 v_texCoord;
  out vec4 fragColor;

  void main() {
      vec2 velocity = texture(u_velocity, v_texCoord).xy;
      vec2 prevPos = v_texCoord - u_dt * velocity * u_texelSize;
      vec4 result = texture(u_source, prevPos) * u_dissipation;
      fragColor = result;
  }
  ```
- [ ] Ensure `LINEAR` filtering on source texture for bilinear interpolation
- [ ] Use `highp` precision for coordinate calculations

**Edge Cases:**
- Timestep scaling: `dt * velocity * texelSize` all three factors critical
- Dissipation below 0.98 causes rapid decay; use 0.99-0.995
- With `CLAMP_TO_EDGE`, boundaries naturally reflect

**Testing:**
- Velocity patterns persist without exploding
- No NaN/Inf values
- Dye spreads smoothly without blocky artifacts

---

### Task 2.2: External Forces Shader
**File:** `fluid/gl/forces.frag`
**Priority:** P0 | **Complexity:** Medium | **Dependencies:** Task 2.1

- [ ] Implement Gaussian splat force injection:
  ```glsl
  uniform vec2 u_forcePosition;    // Normalized [0,1] coords
  uniform vec2 u_forceDirection;   // Direction vector
  uniform float u_forceRadius;     // ~0.05 (5% of screen)
  uniform float u_forceStrength;   // 0.0-1.0

  void main() {
      vec2 velocity = texture(u_velocity, v_texCoord).xy;
      float dist = distance(v_texCoord, u_forcePosition);
      float influence = exp(-dist * dist / (2.0 * u_forceRadius * u_forceRadius));
      velocity += u_forceDirection * u_forceStrength * influence;
      fragColor = vec4(velocity, 0.0, 1.0);
  }
  ```
- [ ] Add velocity magnitude clamping to prevent explosion
- [ ] Implement batch processing for multiple forces per frame

#### Procedural Noise Forces
- [ ] Implement Simplex noise function in shader
- [ ] Add ambient motion uniforms:
  ```glsl
  uniform float u_time;
  uniform float u_noiseScale;
  uniform float u_noiseStrength;
  ```
- [ ] Generate subtle continuous motion:
  ```glsl
  vec2 noiseForce = vec2(
      snoise(vec3(v_texCoord * u_noiseScale, u_time * 0.1)),
      snoise(vec3(v_texCoord * u_noiseScale + 100.0, u_time * 0.1))
  ) * u_noiseStrength;
  velocity += noiseForce;
  ```

**Edge Cases:**
- Force direction should scale with mouse velocity, not just direction
- Aspect ratio correction if grid is not square

---

### Task 2.3: Divergence Shader
**File:** `fluid/gl/divergence.frag`
**Priority:** P0 | **Complexity:** Low | **Dependencies:** Task 2.2

- [ ] Implement central difference divergence:
  ```glsl
  #version 300 es
  precision highp float;

  uniform sampler2D u_velocity;
  uniform vec2 u_texelSize;

  in vec2 v_texCoord;
  out float fragColor;

  void main() {
      // Use textureOffset for better cache locality
      float vL = textureOffset(u_velocity, v_texCoord, ivec2(-1, 0)).x;
      float vR = textureOffset(u_velocity, v_texCoord, ivec2( 1, 0)).x;
      float vB = textureOffset(u_velocity, v_texCoord, ivec2( 0,-1)).y;
      float vT = textureOffset(u_velocity, v_texCoord, ivec2( 0, 1)).y;

      fragColor = (vR - vL + vT - vB) * 0.5;
  }
  ```
- [ ] Output to single-channel `R16F` texture

**Edge Cases:**
- The 0.5 factor is from `1/(2*dx)` where `dx=1` grid cell
- Sign convention: positive divergence = source, negative = sink

---

### Task 2.4: Pressure Solver (Jacobi Iteration)
**File:** `fluid/gl/pressure.frag`
**Priority:** P0 | **Complexity:** Medium | **Dependencies:** Task 2.3

- [ ] Implement single Jacobi iteration:
  ```glsl
  #version 300 es
  precision mediump float;  // Lower precision acceptable for iterations

  uniform sampler2D u_pressure;
  uniform sampler2D u_divergence;

  in vec2 v_texCoord;
  out float fragColor;

  void main() {
      float pL = textureOffset(u_pressure, v_texCoord, ivec2(-1, 0)).x;
      float pR = textureOffset(u_pressure, v_texCoord, ivec2( 1, 0)).x;
      float pB = textureOffset(u_pressure, v_texCoord, ivec2( 0,-1)).x;
      float pT = textureOffset(u_pressure, v_texCoord, ivec2( 0, 1)).x;
      float div = texture(u_divergence, v_texCoord).x;

      fragColor = (pL + pR + pB + pT - div) * 0.25;
  }
  ```
- [ ] Clear pressure to zero before first iteration each frame
- [ ] Run 6-40 iterations depending on quality tier

**Iteration Loop (JS side):**
```javascript
function solvePressure(iterations) {
    gl.useProgram(pressureProgram);
    gl.uniform1i(uniforms.uDivergence, 1);
    fboManager.bindTexture(divergenceFBO.texture, 1);

    for (let i = 0; i < iterations; i++) {
        pressureFBO.bindRead(0);
        gl.uniform1i(uniforms.uPressure, 0);
        pressureFBO.bindWrite();
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        pressureFBO.swap();
    }
}
```

**Edge Cases:**
- `mediump` precision is sufficient for iterative solver (self-correcting)
- Natural Neumann boundary conditions from texture clamping

---

### Task 2.5: Gradient Subtraction
**File:** `fluid/gl/gradient.frag`
**Priority:** P0 | **Complexity:** Low | **Dependencies:** Task 2.4

- [ ] Implement pressure gradient subtraction:
  ```glsl
  #version 300 es
  precision highp float;

  uniform sampler2D u_pressure;
  uniform sampler2D u_velocity;

  in vec2 v_texCoord;
  out vec2 fragColor;

  void main() {
      float pL = textureOffset(u_pressure, v_texCoord, ivec2(-1, 0)).x;
      float pR = textureOffset(u_pressure, v_texCoord, ivec2( 1, 0)).x;
      float pB = textureOffset(u_pressure, v_texCoord, ivec2( 0,-1)).x;
      float pT = textureOffset(u_pressure, v_texCoord, ivec2( 0, 1)).x;

      vec2 gradient = vec2(pR - pL, pT - pB) * 0.5;
      vec2 velocity = texture(u_velocity, v_texCoord).xy;

      fragColor = velocity - gradient;
  }
  ```

**Result:** Divergence-free (incompressible) velocity field

---

### Task 2.6: Fluid Solver Orchestration
**File:** `fluid/js/fluid-solver.js`
**Priority:** P0 | **Complexity:** High | **Dependencies:** Tasks 2.1-2.5

#### FluidSolver Class
- [ ] Constructor: initialize all FBOs
  ```javascript
  this.velocityFBO = new DoubleFBO(gl, simWidth, simHeight, VELOCITY_FORMAT);
  this.pressureFBO = new DoubleFBO(gl, simWidth, simHeight, PRESSURE_FORMAT);
  this.divergenceFBO = createSingleFBO(gl, simWidth, simHeight, PRESSURE_FORMAT);
  this.dyeFBO = new DoubleFBO(gl, dyeWidth, dyeHeight, DYE_FORMAT);
  ```
- [ ] Compile all shader programs with cached uniforms
- [ ] Create fullscreen quad geometry

#### Simulation Step Method
- [ ] Implement `step(dt, forces)`:
  1. Advect velocity (self-advection)
  2. Apply external forces
  3. Compute divergence
  4. Solve pressure (N iterations)
  5. Subtract gradient
  6. Advect dye

- [ ] Proper FBO swap after each write operation
- [ ] Cap timestep: `dt = Math.min(dt, 0.033)` (30fps minimum)

#### Shader Loading
- [ ] Implement `loadShaders()` async method
- [ ] Consider embedding shaders as template strings (avoid CORS)
- [ ] Add shader hot-reload for development

**Edge Cases:**
- Reset `lastTime` on tab resume to prevent large dt jump
- Create VAO even for attribute-less rendering (WebGL2 requirement)

---

## Phase 3: Visual Rendering

### Task 3.1: Render Shader
**File:** `fluid/gl/render.frag`
**Priority:** P0 | **Complexity:** High | **Dependencies:** Task 2.6

#### Base Rendering
- [ ] Sample velocity and dye textures
- [ ] Compute vorticity for visual effects:
  ```glsl
  float computeVorticity(vec2 uv) {
      float vL = textureOffset(u_velocity, uv, ivec2(-1, 0)).y;
      float vR = textureOffset(u_velocity, uv, ivec2( 1, 0)).y;
      float vB = textureOffset(u_velocity, uv, ivec2( 0,-1)).x;
      float vT = textureOffset(u_velocity, uv, ivec2( 0, 1)).x;
      return (vR - vL) - (vT - vB);
  }
  ```

#### Velocity-Based Color Mapping
- [ ] Map velocity magnitude to color gradient:
  ```glsl
  vec3 velocityToColor(vec2 velocity, float vorticity) {
      float speed = length(velocity);
      float normalizedSpeed = clamp(speed * 2.0, 0.0, 1.0);
      float normalizedVorticity = clamp(abs(vorticity) * 5.0, 0.0, 1.0);

      vec3 color = mix(u_colorSecondary, u_colorPrimary, normalizedSpeed);
      color = mix(color, u_colorAccent, normalizedVorticity * 0.6);
      color *= 0.5 + normalizedSpeed * 0.8;

      return color;
  }
  ```

#### Bloom/Glow Effect
- [ ] Implement 9-tap blur kernel for cheap bloom:
  ```glsl
  vec3 cheapBloom(vec2 uv, vec3 baseColor, float intensity) {
      vec3 bloom = vec3(0.0);
      float weights[9] = float[](0.0625, 0.125, 0.0625,
                                  0.125,  0.25,  0.125,
                                  0.0625, 0.125, 0.0625);
      vec2 offsets[9] = vec2[](
          vec2(-1,-1), vec2(0,-1), vec2(1,-1),
          vec2(-1, 0), vec2(0, 0), vec2(1, 0),
          vec2(-1, 1), vec2(0, 1), vec2(1, 1)
      );

      for (int i = 0; i < 9; i++) {
          vec2 sampleUV = uv + offsets[i] * texelSize * 3.0;
          vec2 vel = texture(u_velocity, sampleUV).xy;
          bloom += velocityToColor(vel, 0.0) * length(vel) * weights[i];
      }
      return baseColor + bloom * intensity * 1.5;
  }
  ```

#### Noise Texture Overlay
- [ ] Implement Simplex noise function (same as forces shader)
- [ ] Add subtle organic texture:
  ```glsl
  float noiseTexture(vec2 uv) {
      float noise1 = snoise(uv * 8.0 + u_time * 0.05) * 0.5 + 0.5;
      float noise2 = snoise(uv * 16.0 - u_time * 0.03) * 0.5 + 0.5;
      return mix(noise1, noise2, 0.5) * 0.08;  // Very subtle
  }
  ```

#### Color Cycling
- [ ] Implement gentle hue rotation:
  ```glsl
  vec3 cycleColors(vec3 color, float phase) {
      float angle = phase * 0.3;  // Slow rotation
      // Hue rotation matrix...
      return hueRotation * color;
  }
  ```

#### Vignette
- [ ] Add depth vignette:
  ```glsl
  vec2 vignetteUV = uv * 2.0 - 1.0;
  float vignette = 1.0 - dot(vignetteUV, vignetteUV) * 0.15;
  finalColor *= vignette;
  ```

#### Uniforms Required
- [ ] `u_velocity` - sampler2D
- [ ] `u_dye` - sampler2D
- [ ] `u_time` - float
- [ ] `u_resolution` - vec2
- [ ] `u_intensity` - float
- [ ] `u_colorBg` - vec3 (`#050510` → `vec3(0.02, 0.02, 0.06)`)
- [ ] `u_colorPrimary` - vec3 (`#00FF87` → `vec3(0.0, 1.0, 0.53)`)
- [ ] `u_colorSecondary` - vec3 (`#7C3AED` → `vec3(0.49, 0.23, 0.93)`)
- [ ] `u_colorAccent` - vec3 (`#00D4FF` → `vec3(0.0, 0.83, 1.0)`)

---

### Task 3.2: Dye Injection System
**File:** `fluid/gl/dye.frag` or integrated in forces
**Priority:** P1 | **Complexity:** Medium | **Dependencies:** Task 3.1

- [ ] Inject dye at force injection points:
  ```glsl
  vec3 dye = texture(u_dye, v_texCoord).rgb;
  float dyeInfluence = exp(-dist * dist / (2.0 * radius * radius));
  dye += u_dyeColor * dyeInfluence;
  dye = clamp(dye, 0.0, 1.0);  // Prevent saturation
  ```
- [ ] Cycle dye colors based on velocity direction or time
- [ ] Add procedural dye sources for ambient visual interest

---

## Phase 4: Input Handling

### Task 4.1: Input Manager
**File:** `fluid/js/input.js`
**Priority:** P0 | **Complexity:** Medium | **Dependencies:** None

#### Mouse Events
- [ ] Listen for `mousedown`, `mousemove`, `mouseup`, `mouseleave`
- [ ] Track pressed state and last position
- [ ] Convert screen coordinates to normalized [0,1]:
  ```javascript
  const rect = canvas.getBoundingClientRect();
  const x = (e.clientX - rect.left) / rect.width;
  const y = 1.0 - (e.clientY - rect.top) / rect.height;  // Flip Y
  ```
- [ ] Calculate force direction from delta position
- [ ] Scale force strength by drag speed

#### Touch Events
- [ ] Listen for `touchstart`, `touchmove`, `touchend`, `touchcancel`
- [ ] Use `{ passive: false }` to enable `preventDefault()`
- [ ] Call `e.preventDefault()` to prevent scrolling
- [ ] Handle multi-touch via `e.touches` array

#### Force Generation
- [ ] Create force objects:
  ```javascript
  {
    position: { x, y },
    direction: { x: dx * 10, y: dy * 10 },
    radius: 0.05,
    strength: Math.min(speed * 100, 1.0)
  }
  ```
- [ ] Clear forces after each frame to prevent buildup
- [ ] Implement `getForces()` method that returns and clears array

**Edge Cases:**
- Y-coordinate flip (screen Y is down, simulation Y is up)
- Force accumulation on high-refresh displays (debounce)
- Multi-touch handling for multiple fingers

---

## Phase 5: UI Controls

### Task 5.1: UI Manager
**File:** `fluid/js/ui.js`
**Priority:** P1 | **Complexity:** Medium | **Dependencies:** Task 2.6

#### Intensity Slider Mapping
- [ ] Map slider [0.2 - 2.0] to simulation parameters:
  | Intensity | Dissipation | Force Strength | Noise Strength |
  |-----------|-------------|----------------|----------------|
  | 0.2 (min) | 0.995 | 0.3 | 0.005 |
  | 1.0 | 0.99 | 0.6 | 0.01 |
  | 2.0 (max) | 0.98 | 1.0 | 0.02 |

- [ ] Implement linear interpolation for parameter curves
- [ ] Update value display in real-time
- [ ] Consider localStorage for preference persistence

#### Pause Toggle
- [ ] Wire checkbox to `solver.pause()` / `solver.resume()`
- [ ] Update toggle visual state

#### Reduced Motion Support
- [ ] Check `window.matchMedia('(prefers-reduced-motion: reduce)')`
- [ ] Listen for changes: `mediaQuery.addEventListener('change', ...)`
- [ ] Enable static mode when active:
  - Pause simulation
  - Display static gradient
  - Hide/disable slider

---

### Task 5.2: Visibility & Power Management
**File:** `fluid/js/ui.js` (continued)
**Priority:** P1 | **Complexity:** Low | **Dependencies:** Task 5.1

#### Tab Visibility
- [ ] Listen for `visibilitychange`:
  ```javascript
  document.addEventListener('visibilitychange', () => {
      if (document.hidden) solver.pause();
      else solver.resume();
  });
  ```
- [ ] Reset `lastTime` on resume to prevent large dt

#### Window Focus
- [ ] Listen for `blur` / `focus` events
- [ ] Enable low-power mode on blur

#### Resize Handling
- [ ] Debounce resize events (100-150ms)
- [ ] Implement `solver.resize(width, height)`
- [ ] Recreate textures/FBOs on significant size change

#### Battery Awareness (Optional)
- [ ] Use `navigator.getBattery()` API if available
- [ ] Reduce quality when battery < 30%
- [ ] Restore quality when charging

---

## Phase 6: CSS Styling

### Task 6.1: Styles
**File:** `fluid/style.css`
**Priority:** P1 | **Complexity:** Medium | **Dependencies:** Task 1.1

#### CSS Custom Properties
```css
:root {
    --bg-void: #050510;
    --bg-surface: #0a0a1a;
    --bg-overlay: rgba(10, 10, 26, 0.85);

    --color-primary: #00FF87;
    --color-secondary: #7C3AED;
    --color-accent: #00D4FF;
    --color-text: #E8E8F0;
    --color-text-muted: #8888A0;

    --shadow-glow: 0 0 20px rgba(0, 255, 135, 0.3);
}
```

#### Canvas Layer
- [ ] Fixed positioning, full viewport
- [ ] `z-index: -1` for background
- [ ] `touch-action: none`

#### Control Panel (Glassmorphism)
- [ ] Fixed bottom-center positioning
- [ ] `backdrop-filter: blur(12px)`
- [ ] Semi-transparent background
- [ ] Subtle border and shadow
- [ ] Transition opacity on hover

#### Custom Range Slider
- [ ] Hide default appearance
- [ ] Gradient track: primary → accent → secondary
- [ ] Circular thumb with glow shadow
- [ ] Hover/active states with scale transform

#### Toggle Switch
- [ ] Custom checkbox styling
- [ ] Animated thumb transition
- [ ] Gradient track when checked

#### Responsive Breakpoints
- [ ] Mobile (<480px): Stack controls vertically
- [ ] Tablet (480-768px): Compact horizontal
- [ ] Desktop (>768px): Full horizontal with larger elements

#### Accessibility
- [ ] `:focus-visible` outlines with accent color
- [ ] `.visually-hidden` utility class
- [ ] Sufficient contrast ratios

#### Reduced Motion
```css
@media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
        transition-duration: 0.01ms !important;
        animation-duration: 0.01ms !important;
    }
    #fluid-canvas { display: none; }
    .static-fallback { display: block; }
}
```

#### Static Fallback
- [ ] Gradient background matching color palette
- [ ] `z-index: -2` (behind canvas)

---

## Phase 7: WebGL1 Fallback

### Task 7.1: Compatibility Layer
**File:** `fluid/js/gl-utils.js` (additions)
**Priority:** P2 | **Complexity:** High | **Dependencies:** Tasks 1.2, 2.1-2.5

#### Shader Conversion
- [ ] Remove `#version 300 es` directive
- [ ] Convert `in`/`out` to `attribute`/`varying`
- [ ] Replace `texture()` with `texture2D()`
- [ ] Use `gl_FragColor` instead of `out` variable

#### Texture Format Fallbacks
- [ ] Use `gl.RGBA` for all textures (no `gl.RG` or `gl.RED`)
- [ ] Use `gl.LUMINANCE` for scalar fields if available
- [ ] Fall back to `UNSIGNED_BYTE` if no float texture support

#### Extension Handling
- [ ] Check `OES_texture_half_float` for half-float textures
- [ ] Check `OES_texture_half_float_linear` for filtering
- [ ] Check `WEBGL_color_buffer_float` for render-to-float

---

## Phase 8: Performance Optimization

### Task 8.1: Adaptive Quality Controller
**File:** `fluid/js/fluid-solver.js` (additions)
**Priority:** P1 | **Complexity:** Medium | **Dependencies:** Task 2.6

#### Frame Time Monitoring
- [ ] Track last 60 frame times
- [ ] Calculate average and P95 frame time
- [ ] Define quality level 0.0-1.0

#### Quality Adjustment Logic
- [ ] If P95 > target * 1.2: decrease quality
- [ ] If P95 < target * 0.7: increase quality
- [ ] Apply cooldown after adjustment (15-30 frames)

#### Adjustable Parameters
- [ ] Pressure iterations (cheap to adjust)
- [ ] Dye resolution (moderate impact)
- [ ] Simulation resolution (expensive, last resort)

#### Frame Rate Limiting
- [ ] Implement fixed timestep for physics
- [ ] Target 30fps on mobile, 60fps on desktop
- [ ] Skip frames rather than simulate slowly

---

### Task 8.2: Memory Bandwidth Optimization
**Priority:** P2 | **Complexity:** Low | **Dependencies:** Task 1.2

- [ ] Use RG16F for velocity (50% bandwidth vs RG32F)
- [ ] Use R16F for pressure/divergence
- [ ] Use RGBA8 for dye (sufficient for visualization)
- [ ] Use `textureOffset` for better cache locality

**Bandwidth Analysis (512×512):**
```
RG32F velocity: 512 × 512 × 8 = 2.1 MB per read/write
RG16F velocity: 512 × 512 × 4 = 1.0 MB per read/write
Savings: 50% bandwidth reduction
```

---

## Phase 9: Integration & Entry Point

### Task 9.1: Main Entry Point
**File:** `fluid/js/main.js`
**Priority:** P0 | **Complexity:** Medium | **Dependencies:** All previous tasks

```javascript
import { detectQuality, createContext, QUALITY_PRESETS } from './gl-utils.js';
import { FluidSolver } from './fluid-solver.js';
import { InputManager } from './input.js';
import { UIManager } from './ui.js';

async function init() {
    const canvas = document.getElementById('fluid-canvas');

    // 1. Detect capabilities
    const capabilities = detectQuality();
    if (capabilities.tier === 'none') {
        showStaticFallback();
        return;
    }

    // 2. Create context
    const gl = createContext(canvas, capabilities.webgl);
    if (!gl) {
        showStaticFallback();
        return;
    }

    // 3. Apply quality preset
    const config = { ...QUALITY_PRESETS[capabilities.tier] };

    // 4. Initialize components
    const solver = new FluidSolver(gl, config);
    const input = new InputManager(canvas);
    const ui = new UIManager(solver, config);

    // 5. Load shaders
    await solver.loadShaders();

    // 6. Hide loading overlay
    document.getElementById('loading').classList.add('hidden');

    // 7. Start animation loop
    let lastTime = performance.now();
    function animate(currentTime) {
        const dt = Math.min((currentTime - lastTime) / 1000, 0.033);
        lastTime = currentTime;

        solver.step(dt, input.getForces());
        solver.render(null);

        requestAnimationFrame(animate);
    }

    requestAnimationFrame(animate);
}

// Context loss handling
canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    solver.pause();
});

canvas.addEventListener('webglcontextrestored', () => {
    solver.reinitialize();
    solver.resume();
});

init().catch(console.error);
```

---

## Testing Checklist

### Browser Compatibility
| Browser | Platform | Target FPS | Status |
|---------|----------|------------|--------|
| Chrome | Desktop | 60 | [ ] |
| Firefox | Desktop | 60 | [ ] |
| Safari | Desktop | 45-60 | [ ] |
| Edge | Desktop | 60 | [ ] |
| Safari | iPhone | 30 | [ ] |
| Chrome | Android | 30 | [ ] |
| Samsung Internet | Android | 30 | [ ] |

### Performance Metrics
- [ ] Consistent frame rate (no stuttering)
- [ ] No memory leaks over 5+ minutes
- [ ] Graceful degradation on low-end devices
- [ ] Proper pause when tab hidden
- [ ] Battery drain acceptable on mobile

### Accessibility
- [ ] `prefers-reduced-motion` respected
- [ ] Keyboard navigation works
- [ ] Screen reader announces controls
- [ ] Focus indicators visible
- [ ] Touch targets ≥44px

### Visual Quality
- [ ] Colors match design spec
- [ ] Smooth advection (no blocky artifacts)
- [ ] Bloom/glow visible but subtle
- [ ] No banding in gradients
- [ ] Vignette adds depth

---

## Implementation Order (Recommended)

### Week 1: Foundation + Minimal Pipeline
1. Task 1.1: HTML structure
2. Task 1.2: WebGL utilities (partial)
3. Task 1.3: Fullscreen quad
4. Task 2.1: Advection shader
5. Test: Render velocity as color

### Week 2: Complete Simulation
6. Task 2.3: Divergence shader
7. Task 2.4: Pressure solver
8. Task 2.5: Gradient subtraction
9. Task 2.6: Fluid solver orchestration
10. Test: Incompressible flow verified

### Week 3: Interactivity + Visuals
11. Task 4.1: Input manager
12. Task 2.2: Forces shader
13. Task 3.1: Render shader
14. Task 3.2: Dye injection
15. Test: Full interactive demo

### Week 4: Polish + Optimization
16. Task 5.1: UI manager
17. Task 5.2: Visibility handling
18. Task 6.1: CSS styling
19. Task 8.1: Adaptive quality
20. Task 1.4: Quality detection

### Week 5: Fallbacks + Testing
21. Task 7.1: WebGL1 compatibility
22. Cross-browser testing
23. Mobile testing
24. Performance profiling
25. Final polish

---

## File Structure Summary

```
fluid-sim/
├── CLAUDE.md                    # AI guidance
├── FLUID-SIM-SPEC.md           # Technical specification
├── TASK-LIST.md                # This file
└── fluid/
    ├── index.html              # Entry point
    ├── style.css               # All styling
    ├── js/
    │   ├── main.js             # Entry point, initialization
    │   ├── fluid-solver.js     # Core simulation orchestration
    │   ├── gl-utils.js         # WebGL helpers
    │   ├── input.js            # Mouse/touch handling
    │   └── ui.js               # Controls and preferences
    └── gl/
        ├── quad.vert           # Fullscreen quad vertex shader
        ├── advect.frag         # Semi-Lagrangian advection
        ├── forces.frag         # External force injection
        ├── divergence.frag     # Divergence calculation
        ├── pressure.frag       # Jacobi pressure iteration
        ├── gradient.frag       # Gradient subtraction
        └── render.frag         # Final visualization
```

---

## Dependencies Graph

```
Phase 1 (Foundation)
├─ Task 1.1: index.html
├─ Task 1.2: gl-utils.js ──────────────────────────────────┐
├─ Task 1.3: quad.vert ← depends on Task 1.2              │
└─ Task 1.4: quality detection ← depends on Task 1.2      │
                                                           │
Phase 2 (Simulation) ← depends on Phase 1                  │
├─ Task 2.1: advect.frag ← depends on Tasks 1.2, 1.3      │
├─ Task 2.2: forces.frag ← depends on Task 2.1            │
├─ Task 2.3: divergence.frag ← depends on Task 2.2        │
├─ Task 2.4: pressure.frag ← depends on Task 2.3          │
├─ Task 2.5: gradient.frag ← depends on Task 2.4          │
└─ Task 2.6: fluid-solver.js ← depends on Tasks 2.1-2.5   │
                                                           │
Phase 3 (Rendering) ← depends on Phase 2                   │
├─ Task 3.1: render.frag ← depends on Task 2.6            │
└─ Task 3.2: dye injection ← depends on Task 3.1          │
                                                           │
Phase 4 (Input) ← can run in parallel with Phase 2         │
└─ Task 4.1: input.js                                      │
                                                           │
Phase 5 (UI) ← depends on Phases 2, 4                      │
├─ Task 5.1: ui.js ← depends on Task 2.6                  │
└─ Task 5.2: visibility ← depends on Task 5.1             │
                                                           │
Phase 6 (CSS) ← can run in parallel                        │
└─ Task 6.1: style.css                                     │
                                                           │
Phase 7 (Fallback) ← depends on Phase 2                    │
└─ Task 7.1: WebGL1 compat ← depends on Tasks 1.2, 2.1-2.5│
                                                           │
Phase 8 (Optimization) ← depends on Phase 2                │
├─ Task 8.1: adaptive quality ← depends on Task 2.6       │
└─ Task 8.2: bandwidth opt ← depends on Task 1.2 ─────────┘

Phase 9 (Integration) ← depends on ALL
└─ Task 9.1: main.js ← depends on all previous tasks
```

---

*Generated with Claude Code via scientific-skills:fluidsim analysis*
