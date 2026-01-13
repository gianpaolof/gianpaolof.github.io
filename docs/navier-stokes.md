# Equazioni di Navier-Stokes

## Introduzione

Le equazioni di Navier-Stokes descrivono il moto dei fluidi viscosi. Per questa simulazione, usiamo la versione **incomprimibile** in 2D.

## Equazioni Fondamentali

### Equazione del Momento (Momentum)

```
∂u/∂t + (u · ∇)u = -∇p/ρ + ν∇²u + f
```

Dove:
- `u` = campo di velocità (vettore 2D)
- `p` = pressione
- `ρ` = densità (costante per fluidi incomprimibili)
- `ν` = viscosità cinematica
- `f` = forze esterne

### Condizione di Incomprimibilità

```
∇ · u = 0
```

Il fluido non può essere compresso o espanso. La divergenza della velocità è sempre zero.

## Implementazione Numerica

### 1. Splitting (Operator Splitting)

Risolviamo l'equazione separando i termini:

```
u* = u + Δt · f                     (forze esterne)
u** = advect(u*, u*)                (advection)
u*** = u** + Δt · ν∇²u**            (diffusione, trascurata)
u**** = project(u***)               (proiezione incomprimibile)
```

### 2. Advection Semi-Lagrangiana

Invece di risolvere `∂u/∂t + (u · ∇)u = 0` direttamente, usiamo backtracing:

```glsl
// Per ogni pixel a posizione x:
vec2 prevPos = x - dt * velocity(x);  // Torna indietro nel tempo
u_new(x) = sample(u_old, prevPos);    // Campiona dalla posizione precedente
```

**Vantaggi:**
- Incondizionatamente stabile (anche con grandi timestep)
- Nessuna condizione CFL da rispettare

**Codice shader** (`advect.frag`):
```glsl
vec2 velocity = texture(u_velocity, v_texCoord).xy;
vec2 coord = v_texCoord - u_dt * velocity * u_texelSize;
vec4 result = bilerp(u_source, coord, u_sourceTexelSize);
```

### 3. Proiezione di Pressione

Per garantire `∇ · u = 0`, risolviamo:

```
∇²p = ∇ · u      (equazione di Poisson)
u_new = u - ∇p   (sottrazione del gradiente)
```

#### 3.1 Calcolo Divergenza

```glsl
// divergence.frag
float L = textureOffset(u_velocity, v_texCoord, ivec2(-1, 0)).x;
float R = textureOffset(u_velocity, v_texCoord, ivec2( 1, 0)).x;
float B = textureOffset(u_velocity, v_texCoord, ivec2( 0,-1)).y;
float T = textureOffset(u_velocity, v_texCoord, ivec2( 0, 1)).y;
float divergence = 0.5 * (R - L + T - B);
```

#### 3.2 Solver Jacobi per Pressione

Risolviamo iterativamente `∇²p = div`:

```glsl
// pressure.frag
float pL = textureOffset(u_pressure, v_texCoord, ivec2(-1, 0)).x;
float pR = textureOffset(u_pressure, v_texCoord, ivec2( 1, 0)).x;
float pB = textureOffset(u_pressure, v_texCoord, ivec2( 0,-1)).x;
float pT = textureOffset(u_pressure, v_texCoord, ivec2( 0, 1)).x;
float div = texture(u_divergence, v_texCoord).x;
float pressure = (pL + pR + pB + pT - div) * 0.25;
```

**20 iterazioni** sono sufficienti per convergenza.

#### 3.3 Sottrazione Gradiente

```glsl
// gradient.frag
vec2 gradient = vec2(pR - pL, pT - pB);
velocity -= gradient;  // Formula di Pavel (senza 0.5)
```

### 4. Vorticity Confinement

La dissipazione numerica tende a smorzare i vortici. Per compensare:

```
ω = ∇ × u           (calcola curl/vorticità)
N = ∇|ω| / |∇|ω||   (normalizza gradiente del curl)
f_vort = ε(N × ω)   (forza perpendicolare)
```

**Codice shader** (`vorticity.frag`):
```glsl
vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
force /= length(force) + 0.0001;
force *= u_curlStrength * C;
force.y *= -1.0;
velocity += force * u_dt;
```

### 5. Dissipazione

Per simulare la viscosità senza diffusione esplicita:

```glsl
// Dopo l'advection
float decay = 1.0 + u_dissipation * u_dt;
fragColor = result / decay;
```

## Condizioni al Bordo

### Free-Slip (No Penetration)

Al bordo del dominio, la velocità normale viene invertita:

```glsl
if (coordL.x < 0.0) { L = -C.x; }  // Bordo sinistro
if (coordR.x > 1.0) { R = -C.x; }  // Bordo destro
if (coordT.y > 1.0) { T = -C.y; }  // Bordo superiore
if (coordB.y < 0.0) { B = -C.y; }  // Bordo inferiore
```

## Stabilità Numerica

### Schema Semi-Lagrangiano

- **Pro:** Stabile per qualsiasi `dt`
- **Contro:** Dissipazione numerica (smorzamento)

### Solver Jacobi

- Convergenza garantita per matrici diagonalmente dominanti
- 20-40 iterazioni sufficienti per simulazioni real-time

### Clamping Velocità

Per prevenire esplosioni numeriche:

```glsl
velocity = min(max(velocity, -1000.0), 1000.0);
```

## Ottimizzazioni GPU

1. **Texture Float16** invece di Float32 (metà memoria, stessa qualità visiva)
2. **textureOffset** per cache locality
3. **Bilinear filtering manuale** per controllo preciso
4. **Attribute-less rendering** (meno overhead draw call)

## Estensioni Future

- **Multigrid solver** per convergenza più veloce
- **MacCormack advection** per meno dissipazione
- **Obstacle handling** per oggetti solidi
- **3D Navier-Stokes** (computazionalmente più costoso)
