// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createEmptyProject } from '@editor-ia/project-schema';
import { ProjectProvider } from '../../state/project-store';
import { createFakeService } from '../../test/fake-service';
import { CreatorView } from './CreatorView';

const NOW = '2026-10-28T00:00:00.000Z';

afterEach(cleanup);

function renderView() {
  const project = createEmptyProject('Creador', NOW);
  const service = createFakeService();
  render(
    <ProjectProvider
      service={service}
      initial={{
        project,
        opened: {
          project,
          label: 'creador.editoria.json',
          path: 'C:\\tester\\creador.editoria.json',
          root: 'C:\\tester',
        },
      }}
    >
      <CreatorView onNavigate={() => {}} />
    </ProjectProvider>,
  );
  return { service };
}

describe('herramientas de creador', () => {
  it('muestra los seis módulos', () => {
    renderView();
    expect(screen.getByRole('heading', { name: /Herramientas de creador/i })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Hook de 3 segundos/i })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Exportar a 3 formatos/i })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /CTA de cierre \+ QR/i })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /B-roll rompe-monotonía/i })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Dividir por capítulos/i })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Quemar subtítulos/i })).toBeTruthy();
  });

  it('elige un video y genera hook y tres variantes', async () => {
    renderView();
    fireEvent.click(screen.getByRole('button', { name: /Elegir video/i }));
    await waitFor(() =>
      expect((screen.getByLabelText(/Video de entrada/i) as HTMLInputElement).value).not.toBe(''),
    );
    fireEvent.click(screen.getByRole('button', { name: /Generar hook/i }));
    expect(await screen.findByText(/toma-hook\.mp4/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Exportar variantes/i }));
    expect(await screen.findByText(/vertical\.mp4/i)).toBeTruthy();
    expect(screen.getByText(/horizontal\.mp4/i)).toBeTruthy();
    expect(screen.getByText(/square\.mp4/i)).toBeTruthy();
  });

  it('cierra el short 9:16 con hook y subtítulos quemados', async () => {
    renderView();
    fireEvent.click(screen.getByRole('button', { name: /Elegir video/i }));
    await waitFor(() =>
      expect((screen.getByLabelText(/Video de entrada/i) as HTMLInputElement).value).not.toBe(''),
    );
    fireEvent.click(screen.getByRole('button', { name: /Generar hook/i }));
    expect(await screen.findByText(/toma-hook\.mp4/i)).toBeTruthy();

    fireEvent.click(screen.getByRole('checkbox', { name: /16:9 horizontal/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /1:1 cuadrado/i }));
    fireEvent.click(screen.getByRole('button', { name: /Exportar variantes/i }));
    expect(await screen.findByText(/vertical\.mp4/i)).toBeTruthy();
    expect(screen.queryByText(/horizontal\.mp4/i)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Elegir subtítulos/i }));
    await waitFor(() =>
      expect(screen.getByLabelText(/Archivo de subtítulos/i)).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole('button', { name: /^Quemar subtítulos$/i }));
    expect(await screen.findByText(/toma-subs\.mp4/i)).toBeTruthy();
  });

  it('divide capítulos y quema subtítulos', async () => {
    renderView();
    fireEvent.click(screen.getByRole('button', { name: /Elegir video/i }));
    await waitFor(() =>
      expect((screen.getByLabelText(/Video de entrada/i) as HTMLInputElement).value).not.toBe(''),
    );
    fireEvent.click(screen.getByRole('button', { name: /Dividir capítulos/i }));
    expect(await screen.findByText(/capitulo-1\.mp4/i)).toBeTruthy();
    expect(screen.getByText(/capitulo-2\.mp4/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Elegir subtítulos/i }));
    await waitFor(() =>
      expect((screen.getByLabelText(/Archivo de subtítulos/i) as HTMLInputElement).value).toBe(
        'demo.srt',
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: /^Quemar subtítulos$/i }));
    expect(await screen.findByText(/toma-subs\.mp4/i)).toBeTruthy();
  });
});
