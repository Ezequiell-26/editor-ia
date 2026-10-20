/**
 * Normalisation of MCP tool results, shared by the Flow panel and the
 * automatic orchestrator. Tool servers disagree on the envelope: some return
 * `structuredContent`, some a JSON string inside `content[].text`.
 */

export function toolPayload(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  if (record.structuredContent) return record.structuredContent;
  const content = record.content;
  if (Array.isArray(content)) {
    for (const item of content) {
      if (item && typeof item === 'object') {
        const text = (item as { text?: unknown }).text;
        if (typeof text === 'string') {
          try {
            return JSON.parse(text);
          } catch {
            return text;
          }
        }
      }
    }
  }
  return value;
}

export function artifactPaths(value: unknown): string[] {
  const payload = toolPayload(value);
  if (!payload || typeof payload !== 'object') return [];
  const record = payload as Record<string, unknown>;
  const artifacts = record.artifacts;
  if (!Array.isArray(artifacts)) return [];
  return artifacts
    .map((artifact) => {
      if (typeof artifact === 'string') return artifact;
      if (artifact && typeof artifact === 'object') {
        const path = (artifact as { path?: unknown }).path;
        return typeof path === 'string' ? path : null;
      }
      return null;
    })
    .filter((path): path is string => Boolean(path))
    .slice(0, 20);
}

/** The visual brief of a scene: the scriptwriter's prompt or a compact fallback. */
export function sceneVisualPrompt(scene: {
  readonly title: string;
  readonly notes?: string | undefined;
  readonly narration: { readonly text?: string | undefined };
}): string {
  const notes = scene.notes?.trim();
  if (notes) return notes;
  const narration = scene.narration.text?.trim() ?? '';
  return `${scene.title}. ${narration}`.trim();
}

export function flowProviderId(kind: 'image' | 'video'): string {
  return kind === 'video' ? 'google-flow-video' : 'google-flow-image';
}
