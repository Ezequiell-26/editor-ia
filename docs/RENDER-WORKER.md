# Render worker backend

Fecha: 2026-10-31. El worker de render dejó de ser un contrato sin pipeline:
ahora ejecuta el **mismo motor FFmpeg de la app** sin abrir la UI ni el
WebView, y el paquete `apps/render-worker` lo usa como renderer real.

## Piezas

- `apps/desktop/src-tauri/src/bin/olyvia-render-worker.rs` (`olyvia-render-worker.exe`):
  carga un `.editoria.json`, elige un perfil por resolución/códec, expande
  compuestos, arma el plan y ejecuta FFmpeg de forma síncrona. Imprime un JSON
  por stdout (`ok`, `bytes`, `durationSeconds`, `width`, `height` o `code` +
  `message`) y progreso por stderr. Códigos: `INVALID_REQUEST`,
  `PROJECT_FILE_MISSING`, `RENDERER_UNAVAILABLE`, `RENDERER_UNIMPLEMENTED`,
  `OUTPUT_WRITE_FAILED`, `OUTPUT_TOO_SMALL`.
- `apps/render-worker`: el protocolo `editor-ia.render/1` ahora tiene
  `RENDERING_IMPLEMENTED = true`. `requestRender` exige un runner y un
  verificador; sólo responde `completed` después de comprobar el archivo real
  con `verifyRenderedOutput` (existencia y bytes mínimos por perfil).
- El CLI del worker acepta `--project-root`, `--renderer`, `--ffmpeg` y
  `--ffprobe`; resuelve proyecto/salida dentro del root y rechaza traversal.

## Uso

```bash
printf '%s' '{"requestId":"<uuid>","protocolVersion":"editor-ia.render/1",
"projectPath":"proyecto.editoria.json","outputPath":"render.mp4",
"profile":"mp4-h264-1080p-16x9","requestedAt":"2026-10-31T20:00:00.000Z"}' |
node --experimental-strip-types apps/render-worker/src/index.ts \
  --project-root "C:/ruta/al/proyecto" \
  --renderer "target/debug/olyvia-render-worker.exe" \
  --ffmpeg "target/debug/ffmpeg/ffmpeg.exe" \
  --ffprobe "target/debug/ffmpeg/ffprobe.exe"
```

## Verificación real

Proyecto de capítulos (2 clips, 10 s de timeline) renderizado sin la app
abierta:

- Resultado del protocolo: `status:"completed"`, `outputPath:"worker-node-test.mp4"`,
  verificación `passed:true`, **6.200.464 B**.
- Salida: **1920×1080, 10,0 s, H.264+AAC**, `durationMs` **3.673**.
- Prueba directa del binario Rust: mismo MP4 de **6.200.464 B** en 3,7 s.
- Suite: **234 archivos / 1.783 tests**; worker **23 tests**; typecheck raíz
  verde.

## Límites

- Un render por proceso; la cola persistente sigue viviendo en la UI (el
  worker acepta un pedido por stdin).
- Los clips gráficos requieren `motion_ass` y aún no se aceptan en el worker;
  el pedido falla con código en vez de inventar un render.
- Perfiles soportados: `mp4-h264-1080p-16x9`, `mp4-h264-vertical-9x16` y
  `webm-vp9-1080p-16x9`; el proyecto debe traer un perfil compatible.
- No descarga ni instala FFmpeg: se pasan rutas explícitas o se buscan junto al
  binario (`ffmpeg/ffmpeg.exe`).
