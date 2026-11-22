import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALL_EFFECTS } from './catalog/index.ts';
import { compileAudioInstance, compileInstance, effectRegistry } from './index.ts';
import { createInstance } from './stack.ts';

const FF = join(
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
const HAS_FFMPEG = existsSync(FF);

describe('sonda ffmpeg real por efecto', () => {
  it.skipIf(!HAS_FFMPEG)(
    'toda cadena de video compila a filtros que el FFmpeg bundled acepta',
    () => {
    const failures: string[] = [];
    let probed = 0;
    for (const manifest of ALL_EFFECTS) {
      if (manifest.kind !== 'video' || !manifest.ffmpeg?.chain?.length) continue;
      const compiled = compileInstance(effectRegistry, createInstance(manifest));
      for (const step of compiled.steps) {
        if (step.kind !== 'filters') continue;
        for (const filter of step.filters) {
          probed += 1;
          const run = spawnSync(
            FF,
            [
              '-hide_banner',
              '-loglevel',
              'error',
              '-f',
              'lavfi',
              '-i',
              'testsrc=size=160x120:rate=10:duration=0.2',
              '-vf',
              filter,
              '-frames:v',
              '3',
              '-f',
              'null',
              '-',
            ],
            { encoding: 'utf8', timeout: 30_000 },
          );
          if (run.status !== 0) {
            const tail = (run.stderr ?? '').trim().split('\n').slice(-2).join(' / ');
            failures.push(`${manifest.id} | ${filter} | ${tail}`);
          }
        }
      }
    }
    expect(probed).toBeGreaterThan(50);
    expect(failures, `\n${failures.join('\n')}`).toEqual([]);
    },
    240_000,
  );

  it.skipIf(!HAS_FFMPEG)(
    'toda cadena de audio compila a filtros que el FFmpeg bundled acepta',
    () => {
      const failures: string[] = [];
      let probed = 0;
      for (const manifest of ALL_EFFECTS) {
        if (manifest.kind !== 'audio') continue;
        const compiled = compileAudioInstance(effectRegistry, createInstance(manifest));
        if (compiled.filters.length === 0) continue;
        probed += 1;
        const run = spawnSync(
          FF,
          [
            '-hide_banner',
            '-loglevel',
            'error',
            '-f',
            'lavfi',
            '-i',
            'sine=frequency=440:sample_rate=48000:duration=0.3',
            '-af',
            compiled.filters.join(','),
            '-t',
            '0.2',
            '-f',
            'null',
            '-',
          ],
          { encoding: 'utf8', timeout: 30_000 },
        );
        if (run.status !== 0) {
          const tail = (run.stderr ?? '').trim().split('\n').slice(-2).join(' / ');
          failures.push(`${manifest.id} | ${compiled.filters.join(',')} | ${tail}`);
        }
      }
      expect(probed).toBeGreaterThan(25);
      expect(failures, `\n${failures.join('\n')}`).toEqual([]);
    },
    120_000,
  );

  it.skipIf(!HAS_FFMPEG)(
    'todo grafo de video compila a un filter_complex que el FFmpeg bundled acepta',
    () => {
      const failures: string[] = [];
      let probed = 0;
      for (const manifest of ALL_EFFECTS) {
        if (manifest.kind !== 'video') continue;
        const compiled = compileInstance(effectRegistry, createInstance(manifest));
        for (const step of compiled.steps) {
          if (step.kind !== 'graph') continue;
          probed += 1;
          // El renderer nativo expande `%A%` a un prefijo único por intento;
          // para la sonda basta un prefijo fijo (`p`) — las etiquetas quedan
          // válidas y el pad de salida sin etiqueta se auto-conecta.
          const graph = `[0:v]${step.template.replaceAll('%A%', 'p')}`;
          const run = spawnSync(
            FF,
            [
              '-hide_banner',
              '-loglevel',
              'error',
              '-f',
              'lavfi',
              '-i',
              'testsrc=size=160x120:rate=10:duration=0.2',
              '-filter_complex',
              graph,
              '-frames:v',
              '3',
              '-f',
              'null',
              '-',
            ],
            { encoding: 'utf8', timeout: 60_000 },
          );
          if (run.status !== 0) {
            const tail = (run.stderr ?? '').trim().split('\n').slice(-2).join(' / ');
            failures.push(`${manifest.id} | ${graph.slice(0, 160)} | ${tail}`);
          }
        }
      }
      expect(probed).toBeGreaterThan(5);
      expect(failures, `\n${failures.join('\n')}`).toEqual([]);
    },
    240_000,
  );
});
