# KNOWN-LIMITATIONS — Olyvia 0.2.0

Estado honesto al 2026-11-09. Nada de lo siguiente está simulado: son límites
reales del sistema.

## Instalador

- El NSIS se instaló y verificó en modo silencioso a carpeta temporal
  (recursos completos + exe responde). No se probó el asistente gráfico ni
  una instalación en la ruta por defecto del usuario.

## Motor autónomo de producción

- El driver de producción corre **dentro del proceso de la app**: ocultar la
  ventana no lo detiene, pero **cerrar la app sí**. No hay servicio residente.
- Al reiniciar la app, corridas `running` se reconcilian a `paused`
  (nunca auto-reanuda trabajo pesado).
- Límite de 2 drivers concurrentes; avance serializado por corrida.

## Providers / IA

- Generación remota implementada: **imagen** (OpenAI-compatible
  `/images/generations`) y **voz TTS** (OpenAI-compatible `/audio/speech`,
  BYOK con keyring, convención `remote:`/`remote:<voz>`). Vídeo y música
  remotos pendientes — hoy son locales (SAPI, ffmpeg, archive.org).
- `production_plan_from_text` requiere un provider de chat configurado
  (BYOK); sin él falla honestamente, no simula interpretación.
- `faster-whisper` no instalado → subtítulos por IA bloqueados (SAPI/ffmpeg sí).
- Generación remota con `costCents: null` cuando la API no informa precio;
  endpoint remoto exige `maxCostCents > 0` en el plan.

## Calidad

- El quality gate valida el documento **y el MP4 renderizado** (resolución,
  duración vs timeline, loudness LUFS, pix_fmt/tags de color). Existe un
  repair loop acotado (máx. 2 intentos) que repara mecánicamente rangos de
  clips fuera de rango, **re-adquiere assets de Internet Archive cuyo
  archivo falte en disco** y **regenera localmente los assets generados
  por providers sin red** (voz SAPI, música/tarjetas/patrones ffmpeg —
  determinísticos, mismo path) — todo sin re-gastar providers remotos —
  y re-ejecuta render+review si el gate queda verde; el resto de hallazgos
  (loudness, color, assets no recuperables) quedan `failed` con el
  hallazgo explícito — no se repara a ciegas.
- Assets generados remotamente quedan marcados `provider-terms`/`unknown` para
  revisión de derechos.

## Entorno de build (solo dev)

- `node_modules` del worktree es propio (`npm ci`, mismo lockfile): los
  packages `@editor-ia/*` resuelven localmente y no pueden repuntar al
  repo hermano.
- `tauri build` debe correrse desde la raíz con `npm run tauri:build`
  (sin el wrapper faltan FFMPEG_DIR / CARGO_HOME / MSVC).
