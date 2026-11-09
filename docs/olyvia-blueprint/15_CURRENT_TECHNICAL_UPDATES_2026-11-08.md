# 15 — Actualización técnica contrastada al 2026-11-08

Este documento fija hechos de documentación oficial consultada en esta fecha. Son señales para que SWE 2 implemente adapters actuales, no valores que deban hardcodearse en el producto. Revalidar docs, modelos, cuentas, precios y licencias al integrar.

## 1. OpenAI — imagen: generación y edición

Documentación oficial:
- Image generations: https://developers.openai.com/api/reference/resources/images/methods/generate
- Image edits: https://developers.openai.com/api/reference/resources/images/methods/edit
- Responses API: https://developers.openai.com/api/reference/resources/responses/methods/create

La API documenta:
- POST /images/generations para crear imágenes.
- POST /images/edits para editar o extender una o más imágenes.
- Los modelos GPT Image permiten outputs PNG, WebP y JPEG; los formatos GIF/SVG dependen del modelo y el acceso habilitado.
- El endpoint de edición admite múltiples imágenes de referencia (hasta 16 en la referencia consultada), y capacidades opcionales de mask/markup/background en modelos compatibles.
- Algunos modelos admiten transparencia; GIF puede configurar frame_count y frame_duration_ms con límites de la API.
- Los nombres/model IDs disponibles cambian y la referencia enumera varios snapshots y familias GPT Image, incluidas versiones 2.5 y 2.6. La disponibilidad de una organización/cuenta no debe presumirse.
- La documentación consultada indica que gpt-image-1 dejó de estar disponible el 2026-10-23; no iniciar una implementación nueva basada en ese model ID.

### Requisito para Olyvia
Implementar un adapter que:
1. Lee el catálogo/allowlist de modelos admitidos por la configuración actual.
2. Declara generate/edit, references, masks, transparency, output formats, size and streaming sólo cuando el modelo lo admite.
3. Envía bytes/IDs de archivo de forma segura; evita URLs privadas y valida los tipos de contenido.
4. Maneja outputs base64, tamaño máximo, temp files, hash, magic bytes y probe de imagen.
5. Preserva referencias, prompt, model ID y parámetros en metadata sin incluir secretos.
6. Registra uso/costo real cuando la API lo exponga.
7. Presenta progreso sólo si la API ofrece streaming/progress; de otro modo, estado de espera honesto.
8. Prueba generación, edición con referencias múltiples, edición con mask y errores de quota/permission.

No prometer que todos los modelos soportan todos los campos. El adapter consulta las capabilities reales y no manda parámetros incompatibles.

## 2. Google — generación y edición de vídeo

Documentación oficial consultada:
- https://ai.google.dev/gemini-api/docs/video
- https://ai.google.dev/gemini-api/docs/interactions

La guía actual de generación de vídeo describe dos familias para distintos flujos:
- Gemini Omni Flash: generación rápida y edición conversacional multimodal; la guía destaca entradas de texto, imagen, audio y vídeo y refinamiento por múltiples turnos mediante Interactions API.
- Veo 3.1: flujo de generación de vídeo con audio nativo; la guía menciona extensión de vídeo, control de último frame y dirección basada en imágenes mediante generateContent.

### Requisito para Olyvia
No construir un único adapter genérico “Google video” que ignore las diferencias de endpoint:
- Adapter Gemini Interactions para workflows conversacionales/iterativos si cuenta/modelo lo admite.
- Adapter Veo/generateContent para generación, reference frames, audio y extensión cuando la capability lo confirme.
- Capability registry por model/version/region.
- Request validation por duración, input modality, resolución, aspect ratio y reference count.
- Async task lifecycle, polling/backoff, output download y ffprobe.
- Presupuesto/consent antes de crear vídeo facturable.
- Permitir reintentar o iterar sobre el output como nueva versión sin destruir el anterior.

Verificar disponibilidad de cuenta, pricing, quotas, region, output duration y cancelación en docs/API reales al momento de la integración. No poner precios o límites fijos en código a partir de esta nota.

## 3. MCP — protocolo 2026-07-28

Fuentes oficiales:
- https://blog.modelcontextprotocol.io/posts/2026-07-28/
- https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/server/tools.mdx
- https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/basic/authorization/index.mdx
- https://tasks.extensions.modelcontextprotocol.io/
- https://ts.sdk.modelcontextprotocol.io/v2/migration/support-2026-07-28

