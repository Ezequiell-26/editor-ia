// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectDocument } from '@editor-ia/project-schema';
import { createEmptyProject } from '@editor-ia/project-schema';
import type {
  DuplicateAssetGroup,
  MissingAssetInfo,
  ProjectVersionInfo,
  RelinkFolderResult,
  RelinkResult,
  RestoreProjectVersionResult,
} from '../../services/project-service';
import { ProjectHome } from './ProjectHome';
import { ProjectProvider, useProjectStore } from '../../state/project-store';
import { addAsset, addClipFromAsset, ensureDelivery } from '../../state/project-actions';
import { createFakeService, readyAsset } from '../../test/fake-service';

const NOW = '2026-11-03T00:00:00.000Z';
const ROOT = 'C:\\tester';
const PROJECT_PATH = `${ROOT}\\gestion.editoria.json`;
const HASH = 'a'.repeat(64);
// El schema exige entity ids UUID v4: los fixtures deben ser válidos para que
// `store.update` pueda persistir los cambios (relink, quitar duplicados).
const VIDEO_ID = '11111111-1111-4111-8111-111111111111';
const IMAGE_ID = '22222222-2222-4222-8222-222222222222';

function projectWithAssets(imagesUsedByClips = false): ProjectDocument {
  let project = ensureDelivery(createEmptyProject('Gestión', NOW));
  const video = readyAsset({
    id: VIDEO_ID,
    label: 'Toma faltante',
    source: { type: 'local', path: 'media/faltante.mp4' },
  });
  const image = readyAsset({
    id: IMAGE_ID,
    label: 'Copia de la placa',
    kind: 'image',
    source: { type: 'local', path: 'media/copia.png' },
    media: { width: 1920, height: 1080 },
  });
  project = addAsset(project, video);
  project = addAsset(project, image);
  const videoAsset = project.assets.find((asset) => asset.id === VIDEO_ID);
  if (!videoAsset) throw new Error('sin asset de video');
  project = addClipFromAsset(project, videoAsset, { atFrame: 0 }).project;
  if (imagesUsedByClips) {
    const imageAsset = project.assets.find((asset) => asset.id === IMAGE_ID);
    if (!imageAsset) throw new Error('sin asset de imagen');
    project = addClipFromAsset(project, imageAsset, { atFrame: 30 }).project;
  }
  return project;
}

function missing(): MissingAssetInfo {
  return {
    assetId: VIDEO_ID,
    label: 'Toma faltante',
    kind: 'video',
    path: 'media/faltante.mp4',
    usedByClipIds: ['clip-1'],
    proxyPath: null,
  };
}

function version(overrides: Partial<ProjectVersionInfo> = {}): ProjectVersionInfo {
  return {
    id: 'v-2026-11-03T0000',
    projectPath: PROJECT_PATH,
    path: `${ROOT}\\.olyvia-history\\v-2026-11-03T0000.editoria.json`,
    savedAtMs: Date.UTC(2026, 10, 3, 12, 0, 0),
    bytes: 4096,
    reason: 'autosave',
    projectName: 'Gestión',
    assetCount: 2,
    clipCount: 1,
    ...overrides,
  };
}

function duplicateGroup(overrides: Partial<DuplicateAssetGroup> = {}): DuplicateAssetGroup {
  return {
    sha256: HASH,
    bytes: 120_000,
    assetIds: [VIDEO_ID, IMAGE_ID],
    labels: ['Toma faltante', 'Copia de la placa'],
    paths: ['media/faltante.mp4', 'media/copia.png'],
    usedByClipIds: {},
    ...overrides,
  };
}

/** Espía de sólo lectura sobre el documento del store real. */
function StoreProbe() {
  const store = useProjectStore();
  const project = store.state.project;
  const video = project?.assets.find((asset) => asset.id === VIDEO_ID);
  return (
    <>
      <span data-testid="video-path">
        {video?.source.type === 'local' ? video.source.path : ''}
      </span>
      <span data-testid="video-status">{video?.status ?? ''}</span>
      <span data-testid="asset-count">{project?.assets.length ?? 0}</span>
      <span data-testid="image-present">
        {project?.assets.some((asset) => asset.id === IMAGE_ID) ? 'sí' : 'no'}
      </span>
      <span data-testid="store-error">{store.state.error ?? ''}</span>
    </>
  );
}

