// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PanelSplitter } from './PanelSplitter';

describe('divisores del Studio', () => {
  it('expone semántica de separador y valores accesibles', () => {
    render(
      <PanelSplitter
        axis="x"
        side="left"
        value={300}
        min={180}
        max={520}
        label="Ancho de la biblioteca"
        onChange={() => undefined}
        onCommit={() => undefined}
      />,
    );
    const splitter = screen.getByRole('separator', { name: 'Ancho de la biblioteca' });
    expect(splitter.getAttribute('aria-orientation')).toBe('vertical');
    expect(splitter.getAttribute('aria-valuenow')).toBe('300');
    expect(splitter.getAttribute('tabindex')).toBe('0');
  });

  it('ajusta con flechas, Shift y Home/End', () => {
    const onCommit = vi.fn();
    render(
      <PanelSplitter
        axis="x"
        value={300}
        min={180}
        max={520}
        label="Inspector"
        onChange={() => undefined}
        onCommit={onCommit}
      />,
    );
    const splitter = screen.getByRole('separator', { name: 'Inspector' });
    fireEvent.keyDown(splitter, { key: 'ArrowRight' });
    expect(onCommit).toHaveBeenLastCalledWith(316);
    fireEvent.keyDown(splitter, { key: 'ArrowRight', shiftKey: true });
    expect(onCommit).toHaveBeenLastCalledWith(364);
    fireEvent.keyDown(splitter, { key: 'Home' });
    expect(onCommit).toHaveBeenLastCalledWith(180);
    fireEvent.keyDown(splitter, { key: 'End' });
    expect(onCommit).toHaveBeenLastCalledWith(520);
  });

  it('invierte la dirección para el panel derecho', () => {
    const onCommit = vi.fn();
    render(
      <PanelSplitter
        axis="x"
        invert
        value={340}
        min={220}
        max={520}
        label="Inspector derecho"
        onChange={() => undefined}
        onCommit={onCommit}
      />,
    );
    fireEvent.keyDown(screen.getByRole('separator', { name: 'Inspector derecho' }), {
      key: 'ArrowLeft',
    });
    expect(onCommit).toHaveBeenLastCalledWith(356);
  });
});
