/**
 * Manifest written next to the downloaded images. It is the bridge between the
 * extension and Editor IA: order, prompts, files and the model, without embedding
 * image bytes or reference data.
 */
export function buildManifest({
  runId,
  createdAt = new Date().toISOString(),
  model,
  referenceUse,
  references = [],
  settings = {},
  status,
  prompts = [],
  results = [],
}) {
  const byIndex = new Map(results.map((item) => [item.index, item]));
  return {
    format: 'editor-ia.flow-queue',
    version: 1,
    runId,
    createdAt,
    model,
    referenceUse,
    references: references.map(({ name, type, bytes }) => ({ name, type, bytes })),
    settings,
    status,
    prompts: prompts.map((prompt, index) => {
      const result = byIndex.get(index);
      return {
        index,
        prompt,
        status: result ? 'downloaded' : 'missing',
        file: result?.filename ?? null,
      };
    }),
    results: results.map((result) => ({ ...result })),
    editorIa: {
      import: 'Medios → Auto-montar lote: seleccioná las imágenes descargadas y la narración.',
      order: 'Los archivos están numerados; ordenalos por nombre.',
    },
  };
}
