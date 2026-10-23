# Estudio de Creación Digital + AI Hub — Visión y backlog

**Fecha:** 2026-10-22
**Estado:** ideas y decisiones, **sin implementar**.
**Relación con el proyecto:** complementa `docs/ROADMAP.md` (Fases 1 y 2 ya
terminadas por WorkBuddy). No reemplaza ese documento ni modifica código.
**Regla:** este archivo es una reserva de ideas para el futuro proyecto; cuando
se decida avanzar, se mergea al ROADMAP y se implementa por fases.

---

## 1. Tesis

Editor IA deja de ser “un editor de video” y pasa a ser el **estudio de creación
digital todo-en-uno**:

- No se enfoca en un nicho (YouTube, shorts, podcasts o clientes): sirve para
  **todo el nicho digital de creación**.
- El centro es el creador y su proyecto, no la plataforma de destino.
- La app integra ideación, assets, edición, empaque, publicación y aprendizaje.
- El chat es la interfaz para operar la app, no un chatbot decorativo.
- Local primero; los servicios web amplifican, no sostienen.
- Free-first: el usuario puede trabajar sin pagar; las APIs de pago son
  opcionales y **cada usuario trae su propia clave**.

## 2. Decisiones confirmadas (2026-10-22)

1. **Sí al camino gratuito:** FreeLLMAPI, Ollama/LM Studio y proveedores
   freemium (Gemini, Groq, OpenRouter, Cerebras, Mistral, Hugging Face).
2. **Sí a BYOK (Bring Your Own Key):** la app **no** incluye ni comparte claves;
   cada usuario conecta las suyas.
3. **No empezar a implementar ahora:** primero mejorar y guardar las ideas.
4. El chat **ejecuta** y devuelve resultados estructurados; no rellena con prosa.
5. Cada capacidad tiene backend **local** y/o **remoto**; sin backend
   configurado, la función se desactiva con el motivo.
6. Nada exige internet para existir. Sin red, la app sigue siendo un estudio
   local funcional.
7. **Entrega, no respuesta:** el chat no contesta con prosa; entrega el video,
   la miniatura, el paquete o el archivo pedido, con ruta, peso y verificación.
8. **Optimización de tokens al máximo absoluto:** análisis local primero, al
   modelo solo lo mínimo; esquemas compactos, estado como diff, IDs numéricos,
   caché de planes y respuestas JSON.
9. **Auto Shorts Studio:** pegar una URL de YouTube o elegir un video local y
   obtener varios shorts verticales con corte, subtítulos, sonido, color y
   empaque, sin editar a mano.

---

## 3. FreeLLMAPI: qué es y cómo se integra

Verificado el 2026-10-22:

- Proyecto: `tashfeenahmed/freellmapi`.
- **MIT** (permite uso comercial del código).
- Proxy local **OpenAI-compatible** (`/v1/chat/completions` y endpoints
  compatibles).
- El repo declara **34 proveedores gratuitos** y “7.4 billion tokens per month”
  como *claim* de marketing; no se toma como garantía.
- Requiere Node 20+ y **claves de proveedores** propias, cifradas con
  AES-256-GCM.
- El README lo declara para **“personal experimentation only”** y sin
  multiusuario.

**Decisión de producto:** no empaquetar FreeLLMAPI ni revenderlo como backend de
la app. Se integra como un **proveedor “OpenAI-compatible”**: el usuario corre
su instancia local y pega `http://127.0.0.1:<puerto>/v1` + su clave. La app
ofrece la interfaz, las herramientas, el consentimiento y la seguridad; el
usuario aporta el endpoint y las claves.

**Consecuencias:**

- Respetar los términos de cada proveedor y sus límites de free tier.
- No eludir rate limits, captchas ni verificaciones.
- La app debe poder usar también Ollama/LM Studio sin FreeLLMAPI.
- Un proveedor caído no rompe el chat: se muestra el error y se ofrece cambiar
  de modelo/proveedor.

---

## 4. AI Hub — arquitectura

### 4.1 Registro de proveedores

Cada proveedor declara:

```ts
type Provider = {
  id: string;
  label: string;
  kind: 'local' | 'freemium' | 'paid';
  protocol: 'openai-compatible' | 'gemini' | 'anthropic' | 'custom';
  baseUrl: string;
  models: ModelInfo[];
  requiresKey: boolean;
  privacyUrl?: string;
  limitsNote?: string;
};
```

La UI muestra tarjetas con: estado de conexión, modelos, free/pago, límites,
privacidad y botón **Probar conexión**. Las claves se guardan en **Windows
Credential Manager** (servicio propio), nunca en el `.editoria.json` ni en
logs.

Proveedores iniciales:

- FreeLLMAPI local (OpenAI-compatible).
- Ollama / LM Studio (local).
- Gemini API (free tier con clave del usuario).
- Groq (free tier).
- OpenRouter (modelos free).
- Cerebras (free tier).
- Mistral (free tier).
- Hugging Face Inference (free/créditos).
- OpenAI / Anthropic (opcionales, pago).

Los límites cambian seguido: la app muestra una nota y un enlace, no un número
hardcodeado que envejece mal.

### 4.2 Router de modelos y tokens

- Router local para intenciones simples (“comprimir este archivo”, “listar
  proyectos”).
- Modelo económico para planes; modelo potente solo para razonamiento complejo.
- Presupuesto por tarea y por sesión, visible.
- Contexto mínimo: solo las tools relevantes a la intención.
- Esquemas compactos: nombres cortos, enums, solo campos obligatorios.
- Estado como **diff**, no el proyecto completo.
- Diccionario de IDs numéricos para medios/clips.
- Caché de planes repetidos.
- Respuestas **JSON** sin prosa; el progreso va por eventos de UI, no por tokens.
- Reintento con otro proveedor si falla, sin duplicar acciones ya confirmadas.

### 4.3 Tool Registry

El chat usa las mismas herramientas que la UI. Primer lote (12):

| Tool | Qué hace | Riesgo |
|---|---|---|
| `project.create` | Crea un proyecto con plantilla | bajo |
| `project.open` | Abre un proyecto | bajo |
| `media.import` | Importa archivos con derechos | bajo |
| `media.probe` | Inspecciona con FFprobe | bajo |
| `download.url` | Descarga de una URL | medio |
| `media.compress` | Comprime con preset | bajo |
| `media.convert` | Convierte formato | bajo |
| `script.generate` | Guion estructurado | bajo |
| `transcript.transcribe` | Transcripción local | bajo |
| `thumbnail.generate` | Miniatura con plantilla | bajo |
| `video.render` | Render MP4 verificado | alto (tiempo) |
| `publish.package` | Arma paquete por red | bajo |
| `jobs.list` | Cola de trabajos | bajo |

Reglas:

- Las acciones destructivas o que gastan créditos requieren **confirmación**.
- `video.render`, `download.url` y cualquier llamada de pago van en **modo
  Plan** por defecto.
- El resultado es estructurado:

```json
{
  "ok": true,
  "actions": [{ "tool": "media.compress", "output": { "bytes": 4200000 } }],
  "artifacts": [{ "path": "D:/.../video.mp4", "bytes": 4200000 }],
  "warnings": [],
  "next": "publish.package"
}
```

La app traduce eso a la UI; el chat no inventa rutas ni pesos.

### 4.4 Modos del chat

- **Agente:** intención → plan → ejecución → resultado.
- **Plan:** muestra el plan y espera confirmación.
- **Consultar:** responde con datos reales del proyecto, sin ejecutar.

El chat puede mostrar la cola de trabajos y el estado de cada tool. No conversa
de más: si el usuario saluda, responde corto y ofrece acciones.

### 4.5 Entrega, no respuesta

El chat **no devuelve prosa**: devuelve un **contrato de resultado**.

```json
{
  "ok": true,
  "request": "3 shorts verticales con subtítulos",
  "artifacts": [
    { "kind": "short", "path": "D:/.../short-01.mp4", "duration": 38.4, "bytes": 12400000 },
    { "kind": "short", "path": "D:/.../short-02.mp4", "duration": 42.1, "bytes": 13800000 },
    { "kind": "short", "path": "D:/.../short-03.mp4", "duration": 29.8, "bytes": 9800000 }
  ],
  "derived": [
    { "kind": "captions", "path": "D:/.../short-01.srt" },
    { "kind": "thumbnail", "path": "D:/.../short-01.jpg" }
  ],
  "metrics": { "lufs": -14.0, "width": 1080, "height": 1920, "fps": 30 },
  "warnings": [],
  "verified": ["ffprobe", "duración", "loudness", "carátula"],
  "next": "publish.package"
}
```

Reglas:

- Si no hay artefacto, no se dice “listo”: se informa el bloqueo exacto
  (falta clave, falta archivo, falta permiso, proveedor caído).
- Cada entrega incluye ruta, peso, duración/resolución y cómo se verificó.
- La UI muestra una **tarjeta de resultado** con “Abrir carpeta”, “Comparar”,
  “Reintentar” y “Crear paquete”.
- Para pedidos creativos (“hacé 3 shorts”), se entregan los 3 archivos, sus
  subtítulos, sus carátulas y un manifiesto; no un texto explicando lo que se
  haría.

### 4.6 Optimización de tokens al máximo

Principio: **el trabajo pesado se hace local; al modelo solo le llega la
decisión**.

- **Análisis local primero:** FFprobe, detección de escenas, silencios, audio,
  transcripción con Whisper local y heurísticas de calidad. El LLM no ve el
  video ni el audio completos.
- **Transcripción por ventanas:** se envía solo el texto alrededor de los
  candidatos (por ejemplo, 30 ventanas de 20 palabras), no las dos horas de
  transcripción.
- **Esquemas compactos:** solo las tools relevantes a la intención; nombres
  cortos, enums y campos obligatorios. Nada de esquemas gigantes.
- **Estado como diff:** se manda qué cambió, no el `.editoria.json` completo.
- **IDs numéricos:** los medios/clips se referencian con IDs cortos, no rutas
  largas repetidas.
