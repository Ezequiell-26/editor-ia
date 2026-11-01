/**
 * Biblioteca portable de Open Design (Apache-2.0). El catálogo y los archivos
 * viven en `public/open-design` para que la app funcione sin red y para no
 * cargar 17 MB de guías en el bundle de JavaScript.
 */
export interface DesignSystemEntry {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly description: string;
  readonly colors: Readonly<Record<string, string>>;
  readonly canvas: {
    readonly bg: string | null;
    readonly surface: string | null;
    readonly fg: string | null;
    readonly accent: string | null;
    readonly accentOn: string | null;
  };
  readonly fonts: {
    readonly display: string | null;
    readonly body: string | null;
    readonly mono: string | null;
  };
  readonly craft: {
    readonly applies: readonly string[];
    readonly suggested: readonly string[];
  };
  readonly previewPages: readonly {
    readonly path: string;
    readonly role: string;
    readonly title: string;
  }[];
  readonly hasComponents: boolean;
  readonly files: {
    readonly design: string | null;
    readonly tokens: string;
    readonly designTokens: string | null;
    readonly components: string | null;
  };
}

export interface CraftEntry {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly file: string;
  readonly bytes: number;
}

export interface DesignTemplateEntry {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly mode: string;
  readonly platform: string | null;
  readonly scenario: string | null;
  readonly category: string | null;
  readonly tags: readonly string[];
  readonly upstream: string | null;
  readonly license: string;
  readonly licenseFile: string | null;
  readonly hasExample: boolean;
  readonly previewable: boolean;
  readonly files: {
    readonly skill: string;
    readonly example: string | null;
    readonly license: string | null;
  };
}

export interface DesignSkillEntry extends DesignTemplateEntry {
  readonly generatorReady: boolean;
}

export interface PromptTemplateEntry {
  readonly id: string;
  readonly surface: 'image' | 'video';
  readonly title: string;
  readonly summary: string;
  readonly category: string;
  readonly tags: readonly string[];
  readonly model: string | null;
  readonly aspect: string | null;
  readonly license: string;
  readonly author: string | null;
  readonly sourceUrl: string | null;
  readonly file: string;
  readonly preview: string | null;
}

export interface HyperframeEntry {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly category: string;
  readonly tags: readonly string[];
  readonly aspect: '16:9' | '9:16';
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly durationSec: number;
  readonly license: string;
  readonly author: string | null;
  readonly sourceUrl: string | null;
  readonly preview: string;
  readonly html: string;
}

export interface HyperframePreviewEntry {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly category: string;
  readonly tags: readonly string[];
  readonly aspect: '16:9' | '9:16';
  readonly durationSec: number;
  readonly license: string;
  readonly author: string | null;
  readonly sourceUrl: string | null;
  readonly preview: string;
  readonly video: string;
  readonly reason: string;
}

export interface OpenDesignCatalog {
  readonly schemaVersion: string;
  readonly source: {
    readonly repo: string;
    readonly commit: string;
    readonly license: string;
    readonly syncedAt: string;
  };
  readonly counts: {
    readonly designSystems: number;
    readonly craft: number;
    readonly promptTemplates: number;
    readonly excludedPromptTemplates: number;
    readonly templates?: number;
    readonly excludedTemplates?: number;
    readonly skills?: number;
    readonly excludedSkills?: number;
    readonly hyperframes?: number;
    readonly hyperframePreviews?: number;
    readonly excludedHyperframes?: number;
  };
  readonly designSystems: readonly DesignSystemEntry[];
  readonly craft: readonly CraftEntry[];
  readonly promptTemplates: readonly PromptTemplateEntry[];
  readonly templates: readonly DesignTemplateEntry[];
  readonly skills: readonly DesignSkillEntry[];
  readonly hyperframes?: readonly HyperframeEntry[];
  readonly hyperframePreviews?: readonly HyperframePreviewEntry[];
}

export interface PromptTemplateDetail {
  readonly id: string;
  readonly title: string;
  readonly prompt: string;
  readonly model?: string | null;
  readonly aspect?: string | null;
  readonly source?: {
    readonly repo?: string;
    readonly license?: string;
    readonly author?: string;
    readonly url?: string;
  };
}

const base = `${(import.meta.env.BASE_URL ?? '/').replace(/\/$/, '')}/open-design`;

