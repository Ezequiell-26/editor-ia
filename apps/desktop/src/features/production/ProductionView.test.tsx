// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createEmptyProject,
  type Asset,
  type ProjectDocument,
} from '@editor-ia/project-schema';
import { ProductionView } from './ProductionView';
import { ProjectProvider } from '../../state/project-store';
import {
  addAsset,
  addScene,
  ensureDelivery,
  newId,
} from '../../state/project-actions';
import { createFakeService } from '../../test/fake-service';

const NOW = '2026-10-19T00:00:00.000Z';

function image(label: string): Asset {
  return {
    id: newId(),
    label,
    kind: 'image',
    source: { type: 'local', path: `media/${label}` },
    status: 'ready',
    integrity: { sha256: 'a'.repeat(64), bytes: 10_000 },
    rights: {
      license: { id: 'owned', commercialUse: 'allowed' },
      provenance: { origin: 'user-imported', acquiredAt: NOW },
    },
    media: { width: 1024, height: 1024 },
  } as Asset;
}

function projectWithScenes(): ProjectDocument {
  let project = ensureDelivery(createEmptyProject('Producción', NOW));
  project = addAsset(addAsset(project, image('001.png')), image('002.png'));
  const first = addScene(project, {
    title: 'El faro',
    intent: 'hook',
    narration: 'Un faro azul resiste la tormenta.',
  });
  project = first.project;
  const second = addScene(project, {
    title: 'La calma',
    intent: 'outro',
    narration: 'Al amanecer el mar está quieto.',
  });
  return second.project;
}

function renderView(project = projectWithScenes()) {
  const service = createFakeService();
  const onNavigate = vi.fn();
  render(
    <ProjectProvider
      service={service}
      initial={{
        project,
        opened: {
          project,
          label: 'produccion.editoria.json',
          path: 'C:\\tester\\produccion.editoria.json',
          root: 'C:\\tester',
        },
      }}
    >
      <ProductionView onNavigate={onNavigate} />
    </ProjectProvider>,
  );
  return { service, onNavigate };
}

afterEach(() => cleanup());

describe('ProductionView · video automático', () => {
  it('muestra los pasos y exige confirmar la voz antes de generar', async () => {
    renderView();

    expect(screen.getByRole('heading', { name: 'Guion y escenas' })).toBeTruthy();
    for (const step of ['Guion y escenas', 'Recursos', 'Voz y narración', 'Montaje automático', 'Revisión y export']) {
      expect(screen.getAllByText(step).length).toBeGreaterThan(0);
    }
    const generate = screen.getByRole('button', { name: /Generar video automático/i });
    await waitFor(() => expect((generate as HTMLButtonElement).disabled).toBe(true));
    expect(screen.getByText(/Confirmá los derechos de la voz/i)).toBeTruthy();
    expect(screen.getByLabelText(/Movimiento de las fotos/i)).toBeTruthy();
    expect(screen.getByLabelText(/Transición entre fotos/i)).toBeTruthy();
  });

  it('sintetiza la voz por escena y arma la timeline con subtítulos', async () => {
    const { service } = renderView();
    fireEvent.click(screen.getByRole('checkbox', { name: /derechos sobre la voz/i }));
    const generate = screen.getByRole('button', { name: /Generar video automático/i });
    await waitFor(() => expect((generate as HTMLButtonElement).disabled).toBe(false));

    fireEvent.click(generate);

    await waitFor(
      () => expect(screen.getAllByText(/Timeline generada/i).length).toBeGreaterThan(0),
      { timeout: 5_000 },
    );
    expect(screen.getAllByText(/2 escenas/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/2 subtítulos/i).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Abrir editor y revisar/i })).toBeTruthy();
    expect(service.calls.render).toBe(0);
  });

  it('abre el editor desde el resultado', async () => {
    const { onNavigate } = renderView();
    fireEvent.click(screen.getByRole('checkbox', { name: /derechos sobre la voz/i }));
    const generate = screen.getByRole('button', { name: /Generar video automático/i });
    await waitFor(() => expect((generate as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(generate);
    await waitFor(() => expect(screen.getAllByText(/Timeline generada/i).length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole('button', { name: /Abrir editor y revisar/i }));
    expect(onNavigate).toHaveBeenCalledWith('editor');
  });
});
