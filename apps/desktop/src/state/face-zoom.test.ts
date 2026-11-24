import { describe, expect, it } from 'vitest';
import {
  computeFaceCenteredOffsets,
  applyFaceCenteredZoom,
  TALKING_HEAD_DEFAULT_FACE,
} from './face-zoom';
import {
  addAsset,
  addClipFromAsset,
  addTrack,
} from './project-actions';
import { createEmptyProject, type Asset } from '@editor-ia/project-schema';

const NOW = '2026-11-23T18:00:00.000Z';

function sampleAsset(): Asset {
  return {
    id: 'asset-video-1',
    label: 'Talking Head Video.mp4',
    kind: 'video',
    status: 'ready',
    source: { type: 'local', path: 'videos/talking.mp4' },
    integrity: { sha256: 'a'.repeat(64), bytes: 10_000 },
    rights: {
      license: { id: 'owned', commercialUse: 'allowed' },
      provenance: { origin: 'user-imported', acquiredAt: NOW },
    },
    media: {
      durationFrames: 300,
      width: 1920,
      height: 1080,
      frameRate: { num: 30, den: 1 },
      channels: 2,
    },
  } as Asset;
}

describe('computeFaceCenteredOffsets', () => {
  it('retorna 0 si la escala es <= 1 o dimensiones inválidas', () => {
    const zero = computeFaceCenteredOffsets({
      canvasWidth: 1920,
      canvasHeight: 1080,
      face: TALKING_HEAD_DEFAULT_FACE,
      scale: 1,
    });
    expect(zero.offsetX).toBe(0);
    expect(zero.offsetY).toBe(0);
  });

  it('centra un rostro ubicado en el tercio superior (y=0.35) hacia el objetivo y=0.40', () => {
    const offsets = computeFaceCenteredOffsets({
      canvasWidth: 1920,
      canvasHeight: 1080,
      face: { centerX: 0.5, centerY: 0.35 },
      scale: 1.25,
      targetY: 0.4,
      targetX: 0.5,
    });
    // Con cara en y=0.35, el zoom la empuja arriba. El offset Y debe ser positivo (hacia abajo)
    // para reubicar la cara en el encuadre natural sin decapitar la cabeza.
    expect(offsets.offsetX).toBe(0);
    expect(offsets.offsetY).toBeGreaterThan(0);
    expect(offsets.offsetY).toBeLessThanOrEqual(offsets.maxOffsetY);
    // Verificamos que sea entero para el esquema Zod
    expect(Number.isInteger(offsets.offsetY)).toBe(true);
  });

  it('panea a la izquierda si el sujeto está a la derecha del centro (x=0.65)', () => {
    const offsets = computeFaceCenteredOffsets({
      canvasWidth: 1920,
      canvasHeight: 1080,
      face: { centerX: 0.65, centerY: 0.4 },
      scale: 1.3,
      targetX: 0.5,
    });
    // Sujeto a la derecha -> desplaza el video a la izquierda (offsetX negativo)
    expect(offsets.offsetX).toBeLessThan(0);
    expect(Math.abs(offsets.offsetX)).toBeLessThanOrEqual(offsets.maxOffsetX);
    expect(Number.isInteger(offsets.offsetX)).toBe(true);
  });

  it('clampea rigurosamente para no revelar bordes negros al desbordar', () => {
    const offsets = computeFaceCenteredOffsets({
      canvasWidth: 1920,
      canvasHeight: 1080,
      face: { centerX: 0.99, centerY: 0.01 }, // extremo de la pantalla
      scale: 1.2,
    });
    // Debe quedar exactamente limitado por maxOffsetX / maxOffsetY
    expect(Math.abs(offsets.offsetX)).toBe(offsets.maxOffsetX);
    expect(Math.abs(offsets.offsetY)).toBe(offsets.maxOffsetY);
  });
});

