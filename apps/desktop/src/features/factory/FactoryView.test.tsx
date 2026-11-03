// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectDocument } from '@editor-ia/project-schema';
import { createEmptyProject } from '@editor-ia/project-schema';
import type { ProviderInfo } from '../../services/project-service';
import { ProjectProvider } from '../../state/project-store';
import { addAsset, ensureDelivery, markAssetReady } from '../../state/project-actions';
import { createFakeService } from '../../test/fake-service';
import { FactoryView } from './FactoryView';

const NOW = '2026-11-03T00:00:00.000Z';
const ROOT = 'C:\\tester';

const MOCK_PROVIDER: ProviderInfo = {
  kind: 'mock',
  baseUrl: '',
  model: 'mock',
  hasKey: false,
  keyringAvailable: true,
};

const LOCAL_PROVIDER: ProviderInfo = {
  kind: 'openai-compatible',
  baseUrl: 'http://127.0.0.1:11434/v1',
  model: 'llama3.1',
  hasKey: false,
  keyringAvailable: true,
};

function projectWithReadyImage(): ProjectDocument {
  let project = ensureDelivery(createEmptyProject('Fábrica', NOW));
  project = addAsset(project, {
    id: 'image-1',
    label: 'Card verde',
    kind: 'image',
    source: { type: 'local', path: `${ROOT}\\media\\card.png` },
    status: 'unverified',
    integrity: { sha256: 'a'.repeat(64), bytes: 1000 },
    rights: {
      license: { id: 'user-declared', commercialUse: 'allowed' },
      provenance: { origin: 'user-imported', acquiredAt: NOW },
    },
    media: { width: 1920, height: 1080 },
  } as Parameters<typeof addAsset>[1]);
  const added = project.assets[project.assets.length - 1]!;
  return markAssetReady(project, added.id, 'allowed');
}

function renderFactory(configure: (service: ReturnType<typeof createFakeService>) => void = () => {}) {
  const project = projectWithReadyImage();
  const service = createFakeService();
  configure(service);
  render(
    <ProjectProvider
      service={service}
      initial={{
        project,
        opened: {
          project,
          label: 'fabrica.editoria.json',
          path: `${ROOT}\\fabrica.editoria.json`,
          root: ROOT,
        },
      }}
    >
      <FactoryView onNavigate={vi.fn()} />
    </ProjectProvider>,
  );
  return service;
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('Fábrica · proveedor simulado', () => {
  it('rotula el proveedor simulado y bloquea la generación', async () => {
    renderFactory((service) => {
      service.getProvider = async () => MOCK_PROVIDER;
    });

    // Chip del toolbar + banner de la tarjeta de salida + aviso del panel lateral.
    const avisos = await screen.findAllByText(/guion es plantilla|guion es una plantilla/i);
    expect(avisos.length).toBeGreaterThan(0);

    const generar = screen.getByRole('button', { name: /Generar 3 variante/i });
    expect(generar).toHaveProperty('disabled', true);
    expect(generar.getAttribute('title')).toMatch(/proveedor guardado es simulado/i);
  });

  it('con proveedor real no muestra el aviso y habilita la generación', async () => {
    renderFactory((service) => {
      service.getProvider = async () => LOCAL_PROVIDER;
    });

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Generar 3 variante/i })).toHaveProperty(
        'disabled',
        false,
      ),
    );
    expect(screen.queryByText(/guion es plantilla/i)).toBeNull();
    expect(screen.queryByText(/guion es una plantilla/i)).toBeNull();
    expect(screen.getByText(/llama3\.1/)).toBeTruthy();
  });

  it('bloquea la generación si no puede comprobar el proveedor y lo declara', async () => {
    renderFactory((service) => {
      service.getProvider = async () => {
        throw new Error('el almacén de credenciales no respondió');
      };
    });

    expect((await screen.findAllByText(/No se pudo leer el proveedor/i)).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Generar 3 variante/i })).toHaveProperty(
      'disabled',
      true,
    );
    expect(screen.getAllByText(/no respondió/i).length).toBeGreaterThan(0);
  });
});
