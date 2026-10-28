// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createEmptyProject } from '@editor-ia/project-schema';
import type { DownloadOutcome, DownloadRequest } from '../../services/project-service';
import { ProjectProvider, useProjectStore } from '../../state/project-store';
import { LicenseProvider } from '../../state/LicenseProvider';
import { createFakeService, readyAsset } from '../../test/fake-service';
import { DownloadView } from './DownloadView';

const NOW = '2026-10-27T00:00:00.000Z';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

function Probe() {
  const store = useProjectStore();
  const project = store.state.project;
  if (!project) return null;
  return (
    <div data-testid="project-probe">
      {`clips:${project.timeline.clips.length}|markers:${project.markers.length}|cues:${project.captions.cues.length}|cover:${Boolean((project as unknown as Record<string, unknown>)['x-coverAssetId'])}|err:${store.state.error ?? ''}|notice:${store.state.notice ?? ''}`}
    </div>
  );
}

function renderView(patch?: (service: ReturnType<typeof createFakeService>) => void) {
  const project = createEmptyProject('Descargas', NOW);
  const service = createFakeService();
  patch?.(service);
  render(
    <ProjectProvider
      service={service}
      initial={{
        project,
        opened: {
          project,
          label: 'descargas.editoria.json',
          path: 'C:\\tester\\descargas.editoria.json',
          root: 'C:\\tester',
        },
      }}
    >
      <LicenseProvider service={service}>
        <DownloadView onNavigate={() => {}} />
        <Probe />
      </LicenseProvider>
    </ProjectProvider>,
  );
  return { service };
}

async function analyzeSample() {
  fireEvent.change(screen.getByLabelText(/URL para descargar/i), {
    target: { value: 'https://www.youtube.com/watch?v=abc123' },
  });
  fireEvent.click(screen.getByRole('button', { name: /^Analizar$/i }));
  expect(await screen.findByText('Video de prueba')).toBeTruthy();
}

