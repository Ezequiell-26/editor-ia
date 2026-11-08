import { describe, expect, it } from 'vitest';
import { createEmptyProject, type Asset, type Clip, type ProjectDocument, type Track } from '@editor-ia/project-schema';
import {
  lumaMateById,
  lumaMateCandidates,
  lumaMateFreezePlan,
  lumaMateIsStale,
  lumaMateOptionLabel,
  lumaMatePick,
  moveLumaMateToOwnTrack,
  placeFreezeMate,
} from './luma-mate';

const FPS = 30;

function track(id: string, hidden = false): Track {
  return { id, kind: 'video', label: `Pista ${id}`, order: 0, muted: false, hidden, locked: false } as Track;
}

function clip(partial: Partial<Clip> & { id: string }): Clip {
  return {
    trackId: 'v1',
    kind: 'video',
    label: partial.id,
    startFrame: 0,
    durationFrames: 30,
    source: { type: 'asset', assetId: 'a1', inFrame: 0, outFrame: 30 },
    ...partial,
  } as Clip;
}

function projectWith(clips: Clip[], tracks: Track[]): ProjectDocument {
  const base = createEmptyProject('Mate', '2026-01-01T00:00:00.000Z');
  return {
    ...base,
    timeline: { tracks, clips },
  } as ProjectDocument;
}

describe('lumaMateCandidates', () => {
  it('incluye clips que cubren el solape y descarta los que no', () => {
    const incoming = clip({ id: 'in', startFrame: 100, durationFrames: 30 });
    const mate = clip({ id: 'mate', startFrame: 90, durationFrames: 30 });
    const short = clip({ id: 'short', startFrame: 95, durationFrames: 2 });
    const audio = clip({ id: 'voice', kind: 'audio', startFrame: 0, durationFrames: 300 });
    const disabled = clip({ id: 'off', startFrame: 80, durationFrames: 50, enabled: false });
    const { timeline } = projectWith(
      [incoming, mate, short, audio, disabled],
      [track('v1'), track('v2', true)],
    );
    const candidates = lumaMateCandidates(timeline.clips, timeline.tracks, incoming, FPS);
    expect(candidates.map((c) => c.clip.id)).toEqual(['mate']);
  });

  it('descuenta el lead de entrada del mate al medir su ventana', () => {
    const incoming = clip({ id: 'in', startFrame: 100, durationFrames: 30 });
    // Sin transición el mate arrancaría en el frame 110 y no llegaría al
    // solape (needFrom=100); su transitionIn de 20 frames lo expone desde el
    // frame 90 y sí lo cubre.
    const mate = clip({
      id: 'mate',
      startFrame: 110,
      durationFrames: 60,
      transitionIn: { type: 'dissolve', frames: 20 },
    });
    const { timeline } = projectWith([incoming, mate], [track('v1')]);
    const candidates = lumaMateCandidates(timeline.clips, timeline.tracks, incoming, FPS);
    expect(candidates.map((c) => c.clip.id)).toEqual(['mate']);
    const sinLead = clip({ id: 'mate2', startFrame: 110, durationFrames: 60 });
    const { timeline: t2 } = projectWith([incoming, sinLead], [track('v1')]);
    expect(lumaMateCandidates(t2.clips, t2.tracks, incoming, FPS)).toEqual([]);
  });

  it('marca la pista oculta y la expone en la etiqueta de la opción', () => {
    const incoming = clip({ id: 'in', startFrame: 100, durationFrames: 30 });
    const mate = clip({ id: 'mate', trackId: 'v2', startFrame: 90, durationFrames: 30, label: 'Máscara' });
    const { timeline } = projectWith([incoming, mate], [track('v1'), track('v2', true)]);
    const [candidate] = lumaMateCandidates(timeline.clips, timeline.tracks, incoming, FPS);
    expect(candidate?.trackHidden).toBe(true);
    expect(candidate && lumaMateOptionLabel(candidate)).toBe('Máscara · frame 90 · Pista v2 · pista oculta');
  });
});

