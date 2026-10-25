import { describe, expect, it } from 'vitest';
import type { Asset, ProjectDocument } from '@editor-ia/project-schema';
import {
  ClipSchema,
  FrameRateSchema,
  createEmptyProject,
  parseProject,
} from '@editor-ia/project-schema';
import {
  ProjectActionError,
  addAsset,
  addClipFromAsset,
  ensureDelivery,
  newId,
} from './project-actions';
import {
  MAX_RAMP_SPEED,
  MIN_RAMP_SPEED,
  SPEED_RAMP_PRESETS,
  applySpeedRampPreset,
  speedRatioOf,
} from './speed-ramp-presets';

const NOW = '2025-01-01T00:00:00.000Z';

function validated(project: ProjectDocument): ProjectDocument {
  const parsed = parseProject(project);
  if (!parsed.ok) {
    throw new Error(`proyecto inválido: ${JSON.stringify(parsed.issues)}`);
  }
  return parsed.project;
}

function base(): ProjectDocument {
  return validated(ensureDelivery(createEmptyProject('Prueba', NOW)));
}

function videoAsset(durationFrames = 300): Asset {
  return {
    id: newId(),
    label: 'Toma',
    kind: 'video',
    source: { type: 'local', path: 'media/toma.mp4' },
    status: 'ready',
    integrity: { sha256: 'a'.repeat(64), bytes: 10_000 },
    rights: {
      license: { id: 'owned', commercialUse: 'allowed' },
      provenance: { origin: 'user-imported', acquiredAt: NOW },
    },
    media: { width: 1920, height: 1080, durationFrames, frameRate: { num: 30, den: 1 } },
  } as Asset;
}

function imageAsset(): Asset {
  return {
    id: newId(),
    label: 'Imagen',
    kind: 'image',
    source: { type: 'local', path: 'media/imagen.png' },
    status: 'ready',
    integrity: { sha256: 'e'.repeat(64), bytes: 8_000 },
    rights: {
      license: { id: 'owned', commercialUse: 'allowed' },
      provenance: { origin: 'user-imported', acquiredAt: NOW },
    },
    media: { width: 1024, height: 1024 },
  } as Asset;
}