function renderProjects(
  project: ProjectDocument,
  configure: (service: ReturnType<typeof createFakeService>) => void = () => {},
) {
  const service = createFakeService();
  configure(service);
  render(
    <ProjectProvider
      service={service}
      initial={{
        project,
        opened: {
          project,
          label: 'gestion.editoria.json',
          path: PROJECT_PATH,
          root: ROOT,
        },
      }}
    >
      <ProjectHome onNavigate={vi.fn()} />
      <StoreProbe />
    </ProjectProvider>,
  );
  return service;
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('Proyectos · relink de medios', () => {
  it('reconecta un medio individual y actualiza el documento del store', async () => {
    const service = renderProjects(projectWithAssets(), (fake) => {
      fake.findMissingAssets = async () => [missing()];
      fake.chooseVideoFile = async () => 'C:\\elegido\\faltante.mp4';
      // El backend devuelve la ruta RELATIVA al proyecto (contrato Fase 1).
      fake.relinkAsset = async (assetId): Promise<RelinkResult> => ({
        ok: true,
        assetId,
        path: 'media/relink/faltante.mp4',
        copied: true,
        validatedBy: 'name-size',
        bytes: 120_000,
        sha256: null,
      });
    });
    const relink = vi.spyOn(service, 'relinkAsset');

    fireEvent.click(await screen.findByRole('button', { name: /Relink…/ }));

    await waitFor(() =>
      expect(relink).toHaveBeenCalledWith(VIDEO_ID, 'C:\\elegido\\faltante.mp4'),
    );
    expect(await screen.findByText(/reconectado \(se copió el archivo/i)).toBeTruthy();
    expect(screen.getByTestId('store-error').textContent).toBe('');
    expect(screen.getByTestId('video-path').textContent).toBe('media/relink/faltante.mp4');
    // Sin hash nuevo el medio no se declara listo: queda «unverified» honesto.
    expect(screen.getByTestId('video-status').textContent).toBe('unverified');
  });

  it('reconecta por carpeta y aplica la ruta nueva de cada asset', async () => {
    const service = renderProjects(projectWithAssets(), (fake) => {
      fake.findMissingAssets = async () => [missing()];
      fake.chooseMediaFolder = async () => 'C:\\medios';
      fake.relinkAssetsFromFolder = async (): Promise<RelinkFolderResult> => ({
        relinked: [
          {
            ok: true,
            assetId: VIDEO_ID,
            path: 'media/faltante.mp4',
            copied: false,
            validatedBy: 'hash',
            bytes: 120_000,
            sha256: HASH,
          },
        ],
        stillMissing: [],
        rejected: [],
      });
    });
    const relinkFolder = vi.spyOn(service, 'relinkAssetsFromFolder');

    fireEvent.click(await screen.findByRole('button', { name: /Buscar carpeta…/ }));

    await waitFor(() => expect(relinkFolder).toHaveBeenCalledWith(PROJECT_PATH, 'C:\\medios'));
    expect(await screen.findByText(/1 medio\(s\) reconectado\(s\)/i)).toBeTruthy();
    expect(screen.getByTestId('video-path').textContent).toBe('media/faltante.mp4');
    // Validado por hash: el documento vuelve a estado listo.
    expect(screen.getByTestId('video-status').textContent).toBe('ready');
  });

  it('declara el rechazo de relink sin tocar el documento ni fingir éxito', async () => {
    renderProjects(projectWithAssets(), (fake) => {
      fake.findMissingAssets = async () => [missing()];
      fake.chooseVideoFile = async () => 'C:\\elegido\\otro.mp4';
      fake.relinkAsset = async (assetId): Promise<RelinkResult> => ({
        ok: false,
        assetId,
        reason: 'el archivo no coincide con el original',
      });
    });

    fireEvent.click(await screen.findByRole('button', { name: /Relink…/ }));

    expect(await screen.findByText(/no coincide con el original/i)).toBeTruthy();
    expect(screen.getByTestId('video-path').textContent).toBe('media/faltante.mp4');
    expect(screen.queryByText(/reconectado/i)).toBeNull();
  });
});

describe('Proyectos · historial de versiones', () => {
  it('lista versiones con motivo, fecha y acciones de restauración', async () => {
    renderProjects(projectWithAssets(), (fake) => {
      fake.listProjectVersions = async () => [
        version(),
        version({
          id: 'v-2026-11-02',
          savedAtMs: Date.UTC(2026, 10, 2, 9, 30, 0),
          reason: 'manual',
          bytes: 2048,
        }),
      ];
    });

    expect(await screen.findByText(/Autoguardado/)).toBeTruthy();
    expect(screen.getByText(/Guardado manual/)).toBeTruthy();
    expect(screen.getByText(/2 versión\(es\)/)).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /^Restaurar$/ }).length).toBe(2);
    expect(screen.getAllByRole('button', { name: /Como copia…/ }).length).toBe(2);
  });

  it('restaura como copia con confirmación y abre el proyecto restaurado', async () => {
    const service = renderProjects(projectWithAssets(), (fake) => {
      fake.listProjectVersions = async () => [version()];
      fake.restoreProjectVersion = async (
        _projectPath,
        versionId,
        mode,
      ): Promise<RestoreProjectVersionResult> => ({
        restoreMode: mode ?? 'copy',
        projectPath: `${ROOT}\\gestion-restored-1.editoria.json`,
        backupPath: null,
        version: version({ id: versionId }),
      });
    });
    const restore = vi.spyOn(service, 'restoreProjectVersion');
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);

    fireEvent.click(await screen.findByRole('button', { name: /Como copia…/ }));

    await waitFor(() => expect(restore).toHaveBeenCalledWith(PROJECT_PATH, version().id, 'copy'));
    expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/se crea una copia restaurada/i));
    expect(await screen.findByText(/restaurada como copia/i)).toBeTruthy();
  });

  it('no restaura si se cancela la confirmación', async () => {
    const service = renderProjects(projectWithAssets(), (fake) => {
      fake.listProjectVersions = async () => [version()];
    });
    const restore = vi.spyOn(service, 'restoreProjectVersion');
    vi.spyOn(window, 'confirm').mockReturnValue(false);

    fireEvent.click(await screen.findByRole('button', { name: /^Restaurar$/ }));

    await waitFor(() => expect(screen.queryByRole('button', { name: /^Restaurar$/ })).toBeTruthy());
    expect(restore).not.toHaveBeenCalled();
  });

  it('declara el error del backend al restaurar', async () => {
    renderProjects(projectWithAssets(), (fake) => {
      fake.listProjectVersions = async () => [version()];
      fake.restoreProjectVersion = async () => {
        throw new Error('el snapshot ya no existe');
      };
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    fireEvent.click(await screen.findByRole('button', { name: /^Restaurar$/ }));

    expect(await screen.findByText(/el snapshot ya no existe/i)).toBeTruthy();
  });

  it('explica el historial vacío', async () => {
    renderProjects(projectWithAssets(), (fake) => {
      fake.listProjectVersions = async () => [];
    });
    expect(await screen.findByText(/Todavía no hay versiones anteriores/i)).toBeTruthy();
  });
});

