// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyProject } from '@editor-ia/project-schema';
import { ProjectProvider } from '../../state/project-store';
import { createFakeService } from '../../test/fake-service';
import { YouTubeAnalyzerView } from './YouTubeAnalyzerView';

const NOW = '2026-10-27T00:00:00.000Z';

afterEach(cleanup);

function renderView() {
  const project = createEmptyProject('YouTube', NOW);
  const service = createFakeService();
  render(
    <ProjectProvider
      service={service}
      initial={{
        project,
        opened: {
          project,
          label: 'yt.editoria.json',
          path: 'C:\\tester\\yt.editoria.json',
          root: 'C:\\tester',
        },
      }}
    >
      <YouTubeAnalyzerView />
    </ProjectProvider>,
  );
  return { service };
}

describe('analizador de YouTube', () => {
  it('analiza el canal y muestra el mejor video con razones', async () => {
    renderView();
    expect(screen.getByRole('heading', { name: /Analizador de YouTube/i })).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/URL del canal/i), {
      target: { value: '@demo' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Analizar canal/i }));
    expect(await screen.findByText('Canal de prueba')).toBeTruthy();
    expect(screen.getByText(/Mejor video analizado/i)).toBeTruthy();
    expect(screen.getAllByText(/Cómo editar 5 veces más rápido/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/1,8× las vistas por día/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Fortalezas/i)).toBeTruthy();
    expect(screen.getByText(/Oportunidades/i)).toBeTruthy();
    expect(screen.getByText(/Se detallaron 2 de 12 videos/i)).toBeTruthy();
    expect(screen.getByText(/Patrones de título/i)).toBeTruthy();
  });

  it('muestra el vacío antes de analizar', () => {
    renderView();
    expect(screen.getByText(/Sin análisis todavía/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Analizar canal/i })).toBeTruthy();
  });
});
