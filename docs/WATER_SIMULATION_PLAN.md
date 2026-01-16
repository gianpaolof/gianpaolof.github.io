# Piano di Implementazione: WebGL Water Simulation

## Panoramica

Implementazione di una simulazione dell'acqua realistica ispirata alla demo di Evan Wallace (madebyevan.com/webgl-water), integrata nel progetto esistente di simulazione fluidi Navier-Stokes.

**Branch**: `feature/webgl-water-simulation`

---

## 1. Fondamenti Matematici

### Equazione delle Onde vs Navier-Stokes

| Aspetto | Navier-Stokes | Equazione Onde |
|---------|---------------|----------------|
| Complessità | O(N³ log N) | O(N²) |
| Variabili | u,v,w,p (4) | h,v (2) |
| Pressure solve | Richiesto (iterativo) | Non necessario |
| GPU Friendliness | Scarsa | Eccellente |

**Scelta: Equazione delle Onde** - Perfetta per 60fps real-time.

### Equazione da Implementare (Leapfrog)

```
h^{n+1} = 2h^n - h^{n-1} + c²Δt²∇²h

dove ∇²h = (h[i+1,j] + h[i-1,j] + h[i,j+1] + h[i,j-1] - 4h[i,j]) / Δx²
```

### Condizione CFL (Stabilità)

```
Δt ≤ Δx / (c × √2)

Per griglia 512×512, pool 10m, c=2m/s:
Δx = 10/512 ≈ 0.0195m
Δt_max ≈ 0.0069s → ~3 substeps per frame a 60fps
```

### Fresnel (Schlick Approximation)

```
R(θ) = R₀ + (1-R₀)(1-cosθ)⁵
R₀ = ((n₁-n₂)/(n₁+n₂))² ≈ 0.02 per aria-acqua
```

### Normali dalla Heightfield

```
n = normalize(-∂h/∂x, 1, -∂h/∂z)
```

---

## 2. Architettura dei File

### File Esistenti da Riutilizzare

- `js/gl-utils.js` → **DoubleFBO**, createTexture, createProgram
- `js/shader-loader.js` → Sistema di caricamento shader
- `js/input.js` → Gestione mouse/touch
- `gl/quad.vert` → Vertex shader fullscreen

### Nuovi File da Creare

```
js/
├── water-solver.js      (~400 righe) - Orchestrazione
├── water-simulation.js  (~250 righe) - Fisica onde
├── water-renderer.js    (~500 righe) - Rendering 3D
└── water-config.js      (~80 righe)  - Configurazione

gl/water/
├── wave-update.frag     - Equazione onde (leapfrog)
├── wave-drop.frag       - Iniezione gocce
├── wave-normal.frag     - Calcolo normali
├── water-mesh.vert      - Vertex shader mesh 3D
├── water-surface.frag   - Fresnel + riflessione/rifrazione
├── pool-env.vert        - Ambiente piscina
├── pool-env.frag        - Texture pavimento/pareti
└── caustics.frag        - Caustiche (opzionale)

assets/
├── cubemap/             - Skybox per riflessioni
└── textures/            - Texture piastrelle
```

---

## 3. Fasi di Implementazione

### FASE 1: Simulazione Onde Base (2 giorni)

**Obiettivo**: Onde che si propagano, mouse crea gocce

**File da creare**:
- `js/water-simulation.js`
- `gl/water/wave-update.frag`
- `gl/water/wave-drop.frag`

**Shader wave-update.frag**:
```glsl
#version 300 es
precision highp float;

uniform sampler2D u_heightCurrent;
uniform sampler2D u_heightPrevious;
uniform float u_c2dt2;  // c² × Δt²
uniform vec2 u_texelSize;

out vec4 fragColor;

void main() {
    vec2 uv = gl_FragCoord.xy * u_texelSize;

    float h = texture(u_heightCurrent, uv).r;
    float hPrev = texture(u_heightPrevious, uv).r;

    // Laplaciano 5-point stencil
    float hL = texture(u_heightCurrent, uv + vec2(-u_texelSize.x, 0.0)).r;
    float hR = texture(u_heightCurrent, uv + vec2( u_texelSize.x, 0.0)).r;
    float hD = texture(u_heightCurrent, uv + vec2(0.0, -u_texelSize.y)).r;
    float hU = texture(u_heightCurrent, uv + vec2(0.0,  u_texelSize.y)).r;

    float laplacian = hL + hR + hD + hU - 4.0 * h;

    // Leapfrog: h^{n+1} = 2h^n - h^{n-1} + c²Δt²∇²h
    float hNew = 2.0 * h - hPrev + u_c2dt2 * laplacian;
    hNew *= 0.998;  // Damping

    fragColor = vec4(hNew, 0.0, 0.0, 1.0);
}
```

