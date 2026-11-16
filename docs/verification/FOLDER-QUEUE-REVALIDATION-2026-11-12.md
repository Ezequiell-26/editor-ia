# Revalidación de cola automática e integridad de medios — 2026-11-12

## Alcance
Revisión estática del código actual de `folder-queue.ts`, `folder-queue.test.ts`, `application/variants.rs`, `commands/domains/media/thumbnail.rs` y el contrato `packages/project-schema/src/assets.ts`. No se modificó código de producción ni se ejecutaron operaciones sobre medios del usuario.

## Hallazgos abiertos revalidados

### AUD-127 — Decodificación de miniaturas sin límite previo
- **Estado:** sigue abierto.
- **Evidencia actual:** `decode_data_url()` decodifica el payload Base64 completo sin límite de longitud. `save_thumbnail()` ejecuta `image::load_from_memory()` y solo después valida dimensiones; luego mantiene buffers adicionales al re-encodear PNG.
- **Riesgo:** consumo excesivo de RAM/CPU por payloads IPC grandes o imágenes con dimensiones/decompresión hostiles.
- **Próximo paso:** límite estricto de bytes antes de Base64 decode, decodificador con límites explícitos antes de asignar el raster, y pruebas de payload sobredimensionado y dimensiones extremas.

### AUD-135 — Hash SHA-256 ficticio en la cola por carpeta
- **Estado:** sigue abierto.
- **Evidencia actual:** `buildProject()` asigna `'0'.repeat(64)` a `integrity.sha256` y marca el asset `ready`. El contrato exige un digest SHA-256 real para assets listos; la cadena de ceros satisface solo la forma hexadecimal, no la integridad.
- **Riesgo:** colisiones de caché, verificación falsa y relink imposible para los medios generados por la cola.
- **Próximo paso:** calcular SHA-256 del archivo copiado y usar su tamaño real; si el hash falla, no marcar el asset `ready` ni inventar una huella.

### AUD-136 — Colisión de basename entre proyectos de la cola
- **Estado:** sigue abierto en el flujo revisado.
- **Evidencia actual:** `slug()` elimina la extensión y los destinos se derivan solo del stem. `write_project_document()` llama a `save_project()`, que guarda el documento en el destino; el almacenamiento soporta reemplazo de proyectos existentes. El render de variante, en cambio, rechaza un MP4 existente.
- **Riesgo:** entradas como `escena.mov` y `escena.mp4` pueden compartir JSON/MP4 y dejar el proyecto y el render perteneciendo a fuentes diferentes.
- **Próximo paso:** asignar un ID de entrega determinista/único que incluya extensión y hash, reservar JSON y MP4 sin reemplazo y probar basenames duplicados.

### AUD-138 — Reutilización de medios de variantes comparando solo tamaño
- **Estado:** sigue abierto.
- **Evidencia actual:** `mirror_assets()` compara únicamente `metadata().len()` cuando el destino ya existe; no compara SHA-256 ni bytes.
- **Riesgo:** dos assets distintos del mismo tamaño y ruta relativa pueden mezclarse silenciosamente en una variante.
- **Próximo paso:** comparar SHA-256 de origen/destino o rechazar cualquier colisión de ruta cuyo contenido no esté demostrado como idéntico.

### AUD-139 — Copias parciales sin rollback al fallar una variante
- **Estado:** sigue abierto.
- **Evidencia actual:** `mirror_assets()` copia assets secuencialmente en el directorio definitivo y retorna inmediatamente ante un fallo posterior; `write_project_variant_file()` no revierte las copias anteriores.
- **Riesgo:** medios huérfanos ocupan disco y contaminan reintentos.
- **Próximo paso:** staging temporal por operación y publicación final solo cuando todas las copias y el JSON hayan terminado; rollback limitado a archivos creados por esa operación.

## Hallazgos adicionales

### QUEUE-140 — La cola automática declara uso comercial permitido sin una atestación del usuario
- **Prioridad:** P2 (procedencia/licencias).
- **Evidencia:** `folder-queue.ts::buildProject()` crea assets con `license.id = 'user-declared'` y `commercialUse = 'allowed'` de forma automática. `batch-factory.ts` repite el patrón y llama a `markAssetReady(..., 'allowed')`.
- **Impacto:** el proyecto registra como declarada una licencia comercial que el usuario quizá nunca confirmó. Importar un archivo no demuestra titularidad ni permiso de redistribución/uso comercial.
- **Próximo paso:** separar origen de archivo y declaración de derechos. Usar estado `unknown`/pendiente hasta que el usuario confirme la licencia o seleccione un perfil de derechos; no bloquear edición local por defecto, pero sí advertir antes de exportar/publicar con uso comercial.

### QUEUE-141 — La cola no tiene una estrategia explícita de rollback de copias por archivo fallido
- **Prioridad:** P2 (residuos y recuperación).
- **Evidencia:** `processFile()` copia el archivo antes de generar peaks, construir proyecto, escribir JSON y renderizar. Las ramas posteriores de error devuelven `failed`, pero no llaman a un contrato de limpieza de la copia. El fake service de `folder-queue.test.ts` solo cuenta llamadas; no simula filesystem ni comprueba residuos.
- **Impacto:** una entrada fallida puede dejar el medio copiado, JSON parcial o artefactos previos en la carpeta de salida; reintentos pueden colisionar o acumular residuos.
- **Próximo paso:** devolver un identificador de operación y un manifiesto de archivos creados; limpiar solo los archivos de esa operación en error, conservando cualquier archivo preexistente. Añadir tests de fallo en cada etapa y de reintento.

## Cobertura de pruebas
- `folder-queue.test.ts` cubre selección de vídeos, skips, continuidad tras fallo de render y resumen.
- No verifica que el SHA-256 coincida con el contenido copiado, que el estado de licencia requiera declaración, que los basenames duplicados no colisionen, ni que el rollback preserve archivos preexistentes.
- Los tests actuales son de servicio simulado; no validan comportamiento real de filesystem.

## Estado
- Revisión estática: completada.
- Revalidación dinámica: pendiente.
- Cambios de producción: ninguno.
- Tests/build: no iniciados en esta pasada porque hay un `cargo test` de `projects::storage::tests` activo en el PC.
- No se hizo commit, push, reset, clean ni terminación de procesos.