- **Router local:** clasificador de intención para comandos comunes (“comprimir
  este archivo”, “listar proyectos”, “hacé shorts”). Solo los pedidos complejos
  van a un modelo potente.
- **Plan cache:** planes repetidos se reutilizan; las plantillas de shorts,
  miniaturas y publicación no se razonan dos veces.
- **JSON sin prosa:** sin explicaciones, sin chain-of-thought visible, sin
  repetir el pedido.
- **Progreso por eventos:** la barra y la cola se actualizan por eventos de la
  app, no consumen tokens.
- **Presupuesto duro:** tokens por tarea, por sesión y por día; al agotarse, la
  app pide confirmación o cambia a local.
- **Métricas:** tokens por artefacto entregado, porcentaje resuelto local y
  aciertos de caché. Se muestran en el AI Hub.

Ejemplo: un video de 2 horas no manda 2 horas de transcripción. Manda 30
candidatos de 20 palabras + sus tiempos; el modelo elige los 5 mejores y la app
corta, reencuadra, subtitula y mezcla localmente.

### 4.7 Privacidad

- Por defecto, **el video y el audio no salen del equipo**.
- Enviar un frame, miniatura o audio a un modelo remoto requiere consentimiento
  por archivo y muestra qué se enviará.
- Claves en Credential Manager; logs redactados.
- Cero telemetría por defecto.
- El usuario puede borrar claves y el historial de chat.

### 4.8 AI Kernel + Skills deterministas

**Objetivo:** que cualquier modelo conectado gaste la menor cantidad posible de
tokens. La app no le pide “pensar” el flujo: le ofrece **skills** (procedimientos
deterministas, versionados y verificables) para que elija y ejecute.

#### Qué es una skill

Una skill no es un prompt: es un **ejecutor + manifiesto compacto**.

```json
{
  "id": "shorts.auto",
  "version": 1,
  "when": "video largo con voz → 3–5 verticales",
  "input": { "asset": "media-id", "count": "1–5", "duration": "15–60" },
  "output": ["video[]", "srt[]", "jpg[]", "manifest"],
  "cost": { "local": true, "tokens": "0–4000" },
  "permissions": ["media.read", "render.write"],
  "fallback": "shorts.scene-only"
}
```

- **Índice de skills:** descripciones de una línea, embeddings locales y
  búsqueda top-3. Al modelo solo se le envían los manifiestos de las skills
  seleccionadas, no el catálogo completo.
- **Dos capas:** skills 100 % locales (comprimir, cortar, transcribir,
  reencuadrar) y skills asistidas por IA (rankear highlights, elegir estilo,
  redactar títulos). El LLM decide; la app ejecuta.
- **Recetas:** una skill puede componer varias. `shorts.auto` = transcribir +
  analizar + rankear + cortar + reencuadrar + subtitular + audio + color +
  exportar. Solo el ranking usa tokens.
- **Versionado y tests:** cada skill tiene ejemplos, anti-ejemplos, precondiciones,
  verificación y fallback. Una skill rota se desactiva, no se “arregla” con otro
  prompt.
- **Permisos:** lectura/escritura/render/publicación declarados. Las skills que
  gastan créditos piden confirmación.
- **Portables:** los mismos manifiestos se exponen como tools MCP para que otros
  agentes usen la app sin aprender su UI.

#### Context packs y presupuesto

- **Context pack** del proyecto: IDs de medios, duraciones, pistas, assets
  faltantes y últimas acciones. 300–800 tokens, no el proyecto entero.
- **Transcripción jerárquica:** resumen por escena y ventanas de texto
  candidatas; nunca la transcripción completa si no hace falta.
- **Estado como diff:** parches de timeline (agregar/mover/recortar/efecto), no
  el JSON completo.
- **IDs numéricos y handles:** `media:12`, `clip:48`, no rutas largas repetidas.
- **Budget manager:** tokens por tarea, skill y sesión; medidor visible; al
  excederse, cambia a local o pide confirmación.
- **Router por perfil de modelo:** ventana de contexto, fiabilidad de JSON,
  visión/audio y costo. El mismo pedido puede ir a un modelo barato o local.
- **Caché:** planes, análisis, transcripciones, embeddings y resultados de
  skills idempotentes.
- **Audit ledger:** cada plan y tool call con idempotency key, para no repetir
  acciones ni caer en loops.

#### Economía de tokens (estimaciones de diseño)

| Tarea | Trabajo local | Tokens al modelo | Por qué |
|---|---|---|---|
| Comprimir | FFmpeg | 0 | determinista |
| Convertir | FFmpeg | 0 | determinista |
| Miniatura | frame + composición | 100–400 | variantes de texto |
| Auto Shorts (2 h) | transcripción, análisis, cortes | 2.000–8.000 | rankear 20–40 ventanas |
| Guion de 60 s | estructura | 800–2.000 | texto |
| Paquete de publicación | validación | 200–600 | metadata |
| “¿Qué tiene este proyecto?” | context pack | 200–800 | resumen |
| Subtítulos | Whisper local | 0 | determinista |

Los números son objetivos de diseño, no promesas: se miden por tarea y se
muestran en el AI Hub.

### 4.9 Studio Brain — aprendizaje local del uso

**Objetivo:** que la app aprenda cómo trabaja el usuario y mejore defaults,
sugerencias y recetas, **sin telemetría, sin subir medios y sin entrenar modelos
con su contenido**.

No es “entrenar una IA”: es **calibración estadística local** con datos
inspeccionables.

#### Señales que puede usar

| Señal | Ejemplo | Tipo |
|---|---|---|
| Explícita | “me gusta este estilo”, “aplicar a futuros proyectos”, rating 1–5 | opt-in |
| Implícita | aceptar/rechazar una sugerencia, deshacer, corregir a mano | local |
| Flujo | secuencia de acciones repetida (silencio → subtítulos → export) | local |
| Resultado | plan de IA vs timeline final, tiempo hasta exportar | local |
| Publiación | qué formato/export eligió, qué miniatura quedó | local |

#### Qué aprende

- **Perfil de estilo:** ritmo de corte, duración media de plano, transiciones,
  estilo de subtítulos, energía musical, LUT/color y tono.
- **Defaults:** formato, fps, pista, micrófono, carpeta de salida, presets de
  compresión y export.
- **Recetas:** si repite una secuencia, ofrece guardarla como receta.
- **Parámetros de skills:** tolerancia de silencio, padding de cortes, longitud
  de subtítulos, cantidad de shorts. Siempre dentro de rangos seguros.
- **Tipo de contenido:** tutorial, vlog, podcast, anuncio, curso, entrevista;
  sugiere plantilla, no encierra al usuario en un nicho.
- **Routing de modelos:** qué proveedor/modelo funcionó mejor por tarea
  (JSON válido, latencia, costo, calidad), con datos locales.
- **Contexto útil:** qué campos del proyecto realmente usa el modelo; poda el
  resto para gastar menos tokens.

#### Arquitectura local

```
acciones del usuario
   → event log local (SQLite/JSONL)
   → extractor de señales
   → preference store (JSON editable)
   → sugerencias / recetas / defaults / parámetros
   → UI muestra “esto aprendí” y permite aceptar, editar o borrar
```

- **Studio profile compacto:** 300–600 tokens con las preferencias relevantes,
  no el historial completo.
- **Confianza y muestras mínimas:** una sugerencia no se aplica con una sola
  acción; se exige repetición y se muestra el motivo.
- **Nunca cambia algo destructivo sin confirmación.** Aprender no es sinónimo de
  actuar.
- **Todo inspeccionable:** ver, editar, exportar, importar y borrar el perfil.
- **Cero red:** el aprendizaje no sale del equipo.
- **Reset de fábrica:** vuelve a defaults sin tocar proyectos.

#### Cold start

- Tres preguntas al inicio (tipo de contenido, ritmo, formato de salida) o
  inferencia después de 2–3 proyectos.
- El usuario puede decir “no aprendas de esto” por proyecto.
- El modo profesional puede desactivar sugerencias y dejar solo defaults.

#### Cómo se mide

- Sugerencias aceptadas vs rechazadas.
- Undo rate después de una acción automática.
- Tiempo hasta exportar (sin inventar números).
- Tokens por artefacto y porcentaje resuelto local.
- Si una sugerencia empeora el flujo, se retira.

#### Ejemplos

- “Siempre quitás silencios y agregás subtítulos” → ofrece una receta de un clic.
- “Siempre exportás 9:16 a −14 LUFS” → propone ese default.
- “Corregís los cortes de IA hacia cortes más largos” → ajusta el padding dentro
  del rango, mostrando el cambio.
- “Usás Groq para planes y Gemini para guiones” → recuerda el routing, sin
  bloquear otros modelos.

### 4.10 Service Registry — MCP de webs y capacidades remotas

La app ya tiene un gestor MCP con sesiones persistentes. Encima de eso se agrega
un **registro de servicios** para que el piloto automático sepa qué puede usar,
cuánto cuesta y con qué fallback.

Cada servicio declara:

```json
{
  "id": "flow.images",
  "capability": "image.generate",
  "protocol": "mcp",
  "auth": "google-session",
  "cost": "credits",
  "rateLimit": "provider",
  "license": "provider-terms",
  "health": "check",
  "fallback": ["stock", "user-assets"]
}
```

Servicios previstos:

- **Flow** para imagen/video vía MCP (ya integrado; requiere sesión de Google y
  créditos).
- **TTS web gratuita** vía navegador/MCP, con handoff humano para login/captcha.
- **TTS local** (SAPI/Piper) como fallback obligatorio.
- **Stock** de imágenes/video con licencia (API oficial cuando exista).
- **Música/SFX** con licencia verificada.
- **Traducción/doblaje**, **upscale**, **quitar fondo** y otras capacidades de la
  Fase 3.

Reglas:

- **API oficial > MCP > automatización de navegador.** No se automatiza una web
  si hay API.
