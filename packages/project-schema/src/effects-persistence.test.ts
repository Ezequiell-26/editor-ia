import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ProjectDocumentSchema } from './project.ts';

const fixture = JSON.parse(
  readFileSync(
    new URL('../fixtures/sample-vertical-slice.editoria.json', import.meta.url),
    'utf8',
  ),
) as unknown;

describe('persistencia de efectos y keyframes', () => {
  it('conserva efectos, keyframes y easing al serializar y reabrir el proyecto', () => {
    const project = ProjectDocumentSchema.parse(fixture);
    const clip = project.timeline.clips.find((item) => item.kind === 'video');
    if (!clip || clip.kind !== 'video') throw new Error('falta el clip de video');
    clip.effects = {
      ...clip.effects,
      brightness: 0.35,
      blur: 6,
      glow: { intensity: 0.4, radius: 18, threshold: 0.55 },
    };
    clip.effectKeyframes = [
      { frame: 0, property: 'brightness', value: 0, easing: 'ease-in' },
      {
        frame: 15,
        property: 'blur',
        value: 8,
        bezier: { cp1X: 0.42, cp1Y: 0, cp2X: 0.58, cp2Y: 1 },
      },
      { frame: 30, property: 'brightness', value: 0.8 },
    ];
    clip.transitionIn = { type: 'wipe-left', frames: 12, easing: 'ease-in-out' };

    const reopened = ProjectDocumentSchema.parse(JSON.parse(JSON.stringify(project)));
    const again = reopened.timeline.clips.find((item) => item.id === clip.id);
    if (!again || again.kind !== 'video') throw new Error('falta el clip reabierto');
    expect(again.effects).toEqual(clip.effects);
    expect(again.effectKeyframes).toEqual(clip.effectKeyframes);
    expect(again.transitionIn).toEqual(clip.transitionIn);
    const text = JSON.stringify(reopened);
    expect(text).toContain('"effectKeyframes"');
    expect(text).toContain('"easing":"ease-in-out"');
  });
});
