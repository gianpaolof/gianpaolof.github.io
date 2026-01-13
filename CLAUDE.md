# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

GPU-accelerated 2D fluid simulation using WebGL2 Navier-Stokes solver (stable fluids method by Jos Stam). Renders as an interactive background for GitHub Pages with stunning visual effects.

**Key Documents:**
- `FLUID-SIM-SPEC.md` - Complete technical specification
- `TASK-LIST.md` - Ultra-detailed implementation task list with dependencies

## Development

Static web application, no build step required.

```bash
# Serve locally
cd fluid
python -m http.server 8000
# or
npx serve .
```

Open `http://localhost:8000` in browser.

## Architecture

### Simulation Pipeline (executed each frame)
1. **Advect** - Semi-Lagrangian velocity self-advection
2. **Forces** - Mouse/touch injection + procedural noise
3. **Divergence** - Compute velocity field divergence
4. **Pressure** - Jacobi iteration solver (6-40 iterations)
5. **Gradient** - Subtract pressure gradient for incompressibility
6. **Dye Advect** - Transport visual dye field
7. **Render** - Color mapping, bloom, vorticity visualization

### Directory Structure
```
fluid/
├── index.html          # Entry point with canvas and controls
├── style.css           # Glassmorphism UI, dark theme
├── js/
│   ├── main.js         # Initialization and render loop
│   ├── fluid-solver.js # Pipeline orchestration, FBO management
│   ├── gl-utils.js     # WebGL context, shaders, textures
│   ├── input.js        # Mouse/touch event handling
│   └── ui.js           # Slider, visibility, reduced motion
└── gl/
    ├── quad.vert       # Fullscreen quad (attribute-less)
    ├── advect.frag     # Semi-Lagrangian advection
    ├── forces.frag     # Gaussian force splat + noise
    ├── divergence.frag # Central difference divergence
    ├── pressure.frag   # Jacobi iteration
    ├── gradient.frag   # Pressure gradient subtraction
    └── render.frag     # Color mapping, bloom, vorticity
```

## Technical Specifications

### Texture Formats
| Field | Format | Bytes/texel | Notes |
|-------|--------|-------------|-------|
| Velocity | RG16F | 4 | 50% bandwidth vs RG32F |
| Pressure | R16F | 2 | mediump precision OK |
| Divergence | R16F | 2 | Single-pass |
| Dye | RGBA8 | 4 | Sufficient for visualization |

### Quality Tiers
| Tier | Grid | Iterations | Target FPS |
|------|------|------------|------------|
| Desktop | 256-512 | 20-40 | 60 |
| Mobile | 128 | 10-15 | 30 |
| Fallback | 96 | 6 | 30 |

### Color Palette (Aurora Borealis)
```
Background: #050510  (deep void)
Primary:    #00FF87  (electric mint - high velocity)
Secondary:  #7C3AED  (electric violet - low velocity)
Accent:     #00D4FF  (cyan - vortex cores)
Highlight:  #FF6B9D  (aurora pink - touch injection)
```

## Key Implementation Notes

1. **Ping-pong FBOs**: All fields use double-buffered textures. Swap after each write.

2. **Timestep capping**: `dt = Math.min(dt, 0.033)` prevents explosion on tab resume.

3. **textureOffset**: Use for divergence/pressure/gradient shaders (better cache).

4. **WebGL2 VAO**: Required even for attribute-less rendering.

5. **Precision**: Use `highp` for coordinates/advection, `mediump` OK for pressure iterations.

6. **Accessibility**: Respect `prefers-reduced-motion` - display static gradient.

## References

- Jos Stam - *Stable Fluids* (SIGGRAPH 1999)
- GPU Gems Chapter 38 - Fast Fluid Dynamics
- WebGL2 Fundamentals - https://webgl2fundamentals.org
