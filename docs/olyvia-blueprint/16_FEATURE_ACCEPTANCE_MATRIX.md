# 16 — Matriz de aceptación funcional de Olyvia

**Finalidad:** checklist ejecutable para verificar que todas las áreas del producto están integradas. Los IDs son estables para reportes. El estado inicial es NOT EVALUATED para la aceptación completa; la evidencia histórica se consulta en docs/CAPABILITY-MATRIX.md y docs/APP-FEATURE-AUDIT.md.

## 1. Estados admitidos

- NOT EVALUATED: todavía no hay prueba actual que cierre el flujo.
- PASS: prueba ejecutada en el HEAD/build indicado y evidencia disponible.
- PARTIAL: existe parte del flujo, falta una operación o integración.
- BLOCKED: falta credencial, acceso, runtime o autorización externa.
- FAIL: prueba ejecutada y fallo reproducible.
- NOT APPLICABLE: sólo con justificación técnica/legal documentada.

No cambiar a PASS por compilación o por test unitario aislado si la capacidad exige integración y artefacto final.

## 2. Proyecto y medios

| ID | Aceptación | Responsable | Evidencia requerida |
|---|---|---|---|
| PRJ-001 | Crear proyecto nuevo desde Inicio y aplicar plantilla | HY4 + SWE 2 | Proyecto persistido, schema válido y re-open. |
| PRJ-002 | Abrir, guardar, cerrar y reabrir proyecto | SWE 2 | Hash/metadata coherentes y autosave. |
| PRJ-003 | Recuperar cambios tras crash controlado | SWE 2 | Recovery prompt, snapshot recuperado y no pérdida de última edición. |
| PRJ-004 | Migrar proyecto anterior a schema actual | SWE 2 | Fixtures de versiones antiguas y round-trip. |
| MED-001 | Importar vídeo, audio, imagen y subtítulo | HY4 + SWE 2 | Probe metadata, thumbnails y asset IDs. |
| MED-002 | Detectar archivo corrupto o formato no soportado | SWE 2 | Error tipado y UI accionable. |
| MED-003 | Relink de medios faltantes | HY4 + SWE 2 | Proyecto reabre con media reparada sin cambiar originales. |
| MED-004 | Crear thumbnails, waveform y proxy | SWE 2 | Artefactos reales y validación de tamaño/path. |
| MED-005 | Mostrar origen, creator y licencia por asset | HY4 + SWE 2 | Rights record persistente y UI con attribution. |
| MED-006 | Buscar/filtar/ordenar colecciones con muchos assets | HY4 | Test de virtualización/scroll y selección estable.

## 3. Timeline y edición
| ID | Aceptación | Responsable | Evidencia requerida |
|---|---|---|---|
| TLN-001 | Crear tracks y colocar clips de audio/video/imagen/texto | HY4 + SWE 2 | Proyecto editable que se reabre igual. |
| TLN-002 | Split, trim, ripple, roll, slip y slide | SWE 2 | Tests timebase y E2E por herramienta. |
| TLN-003 | Snap, multi-select, group, link/unlink y markers | HY4 + SWE 2 | Operaciones reales y estado persistido. |
| TLN-004 | Undo/redo de edición manual y batch IA | SWE 2 | Undo group revierte sólo ese lote. |
| TLN-005 | Frame/timecode/drop-frame y distintos FPS | SWE 2 | Property tests 23.976/29.97 DF/59.94 y otros profiles. |
| TLN-006 | Nested sequences, multicam y compound clips | SWE 2 | Sync y round-trip en project fixtures. |
| TLN-007 | Preview sigue al playhead y audio clock | HY4 + SWE 2 | Smoke test con vídeo y audio real. |
| TLN-008 | Persistir tamaño de paneles y layout | HY4 + SWE 2 | Reinicio restaura paneles y window bounds. |
| TLN-009 | Timeline grande no bloquea scroll/edit | HY4 + SWE 2 | Benchmark en proyecto de carga y perfil RAM/CPU.