- El usuario aporta su cuenta y sus claves; la app no las incluye ni las comparte.
- Login, captcha o pago se resuelven con **handoff humano**; no se evaden.
- Las credenciales viven en Credential Manager y nunca van al prompt.
- Cada servicio tiene health check, timeout, rate limit, costo y fallback.
- Un servicio caído no rompe el trabajo: se usa el fallback y se informa.
- Los free tiers cambian: se muestran como “según proveedor”, sin garantizar
  disponibilidad.
- Los assets generados guardan procedencia, licencia y hash en el manifiesto.
- Gastar créditos o publicar requiere confirmación explícita.

---

## 5. Creation Hub — todo el nicho digital

La app no se organiza por plataforma; se organiza por **tipo de proyecto**.
Cada plantilla trae pipeline, entradas, salidas y checklist.

| Plantilla | Entradas | Pipeline | Salidas |
|---|---|---|---|
| Video largo | guion, assets, voz | guion → medios → voz → edición → export | MP4 + subtítulos + miniatura + paquete |
| Short / Reel | video largo o idea | corte → reframe vertical → subtítulos → hook | 3–5 verticales |
| Podcast | audio/video | limpieza → capítulos → transcripción → waveform | audio + video + clips + transcripción |
| Curso / lección | guion, pantalla | grabación → capítulos → subtítulos → export | lecciones + materiales |
| Carrusel | texto, imágenes | diseño → variantes → export | PNG/WebP por slide |
| Miniatura | frame/foto | recorte → texto → variantes → validación | 1280×720, 1080×1920, 1080×1080 |
| Imagen | foto o prompt | edición → upscale → export | PNG/JPEG/WebP/AVIF |
| Audio | voz/música | limpieza → loudness → export | WAV/MP3/M4A |
| Documento | guion/notas | plantilla → PDF/Markdown | PDF/MD |

### 5.1 Thumbnail Studio

- **Auto-miniatura:** elige el mejor frame por nitidez, contraste, rostro y
  espacio libre; genera 3 variantes.
- **Recorte:** quitar fondo, separar sujeto, upscale y reencuadre 16:9/9:16/1:1.
- **Texto:** plantillas, fuentes con licencia, contraste automático y zona
  segura por plataforma.
- **Legibilidad móvil:** vista a 320 px; alerta si el texto desaparece.
- **Variantes A/B:** 2–3 miniaturas listas para testear.
- **Comparador:** reutiliza el slider antes/después ya implementado.
- **Export:** 1280×720, 1080×1920, 1080×1080, PNG/WebP, con peso y calidad
  medidos.
- **Sin promesas falsas:** no se promete CTR ni “predicción”; se muestran
  chequeos de legibilidad y contraste.

### 5.2 Brand Kit

- Logo, paleta, tipografías con licencia, tono de voz.
- Lower thirds, intro/outro, watermark, plantillas de miniatura.
- Presets de color y subtítulos de marca.
- Se aplica a miniaturas, videos, carruseles y documentos.

### 5.3 Publishing Kit

- Un paquete por proyecto: master + variantes + miniatura + título +
  descripción + tags + capítulos + subtítulos + créditos + divulgación de IA.
- Validación por red usando las reglas de Cumplimiento.
- Calendario y recordatorios.
- Publicación oficial por API en una fase posterior (OAuth, revisión de apps y
  tokens propios del usuario).

### 5.4 Work Center

- Cola única observable: render, descargas, Flow, conversión, compresión y
  miniaturas.
- Progreso, logs, reintento, cancelación y ruta de salida.
- El chat consulta la cola sin adivinar.

### 5.5 Auto Shorts Studio

**La función estrella del estudio:** pegás una URL de YouTube (propia o con
permiso) o elegís un video local y la app entrega varios shorts verticales con
corte, subtítulos, sonido, color y empaque, sin editar a mano.

#### Entradas

- URL de YouTube (solo contenido propio o autorizado; se respetan los términos
  de la plataforma).
- Archivo local (MP4/MOV/MKV/WebM, etc.).
- Proyecto abierto.
- Opcional: guion o transcripción ya existente.

#### Pipeline automático

| Paso | Qué hace | Dónde corre |
|---|---|---|
| 1. Ingesta | Descarga o importa, confirma derechos y normaliza | Local |
| 2. Sondeo | FFprobe: duración, resolución, fps, códecs, audio | Local |
| 3. Transcripción | Whisper local con timestamps por palabra | Local |
| 4. Análisis | Escenas, silencios, loudness, rostros/sujeto, movimiento, picos de audio | Local |
| 5. Candidatos | Detecta hooks, preguntas, remates, historias y CTA; puntúa ventanas | Local + LLM opcional |
| 6. Selección | Elige 3–5 clips de 15–60 s, con padding y sin cortar palabras | Local |
| 7. Reencuadre | 9:16 con seguimiento de sujeto/rostro y zonas seguras | Local |
| 8. Edición | Jump cuts, punch-ins, b-roll opcional, transiciones, música, ducking | Local |
| 9. Audio | Limpieza, de-esser, compresión, loudness −14 LUFS | Local |
| 10. Color | Balance automático, contraste, saturación; LUT opcional | Local |
| 11. Subtítulos | Palabra por palabra, karaoke, estilo de marca, zona segura | Local |
| 12. Empaque | Carátula, título, descripción, tags y manifiesto por short | Local |
| 13. Export | 1080×1920 H.264/AAC, 30/60 fps, verificado con FFprobe | Local |
| 14. Entrega | Tarjeta con archivos, duración, peso, métricas y advertencias | UI |

#### Modos

- **Auto:** un clic, sin revisar. Entrega 3–5 shorts + subtítulos + carátulas.
- **Plan:** muestra los cortes elegidos y espera confirmación antes de render.
- **Pro:** permite ajustar cada corte, estilo, música y color en el editor.

#### Controles de calidad

- No cortar en medio de una palabra ni de una frase.
- El rostro/sujeto no se sale del encuadre vertical.
- Subtítulos dentro de la zona segura y legibles a 320 px.
- Loudness integrado y true peak medidos.
- Duración y resolución verificadas.
- Música y assets con licencia; sin música sin licencia.
- Sin clips duplicados ni solapados.
- Si falta algo (voz, música, permiso), se informa y se entrega lo que sí se
  pudo hacer.

#### Optimización de tokens en Auto Shorts

- La transcripción, el análisis y el corte corren localmente.
- Al modelo solo se envían **ventanas de texto candidatas** (por ejemplo, 30
  ventanas de 20 palabras con sus tiempos), no el video ni la transcripción
  completa.
- El modelo elige/ordena; la app ejecuta el corte, reencuadre, subtítulos y
  mezcla.
- Resultado: costo de tokens acotado y proporcional a la cantidad de candidatos,
  no a la duración del video.

#### Límites honestos

- Necesita audio con voz para detectar highlights; sin voz, el modo automático
  baja a “cortes por escena”.
- No garantiza viralidad ni vistas.
- Descargar de YouTube requiere derechos y respetar sus términos.
- La música debe tener licencia; la app no incluye un catálogo GPL.
- La primera versión no hace tracking 3D ni multicámara.

### 5.6 Edición eficiente y EDL

Para que la IA edite sin gastar tokens ni romper el proyecto:

- **EDL compacta:** el modelo devuelve decisiones estructuradas (clip, entrada,
  salida, pista, efecto, transición, keyframe), no instrucciones en prosa. La app
  valida y ejecuta.
- **Índice de medios local:** FFprobe, escenas, silencios, transcripción,
  rostros/sujeto, calidad y embeddings. La IA consulta el índice; no “mira” el
  video entero.
- **Resumen de proyecto automático:** duración, pistas, assets, clips, faltantes
  y últimas acciones. Se actualiza solo y se manda como context pack.
- **Parches de timeline:** agregar/mover/recortar/efecto como diff, con
  idempotency key y journal de undo. Nunca se reescribe el proyecto completo.
- **QA local sin tokens:** FFprobe, loudness, duración, resolución, subtítulos en
  zona segura y clips solapados. La IA no verifica lo que la app puede medir.
- **Preview bajo demanda:** se extraen frames o un proxy solo cuando hace falta
  una decisión visual; nunca se sube el video completo.
- **Recetas y lotes:** “aplicá esta receta a 20 videos” se ejecuta local, con
  checkpoints y reanudación.
- **Editar una vez, reutilizar siempre:** una plantilla de shorts, miniatura o
  paquete se guarda como receta versionada y se reutiliza sin volver a razonar.

### 5.7 Edición inteligente (más mejoras)

- **Editar por texto:** el usuario corrige la transcripción y el video se corta
  solo (estilo Descript), sin tocar la timeline.
- **Mejor toma:** elige la mejor toma por audio, rostro, gesto y continuidad;
  muestra por qué.
- **Cortes inteligentes:** detecta frases, silencios, muletillas, respiraciones
  y cambios de escena; corta sin partir palabras.
- **Beat sync:** corta al pulso de la música con detección local.
- **Reencuadre automático:** 16:9 → 9:16/1:1 con seguimiento de sujeto y zonas
  seguras para subtítulos.
- **Color match:** iguala el color entre cámaras/clips con una referencia.
- **Audio inteligente:** limpieza, de-esser, compresión, ducking, loudness y
  separación de voz/música.
- **Subtítulos con estilo:** karaoke, palabra por palabra, estilo de marca y
  legibilidad móvil.
- **B-roll sugerido:** propone stock o clips propios según el guion; el usuario
  acepta o rechaza.
- **Hooks y capítulos:** detecta el mejor inicio y arma capítulos automáticos.
- **QA pre-export:** FFprobe, loudness, subtítulos en zona segura, clips
  solapados y duración; bloquea el export si algo crítico falla.
- **Estilo por referencia:** analiza ritmo, transiciones, subtítulos y color de
  un video de referencia y los aplica como **estilo**, sin copiar assets ni
  contenido.
- **Receta desde timeline:** convierte una edición manual en una receta
  reutilizable.
