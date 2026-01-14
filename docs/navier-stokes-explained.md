# Navier-Stokes Fluid Simulation: Step-by-Step Guide

A detailed walkthrough of how the WebGL fluid simulation solves the Navier-Stokes equations.

## Table of Contents

1. [Initial Setup: The Textures](#step-0-initial-setup-the-textures)
2. [Why Different Resolutions?](#why-different-resolutions)
3. [Adding Initial Splats](#step-1-adding-initial-splats)
4. [Curl Calculation](#step-2-curl-calculation)
5. [Vorticity Confinement](#step-3-vorticity-confinement)
6. [GLSL Shaders](#glsl-shaders)
7. [Divergence](#step-4-divergence)
8. [Pressure Solve (Jacobi Iteration)](#step-5-pressure-solve-jacobi-iteration)
9. [Mathematical Derivation](#mathematical-derivation-of-jacobi-formula)
10. [Gradient Subtraction](#step-6-gradient-subtraction)
11. [Advection (Semi-Lagrangian)](#step-7-advection-semi-lagrangian)
12. [Rendering](#step-8-rendering)
13. [Performance: How Many Calculations?](#performance-how-many-calculations)
14. [Double Buffering: Parallelization Secret](#double-buffering-parallelization-secret)

---

## Step 0: Initial Setup - The Textures

When the page loads, empty **textures** are created on the GPU (the FBOs - Framebuffer Objects):

| Texture | Size | Contents |
|---------|------|----------|
| **velocity** | 128×128 | Fluid velocity (vx, vy) for each cell |
| **pressure** | 128×128 | Pressure at each cell |
| **dye** | 1024×1024 | Visible color (RGB) on screen |

Think of them as **grids of numbers**:

```
velocity (128×128):          dye (1024×1024):
┌───┬───┬───┬───┐            ┌───┬───┬───┬───┐
│0,0│0,0│0,0│...│            │000│000│000│...│  (black)
├───┼───┼───┼───┤            ├───┼───┼───┼───┤
│0,0│0,0│0,0│...│            │000│000│000│...│
└───┴───┴───┴───┘            └───┴───┴───┴───┘
  ↑                            ↑
  (vx, vy) = direction         (r,g,b) = color
```

Initially all values are **zero** (no movement, all black).

---

## Why Different Resolutions?

The screen might be **1920×1080** pixels, but the internal textures are smaller.

### Why is velocity only 128×128?

The **fluid physics** (velocity, pressure) doesn't need fine detail.

Think of air in a room:
- You don't need to know the velocity every millimeter
- A coarse grid is enough to understand where the wind goes

128×128 = **16,384 simulation cells**. Enough for realistic physics, but light on the GPU.

### Why is dye 1024×1024?

The **color** is what you **see**. It needs to be detailed, otherwise it looks pixelated.

1024×1024 = **1 million color pixels**. Much more defined.

### Visual Schema

```
Actual screen: 1920×1080
         ↑
         │ (scale/interpolate)
         │
    dye: 1024×1024  ← detailed colors
         ↑
         │ (follows velocity)
         │
velocity: 128×128   ← coarse physics
```

The color (dye) **follows** the velocity, but at higher resolution.

---

## Step 1: Adding Initial Splats

When the simulation starts, 5-25 random "splats" are created.

Each splat has 3 properties:
- **Position**: where it appears (e.g., screen center)
- **Velocity**: direction of movement
- **Color**: what color it has

### What happens to the velocity grid?

Imagine a splat at center with velocity pointing right:

```
Before (all zeros):         After the splat:

┌───┬───┬───┬───┬───┐      ┌───┬───┬───┬───┬───┐
│ 0 │ 0 │ 0 │ 0 │ 0 │      │ 0 │ 0 │ 0 │ 0 │ 0 │
├───┼───┼───┼───┼───┤      ├───┼───┼───┼───┼───┤
│ 0 │ 0 │ 0 │ 0 │ 0 │      │ 0 │0.2│0.5│0.2│ 0 │
├───┼───┼───┼───┼───┤      ├───┼───┼───┼───┼───┤
│ 0 │ 0 │ 0 │ 0 │ 0 │  →   │ 0 │0.5│→1→│0.5│ 0 │  ← velocity pointing right!
├───┼───┼───┼───┼───┤      ├───┼───┼───┼───┼───┤
│ 0 │ 0 │ 0 │ 0 │ 0 │      │ 0 │0.2│0.5│0.2│ 0 │
├───┼───┼───┼───┼───┤      ├───┼───┼───┼───┼───┤
│ 0 │ 0 │ 0 │ 0 │ 0 │      │ 0 │ 0 │ 0 │ 0 │ 0 │
└───┴───┴───┴───┴───┘      └───┴───┴───┴───┴───┘
```

It's a **Gaussian**: strong at center, fading at edges.

The same happens for **dye** (color), but on the 1024×1024 grid.

---

## Step 2: Curl Calculation

The animation loop calls `solver.step(dt)`, which executes **7 operations** in sequence:

```
1. Curl         ← compute rotation
2. Vorticity    ← amplify vortices
3. Divergence   ← measure accumulation
4. Pressure     ← solve pressure
5. Gradient     ← correct velocity
6. Advect Velocity  ← move velocity
7. Advect Dye       ← move colors
```

### What is Curl?

**Curl** measures how much the fluid is "rotating" at each point.

Imagine water in a sink:

```
No rotation:             Rotation (vortex):

    ↓ ↓ ↓                    ←
    ↓ ↓ ↓                 ↓  ●  ↑
    ↓ ↓ ↓                    →

  curl = 0                curl = high!
```

### Curl Calculation Example

Let's take a 3×3 grid and calculate the curl of the **center** cell.

**Starting data** - each cell has velocity (vx, vy):

```
┌─────────┬─────────┬─────────┐
│         │ vx=-1 ← │         │   ← top goes left
├─────────┼─────────┼─────────┤
│ vy=-1 ↓ │ center  │ vy=+1 ↑ │   ← left goes down, right goes up
├─────────┼─────────┼─────────┤
│         │ vx=+1 → │         │   ← bottom goes right
└─────────┴─────────┴─────────┘
```

This is a **counter-clockwise vortex**:

```
    ←
 ↓  ●  ↑
    →
```

Following the flow: right→up→left→down→right... it rotates **counter-clockwise**!

### The Curl Formula (2D)

```
curl = (vy_right - vy_left)/2 - (vx_top - vx_bottom)/2
```

### Calculation

From the grid:
- vy_right = +1
- vy_left = -1
- vx_top = -1
- vx_bottom = +1

```
curl = (+1 - (-1))/2 - ((-1) - (+1))/2
     = (2)/2 - (-2)/2
     = 1 + 1
     = 2
```

**curl = +2** → positive counter-clockwise rotation!

If it were clockwise, curl would be **negative**.

---

## Step 3: Vorticity Confinement

We've calculated the curl (rotation) for each cell.

**Problem**: numerical simulation tends to "dampen" vortices. They become weak and disappear.

**Solution**: artificially amplify the rotation!

### How it works

1. Look where curl is **high** (strong vortex)
2. Add a small force that **pushes in the rotation direction**

It's like giving vortices a "nudge" to keep them alive.

### Visual

```
Without vorticity:        With vorticity:

    ←                         ←←
 ↓  ●  ↑      →           ↓↓  ●  ↑↑
    →                         →→

 (weak vortex)             (amplified vortex!)
```

### The "Curl" Parameter in Controls

Remember the **Vorticity (30)** slider in the panel?

- High value → stronger, longer-lasting vortices
- Low value → vortices dissipate quickly

---

## GLSL Shaders

The calculations are done in `.frag` files in the `gl/` folder.

### The Language: GLSL

**GLSL** = OpenGL Shading Language

A C-like language that runs on the **GPU**.

### Example: curl.frag

```glsl
#version 300 es                    // GLSL version (WebGL2)
precision highp float;             // Use precise decimals

uniform sampler2D u_velocity;      // The 128×128 texture with velocities
uniform vec2 u_texelSize;          // Size of one cell (1/128, 1/128)

in vec2 v_texCoord;                // Position of THIS pixel (0.0 - 1.0)
out float fragColor;               // Output: single number (the curl)

void main() {
    float L = texture(u_velocity, v_texCoord - vec2(u_texelSize.x, 0.0)).y;  // vy LEFT
    float R = texture(u_velocity, v_texCoord + vec2(u_texelSize.x, 0.0)).y;  // vy RIGHT
    float T = texture(u_velocity, v_texCoord + vec2(0.0, u_texelSize.y)).x;  // vx TOP
    float B = texture(u_velocity, v_texCoord - vec2(0.0, u_texelSize.y)).x;  // vx BOTTOM

    float vorticity = R - L - T + B;   // The curl formula!
    fragColor = 0.5 * vorticity;       // Save the result
}
```

### The Magic

This code executes **128×128 = 16,384 times in parallel** on the GPU!

Each pixel calculates its own curl simultaneously.

---

## Step 4: Divergence

Before calculating pressure, we need to know **where fluid accumulates**.

### What is Divergence?

It measures whether at a point the fluid:
- **Enters** more than it exits (negative divergence) → accumulates
- **Exits** more than it enters (positive divergence) → empties

### Visual Example

```
Divergence = 0              Divergence > 0            Divergence < 0
(equilibrium)               (emptying)                (accumulating)

    ↓                           ↑                          ↓
 →  ●  ←                     ←  ●  →                    →  ●  ←
    ↑                           ↓                          ↑

Enters = Exits              Everything exits!         Everything enters!
```

### The Problem

An **incompressible** fluid (like water) cannot accumulate.

Divergence must be **zero everywhere**.

But after splats and movements, we might have points where divergence ≠ 0.

### The Solution?

We use **pressure** to "push away" excess fluid.

---

## Step 5: Pressure Solve (Jacobi Iteration)

We need to find a pressure that **eliminates divergence**.

### The Equation to Solve

```
∇²p = divergence
```

Translation: "find a pressure p such that its second derivatives equal the divergence".

### The Problem

This equation connects **all cells together**. Pressure at one point depends on neighbors, which depend on their neighbors, etc.

It cannot be solved directly.

### The Solution: Jacobi Iteration

We solve **approximately**, repeating many times.

**Simple formula:**

```
p_new = (p_left + p_right + p_top + p_bottom - divergence) / 4
```

### Numerical Example

**Initial Setup:**

A 3×3 grid. At center there's divergence (fluid accumulating).

**Divergence:**
```
┌─────┬─────┬─────┐
│  0  │  0  │  0  │
├─────┼─────┼─────┤
│  0  │ -4  │  0  │   ← divergence -4 at center (accumulating!)
├─────┼─────┼─────┤
│  0  │  0  │  0  │
└─────┴─────┴─────┘
```

**Pressure (start = all zeros):**
```
┌─────┬─────┬─────┐
│  0  │  0  │  0  │
├─────┼─────┼─────┤
│  0  │  0  │  0  │
├─────┼─────┼─────┤
│  0  │  0  │  0  │
└─────┴─────┴─────┘
```

### Iteration 1

Calculate **new pressure** for center cell:

```
p_new = (p_left + p_right + p_top + p_bottom - divergence) / 4
      = (0 + 0 + 0 + 0 - (-4)) / 4
      = (0 + 4) / 4
      = 1
```

**Pressure after iteration 1:**
```
┌─────┬─────┬─────┐
│  0  │  0  │  0  │
├─────┼─────┼─────┤
│  0  │  1  │  0  │   ← center is now 1
├─────┼─────┼─────┤
│  0  │  0  │  0  │
└─────┴─────┴─────┘
```

### Iteration 2

Now neighboring cells see that center has pressure 1.

Calculate for cell **above center** (divergence there = 0):

```
p_new = (0 + 0 + 0 + 1 - 0) / 4 = 0.25
```

**Pressure after iteration 2:**
```
┌─────┬──────┬─────┐
│  0  │ 0.25 │  0  │
├─────┼──────┼─────┤
│0.25 │  1   │0.25 │   ← pressure "spreads"
├─────┼──────┼─────┤
│  0  │ 0.25 │  0  │
└─────┴──────┴─────┘
```

### Iterations 3, 4, 5...

Pressure continues to spread and balance:

```
Iteration 5:             Iteration 20:
┌─────┬─────┬─────┐     ┌─────┬─────┬─────┐
│0.15 │0.40 │0.15 │     │0.5  │0.75 │0.5  │
├─────┼─────┼─────┤     ├─────┼─────┼─────┤
│0.40 │0.85 │0.40 │     │0.75 │ 1   │0.75 │
├─────┼─────┼─────┤     ├─────┼─────┼─────┤
│0.15 │0.40 │0.15 │     │0.5  │0.75 │0.5  │
└─────┴─────┴─────┘     └─────┴─────┴─────┘
```

### The Result

At the end we have a pressure "hill" centered where the accumulation was.

This pressure will push fluid **away from center**, eliminating the accumulation!

### Why 20 Iterations?

- Too few → wrong pressure → fluid "explodes"
- Too many → GPU waste
- 20 → good compromise

---

## Mathematical Derivation of Jacobi Formula

### Starting from the Equation

We need to solve:

```
∇²p = divergence
```

**∇²** (Laplacian) = "second derivative" in 2D.

### What is a Second Derivative?

**First derivative** = how much the value changes between neighboring cells

```
∂p/∂x ≈ (p_right - p_center) / distance
```

**Second derivative** = how much the first derivative changes

```
∂²p/∂x² ≈ (p_right - 2·p_center + p_left) / distance²
```

### In 2D (Laplacian)

Sum the second derivative in X and Y:

```
∇²p = ∂²p/∂x² + ∂²p/∂y²
```

Expanding:

```
∇²p = (p_right - 2·p_center + p_left) + (p_top - 2·p_center + p_bottom)
    = p_right + p_left + p_top + p_bottom - 4·p_center
```

(assuming distance = 1)

### Now Solve for p_center

The equation is:

```
p_right + p_left + p_top + p_bottom - 4·p_center = divergence
```

Isolate p_center:

```
-4·p_center = divergence - p_right - p_left - p_top - p_bottom

p_center = (p_right + p_left + p_top + p_bottom - divergence) / 4
```

### There's the Formula!

```
p_new = (p_left + p_right + p_top + p_bottom - divergence) / 4
```

It's not an invented approximation. It's the **exact solution** of the equation, discretized on a grid.

### Why Iterate?

Because to calculate `p_center` we need neighbors, but neighbors also depend on their neighbors...

By iterating, all values converge together toward the solution.

---

## Step 6: Gradient Subtraction

We've calculated the pressure. Now we need to **use it** to correct the velocity.

### The Concept

Pressure is high where fluid accumulates.

The **gradient** of pressure points in the direction where pressure increases most.

```
Pressure:                  Gradient (arrows):

┌─────┬─────┬─────┐
│ 0.5 │ 0.75│ 0.5 │           ↘   ↓   ↙
├─────┼─────┼─────┤
│ 0.75│  1  │ 0.75│        →   ●   ←      (points TOWARD center)
├─────┼─────┼─────┤
│ 0.5 │ 0.75│ 0.5 │           ↗   ↑   ↖
└─────┴─────┴─────┘
```

### What Do We Do?

**Subtract** the gradient from velocity:

```
new_velocity = old_velocity - pressure_gradient
```

### Why Subtract?

The gradient points **toward** the accumulation.

By subtracting it, we push fluid **away** from the accumulation.

```
Before (accumulation at center):    After (fluid pushed away):

    →  →  →                             →  →  →
    →  ●  →          →                  ↗  ●  ↖
    →  →  →                             ↑  ↑  ↑

  (all going right)                  (opens from center)
```

### The Result

After this step, velocity is **divergence-free**.

Fluid no longer accumulates anywhere!

---

## Step 7: Advection (Semi-Lagrangian)

Now we have a corrected velocity. It's time to **move everything**.

### What Needs to Move?

Two things:
1. **Velocity** itself (wind drags more wind)
2. **Dye** (colors follow the fluid)

### The Problem: Why "Push Forward" Explodes

The obvious method: push each particle forward.

```
Particle at (3,3) with velocity →

Frame 1:  ●  at (3,3)
Frame 2:  ●  at (4,3)   moving right
```

Seems fine, but there's a fatal flaw.

#### Example: Overlapping Destinations

Imagine a 1D grid with values:

```
Values:     [ 0 ][ 5 ][ 10 ][ 0 ][ 0 ]
Velocity:         →2    →1   (different speeds)
```

Both cells want to go to cell 4:

```
5 moves by 2  → goes to cell 4
10 moves by 1 → goes to cell 4
```

**Result**: 5 + 10 = 15 in the same cell!

```
After:      [ 0 ][ 0 ][ 0 ][ 0 ][ 15 ]   ← value INCREASED!
```

#### After Many Frames: EXPLOSION

```
Frame 1:   max = 10
Frame 2:   max = 15
Frame 3:   max = 25
Frame 4:   max = 50
...
Frame 20:  max = 999999  💥
```

Values grow without control! The simulation "explodes".

### The Solution: Semi-Lagrangian (look backward)

Instead of pushing forward, we **look back in time**.

For each cell, we ask:
> "Where did the fluid that's now here come from?"

```
To calculate value at (4,3):

1. I'm at (4,3)
2. Velocity here points right (→)
3. So fluid came from LEFT
4. Look back: (4,3) - velocity = (3,3)
5. Copy value from (3,3)
```

### Visual

```
Classic method (unstable):       Semi-Lagrangian (stable):

"where do you GO?"               "where do you COME FROM?"

    ●  →  ?                          ?  ←  ●

Push forward                     Look backward
```

### Numerical Example

Grid of colors with fluid moving right:

```
Before:                     After advection:

┌───┬───┬───┬───┐          ┌───┬───┬───┬───┐
│ R │ G │ B │ 0 │    →     │ 0 │ R │ G │ B │
└───┴───┴───┴───┘          └───┴───┴───┴───┘

Velocity: all → (right)
```

For each cell, we look where the color came from and copy it.

### Why Is It Stable?

We never create new values. We always copy from existing values.

#### Example: Same Grid, Semi-Lagrangian

```
Values:     [ 0 ][ 5 ][ 10 ][ 0 ][ 0 ]
Velocity:              →1
```

To calculate cell 3 (which had 10):

```
1. I'm at cell 3
2. Velocity here = 1 (right)
3. So fluid came from left: cell 3 - 1 = cell 2
4. Copy value from cell 2: 5
```

To calculate cell 4 (which had 0):

```
1. I'm at cell 4
2. Velocity here = 1 (right)
3. So fluid came from left: cell 4 - 1 = cell 3
4. Copy value from cell 3: 10
```

**Result**:

```
After:      [ 0 ][ 0 ][ 5 ][ 10 ][ 0 ]
```

The maximum was 10, and it's **still** 10. No explosion!

#### The Key Insight

| Method | What happens | Stability |
|--------|--------------|-----------|
| **Push forward** | Multiple sources → same destination | Values accumulate → 💥 |
| **Semi-Lagrangian** | Each destination ← one source | Values bounded → ✓ |

Even with very high velocities, the result is always "sensible".

---

## Step 8: Rendering

Advect Dye **moves** the colors, but doesn't display them yet.

### Advect Dye

Moves colors following velocity:

```
Dye before:             Dye after advect:
┌───┬───┬───┐          ┌───┬───┬───┐
│ R │ 0 │ 0 │    →     │ 0 │ R │ 0 │   (red moved)
└───┴───┴───┘          └───┴───┴───┘
```

But it's still a **texture in GPU memory**. Not visible.

### The Real Rendering: `solver.render()`

After `step()`, there's `render()`:

```javascript
// main.js
solver.step(dt);    // Physics (7 steps)
solver.render();    // ← THIS draws to screen!
```

### What Does render() Do?

1. Takes the **dye** texture (1024×1024)
2. Applies **shading** (3D oily effect)
3. Applies **bloom** (glow)
4. Applies **sunrays** (light rays)
5. Draws to **canvas** (finally visible!)

### Complete Schema

```
step() ─────────────────────────────────────────┐
│                                               │
│  curl → vorticity → divergence → pressure     │
│  → gradient → advect velocity → advect dye    │
│                                               │
└───────────────────────────────────────────────┘
                      ↓
               (dye in memory)
                      ↓
render() ───────────────────────────────────────┐
│                                               │
│  dye → shading → bloom → sunrays → canvas     │
│                                               │
└───────────────────────────────────────────────┘
                      ↓
              YOU SEE IT! 👁️
```

---

## Performance: How Many Calculations?

### Summary: From Frame 0 to Frame 1

| Step | Operation | Grid | Calculations |
|------|-----------|------|--------------|
| 1 | Curl | 128×128 | 16,384 |
| 2 | Vorticity | 128×128 | 16,384 |
| 3 | Divergence | 128×128 | 16,384 |
| 4 | Pressure | 128×128 × **20 iterations** | 327,680 |
| 5 | Gradient | 128×128 | 16,384 |
| 6 | Advect Velocity | 128×128 | 16,384 |
| 7 | Advect Dye | 1024×1024 | 1,048,576 |

### Total for 1 Frame

```
16,384 × 6  =     98,304   (steps 1-3, 5-6)
16,384 × 20 =    327,680   (pressure)
1,048,576   =  1,048,576   (dye advection)
            ─────────────
TOTAL       ≈  1,474,560   calculations per frame
```

### At 60 FPS

```
1,474,560 × 60 = 88,473,600 calculations per second
```

Almost **90 million** calculations per second!

### Why Doesn't the Computer Explode?

The **GPU** does them all **in parallel**.

A modern GPU has thousands of "cores". Each core handles one pixel.

```
CPU:   pixel1 → pixel2 → pixel3 → ...  (one at a time)

GPU:   pixel1 ↘
       pixel2 → all together! → done
       pixel3 ↗
       ...
```

The 16,384 curl calculations? The GPU does them in **one shot**.

---

## Double Buffering: Parallelization Secret

### The Problem

If all pixels depend on their neighbors, how do we parallelize?

If pixel 1 depends on pixel 2, which do we calculate first?

### The Trick: Double Buffering

We use **two copies** of the texture:
- **Texture A**: OLD values (read only)
- **Texture B**: NEW values (write only)

### How It Works

```
Texture A (OLD):             Texture B (NEW):
┌───┬───┬───┐                ┌───┬───┬───┐
│ 1 │ 2 │ 3 │                │ ? │ ? │ ? │
├───┼───┼───┤    READ →      ├───┼───┼───┤
│ 4 │ 5 │ 6 │    WRITE →     │ ? │ ? │ ? │
├───┼───┼───┤                ├───┼───┼───┤
│ 7 │ 8 │ 9 │                │ ? │ ? │ ? │
└───┴───┴───┘                └───┴───┴───┘
   (frozen)                   (being written)
```

All pixels:
1. **Read** from A (which never changes during calculation)
2. **Write** to B

### Example: Center Pixel

The center pixel needs to calculate the average of neighbors.

```
Reads from A: (2 + 4 + 6 + 8) / 4 = 5
Writes to B: 5
```

**Simultaneously**, the top pixel:

```
Reads from A: (1 + 3 + 5) / 3 = 3
Writes to B: 3
```

No conflict! Everyone reads from the **same frozen snapshot**.

### After Calculation: SWAP

```
A becomes the new (for next calculation)
B becomes the old

A ↔ B
```

### In the Code

Remember the `DoubleFBO` in `fluid-solver.js`?

```javascript
this._fbos.velocity = new DoubleFBO(...)
this._fbos.pressure = new DoubleFBO(...)
this._fbos.dye = new DoubleFBO(...)
```

Each field has **two textures** exactly for this reason!

### For Jacobi (20 Iterations)

Each iteration:
1. Read from A
2. Write to B
3. **Swap** A ↔ B
4. Repeat

After 20 swaps, pressure has converged.

---

## Complete Frame Summary

This is what happens 60 times per second:

```
┌─────────────────────────────────────────────────────────────┐
│                        FRAME N                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. Read user input (mouse/touch)                          │
│                                                             │
│  2. solver.step(dt):                                        │
│     ├── Curl (compute rotation)                            │
│     ├── Vorticity (amplify swirls)                         │
│     ├── Divergence (measure accumulation)                  │
│     ├── Pressure (20× Jacobi iterations)                   │
│     ├── Gradient (correct velocity)                        │
│     ├── Advect Velocity (move velocity field)              │
│     └── Advect Dye (move colors)                           │
│                                                             │
│  3. solver.render():                                        │
│     ├── Apply shading                                       │
│     ├── Apply bloom                                         │
│     ├── Apply sunrays                                       │
│     └── Draw to canvas                                      │
│                                                             │
│  4. requestAnimationFrame() → FRAME N+1                    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

And the cycle continues, creating the beautiful fluid animation you see!
