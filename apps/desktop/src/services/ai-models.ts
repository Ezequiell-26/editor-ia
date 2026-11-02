/**
 * Catálogo de modelos de IA que la app puede usar.
 *
 * Olyvia habla con el contrato de chat de OpenAI (`/chat/completions`), así que
 * cualquier proveedor que lo respete funciona. Este catálogo es una **ayuda**,
 * no un límite: el campo de modelo y la URL siempre aceptan texto libre.
 *
 * Los nombres de modelo son sugerencias corrientes de cada endpoint; cambian
 * rápido, por eso el selector permite escribir uno que no esté en la lista.
 */

export type AiBrandId =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'meta'
  | 'mistral'
  | 'deepseek'
  | 'qwen'
  | 'xai'
  | 'groq'
  | 'moonshot'
  | 'zhipu'
  | 'perplexity'
  | 'together'
  | 'fireworks'
  | 'openrouter'
  | 'ollama'
  | 'lmstudio'
  | 'vllm'
  | 'llamacpp'
  | 'azure'
  | 'mock'
  | 'custom';

export interface AiProviderPreset {
  readonly id: string;
  readonly brand: AiBrandId;
  readonly label: string;
  readonly baseUrl: string;
  /** Nombre de modelo por defecto al elegir el preset. */
  readonly model: string;
  readonly models: readonly string[];
  readonly local: boolean;
  readonly note: string;
}

