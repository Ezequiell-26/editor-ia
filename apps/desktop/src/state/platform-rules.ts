import {
  totalProjectDuration,
  type ProjectDocument,
} from '@editor-ia/project-schema';

export const RULES_SCHEMA = 'editor-ia.platform-rules.v1';

export interface RuleSource {
  readonly label: string;
  readonly url: string;
}

export interface PlatformRulePack {
  readonly id: string;
  readonly label: string;
  readonly version: string;
  readonly updatedAt: string;
  readonly orientation: 'vertical' | 'horizontal' | 'any';
  readonly minHeight: number;
  readonly maxDurationSeconds?: number;
  readonly minDurationSeconds?: number;
  readonly maxFileSizeMb?: number;
  readonly requiresAiDisclosure: boolean;
  readonly requiresMusicLicense: boolean;
  readonly monetization: readonly string[];
  readonly strikeRisks: readonly string[];
  readonly sources: readonly RuleSource[];
}

export interface PlatformRulesDocument {
  readonly schema: typeof RULES_SCHEMA;
  readonly generatedAt: string;
  readonly packs: readonly PlatformRulePack[];
}

const SOURCE_YOUTUBE = {
  label: 'YouTube · YPP y contenido apto',
  url: 'https://support.google.com/youtube/answer/72857',
} as const;
const SOURCE_YOUTUBE_AI = {
  label: 'YouTube · divulgación de contenido sintético',
  url: 'https://support.google.com/youtube/answer/14328491',
} as const;
const SOURCE_TIKTOK = {
  label: 'TikTok · normas de la comunidad',
  url: 'https://www.tiktok.com/community-guidelines',
} as const;
const SOURCE_TIKTOK_AI = {
  label: 'TikTok · contenido generado por IA',
  url: 'https://support.tiktok.com/en/using-tiktok/creating-videos/ai-generated-content',
} as const;
const SOURCE_META = {
  label: 'Meta · normas comunitarias',
  url: 'https://transparency.meta.com/policies/community-standards/',
} as const;
const SOURCE_X = {
  label: 'X · reglas y políticas',
  url: 'https://help.x.com/en/rules-and-policies/x-rules',
} as const;
const SOURCE_TWITCH = {
  label: 'Twitch · normas de la comunidad',
  url: 'https://www.twitch.tv/p/en/legal/community-guidelines/',
} as const;
const SOURCE_TWITCH_MUSIC = {
  label: 'Twitch · derechos musicales',
  url: 'https://help.twitch.tv/s/article/music-clears?language=en_US',
} as const;
const SOURCE_LINKEDIN = {
  label: 'LinkedIn · políticas profesionales',
  url: 'https://www.linkedin.com/help/linkedin/answer/a1339446',
} as const;

/**
 * Conservative, reviewable rule packs. They are a preflight aid, not a copy of
 * each platform's full policy and never a guarantee against a strike. Remote
 * packs with the same schema can replace these after they are published.
 */