describe('descargador · delogo y Lanczos', () => {
  it('expone el parche de logo y el escalado dentro del look', async () => {
    renderView();
    await analyzeSample();
    const look = screen.getByRole('checkbox', { name: /Look cine analógico/i });
    fireEvent.click(look);

    const delogo = screen.getByRole('checkbox', { name: /Quitar logo fijo/i });
    const upscale = screen.getByRole('checkbox', { name: /Escalar con Lanczos/i });
    expect(delogo).toBeTruthy();
    expect(upscale).toBeTruthy();
    expect((upscale as HTMLInputElement).checked).toBe(true);
    expect(screen.getByLabelText(/Objetivo de resolución/i)).toBeTruthy();

    fireEvent.click(delogo);
    const corner = screen.getByLabelText(/Esquina del logo/i) as HTMLSelectElement;
    expect(corner.value).toBe('top-right');
    fireEvent.change(corner, { target: { value: 'bottom-left' } });
    expect(corner.value).toBe('bottom-left');
    expect(screen.getByRole('group', { name: /Zona del logo/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Redimensionar zona/i })).toBeTruthy();

    fireEvent.click(upscale);
    expect(screen.queryByLabelText(/Objetivo de resolución/i)).toBeNull();
  });

  it('inserta el clip, los subtítulos y los capítulos en el proyecto', async () => {
    renderView((service) => {
      service.importMediaPaths = async () => ({
        assets: [
          readyAsset({
            label: 'Video descargado',
            source: { type: 'local', path: 'media/video-descargado.mp4' },
          }),
          readyAsset({
            label: 'Miniatura descargada',
            kind: 'image',
            source: { type: 'local', path: 'media/miniatura.jpg' },
            media: { width: 1280, height: 720 },
          }),
        ],
        warnings: [],
      });
      const original = service.downloadMedia.bind(service);
      service.downloadMedia = async (request) => {
        const outcome = await original(request);
        return {
          ...outcome,
          files: outcome.files.map((file) => ({
            ...file,
            chapters: [
              { startSeconds: 1, title: 'Intro' },
              { startSeconds: 4, title: 'Desarrollo' },
            ],
          })),
          subtitles: [
            {
              path: 'C:\\cache\\downloads\\fake\\video.es.srt',
              name: 'video.es.srt',
              text:
                '1\n00:00:00,000 --> 00:00:01,000\nHola\n\n' +
                '2\n00:00:02,000 --> 00:00:03,000\nMundo\n',
            },
          ],
        };
      };
    });
    await analyzeSample();
    fireEvent.click(screen.getByRole('checkbox', { name: /Tengo derechos/i }));
    fireEvent.click(screen.getByRole('button', { name: /Descargar e importar/i }));
    await waitFor(
      () =>
        expect(screen.getByTestId('project-probe').textContent).toMatch(
          /^clips:1\|markers:2\|cues:2\|cover:true/,
        ),
      { timeout: 4000 },
    );
  });

  it('mantiene el enrutamiento automático y el control de red accesibles', async () => {
    renderView();
    await analyzeSample();
    expect(screen.getByRole('checkbox', { name: /Enrutamiento automático/i })).toBeTruthy();
    expect(screen.getByText(/Red, proxy y utilidades del motor/i)).toBeTruthy();
    expect(screen.getByLabelText(/Proxy HTTP\/SOCKS/i)).toBeTruthy();
    expect(screen.getByLabelText(/Límite global de bajada/i)).toBeTruthy();
    expect(screen.getByLabelText(/Recorte previo · desde/i)).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: /Insertar los videos/i })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: /Adjuntar SRT/i })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: /capítulos como marcadores/i })).toBeTruthy();
    expect(screen.getByLabelText(/Tamaño objetivo/i)).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: /Conservar el archivo original/i })).toBeTruthy();
    expect(screen.getByLabelText(/O leer del navegador/i)).toBeTruthy();
    expect(screen.getByLabelText(/^HDR$/i)).toBeTruthy();
    expect(screen.getByRole('option', { name: /Conservar HDR 10-bit/i })).toBeTruthy();
    expect(screen.getByRole('option', { name: /AV1 · máxima compresión/i })).toBeTruthy();
    expect(await screen.findByText(/Libre:/i)).toBeTruthy();
  });

  it('envía AV1 y el tonemap HDR en la solicitud', async () => {
    const captured: { request: DownloadRequest | null } = { request: null };
    renderView((service) => {
      const original = service.downloadMedia.bind(service);
      service.downloadMedia = async (request) => {
        captured.request = request;
        return original(request);
      };
    });
    await analyzeSample();
    fireEvent.click(screen.getByRole('checkbox', { name: /Tengo derechos/i }));
    const selectOf = (text: string): HTMLSelectElement =>
      screen.getByText(text).closest('label')?.querySelector('select') as HTMLSelectElement;
    fireEvent.change(selectOf('Compresión'), { target: { value: 'balanced' } });
    fireEvent.change(selectOf('Códec de compresión'), { target: { value: 'av1' } });
    fireEvent.click(screen.getByRole('button', { name: /Descargar e importar/i }));
    await waitFor(() => expect(captured.request?.codec).toBe('av1'), { timeout: 4000 });
    expect(captured.request?.hdrMode).toBe('tonemap');
  });

  it('forzar HDR conservado cambia el códec a H.265', async () => {
    const captured: { request: DownloadRequest | null } = { request: null };
    renderView((service) => {
      const original = service.downloadMedia.bind(service);
      service.downloadMedia = async (request) => {
        captured.request = request;
        return original(request);
      };
    });
    await analyzeSample();
    fireEvent.click(screen.getByRole('checkbox', { name: /Tengo derechos/i }));
    const selectOf = (text: string): HTMLSelectElement =>
      screen.getByText(text).closest('label')?.querySelector('select') as HTMLSelectElement;
    fireEvent.change(selectOf('Compresión'), { target: { value: 'balanced' } });
    fireEvent.change(selectOf('Códec de compresión'), { target: { value: 'h264' } });
    fireEvent.change(selectOf('HDR'), { target: { value: 'preserve' } });
    expect(selectOf('Códec de compresión').value).toBe('h265');
    expect(
      screen.getByRole('option', { name: /H\.264 · más compatible/i }).hasAttribute('disabled'),
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /Descargar e importar/i }));
    await waitFor(() => expect(captured.request?.hdrMode).toBe('preserve'), { timeout: 4000 });
    expect(captured.request?.codec).toBe('h265');
  });

  it('programa la descarga y permite adelantarla con Ahora', async () => {
    const captured = { calls: 0 };
    renderView((service) => {
      const original = service.downloadMedia.bind(service);
      service.downloadMedia = async (request) => {
        captured.calls += 1;
        return original(request);
      };
    });
    await analyzeSample();
    fireEvent.click(screen.getByRole('checkbox', { name: /Tengo derechos/i }));
    fireEvent.change(screen.getByLabelText(/Programar inicio/i), {
      target: { value: '2099-01-01T10:00' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Descargar e importar/i }));
    expect(await screen.findByText(/Programada para/i)).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(captured.calls).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: /Descargar ahora/i }));
    await waitFor(() => expect(captured.calls).toBe(1), { timeout: 4000 });
  });

  it('muestra los segmentos de SponsorBlock antes de descargar', async () => {
    renderView();
    await analyzeSample();
    fireEvent.click(screen.getByRole('checkbox', { name: /Quitar segmentos de SponsorBlock/i }));
    fireEvent.click(
      screen.getByRole('button', { name: /Ver segmentos antes de descargar/i }),
    );
    expect(await screen.findByText(/0:15 → 0:42/)).toBeTruthy();
    expect(screen.getByText(/0:00 → 0:08/)).toBeTruthy();
  });

  it('arranca dos descargas a la vez cuando hay dos cupos', async () => {
    const pending: Array<(outcome: DownloadOutcome) => void> = [];
    renderView((service) => {
      service.downloadMedia = (request) =>
        new Promise<DownloadOutcome>((resolve) => {
          pending.push(resolve);
          expect(request.runId).toBeTruthy();
        });
      service.importMediaPaths = async () => ({ assets: [], warnings: ['sin importar'] });
    });
    await analyzeSample();
    fireEvent.click(screen.getByRole('checkbox', { name: /Tengo derechos/i }));
    fireEvent.click(screen.getByRole('button', { name: /Descargar e importar/i }));
    fireEvent.click(screen.getByRole('button', { name: /Descargar e importar/i }));
    expect(await screen.findByText(/2 descarga\(s\) en paralelo/i)).toBeTruthy();
    await waitFor(() => expect(pending).toHaveLength(2), { timeout: 4000 });
    pending.forEach((resolve, index) =>
      resolve({
        runId: `run-${index}`,
        directory: `C:\\cache\\downloads\\run-${index}`,
        files: [
          {
            path: `C:\\cache\\downloads\\run-${index}\\video.mp4`,
            name: 'video.mp4',
            bytes: 1_000,
            kind: 'video',
          },
        ],
        compressed: false,
        warnings: [],
      }),
    );
  });

  it('traduce y quema subtítulos al descargar', async () => {
    const trace = { texts: [] as string[], imported: [] as string[], burned: 0 };
    renderView((service) => {
      const original = service.downloadMedia.bind(service);
      service.downloadMedia = async (request) => {
        const outcome = await original(request);
        return {
          ...outcome,
          files: outcome.files.map((file) => ({ ...file, kind: 'video' as const })),
          subtitles: [
            {
              path: 'C:\\cache\\downloads\\fake\\video.es.srt',
              name: 'video.es.srt',
              text: '1\n00:00:00,000 --> 00:00:01,000\nHola mundo\n',
            },
          ],
        };
      };
      service.translateSubtitles = async (request) => {
        trace.texts = Array.from(request.texts);
        return {
          texts: request.texts.map((text) => `ES: ${text}`),
          providerId: 'local',
          model: 'test',
          simulated: false,
        };
      };
      service.creatorBurnSubtitles = async (request) => {
        trace.burned += 1;
        return {
          path: request.outputPath,
          kind: 'subtitles',
          width: 1920,
          height: 1080,
          durationSeconds: 10,
          bytes: 1_000,
        };
      };
      service.importMediaPaths = async (input) => {
        trace.imported = Array.from(input.paths);
        return {
          assets: input.paths.map((path) =>
            readyAsset({
              label: 'Video subtitulado',
              source: { type: 'local', path: 'media/video-subtitulado.mp4' },
            }),
          ),
          warnings: [],
        };
      };
    });
    await analyzeSample();
    fireEvent.click(screen.getByRole('checkbox', { name: /Tengo derechos/i }));
    fireEvent.click(
      screen.getByRole('checkbox', { name: /Descargar subtítulos y adjuntarlos/i }),
    );
    fireEvent.click(
      screen.getByRole('checkbox', { name: /Traducir los subtítulos al descargar/i }),
    );
    fireEvent.click(
      screen.getByRole('checkbox', { name: /Quemar los subtítulos en el video/i }),
    );
    fireEvent.click(screen.getByRole('button', { name: /Descargar e importar/i }));
    await waitFor(() => expect(trace.burned).toBe(1), { timeout: 4000 });
    expect(trace.texts).toContain('Hola mundo');
    expect(trace.imported[0]).toMatch(/- subtitulado\.mp4$/);
    await waitFor(
      () =>
        expect(screen.getByTestId('project-probe').textContent).toMatch(/cues:1/),
      { timeout: 4000 },
    );
  });

  it('escanea la carpeta vigilada, agrega feeds y prueba proxies', async () => {
    renderView((service) => {
      service.downloadMedia = () => new Promise<DownloadOutcome>(() => {});
    });
    await analyzeSample();
    fireEvent.click(screen.getByText(/Automatización: carpeta vigilada/i));
    const watchInput = screen.getByLabelText(/Carpeta vigilada/i);
    const automation = watchInput.closest('details');
    expect(automation).toBeTruthy();
    fireEvent.click(within(automation!).getByRole('button', { name: /Elegir carpeta…/i }));
    await waitFor(() =>
      expect((screen.getByLabelText(/Carpeta vigilada/i) as HTMLInputElement).value).not.toBe(
        '',
      ),
    );
    fireEvent.click(screen.getByRole('checkbox', { name: /Vigilar cada 60 s/i }));
    fireEvent.click(screen.getByRole('button', { name: /Escanear ahora/i }));
    expect(await screen.findByText(/lista\(s\) leídas, 2 URL\(s\) nuevas/i)).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/Feed RSS o Atom/i), {
      target: { value: 'https://example.com/feed.xml' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Agregar feed/i }));
    expect(await screen.findByText(/Feed agregado con 1 entrada/i)).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/Proxy HTTP\/SOCKS/i), {
      target: { value: 'socks5://127.0.0.1:1080' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Probar proxies/i }));
    expect(await screen.findByText('42 ms')).toBeTruthy();
  });
});