**Verifica Fase 1**:
- [ ] Click crea onde visibili
- [ ] Onde si riflettono ai bordi
- [ ] Ampiezza decade nel tempo
- [ ] Performance: 60fps

---

### FASE 2: Mesh 3D Superficie (2-3 giorni)

**Obiettivo**: Griglia 3D deformata dall'heightfield

**File da creare**:
- `js/water-renderer.js` (parte mesh)
- `gl/water/water-mesh.vert`
- `gl/water/wave-normal.frag`

**Shader water-mesh.vert**:
```glsl
#version 300 es

in vec3 a_position;
in vec2 a_texCoord;

uniform sampler2D u_heightfield;
uniform mat4 u_modelViewProjection;
uniform float u_heightScale;

out vec3 v_worldPos;
out vec3 v_normal;
out vec2 v_texCoord;

void main() {
    float height = texture(u_heightfield, a_texCoord).r;
    vec3 displaced = vec3(a_position.x, height * u_heightScale, a_position.z);

    // Normali dal gradient (semplificato)
    vec2 texelSize = vec2(1.0 / 256.0);
    float hL = texture(u_heightfield, a_texCoord + vec2(-texelSize.x, 0.0)).r;
    float hR = texture(u_heightfield, a_texCoord + vec2( texelSize.x, 0.0)).r;
    float hD = texture(u_heightfield, a_texCoord + vec2(0.0, -texelSize.y)).r;
    float hU = texture(u_heightfield, a_texCoord + vec2(0.0,  texelSize.y)).r;

    float dhdx = (hR - hL) * u_heightScale;
    float dhdz = (hU - hD) * u_heightScale;
    v_normal = normalize(vec3(-dhdx, 1.0, -dhdz));

    v_worldPos = displaced;
    v_texCoord = a_texCoord;

    gl_Position = u_modelViewProjection * vec4(displaced, 1.0);
}
```

**Verifica Fase 2**:
- [ ] Vista prospettica 3D funzionante
- [ ] Mesh si deforma con le onde
- [ ] Illuminazione base mostra struttura onde
- [ ] Camera posizionabile

---

### FASE 3: Riflessione e Rifrazione (3 giorni)

**Obiettivo**: Acqua realistica con Fresnel

**File da creare/modificare**:
- `gl/water/water-surface.frag`
- Caricamento cubemap
- `gl/water/pool-env.*`

**Shader water-surface.frag**:
```glsl
#version 300 es
precision highp float;

uniform samplerCube u_cubemap;
uniform sampler2D u_floorTexture;
uniform vec3 u_cameraPos;
uniform float u_poolDepth;

in vec3 v_worldPos;
in vec3 v_normal;
in vec2 v_texCoord;

out vec4 fragColor;

// Schlick Fresnel
float fresnelSchlick(float cosTheta) {
    const float R0 = 0.02;
    float x = 1.0 - cosTheta;
    float x2 = x * x;
    return R0 + (1.0 - R0) * x2 * x2 * x;
}

void main() {
    vec3 viewDir = normalize(u_cameraPos - v_worldPos);
    vec3 normal = normalize(v_normal);

    // Riflessione
    vec3 reflectDir = reflect(-viewDir, normal);
    vec3 reflection = texture(u_cubemap, reflectDir).rgb;

    // Rifrazione (Snell's law)
    float eta = 1.0 / 1.33;
    vec3 refractDir = refract(-viewDir, normal, eta);

    // Intersezione con pavimento
    float t = (v_worldPos.y + u_poolDepth) / max(-refractDir.y, 0.001);
    vec2 floorUV = v_worldPos.xz + refractDir.xz * t;
    floorUV = floorUV * 0.1 + 0.5;
    vec3 refraction = texture(u_floorTexture, floorUV).rgb;

    // Fresnel blending
    float cosTheta = max(dot(viewDir, normal), 0.0);
    float fresnel = fresnelSchlick(cosTheta);

    vec3 color = mix(refraction, reflection, fresnel);

    // Assorbimento acqua (Beer's law)
    float depth = u_poolDepth + v_worldPos.y;
    vec3 absorption = exp(-vec3(0.2, 0.1, 0.05) * depth);
    color *= absorption;

    fragColor = vec4(color, 1.0);
}
```

**Verifica Fase 3**:
- [ ] Cielo riflesso sulla superficie
- [ ] Pavimento visibile attraverso acqua
- [ ] Fresnel: più riflessione ad angoli radenti
- [ ] Colore acqua realistico

---

### FASE 4: Integrazione Completa (2 giorni)

**Obiettivo**: Switch tra modalità fluido e acqua

**Modifiche a file esistenti**:
- `js/main.js` - Aggiungere mode selector
- `js/shader-loader.js` - WATER_SHADER_PATHS
- `index.html` - Toggle button UI
- `js/ui.js` - Controlli specifici acqua

