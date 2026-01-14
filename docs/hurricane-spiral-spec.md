# Hurricane Spiral Implementation Specification

## Overview

This document specifies the implementation of a hurricane-like spiral vortex pattern for the fluid simulation. The feature will allow users to generate realistic cyclonic flow patterns that start from a configurable center point and expand outward.

### Goals

1. **Physical Accuracy**: Implement the Rankine Vortex model for realistic hurricane dynamics
2. **Performance**: Use a dedicated GPU shader for real-time pattern generation
3. **Usability**: Provide intuitive UI controls and preset configurations
4. **Integration**: Seamlessly integrate with existing simulation pipeline

### Solution Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     HURRICANE SYSTEM                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐       │
│  │ hurricane.   │    │ HurricaneAPI │    │    UI        │       │
│  │ frag (GLSL)  │◄───│ (JavaScript) │◄───│  Controls    │       │
│  └──────────────┘    └──────────────┘    └──────────────┘       │
│         │                   │                   │                │
│         ▼                   ▼                   ▼                │
│  ┌─────────────────────────────────────────────────────┐        │
│  │              Existing Simulation Pipeline            │        │
│  │  velocity → vorticity → pressure → advection → dye  │        │
│  └─────────────────────────────────────────────────────┘        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 1. Physics Model: Rankine Vortex

### Mathematical Foundation

The Rankine Vortex is a standard model for atmospheric vortices, combining:
- **Inner core** (r < R_max): Solid body rotation (linear velocity profile)
- **Outer region** (r > R_max): Irrotational vortex (1/r velocity decay)

### Velocity Equations

```
For tangential velocity V_θ(r):

    ┌ V_max × (r / R_max)       if r ≤ R_max  (inner core)
V_θ = │
    └ V_max × (R_max / r)       if r > R_max  (outer region)

Where:
    r       = distance from vortex center
    R_max   = radius of maximum winds (eye wall)
    V_max   = maximum tangential velocity
```

### Spiral Component (Radial Outflow)

To create the characteristic spiral arms, add radial velocity:

```
V_r(r) = α × V_θ(r)

Where:
    α = expansion coefficient (typically 0.1 - 0.3)

Final velocity vector:
    V = V_θ × tangent_unit + V_r × radial_unit

Where:
    tangent_unit = (-sin(θ), cos(θ))   for counter-clockwise
    radial_unit  = (cos(θ), sin(θ))    for outward expansion
```

### Vorticity Profile

The curl (vorticity) of the Rankine vortex:

```
         ┌ 2 × V_max / R_max    if r ≤ R_max  (constant in core)
ω(r) =   │
         └ 0                     if r > R_max  (irrotational outside)
```

This sharp transition creates the characteristic "eye wall" of hurricanes.

---

## 2. Shader Specification: `hurricane.frag`

### File Location
```
gl/hurricane.frag
```

### Uniforms

| Uniform | Type | Description | Default |
|---------|------|-------------|---------|
| `u_velocity` | `sampler2D` | Current velocity field | - |
| `u_center` | `vec2` | Hurricane center (normalized 0-1) | `(0.5, 0.5)` |
| `u_eyeRadius` | `float` | Eye radius (normalized) | `0.02` |
| `u_maxRadius` | `float` | Maximum influence radius | `0.4` |
| `u_strength` | `float` | Maximum tangential velocity | `1.0` |
| `u_expansion` | `float` | Radial expansion coefficient | `0.15` |
| `u_rotation` | `float` | Rotation direction: 1.0=CCW, -1.0=CW | `1.0` |
| `u_aspectRatio` | `float` | Canvas aspect ratio | `1.0` |
| `u_blend` | `float` | Blend factor with existing velocity | `1.0` |
| `u_texelSize` | `vec2` | Pixel size for scaling | - |

### GLSL Implementation