## 4. Transformación, color, efectos y motion
| ID | Aceptación | Responsable | Evidencia requerida |
|---|---|---|---|
| VIS-001 | Transform, crop, opacity, perspective y PiP | SWE 2 | Preview/export parity y proyecto re-open. |
| VIS-002 | Keying/masks/alpha y blend modes soportados | SWE 2 | Fixtures de referencia y golden images. |
| VIS-003 | Efectos del catálogo se pueden añadir/quitar/parametrizar | HY4 + SWE 2 | UI->schema->renderer E2E por categorías. |
| VIS-004 | Transiciones se editan y renderizan | HY4 + SWE 2 | Duración/alignment exactos y golden render. |
| COL-001 | Primary color, curves, HSL y LUT | HY4 + SWE 2 | Persistencia y frame comparado con export. |
| COL-002 | Waveform/vectorscope/parade/histogram | SWE 2 | Valores del frame de referencia. |
| COL-003 | HDR/color metadata sólo si toda la pipeline lo soporta | SWE 2 | Decode, preview, export, ffprobe y test monitor/proxy. |
| MOT-001 | Keyframes y easing en parámetros del proyecto | HY4 + SWE 2 | Graph interpolation tests y E2E. |
| MOT-002 | Texto, shapes, Lottie y gráficos exportables | SWE 2 | Project editable y render real. |
| MOT-003 | Stickman/rig 2D/partículas si el motor está disponible | HY4 + SWE 2 | Render con ffprobe y re-open del proyecto. |
| MOT-004 | Máscaras/tracking/stabilization si capability disponible | SWE 2 | Modelo/engine check y secuencia de prueba. |
| MOT-005 | Nodos: validar tipos, conexiones, ciclos y ejecución | SWE 2 | Graph model tests y salida real sobre proyecto. |
| MOT-006 | 3D/GLB/Gaussian splats sólo tras decisión y engine POC | SWE 2 | POC aislado, benchmark, license review y UI marcada experimental.

## 5. Audio, texto y localización
| ID | Aceptación | Responsable | Evidencia requerida |
|---|---|---|---|
| AUD-001 | Mixer multipista gain/pan/mute/solo/fades | HY4 + SWE 2 | Medición de audio exportado. |
| AUD-002 | EQ, compression, limiter y ducking | SWE 2 | Audio fixture y loudness/true-peak report. |
| AUD-003 | Denoise/voice isolation cuando engine/model esté disponible | SWE 2 | Before/after escucha y métricas, con limites. |
| AUD-004 | Grabación de voiceover/mic y sincronía | HY4 + SWE 2 | WAV real con metadata/probe. |
| TXT-001 | Transcribir audio/vídeo | SWE 2 | Transcript timecoded y model/engine id. |
| TXT-002 | Editar captions y exportar SRT/VTT/ASS soportado | HY4 + SWE 2 | Round-trip de archivos y estilos. |
| TXT-003 | Traducir captions sin exportar mocks | SWE 2 | Provider live o mock bloqueado explícitamente. |
| TXT-004 | TTS local/remoto crea asset WAV/MP3 real | SWE 2 | Archivo, voice id, metadata y license terms. |
| TXT-005 | Dubbing/diarization/alignment cuando provider lo soporte | SWE 2 | Segment timings y audio result real.

## 6. Producción autónoma, IA y providers
| ID | Aceptación | Responsable | Evidencia requerida |
|---|---|---|---|
| AI-001 | Brief natural se convierte en plan schema-valid | SWE 2 | Fixture de intent y plan validado. |
| AI-002 | Guion y storyboard por escenas editables | SWE 2 + HY4 | Escenas, IDs y prompts persistidos. |
| AI-003 | Plan estima coste y requiere aprobación cuando toca | SWE 2 + HY4 | Cost response y approval event. |
| AI-004 | Generación/edición imagen con provider real disponible | SWE 2 | Archivo, dimensions, model ID, hash y provider test. |
| AI-005 | Generación vídeo con provider real disponible | SWE 2 | Vídeo probeado, job id, duración, costo y metadata. |
| AI-006 | TTS, música y SFX con capabilities del modelo | SWE 2 | Audio real y licencia/provenance. |
| AI-007 | Media analysis: scenes, silence, transcript, subject | SWE 2 | Timecoded results y reproducibilidad. |
| AI-008 | Aplicar plan genera clips reales en el proyecto canónico | SWE 2 | Timeline re-open y undo de batch. |
| AI-009 | Planner regenera escena sin cambiar las escenas aprobadas | SWE 2 | Scene IDs unchanged except target. |
| AI-010 | Provider unavailable/quota/permission/cost errors son visibles | HY4 + SWE 2 | Tests de error y retry controlado. |
| AI-011 | Fallback no cambia modalidad/coste/proveedor sin permiso | SWE 2 | Tests policy de fallback. |
| PRD-001 | Job persiste tras minimizar/ocultar ventana | SWE 2 | Worker continúa sin React montado. |
| PRD-002 | Restart recovery no duplica clips/assets/cargos | SWE 2 | Kill/reopen E2E con idempotency. |
| PRD-003 | Pause/cancel alcanza subprocesses/descargas | SWE 2 | Process tree termina y status persistido. |
| PRD-004 | Quality Gate detiene errores duros y repara limitado | SWE 2 | Repair attempts/cost limit + rerender/review.