export const BUILTIN_RULE_PACKS: readonly PlatformRulePack[] = [
  {
    id: 'youtube',
    label: 'YouTube',
    version: '2026.10.20',
    updatedAt: '2026-10-20',
    orientation: 'any',
    minHeight: 1080,
    requiresAiDisclosure: true,
    requiresMusicLicense: true,
    monetization: [
      'Contenido original y con valor añadido; el contenido reutilizado sin transformación no es apto para monetización.',
      'El video debe ser apto para anunciantes: sin violencia gráfica, engaño, contenido sexual ni lenguaje dañino.',
      'La música y los clips de terceros necesitan derechos comerciales.',
      'El contenido realista generado o alterado con IA debe declararse.',
    ],
    strikeRisks: [
      'Música o imágenes sin licencia.',
      'Contenido duplicado o compilaciones sin transformación.',
      'Títulos o miniaturas engañosas.',
      'Divulgación de IA omitida en contenido realista.',
    ],
    sources: [SOURCE_YOUTUBE, SOURCE_YOUTUBE_AI],
  },
  {
    id: 'shorts',
    label: 'YouTube Shorts',
    version: '2026.10.20',
    updatedAt: '2026-10-20',
    orientation: 'vertical',
    minHeight: 720,
    maxDurationSeconds: 180,
    requiresAiDisclosure: true,
    requiresMusicLicense: true,
    monetization: [
      'Formato vertical/cuadrado y dentro del límite vigente de Shorts.',
      'Debe ser original; las recopilaciones sin aportes propios no son aptas.',
      'La divulgación de IA y los derechos musicales también aplican.',
    ],
    strikeRisks: [
      'Reutilizar un video ajeno sin transformación.',
      'Música sin licencia.',
      'Spam o contenido repetitivo.',
    ],
    sources: [SOURCE_YOUTUBE, SOURCE_YOUTUBE_AI],
  },
  {
    id: 'tiktok',
    label: 'TikTok',
    version: '2026.10.20',
    updatedAt: '2026-10-20',
    orientation: 'vertical',
    minHeight: 720,
    maxDurationSeconds: 600,
    minDurationSeconds: 60,
    requiresAiDisclosure: true,
    requiresMusicLicense: true,
    monetization: [
      'Para recompensas de creador, el video debe superar el minuto y ser original.',
      'El contenido reutilizado o de baja calidad no califica.',
      'Las colaboraciones comerciales deben declararse.',
      'El contenido realista generado por IA debe etiquetarse.',
    ],
    strikeRisks: [
      'Contenido no original o repetido.',
      'Música comercial sin derechos.',
      'Publicidad encubierta.',
      'Contenido que infringe las normas comunitarias.',
    ],
    sources: [SOURCE_TIKTOK, SOURCE_TIKTOK_AI],
  },
  {
    id: 'reels',
    label: 'Instagram Reels',
    version: '2026.10.20',
    updatedAt: '2026-10-20',
    orientation: 'vertical',
    minHeight: 720,
    maxDurationSeconds: 180,
    requiresAiDisclosure: true,
    requiresMusicLicense: true,
    monetization: [
      'Formato vertical y dentro del límite vigente de Reels.',
      'El contenido debe cumplir las normas comunitarias de Meta.',
      'Las colaboraciones pagadas y el contenido sintético realista deben declararse.',
      'La música del catálogo de la plataforma no equivale a derechos para uso comercial fuera de ella.',
    ],
    strikeRisks: [
      'Música protegida fuera del catálogo permitido.',
      'Contenido duplicado de otras cuentas.',
      'Marcas o anuncios no divulgados.',
    ],
    sources: [SOURCE_META],
  },
  {
    id: 'facebook',
    label: 'Facebook Reels',
    version: '2026.10.20',
    updatedAt: '2026-10-20',
    orientation: 'vertical',
    minHeight: 720,
    maxDurationSeconds: 90,
    requiresAiDisclosure: true,
    requiresMusicLicense: true,
    monetization: [
      'Video vertical/cuadrado y original para el programa de monetización.',
      'Debe respetar las normas comunitarias y de contenido apto para anunciantes.',
      'La música y los clips de terceros requieren derechos.',
      'El contenido sintético realista y las colaboraciones deben declararse.',
    ],
    strikeRisks: [
      'Reutilización de videos de otras páginas.',
      'Música o imágenes sin licencia.',
      'Engaño y engagement bait.',
    ],
    sources: [SOURCE_META],
  },
  {
    id: 'x',
    label: 'X',
    version: '2026.10.20',
    updatedAt: '2026-10-20',
    orientation: 'any',
    minHeight: 720,
    maxDurationSeconds: 140,
    requiresAiDisclosure: true,
    requiresMusicLicense: true,
    monetization: [
      'La monetización depende de la cuenta y de las políticas vigentes de X.',
      'El contenido debe ser original y respetar las reglas de la plataforma.',
      'La música y los clips de terceros requieren derechos.',
    ],
    strikeRisks: [
      'Contenido duplicado o spam.',
      'Derechos de autor.',
      'Manipulación engañosa de medios.',
    ],
    sources: [SOURCE_X],
  },
  {
    id: 'twitch',
    label: 'Twitch',
    version: '2026.10.20',
    updatedAt: '2026-10-20',
    orientation: 'horizontal',
    minHeight: 720,
    requiresAiDisclosure: false,
    requiresMusicLicense: true,
    monetization: [
      'La música en streams y VOD requiere derechos; el catálogo del juego no cubre música de fondo.',
      'El contenido debe cumplir las normas de la comunidad.',
    ],
    strikeRisks: [
      'Música protegida en VOD o clips.',
      'Contenido prohibido por las normas comunitarias.',
    ],
    sources: [SOURCE_TWITCH, SOURCE_TWITCH_MUSIC],
  },
  {
    id: 'linkedin',
    label: 'LinkedIn',
    version: '2026.10.20',
    updatedAt: '2026-10-20',
    orientation: 'any',
    minHeight: 720,
    maxDurationSeconds: 900,
    requiresAiDisclosure: true,
    requiresMusicLicense: true,
    monetization: [
      'Contenido profesional, original y con contexto; evita el spam y los enlaces engañosos.',
      'La música y los medios de terceros requieren derechos.',
    ],
    strikeRisks: [
      'Spam o automatización no divulgada.',
      'Contenido engañoso o discriminatorio.',
      'Derechos de autor.',
    ],
    sources: [SOURCE_LINKEDIN],
  },
];

