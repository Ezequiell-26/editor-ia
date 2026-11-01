# Rendimiento de la preview con efectos — medición real

Fecha: 2026-10-30. Este documento registra mediciones reproducibles de la
preview con el componente real de efectos. **No estima** FPS ni tiempos: cuenta
frames presentados con `requestVideoFrameCallback`, descarta el warm-up y mide
CPU/RAM/GPU en una pasada aparte para no contaminar el FPS.

## Equipo y software

| Dato | Valor |
|---|---|
| CPU | AMD Ryzen 5 4600G (12 hilos lógicos) |
| RAM | 13,9 GB |
| GPU / WebGL | AMD Radeon Graphics · ANGLE D3D11 `vs_5_0 ps_5_0` |
| Sistema | Windows 10.0.26300 |
| Navegador | Chrome (Playwright, GPU activa, headless con ANGLE D3D11) |
| Fuente | `testsrc2` 1920×1080 @ 60 fps, H.264, 8 s, 20 Mbps |
| Ventana medida | 4,0 s tras warm-up de 1,5 s |

El JSON crudo está en [`EFFECTS-PREVIEW-BENCH.json`](EFFECTS-PREVIEW-BENCH.json)
(**contiene la última corrida, 21:42Z, con dos frames temporales**; las tablas
anteriores quedan como registro histórico). El generador es `npm run bench:preview` (`scripts/bench-preview-effects.mjs`). El
script crea el video temporal, levanta Vite, mide FPS y después repite cada caso
muestreando el árbol de Chrome; al final borra el fixture.

## Resultados FPS (1080p60, iGPU, corrida 15:33Z)

| Caso | FPS medio | p95 frame | Frames |
|---|---:|---:|---:|
| Sin efectos | 57,3 | 17,3 ms | 231 |
| LUT 3D | 58,0 | 17,1 ms | 234 |
| Denoise con pase temporal | 60,0 | 17,0 ms | 242 |
| Denoise sólo espacial | 57,5 | 17,1 ms | 232 |
| LUT + denoise con temporal | 60,0 | 17,0 ms | 242 |
| LUT + denoise sólo espacial | 56,0 | 33,2 ms | 226 |
| Viñeta | 51,1 | 33,4 ms | 207 |
| Motion blur | 57,5 | 17,2 ms | 232 |
| LUT + denoise + viñeta + motion blur | 60,0 | 17,0 ms | 242 |

## Uso de recursos (misma corrida, pasada aparte)

Cada caso se repite y se muestrea el árbol de Chrome (`remote-debugging-pipe` +
su `user-data-dir`) a ~1 Hz durante la misma ventana de 4 s. La pasada tiene
3 muestras por caso (ventana efectiva 3,0–3,4 s), así que es una **referencia de
orden de magnitud**, no un perfil fino.

| Caso | CPU % de la máquina | Núcleos equivalentes | RAM (working set) | GPU 3D |
|---|---:|---:|---:|---:|
| Sin efectos | 1,8 % | 0,22 | 627 MB | 4,3 % |
| LUT 3D | 2,7 % | 0,32 | 604 MB | 22,4 % |
| Denoise con temporal | 4,3 % | 0,52 | 602 MB | 23,5 % |
| Denoise sólo espacial | 3,0 % | 0,36 | 610 MB | 19,6 % |
| LUT + denoise con temporal | 3,9 % | 0,46 | 614 MB | 21,2 % |
| LUT + denoise sólo espacial | 3,1 % | 0,38 | 607 MB | 17,8 % |
| Viñeta | 2,8 % | 0,34 | 614 MB | 20,2 % |
| Motion blur | 1,8 % | 0,22 | 604 MB | 8,9 % |
| LUT + denoise + viñeta + motion blur | 4,3 % | 0,51 | 613 MB | 21,5 % |

- **CPU**: porcentaje de la máquina completa (12 hilos); la columna de núcleos
  equivalentes es el mismo dato sin normalizar. Incluye renderer, GPU process,
  decodificación y utilidades del árbol de Chrome.