export const AI_PROVIDERS: readonly AiProviderPreset[] = [
  {
    id: 'openai',
    brand: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4.1-mini',
    models: ['gpt-5', 'gpt-5-mini', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'gpt-4o-mini', 'o3', 'o4-mini'],
    local: false,
    note: 'Necesita clave. La app gasta cuota en cada llamada.',
  },
  {
    id: 'google',
    brand: 'google',
    label: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    model: 'gemini-2.5-flash',
    models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'],
    local: false,
    note: 'Endpoint compatible con OpenAI. Necesita clave.',
  },
  {
    id: 'deepseek',
    brand: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    local: false,
    note: 'Contrato compatible con OpenAI.',
  },
  {
    id: 'mistral',
    brand: 'mistral',
    label: 'Mistral AI',
    baseUrl: 'https://api.mistral.ai/v1',
    model: 'mistral-large-latest',
    models: ['mistral-large-latest', 'mistral-medium-latest', 'mistral-small-latest', 'codestral-latest'],
    local: false,
    note: 'Contrato compatible con OpenAI.',
  },
  {
    id: 'xai',
    brand: 'xai',
    label: 'xAI Grok',
    baseUrl: 'https://api.x.ai/v1',
    model: 'grok-3-mini',
    models: ['grok-4', 'grok-3', 'grok-3-mini'],
    local: false,
    note: 'Contrato compatible con OpenAI.',
  },
  {
    id: 'groq',
    brand: 'groq',
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'llama-3.3-70b-versatile',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'],
    local: false,
    note: 'Muy rápido; sirve modelos abiertos de otros.',
  },
  {
    id: 'qwen',
    brand: 'qwen',
    label: 'Qwen · Alibaba',
    baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
    models: ['qwen-max', 'qwen-plus', 'qwen-turbo'],
    local: false,
    note: 'Modo internacional. Para China: dashscope.aliyuncs.com.',
  },
  {
    id: 'moonshot',
    brand: 'moonshot',
    label: 'Moonshot Kimi',
    baseUrl: 'https://api.moonshot.ai/v1',
    model: 'kimi-k2-0711-preview',
    models: ['kimi-k2-0711-preview', 'moonshot-v1-128k'],
    local: false,
    note: 'Contrato compatible con OpenAI.',
  },
  {
    id: 'zhipu',
    brand: 'zhipu',
    label: 'Zhipu GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4-plus',
    models: ['glm-4-plus', 'glm-4-air', 'glm-4-flash'],
    local: false,
    note: 'Contrato compatible con OpenAI.',
  },
  {
    id: 'perplexity',
    brand: 'perplexity',
    label: 'Perplexity',
    baseUrl: 'https://api.perplexity.ai',
    model: 'sonar',
    models: ['sonar', 'sonar-pro', 'sonar-reasoning-pro'],
    local: false,
    note: 'Devuelve citas en la respuesta.',
  },
  {
    id: 'together',
    brand: 'together',
    label: 'Together AI',
    baseUrl: 'https://api.together.xyz/v1',
    model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    models: [
      'meta-llama/Llama-3.3-70B-Instruct-Turbo',
      'deepseek-ai/DeepSeek-V3',
      'Qwen/Qwen2.5-72B-Instruct-Turbo',
    ],
    local: false,
    note: 'Aloja modelos abiertos de terceros.',
  },
  {
    id: 'fireworks',
    brand: 'fireworks',
    label: 'Fireworks AI',
    baseUrl: 'https://api.fireworks.ai/inference/v1',
    model: 'accounts/fireworks/models/llama4-maverick-instruct-basic',
    models: ['accounts/fireworks/models/llama4-maverick-instruct-basic'],
    local: false,
    note: 'Aloja modelos abiertos de terceros.',
  },
  {
    id: 'openrouter',
    brand: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openai/gpt-4.1-mini',
    models: [
      'anthropic/claude-sonnet-4.5',
      'anthropic/claude-opus-4.1',
      'google/gemini-2.5-pro',
      'meta-llama/llama-3.3-70b-instruct',
      'deepseek/deepseek-chat',
      'openai/gpt-4.1-mini',
    ],
    local: false,
    note: 'Un solo acceso a muchos modelos, incluidos Claude y Llama.',
  },
  {
    id: 'azure',
    brand: 'azure',
    label: 'Azure OpenAI',
    baseUrl: 'https://TU-RECURSO.openai.azure.com/openai/v1',
    model: 'gpt-4.1',
    models: ['gpt-4.1', 'gpt-4o'],
    local: false,
    note: 'Reemplazá TU-RECURSO por el nombre del despliegue.',
  },
  {
    id: 'ollama',
    brand: 'ollama',
    label: 'Ollama',
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'llama3.1',
    models: ['llama3.1', 'llama3.2', 'qwen2.5', 'mistral', 'gemma2', 'deepseek-r1'],
    local: true,
    note: 'Corre en tu máquina: sin red, sin cuota.',
  },
  {
    id: 'lmstudio',
    brand: 'lmstudio',
    label: 'LM Studio',
    baseUrl: 'http://127.0.0.1:1234/v1',
    model: 'local-model',
    models: ['local-model'],
    local: true,
    note: 'Activá el servidor local en LM Studio (puerto 1234).',
  },
  {
    id: 'vllm',
    brand: 'vllm',
    label: 'vLLM',
    baseUrl: 'http://127.0.0.1:8000/v1',
    model: 'meta-llama/Llama-3.1-8B-Instruct',
    models: ['meta-llama/Llama-3.1-8B-Instruct'],
    local: true,
    note: 'Servidor propio de inferencia.',
  },
  {
    id: 'llamacpp',
    brand: 'llamacpp',
    label: 'llama.cpp',
    baseUrl: 'http://127.0.0.1:8080/v1',
    model: 'local',
    models: ['local'],
    local: true,
    note: 'Arrancá el server con `--server --port 8080`.',
  },
];

const PROVIDER_BY_ID: ReadonlyMap<string, AiProviderPreset> = new Map(
  AI_PROVIDERS.map((preset) => [preset.id, preset] as const),
);

export function providerPreset(id: string): AiProviderPreset | undefined {
  return PROVIDER_BY_ID.get(id);
}

function normalizeBaseUrl(url: string): string {
  return url.trim().toLowerCase().replace(/\/+$/, '');
}

interface EndpointRule {
  readonly brand: AiBrandId;
  readonly match: string;
}