export type RuleSeverity = 'ok' | 'info' | 'warn' | 'block';

export interface RuleFinding {
  readonly id: string;
  readonly severity: RuleSeverity;
  readonly title: string;
  readonly detail: string;
  readonly source?: RuleSource;
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function text(value: unknown, max = 500): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function stringList(value: unknown, max = 12): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => text(item, 500))
    .filter(Boolean)
    .slice(0, max);
}

function sourcesList(value: unknown): RuleSource[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (item): item is Record<string, unknown> =>
        Boolean(item) && typeof item === 'object' && isHttpUrl((item as Record<string, unknown>).url),
    )
    .map((item) => ({ label: text(item.label, 160) || text(item.url, 300), url: text(item.url, 300) }))
    .slice(0, 8);
}

export function normalizeRulePack(value: unknown): PlatformRulePack | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const id = text(raw.id, 60);
  const label = text(raw.label, 80);
  if (!id || !label) return null;
  const orientation =
    raw.orientation === 'vertical' || raw.orientation === 'horizontal' ? raw.orientation : 'any';
  const minHeight = Math.max(240, Math.min(8_640, Math.round(Number(raw.minHeight) || 720)));
  const duration = (key: string): number | undefined => {
    const numeric = Number(raw[key]);
    return Number.isFinite(numeric) && numeric > 0 ? Math.min(86_400, Math.round(numeric)) : undefined;
  };
  const maxFileSizeMb = Number(raw.maxFileSizeMb);
  const maxDurationSeconds = duration('maxDurationSeconds');
  const minDurationSeconds = duration('minDurationSeconds');
  return {
    id,
    label,
    version: text(raw.version, 40) || 'sin versión',
    updatedAt: text(raw.updatedAt, 40),
    orientation,
    minHeight,
    ...(maxDurationSeconds !== undefined ? { maxDurationSeconds } : {}),
    ...(minDurationSeconds !== undefined ? { minDurationSeconds } : {}),
    ...(Number.isFinite(maxFileSizeMb) && maxFileSizeMb > 0
      ? { maxFileSizeMb: Math.min(100_000, Math.round(maxFileSizeMb)) }
      : {}),
    requiresAiDisclosure: Boolean(raw.requiresAiDisclosure),
    requiresMusicLicense: Boolean(raw.requiresMusicLicense),
    monetization: stringList(raw.monetization),
    strikeRisks: stringList(raw.strikeRisks),
    sources: sourcesList(raw.sources),
  };
}

export function parseRulesDocument(value: unknown): PlatformRulesDocument | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (raw.schema !== RULES_SCHEMA || !Array.isArray(raw.packs)) return null;
  const packs = raw.packs
    .map(normalizeRulePack)
    .filter((pack): pack is PlatformRulePack => Boolean(pack))
    .slice(0, 32);
  return {
    schema: RULES_SCHEMA,
    generatedAt: text(raw.generatedAt, 40),
    packs,
  };
}

export function mergeRulePacks(
  base: readonly PlatformRulePack[],
  remote: readonly PlatformRulePack[],
): PlatformRulePack[] {
  const byId = new Map(base.map((pack) => [pack.id, pack]));
  for (const pack of remote) {
    if (byId.has(pack.id) || pack.sources.length > 0) byId.set(pack.id, pack);
  }
  return [...byId.values()].sort((left, right) => left.label.localeCompare(right.label, 'es'));
}

function bytesOfProject(project: ProjectDocument): number {
  return project.assets.reduce((total, asset) => {
    const bytes = 'integrity' in asset ? asset.integrity?.bytes : undefined;
    return total + (typeof bytes === 'number' ? bytes : 0);
  }, 0);
}