describe('applyFaceCenteredZoom', () => {
  it('aplica zoom punch-in sostenido encuadrando el rostro', () => {
    const asset = sampleAsset();
    let project = addAsset(createEmptyProject('Zoom Test', NOW), asset);
    const track = addTrack(project, 'video', 'Video');
    project = track.project;
    const added = addClipFromAsset(project, asset, {
      trackId: track.trackId,
      atFrame: 0,
      inFrame: 0,
      outFrame: 120,
    });
    project = added.project;

    const result = applyFaceCenteredZoom(project, {
      clipId: added.clipId,
      scale: 1.25,
      style: 'punch-in',
      face: { centerX: 0.5, centerY: 0.32 },
    });

    expect(result.peakScale).toBe(1.25);
    expect(result.offsetY).toBeGreaterThan(0);
    const clip = result.project.timeline.clips.find((c) => c.id === added.clipId)!;
    expect(clip.transform?.keyframes).toBeDefined();
    expect(clip.transform!.keyframes!.length).toBe(2);
    // Primer keyframe
    expect(clip.transform!.keyframes![0]!.scale).toBe(1.25);
    expect(clip.transform!.keyframes![0]!.offsetY).toBe(result.offsetY);
    expect(clip.transform!.keyframes![0]!.frame).toBe(0);
    // Último keyframe mantiene el encuadre
    expect(clip.transform!.keyframes![1]!.scale).toBe(1.25);
    expect(clip.transform!.keyframes![1]!.offsetY).toBe(result.offsetY);
  });

  it('aplica snap-settle con desaceleración y vuelta elástica', () => {
    const asset = sampleAsset();
    let project = addAsset(createEmptyProject('Zoom Test', NOW), asset);
    const track = addTrack(project, 'video', 'Video');
    project = track.project;
    const added = addClipFromAsset(project, asset, {
      trackId: track.trackId,
      atFrame: 0,
      inFrame: 0,
      outFrame: 90,
    });
    project = added.project;

    const result = applyFaceCenteredZoom(project, {
      clipId: added.clipId,
      zoomStrength: 80,
      style: 'snap-settle',
      settleFrames: 15,
    });

    expect(result.peakScale).toBeGreaterThan(1.15);
    const clip = result.project.timeline.clips.find((c) => c.id === added.clipId)!;
    const keyframes = clip.transform!.keyframes!;
    expect(keyframes.length).toBeGreaterThanOrEqual(2);
    // Frame 0 tiene el pico de escala y offset
    expect(keyframes[0]!.scale).toBe(result.peakScale);
    expect(keyframes[0]!.offsetY).toBe(result.offsetY);
    // Frame settle (15) vuelve a escala 1 y offsets 0
    expect(keyframes[1]!.frame).toBe(15);
    expect(keyframes[1]!.scale).toBe(1);
    expect(keyframes[1]!.offsetX).toBe(0);
    expect(keyframes[1]!.offsetY).toBe(0);
  });

  it('aplica slow-push cinemático que avanza progresivamente hacia el rostro', () => {
    const asset = sampleAsset();
    let project = addAsset(createEmptyProject('Zoom Test', NOW), asset);
    const track = addTrack(project, 'video', 'Video');
    project = track.project;
    const added = addClipFromAsset(project, asset, {
      trackId: track.trackId,
      atFrame: 0,
      inFrame: 0,
      outFrame: 60,
    });
    project = added.project;

    const result = applyFaceCenteredZoom(project, {
      clipId: added.clipId,
      scale: 1.3,
      style: 'slow-push',
    });

    const clip = result.project.timeline.clips.find((c) => c.id === added.clipId)!;
    const keyframes = clip.transform!.keyframes!;
    expect(keyframes).toHaveLength(2);
    // Empieza en 1.0 (neutro)
    expect(keyframes[0]!.scale).toBe(1);
    expect(keyframes[0]!.offsetX).toBe(0);
    expect(keyframes[0]!.offsetY).toBe(0);
    // Termina en pico encuadrando el rostro
    expect(keyframes[1]!.scale).toBe(1.3);
    expect(keyframes[1]!.offsetY).toBe(result.offsetY);
  });

  it('rechaza clips inexistentes o no visuales', () => {
    const project = createEmptyProject('Empty', NOW);
    expect(() =>
      applyFaceCenteredZoom(project, { clipId: 'no-existe' }),
    ).toThrow(/no existe/);
  });
});
