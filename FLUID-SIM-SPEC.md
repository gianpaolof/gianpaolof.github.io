# GPU Fluid Simulation Background — Technical Specification

**Version:** 1.0  
**Target:** GitHub Pages  
**Status:** Ready for implementation

---

## Overview

Interactive 2D fluid simulation background using GPU-accelerated Navier-Stokes solver (stable fluids method). The simulation renders vortices and flow patterns as a decorative website background with user-controllable intensity.

### Core Requirements

- Works on desktop and mobile
- Stable 30-60 FPS
- Subtle, non-distracting aesthetic
- Minimal but meaningful interaction
- Zero heavy dependencies
- Progressive fallback for low-end devices

---

## Tech Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Rendering | WebGL2 (WebGL1 fallback) | Wide support, GPU access |
| Language | Vanilla JavaScript | No build required for GH Pages |
| Shaders | GLSL ES 3.0 | WebGL2 standard |
| Canvas | Full-screen `<canvas>` | Background layer |
| Hosting | GitHub Pages | Static hosting |

### Explicitly Excluded

- Three.js — unnecessary overhead for 2D
- WebGPU — insufficient mobile support
- External dependencies — keep it lean

---

## Architecture

```
┌─────────────────┐
│    UI Layer     │  ← Slider, toggle controls
└────────┬────────┘
         │ uniforms
┌────────▼────────┐
│   JS Controller │  ← Timing, quality detection, input handling
└────────┬────────┘
         │ textures / framebuffers
┌────────▼────────┐
│ GPU Fluid Solver│  ← Multi-pass shader pipeline
└────────┬────────┘
         │ final texture
┌────────▼────────┐
│   Render Pass   │  ← Composited background output
└─────────────────┘
```

---

## Simulation Domain

### Grid Configuration

| Device Category | Grid Size | Pressure Iterations |
|-----------------|-----------|---------------------|
| Desktop | 256×256 (max 512) | 20 |
| Mobile | 128×128 | 10 |
| Fallback | 96×96 | 6 |

### Simulated Fields (Textures)

| Field | Type | Purpose |
|-------|------|---------|
| Velocity | `vec2` (RG16F) | Flow direction and magnitude |
| Pressure | `float` (R16F) | Pressure field for projection |
| Divergence | `float` (R16F) | Velocity divergence |
| Dye | `vec3` (RGB8) | Visual output / color transport |

---

## Simulation Pipeline

Execute these passes **in order** each frame:

### Pass 1: Advection (Semi-Lagrangian)

**Input:** `velocity_prev`, `dt`  
**Output:** `velocity_advected`

```glsl
// Core advection logic
vec2 pos_prev = texCoord - dt * texture(u_velocity, texCoord).xy;
vec2 new_velocity = texture(u_velocity, pos_prev).xy;
```

Properties: unconditionally stable, GPU-friendly.

### Pass 2: External Forces

**Input:** `velocity_advected`, mouse/touch data, time  
**Output:** `velocity_forced`

Sources:
- Mouse/touch drag → directional impulse
- Procedural noise (low frequency, Simplex/Perlin)
- Vorticity confinement (curl-based)

**Uniforms:**
- `u_forcePosition` — vec2, normalized coords
- `u_forceDirection` — vec2, drag direction
- `u_forceStrength` — float, [0.0 - 1.0]
- `u_vorticityScale` — float, [0.0 - 0.5]

### Pass 3: Divergence Calculation

**Input:** `velocity_forced`  
**Output:** `divergence`

```glsl
float div = 0.5 * (
    texture(u_velocity, texCoord + vec2(dx, 0)).x -
    texture(u_velocity, texCoord - vec2(dx, 0)).x +
    texture(u_velocity, texCoord + vec2(0, dy)).y -
    texture(u_velocity, texCoord - vec2(0, dy)).y
);
```

### Pass 4: Pressure Solve (Jacobi Iteration)

**Input:** `divergence`, `pressure_prev`  
**Output:** `pressure`

```glsl
// Single Jacobi iteration
float p = (
    texture(u_pressure, texCoord + vec2(dx, 0)).r +
    texture(u_pressure, texCoord - vec2(dx, 0)).r +
    texture(u_pressure, texCoord + vec2(0, dy)).r +
    texture(u_pressure, texCoord - vec2(0, dy)).r -
    texture(u_divergence, texCoord).r
) * 0.25;
```