**Verifica Fase 4**:
- [ ] Toggle funzionante nel UI
- [ ] Context WebGL condiviso
- [ ] Ogni modalità ha controlli propri
- [ ] Nessuna perdita memoria nel switch

---

### FASE 5: Caustiche (Opzionale, 3-5 giorni)

**Obiettivo**: Pattern luminosi sul pavimento

**Tecnica**: Area-based con dFdx/dFdy

```glsl
// Calcolo brightness basato su distorsione area
vec2 dFloorPos_dx = dFdx(floorPos.xz);
vec2 dFloorPos_dy = dFdy(floorPos.xz);
float jacobian = abs(dFloorPos_dx.x * dFloorPos_dy.y -
                     dFloorPos_dx.y * dFloorPos_dy.x);

float brightness = clamp(refArea / max(jacobian, 0.0001), 0.0, 10.0);
```

**Verifica Fase 5**:
- [ ] Pattern caustiche visibili
- [ ] Si muovono con le onde
- [ ] Performance accettabile

---

## 4. Configurazione (water-config.js)

```javascript
export const WATER_CONFIG = {
    // Simulazione
    resolution: 256,
    waveSpeed: 2.0,
    damping: 0.998,
    substeps: 3,

    // Interazione
    dropRadius: 0.03,
    dropStrength: 0.5,

    // Rendering
    meshResolution: 128,
    heightScale: 0.3,
    poolDepth: 1.0,

    // Effetti
    reflectionEnabled: true,
    refractionEnabled: true,
    causticsEnabled: false,

    // Colori
    waterColor: [0.1, 0.3, 0.5],
    absorptionCoeff: [0.2, 0.1, 0.05]
};

export const WATER_QUALITY_PRESETS = {
    desktop: { resolution: 256, meshResolution: 128, causticsEnabled: true },
    mobile: { resolution: 128, meshResolution: 64, causticsEnabled: false },
    fallback: { resolution: 64, meshResolution: 32, causticsEnabled: false }
};
```

---

## 5. Risorse Necessarie

### Cubemap (Skybox)
- 6 immagini 512x512 o 1024x1024
- Formato: JPG o PNG
- Naming: px.jpg, nx.jpg, py.jpg, ny.jpg, pz.jpg, nz.jpg

### Texture Pavimento
- Piastrelle o pattern pietra
- 512x512 tileable

### Fonti gratuite:
- [Poly Haven](https://polyhaven.com/hdris) - HDRI convertibili a cubemap
- [ambientCG](https://ambientcg.com/) - Texture PBR gratuite

---

## 6. Stima Tempi

| Fase | Giorni | Cumulativo |
|------|--------|------------|
| Fase 1: Onde base | 2 | 2 |
| Fase 2: Mesh 3D | 2-3 | 4-5 |
| Fase 3: Riflessione/Rifrazione | 3 | 7-8 |
| Fase 4: Integrazione | 2 | 9-10 |
| Fase 5: Caustiche (opzionale) | 3-5 | 12-15 |

**Totale stimato: 9-10 giorni** (senza caustiche), **12-15 giorni** (completo)

---

## 7. Verifica Finale

```bash
# Test manuale
1. Aprire index.html in browser
2. Verificare toggle Fluid/Water funzionante
3. In Water mode:
   - Click crea onde
   - Onde si propagano e riflettono
   - Superficie riflette cielo
   - Pavimento visibile attraverso acqua
   - Fresnel cambia con angolo vista
4. Performance: devtools → 60fps stabile
5. Mobile: testare su device reale
```

---

## 8. Riferimenti

- **Codice sorgente Evan Wallace**: [github.com/evanw/webgl-water](https://github.com/evanw/webgl-water)
- **Articolo caustiche**: [medium.com/@evanwallace/rendering-realtime-caustics-in-webgl](https://medium.com/@evanwallace/rendering-realtime-caustics-in-webgl-2a99a29a0b2c)
- **GPU Gems Water**: [developer.nvidia.com/gpugems - Chapter 1](https://developer.nvidia.com/gpugems/gpugems/part-i-natural-effects/chapter-1-effective-water-simulation-physical-models)
- **Fresnel Equations**: Schlick, C. (1994) "An Inexpensive BRDF Model for Physically-based Rendering"

---

## 9. Altre Simulazioni Future

Basandosi sulla ricerca effettuata, altre simulazioni interessanti da considerare:

1. **Simulazione Fuoco** - Estensione diretta del solver Navier-Stokes esistente
2. **Reaction-Diffusion (Turing Patterns)** - Pattern biologici ipnotici
3. **Ferrofluido** - Fluido magnetico con picchi caratteristici
4. **Curl Noise Particles** - Effetti ambientali economici
5. **Digital Marbling (Suminagashi)** - Arte tradizionale giapponese
