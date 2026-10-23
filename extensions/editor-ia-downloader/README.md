# Editor IA — Extensión de navegador

Extensión Manifest V3 para Chrome y Edge. Detecta fotos y videos de la página
actual y los manda a Editor IA, que descarga con yt-dlp y FFmpeg y guarda el
resultado en `Descargas/Videos descargados/<Plataforma>/<Nombre del video>`.

## Instalar

1. Abrí `chrome://extensions` (o `edge://extensions`) y activá **Modo
   desarrollador**.
2. **Cargar descomprimida** → elegí esta carpeta (`extensions/editor-ia-downloader`).
3. Abrí Editor IA → **Inicio** → **Instalar extensión** (copia la carpeta y la
   abre) o, si ya está preparada, **Copiar conexión**.
4. Abrí la extensión, pegá la conexión y pulsá **Conectar**. Es una sola vez.

## Uso

- Con la extensión abierta en una página, elegí una miniatura detectada o usá la
  página completa; después **Analizar** y **Descargar**.
- Clic derecho → **Descargar con Editor IA** funciona en páginas, enlaces,
  imágenes, videos y audio. En una imagen descarga el archivo directo; en video
  usa la página para que yt-dlp elija la mejor calidad.
- La calidad se elige entre las resoluciones reales del sitio (hasta 8K).
- Formatos: MP4, MKV, WebM, MP3 y M4A. La compresión FFmpeg H.264/H.265 se aplica
  al MP4 y sólo reemplaza el archivo si queda más chico.
- Las imágenes se guardan en su resolución original (hasta 100 MB por archivo).
- La app tiene que estar abierta: la extensión no descarga por su cuenta.

## Seguridad y límites

- La extensión sólo habla con `http://127.0.0.1` (puertos 47615–47625). No envía
  URLs, tokens ni archivos a internet.
- El puente local exige un token aleatorio por instalación. El token se guarda en
  el almacenamiento local de la extensión y se puede revocar borrando
  `downloader-bridge.token` de la configuración de la app.
- No evade DRM, captchas, paywalls ni contenido privado. Algunos sitios requieren
  cookies: para eso usá la vista Descargar de la app, que acepta un `cookies.txt`.
- Los carruseles se limitan a 12 elementos desde la app; la extensión manda la
  URL de la página para que la app aplique ese límite.
- Chrome puede pedir confirmación al cargar una extensión fuera de la tienda. La
  extensión no está publicada en la Chrome Web Store.
