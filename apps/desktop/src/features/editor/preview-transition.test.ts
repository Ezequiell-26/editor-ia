import { describe, expect, it } from 'vitest';
import type { Clip } from '@editor-ia/project-schema';
import {
  clipInTransitionLead,
  clipTransitionLeadActive,
  previewTransitionFrame,
  previewTransitionLeadFrames,
} from './preview-transition';

const FPS = 30;

function clip(partial: Partial<Clip> & { id: string }): Clip {
  return {
    trackId: 'v1',
    kind: 'video',
    label: partial.id,
    startFrame: 100,
    durationFrames: 60,
    source: { type: 'asset', assetId: 'a1', inFrame: 0, outFrame: 60 },
    ...partial,
  } as Clip;
}

describe('previewTransitionLeadFrames', () => {
  it('devuelve 0 sin transición o con kind sin lead', () => {
    expect(previewTransitionLeadFrames(clip({ id: 'a' }), FPS)).toBe(0);
    expect(
      previewTransitionLeadFrames(
        clip({
          id: 'g',
          kind: 'graphic',
          source: { type: 'graphic', motionId: 'm' },
          transitionIn: { type: 'dissolve', frames: 30 },
        } as never),
        FPS,
      ),
    ).toBe(0);
    expect(
      previewTransitionLeadFrames(
        clip({
          id: 'au',
          kind: 'audio',
          transitionIn: { type: 'dissolve', frames: 30 },
        } as never),
        FPS,
      ),
    ).toBe(0);
  });

  it('clampea por duración, inicio y tope de 2 s como el render', () => {
    const base = { type: 'dissolve', frames: 90 } as const;
    // 90 frames pedidos > duración 60 → 60
    expect(
      previewTransitionLeadFrames(clip({ id: 'a', transitionIn: base }), FPS),
    ).toBe(60);
    // inicio en frame 20 → lead máximo 20
    expect(
      previewTransitionLeadFrames(
        clip({ id: 'b', startFrame: 20, durationFrames: 300, transitionIn: base }),
        FPS,
      ),
    ).toBe(20);
    // tope 2 s = 60 frames a 30 fps aunque quepan más
    expect(
      previewTransitionLeadFrames(
        clip({ id: 'c', startFrame: 500, durationFrames: 300, transitionIn: base }),
        FPS,
      ),
    ).toBe(60);
    // pedido menor que todos los topes
    expect(
      previewTransitionLeadFrames(
        clip({ id: 'd', transitionIn: { type: 'dissolve', frames: 12 } }),
        FPS,
      ),
    ).toBe(12);
  });

  it('luma-wipe monta el lead como el render; la máscara la pone preview-luma-mask', () => {
    expect(
      previewTransitionLeadFrames(
        clip({
          id: 'l',
          transitionIn: { type: 'luma-wipe', frames: 15, mateClipId: 'mate' },
        }),
        FPS,
      ),
    ).toBe(15);
  });
});

describe('clipTransitionLeadActive', () => {
  it('es true con transitionIn y clamps del render, incluido luma-wipe', () => {
    expect(
      clipTransitionLeadActive(
        clip({ id: 'a', transitionIn: { type: 'dissolve', frames: 30 } }),
        FPS,
      ),
    ).toBe(true);
    // luma-wipe tiene lead en el render y ahora también en la preview.
    expect(
      clipTransitionLeadActive(
        clip({
          id: 'l',
          transitionIn: { type: 'luma-wipe', frames: 15, mateClipId: 'mate' },
        }),
        FPS,
      ),
    ).toBe(true);
  });

  it('es false sin transición, al inicio del timeline o sin duración', () => {
    expect(clipTransitionLeadActive(clip({ id: 'a' }), FPS)).toBe(false);
    expect(
      clipTransitionLeadActive(
        clip({ id: 'b', startFrame: 0, transitionIn: { type: 'dissolve', frames: 30 } }),
        FPS,
      ),
    ).toBe(false);
    expect(
      clipTransitionLeadActive(
        clip({
          id: 'c',
          kind: 'audio',
          transitionIn: { type: 'dissolve', frames: 30 },
        } as never),
        FPS,
      ),
    ).toBe(false);
  });
});

describe('clipInTransitionLead', () => {
  const dissolve = clip({
    id: 'in',
    startFrame: 100,
    durationFrames: 60,
    transitionIn: { type: 'dissolve', frames: 30 },
  });

  it('es true sólo dentro de la ventana de solape', () => {
    expect(clipInTransitionLead(dissolve, 69, FPS)).toBe(false); // antes del lead
    expect(clipInTransitionLead(dissolve, 70, FPS)).toBe(true); // primer frame del lead
    expect(clipInTransitionLead(dissolve, 85, FPS)).toBe(true); // mitad del solape
    expect(clipInTransitionLead(dissolve, 99, FPS)).toBe(true); // último frame del lead
    expect(clipInTransitionLead(dissolve, 100, FPS)).toBe(false); // ya empezó el clip
    expect(clipInTransitionLead(dissolve, 120, FPS)).toBe(false);
  });

  it('es false sin transición, fuera del lead (luma-wipe incluido) o kinds sin solape', () => {
    expect(clipInTransitionLead(clip({ id: 'a' }), 85, FPS)).toBe(false);
    const luma = clip({
      id: 'l',
      startFrame: 100,
      durationFrames: 60,
      transitionIn: { type: 'luma-wipe', frames: 15, mateClipId: 'mate' },
    });
    expect(clipInTransitionLead(luma, 84, FPS)).toBe(false); // antes del lead
    expect(clipInTransitionLead(luma, 90, FPS)).toBe(true); // dentro del lead
    expect(clipInTransitionLead(luma, 100, FPS)).toBe(false); // ya empezó
    expect(
      clipInTransitionLead(
        clip({
          id: 'au',
          kind: 'audio',
          startFrame: 100,
          durationFrames: 60,
          transitionIn: { type: 'dissolve', frames: 30 },
        } as never),
        85,
        FPS,
      ),
    ).toBe(false);
  });
});

