// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectProvider } from '../../state/project-store';
import { createFakeService } from '../../test/fake-service';
import { LearnView } from './LearnView';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

function renderView() {
  const navigate = vi.fn();
  render(
    <ProjectProvider service={createFakeService()}>
      <LearnView onNavigate={navigate} />
    </ProjectProvider>,
  );
  return navigate;
}

describe('centro de aprendizaje', () => {
  it('muestra la ruta rápida y navega a la herramienta', () => {
    const navigate = renderView();
    expect(screen.getByRole('heading', { name: /Tu primer video, paso a paso/i })).toBeTruthy();
    expect(screen.getByText(/De la idea al MP4 en cinco pasos/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Ir a Proyectos/i }));
    expect(navigate).toHaveBeenCalledWith('projects');
  });

  it('filtra la guía y guarda el progreso local', () => {
    renderView();
    fireEvent.change(screen.getByLabelText(/Buscar en la guía/i), {
      target: { value: 'CRF' },
    });
    expect(screen.getByText(/Archivos chicos y verificados/i)).toBeTruthy();
    expect(screen.queryByText(/Conectá herramientas locales/i)).toBeNull();

    const card = screen.getByText(/Archivos chicos y verificados/i).closest('article') as HTMLElement;
    fireEvent.click(within(card).getByRole('checkbox', { name: /Hecho/i }));
    expect(window.localStorage.getItem('editor-ia.learning-progress.v2')).toContain('export');
    expect(screen.getByText(/1 de 13 temas/i)).toBeTruthy();
  });
});