- **Ramas de versión:** probar dos edits del mismo proyecto y comparar lado a
  lado; quedarse con uno o fusionar.
- **Proxy y render en segundo plano:** editar fluido mientras se prepara el
  proxy o el render.
- **Export consciente del hardware:** NVENC/QSV/AMF cuando estén disponibles,
  con comparación de tiempo/calidad/tamaño.
- **Accesibilidad:** subtítulos, contraste, navegación por teclado y lectores de
  pantalla.
- **Onboarding inteligente:** tres preguntas y una primera edición guiada; el
  modo pro puede saltarlo.

### 5.8 Piloto automático de video (Autonomous Studio)

**La idea:** dar una idea o un brief y que la app entregue un video completo:
guion, voz, imágenes, subtítulos, edición, sonido, color y empaque. Las webs
gratuitas (Flow para imagen/video, TTS web para voz) aportan assets vía MCP; la
app hace la edición.

Ya existe una base: Flow MCP por escena, voz SAPI, auto-edit, subtítulos y
render. Lo que falta es el **orquestador end-to-end**, los adaptadores de voz web,
los quality gates y la reanudación.

#### Pipeline

| Paso | Qué hace | Motor |
|---|---|---|
| 1. Brief | audiencia, duración, formato, tono, marca, plataforma | local + LLM |
| 2. Guion | escenas, hooks, CTA, shot list | LLM |
| 3. Plan de assets | generado vs stock vs propio; costo estimado | local |
| 4. Imagen/video | Flow MCP, stock con licencia o assets del usuario | MCP/API |
| 5. Voz | TTS local primero; TTS web si el usuario lo elige | local/MCP |
| 6. Música/SFX | biblioteca con licencia y ducking | local |
| 7. Montaje | auto-edit: duración por escena, Ken Burns, transiciones, ritmo | local |
| 8. Subtítulos | Whisper local, palabra por palabra, estilo de marca | local |
| 9. Color/audio | grade automático, limpieza, loudness −14 LUFS | local |
| 10. QA | derechos, licencias, subtítulos, loudness, duplicados, consistencia, divulgación IA | local |
| 11. Render | MP4 verificado con FFprobe y perfiles | local |
| 12. Empaque | miniatura, título, descripción, tags, capítulos, variantes, manifiesto | local |
| 13. Entrega | tarjeta con archivos, costo, advertencias y verificación | UI |

#### Modos

- **Draft:** voz local, assets propios/stock, rápido y barato.
- **Standard:** imágenes Flow por escena + voz local + auto-edit.
- **Premium:** Flow imagen/video + voz web + b-roll + variantes.
- **Plan:** muestra el plan, el costo estimado (tokens, créditos, tiempo) y
  espera confirmación antes de gastar.

#### Aprobaciones

- Gastar créditos de Flow o de cualquier servicio.
- Conectar una cuenta externa.
- Descargar de una plataforma.
- Publicar.
- Usar una música con licencia específica.

Nada de eso se hace “solo”: el piloto automático es autónomo en la ejecución
técnica, no en el gasto ni en la publicación.

#### Calidad

- Consistencia de personaje/estilo con referencias, seed y style bible.
- Sin escenas duplicadas ni saltos de aspecto.
- Subtítulos dentro de la zona segura y legibles a 320 px.
- Loudness y true peak medidos.
- Derechos, licencias y procedencia por asset.
- Divulgación de contenido generado con IA.
- Sin suplantación de voz ni de imagen.
- Revisión humana opcional, recomendada antes de publicar.

#### Robustez

- Job ledger con checkpoints, reanudación y **idempotencia** (no regenerar lo
  mismo si ya se pagó).
- Si un servicio falla, fallback local/stock y entrega parcial con advertencias.
- Manifiesto de assets con hash, licencia y proveedor.
- Costo y tokens visibles por trabajo.
- El Work Center muestra el avance y permite cancelar/reintentar.

#### Eficiencia

- El LLM solo interviene en guion, plan y decisiones; la edición, el corte, los
  subtítulos y el render son locales.
- Se cachean prompts, imágenes y planes.
- Se estima el costo antes de empezar.
- Se puede hacer un dry-run sin gastar créditos.

#### Límites honestos

- Las webs gratuitas cambian, bloquean o piden login; no hay garantía.
- Flow requiere sesión de Google y créditos; es un conector de terceros.
- No se evaden captchas, paywalls ni términos de servicio.
- No se garantiza calidad de viralidad ni ausencia de artefactos generados.
- La primera versión no hace publicación automática.

### 5.9 Retention Coach + Policy Guard

Dos sistemas distintos que trabajan juntos: uno ayuda a que el contenido se
entienda y se sostenga; el otro ayuda a cumplir las reglas. **Ninguno promete
viralidad ni garantiza evitar strikes.**

#### Retention Coach

**Entradas:** guion, transcripción, corte rough, miniatura, metadata y formato
destino.

**Análisis local (sin tokens):**

- Primeros 3 segundos: claridad del hook, promesa, ritmo y pattern interrupt.
- Arco: hook → contexto → tensión → payoff → CTA.
- Pacing: cortes por minuto, planos largos, silencios, aire muerto.
- Variedad visual: cambios de escena, B-roll, movimiento, rostro en pantalla.
- Claridad: repetición, jerga, frases largas, promesas ambiguas.
- Subtítulos: legibilidad, zona segura, sincronía.
- Audio: loudness, música, voz, ducking.
- Duración por formato y densidad de información.

**Salida:**

- **Mapa de riesgo de retención** sobre la timeline: zonas lentas, confusas, sin
  payoff o con repetición, con timestamp y motivo.
- Sugerencias concretas: acortar intro, adelantar el payoff, agregar pattern
  interrupt, variar visuales, cerrar un loop abierto, simplificar una frase.
- **Confianza y explicación:** cada sugerencia dice por qué; el usuario acepta o
  rechaza.
- **Story arc checker:** avisa si hay promesa sin payoff o clickbait engañoso.
- **Experimentos:** A/B de hook, título y miniatura; importar métricas opt-in
  para comparar, sin afirmar causalidad.
- **Studio Brain:** aprende qué sugerencias aceptás y ajusta el estilo, sin
  prometer resultados.

No se inventa un “score de viralidad”. Se usan riesgos explicables y tus propias
métricas.

#### Policy Guard

**Preflight en cuatro momentos:** guion, miniatura, metadata y render final.

**Categorías:**

- Copyright: música, clips, imágenes, fuentes y plantillas.
- Marca registrada y trade dress.
- Derecho de imagen, privacidad y consentimiento.
- Divulgación de contenido generado con IA.
- Misinformation y claims médicos, financieros o legales.
- Violencia, acoso, odio, contenido adulto, actos peligrosos y autolesión.
- Menores y contenido sensible.
- Spam, metadata engañosa, engagement bait y contenido reutilizado.
- Políticas de monetización y ad-friendly.
- Reglas específicas de cada plataforma, versionadas y con fecha.

**Salida:**

- Severidad: info / advertencia / bloqueo.
- Ubicación: timestamp, excerpt o frame.
- Motivo y fuente oficial con fecha de consulta.
- Fix sugerido: reemplazar música por una licencia, difuminar contenido sensible,
  agregar contexto o cita, reescribir un claim, ajustar miniatura/título, agregar
  divulgación de IA, pedir consentimiento.
- **Riesgo de strike, riesgo de monetización y riesgo de alcance separados.**

**Reglas duras:**

- **No ayuda a evadir moderación, Content ID ni detección de copyright.** No
  sugiere eufemismos, alteraciones de audio ni “hacerlo indetectable”. Solo
  cumplimiento y sustitución por assets licenciados.
- No es asesoría legal. Casos ambiguos van a revisión humana.
- Las políticas cambian: reglas versionadas, actualización diaria y fallback.
- Si no hay certeza, se muestra la duda; no se inventa un veredicto.

#### Content Intelligence

- Detecta tipo de contenido, audiencia, tono y formato; sugiere un playbook.
- **Qué hacer y qué no** por formato, no por nicho: video largo, short, podcast,
  curso, carrusel, anuncio, miniatura.
- Pilares de contenido, calendario y matriz de reutilización.
- **Experiment ledger:** hipótesis, variante, métrica y resultado.
- Investigación de tendencias con fuentes oficiales/gratuitas, sin scraping
  indiscriminado.
- Loop de performance opt-in: retención y resultados reales, con correlación, no
  causalidad.

#### Arquitectura y eficiencia

- Análisis local primero: transcripción, escenas, audio, visuales y reglas.
- El LLM solo critica ventanas de texto o sugiere reescrituras; no ve el video
  completo.
- Reglas de política en JSON versionado, índice local y fuentes oficiales.
- Cada sugerencia y cada flag se pueden aceptar, rechazar o silenciar; se mide
  el fix rate.
- Nada se publica automáticamente si hay un bloqueo o un caso sensible.

#### Métricas

- Zonas de riesgo corregidas, claridad del hook, pacing, legibilidad de
  subtítulos y audio.
- Flags de política, fixes aplicados, falsos positivos reportados.
- A/B de hook/título/miniatura.
- Tiempo ahorrado y tokens por análisis.
- **No se promete retención, monetización ni ausencia de strikes.**

### 5.10 Denoise Studio — ruido en imagen y video

**Objetivo:** quitar ruido de imagen y video con control fino, vista previa en
tiempo real y render de calidad.

#### Dos niveles, no uno

- **Preview en tiempo real:** aproximación con shader WebGL2 sobre un proxy
  720p/1080p. Es rápida y sirve para decidir, no es el resultado final.
- **Render de calidad:** FFmpeg sobre el archivo original. Es más lento y es la
  referencia que se exporta.

Prometer “neural 4K en tiempo real” en esta máquina sería mentira: el equipo es
Ryzen 5 4600G con iGPU y sin CUDA. El preview real-time va por proxy y shader; el
render pesado va a la cola.

#### Preview