describe('previewTransitionFrame', () => {
  const dissolve = clip({
    id: 'in',
    startFrame: 100,
    durationFrames: 60,
    transitionIn: { type: 'dissolve', frames: 30 },
  });

  it('es null fuera de la ventana de lead', () => {
    expect(previewTransitionFrame(dissolve, 60, FPS)).toBeNull(); // antes del solape
    expect(previewTransitionFrame(dissolve, 100, FPS)).toBeNull(); // ya empezó el clip
    expect(previewTransitionFrame(dissolve, 129, FPS)).toBeNull();
  });

  it('dissolve funde la opacidad de 0 a 1 durante el lead', () => {
    const start = previewTransitionFrame(dissolve, 70, FPS);
    expect(start?.progress).toBe(0);
    expect(start?.style.opacity).toBe(0);
    const mid = previewTransitionFrame(dissolve, 85, FPS);
    expect(mid?.progress).toBeCloseTo(0.5);
    expect(mid?.style.opacity).toBeCloseTo(0.5);
    const end = previewTransitionFrame(dissolve, 99, FPS);
    expect(end?.progress).toBeCloseTo(29 / 30);
    expect(end?.style.opacity).toBeCloseTo(29 / 30);
  });

  it('fade-black/white y dip-color usan underlay + opacidad', () => {
    const black = clip({
      id: 'b',
      startFrame: 100,
      durationFrames: 60,
      transitionIn: { type: 'fade-black', frames: 30 },
    });
    const mid = previewTransitionFrame(black, 85, FPS);
    expect(mid?.underlay).toBe('#000000');
    expect(mid?.style.opacity).toBeCloseTo(0.5);

    const white = clip({
      id: 'w',
      startFrame: 100,
      durationFrames: 60,
      transitionIn: { type: 'fade-white', frames: 30 },
    });
    expect(previewTransitionFrame(white, 85, FPS)?.underlay).toBe('#ffffff');

    const dip = clip({
      id: 'd',
      startFrame: 100,
      durationFrames: 60,
      transitionIn: { type: 'dip-color', frames: 30, color: '#2244aa' },
    });
    expect(previewTransitionFrame(dip, 85, FPS)?.underlay).toBe('#2244aa');
  });

  it('slides desplazan el wrapper desde fuera del cuadro', () => {
    const left = clip({
      id: 's',
      startFrame: 100,
      durationFrames: 60,
      transitionIn: { type: 'slide-left', frames: 30 },
    });
    // slide-left entra desde la derecha: a la mitad queda translateX(50 %).
    expect(previewTransitionFrame(left, 85, FPS)?.style.transform).toBe(
      'translateX(50.000%)',
    );
    const up = clip({
      id: 'u',
      startFrame: 100,
      durationFrames: 60,
      transitionIn: { type: 'slide-3d-up', frames: 30 },
    });
    const mid = previewTransitionFrame(up, 85, FPS);
    // slide-3d-up entra desde abajo (+Y) y comprime el eje Y a 0.575 a mitad.
    expect(mid?.style.transform).toBe('translateY(50.000%) scaleY(0.5750)');
  });

  it('wipes recortan con inset desde el borde opuesto', () => {
    const wipe = clip({
      id: 'w',
      startFrame: 100,
      durationFrames: 60,
      transitionIn: { type: 'wipe-left', frames: 30 },
    });
    // wipe-left revela desde la derecha: a mitad queda la mitad derecha.
    expect(previewTransitionFrame(wipe, 85, FPS)?.style.clipPath).toBe(
      'inset(0 50.000% 0 0)',
    );
    const down = clip({
      id: 'd',
      startFrame: 100,
      durationFrames: 60,
      transitionIn: { type: 'wipe-down', frames: 30 },
    });
    expect(previewTransitionFrame(down, 85, FPS)?.style.clipPath).toBe(
      'inset(0 0 50.000% 0)',
    );
  });

  it('iris y clock-wipe usan máscaras CSS en vez de clip-path', () => {
    const iris = clip({
      id: 'i',
      startFrame: 100,
      durationFrames: 60,
      transitionIn: { type: 'iris', frames: 30 },
    });
    const mid = previewTransitionFrame(iris, 85, FPS);
    expect(mid?.style.maskImage).toContain('radial-gradient');
    expect(mid?.style.maskImage).toContain('50.000%');
    expect(mid?.style.clipPath).toBeUndefined();

    const clock = clip({
      id: 'c',
      startFrame: 100,
      durationFrames: 60,
      transitionIn: { type: 'clock-wipe', frames: 30 },
    });
    const clockMid = previewTransitionFrame(clock, 85, FPS);
    expect(clockMid?.style.maskImage).toContain('conic-gradient');
    expect(clockMid?.style.maskImage).toContain('180.000deg');
  });
});
