# Hurricane Visualization Algorithms for WebGL

## Research Report

**Data**: 14 Gennaio 2026
**Obiettivo**: Identificare algoritmi migliori per creare effetti uragano realistici in WebGL

---

## Executive Summary

Il problema principale della nostra implementazione attuale è che **manipoliamo solo il campo di velocità**, producendo movimento a spirale ma non strutture visibili. Un uragano reale ha **bande nuvolose discrete** (spiral arms) che sono visivamente distinte.

Questa ricerca identifica **3 approcci principali** per risolvere il problema:

1. **Spiral Density Overlay** - Generare densità procedurale lungo spirali logaritmiche
2. **Hybrid Particle System** - Aggiungere particelle Lagrangiane advette dal campo Euleriano
3. **Domain Warping** - Distorcere texture noise seguendo pattern spirale

---

## 1. Matematica delle Spirali Logaritmiche

### Formula Fondamentale

Gli uragani seguono spirali **logaritmiche** (o equiangolari):

```
r = a × e^(b × θ)
```

Dove:
- `r` = distanza dal centro
- `θ` = angolo in radianti
- `a` = raggio iniziale (scala)
- `b` = tasso di crescita = cot(α), dove α è l'angolo costante tra raggio e tangente

### Forma Inversa (per shader)

Per trovare la distanza da un punto alla spirale:

```glsl
// Coordinate spirale: quale angolo "dovrebbe" avere un punto a distanza r
float spiralTheta = log(r / a) / b;

// Distanza angolare dal braccio più vicino
float toArm = mod(theta - spiralTheta + PI, armSpacing) - armSpacing/2;
```

### Parametri Tipici per Uragani

| Parametro | Valore | Descrizione |
|-----------|--------|-------------|
| Tightness (b) | 0.15 - 0.25 | Quanto è "avvolta" la spirale |
| Numero bracci | 3 - 7 | Bande spirali principali |
| Raggio occhio | 5-15% del raggio totale | Zona calma centrale |
| Eye wall width | 2-5% | Spessore della parete dell'occhio |

---

## 2. Approccio 1: Spiral Density Overlay

### Concetto

Creare una **texture di densità procedurale** che definisce dove sono le "nuvole" dell'uragano, separata dal campo di velocità.

### Shader GLSL

```glsl
#version 300 es
precision highp float;

uniform vec2 u_center;
uniform float u_time;
uniform float u_numArms;
uniform float u_tightness;
uniform float u_eyeRadius;
uniform float u_aspectRatio;

in vec2 v_texCoord;
out float fragColor;

// Simplex noise (da includere)
float snoise(vec2 v);

// FBM per texture nuvole
float fbm(vec2 p, int octaves) {
    float value = 0.0;
    float amplitude = 0.5;
    for (int i = 0; i < octaves; i++) {
        value += amplitude * snoise(p);
        p *= 2.0;
        amplitude *= 0.5;
    }
    return value;
}

// Densità braccio spirale
float spiralArmDensity(vec2 pos, float r, float theta) {
    // Coordinata spirale logaritmica
    float spiralPhase = theta - u_tightness * log(max(r / u_eyeRadius, 0.01));
    spiralPhase += u_time * 0.15;  // Rotazione

    // Pattern multi-braccio
    float armSpacing = 6.28318 / u_numArms;
    float toArm = mod(spiralPhase + armSpacing * 0.5, armSpacing) - armSpacing * 0.5;

    // Profilo Gaussiano del braccio
    float armWidth = 0.3 + r * 0.2;  // Più larghi verso l'esterno
    return exp(-toArm * toArm / (armWidth * armWidth));
}

void main() {
    vec2 pos = v_texCoord - u_center;
    pos.x *= u_aspectRatio;

    float r = length(pos);
    float theta = atan(pos.y, pos.x);

    // Componenti strutturali
    float eye = smoothstep(u_eyeRadius * 0.7, u_eyeRadius * 1.5, r);
    float eyeWall = exp(-pow((r - u_eyeRadius) / 0.05, 2.0));
    float outer = 1.0 - smoothstep(0.6, 1.0, r);

    // Bracci spirale
    float arms = spiralArmDensity(pos, r, theta);

    // Texture nuvole
    float clouds = fbm(pos * 5.0 + u_time * 0.05, 5) * 0.5 + 0.5;

    // Combina
    float density = (arms * 0.7 + eyeWall * 1.5) * eye * outer;
    density *= 0.6 + 0.4 * clouds;

    fragColor = clamp(density, 0.0, 1.0);
}
```

### Integrazione nel Display Shader

