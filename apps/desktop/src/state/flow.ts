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


/**
 * Argumentos para un servidor MCP de Flow.
 *
 * Hay al menos dos familias en circulación: la que usa `ratio`, `output_folder`,
 * `auto_confirm` y `duration`, y la de `google-flow-mcp` (miyakejima), que usa
 * `aspectRatio`, `outputDirectory`, `confirmCreditSpend` y `durationSeconds`.
 * Si conocemos el schema de la herramienta, mandamos exactamente lo que declara;
 * si no, mandamos el superconjunto: los servidores con zod ignoran las claves
 * que no conocen, así que la llamada funciona en ambos.
 */
export interface FlowArgsInput {
  readonly prompt: string;
  readonly kind: 'image' | 'video';
  readonly outputDir: string;
  readonly model?: string | undefined;
  readonly ratio?: string | undefined;
  readonly duration?: string | undefined;
  readonly credits?: boolean | undefined;
  /** Cuenta de Google Flow a usar; si falta, el servidor usa la predeterminada. */
  readonly accountId?: string | undefined;
  /** `inputSchema` de la herramienta MCP, si se conoce. */
  readonly schema?: unknown;
}

function declaredProperties(schema: unknown): Set<string> | null {
  if (!schema || typeof schema !== 'object') return null;
  const properties = (schema as { properties?: unknown }).properties;
  if (!properties || typeof properties !== 'object') return null;
  const keys = Object.keys(properties as Record<string, unknown>);
  return keys.length > 0 ? new Set(keys) : null;
}

function secondsOf(duration: string | undefined): number | undefined {
  if (!duration) return undefined;
  const match = /([0-9]+(?:\.[0-9]+)?)/.exec(duration);
  if (!match) return undefined;
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

export function buildFlowArgs(input: FlowArgsInput): Record<string, unknown> {
  const declared = declaredProperties(input.schema);
  const all: Record<string, unknown> = { prompt: input.prompt };
  if (input.accountId) all.accountId = input.accountId;
  if (input.model) all.model = input.model;
  if (input.ratio) {
    all.aspectRatio = input.ratio;
    all.ratio = input.ratio;
  }
  all.outputDirectory = input.outputDir;
  all.output_folder = input.outputDir;
  if (input.credits !== false) {
    all.confirmCreditSpend = true;
    all.auto_confirm = true;
  }
  all.outputs = 1;
  all.response_format = 'detailed';
  if (input.kind === 'video') {
    const seconds = secondsOf(input.duration);
    if (seconds !== undefined) all.durationSeconds = seconds;
    if (input.duration) all.duration = input.duration;
  }
  if (!declared) return all;
  const filtered: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(all)) {
    if (declared.has(key)) filtered[key] = value;
  }
  return filtered;
}


/**
 * Extrae mensaje y código de un fallo de Flow.
 *
 * El servidor devuelve `{ error: { code, message } }` dentro del contenido; si
 * viene texto suelto, se usa como mensaje. El código es lo que permite decidir
 * si el fallo es de créditos y conviene rotar de cuenta.
 */
export function flowFailure(value: unknown): { message: string; code: string | null } {
  const payload = toolPayload(value);
  if (typeof payload === 'string') return { message: payload, code: null };
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    const error = record.error;
    if (error && typeof error === 'object') {
      const entry = error as Record<string, unknown>;
      return {
        message: typeof entry.message === 'string' ? entry.message : 'Flow devolvió un error',
        code: typeof entry.code === 'string' ? entry.code : null,
      };
    }
    if (typeof record.message === 'string') {
      return { message: record.message, code: null };
    }
  }
  return { message: 'Flow devolvió un error', code: null };
}
