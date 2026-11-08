import type { SubtitleCueSeconds } from '../../state/subtitles';

export type LocalizationLanguageCode =
  | 'es'
  | 'en'
  | 'zh'
  | 'hi'
  | 'ar'
  | 'pt'
  | 'bn'
  | 'ru'
  | 'fr'
  | 'de'
  | 'it'
  | 'ja';
export type LocalizationFormat = 'srt' | 'vtt';

export interface LocalizationLanguage {
  readonly code: LocalizationLanguageCode;
  readonly label: string;
  readonly native: string;
  readonly direction: 'ltr' | 'rtl';
}

/**
 * Los idiomas que `translate_subtitles` acepta en Rust
 * (`commands/providers.rs::language_name`): los ocho con más hablantes
 * nativos más francés, alemán, italiano y japonés, que Descargar ya ofrece.
 * El orden no es un ranking de calidad: el traductor recibe el nombre
 * completo del idioma en el prompt.
 */
export const LOCALIZATION_LANGUAGES: readonly LocalizationLanguage[] = [
  { code: 'es', label: 'Español', native: 'Español', direction: 'ltr' },
  { code: 'en', label: 'Inglés', native: 'English', direction: 'ltr' },
  { code: 'zh', label: 'Chino', native: '普通话', direction: 'ltr' },
  { code: 'hi', label: 'Hindi', native: 'हिन्दी', direction: 'ltr' },
  { code: 'ar', label: 'Árabe', native: 'العربية', direction: 'rtl' },
  { code: 'pt', label: 'Portugués', native: 'Português', direction: 'ltr' },
  { code: 'bn', label: 'Bengalí', native: 'বাংলা', direction: 'ltr' },
  { code: 'ru', label: 'Ruso', native: 'Русский', direction: 'ltr' },
  { code: 'fr', label: 'Francés', native: 'Français', direction: 'ltr' },
  { code: 'de', label: 'Alemán', native: 'Deutsch', direction: 'ltr' },
  { code: 'it', label: 'Italiano', native: 'Italiano', direction: 'ltr' },
  { code: 'ja', label: 'Japonés', native: '日本語', direction: 'ltr' },
];

export function localizationLanguage(code: string): LocalizationLanguage | null {
  return LOCALIZATION_LANGUAGES.find((language) => language.code === code) ?? null;
}

/**
 * Idiomas que `synthesize_dub` acepta (`commands/dubbing.rs::normalize_language`):
 * todos los de traducción menos `ja`, que SAPI no tiene mapeado en el backend.
 */
export const DUBBING_LANGUAGE_CODES: ReadonlySet<LocalizationLanguageCode> = new Set([
  'es',
  'en',
  'zh',
  'hi',
  'ar',
  'pt',
  'bn',
  'ru',
  'fr',
  'de',
  'it',
]);

export function isDubbingLanguage(code: string): boolean {
  return DUBBING_LANGUAGE_CODES.has(code as LocalizationLanguageCode);
}

/**
 * Idiomas que `clone_voice` acepta (`commands/voice_clone.rs::CLONE_LANGUAGES`)
 * entre los de esta lista: todos menos `bn`, que el motor local no soporta.
 */
export const CLONE_LANGUAGE_CODES: ReadonlySet<LocalizationLanguageCode> = new Set([
  'es',
  'en',
  'zh',
  'hi',
  'ar',
  'pt',
  'ru',
  'fr',
  'de',
  'it',
  'ja',
]);

export const DUBBING_LANGUAGES: readonly LocalizationLanguage[] = LOCALIZATION_LANGUAGES.filter(
  (language) => DUBBING_LANGUAGE_CODES.has(language.code),
);

export const CLONE_LANGUAGES: readonly LocalizationLanguage[] = LOCALIZATION_LANGUAGES.filter(
  (language) => CLONE_LANGUAGE_CODES.has(language.code),
);

export interface TranslationChunk {
  readonly offset: number;
  readonly cues: readonly SubtitleCueSeconds[];
  readonly characters: number;
}

/**
 * Divide por cantidad de cues y por caracteres para no mandar un archivo
 * completo en una sola llamada: menos riesgo de truncado y menos tokens
 * desperdiciados si el proveedor falla a mitad de camino.
 */
export function chunkCues(
  cues: readonly SubtitleCueSeconds[],
  maxCues = 80,
  maxChars = 6_000,
): TranslationChunk[] {
  if (cues.length === 0) return [];
  const limitCues = Math.max(1, Math.floor(maxCues));
  const limitChars = Math.max(200, Math.floor(maxChars));
  const chunks: TranslationChunk[] = [];
  let offset = 0;
  let current: SubtitleCueSeconds[] = [];
  let characters = 0;
  const flush = () => {
    if (current.length === 0) return;
    chunks.push({ offset, cues: current, characters });
    offset += current.length;
    current = [];
    characters = 0;
  };
  for (const cue of cues) {
    const size = cue.text.trim().length;
    if (
      current.length > 0 &&
      (current.length >= limitCues || characters + size > limitChars)
    ) {
      flush();
    }
    current.push(cue);
    characters += size;
    if (current.length >= limitCues) flush();
  }
  flush();
  return chunks;
}

export function subtitleTexts(cues: readonly SubtitleCueSeconds[]): string[] {
  return cues.map((cue) => cue.text.trim());
}

export function estimateLocalizationTokens(characters: number): number {
  return Math.max(1, Math.ceil(Math.max(0, characters) / 4));
}

export function formatLocalizationBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(2)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Los proveedores en loopback no gastan cuota remota ni exigen autorización. */
export function isLocalProviderBaseUrl(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl.trim());
    if (url.username || url.password) return false;
    return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}

export function localizationFileName(baseName: string, language: string, format: LocalizationFormat): string {
  const stem = baseName
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${stem || 'subtitulos'}.${language}.${format}`;
}
