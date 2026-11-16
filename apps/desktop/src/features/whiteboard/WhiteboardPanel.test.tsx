// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyProject } from '@editor-ia/project-schema';
import { ProjectProvider } from '../../state/project-store';
import { createFakeService } from '../../test/fake-service';
import { WhiteboardPanel } from './WhiteboardPanel';
import { WhiteboardPreview } from './WhiteboardPreview';
import { demoWhiteboardStrokes } from './whiteboard';

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
      <WhiteboardPanel onNavigate={() => undefined} />
    </ProjectProvider>,
  );
  return service;
}

describe('WhiteboardPanel', () => {
  it('pide imagen antes de generar y luego invoca whiteboardGenerate', async () => {
    const service = renderPanel((svc) => {
      svc.chooseImageFile = async () => 'C:\\fotos\\boceto.png';
      svc.chooseAudioFile = async () => 'C:\\audio\\voz.wav';
    });
    const spy = vi.spyOn(service, 'whiteboardGenerate');

    // Sin imagen el botón está deshabilitado.
    const generate = screen.getByRole('button', { name: /Generar video whiteboard/ });
    expect((generate as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Imagen fuente' }));
    await waitFor(() => expect(screen.getByText('boceto.png')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /Generar video whiteboard/ }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    const input = spy.mock.calls[0]?.[0] as {
      imagePath: string;
      audioPath?: string;
      quality?: string;
    };
    expect(input.imagePath).toBe('C:\\fotos\\boceto.png');
    expect(input.quality).toBe('medium');
    await waitFor(() => expect(screen.getByText(/Listo:/)).toBeTruthy());
    expect(screen.getByText(/whiteboard-test\.mp4/)).toBeTruthy();
  });

  it('avisa cuando el motor Python no está disponible', async () => {
    renderPanel((svc) => {
      svc.whiteboardStatus = async () => ({
        available: false,
        reason: 'no hay un Python con whiteboard-animator',
      });
    });
    await waitFor(() =>
      expect(screen.getByText(/Motor no disponible/)).toBeTruthy(),
    );
    const generate = screen.getByRole('button', { name: /Generar video whiteboard/ });
    expect((generate as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('WhiteboardPreview', () => {
  it('renderiza los trazos y la mano cuando showHand está activo', () => {
    const { container } = render(
      <WhiteboardPreview
        strokes={demoWhiteboardStrokes('sketch')}
        aspect={16 / 9}
        speed={0.32}
        inkHex="#1f2937"
        boardHex="#f7f5ef"
        showHand
        handStyle="hand1"
        playing={false}
      />,
    );
    const paths = container.querySelectorAll('path[pathLength="1"]');
    expect(paths.length).toBe(demoWhiteboardStrokes('sketch').length);
    const image = container.querySelector('image');
    expect(image).not.toBeNull();
    expect(image?.getAttribute('href') ?? image?.getAttribute('xlink:href')).toBeTruthy();
  });

  it('sin mano no renderiza el sprite', () => {
    const { container } = render(
      <WhiteboardPreview
        strokes={demoWhiteboardStrokes('circle')}
        aspect={1}
        speed={0.32}
        inkHex="#ffffff"
        boardHex="#1f4d3a"
        showHand={false}
        handStyle="hand1"
        playing={false}
      />,
    );
    expect(container.querySelector('image')).toBeNull();
  });
});