**Iteration count:** 6-20 depending on device capability.

### Pass 5: Gradient Subtraction (Projection)

**Input:** `velocity_forced`, `pressure`  
**Output:** `velocity_final`

```glsl
vec2 gradient = vec2(
    texture(u_pressure, texCoord + vec2(dx, 0)).r -
    texture(u_pressure, texCoord - vec2(dx, 0)).r,
    texture(u_pressure, texCoord + vec2(0, dy)).r -
    texture(u_pressure, texCoord - vec2(0, dy)).r
) * 0.5;

vec2 velocity = texture(u_velocity, texCoord).xy - gradient;
```

Result: divergence-free (incompressible) velocity field.

### Pass 6: Dye Advection

**Input:** `dye_prev`, `velocity_final`  
**Output:** `dye`

Same semi-Lagrangian method as velocity advection.  
Apply dissipation: `dye *= 0.99` (configurable).

---

## Rendering

### Final Output Pass

Render full-screen quad with dye texture.

```glsl
// render.frag
uniform sampler2D u_dye;
uniform vec3 u_colorA;  // Primary color
uniform vec3 u_colorB;  // Secondary color
uniform float u_alpha;

void main() {
    vec3 dye = texture(u_dye, texCoord).rgb;
    float intensity = length(dye);
    vec3 color = mix(u_colorA, u_colorB, intensity);
    fragColor = vec4(color, intensity * u_alpha);
}
```

### Visual Style