const CATEGORY_LABELS: Readonly<Record<string, string>> = {
  'Themed & Unique': 'Temáticos y únicos',
  'E-Commerce & Retail': 'Comercio y retail',
  'Design & Creative': 'Diseño y creatividad',
  'Professional & Corporate': 'Profesional y corporativo',
  'Media & Consumer': 'Medios y consumo',
  'Productivity & SaaS': 'Productividad y SaaS',
  'Creative & Artistic': 'Creativo y artístico',
  'Editorial · Studio': 'Editorial · estudio',
  'Layout & Structure': 'Layout y estructura',
  'Fintech & Crypto': 'Fintech y cripto',
  Automotive: 'Automoción',
  'Bold & Expressive': 'Audaz y expresivo',
  'Backend & Data': 'Backend y datos',
  'AI & LLM': 'IA y LLM',
  'Morphism & Effects': 'Morfismo y efectos',
  'Modern & Minimal': 'Moderno y minimal',
  'Developer Tools': 'Herramientas dev',
  Starter: 'Inicial',
  'Retro & Nostalgic': 'Retro y nostálgico',
  'Editorial & Print': 'Editorial e impresión',
  'Editorial / Personal / Publication': 'Editorial / personal / publicación',
  'Social & Messaging': 'Social y mensajería',
};

export function designCategoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category;
}

export function openDesignUrl(path: string): string {
  return `${base}/${path.replace(/^\/+/, '')}`;
}

export function hyperframePreviewUrl(entry: { readonly preview: string }): string {
  return openDesignUrl(entry.preview);
}

export function hyperframeDocumentUrl(entry: HyperframeEntry): string {
  return openDesignUrl(entry.html);
}

export function filterHyperframes(
  entries: readonly HyperframeEntry[],
  query: string,
): readonly HyperframeEntry[] {
  return entries.filter((entry) =>
    matches(
      [entry.title, entry.summary, entry.category, entry.tags.join(' '), entry.aspect],
      query,
    ),
  );
}

export function hyperframePreviewVideoUrl(entry: HyperframePreviewEntry): string {
  return openDesignUrl(entry.video);
}

export function filterHyperframePreviews(
  entries: readonly HyperframePreviewEntry[],
  query: string,
): readonly HyperframePreviewEntry[] {
  return entries.filter((entry) =>
    matches(
      [entry.title, entry.summary, entry.category, entry.tags.join(' '), entry.reason],
      query,
    ),
  );
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function matches(haystack: readonly (string | null | undefined)[], needle: string): boolean {
  if (!needle) return true;
  const normalized = normalize(needle);
  return haystack.some((value) => value && normalize(value).includes(normalized));
}

export function filterDesignSystems(
  entries: readonly DesignSystemEntry[],
  query: string,
  category: string,
): readonly DesignSystemEntry[] {
  return entries.filter((entry) => {
    if (category && category !== 'Todos' && entry.category !== category) return false;
    return matches(
      [
        entry.name,
        entry.id,
        entry.category,
        designCategoryLabel(entry.category),
        entry.description,
        entry.craft.suggested.join(' '),
      ],
      query,
    );
  });
}

export function filterPromptTemplates(
  entries: readonly PromptTemplateEntry[],
  query: string,
  surface: 'all' | 'image' | 'video',
): readonly PromptTemplateEntry[] {
  return entries.filter((entry) => {
    if (surface !== 'all' && entry.surface !== surface) return false;
    return matches(
      [entry.title, entry.summary, entry.category, entry.tags.join(' '), entry.model],
      query,
    );
  });
}

export function filterCraft(entries: readonly CraftEntry[], query: string): readonly CraftEntry[] {
  return entries.filter((entry) => matches([entry.title, entry.summary, entry.id], query));
}

export function filterDesignTemplates(
  entries: readonly DesignTemplateEntry[],
  query: string,
  mode: string,
): readonly DesignTemplateEntry[] {
  return entries.filter((entry) => {
    if (mode && mode !== 'Todos' && entry.mode !== mode) return false;
    return matches(
      [entry.name, entry.id, entry.description, entry.mode, entry.scenario, entry.tags.join(' ')],
      query,
    );
  });
}

const TEMPLATE_MODE_LABELS: Readonly<Record<string, string>> = {
  prototype: 'Prototipo',
  deck: 'Deck',
  image: 'Imagen',
  video: 'Video',
  audio: 'Audio',
  template: 'Plantilla',
  hyperframes: 'HyperFrames',
  utility: 'Utilidad',
  design: 'Diseño',
  'design-system': 'Sistema de diseño',
};

export function templateModeLabel(mode: string): string {
  return TEMPLATE_MODE_LABELS[mode] ?? mode;
}

export function designTemplateModes(entries: readonly DesignTemplateEntry[]): readonly string[] {
  const counts = new Map<string, number>();
  for (const entry of entries) counts.set(entry.mode, (counts.get(entry.mode) ?? 0) + 1);
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'es'))
    .map(([mode]) => mode);
}