- Shader bilateral/guided + temporal ligero, con fuerza ajustable.
- Proxy 720p/1080p según el clip; 4K se previsualiza con proxy.
- Toggle **Antes/Después** reutilizando el comparador.
- Sliders: luma, chroma, temporal, detalle, grano, deband.
- Si el WebView no expone WebGL2, se desactiva el preview con el motivo y queda
  solo el render.

#### Render

FFmpeg 9.0.1 de esta máquina tiene los cuatro filtros verificados:

| Filtro | Uso | Velocidad | Calidad |
|---|---|---|---|
| `hqdn3d` | Denoise rápido | Alta | Buena |
| `atadenoise` | Temporal, reduce parpadeo | Media | Buena en movimiento |
| `nlmeans` | No local means | Baja | Alta |
| `bm3d` | Block-matching 3D | Muy baja | Máxima |

Presets:

- **Rápido:** `hqdn3d` suave.
- **Equilibrado:** `hqdn3d` + `atadenoise`.
- **Máxima calidad:** `nlmeans` o `bm3d` (cola, no preview).
- **Neural opcional:** modelo de denoise vía ONNX; solo si la licencia del peso
  está auditada y el hardware lo permite. No se promete tiempo real.

#### Controles

- Fuerza luma / croma por separado.
- Temporal vs espacial.
- Preservar detalle y grano artístico.
- Deband y sharpen posteriores.
- Aplicar a un clip, a una selección o a un lote de imágenes/videos.
- Guardar como preset de marca/receta.

#### Calidad y límites

- El preview es una aproximación; el render es la referencia.
- Denoise agresivo borra textura y puede empeorar métricas como VMAF; no se
  promete “mejora” automática.
- El grano intencional y el ruido de película se pueden preservar con el control
  de grano.
- La calidad neural depende del peso y del hardware; auditar licencia antes de
  incluirlo.
- En 4K/8K el render va a la cola; no hay promesa de tiempo real.

#### Audio

La reducción de ruido de audio ya existe con `afftdn`. Quedan voice isolation y
de-reverb como capacidades aparte (Fase 3).

### 5.11 Localization Studio — 8 idiomas, subtítulos y doblaje

**Objetivo:** un proyecto → subtítulos y/o voz doblada en los 8 idiomas base,
preservando tiempos, música, efectos y sentido.

#### Idiomas base (por hablantes nativos)

1. Chino mandarín (`zh-CN`; variante `zh-TW` para tradicional).
2. Español (`es-ES`, `es-MX`, `es-AR`).
3. Inglés (`en-US`, `en-GB`).
4. Hindi (`hi-IN`).
5. Árabe (`ar`; MSA y variantes para TTS).
6. Bengalí (`bn-BD`, `bn-IN`).
7. Portugués (`pt-BR`, `pt-PT`).
8. Ruso (`ru-RU`).

**Extras opcionales:** francés, urdu, indonesio, alemán, japonés, coreano.
La lista es configurable; no se hardcodea un “top 8” único porque depende de si
se cuenta por hablantes nativos o totales.

#### Modos

- **Subtítulos:** traducir y exportar SRT/VTT/ASS o quemar.
- **Doblaje TTS:** reemplazar la voz por una voz sintética en el idioma destino.
- **Doblaje con voz similar:** conversión/clonación de la voz original **solo con
  consentimiento explícito** y consent ledger; nunca suplantar a terceros.
- **Lip-sync opcional:** ajuste visual de labios; pesado y posterior.
- **Multiidioma:** un trabajo por idioma, con audio, subtítulos y metadata.

#### Pipeline

1. Detectar idioma y transcribir con timestamps por palabra.
2. Diarización: quién habla, si hay varias voces.
3. Segmentar subtítulos con CPS y longitud de línea; glosario de marca/nombres.
4. Traducir con contexto; revisión humana opcional; back-translation para QA.
5. Ajustar tipografía por escritura: RTL (árabe/urdu), CJK, devanagari, bengalí,
   cirílico; fuentes OFL con fallback.
6. Exportar subtítulos o quemarlos en el video.
7. Doblaje: elegir voz por idioma/género/tono; time-fit; preservar música/SFX;
   ducking de la voz original; loudness; divulgación de IA.
8. Empaquetar: pista de audio original, pista doblada, subtítulos, metadata y
   manifiesto por idioma.

#### Calidad

- Glosario y nombres propios; números, unidades y moneda.
- Modismos y contexto, no traducción literal.
- Sin desbordes de subtítulos; zona segura y legibilidad móvil.
- RTL y shaping correctos; fuentes con licencia.
- Voz: consentimiento, no suplantación, divulgación de IA.
- El audio original se conserva siempre como pista.
- Revisión humana recomendada en temas legales, médicos o sensibles.

#### Eficiencia

- Se traducen **solo los cues**, no la transcripción completa.
- Glosario + caché por proyecto/idioma.
- Traducción local primero (modelo con licencia auditada); APIs freemium con
  clave del usuario para idiomas difíciles; LLM solo para modismos.
- Costo estimado por idioma antes de ejecutar.
- Un job del Work Center por idioma; se puede cancelar/reintentar.

#### Arquitectura

- Traducción: modelo local con licencia auditada o proveedor freemium/BYOK.
- TTS: Piper local (MIT), adaptadores web con consentimiento, ElevenLabs
  opcional.
- Separación de voz/música: stems con modelo de licencia auditada o mezcla
  original.
- Subtítulos: renderer ASS con RTL/CJK y fuentes OFL.
- Doblaje: time-fit por frase, no por palabra, para no robotizar.

#### Límites honestos

- La calidad de traducción varía; los nombres y chistes necesitan revisión.
- El doblaje sintético no siempre iguala la emoción original.
- El lip-sync es pesado y no estará en la primera versión.
- Los dialectos (árabe, chino, portugués) cambian; se elige locale, no “idioma
  genérico”.
- No es traducción jurada ni asesoría legal/médica.
- Clonar la voz de otra persona sin consentimiento no se permite.

### 5.12 Asset & Template Library con licencias permisivas

**Regla:** MIT/Apache/BSD/ISC/Unlicense para **código**; CC0/CC-BY/OFL para
**assets**. Un repo MIT no vuelve MIT a las imágenes, fuentes, música o
plantillas que incluye. Cada asset se audita por separado.

#### Repos verificados (2026-10-22)

| Repo | Licencia | Uso |
|---|---|---|
| `motion-canvas/motion-canvas` | MIT | Plantillas de motion graphics programáticas |
| `redotvideo/revideo` | MIT | Video programático |
| `mifi/editly` | MIT | Edición declarativa / referencia |
| `lucide-icons/lucide` | ISC/MIT | Iconos |
| `shadcn-ui/ui` | MIT | Componentes de UI |
| `OpenTimelineIO` | Apache-2.0 | Intercambio de timelines, no plantillas |
| `Poly Haven` | CC0 | HDRI, texturas, modelos |
| Google Fonts | OFL/Apache | Fuentes (verificar cada familia) |
| `freesound` | CC0/CC-BY por sonido | SFX (verificar cada archivo) |
| Unsplash/Pexels/Pixabay | Licencia propia, no MIT | Fotos; API/atribución |

**Excluido:** Remotion (licencia no MIT para uso comercial automatizado), GPL/
AGPL, CC-BY-NC, assets de CapCut/Canva y cualquier plantilla sin licencia
verificable.

#### Seed pack inicial

- 20 layouts de miniatura propios (React/SVG), data-driven.
- 10 títulos, lower thirds y end cards con Motion Canvas/Revideo.
- 20 transiciones propias (FFmpeg/shaders).
- 50 iconos Lucide/Heroicons/Tabler.
- 10 fuentes OFL.
- 20 SFX CC0/CC-BY y 10 pistas CC0/dominio público.
- 20 LUTs CC0 o creadas propias.
- 20 fondos/texturas Poly Haven CC0.
- 20 plantillas sociales propias (shorts, carrusel, quote, audiograma).

Todo con placeholders y campos de marca: color, logo, tipografía, texto y
duración. Nada de assets de marca incrustados.

#### Manifiesto y linter de licencias

```json
{
  "id": "thumb.gradient-01",
  "type": "thumbnail",
  "source": "own",
  "author": "Editor IA",
  "license": "CC0-1.0",
  "commercial": true,
  "attribution": false,
  "modified": true,
  "hash": "sha256:…",
  "version": 1
}
```

- CI rechaza assets sin SPDX, sin fuente, con NC/GPL/AGPL o con licencia
  desconocida.
- Genera `THIRD-PARTY-NOTICES.md` y la pantalla de atribuciones.
- Filtros en la biblioteca: uso comercial, atribución, modificación, vencimiento.
- C2PA/provenance para assets generados o editados.

#### UX

- Biblioteca con badges **MIT / CC0 / CC-BY / OFL** y “uso comercial sí/no”.
- Brand Kit aplica paleta, fuentes y logo a cualquier plantilla.
- Template Store para importar/exportar recetas y plantillas propias.
- Nunca se copian plantillas de CapCut/Canva; se construyen equivalentes.

#### Límites

- CC-BY exige atribución; se muestra y se guarda en el manifiesto.
- Los pesos de modelos de IA tienen licencia aparte; se auditan.
- Las APIs de stock tienen rate limits y términos propios.
- Un asset “gratis” no es necesariamente comercial; se verifica.

---

## 6. Backlog por fases