- Dark background (#0a0a0f or similar)
- Limited palette: 1-2 accent colors
- Soft alpha blending
- Subtle, non-distracting motion
- Optional: velocity magnitude → brightness

### Color Palette (Suggested)

```css
--fluid-bg: #0a0a0f;
--fluid-primary: #00d4ff;    /* Cyan */
--fluid-secondary: #7c3aed;  /* Purple */
--fluid-accent: #ff6b35;     /* Orange - for injection points */
```

---

## User Interface

### Slider: "Flow Intensity"

Single control that affects multiple parameters simultaneously:

| Intensity | Viscosity | Force Strength | Vorticity | Advection Speed |
|-----------|-----------|----------------|-----------|-----------------|
| 0.2 (min) | High | Low | Low | Slow |
| 1.0 (default) | Medium | Medium | Medium | Normal |
| 2.0 (max) | Low | High | High | Fast |

**Implementation:** Map slider [0.2 - 2.0] to parameter curves.

### Direct Interaction

- **Mouse drag / Touch:** Inject velocity in drag direction
- **Force magnitude:** Proportional to drag speed
- **Injection radius:** ~5-10% of screen width

---

## Performance Strategy

### Frame Rate Targets

| Platform | Target FPS | Strategy |
|----------|------------|----------|
| Desktop | 60 | Full quality |
| Mobile | 30 | Reduced iterations, smaller grid |
| Low-end | 30 | Minimum grid, fewer iterations |

### Quality Detection

```javascript
function detectQuality() {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    
    if (!gl) return 'fallback';
    
    const isMobile = /Android|iPhone|iPad/i.test(navigator.userAgent);
    const hasFloatTextures = gl.getExtension('EXT_color_buffer_float');
    
    if (!hasFloatTextures) return 'fallback';
    if (isMobile) return 'mobile';
    return 'desktop';
}
```

### Power Management

```javascript
// Pause when tab hidden
document.addEventListener('visibilitychange', () => {
    if (document.hidden) simulation.pause();
    else simulation.resume();
});

// Respect reduced motion preference
if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    simulation.setStaticMode();
}
```

---

## Fallback Strategy

| Condition | Action |
|-----------|--------|
| No WebGL2 | Try WebGL1 with reduced features |
| No float textures | Use LDR approximation (RGB8) |
| GPU too slow (< 20 FPS) | Switch to static gradient |
| `prefers-reduced-motion` | Static background, no animation |
| WebGL context lost | Display static fallback image |

---

## File Structure

```
fluid-sim/
├── index.html
├── style.css
├── js/
│   ├── main.js              # Entry point, initialization
│   ├── fluid-solver.js      # Core simulation logic
│   ├── gl-utils.js          # WebGL helpers (programs, textures, FBOs)
│   ├── input.js             # Mouse/touch handling
│   └── ui.js                # Slider and controls
├── shaders/
│   ├── quad.vert            # Fullscreen quad vertex shader
│   ├── advect.frag          # Semi-Lagrangian advection
│   ├── forces.frag          # External force injection
│   ├── divergence.frag      # Divergence calculation
│   ├── pressure.frag        # Jacobi pressure iteration
│   ├── gradient.frag        # Gradient subtraction
│   └── render.frag          # Final visualization
└── README.md
```

---

## Implementation Tasks

### Phase 1: WebGL Foundation

1. **Task 1.1:** Create `index.html` with full-screen canvas and basic structure
2. **Task 1.2:** Implement `gl-utils.js` — program compilation, texture creation, FBO setup
3. **Task 1.3:** Implement `quad.vert` — fullscreen quad vertex shader
4. **Task 1.4:** Test WebGL2 context creation and fallback detection

### Phase 2: Core Simulation

5. **Task 2.1:** Implement `advect.frag` — semi-Lagrangian advection
6. **Task 2.2:** Implement `divergence.frag` — divergence calculation
7. **Task 2.3:** Implement `pressure.frag` — Jacobi iteration
8. **Task 2.4:** Implement `gradient.frag` — pressure gradient subtraction
9. **Task 2.5:** Implement `fluid-solver.js` — orchestrate simulation passes

### Phase 3: Interaction

10. **Task 3.1:** Implement `input.js` — mouse/touch event handling
11. **Task 3.2:** Implement `forces.frag` — force injection shader
12. **Task 3.3:** Add procedural noise for ambient motion

### Phase 4: Visualization

13. **Task 4.1:** Implement `render.frag` — dye visualization with color mapping
14. **Task 4.2:** Implement dye advection and dissipation
15. **Task 4.3:** Style CSS for dark background, canvas positioning

### Phase 5: UI & Controls

16. **Task 5.1:** Implement `ui.js` — slider control
17. **Task 5.2:** Map intensity slider to simulation parameters
18. **Task 5.3:** Add pause/resume on visibility change

### Phase 6: Polish & Optimization

19. **Task 6.1:** Implement quality detection and adaptive settings
20. **Task 6.2:** Add fallback modes
21. **Task 6.3:** Performance testing and tuning
22. **Task 6.4:** Write README with usage instructions

---

## Testing Checklist

| Device | Browser | Target FPS | Status |
|--------|---------|------------|--------|
| Desktop | Chrome | 60 | ⬜ |
| Desktop | Firefox | 60 | ⬜ |
| Desktop | Safari | 45-60 | ⬜ |
| MacBook | Safari | 45-60 | ⬜ |
| iPhone | Safari | 30 | ⬜ |
| Android (mid-range) | Chrome | 30 | ⬜ |

### Performance Metrics

- [ ] Consistent frame rate (no stuttering)
- [ ] No memory leaks over 5+ minutes
- [ ] Graceful degradation on low-end devices
- [ ] Proper pause when tab hidden
- [ ] Respects `prefers-reduced-motion`

---

## References

- Jos Stam — *Stable Fluids* (SIGGRAPH 1999)
- GPU Gems Chapter 38 — Fast Fluid Dynamics Simulation
- Inigo Quilez — Shader patterns and noise functions
- WebGL2 Fundamentals — https://webgl2fundamentals.org

---

## Future Enhancements (Post-v1)

- WebGPU implementation for higher resolution
- Audio-reactive flow (microphone input)
- 3D slice visualization (fake depth)
- Particle system overlay

---

## Notes for Implementation

1. **Start with a proof-of-concept:** Get advection + rendering working first before adding pressure solve.

2. **Double-buffer all textures:** Each field needs read/write textures that swap each frame.

3. **Boundary conditions:** Use `clamp` texture wrapping or explicit boundary handling in shaders.

4. **Floating point precision:** Use `highp` precision in fragment shaders for mobile compatibility.

5. **Debug tips:** 
   - Visualize intermediate buffers (velocity, pressure, divergence)
   - Add FPS counter during development
   - Test on real mobile devices, not just emulators
