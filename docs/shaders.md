# Documentazione Shader

## Panoramica

Gli shader GLSL implementano i passaggi della simulazione sulla GPU. Ogni shader è un programma fragment che elabora una texture in input e produce una texture in output.

## Vertex Shader

### `quad.vert` - Fullscreen Quad

Genera un triangolo che copre l'intero viewport usando `gl_VertexID`:

```glsl
float x = float((gl_VertexID & 1) << 2) - 1.0;  // -1, 3, -1
float y = float((gl_VertexID & 2) << 1) - 1.0;  // -1, -1, 3
v_texCoord = vec2(x, y) * 0.5 + 0.5;
gl_Position = vec4(x, y, 0.0, 1.0);
```

**Chiamata:** `gl.drawArrays(gl.TRIANGLES, 0, 3)`

## Shader di Simulazione

### `advect.frag` - Advection Semi-Lagrangiana

**Input:**
- `u_velocity` - campo velocità per backtracing
- `u_source` - campo da advettare
- `u_texelSize` - 1/gridSize (per backtrace)
- `u_sourceTexelSize` - 1/sourceSize (per sampling)
- `u_dt` - timestep
- `u_dissipation` - fattore di decadimento

**Algoritmo:**
1. Legge velocità alla posizione corrente
2. Calcola posizione precedente: `pos - dt * vel * texelSize`
3. Campiona source con bilinear filtering manuale
4. Applica dissipazione: `result / (1 + dissipation * dt)`

**Bilinear Filtering Manuale:**
```glsl
vec4 bilerp(sampler2D sam, vec2 uv, vec2 tsize) {
    vec2 st = uv / tsize - 0.5;
    vec2 iuv = floor(st);
    vec2 fuv = fract(st);
    vec4 a = texture(sam, (iuv + vec2(0.5, 0.5)) * tsize);
    vec4 b = texture(sam, (iuv + vec2(1.5, 0.5)) * tsize);
    vec4 c = texture(sam, (iuv + vec2(0.5, 1.5)) * tsize);
    vec4 d = texture(sam, (iuv + vec2(1.5, 1.5)) * tsize);
    return mix(mix(a, b, fuv.x), mix(c, d, fuv.x), fuv.y);
}
```

---

### `divergence.frag` - Calcolo Divergenza

**Input:**
- `u_velocity` - campo velocità
- `u_texelSize` - per boundary check

**Output:** Scalare divergenza (formato R16F)

**Algoritmo:**
```glsl
// Central differences
div = 0.5 * (vR - vL + vT - vB)

// Boundary conditions (free-slip)
if (al bordo) { v_normale = -v_centrale }
```

---

### `pressure.frag` - Jacobi Iteration

**Input:**
- `u_pressure` - pressione iterazione precedente
- `u_divergence` - divergenza target

**Output:** Nuova pressione

**Formula Jacobi:**
```glsl
p_new = (pL + pR + pB + pT - div) * 0.25
```

---

### `gradient.frag` - Sottrazione Gradiente

**Input:**
- `u_pressure` - pressione risolta
- `u_velocity` - velocità pre-proiezione

**Output:** Velocità divergence-free

**Formula:**
```glsl
velocity -= vec2(pR - pL, pT - pB);  // Pavel's formula
```

---

### `curl.frag` - Calcolo Vorticità

**Input:**
- `u_velocity` - campo velocità
- `u_texelSize`

**Output:** Scalare curl (vorticità 2D = pseudo-scalare)

**Formula:**
```glsl
curl = 0.5 * ((vR.y - vL.y) - (vT.x - vB.x))
```

---

### `vorticity.frag` - Vorticity Confinement

**Input:**
- `u_velocity` - velocità corrente
- `u_curl` - curl precomputed
- `u_curlStrength` - intensità effetto
- `u_dt` - timestep

