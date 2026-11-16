# ADR — concat-export / concat-vision: qué integrar y qué no

Fecha: 2026-11-13. Estado: propuesta aceptada para ejecución por fases.

## Contexto

`vendor/concat` tiene 8 crates vendorados (core, project, effects, media,
render, text, log, speech-min). El upstream (`concat-ref`, AGPL-3.0) tiene
20 crates; `concat-export` y `concat-vision` quedaron fuera por la
decisión original (`vendor/concat/NOTICE.md:84-95`,
`THIRD-PARTY-NOTICES.md`). Desde entonces el panorama cambió:

- `apps/concat-worker` ya tiene `render_export` propio (clips +
  transiciones CPU + speed + audio mix), empaquetado en el bundle.
- La app ya tiene `ort` (ONNX) para `remove_background`/u2netp — el costo
  de `infer` de concat-vision es menor de lo que sugerían los docs viejos.
- `concat-export` asume `concat-project` como modelo de documento,
  incompatible 1:1 con `.editoria.json`.

## Decisión

1. **Integrar en el worker, no en la app principal**: `concat-export`
   arrastraría `concat-render`/wgpu + `concat-media` al binario principal
   con el conflicto `links="ffmpeg"` sin resolver. El worker ya aísla ese
   problema.
2. **Empezar por `concat-vision` sin feature `infer`**: mask store,
   strokes, apply, `stabilize` (tracking de esquinas, aritmética pura) y
   `enhance` compilan sin ONNX y degradan a no-op con `infer`. El modelo
   RVM (GPL) sigue excluido; verificar licencias de selfie-256/SAM antes
   de distribuir pesos.
3. **Mapeo pragmático**: en vez de adoptar `ExportClip`/`ExportRequest`
   tal cual, portar selectivamente `flatten`/`resolve`/`speed_curve`/
   `audio_buses` al request del worker — menos superficie, mismo valor.
4. **NO integrar**: concat-host/api/server/mcp/cli (la app ya tiene MCP
   server e IPC propios), crates UI Slint (GPL-3.0-only, decisión legal
   previa), `concat-speech` completo (resuelto con speech-min).
5. **Preservar** headers SPDX/AGPL y `NOTICE.md`; nada de relicenciar.

## Consecuencias

- El worker gana speed curves y audio crossfade propios primero (oleada
  en curso); concat-export se evalúa después como salto de capacidad
  (HDR, alpha, buses) si el mapeo `.editoria.json`→request resulta
  viable.
- `concat-vision::stabilize` puede complementar `analyzeStabilization`
  existente sin costo de ONNX.

## Verificación pendiente

- Que `concat-vision` sin `infer` compile standalone en este workspace.
- Licencias de pesos descargables de concat-vision (selfie-256, SAM).
