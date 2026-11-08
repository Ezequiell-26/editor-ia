# 2026-11-08 — Auditoría de pendientes stale en IMPROVEMENT-QUEUE

Pasada del protocolo del loop (Devin CLI). La cola es la fuente de verdad del
trabajo pendiente; varios `[pending]` habían quedado cerrados por lotes
posteriores sin actualizar la marca. Se verificó cada uno contra el código y
se corrigió la documentación. **Sin cambios de código.**

## Corregido

- **«Disparador por carpeta» → done**: `write_project_file` +
  `render_project_variant` (`commands/variants.rs`) no exigen sesión;
  `state/folder-queue.ts` + `FolderQueuePanel` (Producción) encadenan
  probe→copia→proyecto→perfil adaptativo→limpieza→render→verificación.
  Evidencia: `npx vitest run src/state/folder-queue.test.ts` → 4/4.
- **«Keyframes de efecto en export» → resuelto**: video
  (`apply_effect_stack_animated`) y audio (`audio_stack_segment_plan`,
  `atrim`+`concat`), con Bézier y UI ◆ en ambos stacks.
- **«Efectos de audio (30 en Drift)»**: ya estaban; el pending quedó
  acotado al importador de paquetes de terceros (`.driftfx`/carpeta +
  validación de shaders) — único pendiente real de ese ítem.
- **«Compresión por GPU…» → verified**: todos los sub-ítems tachados o
  verificados (sonda `av1_*`/`vp9_*`, `availableHardware` codec-agnóstico).
- **CAPABILITY-MATRIX §2**: filas stickman y partículas figuraban ❌ aunque
  §7 las declara HECHO → ✅ con evidencia (`commands/stickman.rs`,
  `StickmanPanel`).
- **KDENLIVE-REFERENCE**: scopes de audio bajo playhead ya hechos; sólo
  queda el scope del monitor con audio mezclado.

## Estado al cerrar

- `npx tsc --noEmit -p apps/desktop/tsconfig.json` → 0 errores.
- `npx vitest run src/state/folder-queue.test.ts` → 4/4.
- **No se commiteó**: el árbol mezcla trabajo concurrente de otra sesión
  (`IMPROVEMENT-QUEUE.md` creció ~35 líneas durante la pasada; transiciones
  `dip-color`, `audio_scopes`, `vpn`, io-range, etc. sin commitear).
- Archivo suelto `nul` (106 B, salida de rust-env) en la raíz del repo:
  artefacto de un redirect accidental de otra sesión; no se tocó.

## Pendientes reales que quedan (todos grandes o bloqueados)

Importador de paquetes de efectos · Preview Web Audio de la cadena de
audio · editor visual del rig stickman · transiciones OBS en vivo ·
titler con formas · scopes en vivo sobre el monitor · diarización con
modelo local · firma OV/EV · ola CapCut P1 (gateada a pedido del usuario).
