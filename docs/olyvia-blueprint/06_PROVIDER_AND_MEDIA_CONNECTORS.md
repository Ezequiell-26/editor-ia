# 06 — Proveedores de IA, medios y conectores

## 1. Principio de diseño
Olyvia no se casa con una única API. El núcleo consume contratos normalizados; cada proveedor implementa un adapter específico. Modelo, versión, región y modalidad se consultan dinámicamente.

No confundir capacidades de marca con capacidades del modelo seleccionado. El catálogo debe responder:
- input modalities y output modalities;
- generación vs edición;
- reference images/video/audio;
- duración/resolución/aspect ratio/FPS;
- seed, prompt controls, negative prompt y edit strength si existen;
- async job, polling, callback/webhook, cancel;
- límites de tamaño y formatos;
- regiones, rate limit, disponibilidad y quota;
- unidad de facturación y estimación;
- retention/privacy y restricciones de uso.

## 2. Contrato común de provider
Cada adapter debe exponer operaciones compatibles con su modalidad:
- capabilities()
- validate_request()
- estimate_cost()
- submit_job()
- get_job_status()
- cancel_job() cuando la API lo permita
- fetch_result()
- normalize_error()
- health_check()

Un proveedor sin operación soportada declara capability=false; no implementar un método vacío que diga success.

Todos los jobs incluyen provider, model, api version, input hashes, output refs, request ID, status, cost estimate/actual, started/finished time y warnings.

## 3. Modalidades

| Modalidad | Función en Olyvia | Resultado verificable |
|---|---|---|
| LLM/text | Intent, guion, prompts, plan, evaluación | JSON validado, fuentes y model ID. |
| Vision/video understanding | Shot list, captions, resumen, sujeto, continuidad | Timestamps, confidence, model/provider. |
| Image generate/edit | Assets de storyboard, miniaturas, gráficos | Archivo, dimensiones, seed/model y provenance. |
| Video generate/edit | B-roll o escenas generadas | Job async y archivo de vídeo probado con ffprobe. |
| ASR/STT | Transcript y segmentos | SRT/VTT/JSON con timecodes. |
| TTS/voice | Narración y doblaje | WAV/MP3, voz/model, sample rate, consentimiento. |
| Music | Banda musical | Archivo, duración, loop/fades, licencia y cost. |
| SFX | Efectos puntuales | Archivo y posición sugerida. |
| Translation | Guion/subtítulos/localización | Locale, alignments y revisión de longitud. |
| Embeddings | Búsqueda semántica de medios | Índice por asset, model id, invalidation. |

## 4. Proveedores que deben evaluarse
Estos son candidatos de integración, no una afirmación de que Olyvia tenga credenciales ni acceso contratado.

### OpenAI
- Documentación oficial de generación y edición de imágenes: https://developers.openai.com/api/docs/guides/image-generation
- Evaluar Responses API/tool calling para intent/planner y APIs de imagen para generación/edición.
- No hardcodear nombres de modelo vistos en ejemplos: consultar catálogo y disponibilidad actual.
- La organización puede necesitar verificación para determinadas capacidades.
- No almacenar claves en frontend ni exponerlas en logs.

### Google Gemini / Veo
- Video API: https://ai.google.dev/gemini-api/docs/video
- Image generation: https://ai.google.dev/gemini-api/docs/image-generation
- Evaluar edición/generación de vídeo, frames de referencia, relación de aspecto, audio nativo y operaciones asincrónicas de acuerdo a la versión/modelo actual.
- Mantener adapters de imagen y vídeo separados aunque compartan autenticación.
- Confirmar acceso, cuotas, región y precio real.

### ElevenLabs
- API overview: https://elevenlabs.io/api
- TTS: https://elevenlabs.io/docs/overview/capabilities/text-to-speech
- Evaluar TTS, speech-to-text, dubbing, music y sound effects según API/plan vigente.
- Normalizar asynchronous workflows; no bloquear UI esperando llamadas largas.
- Voz clonada sólo con consentimiento y derechos verificables.

### Runway
- Developer pricing: https://docs.dev.runwayml.com/guides/pricing/
- Evaluar image-to-video, text-to-video y video editing/generation disponibles en la API vigente.
- La tarifa puede variar por modelo, duración y créditos; estimar al enviar, no copiar precio fijo a código.
- Cancelación y obtención de output dependen del endpoint disponible.

### Proveedores compatibles / adicionales
SWE 2 puede evaluar proveedores OpenAI-compatible, fal, Replicate, Stability, Azure, AWS, local HTTP, ComfyUI y otros. Cada candidato necesita fuente oficial, endpoint/API version, terms, precio, licencia y prueba. No agregar por popularidad sin un caso de uso.