- **RAM**: working set sumado de los 8 procesos del árbol de Chrome; incluye el
  navegador y el video, no sólo los efectos.
- **GPU 3D**: utilización del motor 3D del proceso GPU de Chrome según el
  contador `GPU Engine` de Windows. El caso base (sólo decodificar y presentar)
  marca 4,3 %; LUT y denoise suben a ~20–24 %.
- Los pares con/sin temporal muestran el costo del pase en CPU y GPU
  (denoise 0,52 vs 0,36 núcleos; LUT+denoise 0,46 vs 0,38), **sin una caída de
  FPS consistente** en esta corrida.

## Corrida con denoise graduado (18:41Z, sin par)

Después de mover el grade antes del denoise (ruedas/gamma/curvas aplicadas al
centro, a los 24 vecinos y al frame anterior), la misma máquina y fixture dieron:

| Caso | FPS medio | p95 frame | GPU 3D |
|---|---:|---:|---:|
| Sin efectos | 54,0 | 33,4 ms | 4,3 % |
| LUT 3D | 60,0 | 17,1 ms | 28,8 % |
| Denoise con temporal | 60,0 | 17,0 ms | 35,0 % |
| Denoise sólo espacial | 60,0 | 17,0 ms | 26,4 % |
| LUT + denoise con temporal | 57,0 | 33,1 ms | 29,7 % |
| LUT + denoise sólo espacial | 52,8 | 33,3 ms | 33,9 % |
| Viñeta | 52,5 | 33,4 ms | 31,9 % |
| Motion blur | 60,0 | 17,0 ms | 11,7 % |
| LUT + denoise + viñeta + motion blur | 60,0 | 16,9 ms | 61,6 % |

CPU **0,9–4,3 %** de la máquina y RAM **617–640 MB**; 2 muestras de GPU por caso.
Lectura: no es una corrida pareada y la varianza entre corridas ya documentada
sigue vigente. El denoise graduado sube la GPU 3D del caso completo a **61,6 %**
(antes 21,5 %) por graduar 24 vecinos por píxel, pero el caso completo mantiene
**60 FPS** y el p95 de 16,9 ms; no hay evidencia de una caída de FPS atribuible
con esta única corrida.

## Corrida final (21:42Z, dos frames temporales)

Estado que quedó en el árbol: denoise espacial + **dos** frames anteriores.
Medición con el mismo fixture y equipo:

| Caso | FPS medio | p95 frame | Frames | GPU 3D |
|---|---:|---:|---:|---:|
| Sin efectos | 58,8 | 16,9 ms | 237 | 3,5 % |
| LUT 3D | 48,3 | 33,4 ms | 195 | 61,4 % |
| Denoise con temporal | 44,4 | 33,5 ms | 180 | 66,4 % |
| Denoise sólo espacial | 48,6 | 33,4 ms | 196 | 65,9 % |
| LUT + denoise con temporal | 60,0 | 17,0 ms | 242 | 61,4 % |
| LUT + denoise sólo espacial | 60,0 | 17,0 ms | 242 | 68,7 % |
| Viñeta | 52,5 | 33,4 ms | 212 | 71,7 % |
| Motion blur | 60,0 | 17,1 ms | 242 | 9,7 % |
| LUT + denoise + viñeta + motion blur | 46,7 | 33,4 ms | 190 | 99,2 % |

CPU **1,8–2,9 %** y RAM **601–628 MB** (2 muestras de uso por caso).

## Experimento tercer frame (21:15Z, revertido)

Antes de esta corrida probé un tercer frame anterior (ring de 4 canvas, textura
extra, peso 0,2). En esa única corrida el denoise midió **43,1 FPS** (p95 33,5 ms)
frente a **56,8** del espacial (GPU 72 % vs 63,6 %) y el caso completo **46,1**
con GPU **98 %**. El harness mostraba una reducción de desviación algo mayor.