```glsl
#version 300 es
precision highp float;

uniform sampler2D u_velocity;
uniform vec2 u_center;
uniform float u_eyeRadius;
uniform float u_maxRadius;
uniform float u_strength;
uniform float u_expansion;
uniform float u_rotation;
uniform float u_aspectRatio;
uniform float u_blend;
uniform vec2 u_texelSize;

in vec2 v_texCoord;
out vec4 fragColor;

void main() {
    // Read existing velocity
    vec2 velocity = texture(u_velocity, v_texCoord).xy;

    // Vector from center (aspect-corrected)
    vec2 pos = v_texCoord - u_center;
    pos.x *= u_aspectRatio;

    // Distance from center
    float r = length(pos);

    // Early exit: outside influence radius or at center
    if (r > u_maxRadius || r < 0.0001) {
        fragColor = vec4(velocity, 0.0, 1.0);
        return;
    }

    // Rankine vortex profile
    float R_max = u_eyeRadius * 2.0;  // Eye wall at 2x eye radius
    float V_theta;

    if (r < R_max) {
        // Inner core: solid body rotation (linear increase)
        V_theta = u_strength * (r / R_max);
    } else {
        // Outer region: irrotational vortex (1/r decay)
        V_theta = u_strength * (R_max / r);
    }

    // Smooth falloff at outer edge (prevents sharp discontinuity)
    float edgeFalloff = smoothstep(u_maxRadius, u_maxRadius * 0.6, r);
    V_theta *= edgeFalloff;

    // Eye calm zone (very low velocity inside eye)
    float eyeCalm = smoothstep(0.0, u_eyeRadius, r);
    V_theta *= eyeCalm;

    // Compute angle
    float theta = atan(pos.y, pos.x);

    // Tangential unit vector (perpendicular to radius)
    // CCW: (-sin, cos), CW: (sin, -cos)
    vec2 tangent = u_rotation * vec2(-sin(theta), cos(theta));

    // Radial unit vector (outward from center)
    vec2 radial = vec2(cos(theta), sin(theta));

    // Combine tangential + radial components
    vec2 hurricaneVel = tangent * V_theta + radial * V_theta * u_expansion;

    // Scale by texel size for proper velocity magnitude
    hurricaneVel *= u_texelSize.x * 100.0;

    // Blend with existing velocity
    velocity = mix(velocity, velocity + hurricaneVel, u_blend);

    fragColor = vec4(velocity, 0.0, 1.0);
}
```

### Shader Integration Point

The shader should be applied in `simulation.js` **before** the vorticity confinement step:

```
1. Advect velocity
2. Apply external forces (mouse/touch)
3. >>> Apply hurricane shader <<<  (NEW)
4. Compute curl
5. Apply vorticity confinement
6. Compute divergence
7. Solve pressure
8. Subtract gradient
9. Advect dye
```

---

## 3. JavaScript API Specification

### File Location
```
js/hurricane.js (new file)
```

### Class: `HurricaneGenerator`

```javascript
/**
 * Generates and manages hurricane spiral patterns in the fluid simulation.
 * Uses the Rankine vortex model for physically accurate cyclonic flow.
 */
class HurricaneGenerator {
    /**
     * @param {FluidSolver} solver - Reference to the fluid solver instance
     */
    constructor(solver) {}

    /**
     * Initialize WebGL resources (shader program, uniforms)
     * @returns {Promise<void>}
     */
    async init() {}

    /**
     * Configure hurricane parameters
     * @param {HurricaneConfig} config - Hurricane configuration object
     */
    configure(config) {}

    /**
     * Apply hurricane velocity field to the simulation
     * Called each frame when hurricane is active
     * @param {WebGLTexture} velocityTexture - Current velocity field
     * @returns {WebGLTexture} - Modified velocity field
     */
    apply(velocityTexture) {}

    /**
     * Start hurricane generation at specified position
     * @param {number} x - Center X (0-1 normalized)
     * @param {number} y - Center Y (0-1 normalized)
     * @param {HurricaneConfig} [config] - Optional config override
     */
    start(x, y, config) {}

    /**
     * Stop hurricane generation (let it dissipate naturally)
     */
    stop() {}

    /**
     * Check if hurricane is currently active
     * @returns {boolean}
     */
    isActive() {}

    /**
     * Update hurricane center position (for moving hurricanes)
     * @param {number} x - New center X
     * @param {number} y - New center Y
     */
    setCenter(x, y) {}

    /**
     * Clean up WebGL resources
     */
    destroy() {}
}
```

### Type: `HurricaneConfig`

```typescript
interface HurricaneConfig {
    /** Eye radius in normalized coordinates (0-1). Default: 0.02 */
    eyeRadius: number;

    /** Maximum influence radius. Default: 0.4 */
    maxRadius: number;

    /** Maximum tangential velocity. Default: 1.0 */
    strength: number;

    /** Radial expansion coefficient (0 = pure rotation). Default: 0.15 */
    expansion: number;

    /** Rotation direction: 1 = CCW (Northern hemisphere), -1 = CW. Default: 1 */
    rotation: 1 | -1;

    /** Blend factor with existing velocity (0-1). Default: 1.0 */
    blend: number;

    /** Application mode. Default: 'continuous' */
    mode: 'impulse' | 'continuous' | 'decaying';

    /** Decay rate for 'decaying' mode (per second). Default: 0.1 */
    decayRate: number;
}
```

