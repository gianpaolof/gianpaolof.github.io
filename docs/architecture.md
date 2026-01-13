# Architettura della Simulazione Fluida

## Panoramica

Questa simulazione implementa le **equazioni di Navier-Stokes** per fluidi incomprimibili in 2D usando WebGL2. La tecnica è basata sull'implementazione di Pavel Dobryakov con ottimizzazioni per GPU moderne.

## Struttura dei Moduli

```
fluid-sim/
├── js/
│   ├── main.js          # Entry point, animation loop
│   ├── fluid-solver.js  # Orchestratore della simulazione
│   ├── gl-utils.js      # Utility WebGL (context, texture, FBO)
│   ├── shader-loader.js # Caricamento shader esterni
│   ├── config.js        # Configurazione e costanti
│   ├── input.js         # Gestione mouse/touch
│   └── ui.js            # Pannello controlli
├── gl/
│   ├── quad.vert        # Vertex shader fullscreen
│   ├── advect.frag      # Advection semi-Lagrangiano
│   ├── forces.frag      # Iniezione forze
│   ├── dye.frag         # Iniezione colore
│   ├── divergence.frag  # Calcolo divergenza
│   ├── pressure.frag    # Solver pressione (Jacobi)
│   ├── gradient.frag    # Sottrazione gradiente
│   ├── curl.frag        # Calcolo vorticità
│   ├── vorticity.frag   # Confinamento vorticità
│   ├── display.frag     # Rendering finale
│   └── ...              # Altri shader effetti
└── docs/
    └── architecture.md  # Questa documentazione
```

## Flusso di Esecuzione

```
┌──────────────────────────────────────────────────────────────┐
│                         main.js                               │
│  1. Inizializza FluidSolver                                   │
│  2. Collega InputManager e UI                                 │
│  3. Avvia animation loop (requestAnimationFrame)              │
└──────────────────────┬───────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────────┐
│                    Animation Loop                             │
│  for each frame:                                              │
│    1. inputManager.getForces() → forze utente                │
│    2. inputManager.getDyes() → colori da iniettare           │
│    3. fluidSolver.step(dt, forces, dyes)                     │
│    4. fluidSolver.render()                                    │
└──────────────────────────────────────────────────────────────┘
```

## FluidSolver - Orchestratore Principale

La classe `FluidSolver` coordina tutti i passaggi della simulazione:

```javascript
class FluidSolver {
    async init()           // Carica shader, crea programmi e FBO
    step(dt, forces, dyes) // Esegue un passo di simulazione
    render()               // Renderizza il risultato con effetti
    resize(w, h)           // Gestisce ridimensionamento
    destroy()              // Rilascia risorse GPU
}
```

## Pipeline della Simulazione

Ogni frame esegue questi passaggi in sequenza:

```
┌─────────────────────────────────────────────────────────────┐
│                    SIMULATION STEP                           │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. VELOCITY ADVECTION                                       │
│     velocity = advect(velocity, velocity)                    │
│     Il campo di velocità si "trasporta" da solo              │
│                                                              │
│  2. FORCE INJECTION                                          │
│     velocity += userForces                                   │
│     Aggiunge forze dall'input utente (mouse/touch)           │
│                                                              │
│  3. VORTICITY CONFINEMENT                                    │
│     curl = computeCurl(velocity)                             │
│     velocity += vorticityForce(curl)                         │
│     Amplifica i vortici per contrastare la dissipazione     │
│                                                              │
│  4. PRESSURE PROJECTION                                       │
│     a) divergence = computeDivergence(velocity)              │
│     b) pressure = solvePressure(divergence)  [Jacobi iter]   │
│     c) velocity -= gradient(pressure)                        │
│     Rende il campo divergence-free (incomprimibile)          │
│                                                              │
│  5. DYE ADVECTION                                            │
│     dye = advect(velocity, dye)                              │
│     I colori seguono il flusso della velocità               │
│                                                              │
│  6. DYE INJECTION                                            │
│     dye += userColors                                        │
│     Aggiunge colore dove l'utente interagisce               │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Rendering Pipeline

Dopo la simulazione, il rendering applica effetti visivi:

```
┌─────────────────────────────────────────────────────────────┐
│                    RENDER PIPELINE                           │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. BLOOM (optional)                                         │
│     a) prefilter → estrae aree luminose                      │
│     b) blur (multiple passes) → sfocatura gaussiana          │
│     c) composite → combina con l'immagine originale          │
│                                                              │
│  2. SUNRAYS (optional)                                       │
│     a) mask → crea mappa di luminosità                       │
│     b) radial blur → effetto raggi dal centro                │
│                                                              │
│  3. DISPLAY                                                  │
│     a) shading → effetto 3D "oleoso"                         │
│     b) combine bloom + sunrays                               │
│     c) gamma correction                                       │
│     d) dithering → riduce banding                            │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Double Framebuffer Object (DoubleFBO)

Per le operazioni iterative, usiamo due texture che si alternano:

```
┌──────────────────────────────────────────────────────────────┐
│  DoubleFBO: velocity, pressure, dye                          │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│   ┌─────────┐     render      ┌─────────┐                   │
│   │  READ   │ ───────────────►│  WRITE  │                   │
│   │ texture │                 │ texture │                   │
│   └─────────┘                 └─────────┘                   │
│        ▲                           │                         │
│        │         swap()            │                         │
│        └───────────────────────────┘                         │
│                                                              │
│   Dopo ogni operazione, swap() inverte READ e WRITE          │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

## Risoluzioni Multiple

La simulazione usa risoluzioni diverse per ottimizzare le prestazioni:

| Campo | Risoluzione | Motivazione |
|-------|-------------|-------------|
| Velocity | `gridSize` (128) | La fisica non richiede alta risoluzione |
| Pressure | `gridSize` (128) | Accoppiato con velocity |
| Divergence | `gridSize` (128) | Campo scalare ausiliario |
| Curl | `gridSize` (128) | Per vorticity confinement |
| Dye | `dyeSize` (1024) | Alta risoluzione per dettagli visivi |
| Bloom | varies | Piramide mip-map |
| Sunrays | 196 | Risoluzione fissa |

## WebGL2 Features Utilizzate

- **Floating point textures** (`RGBA16F`, `RG16F`, `R16F`)
- **Linear filtering** su float textures (quando supportato)
- **textureOffset** per accesso efficiente ai vicini
- **Attribute-less rendering** (fullscreen quad via `gl_VertexID`)
- **Multiple Render Targets** (non usato, ma disponibile)

## Formato Texture

| Texture | Internal Format | Canali | Uso |
|---------|-----------------|--------|-----|
| Velocity | `RG16F` | 2 (x, y) | Componenti velocità |
| Pressure | `R16F` | 1 | Pressione scalare |
| Divergence | `R16F` | 1 | Divergenza scalare |
| Curl | `R16F` | 1 | Vorticità scalare |
| Dye | `RGBA16F` | 4 (r, g, b, a) | Colore |

## Riferimenti

- [GPU Gems - Fast Fluid Dynamics](https://developer.nvidia.com/gpugems/gpugems/part-vi-beyond-triangles/chapter-38-fast-fluid-dynamics-simulation-gpu)
- [Jos Stam - Stable Fluids](https://www.dgp.toronto.edu/public_user/stam/reality/Research/pdf/ns.pdf)
- [Pavel Dobryakov - WebGL Fluid](https://github.com/PavelDoGreat/WebGL-Fluid-Simulation)