La corrida final con dos frames dio **44,4 vs 48,6** en el par temporal/espacial
y **60** en LUT+denoise: la brecha parecida cambió de 13,7 a 4,2 FPS y el propio
benchmark ya advierte que una sola corrida no atribuye costos. Decisión: se
revirtió el tercer frame para no sumar una textura y una muestra por píxel sin
evidencia repetida de beneficio en FPS; la mejora de desviación era marginal y
no se conserva como feature.

## Lectura honesta

- La pantalla es de 60 Hz: **60 FPS es el techo**. Las diferencias por debajo
  del techo y el p95 de 33 ms (un frame perdido) son la señal útil.
- La varianza entre corridas es mayor que el efecto de varios filtros: el caso
  sin efectos dio 58,3, 54,5 y 57,3 FPS en tres corridas; viñeta 60, 52 y 51,1;
  motion blur 56,3, 60 y 57,5. **No se atribuye una caída de FPS a un efecto por
  una sola corrida**; la comparación pareada dentro de la misma corrida es la
  que vale.
- En la corrida pareada, el denoise temporal no bajó los FPS (60 vs 57,5 sólo
  denoise; 60 vs 56 con LUT) pero sí subió CPU y GPU. La corrida previa que
  marcó **47,1 FPS** no se reprodujo y queda registrada como outlier en el
  historial, no como costo estable del temporal.
- En la corrida final (21:42Z) el denoise temporal quedó en **44,4 FPS** frente
  a **48,6** del espacial, pero LUT+denoise dio **60** en ambos pares; la
  varianza sigue siendo mayor que el efecto. El uso de GPU 3D de esta corrida
  (61–99 %) es mucho más alto que el de las corridas previas (17–24 %) sin que
  cambie el código de esos casos: el contador `GPU Engine` no es comparable
  entre corridas y sólo sirve como orden de magnitud dentro de una misma pasada.
- El motion blur usa el camino Canvas (sin pasar por el shader) y se mantiene
  cerca del techo con GPU 3D baja (~9 %); su costo aparece en el p95 cuando la
  escena se mueve.
- El perfil **Eficiente** apaga el pase temporal para reducir trabajo en equipos
  modestos; Equilibrado y Máximo lo mantienen. El export no cambia: sigue
  usando `atadenoise` antes de acumular el blur.
- La medición usa Chrome con ANGLE D3D11 sobre la iGPU, **no el WebView2 de
  Tauri**. Es una referencia de la misma familia de GPU, no una promesa para
  todos los equipos.
- El muestreo de uso depende de WMI y del contador `GPU Engine` de Windows; en
  otros sistemas la pasada de uso queda vacía y sólo se reporta FPS.

## Historial de corridas

| Fecha (UTC) | Cambio | Sin efectos | Denoise temporal | Denoise espacial | LUT+denoise | Viñeta | Motion blur | Todo |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| 2026-10-30 (pre-temporal) | denoise sólo espacial | 58,3 | — | 55,0 | 60,0 | 60,0 | 56,3 | 60,0 |
| 2026-10-30 15:12 | temporal recién integrado | 54,5 | 47,1 | — | 48,8 | 52,0 | 60,0 | 57,0 |
| 2026-10-30 15:33 | pares temporal/espacial | 57,3 | 60,0 | 57,5 | 60,0 | 51,1 | 57,5 | 60,0 |
| 2026-10-30 21:15 | experimento con 3 frames (revertido) | 57,5 | 43,1 | 56,8 | 54,8 | 48,8 | 60,0 | 46,1 |
| 2026-10-30 21:42 | final con 2 frames | 58,8 | 44,4 | 48,6 | 60,0 | 52,5 | 60,0 | 46,7 |

La fila 21:42 es la que quedó en el JSON versionado e incluye la columna
`usage` con CPU/RAM/GPU por caso. La fila 21:15 corresponde al experimento de
tres frames que se revirtió (ver sección anterior).

## Reproducir

```bash
npm run bench:preview
```

Requiere Chrome instalado, el FFmpeg empaquetado y PowerShell en Windows para
la pasada de uso. La salida incluye las tablas Markdown y actualiza
`docs/EFFECTS-PREVIEW-BENCH.json`.
