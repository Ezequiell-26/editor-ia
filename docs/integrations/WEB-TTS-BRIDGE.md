# Web TTS Bridge — automatización de webs de voz

**Estado:** primera versión, 10 tests Node. Probada con fixtures DOM, **no contra una web china real** porque todavía no hay una URL concreta.  
**Código:** `extensions/web-tts-bridge`.

## Qué hace

Extensión Chrome MV3 que acompaña a Editor IA. En una pestaña HTTPS que el usuario abre y autoriza:

1. Pide permiso **solo para ese origen** (`optional_host_permissions`, sin `host_permissions` global).
2. Inyecta el content script.
3. Busca un cuadro de texto visible (textarea, contenteditable o input).
4. Escribe el texto y dispara `input`/`change`.
5. Busca un botón de generar/sintetizar por nombre accesible en chino o inglés:
   `生成`, `合成`, `转换`, `开始`, `朗读`, `播放`, `试听`, `创建`, `配音`,
   `generate`, `synthesize`, `convert`, `speak`, `start`.
6. Espera hasta 120 s a un `<audio src>`, `<source src>` o enlace de audio.
7. Descarga el audio a `Descargas/web-tts/` con `chrome.downloads`.
8. Devuelve un estado estructurado al panel lateral.

No depende de un selector CSS fijo: usa heurísticas y devuelve diagnóstico si no puede nombrar el control. Si encuentra login, captcha, pago o suscripción, **se detiene**; no los evade.

## Instalación

1. Abrí `chrome://extensions`.
2. Activá **Modo de desarrollador**.
3. **Cargar descomprimida** → elegí `D:\Users\ofici\QODER-WORK\editor-ia\extensions\web-tts-bridge`.
4. Abrí una web de voz en una pestaña HTTPS.
5. Hacé clic en el icono de **Web TTS Bridge** para abrir el panel lateral.
6. Pegá el texto y pulsá **Generar y descargar**. La primera vez Chrome pide permiso para ese sitio.

El audio queda en `Descargas/web-tts/`. Después importalo en **Editor IA → Medios** con “Importar medios…”.

## Seguridad y límites

- **Sin credenciales**: la extensión no lee cookies, tokens ni campos de contraseña; no inicia sesión.
- **Sin captcha/pago**: detecta `验证码`, `人机验证`, `请先登录`, `sign in to continue`, iframes de captcha y palabras de pago; devuelve `blocked`.
- **Permisos mínimos**: `sidePanel`, `storage`, `downloads`, `scripting`, `activeTab`; host opcional `https://*/*` solicitado por sitio, no declarado globalmente.
- **Sin servidor ni analytics**.
- **Solo top frame**: si el generador vive en un iframe, la versión actual no lo atraviesa.
- **Heurística**: webs que generan audio por WebSocket/canvas sin `<audio>` ni enlace descargable pueden fallar; en ese caso devuelve error, no inventa éxito.
- **Términos de la web**: el usuario debe respetar los términos, cuotas y licencias de cada servicio. La extensión no evade límites gratuitos ni paywalls.

## Tests

```bash
npm run test:web-tts
```

Cubren: input chino vs. buscador, escritura con eventos, botón generar vs. login/descarga/video, descarga, audio, login/captcha, espera y nombres de archivo seguros.

## Próximo paso

Con una URL real se puede añadir un **adaptador específico** (selectores/estados de esa web) y un smoke en Chromium. La app todavía no importa automáticamente desde `Descargas/web-tts`; por ahora el archivo se importa desde Medios.