describe('lumaMateById', () => {
  it('devuelve el mate asignado con su pista aunque no sea candidato válido', () => {
    const incoming = clip({ id: 'in', startFrame: 100, durationFrames: 30 });
    // El mate quedó corto (no cubre el solape) pero existe: la UI igual
    // necesita su pista para ofrecer ocultarla.
    const mate = clip({ id: 'mate', trackId: 'v2', startFrame: 0, durationFrames: 10 });
    const { timeline } = projectWith([incoming, mate], [track('v1'), track('v2', true)]);
    const found = lumaMateById(timeline.clips, timeline.tracks, 'mate');
    expect(found?.clip.id).toBe('mate');
    expect(found?.track?.id).toBe('v2');
    expect(found?.trackHidden).toBe(true);
  });

  it('devuelve undefined sin id, con id inexistente o sin pista', () => {
    const { timeline } = projectWith([clip({ id: 'a' })], [track('v1')]);
    expect(lumaMateById(timeline.clips, timeline.tracks, undefined)).toBeUndefined();
    expect(lumaMateById(timeline.clips, timeline.tracks, 'nope')).toBeUndefined();
    const sinPista = clip({ id: 'b', trackId: 'vX' });
    const { timeline: t2 } = projectWith([sinPista], [track('v1')]);
    expect(lumaMateById(t2.clips, t2.tracks, 'b')?.track).toBeUndefined();
  });
});

describe('lumaMatePick', () => {
  const incoming = clip({
    id: 'in',
    startFrame: 100,
    durationFrames: 30,
    transitionIn: { type: 'luma-wipe', frames: 12, mateClipId: 'mateB' },
  });
  const mateA = clip({ id: 'mateA', startFrame: 88, durationFrames: 30 });
  const mateB = clip({ id: 'mateB', startFrame: 85, durationFrames: 40 });
  const { timeline } = projectWith([incoming, mateA, mateB], [track('v1')]);
  const candidates = lumaMateCandidates(timeline.clips, timeline.tracks, incoming, FPS);

  it('prefiere el mate que el clip ya tiene si sigue siendo candidato', () => {
    expect(lumaMatePick(incoming, undefined, candidates)).toBe('mateB');
  });

  it('el override de la vista gana sobre el mate existente', () => {
    expect(lumaMatePick(incoming, 'mateA', candidates)).toBe('mateA');
  });

  it('cae al primer candidato si ni el override ni el existente son válidos', () => {
    const stale = clip({
      id: 'in2',
      startFrame: 100,
      durationFrames: 30,
      transitionIn: { type: 'luma-wipe', frames: 12, mateClipId: 'fantasma' },
    });
    const sinTransition = clip({ id: 'in3', startFrame: 100, durationFrames: 30 });
    expect(lumaMatePick(stale, 'nope', candidates)).toBe(candidates[0]?.clip.id);
    expect(lumaMatePick(sinTransition, undefined, candidates)).toBe(candidates[0]?.clip.id);
    expect(lumaMatePick(incoming, undefined, [])).toBeUndefined();
  });
});

describe('moveLumaMateToOwnTrack', () => {
  it('crea una pista oculta propia, mueve el mate conservando su inicio y deja el resto', () => {
    const incoming = clip({ id: 'in', startFrame: 100, durationFrames: 30 });
    const mate = clip({ id: 'mate', label: 'Máscara', startFrame: 90, durationFrames: 40 });
    const otro = clip({ id: 'otro', startFrame: 0, durationFrames: 60 });
    const doc = projectWith([incoming, mate, otro], [track('v1')]);

    const next = moveLumaMateToOwnTrack(doc, 'mate');
    expect(next).not.toBeNull();
    const moved = next!.timeline.clips.find((item) => item.id === 'mate')!;
    const nueva = next!.timeline.tracks.find((item) => item.id === moved.trackId)!;
    expect(nueva.kind).toBe('video');
    expect(nueva.hidden).toBe(true);
    expect(nueva.label).toContain('Mate');
    expect(moved.startFrame).toBe(90);
    expect(moved.durationFrames).toBe(40);
    // Los demás clips quedan en su pista original.
    expect(next!.timeline.clips.find((item) => item.id === 'otro')!.trackId).toBe('v1');
  });

  it('usa pista de imagen cuando el mate es una imagen', () => {
    const mate = clip({ id: 'mate', kind: 'image', durationFrames: 60 });
    const doc = projectWith([mate], [track('v1')]);
    const next = moveLumaMateToOwnTrack(doc, 'mate');
    const moved = next!.timeline.clips.find((item) => item.id === 'mate')!;
    expect(next!.timeline.tracks.find((item) => item.id === moved.trackId)!.kind).toBe('image');
  });

  it('devuelve null con id inexistente o pista de origen bloqueada', () => {
    const mate = clip({ id: 'mate', startFrame: 0, durationFrames: 30 });
    const doc = projectWith([mate], [track('v1', false)]);
    expect(moveLumaMateToOwnTrack(doc, 'fantasma')).toBeNull();
    const bloqueada = projectWith([mate], [{ ...track('v1'), locked: true } as Track]);
    expect(moveLumaMateToOwnTrack(bloqueada, 'mate')).toBeNull();
  });
});

