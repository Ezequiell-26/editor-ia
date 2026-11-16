# 08 — Grabación, IA y pipeline de export

## Grabación de pantalla (`gravar_tela.js` 996 líneas + `gravar_*` API)

Flujo completo (backend `gravar_tela.pyc` + nativo `captura_*`,
`webcam_*`, `som_pc_*`):

1. `gravar_disponivel` / `gravar_monitores` / `gravar_dispositivos_audio`
   → enumerar fuentes.
2. `gravar_iniciar(monitor_id, dispositivo, modo, camera_id, cursor,
   chroma, som_pc)` → el nativo arranca captura.
3. **`cursor`**: `CursorMouse.pacoteGravacao()` devuelve bitmap BGRA +
   hotspot (px,py) + color de onda + borde + radio de anillo — el motor
   C++ dibuja el cursor estilizado EN la captura (no postproceso).
   Equivalente Olyvia implementado: ASS overlay post-export
   (`cursor_track.rs`).
4. `gravar_webcam_*`: cámara con espejo, chroma key (color + sugerencia
   automática `chroma_sugerir`), molduras de cámara.
5. `gravar_som_pc`: loopback de audio del PC vía WAPAPI (`som_pc_*`,
   `audio_entradas` en el .pyd).
6. `gravar_espera_*`: countdown/preview-frame antes de grabar
   (`gravar_quadro_espera`, `gravar_salvar_espera`) — UX de "preparar"
   antes del record.
7. `gravar_encerrar` / `gravar_cancelar` / `gravar_estado`.

### Diferencia con Olyvia

AlaukCut graba con su motor nativo (captura+webcam+chroma+cursor en un
solo pipeline GPU). Olyvia usa ffmpeg gdigrab/dshow + segundo pase ASS
para el cursor. Funcionalmente equivalente en resultado; distinto en
arquitectura (ellos: tiempo real nativo; Olyvia: ffmpeg + postproceso).

## Agente IA (`agente_ponte.js` 5.498 líneas — el módulo más grande después de timeline)

- **OPS + PROPS_MASC**: catálogo de operaciones que la IA puede pedir
  (editar timeline, máscaras, textos…) con sus propiedades.
- Traduce lenguaje natural → ops de timeline; `porProp`, `r`, `o` helpers.
- Backend `agente.pyc`: conecta CLIs de IA (Claude, Codex…), maneja
  permisos (`_aplicar_bloqueio_opencode`, `_mexer_deny`), genera
  animaciones Hyperframes (`_ver_animaciones`, `_gerar_animacion`),
  transcribe (`_transcrever`), exporta (`_exportar`, `_medir_export`),
  monta timelines (`_montar_timeline`), ejecuta colas (`_rodar_fila`,
  `_plano_da_lista`, `_plano_do_lote`, `_criar_projetos_da_pasta`,
  `_exportar_em_fila`).
- `conversa_ia.pyc`: chat con OpenAI-compatible (modelos, herramientas
  `_ferramentas_openai`, `_conversar_openai`).
- `conversa_terminal.pyc`: terminal IA — instalar/apuntar CLIs
  (`terminal_instalar`, `terminal_apontar`), login por código
  (`terminal_entrar_codigo`), preferencia de modelo/esfuerzo/techo,
  `terminal_enviar`, `terminal_andamento`, `terminal_cancelar`.

## Exportación (`exportador.js` 2.237 + diálogos por formato)

- `exportar_formato.js` (632): diálogo de export MP4 con opciones.
- `exportar_prores.js` (250): ProRes (usa `ffmpeg_prores/prores.exe`).
- `exportar_av1` (backend): AV1 via svtav1.
- `exportar_gif` (backend): GIF via `ffmpeg_gif/gif.exe`.
- `exportar_audio` (backend): audio suelto.
- `exportar_resumo.js`: export con resumen/capítulo?
- `exportar_stream_*`: streaming directo.
- **Prerender/cache**: `prerender_*` + `montagem_*` + `cache_render` —
  render por pedazos con firma (`assinaturas` = hash de inputs+receta);
  `montagem_usar_cache` reusa pedazos válidos → re-export rápido.
  `nativo_pedaco_guardar`, `nativo_juntar_audio`.

## Hyperframes (`hyperframes*.pyc` + panel `animacoes`)

Sistema de **animaciones HTML/CSS/JS → video** dentro del editor:
`hyperframes_listar/renderizar`, anexos (imágenes b64), complemento
(instalable?), variables, fps, formatos, calidad, resolución.
`agente._generar_animacion` los produce. Es su "motion graphics programable".

## Subtítulos (`legendas*.pyc`)

- `gerar_legendas(nome, faixas, traduzir)`: whisper.cpp local
  (`ferramentas/whisper/model.bin` 246 MB) → `trechos_de_fala`,
  `detectar_respiracoes`, `salvar_srt`, `legendas_formato.js` (estilos).
- `marca_texto.js`: marca texto hablado → timing de subtítulos.

## Herramientas externas (`ferramentas/`)

| Binario | Uso |
|---|---|
| `ffmpeg/ffmpeg.exe` + DLLs | Build custom N-125881: nvenc, h264_mf, svtav1, d3d11va |
| `ffmpeg_gif/gif.exe` | Salida GIF dedicada |
| `ffmpeg_mpeg/mpeg.exe` | MPEG |
| `ffmpeg_prores/prores.exe` | ProRes |
| `whisper/` (model.bin+tokenizer) | whisper.cpp → subtítulos/diarización |
| `rife/rife-ncnn-vulkan.exe` + `rife-v4.6` | Interpolación de frames (RIFE) |
| `rastreio/face_detection_yunet_2023mar.onnx` | YuNet detección de rostros |
| `segpessoa/mp_paisagem.onnx`, `mp_quadrado.onnx` | MediaPipe segmentación persona (paisaje/cuadrado) |