export function filterSkills(
  entries: readonly DesignSkillEntry[],
  query: string,
  mode: string,
): readonly DesignSkillEntry[] {
  return entries.filter((entry) => {
    if (mode && mode !== 'Todos' && entry.mode !== mode) return false;
    return matches(
      [entry.name, entry.id, entry.description, entry.mode, entry.scenario, entry.tags.join(' ')],
      query,
    );
  });
}

export function skillModes(entries: readonly DesignSkillEntry[]): readonly string[] {
  const counts = new Map<string, number>();
  for (const entry of entries) counts.set(entry.mode, (counts.get(entry.mode) ?? 0) + 1);
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'es'))
    .map(([mode]) => mode);
}

export function designSystemCategories(entries: readonly DesignSystemEntry[]): readonly string[] {
  const counts = new Map<string, number>();
  for (const entry of entries) counts.set(entry.category, (counts.get(entry.category) ?? 0) + 1);
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'es'))
    .map(([category]) => category);
}

function isCatalog(value: unknown): value is OpenDesignCatalog {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Record<string, unknown>;
  return (
    entry.schemaVersion === 'olyvia-open-design/v1' &&
    Array.isArray(entry.designSystems) &&
    Array.isArray(entry.craft) &&
    Array.isArray(entry.promptTemplates) &&
    Array.isArray(entry.templates) &&
    Array.isArray(entry.skills) &&
    Boolean(entry.counts)
  );
}

async function fetchText(fetcher: typeof fetch, path: string): Promise<string> {
  const response = await fetcher(openDesignUrl(path));
  if (!response.ok) {
    throw new Error(`No se pudo abrir ${path} (HTTP ${response.status})`);
  }
  return response.text();
}

async function fetchCatalog(fetcher: typeof fetch): Promise<OpenDesignCatalog> {
  const response = await fetcher(openDesignUrl('catalog.json'));
  if (!response.ok) {
    throw new Error(`No se pudo leer el catálogo de Diseño (HTTP ${response.status})`);
  }
  const data: unknown = await response.json();
  if (!isCatalog(data)) {
    throw new Error('El catálogo de Diseño no tiene el formato esperado.');
  }
  return data;
}

let cached: Promise<OpenDesignCatalog> | null = null;

/** Sin fetcher usa la caché de la sesión; con fetcher permite pruebas aisladas. */
export function loadOpenDesignCatalog(fetcher?: typeof fetch): Promise<OpenDesignCatalog> {
  if (fetcher) return fetchCatalog(fetcher);
  if (!cached) {
    cached = fetchCatalog(fetch).catch((error: unknown) => {
      cached = null;
      throw error;
    });
  }
  return cached;
}

export function loadDesignSystemDoc(
  entry: DesignSystemEntry,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  const file = entry.files.design ?? 'DESIGN.md';
  return fetchText(fetcher, `design-systems/${entry.id}/${file}`);
}

export function loadDesignSystemTokens(
  entry: DesignSystemEntry,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  return fetchText(fetcher, `design-systems/${entry.id}/${entry.files.tokens}`);
}

export function loadCraftDoc(entry: CraftEntry, fetcher: typeof fetch = fetch): Promise<string> {
  return fetchText(fetcher, `craft/${entry.file}`);
}

export function loadDesignTemplateDoc(
  entry: DesignTemplateEntry,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  return fetchText(fetcher, entry.files.skill);
}

export function loadSkillDoc(
  entry: DesignSkillEntry,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  return fetchText(fetcher, entry.files.skill);
}

export function skillExampleUrl(entry: DesignSkillEntry): string | null {
  return entry.files.example ? openDesignUrl(entry.files.example) : null;
}

export function designTemplateExampleUrl(entry: DesignTemplateEntry): string | null {
  return entry.files.example ? openDesignUrl(entry.files.example) : null;
}

export async function loadPromptTemplate(
  entry: PromptTemplateEntry,
  fetcher: typeof fetch = fetch,
): Promise<PromptTemplateDetail> {
  const response = await fetcher(openDesignUrl(entry.file));
  if (!response.ok) {
    throw new Error(`No se pudo abrir la plantilla ${entry.id} (HTTP ${response.status})`);
  }
  const data = (await response.json()) as PromptTemplateDetail;
  if (!data || typeof data.prompt !== 'string') {
    throw new Error(`La plantilla ${entry.id} no incluye un prompt.`);
  }
  return data;
}

export function designSystemPreviewUrl(entry: DesignSystemEntry, path: string): string {
  return openDesignUrl(`design-systems/${entry.id}/${path.replace(/^\/+/, '')}`);
}

export function designSystemComponentsUrl(entry: DesignSystemEntry): string {
  return openDesignUrl(`design-systems/${entry.id}/components.html`);
}
