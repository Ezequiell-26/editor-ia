// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createEmptyProject } from '@editor-ia/project-schema';
import type { ProjectDocument } from '@editor-ia/project-schema';
import {
  addAsset,
  addClipFromAsset,
  ensureDelivery,
} from '../../state/project-actions';
import { readyAsset } from '../../test/fake-service';
import { createRafCoalescer } from './timeline-raf';
import { deleteClips, moveClipsBy, rippleMoveClip, rippleTrim } from './timeline-edits';
import {
  beatFramesFromPeaks,
  collectTimelineSnapTargets,
  sceneSnapPoints,
  snapFrameTo,
} from './timeline-snap';
import {
  spanIntersectsWindow,
  visibleFrameWindow,
  visibleTrackWindow,
} from './timeline-viewport';

const NOW = '2026-11-03T00:00:00.000Z';

function frameTimeout(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

/**
 * Proyecto de prueba: 3 clips en la misma pista de video, con huecos, para
 * probar ripple/insert/multi-move sin depender de la UI.
 */
function projectWithThreeClips(): {
  project: ProjectDocument;
  trackId: string;
  ids: [string, string, string];
} {
  const asset = readyAsset({ label: 'Clip base' });
  let project = ensureDelivery(createEmptyProject('Pro', NOW));
  project = addAsset(project, asset);
  const first = addClipFromAsset(project, asset, { atFrame: 0, durationFrames: 30 });
  const second = addClipFromAsset(first.project, asset, {
    atFrame: 40,
    durationFrames: 30,
    trackId: first.trackId,
  });
  const third = addClipFromAsset(second.project, asset, {
    atFrame: 100,
    durationFrames: 30,
    trackId: first.trackId,
  });
  return {
    project: third.project,
    trackId: first.trackId,
    ids: [first.clipId, second.clipId, third.clipId],
  };
}

describe('timeline-raf · coalescing de pointermove', () => {
  it('aplica una sola vez por frame el último valor', async () => {
    const apply = vi.fn();
    const coalescer = createRafCoalescer<number>(apply);
    coalescer.push(1);
    coalescer.push(2);
    coalescer.push(3);
    expect(apply).not.toHaveBeenCalled();
    await frameTimeout();
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenLastCalledWith(3);
  });

  it('flush aplica el pendiente de inmediato (pointerup) y cancel lo descarta', () => {
    const apply = vi.fn();
    const coalescer = createRafCoalescer<number>(apply);
    coalescer.push(10);
    coalescer.push(11);
    coalescer.flush();
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenLastCalledWith(11);
    coalescer.push(20);
    coalescer.cancel();
    expect(coalescer.hasPending()).toBe(false);
  });
});

describe('timeline-viewport · ventana de virtualización', () => {
  it('sin layout medible no virtualiza (jsdom/tests)', () => {
    expect(visibleFrameWindow(0, 0, 2, 160)).toBeNull();
    expect(visibleTrackWindow(0, 0, [48, 48])).toBeNull();
  });

  it('calcula la ventana de frames con overscan', () => {
    const window = visibleFrameWindow(500, 800, 2, 160, 1);
    expect(window).not.toBeNull();
    // contentLeft = 340; start = max(0, (340 - 800) / 2) = 0; end = (340+800+800)/2 = 970.
    expect(window!.startFrame).toBe(0);
    expect(window!.endFrame).toBeCloseTo(970, 0);
  });

  it('un clip fuera de la ventana no se renderiza; uno que la cruza sí', () => {
    const window = { startFrame: 100, endFrame: 200 };
    expect(spanIntersectsWindow(0, 50, window)).toBe(false);
    expect(spanIntersectsWindow(400, 50, window)).toBe(false);
    expect(spanIntersectsWindow(150, 20, window)).toBe(true);
    expect(spanIntersectsWindow(90, 30, window)).toBe(true);
    expect(spanIntersectsWindow(0, 50, null)).toBe(true);
  });

  it('calcula la ventana de filas con padding para el scroll', () => {
    const rows = [48, 48, 48, 48, 48, 48];
    const window = visibleTrackWindow(96, 96, rows, 0);
    expect(window).not.toBeNull();
    expect(window!.first).toBe(2);
    expect(window!.topPad).toBe(96);
    expect(window!.last).toBe(4);
    expect(window!.bottomPad).toBe(96);
  });
});

describe('timeline-snap · escenas, beats y snap extendido', () => {
  it('toma el inicio de cada escena como punto de snap', () => {
    const { project, ids } = projectWithThreeClips();
    const withScenes: ProjectDocument = {
      ...project,
      scenes: [
        {
          id: '00000000-0000-4000-8000-000000000001',
          order: 0,
          title: 'Intro',
          intent: 'hook',
          status: 'approved',
          narration: { text: 'Hola' },
          clipIds: [ids[1]],
        },
        {
          id: '00000000-0000-4000-8000-000000000002',
          order: 1,
          title: 'Cierre',
          intent: 'cta',
          status: 'draft',
          narration: { text: 'Chau' },
          clipIds: [ids[2]],
        },
      ],
    };
    const points = sceneSnapPoints(withScenes);
    expect(points.map((point) => point.frame)).toEqual([40, 100]);
    expect(points[0]!.label).toContain('Intro');
  });

  it('detecta onsets de la forma de onda y los ubica en frames de timeline', () => {
    // Envolvente con dos golpes claros en buckets 10 y 30 de 40.
    const peaks = Array.from({ length: 40 }, (_, index) =>
      index === 10 || index === 30 ? 1 : 0.05,
    );
    const beats = beatFramesFromPeaks(peaks, {
      clipStartFrame: 100,
      inFrame: 0,
      outFrame: 400,
      totalFrames: 400,
      fps: 30,
    });
    expect(beats.length).toBe(2);
    expect(beats[0]).toBe(100 + 10 * 10);
    expect(beats[1]).toBe(100 + 30 * 10);
  });

  it('colecta marcadores + escenas + beats y snapea al más cercano', () => {
    const { project, ids } = projectWithThreeClips();
    const withMarker: ProjectDocument = {
      ...project,
      markers: [{ id: 'm1', frame: 60, label: 'Marcador', color: 'mint' }],
      scenes: [
        {
          id: '00000000-0000-4000-8000-000000000003',
          order: 0,
          title: 'Escena A',
          intent: 'hook',
          status: 'draft',
          narration: { text: 'A' },
          clipIds: [ids[0]],
        },
      ],
    };
    const targets = collectTimelineSnapTargets(withMarker, {
      playhead: 70,
      scenes: sceneSnapPoints(withMarker),
      beats: [80],
      beatLabel: 'Beat 120 bpm',
    });
    expect(targets.some((target) => target.label === 'Marcador')).toBe(true);
    expect(targets.some((target) => target.label.includes('Escena A'))).toBe(true);
    expect(targets.some((target) => target.label === 'Beat 120 bpm')).toBe(true);
    const snapped = snapFrameTo(79, targets, 4);
    expect(snapped.frame).toBe(80);
  });
});

describe('timeline-edits · ripple, insert y multi-move', () => {
  it('ripple trim del final arrastra los clips posteriores', () => {
    const { project, ids, trackId } = projectWithThreeClips();
    // Recorta el primer clip 10 frames más corto (30 → 20).
    const next = rippleTrim(project, ids[0]!, 'end', 20);
    expect(next).not.toBeNull();
    const clips = next!.timeline.clips.filter((clip) => clip.trackId === trackId);
    const byId = new Map(clips.map((clip) => [clip.id, clip]));
    expect(byId.get(ids[0]!)!.durationFrames).toBe(20);
    expect(byId.get(ids[1]!)!.startFrame).toBe(30); // 40 - 10
    expect(byId.get(ids[2]!)!.startFrame).toBe(90); // 100 - 10
  });

  it('ripple trim del inicio corre el clip y los posteriores por el delta', () => {
    const { project, ids, trackId } = projectWithThreeClips();
    const next = rippleTrim(project, ids[0]!, 'start', 10);
    expect(next).not.toBeNull();
    const clips = next!.timeline.clips.filter((clip) => clip.trackId === trackId);
    const byId = new Map(clips.map((clip) => [clip.id, clip]));
    // 10 frames más corto: el clip queda en 0 y los demás se corren -10.
    expect(byId.get(ids[0]!)!.startFrame).toBe(0);
    expect(byId.get(ids[0]!)!.durationFrames).toBe(20);
    expect(byId.get(ids[1]!)!.startFrame).toBe(30);
    expect(byId.get(ids[2]!)!.startFrame).toBe(90);
  });

  it('ripple move cierra el hueco de origen e inserta en el destino', () => {
    const { project, ids, trackId } = projectWithThreeClips();
    const next = rippleMoveClip(project, ids[0]!, 60);
    expect(next).not.toBeNull();
    const clips = next!.timeline.clips.filter((clip) => clip.trackId === trackId);
    const byId = new Map(clips.map((clip) => [clip.id, clip]));
    // Al sacar el clip de 0..30, B y C se corren -30 (10 y 70); al insertar en
    // 60, los que empiezan en/después de 60 (C en 70) se corren +30 → 100.
    expect(byId.get(ids[0]!)!.startFrame).toBe(60);
    expect(byId.get(ids[1]!)!.startFrame).toBe(10);
    expect(byId.get(ids[2]!)!.startFrame).toBe(100);
  });

  it('multi-move desplaza el grupo sin pisar clips y rechaza superposiciones', () => {
    const { project, ids } = projectWithThreeClips();
    const moved = moveClipsBy(project, [ids[0]!, ids[2]!], 10);
    expect(moved).not.toBeNull();
    const byId = new Map(moved!.timeline.clips.map((clip) => [clip.id, clip]));
    expect(byId.get(ids[0]!)!.startFrame).toBe(10);
    expect(byId.get(ids[2]!)!.startFrame).toBe(110);
    // Mover el primero sobre el segundo invalida.
    expect(moveClipsBy(project, [ids[0]!], 40)).toBeNull();
  });

  it('borrar varios clips respeta ripple por pista', () => {
    const { project, ids, trackId } = projectWithThreeClips();
    const flat = deleteClips(project, [ids[1]!], false);
    expect(flat).not.toBeNull();
    const flatTrack = flat!.timeline.clips
      .filter((clip) => clip.trackId === trackId)
      .sort((a, b) => a.startFrame - b.startFrame);
    expect(flatTrack.map((clip) => clip.startFrame)).toEqual([0, 100]);

    const ripped = deleteClips(project, [ids[1]!], true);
    expect(ripped).not.toBeNull();
    const rippedTrack = ripped!.timeline.clips
      .filter((clip) => clip.trackId === trackId)
      .sort((a, b) => a.startFrame - b.startFrame);
    // Al cerrar el hueco de B, C (100) se corre -30.
    expect(rippedTrack.map((clip) => clip.startFrame)).toEqual([0, 70]);
  });

  it('rechaza ripple en pista bloqueada', () => {
    const { project, ids, trackId } = projectWithThreeClips();
    const locked: ProjectDocument = {
      ...project,
      timeline: {
        ...project.timeline,
        tracks: project.timeline.tracks.map((track) =>
          track.id === trackId ? { ...track, locked: true } : track,
        ),
      },
    };
    expect(rippleTrim(locked, ids[0]!, 'end', 20)).toBeNull();
  });
});

describe('snap a puntos in/out de la secuencia', () => {
  it('atrae el clip a los bordes ioIn/ioOut', () => {
    const { project } = projectWithThreeClips();
    const targets = collectTimelineSnapTargets(project, {
      ioIn: 50,
      ioOut: 200,
    });
    expect(targets.some((target) => target.label === 'Entrada (in)')).toBe(true);
    expect(targets.some((target) => target.label === 'Salida (out)')).toBe(true);
    const snapped = snapFrameTo(198, targets, 5);
    expect(snapped.frame).toBe(200);
    const snappedIn = snapFrameTo(52, targets, 5);
    expect(snappedIn.frame).toBe(50);
  });
});
