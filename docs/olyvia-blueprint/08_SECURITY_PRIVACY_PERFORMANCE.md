# 08 — Seguridad, privacidad, licencias y rendimiento

## 1. Threat model
Olyvia procesa contenido externo, scripts, URLs, nombres de archivo, medios y respuestas de modelos, además de lanzar procesos multimedia. Los principales riesgos:
- ejecución de comandos o shell injection;
- path traversal, symlink escape y escritura fuera de proyecto;
- archivos multimedia malformados o con parser vulnerabilities;
- SSRF desde conectores y redirects;
- prompt injection en subtítulos, OCR, metadata, documentos y páginas;
- filtración de API keys, prompts o medios privados;
- cargos no consentidos o jobs duplicados;
- rights/licensing violations;
- crash, disk exhaustion y memory exhaustion;
- permisos excesivos en MCP/Tauri;
- outputs falsos o no verificados.

## 2. Claves y secretos
- Usar el keyring seguro existente de Windows/OS.
- Nunca guardar claves en React state persistente, localStorage, project files, prompts, manifests, logs, telemetry ni screenshots.
- La UI puede indicar configured/connected sin volver a revelar valor.
- Importar/exportar settings excluye secretos por defecto; ofrecer migración segura si se necesita.
- Redactar Authorization headers, query tokens y provider errors antes de loguear.
- Permitir rotación/revocación y mostrar provider id y fecha de último test.

## 3. IPC, filesystem y procesos
- Tauri capabilities y permissions de mínimo privilegio por window/webview.
- Cada command valida en backend user/project scope, path canonicalizado, size, enum, time range y permissions.
- El LLM nunca genera argumentos shell libres.
- Ejecutar procesos desde binarios fijados y allowlist de flags; argumentos separados, sin construir un string de shell.
- Configurar cwd aislado, env mínimo, timeout, stdout/stderr caps, process tree termination y temp root.
- No seguir symlinks fuera de project root.
- Validar rutas de archivos y nombres de zip entries; rechazar ../, ADS, device names y paths UNC donde no correspondan.
- Descargas usan DNS/redirect/IP validation, bloquean localhost, link-local, RFC1918 y metadata endpoints cuando la tarea no los requiera.
- Validar tamaño máximo por tipo, content-type, magic bytes, hash y quota de disco.
- Escribir archivos temporales y rename atómico, no truncar originales.

## 4. MCP tool security
- El servidor valida permisos en cada invocación; las tool annotations no son enforcement.
- Separar scopes: read project, edit project, download, cloud generate, render/export, publish, delete/restore.
- Read-only tools deben ser read-only de verdad.
- Acciones de costo, descarga externa, sobreescritura y export se muestran antes de ejecutar según policy.
- Para herramientas de alto riesgo requerir confirmación y/o approval token con scope/job id.
- Output schema estricto y max length; no propagar secrets ni stack traces.
- Remote MCP por HTTPS, autenticación/autorización estándar actual, audience/scope y rotation; no aceptar bearer token en query params.
- STDIO process y env vars sólo heredan secretos estrictamente necesarios.

## 5. Prompt injection y contenido no confiable
- Instrucciones contenidas en media, metadata, subtitles, web pages y provider outputs son datos, no instrucciones del sistema.
- Separar system policy, user brief y retrieved content.
- Respuestas del LLM pasan por schema validation, allowlists y policy engine.
- No autorizar downloads, compras, publicación, filesystem writes ni comandos porque un asset o web page lo indique.
- Guardar source provenance para claims externos de guion.
- En vídeos educativos/documentales, distinguir hecho, opinión, inferencia y fuente.

## 6. Derechos y licencias
- Derechos se registran por asset y por versión.
- Guardar autor, fuente, URL de la página, licencia, versión, attribution, fecha de consulta, commercial use, derivative works, redistribution y releases conocidos.
- No marcar como commercial-safe si hay derechos de persona, marca, música o propiedad pendientes.
- El usuario confirma derechos de material propio cuando es razonable.
- Assets CC BY requieren atribución; CC BY-SA puede añadir share-alike; CC0/public domain debe verificarse por jurisdicción y origen.
- No redistribuir stock original como biblioteca de descargas.
- Mantener SPDX/license inventory y THIRD-PARTY-NOTICES por build.
- Auditar código, binarios, plugins, models, weights, voices, datasets, fonts y templates por separado.
- Remotion no es licencia permisiva universal. Piper actual no debe considerarse MIT sin verificación. FFmpeg/GStreamer requieren revisar build/plugins específicos.

