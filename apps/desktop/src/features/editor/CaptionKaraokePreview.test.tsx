// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { CaptionCue } from '@editor-ia/project-schema';
import { CaptionKaraokePreview } from './CaptionKaraokePreview';

afterEach(cleanup);

function cue(overrides: Partial<CaptionCue> = {}): CaptionCue {
  return {
    id: 'cue-1',
    trackId: 'track-1',
    startFrame: 0,
    endFrame: 90,
    text: 'hola mundo cruel',
    language: 'es',
    words: [
      { text: 'hola', startFrame: 0, endFrame: 30 },
      { text: 'mundo', startFrame: 30, endFrame: 60 },
      { text: 'cruel', startFrame: 60, endFrame: 90 },
    ],
    ...overrides,
  } as CaptionCue;
}

describe('CaptionKaraokePreview', () => {
  it('renderiza una palabra por span con animación por palabra', () => {
    const { container } = render(<CaptionKaraokePreview cue={cue()} fps={30} />);
    const words = container.querySelectorAll('.caption-karaoke-word');
    expect(words).toHaveLength(3);
    expect(words[0]?.textContent).toBe('hola ');
    const style = words[0]?.getAttribute('style') ?? '';
    expect(style).toContain('caption-kw-0');
    expect(style).toContain('3s');
  });

  it('genera un keyframe por palabra con su ventana dentro del cue', () => {
    const { container } = render(<CaptionKaraokePreview cue={cue()} fps={30} />);
    const css = container.querySelector('style')?.textContent ?? '';
    expect(css).toContain('@keyframes caption-kw-0');
    expect(css).toContain('@keyframes caption-kw-2');
    // «hola» ocupa el primer tercio del ciclo (0–33,33 %).
    expect(css).toContain('33.33%');
    expect(css).toContain('66.67%');
  });

  it('no renderiza nada sin palabras con tiempos', () => {
    const { container } = render(
      <CaptionKaraokePreview cue={cue({ words: undefined })} fps={30} />,
    );
    expect(container.querySelector('.caption-karaoke')).toBeNull();
  });

  it('no renderiza con duración cero', () => {
    const { container } = render(
      <CaptionKaraokePreview cue={cue({ endFrame: 0 })} fps={30} />,
    );
    expect(container.querySelector('.caption-karaoke')).toBeNull();
  });
});
