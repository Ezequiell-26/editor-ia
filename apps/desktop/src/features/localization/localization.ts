import type { SubtitleCueSeconds } from '../../state/subtitles';

export type LocalizationLanguageCode = 'es' | 'en' | 'zh' | 'hi' | 'ar' | 'pt' | 'bn' | 'ru';
export type LocalizationFormat = 'srt' | 'vtt';

export interface LocalizationLanguage {
  readonly code: LocalizationLanguageCode;
  readonly label: string;
  readonly native: string;
  readonly direction: 'ltr' | 'rtl';
}

/**
 * Los ocho idiomas con más hablantes nativos. El orden no es un ranking de
 * calidad: el traductor recibe el nombre completo del idioma en el prompt.
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
];

export function localizationLanguage(code: string): LocalizationLanguage | null {
  return LOCALIZATION_LANGUAGES.find((language) => language.code === code) ?? null;
}

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