describe('descargador · cola consolidada', () => {
  it('resume la cola en un pie y despliega el detalle a pedido', async () => {
    renderView();
    await analyzeSample();
    fireEvent.click(screen.getByRole('checkbox', { name: /Tengo derechos/i }));
    fireEvent.click(screen.getByText('Red, proxy y utilidades del motor'));
    const batch = screen.getByLabelText(/Lote de URLs/i);
    fireEvent.change(batch, {
      target: {
        value: [
          'https://youtube.com/watch?v=col1',
          'https://youtube.com/watch?v=col2',
          'https://youtube.com/watch?v=col3',
          'https://youtube.com/watch?v=col4',
        ].join('\n'),
      },
    });
    fireEvent.click(screen.getByRole('button', { name: /Agregar lote a la cola/i }));
    await waitFor(() => {
      const footer = document.querySelector('.download-queue-footer');
      expect(footer?.textContent).toContain('4 en total');
    });
    const footer = document.querySelector('.download-queue-footer') as HTMLElement;
    expect(footer).toBeTruthy();
    expect(document.querySelector('.download-queue-list')).toBeNull();
    fireEvent.click(within(footer).getByRole('button', { name: /Expandir/i }));
    await waitFor(() =>
      expect(
        document.querySelectorAll('.download-queue-list > li').length,
      ).toBe(4),
    );
    expect(within(footer).getByRole('button', { name: /Contraer/i })).toBeTruthy();

    const parallel = screen.getByLabelText('Descargas simultáneas') as HTMLInputElement;
    expect(parallel.value).toBe('6');
    const advanced = screen.getByLabelText(
      /Permitir hasta 512 descargas simultáneas/i,
    ) as HTMLInputElement;
    fireEvent.click(advanced);
    fireEvent.change(parallel, { target: { value: '512' } });
    expect(parallel.value).toBe('512');
    fireEvent.click(advanced);
    expect(parallel.value).toBe('8');
  });
});

