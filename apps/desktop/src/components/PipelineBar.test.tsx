// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PipelineBar } from './PipelineBar';
import { computePipeline, type PipelineSignals } from '../app/pipeline';

const EMPTY: PipelineSignals = {
  hasProject: false,
  scenes: 0,
  media: 0,
  audio: 0,
  clips: 0,
  exported: false,
};

function renderBar(signals: PipelineSignals) {
  const onSelect = vi.fn();
  render(
    <PipelineBar
      progress={computePipeline(signals)}
      activeId="home"
      onSelect={onSelect}
    />,
  );
  return { onSelect };
}

afterEach(cleanup);

describe('barra de ruta', () => {
  it('sin proyecto propone el paso 1 y navega al elegirlo', () => {
    const { onSelect } = renderBar(EMPTY);
    expect(screen.getByText('paso 1 de 6')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Siguiente: Proyecto/ })).toBeTruthy();
    expect(screen.getByLabelText('1. Proyecto: Sin proyecto')).toBeTruthy();
    // El botón siguiente y el paso actual llevan al mismo lugar.
    fireEvent.click(screen.getByRole('button', { name: /Siguiente: Proyecto/ }));
    expect(onSelect).toHaveBeenCalledWith('projects');
  });

  it('marca el paso actual y deja los anteriores como hechos', () => {
    const { onSelect } = renderBar({ ...EMPTY, hasProject: true, scenes: 2 });
    const steps = screen.getAllByRole('button', { name: /^\d\. / });
    expect(steps[0]?.textContent).toContain('Proyecto');
    expect(steps[0]?.className).toMatch(/done/);
    expect(steps[1]?.className).toMatch(/done/);
    // Sin medios cargados, el paso actual es Medios.
    expect(steps[2]?.className).toMatch(/current/);

    // El botón siguiente lleva al paso actual, no al siguiente.
    fireEvent.click(screen.getByRole('button', { name: /Siguiente: Medios/ }));
    expect(onSelect).toHaveBeenCalledWith('assets');
  });

  it('con la ruta completa no ofrece siguiente', () => {
    renderBar({
      hasProject: true,
      scenes: 4,
      media: 9,
      audio: 4,
      clips: 12,
      exported: true,
    });
    expect(screen.getByText('completa')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Siguiente:/ })).toBeNull();
    expect(screen.getByText('100%')).toBeTruthy();
  });

  it('cada paso navega a su vista', () => {
    const { onSelect } = renderBar({ ...EMPTY, hasProject: true });
    fireEvent.click(screen.getByLabelText('5. Edición: Timeline vacía'));
    expect(onSelect).toHaveBeenCalledWith('editor');
  });
});
