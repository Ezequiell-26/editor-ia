import { describe, expect, it } from 'vitest';
import { createEmptyProject } from '@editor-ia/project-schema';
import { applyProjectTitleCard, planProjectTitleCard } from './auto-title';

function project() {
  const base = createEmptyProject('Mi documental sobre el río', '2026-11-02T00:00:00.000Z');
  return base;
}

describe('planProjectTitleCard', () => {
  it('usa el nombre del proyecto como título', () => {
    const plan = planProjectTitleCard(project());
    expect(plan?.title).toBe('Mi documental sobre el río');
    expect(plan?.durationFrames).toBe(90);
  });

  it('sin nombre no propone nada', () => {
    const base = project();
    base.name = '   ';
    expect(planProjectTitleCard(base)).toBeNull();
  });

  it('usa la primera frase de los subtítulos como subtítulo', () => {
    const base = project();
    base.captions.cues = [
      { id: '00000000-0000-4000-8000-000000000001', trackId: 't', text: 'Segunda', language: 'es', startFrame: 60, endFrame: 90 },
      { id: '00000000-0000-4000-8000-000000000002', trackId: 't', text: '  Primera   frase ', language: 'es', startFrame: 0, endFrame: 30 },
    ] as typeof base.captions.cues;
    const plan = planProjectTitleCard(base);
    expect(plan?.subtitle).toBe('Primera frase');
  });
});

describe('applyProjectTitleCard', () => {
  it('agrega la tarjeta al inicio en una pista propia', () => {
    const base = project();
    const next = applyProjectTitleCard(base);
    expect(next).not.toBeNull();
    expect(next!.timeline.clips.length).toBeGreaterThan(base.timeline.clips.length);
    const motionClip = next!.timeline.clips.find((clip) => clip.kind === 'graphic');
    expect(motionClip?.startFrame).toBe(0);
    expect(motionClip?.durationFrames).toBe(90);
  });
});