## 7. Privacidad / red
- Local-first: los medios no salen del equipo sin que el usuario seleccione un provider o fuente.
- Mostrar qué archivos, frames, transcripts o prompts se envían.
- Permitir excluir rutas/medios sensibles y desenfocar/ocultar regiones.
- Retention/deletion del proveedor debe aparecer en provider settings donde esté documentado.
- No telemetría de contenido por defecto.
- Web research y stock search deben distinguirse de upload del video fuente.
- Evitar subir el proyecto entero cuando el proveedor sólo necesita un clip/frame o audio segment.

## 8. Costos y rate limits
- MaxCostCents/project budget como límite duro cuando el provider soporta estimación.
- Max assets, attempts, duration, resolution, file size y concurrency configurables.
- Estimar costo antes del call; registrar actual cost después.
- Idempotency para evitar doble cargo.
- Retry only for retryable errors y backoff.
- 429, 5xx, timeout, quota, billing disabled y moderation errors son estados distintos.
- Si costo desconocido, requerir consentimiento o bloquear automatic mode.
- Never fallback to paid vendor silently.

## 9. Perfil hardware de referencia
Equipo observado como baseline:
- Windows 11 Pro;
- AMD Ryzen 5 4600G, 6 cores / 12 threads;
- 16 GB RAM DDR4 dual-channel;
- gráfica integrada AMD Radeon, sin GPU dedicada detectada;
- 1360×768 a 60 Hz.

No diseñar un producto que dependa de ComfyUI/SD/video models locales grandes. La IA generativa pesada debe poder ejecutarse mediante proveedor remoto BYOK o servicio que el usuario elija. El procesamiento local debe ser selectivo, con límites, cancelación y medición.

### Políticas de rendimiento
- Una exportación pesada a la vez por defecto; permitir ajuste si hardware/capacidad lo justifica.
- Limitar decoders, thumbnail workers, ASR, vision, proxy jobs y downloads.
- Proxies adaptativos: resolución/codec elegidos por el perfil real.
- Cache por content hash y parámetros; invalidar al cambiar input/model/version.
- Evitar cargar un video completo o waveform completa en RAM.
- Previews a resolución reducida; render final con calidad configurada.
- Detectar encoder disponible y fallback CPU.
- No bloquear el hilo principal ni IPC en operaciones largas.
- Suspender o bajar prioridad en segundo plano cuando el sistema está bajo presión.
- Métricas: app idle/active memory, project open time, preview latency, timeline responsiveness, render fps, CPU/RAM, disk IO y cancellation latency.
- Definir budgets por escenario y repetir benchmark tras cada modificación relevante.

## 10. Seguridad del media pipeline
- FFprobe antes de decode/preview.
- Process sandbox cuando el entorno lo permita.
- Codec/container allowlist y tamaño máximo configurable.
- Timeouts por archivo, duración y megapixels.
- Límite de frames para thumbnails/contact sheets.
- Rechazar duration overflow, NaN timestamps, invalid dimensions, decompression bombs y headers corruptos.
- Tests fuzz/fixture para parser y path validation.
- Verificar outputs con segunda lectura del archivo y ffprobe.

## 11. Security acceptance
- Ninguna clave aparece en logs, UI persistida, proyecto ni crash report.
- Un proyecto malicioso no puede escribir fuera del root.
- Una URL privada no puede ser solicitada por catálogo remoto.
- Ningún asset metadata puede invocar un tool.
- Tool MCP no puede saltarse permission scope.
- Cancelar job mata el proceso descendiente y deja estado persistente.
- Cargo está limitado por presupuesto e idempotency.
- Build packaged contiene licenses/notices y sólo los binaries permitidos.