### Preset Configurations

```javascript
const HURRICANE_PRESETS = {
    // Gentle tropical storm
    tropical: {
        eyeRadius: 0.03,
        maxRadius: 0.3,
        strength: 0.6,
        expansion: 0.1,
        rotation: 1,
        mode: 'continuous'
    },

    // Category 3 hurricane
    category3: {
        eyeRadius: 0.025,
        maxRadius: 0.4,
        strength: 1.0,
        expansion: 0.15,
        rotation: 1,
        mode: 'continuous'
    },

    // Intense category 5
    category5: {
        eyeRadius: 0.015,
        maxRadius: 0.5,
        strength: 1.5,
        expansion: 0.2,
        rotation: 1,
        mode: 'continuous'
    },

    // Southern hemisphere cyclone (clockwise)
    cycloneSouth: {
        eyeRadius: 0.025,
        maxRadius: 0.4,
        strength: 1.0,
        expansion: 0.15,
        rotation: -1,
        mode: 'continuous'
    },

    // Single impulse vortex
    vortexBurst: {
        eyeRadius: 0.02,
        maxRadius: 0.35,
        strength: 2.0,
        expansion: 0.25,
        rotation: 1,
        mode: 'impulse'
    },

    // Decaying storm
    fadingStorm: {
        eyeRadius: 0.03,
        maxRadius: 0.4,
        strength: 1.2,
        expansion: 0.15,
        rotation: 1,
        mode: 'decaying',
        decayRate: 0.15
    }
};
```

---

## 4. Integration with FluidSolver

### Modifications to `fluid-solver.js`

```javascript
class FluidSolver {
    constructor() {
        // ... existing code ...
        this._hurricane = null;
    }

    async init() {
        // ... existing init code ...

        // Initialize hurricane generator
        this._hurricane = new HurricaneGenerator(this);
        await this._hurricane.init();
    }

    step(dt, forces, dyes) {
        // ... existing force application ...

        // Apply hurricane if active
        if (this._hurricane.isActive()) {
            this._hurricane.apply(this._fbos.velocity.read.texture);
        }

        // ... rest of simulation step ...
    }

    // Public API methods
    startHurricane(x, y, config) {
        this._hurricane.start(x, y, config);
    }

    stopHurricane() {
        this._hurricane.stop();
    }

    setHurricanePreset(presetName) {
        const preset = HURRICANE_PRESETS[presetName];
        if (preset) {
            this._hurricane.configure(preset);
        }
    }
}
```

---

## 5. UI Controls Specification

### New UI Panel Section

Add to the existing control panel in `ui.js`:

```
┌─────────────────────────────────────┐
│ Hurricane Controls                   │
├─────────────────────────────────────┤
│                                      │
│ [▼ Preset: Category 3        ]      │
│                                      │
│ Strength      ●────────────○  1.0   │
│ Eye Radius    ○──●─────────○  0.025 │
│ Max Radius    ○──────●─────○  0.4   │
│ Expansion     ○───●────────○  0.15  │
│                                      │
│ Rotation:  ◉ CCW (N)  ○ CW (S)      │
│                                      │
│ [ Start at Center ]  [ Stop ]       │
│                                      │
│ ☑ Click to place hurricane          │
│                                      │
└─────────────────────────────────────┘
```

### Control Specifications

| Control | Type | Range | Default | Description |
|---------|------|-------|---------|-------------|
| Preset | Dropdown | presets | category3 | Quick configuration selection |
| Strength | Slider | 0.1 - 2.0 | 1.0 | Maximum tangential velocity |
| Eye Radius | Slider | 0.01 - 0.1 | 0.025 | Size of calm center |
| Max Radius | Slider | 0.1 - 0.6 | 0.4 | Extent of influence |
| Expansion | Slider | 0.0 - 0.5 | 0.15 | Outward spiral strength |
| Rotation | Radio | CCW/CW | CCW | Hemisphere selection |
| Click to place | Checkbox | - | false | Enable click positioning |

### Interaction Modes

