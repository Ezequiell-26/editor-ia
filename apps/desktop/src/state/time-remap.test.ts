import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SpeedCurve } from '@editor-ia/project-schema';
import { buildTimeRemap, clipTimeRemap } from './time-remap';

/**
 * El runner puede ejecutar con cwd de apps/desktop o de la raíz del monorepo
 * (suite raíz). Se busca el fixture hacia arriba en vez de asumir una base.
 */
function fixturePath(): string {
  const relative = join('packages', 'project-schema', 'fixtures', 'time-remap.fixture.json');
  let current = resolve(process.cwd());
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = join(current, relative);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error(`No se encontró ${relative} desde ${process.cwd()}`);
}

function curve(
  points: readonly { t: number; speed: number }[],
): SpeedCurve {
  return { points: points.map((point) => ({ ...point })) };
}

describe('remap de velocidad por frame', () => {
  it('reproduce el fixture compartido con Rust', () => {
    // El cwd depende del runner; fixturePath busca la raíz del monorepo.
    const fixture = JSON.parse(readFileSync(fixturePath(), 'utf8')) as {
      cases: {
        name: string;
        curve: SpeedCurve;
        durationFrames: number;
        sourceFrames: number;
        sourceFramesAt: number[];
        timelineFrames: number[];
      }[];
    };
    for (const item of fixture.cases) {
      const remap = buildTimeRemap(item.curve, item.durationFrames, item.sourceFrames);
      expect(
        Array.from({ length: item.durationFrames }, (_, local) => remap.sourceFrameAt(local)),
        item.name,
      ).toEqual(item.sourceFramesAt);
      expect(remap.timelineFrames, item.name).toEqual(item.timelineFrames);
    }
  });

  it('reproduce el ejemplo dorado del diseño (D=100, S=88, k=60 → 32)', () => {
    const remap = buildTimeRemap(
      curve([
        { t: 0, speed: 0.5 },
        { t: 0.5, speed: 0.5 },
        { t: 1, speed: 2 },
      ]),
      100,
      88,
    );
    expect(remap.averageSpeed).toBeCloseTo(0.88, 9);
    expect(remap.sourceFrameAt(60)).toBe(32);
    expect(remap.sourceFrameAt(0)).toBe(0);
    expect(remap.sourceFrameAt(99)).toBe(87);
    expect(remap.timelineFrames).toHaveLength(88);
    expect(remap.identity).toBe(false);
  });

  it('es monótono y nunca sale de la ventana de origen', () => {
    const remap = buildTimeRemap(
      curve([
        { t: 0, speed: 0.25 },
        { t: 0.35, speed: 2.5 },
        { t: 1, speed: 0.5 },
      ]),
      240,
      300,
    );
    let previous = -1;
    for (let local = 0; local < 240; local += 1) {
      const frame = remap.sourceFrameAt(local);
      expect(frame).toBeGreaterThanOrEqual(previous);
      expect(frame).toBeGreaterThanOrEqual(0);
      expect(frame).toBeLessThan(300);
      previous = frame;
    }
  });

  it('una curva constante 1× es identidad y conserva los frames actuales', () => {
    const remap = buildTimeRemap(curve([{ t: 0, speed: 1 }, { t: 1, speed: 1 }]), 100, 100);
    expect(remap.identity).toBe(true);
    for (let local = 0; local < 100; local += 1) {
      expect(remap.sourceFrameAt(local)).toBe(local);
    }
    expect(remap.sourceSecondsAt(30, 10, 30)).toBeCloseTo((10 + 30 + 0.5) / 30, 9);
  });

  it('normaliza curvas decorativas viejas a la ventana real en vez de romper', () => {
    // Curva 0,5× "decorativa" con una ventana de 50 frames: antes se ignoraba
    // (1×); ahora se escala para consumir exactamente la ventana.
    const remap = buildTimeRemap(curve([{ t: 0, speed: 0.5 }, { t: 1, speed: 0.5 }]), 100, 50);
    expect(remap.averageSpeed).toBeCloseTo(0.5, 9);
    expect(remap.sourceFrameAt(99)).toBe(49);
    expect(remap.sourceFrameAt(0)).toBe(0);
  });

  it('clipTimeRemap sólo se activa en video con curva y ventana válida', () => {
    const speedCurve = curve([{ t: 0, speed: 0.5 }, { t: 1, speed: 2 }]);
    expect(
      clipTimeRemap({
        kind: 'video',
        durationFrames: 100,
        speedCurve,
        source: { inFrame: 10, outFrame: 98 },
      })?.sourceFrameAt(0),
    ).toBe(0);
    expect(
      clipTimeRemap({
        kind: 'audio',
        durationFrames: 100,
        speedCurve,
        source: { inFrame: 10, outFrame: 98 },
      }),
    ).toBeNull();
    expect(
      clipTimeRemap({
        kind: 'video',
        durationFrames: 100,
        speedCurve,
        source: { inFrame: 10, outFrame: 10 },
      }),
    ).toBeNull();
  });
});