describe('descargador · plan Free', () => {
  it('limita a 2 simultáneas y bloquea el modo avanzado', async () => {
    renderView((service) => service.setLicenseTier('free'));
    expect(await screen.findByText('Plan Free')).toBeTruthy();
    await analyzeSample();
    fireEvent.click(screen.getByRole('checkbox', { name: /Tengo derechos/i }));
    fireEvent.click(screen.getByText('Red, proxy y utilidades del motor'));
    fireEvent.change(screen.getByLabelText(/Lote de URLs/i), {
      target: {
        value: [
          'https://youtube.com/watch?v=free1',
          'https://youtube.com/watch?v=free2',
          'https://youtube.com/watch?v=free3',
        ].join('\n'),
      },
    });
    fireEvent.click(screen.getByRole('button', { name: /Agregar lote a la cola/i }));
    await waitFor(() => {
      const footer = document.querySelector('.download-queue-footer');
      expect(footer?.textContent).toContain('3 en total');
    });
    const footer = document.querySelector('.download-queue-footer') as HTMLElement;
    fireEvent.click(within(footer).getByRole('button', { name: /Expandir/i }));
    const parallel = screen.getByLabelText('Descargas simultáneas') as HTMLInputElement;
    await waitFor(() => expect(parallel.value).toBe('2'));
    expect(parallel.max).toBe('2');
    expect(
      (screen.getByLabelText(/Permitir hasta 512 descargas simultáneas/i) as HTMLInputElement)
        .disabled,
    ).toBe(true);
  });
});