1. **Button Mode**: Click "Start at Center" to create hurricane at canvas center
2. **Click Mode**: When checkbox enabled, click anywhere to place hurricane
3. **Drag Mode**: (Future) Drag to move active hurricane

---

## 6. Configuration Integration

### Additions to `config.js`

```javascript
const CONFIG = {
    // ... existing config ...

    // Hurricane defaults
    hurricane: {
        enabled: false,
        preset: 'category3',
        eyeRadius: 0.025,
        maxRadius: 0.4,
        strength: 1.0,
        expansion: 0.15,
        rotation: 1,
        mode: 'continuous',
        decayRate: 0.1,
        center: { x: 0.5, y: 0.5 }
    }
};
```

### Preset Integration

Add hurricane presets to existing preset system:

```javascript
const PRESETS = {
    // ... existing presets ...

    Hurricane: {
        ...DEFAULT_CONFIG,
        curl: 50,                    // Higher vorticity confinement
        velocityDissipation: 0.05,   // Lower dissipation
        dyeDissipation: 0.02,
        hurricane: {
            enabled: true,
            preset: 'category3'
        }
    },

    TropicalStorm: {
        ...DEFAULT_CONFIG,
        curl: 40,
        velocityDissipation: 0.08,
        hurricane: {
            enabled: true,
            preset: 'tropical'
        }
    },

    Cyclone: {
        ...DEFAULT_CONFIG,
        curl: 50,
        velocityDissipation: 0.05,
        hurricane: {
            enabled: true,
            preset: 'cycloneSouth'
        }
    }
};
```

---

## 7. File Structure

### New Files

```
fluid-sim/
├── gl/
│   └── hurricane.frag          # Hurricane velocity shader
├── js/
│   └── hurricane.js            # HurricaneGenerator class
└── docs/
    └── hurricane-spiral-spec.md # This specification
```

### Modified Files

```
fluid-sim/
├── js/
│   ├── fluid-solver.js         # Add hurricane integration
│   ├── config.js               # Add hurricane config
│   ├── ui.js                   # Add hurricane controls
│   └── shader-loader.js        # Load hurricane.frag
└── index.html                  # (optional) Add hurricane.js script
```

---

## 8. Testing Plan

### Unit Tests

1. **Shader Output Validation**
   - Verify velocity magnitude follows Rankine profile
   - Verify rotation direction (CCW vs CW)
   - Verify eye calm zone (near-zero velocity at center)
   - Verify smooth falloff at edges

2. **API Tests**
   - `start()` / `stop()` lifecycle
   - Configuration updates during runtime
   - Preset loading

### Visual Tests

1. **Static Pattern**
   - Pause simulation, verify spiral arm structure
   - Verify eye visibility

2. **Dynamic Behavior**
   - Verify vorticity confinement amplifies the spiral
   - Verify dye follows spiral pattern
   - Verify natural dissipation when stopped

3. **Edge Cases**
   - Hurricane at canvas edge
   - Multiple hurricane creation
   - Rapid start/stop cycles

### Performance Tests

1. **Frame Rate**
   - Measure FPS with hurricane active
   - Compare with baseline (no hurricane)
   - Target: < 5% FPS reduction

2. **Memory**
   - No memory leaks on start/stop cycles
   - Shader compilation time

---

## 9. Implementation Order

### Phase 1: Core Shader
1. Create `hurricane.frag` with basic Rankine vortex
2. Test standalone with hardcoded uniforms
3. Verify velocity field output

### Phase 2: JavaScript API
1. Create `HurricaneGenerator` class
2. Implement shader loading and uniform binding
3. Integrate with FluidSolver.step()

### Phase 3: UI Integration
1. Add hurricane section to control panel
2. Implement preset dropdown
3. Implement slider controls
4. Add click-to-place interaction

### Phase 4: Polish
1. Add presets to global preset system
2. Fine-tune default parameters
3. Add documentation
4. Performance optimization

---

## 10. References

- [Rankine Vortex Model](https://en.wikipedia.org/wiki/Rankine_vortex)
- [Holland et al. (2010) - Hurricane Wind Profiles](https://journals.ametsoc.org/view/journals/mwre/138/12/2010mwr3317.1.xml)
- [GPU Gems - Fast Fluid Dynamics](https://developer.nvidia.com/gpugems/gpugems/part-vi-beyond-triangles/chapter-38-fast-fluid-dynamics-simulation-gpu)
- [FluidSim Documentation](https://fluidsim.readthedocs.io/)