```glsl
// In display.frag
uniform sampler2D u_spiralDensity;
uniform bool u_hurricaneMode;

void main() {
    vec3 c = texture(u_dye, v_texCoord).rgb;

    if (u_hurricaneMode) {
        float spiral = texture(u_spiralDensity, v_texCoord).r;

        // Modula il colore con la struttura spirale
        c *= 0.4 + spiral * 0.6;

        // Aggiungi bianco nelle zone dense
        c = mix(c, vec3(1.0), spiral * 0.4);
    }

    // ... resto del rendering
}
```

### Pro e Contro

| Pro | Contro |
|-----|--------|
| Semplice da implementare | Struttura "statica", non fluida |
| Basso costo computazionale | Può sembrare artificiale |
| Controllo preciso dei bracci | Non risponde alla fisica |

---

## 3. Approccio 2: Sistema di Particelle Ibrido

### Concetto

Aggiungere **particelle Lagrangiane** che vengono advette attraverso il campo di velocità Euleriano esistente. Le particelle creano le strutture visibili.

### Architettura WebGL2 con Transform Feedback

```
┌─────────────────┐
│  Velocity FBO   │ ← Il tuo campo di velocità esistente
└────────┬────────┘
         │ sample
         ▼
┌─────────────────┐      ┌─────────────────┐
│ Particle Buffer │ ──── │ Transform       │
│ A (read)        │      │ Feedback        │
└─────────────────┘      └────────┬────────┘
                                  │ write
                                  ▼
                         ┌─────────────────┐
                         │ Particle Buffer │
                         │ B (write)       │
                         └─────────────────┘
                                  │
                                  ▼ render
                         ┌─────────────────┐
                         │   Canvas        │
                         └─────────────────┘
```

### Particle Update Shader (Vertex)

```glsl
#version 300 es
precision highp float;

// Input attributes
in vec2 a_position;
in vec2 a_velocity;
in float a_age;
in float a_life;

// Transform feedback outputs
out vec2 v_position;
out vec2 v_velocity;
out float v_age;
out float v_life;

// Uniforms
uniform sampler2D u_velocityField;  // Il tuo velocity FBO
uniform float u_dt;
uniform vec2 u_center;
uniform float u_respawnRadius;

// Pseudo-random
float rand(vec2 co) {
    return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
    if (a_age >= a_life) {
        // Respawn su braccio spirale
        float angle = rand(vec2(a_age, a_life)) * 6.28318;
        float radius = 0.1 + rand(vec2(a_life, a_age)) * u_respawnRadius;

        // Offset spirale logaritmica
        float spiralOffset = log(radius / 0.1) / 0.2;
        angle += spiralOffset;

        v_position = u_center + vec2(cos(angle), sin(angle)) * radius;
        v_velocity = vec2(0.0);
        v_age = 0.0;
        v_life = 2.0 + rand(vec2(a_age * 2.0, a_life)) * 4.0;
    } else {
        // Campiona velocità dal campo Euleriano
        vec2 fieldVel = texture(u_velocityField, a_position).xy;

        // Integrazione RK2 per maggiore accuratezza
        vec2 midPos = a_position + fieldVel * u_dt * 0.5;
        vec2 midVel = texture(u_velocityField, midPos).xy;

        v_position = a_position + midVel * u_dt;
        v_velocity = mix(a_velocity, fieldVel, 0.2);
        v_age = a_age + u_dt;
        v_life = a_life;

        // Wrap ai bordi
        v_position = fract(v_position);
    }
}
```

### JavaScript Setup

```javascript
class HurricaneParticles {
    constructor(gl, count = 50000) {
        this.gl = gl;
        this.count = count;

        // 6 floats per particella: pos(2) + vel(2) + age(1) + life(1)
        const FLOATS_PER_PARTICLE = 6;

        // Inizializza dati
        const data = new Float32Array(count * FLOATS_PER_PARTICLE);
        for (let i = 0; i < count; i++) {
            const offset = i * FLOATS_PER_PARTICLE;
            data[offset + 0] = Math.random();     // x
            data[offset + 1] = Math.random();     // y
            data[offset + 2] = 0;                 // vx
            data[offset + 3] = 0;                 // vy
            data[offset + 4] = Math.random() * 5; // age (staggered)
            data[offset + 5] = 3 + Math.random() * 4; // life
        }

        // Double buffer setup
        this.buffers = [gl.createBuffer(), gl.createBuffer()];
        this.vaos = [gl.createVertexArray(), gl.createVertexArray()];
        this.tfs = [gl.createTransformFeedback(), gl.createTransformFeedback()];

        // ... setup completo (vedi ricerca particelle)
    }

    update(dt, velocityTexture) {
        const gl = this.gl;

        gl.useProgram(this.updateProgram);
        gl.uniform1f(this.uniforms.dt, dt);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, velocityTexture);

        gl.enable(gl.RASTERIZER_DISCARD);
        gl.bindVertexArray(this.vaos[this.current]);
        gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, this.tfs[this.current]);

        gl.beginTransformFeedback(gl.POINTS);
        gl.drawArrays(gl.POINTS, 0, this.count);
        gl.endTransformFeedback();

        gl.disable(gl.RASTERIZER_DISCARD);

        this.current = 1 - this.current;  // Swap
    }

    render() {
        // Render come GL_POINTS con blending
    }
}
```