const ENDPOINT_RULES: readonly EndpointRule[] = [
  { brand: 'openai', match: 'api.openai.com' },
  { brand: 'azure', match: 'openai.azure.com' },
  { brand: 'google', match: 'generativelanguage.googleapis.com' },
  { brand: 'deepseek', match: 'api.deepseek.com' },
  { brand: 'mistral', match: 'api.mistral.ai' },
  { brand: 'xai', match: 'api.x.ai' },
  { brand: 'groq', match: 'api.groq.com' },
  { brand: 'qwen', match: 'dashscope' },
  { brand: 'moonshot', match: 'moonshot' },
  { brand: 'zhipu', match: 'bigmodel.cn' },
  { brand: 'perplexity', match: 'api.perplexity.ai' },
  { brand: 'together', match: 'api.together.xyz' },
  { brand: 'fireworks', match: 'api.fireworks.ai' },
  { brand: 'openrouter', match: 'openrouter.ai' },
  { brand: 'ollama', match: ':11434' },
  { brand: 'lmstudio', match: ':1234' },
  { brand: 'vllm', match: ':8000' },
  { brand: 'llamacpp', match: ':8080' },
];

/** Qué marca atiende esta URL, por el host o el puerto. */
export function brandForEndpoint(baseUrl: string): AiBrandId | null {
  const clean = normalizeBaseUrl(baseUrl);
  if (!clean) return null;
  const rule = ENDPOINT_RULES.find((item) => clean.includes(item.match));
  return rule?.brand ?? null;
}

interface ModelRule {
  readonly brand: AiBrandId;
  readonly patterns: readonly RegExp[];
}

const MODEL_RULES: readonly ModelRule[] = [
  { brand: 'anthropic', patterns: [/^claude/, /anthropic/] },
  { brand: 'openai', patterns: [/^gpt/, /^o[134](-|$)/, /davinci/] },
  { brand: 'google', patterns: [/^gemini/, /gemma/] },
  { brand: 'meta', patterns: [/^llama/, /meta-llama/] },
  { brand: 'mistral', patterns: [/^mistral/, /^mixtral/, /^codestral/] },
  { brand: 'deepseek', patterns: [/^deepseek/] },
  { brand: 'qwen', patterns: [/^qwen/] },
  { brand: 'xai', patterns: [/^grok/] },
  { brand: 'groq', patterns: [/^groq/] },
  { brand: 'moonshot', patterns: [/^kimi/, /^moonshot/] },
  { brand: 'zhipu', patterns: [/^glm/] },
  { brand: 'perplexity', patterns: [/^sonar/] },
];

/** Qué familia es este modelo, por su nombre. `null` si no se reconoce. */
export function brandForModel(model: string): AiBrandId | null {
  const clean = model.trim().toLowerCase();
  if (!clean) return null;
  if (clean === 'mock') return 'mock';
  const rule = MODEL_RULES.find((item) =>
    item.patterns.some((pattern) => pattern.test(clean)),
  );
  return rule?.brand ?? null;
}

/**
 * Marca que mejor describe este proveedor: manda el nombre del modelo (dice
 * qué familia responde) y, si no, el endpoint.
 */
export function detectAiBrand(baseUrl: string, model: string): AiBrandId {
  const byModel = brandForModel(model);
  if (byModel) return byModel;
  return brandForEndpoint(baseUrl) ?? 'custom';
}

/** Etiqueta legible del endpoint: `Ollama`, `OpenRouter`, `Local`, … */
export function endpointLabel(baseUrl: string): string {
  const clean = normalizeBaseUrl(baseUrl);
  if (!clean) return 'sin endpoint';
  const preset = AI_PROVIDERS.find(
    (item) => normalizeBaseUrl(item.baseUrl) === clean,
  );
  if (preset) return preset.label;
  const host = clean.replace(/^https?:\/\//, '').split(/[/?#]/)[0] ?? '';
  return host || 'personalizado';
}

/** Modelos sugeridos para el endpoint activo; siempre incluye el actual. */
export function suggestedModels(baseUrl: string, current: string): readonly string[] {
  const clean = normalizeBaseUrl(baseUrl);
  const preset = AI_PROVIDERS.find((item) => normalizeBaseUrl(item.baseUrl) === clean);
  const list: string[] = [];
  const push = (value: string): void => {
    if (value && !list.includes(value)) list.push(value);
  };
  if (current.trim()) push(current.trim());
  for (const model of preset?.models ?? []) push(model);
  return list;
}
