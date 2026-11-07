// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { computePipeline, pipelineSignals } from '../app/pipeline';
import { WorkspaceGuide } from './WorkspaceGuide';

afterEach(() => cleanup());

const LABELS = ['Proyecto', 'Guion', 'Medios', 'Voz', 'Edición', 'Exportar'];

describe('WorkspaceGuide · recorrido único', () => {
  it('muestra las seis etapas canónicas y navega a la vista real de cada una', () => {
    const onNavigate = vi.fn();
    const { container } = render(<WorkspaceGuide onNavigate={onNavigate} />);
    expect(container.querySelectorAll('.learn-steps > li')).toHaveLength(6);
    for (const label of LABELS) expect(screen.getByText(label)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Ir a Guion/i }));
    expect(onNavigate).toHaveBeenCalledWith('script');
  });

  it('usa el progreso real y no inventa etapas completadas', () => {
    const progress = computePipeline(pipelineSignals(null, false));
    render(<WorkspaceGuide onNavigate={() => {}} progress={progress} />);
    const meter = screen.getByRole('progressbar', { name: /progreso de la ruta/i });
    expect(meter.getAttribute('aria-valuenow')).toBe('0');
    expect(meter.getAttribute('aria-valuemax')).toBe('6');
    expect(screen.getByText(/Tu próximo paso es proyecto/i)).toBeTruthy();
  });

  it('la variante compacta conserva los seis pasos, el mapa y los launchers', () => {
    const onTour = vi.fn();
    const onShortcuts = vi.fn();
    const { container } = render(
      <WorkspaceGuide
        onNavigate={() => {}}
        compact
        onOpenTour={onTour}
        onOpenShortcuts={onShortcuts}
      />,
    );
    expect(container.querySelectorAll('.learn-steps > li')).toHaveLength(6);
    // Unificación: el editor compacto muestra el MISMO mapa de 4 grupos.
    expect(container.querySelector('.workspace-guide-map-compact')).toBeTruthy();
    expect(container.querySelectorAll('.workspace-guide-group')).toHaveLength(4);
    fireEvent.click(screen.getByRole('button', { name: /Tour guiado/i }));
    fireEvent.click(screen.getByRole('button', { name: /Atajos de teclado/i }));
    expect(onTour).toHaveBeenCalledOnce();
    expect(onShortcuts).toHaveBeenCalledOnce();
  });

  it('expone el mapa del estudio con los cuatro grupos', () => {
    const { container } = render(<WorkspaceGuide onNavigate={() => {}} />);
    expect(container.querySelectorAll('.workspace-guide-group')).toHaveLength(4);
    expect(screen.getByText('Preparar')).toBeTruthy();
    expect(screen.getByText('Editar')).toBeTruthy();
    expect(screen.getByText('Potenciar')).toBeTruthy();
    expect(screen.getByText('Aprender y ajustar')).toBeTruthy();
  });
});
