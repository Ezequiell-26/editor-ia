// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyProject } from '@editor-ia/project-schema';
import { ProjectProvider } from '../../state/project-store';
import { createFakeService } from '../../test/fake-service';
import { StickmanPanel } from './StickmanPanel';

const NOW = '2026-11-07T00:00:00.000Z';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

function renderPanel(patch?: (service: ReturnType<typeof createFakeService>) => void) {
  const project = createEmptyProject('Motion', NOW);
  const service = createFakeService();
  patch?.(service);
  render(
    <ProjectProvider
      service={service}
      initial={{
        project,
        opened: {
          project,
          label: 'motion.editoria.json',
          path: 'C:\\tester\\motion.editoria.json',
          root: 'C:\\tester',
        },
      }}
    >
      <StickmanPanel onNavigate={() => undefined} />
    </ProjectProvider>,
  );
  return service;
}

describe('StickmanPanel', () => {
  it('renderiza el stickman con la acción elegida', async () => {
    const service = renderPanel((svc) => {
      svc.chooseDownloadDirectory = async () => 'C:\\renders';
    });
    const spy = vi.spyOn(service, 'stickmanRender');
    fireEvent.change(screen.getByLabelText('Acción'), { target: { value: 'run' } });
    fireEvent.click(screen.getByRole('button', { name: /Renderizar stickman/ }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    const input = spy.mock.calls[0]?.[0] as { action: string; outputPath: string };
    expect(input.action).toBe('run');
    expect(input.outputPath).toContain('stickman-run-');
    await waitFor(() => expect(screen.getByText(/verificado con ffprobe|Listo:/)).toBeTruthy());
  });

  it('muestra error si no se elige carpeta', async () => {
    renderPanel((svc) => {
      svc.chooseDownloadDirectory = async () => null;
    });
    fireEvent.click(screen.getByRole('button', { name: /Renderizar stickman/ }));
    await waitFor(() =>
      expect(screen.getByText('Elegí una carpeta de destino para el video.')).toBeTruthy(),
    );
  });
});
