# Cerebro de edición

Capa determinista entre la timeline y la IA. La app mide, encuentra problemas y propone
ediciones concretas; la IA elige entre propuestas en vez de inventarlas.

## Por qué existe

Antes había dos extremos:

- **Director / Auto Edit**: planificaban *un asset* (transcripción → cortes). Muy potente,
  pero sólo miraba el material de entrada, no la timeline ya montada.
- **Asistente**: recibía un contexto de cinco campos (`projectName`, `clips`,
  `playheadFrame`, `fps`, `view`). Sin números, cualquier consejo de edición era una
  opinión.

El cerebro cubre el hueco: analiza la **timeline completa**, produce métricas
reproducibles y propone acciones que ya existen como primitivas.

## Flujo

```
ProjectDocument
      │
      ▼
analyzeTimeline()  ──►  TimelineSignals   (duración, planos, huecos, ASL, gancho…)
      │
      ▼
planEdits(intent)  ──►  EditPlan          (métricas + hallazgos + propuestas ordenadas)
      │                        │
      │                        ├──► brainBrief()  ──►  contexto del asistente
      │                        └──► BrainPanel    ──►  aplicar / descartar
      ▼
applyProposal()    ──►  closeGaps / splitClipAtFrames / deleteClip /
                        applyTransitionToCuts / updateAudioMix
```

## Archivos

| Archivo | Responsabilidad |
|---|---|
| `state/brain/types.ts` | Contrato: intents, señales, propuestas, plan, grilla de beats |
| `state/brain/analyze.ts` | Medición pura: timeline (`analyzeTimeline`) y guion (`analyzeScript`) |
| `state/brain/policies.ts` | Diez reglas de timeline, cada una con su motivo |
| `state/brain/script-policies.ts` | Cinco reglas de guion y narración (recomendaciones) |
| `state/brain/plan.ts` | Ensamblado, métricas, hallazgos y score 0–100 |
| `state/brain/apply.ts` | Ejecución sobre las primitivas existentes |
| `state/brain/report.ts` | Brief compacto para el prompt del asistente |
| `features/brain/BrainPanel.tsx` | UI: salud, métricas, guion, propuestas y detección de beats |

## Cortes en el pulso

El cerebro no decodifica audio: recibe una `BeatGrid` (BPM, confianza y frames
absolutos). La arma la UI con `detectBeats` + `planBeatCuts` sobre el clip de audio de
la timeline, así el plan sigue siendo una función pura y testeable con beats sintéticos.

Reglas:

- Con confianza **< 0,4** la grilla se ignora y se corta por tiempo (`longShotPolicy`).
- Con grilla usable, `beatPolicy` parte los planos largos **sobre beats**, tomando uno de
  cada N pulsos para que el plano dure cerca del objetivo del formato.
- `longShotPolicy` se apaga cuando hay grilla: dos propuestas de corte sobre el mismo clip
  serían contradictorias.
- Métrica **«Cortes en beat»**: porcentaje de cortes a menos de 80 ms de un pulso.

## Guion y narración

`analyzeScript` lee `project.scenes` y devuelve, por escena: título, estado, intención,
palabras, segundos estimados y cantidad de clips. Sobre eso corren cinco reglas:

| Regla | Qué detecta |
|---|---|
| Escenas sin material | Escena en el guion sin ningún clip montado |
| Escenas sin narración | Material sin texto ni voz (sólo si el formato exige subtítulos) |
| Narración rápida | Más de 4,2 palabras/s: el texto no entra en su duración |
| Narración lenta | Menos de 1,1 palabras/s en escenas de más de 8 s |
| Subtítulos rápidos | Cues con más de 22 caracteres/s |

Todas son **recomendaciones sin payload**: reescribir texto no es una operación de
timeline. El panel las muestra con "Requiere tu intervención" y el score las penaliza
(escenas sin material y narración apurada), pero nunca se aplican solas.

## Formatos (intents)

Cada formato fija objetivos: duración media de plano, máximo, mínimo, cortes en el gancho,
subtítulos obligatorios y uso de transiciones.

| Formato | ASL | Máx. plano | Gancho | Subtítulos |
|---|---|---|---|---|
| Limpieza | — | — | — | no |
| Ajuste de ritmo | 3,5 s | 9 s | 1 corte | no |
| Short vertical | 2,4 s | 5,5 s | 2 cortes | sí |
| Reel | 1,8 s | 4 s | 2 cortes | sí |
| Trailer | 2 s | 4,5 s | 3 cortes | no |
| Tutorial | 6 s | 14 s | — | sí |
| Vlog | 4,2 s | 10 s | 1 corte | sí |

## Contrato con la IA

El asistente recibe, antes del JSON del proyecto:

```
CEREBRO DE EDICIÓN · Short vertical · salud 58/100 (potencial 81)
duración 12s · 2 planos · plano medio 5s (objetivo 2.4) · 0 cortes · huecos 2s …
Hallazgos: 1 huecos en la timeline; sin cortes en el gancho.
Propuestas:
1. [seguro · aplicable · conf 0.92] Cerrar 2 s de hueco — …
Regla: no inventes cortes que el cerebro no midió. Si una propuesta no convence, decilo.
```

El brief va **primero** y como texto legible (no como campo JSON escapado), porque es la
parte que el modelo tiene que leer antes de proponer nada. Lo arma
`apps/desktop/src-tauri/src/commands/assistant.rs`.

## Reglas de diseño

1. **Una propuesta sin motivo no se muestra.** `reason` es obligatorio y cita el número que
   la disparó.
2. **Sin payload = recomendación.** Si no se puede resolver con una primitiva, el panel dice
   "Requiere tu intervención" en vez de fingir que se aplica sola.
3. **Nada reimplementa edición.** `apply.ts` llama a las funciones de `project-actions.ts`,
   así el undo, los bloqueos de pista y el schema siguen siendo los mismos.
4. **El score es una resta, no una opinión.** Cada penalidad tiene un tope y una fórmula
   visible en `plan.ts`.

## Cómo agregar una política

1. Escribir una función `(context: PolicyContext) => EditProposal[]` en `policies.ts`.
2. Sumarla a `POLICIES`.
3. Cubrirla en `state/brain/brain.test.ts` con un proyecto armado a mano.

Si la propuesta necesita una operación que no existe, primero se agrega la primitiva en
`project-actions.ts` con su test; el cerebro no inventa ediciones.