## 7. MCP y herramientas de agente
| ID | Aceptación | Responsable | Evidencia requerida |
|---|---|---|---|
| MCP-001 | List tools y schemas no se pierden por tamaño de prompt | SWE 2 | Tool catalog contract tests y truncation behavior. |
| MCP-002 | Exponer plan/create-run/status/cancel/resume/deliverables | SWE 2 | Cliente MCP real invoca cada operación. |
| MCP-003 | Capabilities/status muestran provider/engine real | SWE 2 | health test y state snapshot. |
| MCP-004 | Permissions separan read/edit/download/cloud/render/delete | SWE 2 | Deny tests por scope. |
| MCP-005 | Streamable HTTP moderno sigue versión MCP soportada | SWE 2 | Protocol conformance y auth tests. |
| MCP-006 | Tasks extension sólo si cliente anuncia soporte | SWE 2 | task handle lifecycle, get/update/cancel y opt-in. |
| MCP-007 | STDIO legacy sigue funcionando si la app lo soporta | SWE 2 | initialize compatibility test para clientes legacy. |
| MCP-008 | Tool calls muestran feedback y pueden ser denegados | HY4 + SWE 2 | E2E confirmation/deny de side effects. |
| MCP-009 | MCP server status UI/health/stop/restart | HY4 + SWE 2 | Local server lifecycle test. |
| MCP-010 | No se puede usar MCP para shell libre o salir del project root | SWE 2 | Security tests / path traversal / injection.

## 8. Laboratorio, descargas y export
| ID | Aceptación | Responsable | Evidencia requerida |
|---|---|---|---|
| LAB-001 | Convertir media a un formato realmente soportado | SWE 2 | Output probe, checksum y source preserved. |
| LAB-002 | Comprimir por calidad o tamaño objetivo | SWE 2 + HY4 | Comparación de tamaño/calidad y settings visibles. |
| LAB-003 | Upscale/sharpen/remove background con modelo y licencia comprobados | SWE 2 | Model hash, inference output y capability report. |
| LAB-004 | Compare original/processed | HY4 | Visual comparison y file metadata. |
| REC-001 | Grabar screen/window/region/webcam/mic | SWE 2 + HY4 | File output con streams probados. |
| DL-001 | Media search/download por APIs/fuentes permitidas | SWE 2 | Source URL, license, checksum y términos. |
| EXP-001 | Export MP4 con presets y progreso real | SWE 2 + HY4 | ffprobe, decode test, audio test. |
| EXP-002 | Batch variants sin sobrescribir el source project | SWE 2 | Múltiples outputs con manifest. |
| EXP-003 | Delivery package contiene proyecto y assets según policy | SWE 2 | Reopen y checksum verification.

## 9. UX, sistema y entrega
| ID | Aceptación | Responsable | Evidencia requerida |
|---|---|---|---|
| UX-001 | Todas las vistas actuales están ubicadas en navegación clara | HY4 | Route smoke test para cada ViewId. |
| UX-002 | Ventana nativa es redimensionable y layout persiste | SWE 2 + HY4 | NSIS installed app en 1360x768. |
| UX-003 | Empty/loading/offline/error/blocked/success states existen | HY4 | Component tests y screenshots. |
| UX-004 | Accesibilidad keyboard/focus/contrast | HY4 | Automated + manual keyboard tests. |
| UX-005 | No hay estado de edición decorativo perdido al recargar | HY4 + SWE 2 | Edit->save->reload E2E. |
| SYS-001 | Logs/diagnostics redacted, no secrets | SWE 2 | Secret scanning + test fixtures. |
| SYS-002 | License inventory/notices correctos por release | SWE 2 | npm audit script + manual models/binaries review. |
| SYS-003 | Startup/perf/memory/recovery medidos | SWE 2 + HY4 | Benchmark en PC de referencia. |
| REL-001 | NSIS installer construido e instalado desde el HEAD final | SWE 2 | Installer path, signature status, smoke tests. |
| REL-002 | RELEASE-MANIFEST y SHA256SUMS generados | SWE 2 | Hashes verificados. |
| REL-003 | Guías y reportes incluidos | SWE 2 + HY4 | Archivos del documento 13.

## 10. Reporte de cierre obligatorio

Para cada ID usar una fila:
ID | Estado | Build/HEAD | Fecha | Test/Comando | Evidencia/artefacto | Bloqueo/Limitación | Owner.

No se permite omitir los ID que fallen. Los ítems NOT APPLICABLE deben tener justificación técnica/legal. El estado global sólo puede seguir los estados del documento 13.