import { spawnSync } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AUDIO_EFFECTS } from './catalog/audio.ts';
import { compileAudioInstance } from './ffmpeg.ts';
import { createInstance } from './stack.ts';
import { effectRegistry } from './index.ts';

/**
 * Prueba real de las recetas de audio contra el FFmpeg empaquetado.
 *
 * El compilador puede producir un string sintácticamente plausible que FFmpeg
 * rechace igual (una opción fuera de rango, un filtro que no existe en el build
 * LGPL). Esta prueba ejecuta cada cadena sobre un seno de 0,2 s y exige salida
 * limpia. Se corre a pedido:
 *
 *   EDITOR_IA_RUN_AUDIO_TESTS=1 npx vitest run packages/effect-kit/src/audio-live.test.ts
 */
const FFMPEG = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  'apps',
  'desktop',
  'src-tauri',
  'resources',
  'ffmpeg',
  'ffmpeg.exe',
);

const enabled = process.env.EDITOR_IA_RUN_AUDIO_TESTS === '1' && existsSync(FFMPEG);

describe.skipIf(!enabled)('recetas de audio contra FFmpeg real', () => {
  it('las 30 cadenas se ejecutan sin errores', () => {
    const failures: string[] = [];
    for (const manifest of AUDIO_EFFECTS) {
      const compiled = compileAudioInstance(effectRegistry, createInstance(manifest));
      const chain = compiled.filters.join(',');
      const result = spawnSync(
        FFMPEG,
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-f',
          'lavfi',
          '-i',
          'sine=frequency=440:sample_rate=48000:duration=0.2',
          '-af',
          chain,
          '-f',
          'null',
          '-',
        ],
        { encoding: 'utf8' },
      );
      if (result.status !== 0) {
        failures.push(`${manifest.id}: ${(result.stderr || '').trim().split('\n')[0]}`);
      }
    }
    expect(failures).toEqual([]);
  }, 120_000);

  it('el amortiguado baja de verdad un tono agudo', () => {
    const muffled = AUDIO_EFFECTS.find((manifest) => manifest.id === 'audio.muffled');
    expect(muffled).toBeTruthy();
    if (!muffled) return;
    const chain = compileAudioInstance(effectRegistry, createInstance(muffled)).filters.join(',');
    const measure = (filter: string): number => {
      const result = spawnSync(
        FFMPEG,
        [
          '-hide_banner',
          '-f',
          'lavfi',
          '-i',
          'sine=frequency=6000:sample_rate=48000:duration=0.3',
          '-af',
          `${filter},volumedetect`,
          '-f',
          'null',
          '-',
        ],
        { encoding: 'utf8' },
      );
      const match = /mean_volume:\s*(-?[\d.]+) dB/.exec(result.stderr ?? '');
      return match ? Number(match[1]) : Number.NaN;
    };
    const before = measure('anull');
    const after = measure(chain);
    expect(Number.isFinite(before) && Number.isFinite(after)).toBe(true);
    expect(before - after).toBeGreaterThan(20);
  }, 60_000);

  it('el cambio de tono conserva la duración', () => {
    const deep = AUDIO_EFFECTS.find((manifest) => manifest.id === 'audio.voice_deep');
    expect(deep).toBeTruthy();
    if (!deep) return;
    const chain = compileAudioInstance(effectRegistry, createInstance(deep)).filters.join(',');
    const output = join(tmpdir(), `olyvia-audio-${process.pid}.wav`);
    try {
      const render = spawnSync(
        FFMPEG,
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-f',
          'lavfi',
          '-i',
          'sine=frequency=440:sample_rate=48000:duration=1',
          '-af',
          chain,
          '-y',
          output,
        ],
        { encoding: 'utf8' },
      );
      expect(render.status, render.stderr).toBe(0);
      const probe = spawnSync(
        join(FFMPEG, '..', 'ffprobe.exe'),
        ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', output],
        { encoding: 'utf8' },
      );
      const duration = Number((probe.stdout ?? '').trim());
      expect(Number.isFinite(duration)).toBe(true);
      expect(Math.abs(duration - 1)).toBeLessThan(0.05);
    } finally {
      if (existsSync(output)) unlinkSync(output);
    }
  }, 60_000);
});
