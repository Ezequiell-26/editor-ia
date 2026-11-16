// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { TimelinePanel } from './TimelinePanel';

afterEach(cleanup);

const clips = [{ id: 'c1', left: 0, width: 30 }];

describe('TimelinePanel · contenido demo (UI-002)', () => {
  it('sin demoContent no pinta clips ni waveform de muestra, sólo los clips reales', () => {
    const { container } = render(
      <TimelinePanel
        scene="media"
        playheadLeft={0}
        onSeek={() => {}}
        clipBlocks={clips}
      />,
    );
    // Los ClipStrip de muestra usan .me-tl-clip; los clips reales .me-clip.
    expect(container.querySelectorAll('.me-tl-clip')).toHaveLength(0);
    expect(container.querySelector('.me-tl-audio-strip')).toBeNull();
    expect(container.querySelectorAll('.me-clip')).toHaveLength(1);
  });

  it('con assetId pero sin service/assets no monta el hook de waveform', () => {
    const { container } = render(
      <TimelinePanel
        scene="media"
        playheadLeft={0}
        onSeek={() => {}}
        clipBlocks={[{ id: 'c1', left: 0, width: 30, kind: 'video', assetId: 'a1', inFrame: 0, outFrame: 90 }]}
      />,
    );
    expect(container.querySelector('.me-clip-wave')).toBeNull();
    expect(container.querySelectorAll('.me-clip')).toHaveLength(1);
  });

  it('con demoContent pinta la ambientación de la réplica', () => {
    const { container } = render(
      <TimelinePanel
        scene="media"
        playheadLeft={0}
        onSeek={() => {}}
        clipBlocks={clips}
        demoContent
      />,
    );
    expect(container.querySelectorAll('.me-tl-clip').length).toBeGreaterThan(0);
    expect(container.querySelector('.me-tl-audio-strip')).not.toBeNull();
  });
});