function videoAsset(id: string, overrides: Partial<Asset> = {}): Asset {
  return {
    id,
    kind: 'video',
    label: id,
    status: 'ready',
    source: { type: 'local', path: `media/${id}.mp4` },
    rights: { license: { id: 'user-declared', commercialUse: 'allowed' } },
    ...overrides,
  } as Asset;
}

function projectWithAssets(
  clips: Clip[],
  tracks: Track[],
  assets: Asset[],
): ProjectDocument {
  const base = projectWith(clips, tracks);
  return { ...base, assets } as ProjectDocument;
}

describe('lumaMateFreezePlan', () => {
  it('elige el clip que termina en el corte y congela su último frame compartido', () => {
    const incoming = clip({
      id: 'in',
      startFrame: 100,
      durationFrames: 30,
      transitionIn: { type: 'luma-wipe', frames: 12 },
    });
    const outgoing = clip({
      id: 'out',
      label: 'Saliente',
      startFrame: 40,
      durationFrames: 60,
      source: { type: 'asset', assetId: 'a1', inFrame: 0, outFrame: 300 },
    });
    const fondo = clip({ id: 'fondo', startFrame: 0, durationFrames: 200 });
    const doc = projectWithAssets(
      [incoming, outgoing, fondo],
      [track('v1'), track('v2')],
      [videoAsset('a1'), videoAsset('a2'), videoAsset('a3')],
    );
    // El clip fixture usa assetId 'a1' para todos; el donor real es 'out'.
    const plan = lumaMateFreezePlan(doc, incoming, FPS);
    expect(plan).not.toBeNull();
    // needFrom = 100 - 12 = 88, needTo = 100; 'out' termina en 100 (corte).
    expect(plan?.donorClipId).toBe('out');
    expect(plan?.startFrame).toBe(88);
    expect(plan?.durationFrames).toBe(12);
    // freezeAt = min(100, 100) - 1 = 99; sourceFrame = 0 + (99-40)*1 = 59.
    expect(plan?.seconds).toBeCloseTo(59 / FPS);
    expect(plan?.assetPath).toBe('media/a1.mp4');
  });

  it('usa la ventana con lead propio del donor y respeta su velocidad', () => {
    const incoming = clip({
      id: 'in',
      startFrame: 100,
      durationFrames: 30,
      transitionIn: { type: 'luma-wipe', frames: 10 },
    });
    // Donor con transitionIn de 20: expone desde 70; speed 2x.
    const donor = clip({
      id: 'donor',
      startFrame: 90,
      durationFrames: 40,
      transitionIn: { type: 'dissolve', frames: 20 },
      speed: { num: 2, den: 1 },
      source: { type: 'asset', assetId: 'a1', inFrame: 10, outFrame: 90 },
    });
    const doc = projectWithAssets([incoming, donor], [track('v1')], [videoAsset('a1')]);
    const plan = lumaMateFreezePlan(doc, incoming, FPS);
    expect(plan).not.toBeNull();
    // needFrom = 90, needTo = 100; freezeAt = min(100,130)-1 = 99.
    // sourceFrame = 10 + (99-90)*2 = 28 → 28/30 s.
    expect(plan?.seconds).toBeCloseTo(28 / FPS);
    expect(plan?.startFrame).toBe(90);
    expect(plan?.durationFrames).toBe(10);
  });

  it('devuelve null sin transitionIn luma-wipe, sin donor o con donors inutilizables', () => {
    const sinLuma = clip({ id: 'a', startFrame: 100, durationFrames: 30 });
    const donor = clip({ id: 'd', startFrame: 60, durationFrames: 60 });
    const doc = projectWithAssets([sinLuma, donor], [track('v1')], [videoAsset('a1')]);
    expect(lumaMateFreezePlan(doc, sinLuma, FPS)).toBeNull();

    const luma = clip({
      id: 'in',
      startFrame: 100,
      durationFrames: 30,
      transitionIn: { type: 'luma-wipe', frames: 12 },
    });
    // Donor demasiado corto: termina en 60, no llega al solape.
    const corto = clip({ id: 'corto', startFrame: 30, durationFrames: 30 });
    const doc2 = projectWithAssets([luma, corto], [track('v1')], [videoAsset('a1')]);
    expect(lumaMateFreezePlan(doc2, luma, FPS)).toBeNull();

    // Donor con reverse y asset no ready: no sirve.
    const reversed = clip({ id: 'rev', startFrame: 60, durationFrames: 60, reverse: true });
    const doc3 = projectWithAssets([luma, reversed], [track('v1')], [videoAsset('a1')]);
    expect(lumaMateFreezePlan(doc3, luma, FPS)).toBeNull();
  });
});