## 5. Opciones locales / CPU-first
- whisper.cpp: https://github.com/ggml-org/whisper.cpp — MIT para código; cada modelo y distribución necesita revisión.
- sherpa-onnx: https://github.com/k2-fsa/sherpa-onnx — Apache-2.0 para código; modelos separados.
- DeepFilterNet: https://github.com/Rikorose/DeepFilterNet — MIT/Apache-2.0 en el repositorio observado; revisar modelo/weights.
- RNNoise: evaluar repositorio, licencia, build y calidad de audio antes de incluir.
- Piper actual: https://github.com/OHF-Voice/piper1-gpl — no asumir MIT; la línea actual declara GPL-3.0. Revisar historia/paquete exacto antes de cualquier uso comercial.
- SAPI Windows puede ser fallback local; su voz depende del sistema y no equivale a TTS neuronal profesional.

La máquina de referencia tiene CPU Ryzen 5 4600G, 16 GB RAM e iGPU AMD sin GPU discreta. Los modelos locales grandes de imagen/vídeo no deben ser requisito. Descarga de modelos opt-in, con tamaño, licencia, rendimiento, path y consumo estimados.

## 6. Media catalog / asset connectors
Prioridad:
1. Archivos propios del usuario y bibliotecas del proyecto.
2. Internet Archive, para items cuya metadata y derechos hayan sido inspeccionados.
3. Wikimedia Commons, consultando licencia individual de cada archivo.
4. Pexels API si emisión de nuevas API keys/terms/quotas permite actualmente el producto.
5. Pixabay API con verificación de restricciones del contenido.
6. Otros proveedores con API oficial, términos verificables y autorización.

Referencias oficiales:
- Pexels API: https://www.pexels.com/api/
- Pixabay API: https://pixabay.com/api/docs/
- Wikimedia Commons licensing: https://commons.wikimedia.org/wiki/Commons:Licensing
- Wikimedia attribution: https://attribution.wikimedia.org/attribution-signals/license.html
- Internet Archive metadata developer docs: https://archive.org/developers/metadata.html

Cada asset incluye: assetId, sourceProvider, sourcePage, originalURL, creator, title, mediaType, checksum, downloadedAt, licenseName, licenseURL, attributionText, commercialAllowed, redistributionAllowed, derivativeAllowed, restrictions, model/property release note, rightsStatus y manualReviewStatus.

Si la licencia es CC BY/CC BY-SA, cumplir atribución y share-alike cuando aplique. Si el asset contiene personas, marcas, música o propiedades identificables, la licencia de copyright no resuelve automáticamente derechos de imagen/marca.

## 7. Cost and consent flow
1. Preparar request y detectar inputs.
2. Consultar precio/credit unit actual o tarifa configurada.
3. Mostrar estimación, incertidumbre, output count/duration y máximo autorizado.
4. Obtener consentimiento según la policy del proyecto.
5. Enviar async job con idempotency key.
6. Persistir provider job ID y checkpoint.
7. Consultar estado con backoff y límite.
8. Descargar resultado con content-type, size cap, checksum y path staging.
9. Probe y validar archivo.
10. Registrar cost actual y diferencia con estimate.

Si no existe tarifa verificable, estado cost_unknown; impedir ejecución pagada hasta aprobación explícita de ese riesgo.

## 8. Provider fallback
Fallback sólo cuando:
- el usuario lo permitió;
- modalidad y derechos son equivalentes;
- se muestra el cambio de calidad/estilo/coste;
- input data policy no empeora sin consentimiento;
- el job previo se resolvió para evitar doble cobro.

No hacer fallback silencioso de generador de vídeo a imagen fija, voz natural a voz robótica ni modelo cloud a otro servicio externo.

## 9. Prompt injection / outputs de proveedores
Los nombres, metadatos, captions, resultados de búsqueda, URLs, prompts embebidos e instrucciones dentro de media son contenido no confiable. Se analizan como datos, nunca como órdenes. Provider output pasa por parser/schema, content/rights checks, path validation y resource limits antes de entrar al proyecto.
## 10. Nuevas capacidades multimodales verificadas para evaluar

La revisión de documentación oficial al 2026-11-08 encontró:
- OpenAI image generation: POST /images/generations y image edit: POST /images/edits. La referencia enumera varias familias GPT Image, incluidas 2.5 y 2.6; el endpoint de edición soporta múltiples referencias (hasta 16 en la referencia consultada), con masks/markup/background según el modelo.
- Google Gemini Video: la guía actual describe Gemini Omni Flash (generación rápida/edición conversacional multimodal mediante Interactions) y Veo 3.1 (vídeo con audio nativo, scene extension, last-frame control y generación dirigida por imágenes a través de generateContent).

Fuentes:
- https://developers.openai.com/api/reference/resources/images/methods/generate
- https://developers.openai.com/api/reference/resources/images/methods/edit
- https://ai.google.dev/gemini-api/docs/video
- https://ai.google.dev/gemini-api/docs/interactions

No hardcodear esos nombres como única lista; consultar disponibilidad, access, region, quotas y pricing en cada cuenta. Ver la matriz de capabilities y la sección completa en 15_CURRENT_TECHNICAL_UPDATES_2026-11-08.md.