| Fase | Contenido | Prioridad | Depende de |
|---|---|---|---|
| **2.4** | **AI Kernel + Skill Registry + EDL/action DSL** | P0 | Fases 1–2 (hechas) |
| **2.5** | AI Hub + Chat operador MVP + Thumbnail Studio | P0 | 2.4 |
| **2.6** | Creation Hub (plantillas) + Brand Kit + Publishing Kit | P0 | 2.5 |
| **2.7** | **Auto Shorts Studio** (URL/local → 3–5 shorts con todo) | P0 | 2.6 |
| **2.8** | **Studio Brain** (aprendizaje local: estilo, defaults, recetas, routing) | P1 | 2.4 + 2.6 |
| **2.9** | **Piloto automático de video** (idea → video con voz, imágenes, subtítulos y edición) | P1 | 2.7 + Service Registry |
| **2.10** | **Retention Coach + Policy Guard + Content Intelligence** | P1 | 2.5 + 2.8 |
| **2.11** | **Denoise Studio** (preview WebGL + render hqdn3d/atadenoise/nlmeans/bm3d) | P1 | 2.4 |
| **2.12** | **Localization Studio** (8 idiomas: subtítulos y doblaje con consentimiento) | P1 | 2.5 + 2.11 |
| **2.13** | **Asset & Template Library** (MIT/CC0/OFL + manifiesto y linter) | P0 | 2.5 |
| **3** | Capacidades locales/remotas: quitar fondo, upscale, separar voz, TTS, modelos | P1 | 2.4 |
| **4** | Modo guiado/pro, licencia offline, auto-miniatura | P1 | 2.6 |
| **5** | Operador IA completo + Work Center + presupuesto | P1 | 3 |
| **6** | Grabación (pantalla/cámara/mic/teleprompter), XML/EDL, música/SFX, CLIP, robustez | P2 | 3 |
| **7** | Publicación oficial, analítica opt-in, app como servidor MCP, plugin SDK | P2 | 5 |

**Regla:** una fase terminada y verificada (typecheck, tests, build, ejecución
real) antes de abrir la siguiente.

---

## 7. Ideas nuevas para la lluvia (no implementadas)

### Crear y conseguir assets

- Bandeja de ideas: capturar links/notas y convertirlos en guion.
- Generador de hooks y estructura narrativa.
- Banco de música/SFX con licencia y filtros por mood/duración/BPM.
- Stock de video/imágenes con licencia y atribución automática.
- **Asset & Template Library** con repos MIT/ISC/Apache para código y CC0/CC-BY/
  OFL para assets; manifiesto SPDX, linter y atribuciones (5.12).
- Stickers, overlays, LUTs y transiciones de marca.
- Grabación de pantalla, cámara, micrófono y teleprompter con takes.
- Descarga por lote, carpeta vigilada y reglas automáticas.

### Producir

- **Denoise Studio:** preview WebGL sobre proxy + render `hqdn3d`,
  `atadenoise`, `nlmeans` o `bm3d`; luma/croma, temporal, detalle y grano.
- Reframe automático 16:9 → 9:16 con seguimiento de sujeto.
- Quitar fondo, upscale, restauración y expansión de imagen.
- Separación de voz/música (stems) y limpieza de diálogo.
- Doblaje y subtítulos multiidioma.
- Proxies, multicam y timelines anidadas.
- Detección de silencios, muletillas y tomas repetidas (ya hay Director).

### Auto Shorts (ampliación)

- Puntuación de highlights por hook, pregunta, remate, emoción, historia y CTA;
  heurísticas locales + LLM solo sobre ventanas de texto.
- Selección de 3–5 clips con padding, sin cortar palabras y sin solaparse.
- Reencuadre con seguimiento de rostro/sujeto, zonas seguras y fallback a fondo
  desenfocado.
- Subtítulos karaoke con estilo de marca y control de legibilidad móvil.
- Música con licencia, beat sync y ducking automático.
- B-roll opcional desde stock o generado, sin romper el ritmo.
- Carátula y título A/B por short.
- Lote: 10 videos → 30 shorts, con cola y reanudación.
- Cortes específicos por plataforma (Shorts, Reels, TikTok) sin hardcodear la
  marca en el motor.
- Panel de calidad: duración, encuadre, subtítulos, loudness y licencias antes
  de entregar.
- Shorts desde podcast, curso o entrevista, no solo desde YouTube.

### Autónomo

- Idea/brief → video completo con checkpoints y entrega parcial si algo falla.
- Flow por escena, stock con licencia y assets propios; nunca un solo proveedor
  obligatorio.
- Voz local primero; adaptadores de TTS web con consentimiento y fallback.
- Consistencia de voz/personaje con referencias y style bible.
- Música/SFX con licencia, ducking y loudness.
- Auto-edit + Director + Auto Shorts sobre el mismo sustrato.
- QA de derechos, licencias, subtítulos, loudness, duplicados y divulgación IA.
- Job ledger con idempotencia: no regenerar lo que ya se pagó.
- Estimación de costo y dry-run antes de gastar créditos.
- Manifiesto de assets con hash, licencia y proveedor.
- Lote: 10 briefs → 10 videos, con cola y reanudación.
- Aprobación explícita para créditos, cuentas externas y publicación.
- Sin evasión de captchas, paywalls ni términos de servicio.

### Empaquetar

- Thumbnail Studio con A/B y legibilidad móvil.
- Auto-miniatura por frame + texto.
- Kit de publicación por red.
- Carruseles, quote cards, audiogramas, GIF/WebP/APNG.
- Variantes por audiencia y por idioma.
- Marca de agua y modo de prueba.

### Publicar y aprender

- Mapa de riesgo de retención por timestamp y fix sugerido.
- Hook lab: primeros 3 segundos, promesa, pattern interrupt y payoff.
- Story arc checker: promesa → tensión → payoff → CTA, sin clickbait engañoso.
- A/B de hook, título y miniatura; experiment ledger.
- Policy Guard en guion, miniatura, metadata y render, con fuente y fecha.
- Safe rewrite: reemplazar música, difuminar, citar, agregar contexto o
  divulgación de IA.
- Playbooks “qué hacer y qué no” por formato, no por nicho.
- Calendario editorial y recordatorios.
- Publicación oficial con OAuth propio.
- Analítica opt-in para comparar miniaturas/títulos.
- Historial de versiones y comparación de resultados.
- Comentarios por timestamp y paquete de revisión para clientes.
- Aprobaciones y roles (local/LAN, sin nube obligatoria).

### Sistema y robustez

- Recovery tras crash, autosave versionado y undo entre sesiones.
- Proyectos portables con relink de medios.
- Visor y limpieza de caché (proxies, waveforms, miniaturas, modelos).
- Inspector de medios completo (ffprobe).
- Recetas/macros reutilizables y dry-run.
- Accesibilidad: subtítulos, contraste, teclado, lectores de pantalla.
- i18n de la UI.

### Aprendizaje y personalización

- Studio profile visible, editable, exportable y borrable.
- Sugerencias con confianza y muestra mínima; nunca aplicar una sola vez.
- Recetas automáticas a partir de secuencias repetidas.
- Inferencia de tipo de contenido (tutorial, vlog, podcast, curso, anuncio) sin
  encerrar en un nicho.
- Routing de modelos aprendido por tarea, con métricas locales.
- Poda de contexto según lo que el modelo realmente usa.
- Estilo por referencia (ritmo, transiciones, subtítulos, color), sin copiar
  assets.
- Opt-out por proyecto y reset de fábrica.
- Analítica de publicación opt-in para correlacionar estilo con resultados, sin
  afirmar causalidad.
- Perfiles de equipo/cliente en una fase posterior.

---

## 7.1 Segunda ola de ideas (2026-10-22)

Ideas nuevas, después de la primera lluvia. Se priorizan por impacto para un
estudio de creación digital, no por cantidad de botones.

### Publicar y crecer

- **Laboratorio de los primeros 3 segundos:** variantes de hook, pattern
  interrupts, ritmo, texto y movimiento; comparar y elegir.
- **A/B de miniatura y título:** variantes listas para testear; importar
  métricas opt-in y mostrar correlaciones, sin prometer causalidad.
- **Calendario y campañas:** programar entregas, reutilizar contenido y medir
  cadencia.
- **Metadatos por plataforma:** título, descripción, tags, capítulos, end screen,
  hashtags y límites de cada red.
- **Matriz de reutilización:** un video largo → shorts, carrusel, quote cards,
  audiograma, newsletter, blog, hilo de X/LinkedIn, GIF y podcast clip.
- **Analítica post-publicación opt-in:** retención, primeras impresiones,
  rendimiento por formato; solo si la API oficial lo permite.

### Estudio y clientes

- **Modo cliente/estudio:** brief de entrada, brand kit por cliente, paquete de
  revisión con comentarios por timestamp, aprobaciones y entregables.
- **Portal de revisión local/LAN:** link temporal sin nube obligatoria; el cliente
  comenta, no edita.
- **Ramas de versión por cliente:** comparar edits y fusionar cambios.
- **Plantillas de brief:** preguntas guiadas para evitar idas y vueltas.

### Profundidad creativa

- **Motion Graphics Studio:** lower thirds, títulos, end cards, transiciones,
  gráficos de datos, mapas animados, lyrics/quotes y presets de keyframes.
- **Sound Design Studio:** biblioteca de SFX, auto Foley (pasos, whooshes,
  ambientes), de-reverb, aislamiento de diálogo y remix de stems.
- **Multicam/Podcast Studio:** sincronización por audio, corte por hablante
  activo, waveform video, audiogramas, capítulos, show notes y clips.
- **Course/Education mode:** lecciones, capítulos, grabación de pantalla,
  handouts PDF/Markdown y materiales descargables.
- **Localization Studio:** 8 idiomas base (mandarín, español, inglés, hindi,
  árabe, bengalí, portugués, ruso) + extras; subtítulos traducidos, RTL/CJK,
  glosario, doblaje TTS, voz similar con consentimiento, lip-sync opcional y
  variantes por idioma.
- **Audio description:** pista descriptiva para accesibilidad, con TTS y mezcla.

### Inteligencia de assets

- **Búsqueda semántica local (CLIP):** “el clip donde hay una playa”, sin subir
  medios.
- **Duplicados y tomas similares:** detectar, agrupar y elegir la mejor.
- **Puntaje de calidad:** nitidez, exposición, audio, estabilidad y encuadre.
- **Etiquetado automático:** personas, objetos, lugares, acciones y moods.
- **Licencias con vencimiento:** alertar antes de que un asset deje de ser usable.
- **Salud de storage:** duplicados, proxies huérfanos, caché, espacio y modelos.