export function auditProjectForPlatform(
  project: ProjectDocument,
  pack: PlatformRulePack,
): RuleFinding[] {
  const fps = Math.max(
    1,
    project.video.frameRate.num / Math.max(1, project.video.frameRate.den),
  );
  const duration = totalProjectDuration(project) / fps;
  const vertical = project.video.height > project.video.width;
  const height = Math.min(project.video.width, project.video.height);
  const unknownLicenses = project.assets.filter(
    (asset) => asset.rights.license.commercialUse === 'unknown',
  ).length;
  const aiAssets = project.assets.filter((asset) =>
    ['generated-by-provider', 'generated-locally'].includes(asset.rights.provenance.origin),
  ).length;
  const audioAssets = project.assets.filter((asset) => asset.kind === 'audio').length;
  const duplicateHashes = new Map<string, number>();
  for (const asset of project.assets) {
    const hash = 'integrity' in asset ? asset.integrity?.sha256 : undefined;
    if (hash) duplicateHashes.set(hash, (duplicateHashes.get(hash) ?? 0) + 1);
  }
  const duplicateGroups = [...duplicateHashes.values()].filter((count) => count > 1).length;
  const sizeMb = bytesOfProject(project) / 1_000_000;
  const findings: RuleFinding[] = [];

  if (unknownLicenses > 0) {
    findings.push({
      id: 'licenses',
      severity: 'block',
      title: 'Derechos sin resolver',
      detail: `${unknownLicenses} medio(s) tienen licencia desconocida. Confirmá los derechos antes de exportar.`,
      ...(pack.sources[0] ? { source: pack.sources[0] } : {}),
    });
  } else {
    findings.push({
      id: 'licenses',
      severity: 'ok',
      title: 'Derechos declarados',
      detail: 'Todos los medios tienen una licencia declarada.',
    });
  }

  if (project.assets.some((asset) => asset.status !== 'ready')) {
    findings.push({
      id: 'assets',
      severity: 'warn',
      title: 'Material sin verificar',
      detail: 'Hay medios que todavía no están marcados como listos.',
    });
  }

  if (duplicateGroups > 0) {
    findings.push({
      id: 'duplicates',
      severity: 'warn',
      title: 'Material duplicado',
      detail: `${duplicateGroups} grupo(s) de archivos idénticos. Las plataformas suelen tratar la reutilización como riesgo.`,
    });
  }

  if (pack.orientation !== 'any' && (pack.orientation === 'vertical') !== vertical) {
    findings.push({
      id: 'orientation',
      severity: 'warn',
      title: 'Formato poco compatible',
      detail: pack.orientation === 'vertical'
        ? 'La plataforma prioriza 9:16. Este proyecto no es vertical.'
        : 'La plataforma prioriza horizontal. Este proyecto es vertical.',
    });
  }

  if (height < pack.minHeight) {
    findings.push({
      id: 'height',
      severity: 'warn',
      title: 'Resolución baja',
      detail: `El proyecto mide ${project.video.width}×${project.video.height}; la referencia es ${pack.minHeight}p como mínimo.`,
    });
  }

  if (pack.maxDurationSeconds !== undefined && duration > pack.maxDurationSeconds) {
    findings.push({
      id: 'duration-max',
      severity: 'warn',
      title: 'Duración fuera del formato',
      detail: `Dura ${Math.round(duration)} s; la referencia para ${pack.label} es hasta ${pack.maxDurationSeconds} s.`,
    });
  }

  if (pack.minDurationSeconds !== undefined && duration < pack.minDurationSeconds) {
    findings.push({
      id: 'duration-min',
      severity: 'info',
      title: 'Duración por debajo de la referencia',
      detail: `Dura ${Math.round(duration)} s; algunos programas de ${pack.label} piden al menos ${pack.minDurationSeconds} s.`,
    });
  }

  if (pack.maxFileSizeMb !== undefined && sizeMb > pack.maxFileSizeMb) {
    findings.push({
      id: 'size',
      severity: 'warn',
      title: 'Tamaño alto',
      detail: `Los medios suman ${sizeMb.toFixed(1)} MB; la referencia es hasta ${pack.maxFileSizeMb} MB.`,
    });
  }

  if (pack.requiresAiDisclosure && aiAssets > 0) {
    const source =
      pack.sources.find((item) => /ia|synthetic|generad/i.test(item.label)) ?? pack.sources[0];
    findings.push({
      id: 'ai-disclosure',
      severity: 'warn',
      title: 'Divulgación de IA',
      detail: `${aiAssets} medio(s) son generados o alterados por IA. Marcá esa divulgación al publicar.`,
      ...(source ? { source } : {}),
    });
  }

  if (pack.requiresMusicLicense && audioAssets > 0) {
    const source = pack.sources.find((item) => /música|music/i.test(item.label)) ?? pack.sources[0];
    findings.push({
      id: 'music',
      severity: 'info',
      title: 'Música y voz',
      detail: `${audioAssets} archivo(s) de audio. Confirmá que la música y las voces tengan derechos comerciales para esta plataforma.`,
      ...(source ? { source } : {}),
    });
  }

  if (project.captions.cues.length === 0) {
    findings.push({
      id: 'captions',
      severity: 'info',
      title: 'Sin subtítulos',
      detail: 'Los subtítulos mejoran accesibilidad y retención. Podés generarlos desde el guion o importar SRT.',
    });
  }

  findings.push({
    id: 'review',
    severity: 'info',
    title: 'Revisá la política vigente',
    detail: 'Las reglas cambian. Esto es una ayuda de preflight, no una garantía de monetización ni de ausencia de strikes.',
    ...(pack.sources[0] ? { source: pack.sources[0] } : {}),
  });

  return findings;
}
