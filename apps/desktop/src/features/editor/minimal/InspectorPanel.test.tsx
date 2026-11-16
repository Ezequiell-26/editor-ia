// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InspectorPanel } from './InspectorPanel';

afterEach(cleanup);

const base = {
  scene: 'media' as const,
  onTab: () => {},
  projectName: 'Demo',
  width: 1920,
  height: 1080,
  fps: 30,
  duration: '00:01:00:00',
  onAssistant: () => {},
};

describe('InspectorPanel · honestidad de controles (UI-002)', () => {
  it('avisa que Vídeo/Cor son previsualización y no editan el clipe', () => {
    render(<InspectorPanel {...base} tab="video" />);
    expect(screen.getByText(/ainda não alteram o clipe/i)).toBeTruthy();
    cleanup();
    render(<InspectorPanel {...base} tab="color-basic" />);
    expect(screen.getByText(/ainda não alteram o clipe/i)).toBeTruthy();
  });

  it('con clipTransform muestra los valores reales del clip (UI-002)', () => {
    const { container } = render(
      <InspectorPanel
        {...base}
        scene="studio"
        tab="video"
        clipTransform={{ scaleX: 1.5, offsetX: 40, offsetY: -10, rotationDeg: 15, opacity: 0.5 }}
      />,
    );
    const text = container.textContent ?? '';
    expect(text).toContain('150');   // Escala: scaleX 1.5 → 150 %
    expect(text).toContain('40');    // Posição X
    expect(text).toContain('-10');   // Posição Y
    expect(text).toContain('15');    // Girar
    expect(text).toContain('50');    // Opacidade: 0.5 → 50 %
  });

  it('los campos de Transformar commitean parches reales al blur (UI-002)', () => {
    const onTransformCommit = vi.fn();
    const { container } = render(
      <InspectorPanel
        {...base}
        tab="video"
        clipTransform={{ scaleX: 1, offsetX: 0, offsetY: 0, rotationDeg: 0, opacity: 1 }}
        onTransformCommit={onTransformCommit}
      />,
    );
    // Cada campo tiene nombre accesible propio (spinbutton = input number).
    const rotate = screen.getByRole('spinbutton', { name: 'Girar' });
    fireEvent.change(rotate, { target: { value: '45' } });
    fireEvent.focusOut(rotate);
    expect(onTransformCommit).toHaveBeenCalledWith({ rotationDeg: 45 });
    // Valor no numérico no escribe nada.
    onTransformCommit.mockClear();
    fireEvent.change(rotate, { target: { value: 'abc' } });
    fireEvent.focusOut(rotate);
    expect(onTransformCommit).not.toHaveBeenCalled();
  });

  it('«Escala uniforme」escribe scaleX+scaleY y apagado sólo scaleX (UI-002)', () => {
    const onTransformCommit = vi.fn();
    const { container } = render(
      <InspectorPanel
        {...base}
        tab="video"
        clipTransform={{ scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0, rotationDeg: 0, opacity: 1 }}
        onTransformCommit={onTransformCommit}
      />,
    );
    const scale = screen.getByRole('spinbutton', { name: 'Escala' });
    fireEvent.change(scale, { target: { value: '200' } });
    fireEvent.focusOut(scale);
    expect(onTransformCommit).toHaveBeenLastCalledWith({ scaleX: 2, scaleY: 2 });

    // Apagar el toggle: la misma edición escribe sólo scaleX.
    const toggle = screen.getByRole('switch', { name: 'Escala uniforme' });
    fireEvent.click(toggle);
    onTransformCommit.mockClear();
    fireEvent.change(scale, { target: { value: '150' } });
    fireEvent.focusOut(scale);
    expect(onTransformCommit).toHaveBeenLastCalledWith({ scaleX: 1.5 });
  });
});
