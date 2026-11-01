# Rig 2D y personaje stickman (Fase 3)

Fecha: 2026-10-31. Rebanada de personaje 2D del [audit universal](UNIVERSAL-AI-ENGINE-AUDIT.md).
Es un motor propio, sin dependencias nuevas: esqueleto de huesos, poses
procedurales y dibujo determinista en canvas. El clip se hornea a MP4 y entra a
Medios; el timeline y el export siguen usando el pipeline normal.

## Qué existe

| Pieza | Archivo | Qué hace |
|---|---|---|
| Esqueleto y poses | `apps/desktop/src/features/rig/rig.ts` | 6 clips (`idle`, `walk`, `run`, `jump`, `wave`, `reach` con IK), 3 paletas, articulaciones en píxeles y dibujo de 9 huesos + cabeza. |
| Horneado | `apps/desktop/src/features/rig/bake.ts` | Renderiza cada frame y codifica VP9 con el codificador compartido. |
| Codificador común | `apps/desktop/src/features/video/encode-canvas.ts` | WebCodecs + mp4-muxer, también usado por el 3D. |
| UI | `apps/desktop/src/features/motion/RigPanel.tsx` | Preview, duración, calidad, generar y enviar a Medios. |
| Herramienta del agente | `rig_add` en `assistant-tools.ts` | Hornea un clip y lo importa a Medios; después `clip_add` lo monta. |

Las animaciones son ciclos matemáticos acotados: caminar/correr alternan
piernas y brazos con seno, el salto tiene agacharse/aire/caída y saludar levanta
solo el brazo derecho. `progress` se recorta a 0..1 y los ángulos se mantienen
en ±1,6 rad. No hay rigging automático desde fotos ni segmentación.

## IK de dos huesos (`reach`)

`solveTwoBone(origen, objetivo, upper, lower)` resuelve el codo por intersección
de círculos y elige la solución de mayor X para el brazo derecho; limita la mano
al alcance (si el objetivo queda lejos, el brazo apunta hacia él sin estirarse
más allá). El clip `reach` interpola un objetivo normalizado con
`ikAmount = sin(π·t)` (0 → 1 → 0), así el brazo sube, alcanza y vuelve; la mano
se dibuja con la pose IK y el resto del cuerpo sigue el reposo. `rig_add` acepta
`target: [x,y]` (0..1) para el clip; sin target usa (0,82, 0,28). El panel de
Motion muestra el clip, dos deslizadores **Objetivo X/Y** (0..1) y una mira sobre
el canvas; el mismo target se usa en la previsualización y en el horneado. La
prueba de UI cambia el clip a `reach`, ajusta X y comprueba que los controles
desaparecen al volver a otro clip.

## Horneado y entrada a Medios

- Dimensiones 320–1920 × 180–1080, pares; fps 10–30; duración 1–10 s.
- VP9 (`vp09.00.10.08`) con keyframe cada segundo y 6 Mbps por defecto.
- El panel usa 720p/1080p a 24 fps y `provider: "olyvia-rig"`.
- El MP4 entra a Medios como cualquier material: se puede recortar, mover,
  aplicar grade/efectos/transiciones y exportar con FFmpeg.
- No hay un segundo renderizador ni un clip de rig vivo en el timeline.

## Verificación medida

- **15 tests** de `rig.ts`: catálogo, paletas con respaldo, poses finitas y
  acotadas, recorte de progreso/NaN/Infinity, alternancia de piernas y brazos,
  salto, saludo, IK (alcance, límite y objetivo interpolado), esqueleto centrado
  y dibujo (fondo, suelo, 9 huesos, cabeza).
- **Horneado IK real** (`scripts/verify-rig-ik.mjs`, 2026-10-31): `reach` con
  objetivo (0,66; 0,30) → MP4 VP9 **245.658 B**, 2 s, 1280×720; frames 0,2/1/1,8 s
  con el brazo flexionado hacia el objetivo y de vuelta. Un objetivo lejano
  (0,88; 0,22) se limita al alcance (brazo extendido, sin error).
- **5 tests** del codificador común: dimensiones por defecto, pares y límites,
  fps/duración y base64 por bloques. `three/bake.ts` se refactorizó para usarlo.
- **1 test UI**: el panel “Personaje 2D” aparece en Motion con su preview y el
  botón “Generar video 2D”.
- **E2E real** (`e2e/rig-preview.spec.ts`, Chrome con canvas y WebCodecs):
  `brightFirst 3372`, `brightLast 3070`, `diff 2054813`, `encodedBytes 18267`,
  `320×180`, 12 fps, 1 s, `clip: walk`; el MP4 se decodifica con un `<video>`
  (`decodedDuration 1`, `decodedPixels 1492`) y `ok: true`.
- Tipo, build y suite serial completa (**226 archivos / 1.724 tests**) verdes.

## Límites actuales

- Solo stickman procedural: no hay huesos importados, IK, skinning, rigs de
  Lottie/Rive ni retargeting entre esqueletos.
- No hay personaje texturizado ni alfa: el fondo es sólido.
- El clip se hornea; no se edita el esqueleto dentro del timeline ni se
  reutiliza la animación con otro personaje.
- La duración del video recorre el ciclo una vez; `cycleSeconds` es una
  sugerencia, no un bucle automático.
- `rig_add` vive en la app porque necesita WebCodecs; el MCP de archivos no lo
  expone (12 herramientas).
- El tracking de punto todavía no alimenta el rig (no hay retargeting de pose).
