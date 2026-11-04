// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectDocument } from '@editor-ia/project-schema';
import { createEmptyProject } from '@editor-ia/project-schema';
import type { MissingAssetInfo } from '../../services/project-service';
import { ProjectHome } from './ProjectHome';
import { ProjectProvider } from '../../state/project-store';
import { addAsset, addClipFromAsset, ensureDelivery } from '../../state/project-actions';
import { createFakeService, readyAsset } from '../../test/fake-service';

const NOW = '2026-11-03T00:00:00.000Z';
const ROOT = 'C:\\tester';
const VIDEO_ID = '11111111-1111-4111-8111-111111111111';
const IMAGE_ID = '22222222-2222-4222-8222-222222222222';

function projectWithMedia(options: { readonly withClip?: boolean } = {}): ProjectDocument {
  let project = ensureDelivery(createEmptyProject('Medios', NOW));
  const video = readyAsset({
    id: VIDEO_ID,
    label: 'Toma faltante',
    source: { type: 'local', path: 'media/faltante.mp4' },
  });
  const image = readyAsset({
    id: IMAGE_ID,
    label: 'Placa presente',
    kind: 'image',
    source: { type: 'local', path: 'media/presente.png' },
    media: { width: 1920, height: 1080 },
  });
  project = addAsset(project, video);
  project = addAsset(project, image);
  if (options.withClip) {
    const added = project.assets.find((asset) => asset.id === VIDEO_ID);
    if (!added) throw new Error('no se agregó el asset de prueba');
    project = addClipFromAsset(project, added, { atFrame: 0 }).project;
  }
  return project;
}

function missing(overrides: Partial<MissingAssetInfo> = {}): MissingAssetInfo {
  return {
    assetId: VIDEO_ID,
    label: 'Toma faltante',
    kind: 'video',
    path: 'media/faltante.mp4',
    usedByClipIds: ['clip-1'],
    proxyPath: null,
    ...overrides,
  };
}

function renderProjects(
  project: ProjectDocument,
  configure: (service: ReturnType<typeof createFakeService>) => void = () => {},
) {
  const service = createFakeService();
  configure(service);
  const onNavigate = vi.fn();
  render(
    <ProjectProvider
      service={service}
      initial={{
        project,
        opened: {
          project,
          label: 'medios.editoria.json',
          path: `${ROOT}\\medios.editoria.json`,
          root: ROOT,
        },
      }}
    >
      <ProjectHome onNavigate={onNavigate} />
    </ProjectProvider>,
  );
  return { service, onNavigate };
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('Proyectos · medios del proyecto (detección honesta)', () => {
  it('lista y cuenta los medios faltantes usando el contrato de Fase 1', async () => {
    const { service } = renderProjects(projectWithMedia({ withClip: true }), (fake) => {
      fake.findMissingAssets = async () => [missing()];
    });
    const detect = vi.spyOn(service, 'findMissingAssets');

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/Faltan 1 de 2 medios locales/i);
    expect(alert.textContent).toMatch(/no modifica ni borra archivos/i);

    const card = screen.getByRole('heading', { name: /Medios del proyecto/i }).closest('article')!;
    expect(card.textContent).toContain('Toma faltante');
    expect(card.textContent).toContain('media/faltante.mp4');
    expect(card.textContent).toMatch(/Video/);
    expect(card.textContent).toMatch(/En uso por 1 clip/);
    // El medio presente no aparece en la lista de faltantes.
    expect(card.textContent).not.toContain('Placa presente');

    // Acciones reales del contrato: relink individual y por carpeta.
    expect(screen.getByRole('button', { name: /Relink…/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Buscar carpeta…/ })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Volver a comprobar/i }));
    await waitFor(() => expect(detect).toHaveBeenCalledTimes(1));
  });

  it('muestra el chip de proxy sin fingir que reemplaza al archivo', async () => {
    renderProjects(projectWithMedia(), (fake) => {
      fake.findMissingAssets = async () => [
        missing({ proxyPath: 'media/proxies/proxy-asset-video.mp4' }),
      ];
    });

    expect(await screen.findByText(/Proxy disponible \(sólo previsualización\)/i)).toBeTruthy();
    expect(screen.getByText(/el archivo original sigue faltando/i)).toBeTruthy();
  });

  it('declara cuando todos los medios están disponibles', async () => {
    renderProjects(projectWithMedia());
    expect(await screen.findByText(/todos están disponibles/i)).toBeTruthy();
    expect(screen.getByText(/Al día/i)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('muestra el error real si la comprobación falla y permite reintentar', async () => {
    const { service } = renderProjects(projectWithMedia(), (fake) => {
      fake.findMissingAssets = async () => {
        throw new Error('el disco no respondió');
      };
    });
    const detect = vi.spyOn(service, 'findMissingAssets');

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/No se pudieron comprobar los medios/i);
    expect(alert.textContent).toMatch(/el disco no respondió/i);

    fireEvent.click(screen.getByRole('button', { name: /Reintentar/i }));
    await waitFor(() => expect(detect).toHaveBeenCalledTimes(1));
  });

  it('en navegador explica que la comprobación necesita la app nativa', async () => {
    const project = projectWithMedia();
    const service = {
      ...createFakeService(),
      available: false,
      unavailableReason: 'Esta es la versión web de evaluación: no hay runtime nativo.',
    };
    render(
      <ProjectProvider
        service={service as ReturnType<typeof createFakeService>}
        initial={{
          project,
          opened: {
            project,
            label: 'medios.editoria.json',
            path: `${ROOT}\\medios.editoria.json`,
            root: ROOT,
          },
        }}
      >
        <ProjectHome onNavigate={vi.fn()} />
      </ProjectProvider>,
    );

    expect(
      await screen.findByText(/La comprobación de medios necesita la app de escritorio/i),
    ).toBeTruthy();
  });

  it('sin medios locales no inventa un resultado vacío problemático', async () => {
    const project = ensureDelivery(createEmptyProject('Sin medios', NOW));
    renderProjects(project);
    expect(await screen.findByText(/no tiene medios locales que comprobar/i)).toBeTruthy();
  });
});