### Confianza y negocio

- **Provenance/C2PA:** credenciales de contenido, hash, proveedor y divulgación
  de IA en el archivo y el manifiesto.
- **Consent ledger:** consentimiento explícito para voz, imagen y likeness;
  revocable y auditable.
- **Policy audit trail:** regla, versión, fuente, fecha y resultado de cada check.
- **Cola de revisión humana** para casos ambiguos o sensibles.
- **Garantía de no evasión:** la app no ayuda a saltar moderación, Content ID ni
  detección de copyright.
- **Licencia offline + ediciones:** prueba con marca de agua, solo/estudio/equipo,
  activación sin internet.
- **Template/Recipe Store:** importar/exportar recetas, brand kits, plantillas de
  miniaturas y shorts; comunidad en una fase posterior.
- **Command palette + macros:** ejecutar cualquier acción o receta con teclado.
- **Studio Dashboard:** pipeline, calendario, trabajos, storage, licencias y
  rendimiento en un solo lugar.

### Lo que NO agregaría (para no diluir el producto)

- Composición 3D/VFX nivel After Effects.
- DAW completo o mastering profesional.
- Editor de fotos nivel Photoshop.
- Red social propia, marketplace de stock con pagos o CRM/facturación.
- Colaboración en tiempo real estilo Google Docs (sí revisión y ramas).
- Publicación automática sin API oficial y sin consentimiento.

**Criterio:** todo-en-uno sí, pero con **profundidad selectiva**. Se integra o se
exporta lo que no sea el núcleo; no se reescribe Photoshop.

---

## 8. Límites y no-objetivos

- **No** incluir claves gratuitas propias ni compartir una clave entre usuarios.
- **No** revender ni empaquetar FreeLLMAPI como backend de la app; se conecta la
  instancia del usuario.
- **No** eludir rate limits, captchas, verificaciones ni términos de proveedores.
- **No** prometer “8K real” si la fuente no lo tiene; solo upscale honesto.
- **No** prometer “+1000 formatos” como número mágico: se informa la cobertura
  real del build de FFmpeg.
- **No** dependencias GPL/AGPL enlazadas; FFmpeg siempre como proceso externo.
- **No** telemetría ni nube obligatoria.
- **No** enviar medios a un modelo remoto sin consentimiento explícito.
- **No** publicar ni gastar créditos sin confirmación.

---

## 9. Preguntas abiertas

1. ¿La publicación oficial por API es prioridad o alcanza con el paquete listo +
   calendario en la primera versión?
2. ¿Qué plantillas arrancan: video largo + short + podcast + miniatura, o todas?
3. Modelo de cobro: pago único vs suscripción (la tesis local favorece pago
   único).
4. ¿El modo guiado oculta funciones o solo ordena el camino?
5. ¿Qué proveedor gratuito es el default recomendado: Gemini, Groq u
   OpenRouter? (La app debe permitir cambiar.)
6. Coordinación: WorkBuddy sigue activo en el mismo repo; cerrar esa sesión
   antes de implementar para evitar conflictos.

---

## 10. Próximo paso (cuando se autorice)

1. Cerrar/coordinar la sesión de WorkBuddy.
2. Mergear este documento a `docs/ROADMAP.md` como Fases 2.4–2.7.
3. Implementar **AI Kernel + Skill Registry + EDL/action DSL**:
   - manifiestos compactos, índice local y búsqueda top-3,
   - ejecutores deterministas y verificación,
   - context packs, presupuesto y audit ledger,
   - skills iniciales: comprimir, convertir, transcribir, miniatura, auto
     shorts, limpiar audio, reencuadrar, paquete de publicación.
4. Implementar **AI Hub + Chat operador MVP** con:
   - proveedor OpenAI-compatible (FreeLLMAPI/Ollama/LM Studio),
   - Gemini/Groq/OpenRouter con clave del usuario,
   - modo Agente/Plan/Consultar,
   - presupuesto y consentimiento,
   - entrega estructurada (archivos, pesos, métricas).
5. Implementar **Thumbnail Studio** y **Creation Hub** (Fases 2.5–2.6).
6. Implementar **Auto Shorts Studio** (Fase 2.7) sobre ese sustrato: ingesta,
   transcripción local, candidatos, selección, reencuadre, subtítulos, audio,
   color y export verificado.
7. Implementar **Studio Brain** (Fase 2.8): event log local, perfil de estilo,
   recetas, defaults, routing de modelos y presupuesto, con controles de
   inspección, opt-out y reset.
8. Implementar **Service Registry + Piloto automático de video** (Fase 2.9):
   Flow/stock/TTS web con adaptadores, fallback local, aprobaciones, job ledger,
   QA y entrega de video completo.
9. Implementar **Retention Coach + Policy Guard + Content Intelligence** (Fase
   2.10): mapa de retención, story arc, hook lab, reglas versionadas con fuente,
   safe rewrite, no evasión y revisión humana.
10. Implementar **Denoise Studio** (Fase 2.11): preview WebGL sobre proxy y
    render `hqdn3d`/`atadenoise`/`nlmeans`/`bm3d` con control de detalle/grano.
11. Implementar **Localization Studio** (Fase 2.12): subtítulos y doblaje en 8
    idiomas, RTL/CJK, glosario, consentimiento de voz y variantes por idioma.
12. Implementar **Asset & Template Library** (Fase 2.13): seed pack, manifiesto
    SPDX, linter, atribuciones, filtros por uso comercial y C2PA.
13. Verificar con typecheck, tests, build y una prueba real de chat → skill →
    artefacto, midiendo tokens por entrega y aceptación/undo de sugerencias.

---

## 11. Gap analysis — qué falta de verdad (2026-10-22)

### Ya planificado, todavía no implementado

- AI Kernel + Skills + EDL.
- AI Hub + Chat operador.
- Thumbnail Studio.
- Auto Shorts Studio.
- Studio Brain.
- Piloto automático + Service Registry.
- Retention Coach + Policy Guard.
- Brand Kit + Publishing Kit + Work Center.
- Profundidad de edición del ROADMAP: keyframes continuos, multicam, timelines
  anidadas, HDR, voice isolation, texto con forma, track matte, relight.

### Todavía no está ni planificado

1. **Producto vendible:** firma de código, auto-update con rollback, licencia con
   activación offline, modo de prueba, EULA/privacidad, avisos de terceros y
   soporte.
2. **Onboarding real:** “primer video en 5 minutos”, proyectos de ejemplo,
   plantillas con contenido real por formato y ayuda dentro de la app.
3. **Biblioteca de assets real:** música/SFX/stock/fuentes/LUTs/stickers/
   plantillas con licencia verificada y metadatos; acuerdos y atribución.
4. **Model manager y runtime local:** descarga con checksum, licencia de pesos,
   disco, hardware, versiones y fallback.
5. **Profundidad de edición que aún falta:** curvas de velocidad continuas,
   multicam, timelines anidadas, HDR/color management, voice isolation,
   de-reverb, texto con forma/lyrics, track matte/blend modes, smart
   reframe/relight.
6. **Interoperabilidad:** XML/EDL/AAF, migraciones de formato de proyecto,
   proyectos portables con relink.
7. **Publicación real:** apps OAuth propias para cada red, calendario, analítica
   y experimentos; no alcanza con “paquete listo”.
8. **Seguridad y confianza:** proyectos cifrados, sandbox de plugins, permisos
   MCP, defensa contra prompt injection, consent ledger y C2PA.
9. **Escala y rendimiento:** proxies, render en segundo plano, hardware
   encode/decode, render farm LAN, performance a 8K y gestor de caché.
10. **Accesibilidad e i18n:** audio description, lectores de pantalla, RTL y
    traducciones de la UI.
11. **Compañero móvil/web:** captura desde el teléfono y portal de revisión.
12. **Comunidad y marketplace:** template/plugin store, canal beta y soporte.
13. **Operación comercial:** pagos/suscripción, reembolsos, impuestos y modelo
    de cobro; la tesis local favorece pago único.
14. **Calidad de release:** renders dorados, regresión visual, matriz de
    compatibilidad de hardware y reportes de crash opt-in.

### Top 10 para que sea un producto real

1. Firma de código + auto-update + licencia/trial.
2. Onboarding “primer video en 5 minutos” + plantillas reales.
3. Model manager + runtime local.
4. Biblioteca de assets con licencia.
5. Keyframes continuos + multicam + timelines anidadas + HDR.
6. Voice isolation + de-reverb + doblaje con consentimiento.
7. Publicación OAuth + calendario + analítica.
8. XML/EDL/AAF + migraciones y proyectos portables.
9. Seguridad: sandbox, permisos MCP, prompt injection y cifrado.
10. Diagnóstico, crash reports opt-in y versiones de autosave.

**Criterio:** no abrir una fase nueva hasta que la anterior esté verificada y
empaquetada. Un producto de pago se juzga por instalación, estabilidad y soporte,
no solo por cantidad de features.

---

## 12. Paridad CapCut Pro — inventario y qué agregar

**Política:** paridad **funcional**, no copia. Nada de código, assets, iconos,
plantillas ni identidad visual de CapCut. Cada función se implementa con
equivalente propio o dependencia MIT/Apache/BSD, y cada asset entra con licencia.

CapCut Pro (2026) agrega sobre el plan Standard: assets/plantillas premium,
herramientas IA avanzadas con créditos, exportación 4K, sin marca de agua,
almacenamiento en la nube (1 TB), colaboración de equipo y licencias de uso
comercial para ciertos assets. Los detalles cambian por región y plan.

### 12.1 Edición y timeline