### Pro e Contro

| Pro | Contro |
|-----|--------|
| Fisicamente accurato | Più complesso da implementare |
| Strutture emergenti naturali | Richiede molte particelle (50k+) |
| Risponde alla dinamica del fluido | Performance su mobile |
| Effetto "scie" naturale | Richiede Transform Feedback (WebGL2) |

---

## 4. Approccio 3: Domain Warping

### Concetto

Usare **domain warping** (distorsione del dominio) per creare pattern organici che seguono strutture spirale. Tecnica di [Inigo Quilez](https://iquilezles.org/articles/warp/).

### Shader GLSL

```glsl
#version 300 es
precision highp float;

uniform float u_time;
uniform vec2 u_resolution;

float snoise(vec2 v);  // Simplex noise

// FBM base
float fbm(vec2 p) {
    float f = 0.0;
    f += 0.5000 * snoise(p); p *= 2.01;
    f += 0.2500 * snoise(p); p *= 2.02;
    f += 0.1250 * snoise(p); p *= 2.03;
    f += 0.0625 * snoise(p);
    return f;
}

// Domain warping a due livelli
float warpedFbm(vec2 p, float time) {
    // Primo livello di warping
    vec2 q = vec2(
        fbm(p + vec2(0.0, 0.0) + time * 0.01),
        fbm(p + vec2(5.2, 1.3) + time * 0.01)
    );

    // Secondo livello
    vec2 r = vec2(
        fbm(p + 4.0 * q + vec2(1.7, 9.2)),
        fbm(p + 4.0 * q + vec2(8.3, 2.8))
    );

    return fbm(p + 4.0 * r);
}

// Applicare warping lungo spirale
float spiralWarpedDensity(vec2 uv, float time) {
    vec2 center = vec2(0.5);
    vec2 pos = uv - center;

    float r = length(pos);
    float theta = atan(pos.y, pos.x);

    // Coordinata spirale
    float spiralCoord = theta - log(max(r, 0.01)) / 0.2;
    spiralCoord += time * 0.1;  // Rotazione

    // Trasforma in coordinate "rettificate" lungo spirale
    vec2 spiralUV = vec2(spiralCoord, r * 3.0);

    // Applica domain warping
    float warped = warpedFbm(spiralUV, time);

    // Modula con struttura radiale
    float eyeFade = smoothstep(0.05, 0.15, r);
    float outerFade = 1.0 - smoothstep(0.5, 0.8, r);

    return warped * eyeFade * outerFade;
}

out vec4 fragColor;

void main() {
    vec2 uv = gl_FragCoord.xy / u_resolution;

    float density = spiralWarpedDensity(uv, u_time);

    // Colore nuvole
    vec3 color = mix(vec3(0.1, 0.15, 0.25), vec3(0.9, 0.95, 1.0), density);

    fragColor = vec4(color, 1.0);
}
```

### Pro e Contro

| Pro | Contro |
|-----|--------|
| Pattern molto organici | Non risponde alla fisica |
| Relativamente semplice | Può sembrare "statico" |
| Buon look da satellite | Meno controllo preciso |

---

## 5. Approccio Raccomandato: Combinazione

### Strategia Ibrida

La soluzione migliore combina **più approcci**:

```
┌─────────────────────────────────────────────────┐
│                 VELOCITY FIELD                   │
│    (Il tuo Rankine vortex esistente)            │
└─────────────────────┬───────────────────────────┘
                      │
          ┌───────────┴───────────┐
          ▼                       ▼
┌─────────────────┐     ┌─────────────────┐
│ SPIRAL DENSITY  │     │   PARTICLES     │
│ (Procedurale)   │     │ (Transform FB)  │
└────────┬────────┘     └────────┬────────┘
         │                       │
         └───────────┬───────────┘
                     ▼
         ┌─────────────────────┐
         │   DISPLAY SHADER    │
         │  (Compositing)      │
         └─────────────────────┘
```

### Implementazione Suggerita

1. **Fase 1**: Implementare **Spiral Density Overlay** (più semplice)
   - Crea nuovo shader `spiral-density.frag`
   - Aggiungi FBO per density
   - Modifica `display.frag` per compositare

2. **Fase 2**: Se serve più realismo, aggiungere **particelle**
   - Sistema ibrido Euleriano-Lagrangiano
   - Particelle advette dal velocity field
   - Spawn preferenziale sui bracci spirale

3. **Fase 3**: Opzionale **domain warping** per texture nuvole
   - Come layer aggiuntivo di dettaglio
   - Basso costo computazionale

---

## 6. Parametri di Configurazione Suggeriti

### Nuovi Parametri per config.js

```javascript
// Hurricane visualization
hurricaneVisualization: 'density',  // 'density', 'particles', 'hybrid'
hurricaneSpiralArms: 5,             // Numero di bracci
hurricaneSpiralTightness: 0.18,     // Quanto avvolta è la spirale
hurricaneCloudNoise: 0.4,           // Intensità texture nuvole
hurricaneEyeContrast: 0.8,          // Contrasto occhio/nuvole

// Particle system (se usato)
hurricaneParticleCount: 50000,
hurricaneParticleSize: 2.0,
hurricaneParticleTrailLength: 0.3,
```

---

## 7. Fonti e Riferimenti

### Implementazioni WebGL Fluid
- [Pavel Dobryakov's WebGL-Fluid-Simulation](https://github.com/PavelDoGreat/WebGL-Fluid-Simulation)
- [Jamie Wong - WebGL Fluid Simulation Tutorial](https://jamie-wong.com/2016/08/05/webgl-fluid-simulation/)
- [WebGL Fluid Enhanced](https://github.com/michaelbrusegard/WebGL-Fluid-Enhanced)

### GPU Gems e Algoritmi
- [NVIDIA GPU Gems Ch.38 - Fast Fluid Dynamics](https://developer.nvidia.com/gpugems/gpugems/part-vi-beyond-triangles/chapter-38-fast-fluid-dynamics-simulation-gpu)
- [Curl Noise Tutorial](https://emildziewanowski.com/curl-noise/)
- [Inigo Quilez - Domain Warping](https://iquilezles.org/articles/warp/)

### Fisica Uragani
- [Rankine Vortex Model](https://demonstrations.wolfram.com/RankineVortexASimpleHurricaneModel/)
- [Spiral Band Model for Cyclones](https://www.intechopen.com/chapters/68590)
- [Mathematical Model of Cyclones](https://www.isibang.ac.in/~kaushik/kaushik_files/cyclone.pdf)

### Particelle e Transform Feedback
- [WebGL2 Particles with Transform Feedback](https://gpfault.net/posts/webgl2-particles.txt.html)
- [WebGL2 Particle System Example](https://tsherif.github.io/webgl2examples/particles.html)
- [Building GPU-Accelerated Particle Systems](https://dev.to/hexshift/building-a-custom-gpu-accelerated-particle-system-with-webgl-and-glsl-shaders-25d2)

### Visualizzazione Scientifica
- [NVIDIA Earth-2 Hurricane Visualization](https://developer.nvidia.com/blog/spotlight-axa-explores-ai-driven-hurricane-risk-assessment-with-nvidia-earth-2/)
- [NASA Scientific Visualization Studio](https://svs.gsfc.nasa.gov/5515/)
- [Datoviz - GPU Scientific Visualization](https://www.khronos.org/blog/datoviz-ultra-fast-high-performance-gpu-scientific-visualization-library-built-on-vulkan)

### Shadertoy e Esempi
- [Galaxy Rendering with Density Waves](https://beltoforion.de/en/spiral_galaxy_renderer/)
- [The Book of Shaders - fBm](https://thebookofshaders.com/13/)
- [Simple Spiral Shader](https://gist.github.com/rpetrano/d83f5ca07f3dca041f9b)

---

## 8. Conclusioni

### Il Problema Originale

La nostra implementazione attuale manipola **solo il campo di velocità**. Questo produce movimento corretto ma le strutture (bracci spirale) non sono visibili perché il dye si diffonde uniformemente.

### La Soluzione

Aggiungere un layer di **densità procedurale** che definisce DOVE sono le "nuvole" dell'uragano, indipendentemente dalla diffusione del dye. Questo può essere:

1. **Semplice**: Texture procedurale basata su spirali logaritmiche
2. **Intermedio**: Domain warping per look organico
3. **Avanzato**: Sistema di particelle ibrido

### Prossimi Passi Consigliati

1. Implementare `spiral-density.frag` come proof-of-concept
2. Integrare nel pipeline di rendering
3. Testare e iterare sui parametri
4. Se necessario, aggiungere sistema particelle per maggiore realismo