describe('placeFreezeMate', () => {
  it('crea una pista oculta con el freeze cubriendo la ventana y lo asigna como candidato', () => {
    const incoming = clip({
      id: 'in',
      startFrame: 100,
      durationFrames: 30,
      transitionIn: { type: 'luma-wipe', frames: 12 },
    });
    const doc = projectWith([incoming], [track('v1')]);
    const placed = placeFreezeMate(doc, 'frame-asset', {
      startFrame: 88,
      durationFrames: 12,
      label: 'Saliente',
    });
    const mate = placed.project.timeline.clips.find((item) => item.id === placed.mateClipId)!;
    expect(mate.kind).toBe('freeze');
    expect(mate.startFrame).toBe(88);
    expect(mate.durationFrames).toBe(12);
    expect(mate.source).toEqual({ type: 'asset', assetId: 'frame-asset' });
    const mateTrack = placed.project.timeline.tracks.find((item) => item.id === mate.trackId)!;
    expect(mateTrack.hidden).toBe(true);
    expect(mateTrack.kind).toBe('video');
    // El mate nuevo ya es candidato válido para el clip.
    const candidates = lumaMateCandidates(
      placed.project.timeline.clips,
      placed.project.timeline.tracks,
      incoming,
      FPS,
    );
    expect(candidates.map((item) => item.clip.id)).toContain(placed.mateClipId);
  });
});

describe('lumaMateIsStale', () => {
  it('avisa cuando el mate asignado ya no cubre el solape', () => {
    const incoming = clip({
      id: 'in',
      startFrame: 100,
      durationFrames: 30,
      transitionIn: { type: 'luma-wipe', frames: 12, mateClipId: 'mate' },
    });
    // El mate quedó corto: termina en el frame 60, lejos del solape.
    const mate = clip({ id: 'mate', startFrame: 0, durationFrames: 30 });
    const { timeline } = projectWith([incoming, mate], [track('v1')]);
    expect(lumaMateIsStale(timeline.clips, timeline.tracks, incoming, FPS)).toBe(true);
  });

  it('no avisa con un mate vigente ni sin mate asignado', () => {
    const incoming = clip({
      id: 'in',
      startFrame: 100,
      durationFrames: 30,
      transitionIn: { type: 'luma-wipe', frames: 12, mateClipId: 'mate' },
    });
    // needFrom = 100 - 12 (lead) = 88: el mate tiene que exponer desde <= 89.
    const mate = clip({ id: 'mate', startFrame: 85, durationFrames: 30 });
    const { timeline } = projectWith([incoming, mate], [track('v1')]);
    expect(lumaMateIsStale(timeline.clips, timeline.tracks, incoming, FPS)).toBe(false);

    const sinMate = clip({
      id: 'in2',
      startFrame: 200,
      durationFrames: 30,
      transitionIn: { type: 'luma-wipe', frames: 12 },
    });
    const { timeline: t2 } = projectWith([sinMate, mate], [track('v1')]);
    expect(lumaMateIsStale(t2.clips, t2.tracks, sinMate, FPS)).toBe(false);
  });
});