**Algoritmo:**
1. Calcola gradiente del curl assoluto
2. Normalizza
3. Forza perpendicolare proporzionale al curl
4. Aggiungi alla velocità

---

### `forces.frag` - Iniezione Forze

**Input:**
- `u_velocity` - velocità corrente
- `u_forcePosition` - posizione input utente
- `u_forceDirection` - direzione e magnitudine
- `u_forceRadius` - raggio di influenza
- `u_aspectRatio` - correzione aspect
- `u_time`, `u_noiseScale`, `u_noiseStrength` - per noise procedurale

**Algoritmo:**
```glsl
// Gaussian splat
float influence = exp(-dist² / (2 * radius²))
velocity += direction * influence

// Optional noise
velocity += snoise(coord) * noiseStrength
```

---

### `dye.frag` - Iniezione Colore

Simile a forces.frag ma aggiunge colore RGB invece di velocità.

---

### `clear.frag` - Scaling Pressione

Scala la pressione del frame precedente per convergenza più veloce:

```glsl
fragColor = u_value * texture(u_texture, v_texCoord).r;
```

Tipicamente `u_value = 0.8` (mantiene 80% della pressione precedente).

---

### `splat.frag` - Splat Generico

Inietta un colore/valore a una posizione con falloff gaussiano.

## Shader di Effetti

### `display.frag` - Rendering Finale

**Input:**
- `u_texture` - dye texture
- `u_bloom` - bloom texture (optional)
- `u_sunrays` - sunrays texture (optional)
- Vari flag enable

**Pipeline:**
1. **Shading** - effetto 3D da gradienti di luminosità
2. **Sunrays** - moltiplicazione
3. **Bloom** - addizione
4. **Gamma correction** - linearToGamma()
5. **Dithering** - riduce banding

---

### `bloom-prefilter.frag` - Estrazione Luminosità

Estrae pixel sopra soglia con soft knee curve:

```glsl
float brightness = max(color.r, max(color.g, color.b));
float soft = brightness - threshold + knee;
// ... soft knee math
color *= contribution;
```

---

### `blur.frag` - Gaussian Blur

Blur separabile (orizzontale o verticale):

```glsl
// 5-tap gaussian con pesi ottimizzati
color += texture(u_texture, uv) * 0.227027;
color += texture(u_texture, uv + off1) * 0.316216;
color += texture(u_texture, uv - off1) * 0.316216;
color += texture(u_texture, uv + off2) * 0.070270;
color += texture(u_texture, uv - off2) * 0.070270;
```

---

### `bloom-final.frag` - Composizione Bloom

Combina i livelli mip-map del bloom.

---

### `sunrays-mask.frag` - Maschera Sunrays

Converte luminosità in maschera per light scattering.

---

### `sunrays.frag` - Volumetric Light Scattering

Implementa l'effetto "god rays" da GPU Gems 3:

```glsl
for (int i = 0; i < ITERATIONS; i++) {
    coord -= dir;  // Verso il centro
    float sample = texture(u_texture, coord).r;
    sample *= illuminationDecay * weight;
    color += sample;
    illuminationDecay *= Decay;
}
```

---

### `copy.frag` - Copia Texture

Semplice passthrough per copiare texture.

## Formati Texture

| Shader | Output Format | Canali |
|--------|---------------|--------|
| advect | RGBA16F o RG16F | 4 o 2 |
| divergence | R16F | 1 |
| pressure | R16F | 1 |
| gradient | RG16F | 2 |
| curl | R16F | 1 |
| vorticity | RG16F | 2 |
| forces | RG16F | 2 |
| dye | RGBA16F | 4 |
| display | RGBA8 | 4 |

## Performance Tips

1. **textureOffset** è più veloce di texture() con offset manuale
2. **Precision mediump** per pressione (sufficiente, più veloce)
3. **Bilinear manuale** solo dove serve (advect)
4. **Unroll loops** per sunrays (ITERATIONS costante)