| CapCut Pro | Editor IA | Qué agregar |
|---|---|---|
| Multipista, split, trim, ripple, roll, slip, slide | ✅ | — |
| Grupos de clips | ❌ | Grupos y bloqueo |
| Timelines anidadas | ❌ | Nesting con apertura/cierre |
| Multicam | ❌ | Sincronía por audio y corte por ángulo |
| Keyframes (184 tipos inventariados) | 🟡 transform/opacidad/volumen | Más propiedades: color, efectos, texto, máscara, audio |
| Curvas de velocidad | 🟡 rampa de 3 tramos + curva N | Curva continua por frame |
| Reverse, freeze | ✅ | — |
| Máscaras con keyframes, feather, inversión | ✅ | — |
| 9 blend modes | ✅ | — |
| Capas de ajuste | ✅ | — |
| Chroma key | ✅ | — |
| Quitar fondo / matting IA | ❌ | Backend local/remoto (Fase 3) |
| Motion tracking / object lock | ❌ | Tracking de sujeto/objeto |
| Estabilización | ✅ | — |
| Smart reframe | ❌ | Seguimiento de sujeto 16:9→9:16 |
| Frame interpolation | ❌ | 60/120 fps opcional |
| Beauty/retouch | ❌ | Belleza y retoque local |
| Super resolution / upscale | ❌ | ×2/×4 local/remoto |
| Deflicker | ❌ | Reducción de parpadeo |
| Reducción de ruido de video/imagen | ❌ | Denoise Studio (5.10): preview shader + render FFmpeg |
| Importar PR/FCP | ❌ | XML/EDL/AAF (Fase 6) |

### 12.2 Color y efectos

| CapCut Pro | Editor IA | Qué agregar |
|---|---|---|
| Ajustes básicos, HSL, curvas, ruedas | ✅ | — |
| Color match | ✅ | Ampliar a referencia entre clips |
| LUT `.cube` global/por clip | ✅ | — |
| LUT skin | ❌ | LUT específica de piel |
| Smart relight | ❌ | Relight local/remoto |
| Scopes | ✅ | — |
| Filtros/efectos premium | ❌ | Biblioteca de efectos con licencia |
| Transiciones premium | 🟡 dissolve/fade/slide | Biblioteca de transiciones propias |
| Texto 3D y plantillas de título | 🟡 7 plantillas | Biblioteca de títulos y 3D |
| Texto con forma, lyrics, texto en curva | ❌ | Editor de texto con forma |
| Stickers/overlays | ❌ | Biblioteca con licencia |
| HDR / color management | ❌ | Pipeline HDR y perfiles |

### 12.3 Audio

| CapCut Pro | Editor IA | Qué agregar |
|---|---|---|
| Música y SFX premium | ❌ | Biblioteca con licencia y atribución |
| Beat sync | ✅ | — |
| Auto ducking | 🟡 esquema/UI parcial | Flujo completo de ducking |
| Reducción de ruido | ✅ `afftdn` | — |
| Voice isolation / de-reverb | ❌ | Modelo local/remoto |
| EQ, compresor, loudness | ✅ | — |
| Voice effects | ✅ | — |
| TTS | ✅ SAPI/ElevenLabs parcial | TTS local (Piper) y web con consentimiento |
| Clonación de voz | ❌ | Solo con consentimiento y consent ledger |
| Traducción/doblaje | ❌ | Subtítulos multiidioma + doblaje |
| Extracción de audio | ✅ | — |
| Audio de video, fades, mezcla | ✅ | — |

### 12.4 Texto, subtítulos y contenido

| CapCut Pro | Editor IA | Qué agregar |
|---|---|---|
| Auto captions | ✅ Whisper local | — |
| Estilos y animaciones de caption | ✅ | Más estilos de marca |
| SRT/VTT import/export | ✅ | Selector nativo de archivo SRT |
| Traducir subtítulos | ❌ | Localization Studio (5.11): 8 idiomas + RTL/CJK |
| Text-to-speech desde guion | ✅ parcial | Voces y estilos |
| Lyrics / karaoke | 🟡 revelado por palabra | Letras sincronizadas |
| Plantillas de texto y títulos | 🟡 7 | Biblioteca con licencia |
| Fuentes premium | ❌ | Fuentes con licencia |
| Stickers/emoji | ❌ | Biblioteca con licencia |

### 12.5 IA

| CapCut Pro | Editor IA | Qué agregar |
|---|---|---|
| Guion / ideas | ✅ | — |
| Auto captions | ✅ | — |
| Quitar fondo | ❌ | Fase 3 |
| Upscale imagen/video | ❌ | Fase 3 |
| Mejorar video/audio | ❌ | Enhance local/remoto |
| Smart reframe/resizer | ❌ | Fase 2.7/3 |
| Avatar/digital human | ❌ | Evaluar licencia y demanda |
| Text-to-image / image-to-video | 🟡 Flow MCP | Más proveedores con fallback |
| AI music / SFX | ❌ | Generación con licencia o biblioteca |
| AI voice / dubbing | 🟡 TTS | Localization Studio (5.11): doblaje 8 idiomas + consentimiento |
| AI matting / beauty | ❌ | Fase 3 |
| AI script-to-video | ✅ autopilot/factory parcial | Piloto automático 2.9 |
| Créditos IA | ❌ (BYOK) | No copiar: mantener free-first/BYOK |

### 12.6 Assets, plantillas y nube

| CapCut Pro | Editor IA | Qué agregar |
|---|---|---|
| Plantillas premium/trending | ❌ | Template Store con licencia |
| Efectos/transiciones premium | ❌ | Biblioteca propia |
| Stock video/imágenes | ❌ | Integración con APIs oficiales |
| Música/SFX | ❌ | Biblioteca con licencia |
| Fuentes/stickers | ❌ | Biblioteca con licencia |
| 1 TB de nube | ❌ | Sync opcional cifrado, nunca obligatorio |
| Cross-device | ❌ | Companion/web después |
| Colaboración de equipo | ❌ | Revisión LAN + roles (Fase 6) |
| Licencia comercial de assets | ❌ | Metadatos de licencia + C2PA |

### 12.7 Exportación y distribución

| CapCut Pro | Editor IA | Qué agregar |
|---|---|---|
| 4K export | 🟡 canvas hasta 16K; depende de hardware | Presets 4K/60 y hardware encode |
| Sin marca de agua | ✅ (no hay watermark) | Marca de agua solo en modo prueba |
| Prioridad de export | ❌ | Cola y prioridad local |
| 16:9/9:16/1:1 | ✅ | — |
| Compartir a TikTok | ❌ | Publicación OAuth (Fase 7) |
| Publicación programada | ❌ | Calendario y API oficial |
| Analítica | ❌ | Opt-in (Fase 7) |

### 12.8 Prioridad para agregar

**P0 — sin esto se nota el faltante**

1. Presets 4K/60 + hardware encode + cola prioritaria.
2. Biblioteca de assets/plantillas con licencia (música, SFX, stock, fuentes,
   stickers, títulos) — ver 5.12.
3. Quitar fondo + upscale (imagen/video).
4. Texto con forma/lyrics + selector nativo SRT + más estilos de caption.
5. Multicam + timelines anidadas + grupos.
6. Smart reframe + LUT skin + smart relight.
7. Motion tracking/object lock.
8. Voice isolation/de-reverb.
9. PR/FCP import (XML/EDL/AAF).
10. **Localization Studio:** subtítulos y doblaje en 8 idiomas, RTL/CJK,
    glosario y consentimiento de voz.

**P1 — paridad pro**

- **Denoise Studio**: preview WebGL sobre proxy + render hqdn3d/atadenoise/
  nlmeans/bm3d, con control de detalle y grano.
- Beauty/retouch, super-resolution, frame interpolation, deflicker.
- Avatares/digital humans (solo si la licencia y la demanda lo justifican).
- AI music/SFX.
- Team review, roles, comentarios, versiones.
- Sync opcional cifrado y companion móvil/web.
- Publicación OAuth, calendario y analítica.

**P2 — escala y marketplace**

- 1 TB cloud, cross-device, prioridad premium, template/plugin store,
  marketplace de assets, AI credits (no se adopta: seguimos BYOK).

### 12.9 Lo que NO se copia

- Assets, plantillas, efectos, fuentes, stickers, iconos o UI de CapCut.
- El modelo de créditos IA: Editor IA es free-first/BYOK.
- La nube obligatoria: sync opcional, nunca requisito.
- La marca de agua como castigo: solo modo de prueba.
- Prácticas de engagement o publicación que dependan de APIs no oficiales.

**Criterio:** paridad funcional donde el usuario la nota; diferencial propio en
local-first, operador IA, token efficiency, policy guard y compresión verificable.

---

## Fuentes consultadas

- [tashfeenahmed/freellmapi](https://github.com/tashfeenahmed/freellmapi)
- [FreeLLMAPI: One Endpoint for 28 Free LLM Providers](https://betterstack.com/community/guides/ai/freellmapi/)
- [Free LLM API in 2026: 13 Options Ranked and Compared](https://openrouter.ai/blog/tutorials/free-llm-apis-compared/)
- [Free LLM API Tiers (2026): Limits Verified Daily](https://gravity.fast/data/free-llm-api-tiers/)
- [awesome-freellm-apis](https://github.com/open-free-llm-api/awesome-freellm-apis)
- [CapCut Standard vs Pro — comparación oficial](https://www.capcut.com/resource/capcut-standard-vs-pro)
- [CapCut Pro Features in 2026](https://capcutguide.com/capcut-pro-features/)
- [CapCut Desktop Review 2026](https://bigvu.tv/blog/capcut-desktop-review-2026-features-pricing-smart-alternatives/)
- [Motion Canvas (MIT)](https://github.com/motion-canvas/motion-canvas)
- [Revideo (MIT)](https://github.com/redotvideo/revideo)
- [Editly (MIT)](https://github.com/mifi/editly)
- [Lucide Icons (ISC/MIT)](https://github.com/lucide-icons/lucide)
- [OpenTimelineIO (Apache-2.0)](https://github.com/AcademySoftwareFoundation/OpenTimelineIO)
- [Poly Haven (CC0)](https://polyhaven.com/license)
- [Google Fonts licenses](https://fonts.google.com/attribution)
- [Freesound licenses](https://freesound.org/help/faq/)
