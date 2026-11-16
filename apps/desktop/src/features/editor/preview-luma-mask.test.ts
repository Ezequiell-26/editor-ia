import { describe, expect, it } from 'vitest';
import {
  createEmptyProject,
  type Asset,
  type Clip,
  type ProjectDocument,
} from '@editor-ia/project-schema';
import {
  encodeLumaMask,
  isLumaWipeClip,
  lumaMaskSources,
  lumaMaskStyle,
} from './preview-luma-mask';

const FPS = 30;

function clip(partial: Partial<Clip> & { id: string }): Clip {
  return {
    trackId: 'v1',
    kind: 'video',
    label: partial.id,
    startFrame: 0,
    durationFrames: 300,
    source: { type: 'asset', assetId: 'a1', inFrame: 0, outFrame: 300 },
    ...partial,
  } as Clip;
}

function asset(partial: Partial<Asset> & { id: string }): Asset {
  return {
    kind: 'video',
    label: partial.id,
    source: { type: 'local', path: `media/${partial.id}.mp4` },
    status: 'ready',
    rights: { license: { commercialUse: 'allowed' } },
    ...partial,
  } as Asset;
}

function projectWith(clips: Clip[], assets: Asset[]): ProjectDocument {
  const base = createEmptyProject('Luma', '2026-01-01T00:00:00.000Z');
  return {
    ...base,
    assets,
    timeline: {
      tracks: [{ id: 'v1', kind: 'video', label: 'V1', order: 0, muted: false, hidden: false, locked: false }],
      clips,
    },
  } as ProjectDocument;
}

const incoming = clip({
  id: 'in',
  startFrame: 100,
  durationFrames: 60,
  transitionIn: { type: 'luma-wipe', frames: 15, mateClipId: 'mate' },
});
const mateVideo = clip({
  id: 'mate',
  startFrame: 0,
  durationFrames: 300,
  source: { type: 'asset', assetId: 'va', inFrame: 0, outFrame: 300 },
});
const videoAsset = asset({ id: 'va' });

describe('lumaMaskSources', () => {
  it('devuelve la fuente dentro de la ventana de lead con el segundo del mate', () => {
    const project = projectWith([incoming, mateVideo], [videoAsset]);
    const sources = lumaMaskSources(project, 95, FPS);
    expect(sources).toHaveLength(1);
    const [source] = sources;
    expect(source?.clipId).toBe('in');
    expect(source?.mateClipId).toBe('mate');
    expect(source?.isVideo).toBe(true);
    // src(t) = inFrame + (t - mateStart) * speed → (0 + 95 * 1) / 30
    expect(source?.seconds).toBeCloseTo(95 / 30);
  });

  it('no devuelve nada fuera del lead ni sin mate válido', () => {
    const project = projectWith([incoming, mateVideo], [videoAsset]);
    expect(lumaMaskSources(project, 80, FPS)).toEqual([]); // antes del lead
    expect(lumaMaskSources(project, 100, FPS)).toEqual([]); // clip ya empezó
    expect(lumaMaskSources(project, 140, FPS)).toEqual([]);

    const sinMate = projectWith([incoming], [videoAsset]);
    expect(lumaMaskSources(sinMate, 95, FPS)).toEqual([]);

    const mateOff = clip({ ...mateVideo, enabled: false });
    const disabled = projectWith([incoming, mateOff], [videoAsset]);
    expect(lumaMaskSources(disabled, 95, FPS)).toEqual([]);

    const assetOff = asset({ id: 'va', status: 'unverified' });
    const notReady = projectWith([incoming, mateVideo], [assetOff]);
    expect(lumaMaskSources(notReady, 95, FPS)).toEqual([]);
  });

  it('aplica inFrame y speed del mate como el renderer', () => {
    const mate = clip({
      id: 'mate',
      startFrame: 10,
      durationFrames: 300,
      speed: { num: 2, den: 1 },
      source: { type: 'asset', assetId: 'va', inFrame: 30, outFrame: 600 },
    });
    const project = projectWith([incoming, mate], [videoAsset]);
    const [source] = lumaMaskSources(project, 95, FPS);
    // (30 + (95 - 10) * 2) / 30 = 200 / 30
    expect(source?.seconds).toBeCloseTo(200 / 30);
  });

  it('mate imagen da segundos 0 y isVideo false', () => {
    const imageMate = clip({
      id: 'mate',
      kind: 'image',
      source: { type: 'asset', assetId: 'ia' },
    });
    const imageAsset = asset({ id: 'ia', kind: 'image' });
    const project = projectWith([incoming, imageMate], [imageAsset]);
    const [source] = lumaMaskSources(project, 95, FPS);
    expect(source?.isVideo).toBe(false);
    expect(source?.seconds).toBe(0);
  });
});

describe('encodeLumaMask', () => {
  it('negro → alfa 0, blanco → alfa 255, color → Rec.601', () => {
    const px = new Uint8ClampedArray([
      0, 0, 0, 255, // negro
      255, 255, 255, 255, // blanco
      255, 0, 0, 255, // rojo puro
    ]);
    const out = encodeLumaMask(px);
    expect(Array.from(out.slice(0, 4))).toEqual([0, 0, 0, 0]);
    expect(Array.from(out.slice(4, 8))).toEqual([255, 255, 255, 255]);
    // 0.299 * 255 ≈ 76.2 → 76 en los cuatro canales.
    expect(Array.from(out.slice(8, 12))).toEqual([76, 76, 76, 76]);
  });
});

describe('isLumaWipeClip / lumaMaskStyle', () => {
  it('reconoce sólo transitionIn luma-wipe', () => {
    expect(isLumaWipeClip(incoming)).toBe(true);
    expect(
      isLumaWipeClip(
        clip({ id: 'd', transitionIn: { type: 'dissolve', frames: 10 } }),
      ),
    ).toBe(false);
    expect(isLumaWipeClip(clip({ id: 'n' }))).toBe(false);
  });

  it('arma el mask-image con la data URL', () => {
    const style = lumaMaskStyle('data:image/png;base64,AAAA');
    expect(style.maskImage).toBe('url(data:image/png;base64,AAAA)');
    expect(style.maskSize).toBe('100% 100%');
    expect(style.maskRepeat).toBe('no-repeat');
  });
});
