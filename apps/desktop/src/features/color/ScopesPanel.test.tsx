// @vitest-environment jsdom
import { createRef } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ScopesPanel } from './ScopesPanel.tsx';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ScopesPanel', () => {
  it('cambia entre onda, vectores e histograma y cierra el panel', () => {
    // jsdom has no 2D canvas; the panel must still render its controls.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const onClose = vi.fn();
    const stageRef = createRef<HTMLDivElement>();
    render(<ScopesPanel stageRef={stageRef} onClose={onClose} />);
    expect(screen.getByRole('region', { name: /scopes de color/i })).toBeTruthy();
    const waveform = screen.getByRole('button', { name: /onda/i });
    const vectorscope = screen.getByRole('button', { name: /vectorscopio/i });
    expect(waveform.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(vectorscope);
    expect(vectorscope.getAttribute('aria-pressed')).toBe('true');
    expect(waveform.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: /histograma/i }));
    expect(screen.getByRole('img', { name: /histograma rgb/i })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /cerrar scopes/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
