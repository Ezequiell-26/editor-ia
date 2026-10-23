import { describe, expect, it } from 'vitest';
import {
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
  it('ofrece los ocho idiomas y encuentra uno por código', () => {
    expect(LOCALIZATION_LANGUAGES.map((language) => language.code)).toEqual([
      'es',
      'en',
      'zh',
      'hi',
      'ar',
      'pt',
      'bn',
      'ru',
    ]);
    expect(localizationLanguage('ar')?.direction).toBe('rtl');
    expect(localizationLanguage('fr')).toBeNull();
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
