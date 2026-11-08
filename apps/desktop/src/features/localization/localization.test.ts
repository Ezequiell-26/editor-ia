import { describe, expect, it } from 'vitest';
import {
  CLONE_LANGUAGES,
  CLONE_LANGUAGE_CODES,
  DUBBING_LANGUAGES,
  DUBBING_LANGUAGE_CODES,
  LOCALIZATION_LANGUAGES,
  chunkCues,
  estimateLocalizationTokens,
  formatLocalizationBytes,
  isLocalProviderBaseUrl,
  localizationFileName,
  localizationLanguage,
  subtitleTexts,
} from './localization';

const cue = (text: string, start = 0) => ({
  startSeconds: start,
  endSeconds: start + 1,
  text,
});

describe('Localization Studio helpers', () => {
  it('ofrece los doce idiomas del backend y encuentra uno por código', () => {
    expect(LOCALIZATION_LANGUAGES.map((language) => language.code)).toEqual([
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
      'ja',
    ]);
    expect(localizationLanguage('ar')?.direction).toBe('rtl');
    expect(localizationLanguage('ja')?.native).toBe('日本語');
    expect(localizationLanguage('tl')).toBeNull();
  });

  it('el doblaje SAPI excluye japonés y la clonación excluye bengalí', () => {
    // Espejo de commands/dubbing.rs::normalize_language (sin `ja`) y de
    // commands/voice_clone.rs::CLONE_LANGUAGES (sin `bn` entre los 12).
    expect(DUBBING_LANGUAGE_CODES.has('ja')).toBe(false);
    expect(DUBBING_LANGUAGE_CODES.has('bn')).toBe(true);
    expect(DUBBING_LANGUAGES).toHaveLength(11);
    expect(CLONE_LANGUAGE_CODES.has('bn')).toBe(false);
    expect(CLONE_LANGUAGE_CODES.has('ja')).toBe(true);
    expect(CLONE_LANGUAGES).toHaveLength(11);
    expect(CLONE_LANGUAGES.every((language) => language.code !== 'bn')).toBe(true);
  });

  it('divide por cantidad de cues y por caracteres sin perder el orden', () => {
    const cues = Array.from({ length: 5 }, (_, index) => cue(`Texto ${index}`, index));
    const byCount = chunkCues(cues, 2, 10_000);
    expect(byCount.map((chunk) => chunk.cues.length)).toEqual([2, 2, 1]);
    expect(byCount.map((chunk) => chunk.offset)).toEqual([0, 2, 4]);

    const byChars = chunkCues(cues, 80, 12);
    expect(byChars.every((chunk) => chunk.cues.length >= 1)).toBe(true);
    expect(byChars.flatMap((chunk) => chunk.cues)).toEqual(cues);
    expect(chunkCues([])).toEqual([]);
  });

  it('estima tokens y formatea bytes sin inventar precios', () => {
    expect(estimateLocalizationTokens(0)).toBe(1);
    expect(estimateLocalizationTokens(4_001)).toBe(1_001);
    expect(formatLocalizationBytes(2_048)).toBe('2 KB');
    expect(formatLocalizationBytes(1_048_576)).toBe('1.00 MB');
  });

  it('detecta proveedores locales sólo en loopback exacto', () => {
    expect(isLocalProviderBaseUrl('http://127.0.0.1:11434/v1')).toBe(true);
    expect(isLocalProviderBaseUrl('http://localhost:1234/v1')).toBe(true);
    expect(isLocalProviderBaseUrl('http://[::1]:11434/v1')).toBe(true);
    expect(isLocalProviderBaseUrl('https://api.openai.com/v1')).toBe(false);
    expect(isLocalProviderBaseUrl('http://127.0.0.1.evil.example/v1')).toBe(false);
    expect(isLocalProviderBaseUrl('no es una url')).toBe(false);
  });

  it('arma nombres de archivo seguros y conserva el código de idioma', () => {
    expect(localizationFileName('Mi Video: Ñandú / 2026', 'en', 'srt')).toBe(
      'mi-video-nandu-2026.en.srt',
    );
    expect(localizationFileName('   ', 'zh', 'vtt')).toBe('subtitulos.zh.vtt');
    expect(subtitleTexts([cue(' Uno '), cue('Dos')])).toEqual(['Uno', 'Dos']);
  });
});