La revisión 2026-07-28 introduce cambios importantes para servidores HTTP:
- Núcleo stateless: se retiran initialize/initialized y Mcp-Session-Id del transporte HTTP moderno; cada request lleva metadata de versión/protocolo/cliente en _meta y puede llegar a cualquier instancia.
- server/discover aparece como opción para obtener capabilities.
- Multi Round-Trip Requests permite devolver input_required para solicitar datos/confirmación al usuario y continuar el tool call.
- Streamable HTTP define headers de enrutamiento Mcp-Method y Mcp-Name.
- Respuestas de list tools/prompts/resources incluyen ttlMs y cacheScope para caching.
- La autorización endurece OAuth: validation of issuer (iss), binding de credenciales al issuer y preferencia por Client ID Metadata Documents; Dynamic Client Registration queda deprecated aunque se mantiene por compatibilidad.
- Tasks pasa a la extensión io.modelcontextprotocol/tasks, con tasks/get, tasks/update y tasks/cancel; no hay tasks/list en la extensión moderna. Se requiere opt-in en _meta por request.
- La cancelación de una task MCP es cooperativa; no sustituye la cancelación real interna del proceso/job.

### Requisito para Olyvia
1. Identificar la versión/SDK actual usada por el cliente y el servidor.
2. Mantener compatibilidad con clientes legacy cuando sea necesario; no romper stdio existente sin un plan de migración.
3. Para Streamable HTTP moderno, implementar la revisión 2026-07-28 con los headers y _meta requeridos.
4. No introducir initialize/session IDs en el camino moderno si el SDK/spec actual los retiró; conservar un adapter legacy sólo para clientes que lo necesiten.
5. Soportar Tasks extension como mecanismo MCP de larga duración cuando el cliente se anuncie compatible.
6. El job interno y sus checkpoints siguen siendo fuente de verdad: task handles MCP son un interfaz de transporte, no el job DB.
7. Cancelar una task debe solicitar cancelación interna; el backend debe terminar procesos descendientes, persistir el estado y verificar que la operación terminó.
8. Nunca exponer tasks/list ni permitir enumeración de runs de otros usuarios. Los handles deben ser impredecibles y scopeados.
9. Usar input_required/MRTR cuando un tool necesita aprobación, parámetro faltante o confirmación intermedia.
10. Tools deben seguir mostrando al usuario qué herramienta se llama y tener capacidad de denegar operaciones con side effects.
11. Cachear tools/list con TTL/cachescope sólo según lo que entregue el servidor; invalidar ante listChanged/permission updates.
12. Usar OAuth según la especificación para Streamable HTTP protegido; no trasladar ese flujo a stdio, que debe usar el mecanismo de credenciales del proceso.

## 4. FFmpeg — build ya inspeccionado en el worktree

Se inspeccionó la licencia del DLL bundle en apps/desktop/src-tauri/resources/ffmpeg-dll/LICENSE.txt y el binario FFmpeg bajo resources:
- La copia de licencia distribuida declara LGPL versión 3.
- ffmpeg -L también informa LGPL version 3 or later.
- ffmpeg -buildconf mostró --enable-version3; la búsqueda no encontró --enable-gpl ni --enable-nonfree en la configuración mostrada.

Esto es evidencia del bundle actual inspeccionado, no permiso para incorporar cualquier codec/plugin:
- Mantener build configuration, binaries y license file sincronizados.
- Cualquier build nuevo debe inspeccionar -L y -buildconf.
- Si se agrega un componente GPL/nonfree, hacer un nuevo análisis de distribución/licencia antes del bundle.
- Conservar DLL dynamic linking, notices, fuentes correspondientes y manifest.
- Actualizar el build y vulnerabilidades según upstream; no confiar en un ffmpeg.exe viejo.
- FFmpeg sigue siendo el motor de render inicial de Olyvia; no sustituirlo automáticamente por FilmCraft, GStreamer u otro NLE.

## 5. Repositorios candidatos: actualización del registro

### FilmCraft — candidato de investigación nuevo
- Repo: https://github.com/storytold/filmcraft
- Licencia declarada en GitHub: MIT y Apache-2.0.
- Arquitectura anunciada: editor NLE en Rust, compositor wgpu, engine de comandos, timeline y automation/MCP, CLI.
- Estado declarado por el propio proyecto: alpha; su README declara diferencias de madurez en plataformas y faltantes de AI/codec/plugin parity.
- Decisión inicial: **HIGH-PRIORITY LEARN/POC**, no dependencia ni reemplazo del engine de Olyvia.

Evaluar sólo módulos/capacidades concretas: timebase exacto, command registry, GPU compositor wgpu, render-preview parity, tests golden, cancellation/job model y MCP command control. No reescribir Olyvia ni crear una segunda timeline/proyecto. Ejecutar build/bench en Windows y revisar todos los archivos LICENSE/NOTICE/assets antes de portar código.

## 6. Registro de fuentes y fecha

Esta nota se actualizó el 2026-11-08. Para cada implementación, SWE 2 debe registrar:
- URL oficial consultada;
- fecha y API/spec version;
- provider/model ID exacto;
- account access, region, limits and pricing;
- prueba real en la cuenta que se usa;
- resultado, output artifact y hash;
- licencia/terms exactos.

La existencia de una página oficial no demuestra que Olyvia tenga credenciales, cuota o permiso de uso. Nunca convertir una capability documentada en una capability implementada sin prueba.