describe('Proyectos · duplicados por hash', () => {
  it('analiza, conserva una copia y quita registros sin borrar del disco', async () => {
    const service = renderProjects(projectWithAssets(), (fake) => {
      fake.findDuplicateAssets = async () => [duplicateGroup()];
    });
    const analyze = vi.spyOn(service, 'findDuplicateAssets');
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);

    fireEvent.click(await screen.findByRole('button', { name: /Analizar duplicados/i }));

    await waitFor(() => expect(analyze).toHaveBeenCalledWith(PROJECT_PATH));
    expect(await screen.findByText(/2 copias ·/i)).toBeTruthy();
    expect(screen.getByText(/Copia de la placa/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Quitar copias no conservadas/i }));

    expect(confirm).toHaveBeenCalledWith(
      expect.stringMatching(/Ningún archivo del disco será borrado/i),
    );
    await waitFor(() => expect(screen.getByTestId('asset-count').textContent).toBe('1'));
    expect(screen.getByTestId('image-present').textContent).toBe('no');
    expect(await screen.findByText(/Ningún archivo del disco fue borrado/i)).toBeTruthy();
  });

  it('bloquea quitar una copia en uso por clips', async () => {
    renderProjects(projectWithAssets(true), (fake) => {
      fake.findDuplicateAssets = async () => [
        duplicateGroup({ usedByClipIds: { [IMAGE_ID]: ['clip-image'] } }),
      ];
    });

    fireEvent.click(await screen.findByRole('button', { name: /Analizar duplicados/i }));
    expect(await screen.findByText(/2 copias ·/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Quitar copias no conservadas/i }));

    expect(await screen.findByText(/en uso en la timeline/i)).toBeTruthy();
    expect(screen.getByTestId('asset-count').textContent).toBe('2');
  });

  it('no quita nada si se cancela la confirmación', async () => {
    renderProjects(projectWithAssets(), (fake) => {
      fake.findDuplicateAssets = async () => [duplicateGroup()];
    });
    vi.spyOn(window, 'confirm').mockReturnValue(false);

    fireEvent.click(await screen.findByRole('button', { name: /Analizar duplicados/i }));
    await screen.findByText(/2 copias ·/i);
    fireEvent.click(screen.getByRole('button', { name: /Quitar copias no conservadas/i }));

    await waitFor(() => expect(screen.getByTestId('asset-count').textContent).toBe('2'));
  });

  it('declara cuando no hay duplicados', async () => {
    renderProjects(projectWithAssets());
    fireEvent.click(await screen.findByRole('button', { name: /Analizar duplicados/i }));
    expect(await screen.findByText(/No se encontraron duplicados por hash/i)).toBeTruthy();
  });
});