describe('presets de rampa de velocidad', () => {
  it('cada preset cubre 0..1 sin huecos ni solapes', () => {
    for (const preset of SPEED_RAMP_PRESETS) {
      expect(preset.tramos.length, preset.id).toBeGreaterThanOrEqual(2);
      let previous = 0;
      for (const tramo of preset.tramos) {
        // El primer tramo arranca en 0 (implícito) y cada `hasta` avanza de
        // forma estricta: no hay huecos ni solapes entre tramos.
        expect(tramo.hasta, preset.id).toBeGreaterThan(previous);
        expect(tramo.hasta, preset.id).toBeLessThanOrEqual(1);
        previous = tramo.hasta;
      }
      expect(previous, preset.id).toBe(1);
    }
  });

  it('las velocidades de cada preset están dentro de los límites que imponen las acciones', () => {
    for (const preset of SPEED_RAMP_PRESETS) {
      for (const tramo of preset.tramos) {
        expect(
          tramo.velocidad,
          `${preset.id}: ${tramo.velocidad}`,
        ).toBeGreaterThanOrEqual(MIN_RAMP_SPEED);
        expect(
          tramo.velocidad,
          `${preset.id}: ${tramo.velocidad}`,
        ).toBeLessThanOrEqual(MAX_RAMP_SPEED);

        // La forma racional que el aplicador deriva de la velocidad debe ser
        // válida para `FrameRateSchema` (enteros positivos num/den) y
        // representar la velocidad pedida sin deriva apreciable.
        const ratio = speedRatioOf(tramo.velocidad);
        expect(FrameRateSchema.safeParse(ratio).success, preset.id).toBe(true);
        expect(Math.abs(ratio.num / ratio.den - tramo.velocidad)).toBeLessThan(0.0005);
      }
    }
  });

  it('cada preset se traduce a tramos contiguos que el schema acepta', () => {
    // Traducción que conserva la duración: cada tramo ocupa su fracción de la
    // duración total y consume `duración x velocidad` frames de origen. Con
    // 24000 frames todas las fracciones y velocidades de los presets caen en
    // frames enteros, la condición de exactitud del schema.
    const totalFrames = 24_000;
    const trackId = newId();
    const assetId = newId();

    for (const preset of SPEED_RAMP_PRESETS) {
      const fracciones = preset.tramos.map((tramo, index) =>
        tramo.hasta - (index === 0 ? 0 : preset.tramos[index - 1]!.hasta),
      );
      const exactas = fracciones.map((fraccion) => fraccion * totalFrames);
      const durations = exactas.map((value) => Math.floor(value));
      let remaining = totalFrames - durations.reduce((sum, value) => sum + value, 0);
      const porResto = exactas
        .map((value, index) => ({ index, resto: value - Math.floor(value) }))
        .sort((a, b) => b.resto - a.resto);
      for (const { index } of porResto) {
        if (remaining <= 0) break;
        durations[index]! += 1;
        remaining -= 1;
      }
      expect(remaining, preset.id).toBe(0);

      let cursor = 0;
      let source = 0;
      const segments = preset.tramos.map((tramo, index) => {
        const duration = durations[index]!;
        const ratio = speedRatioOf(tramo.velocidad);
        const window = (duration * ratio.num) / ratio.den;
        expect(Number.isInteger(window), `${preset.id} tramo ${index + 1}`).toBe(true);

        const speed = ratio.num === ratio.den ? undefined : ratio;
        const segment = {
          id: newId(),
          trackId,
          kind: 'video' as const,
          label: `Toma · ${preset.nombre} ${index + 1}/${preset.tramos.length}`.slice(0, 200),
          startFrame: cursor,
          durationFrames: duration,
          source: {
            type: 'asset' as const,
            assetId,
            inFrame: source,
            outFrame: source + window,
          },
          ...(speed ? { speed } : {}),
        };
        // El validador por clip incluye el invariante
        // `durationFrames x speed.num = sourceFrames x speed.den`.
        expect(ClipSchema.safeParse(segment).success, `${preset.id} tramo ${index + 1}`).toBe(
          true,
        );
        cursor += duration;
        source += window;
        return segment;
      });
      expect(cursor, preset.id).toBe(totalFrames);

      // Validación de punta a punta: el documento completo con los tramos como
      // clips de la timeline pasa `parseProject` (los validadores zod canónicos).
      const document = createEmptyProject('Rampa', NOW);
      document.assets.push({
        id: assetId,
        label: 'Toma',
        kind: 'video',
        source: { type: 'local', path: 'media/toma.mp4' },
        status: 'ready',
        integrity: { sha256: 'a'.repeat(64), bytes: 10_000 },
        rights: {
          license: { id: 'owned', commercialUse: 'allowed' },
          provenance: { origin: 'user-imported', acquiredAt: NOW },
        },
        media: { width: 1920, height: 1080, durationFrames: 60_000, frameRate: { num: 30, den: 1 } },
      } as Asset);
      document.timeline.tracks.push({
        id: trackId,
        kind: 'video',
        label: 'Video',
        order: 0,
        muted: false,
        hidden: false,
        locked: false,
      });
      document.timeline.clips.push(...segments);
      const parsed = parseProject(document);
      expect(parsed.ok, preset.id).toBe(true);
    }
  });

  it('aplica cada preset a un clip real usando sólo acciones existentes', () => {
    for (const preset of SPEED_RAMP_PRESETS) {
      const asset = videoAsset(300);
      const added = addClipFromAsset(addAsset(base(), asset), asset, {
        atFrame: 0,
        durationFrames: 300,
      });

      const result = applySpeedRampPreset(added.project, added.clipId, preset);
      const parsed = parseProject(result.project);
      expect(parsed.ok, preset.id).toBe(true);
      if (!parsed.ok) continue;
      const next = parsed.project;

      const clips = next.timeline.clips
        .filter((clip) => clip.trackId === added.trackId)
        .sort((a, b) => a.startFrame - b.startFrame);
      expect(clips, preset.id).toHaveLength(preset.tramos.length);
      expect(clips.map((clip) => clip.id), preset.id).toEqual([...result.clipIds]);

      // Los tramos quedan contiguos y sin solapes en la pista.
      for (let index = 1; index < clips.length; index += 1) {
        const previous = clips[index - 1]!;
        expect(clips[index]!.startFrame, preset.id).toBe(
          previous.startFrame + previous.durationFrames,
        );
      }

      // La ventana de origen completa se conserva (el contenido no se pierde
      // ni se duplica) y las velocidades coinciden con las del preset.
      const windowOf = (clip: (typeof clips)[number]) =>
        clip.kind === 'video' || clip.kind === 'audio'
          ? clip.source.outFrame - clip.source.inFrame
          : 0;
      expect(
        clips.reduce((sum, clip) => sum + windowOf(clip), 0),
        preset.id,
      ).toBe(300);

      clips.forEach((clip, index) => {
        const expected = preset.tramos[index]!.velocidad;
        const actual =
          clip.kind === 'video' || clip.kind === 'audio'
            ? (clip.speed?.num ?? 1) / (clip.speed?.den ?? 1)
            : 1;
        expect(Math.abs(actual - expected), `${preset.id} tramo ${index + 1}`).toBeLessThan(
          1e-6,
        );
        expect(clip.label, preset.id).toContain(preset.nombre);
        expect(result.velocidades[index], preset.id).toBeCloseTo(expected, 6);
      });
    }
  });

  it('rechaza clips sin velocidad y clips demasiado cortos', () => {
    const image = imageAsset();
    const imageAdded = addClipFromAsset(addAsset(base(), image), image, { atFrame: 0 });
    const heroe = SPEED_RAMP_PRESETS.find((preset) => preset.id === 'heroe')!;
    expect(() =>
      applySpeedRampPreset(imageAdded.project, imageAdded.clipId, heroe),
    ).toThrow(ProjectActionError);

    const asset = videoAsset(300);
    const tiny = addClipFromAsset(addAsset(base(), asset), asset, {
      atFrame: 0,
      durationFrames: 4,
    });
    expect(() => applySpeedRampPreset(tiny.project, tiny.clipId, heroe)).toThrow(
      ProjectActionError,
    );
  });
});
