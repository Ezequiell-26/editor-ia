// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createEmptyProject,
  type Asset,
  type ProjectDocument,
} from '@editor-ia/project-schema';
import { AutonomousRunsPanel } from './AutonomousRunsPanel';
import { ProjectProvider } from '../../state/project-store';
import { addAsset, addScene, ensureDelivery, newId } from '../../state/project-actions';
import { createFakeService, type FakeService } from '../../test/fake-service';

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
  return addScene(project, {
    title: 'La calma',
    intent: 'outro',
    narration: 'Al amanecer el mar está quieto.',
  }).project;
}

function renderPanel(project = projectWithScenes(), service = createFakeService()) {
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
      <AutonomousRunsPanel />
    </ProjectProvider>,
  );
  return service;
}

async function createRunViaBrief(service: FakeService) {
  const plan = await service.productionPlanFromBrief({
    objective: 'Resumen de cómo editar video más rápido',
    keyPoints: ['Organizá el material', 'Cortá lo que no aporta'],
  });
  return service.productionCreate(plan);
}

afterEach(() => cleanup());

describe('AutonomousRunsPanel · planes desde texto', () => {
  it('arma un plan con el brief local, lo previsualiza y crea la corrida', async () => {
    const service = renderPanel();
    const briefSpy = vi.spyOn(service, 'productionPlanFromBrief');

    fireEvent.change(screen.getByLabelText('Describí tu video'), {
      target: { value: 'Un video sobre cómo editar más rápido' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Plan simple (sin IA)' }));

    await waitFor(() =>
      expect(screen.getByLabelText('Plan preview')).toBeTruthy(),
    );
    expect(briefSpy).toHaveBeenCalledWith({
      objective: 'Un video sobre cómo editar más rápido',
    });
    expect(screen.getByText(/1 escenas/)).toBeTruthy();

    fireEvent.click(
      screen.getByRole('button', { name: 'Crear corrida desde este plan' }),
    );
    await waitFor(() => expect(screen.getByText('Planificada')).toBeTruthy());
    expect(await service.productionList()).toHaveLength(1);
  });

  it('muestra el error del provider mock y permite caer al brief local', async () => {
    const service = renderPanel();
    const textSpy = vi.spyOn(service, 'productionPlanFromText');

    fireEvent.change(screen.getByLabelText('Describí tu video'), {
      target: { value: 'Contame cómo hacer un buen resumen en video' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Interpretar con IA' }));

    await waitFor(() =>
      expect(
        screen.getByText(/mock no interpreta lenguaje natural/i),
      ).toBeTruthy(),
    );
    expect(textSpy).toHaveBeenCalledWith('Contame cómo hacer un buen resumen en video', {
      approvedCost: false,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Plan simple (sin IA)' }));
    await waitFor(() => expect(screen.getByLabelText('Plan preview')).toBeTruthy());
  });

  it('interpreta con IA cuando el servicio devuelve un plan', async () => {
    const service = renderPanel();
    const plan = await service.productionPlanFromBrief({
      objective: 'Plan interpretado por el provider',
    });
    vi.spyOn(service, 'productionPlanFromText').mockResolvedValue(plan);

    fireEvent.change(screen.getByLabelText('Describí tu video'), {
      target: { value: 'Un video interpretado por IA de prueba' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Interpretar con IA' }));

    await waitFor(() =>
      expect(screen.getByText(/Plan interpretado por el provider/)).toBeTruthy(),
    );
  });
});

describe('AutonomousRunsPanel · ciclo de vida de la corrida', () => {
  it('pausa una corrida en curso y ofrece reanudar', async () => {
    // La corrida existe antes del mount para que `productionList` la traiga.
    const service = createFakeService();
    await createRunViaBrief(service);
    renderPanel(projectWithScenes(), service);
    await waitFor(() => expect(screen.getByText('Planificada')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Correr autónomo' }));
    await waitFor(() => expect(screen.getByText('En curso')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Pausar' }));
    await waitFor(() => expect(screen.getByText('Pausada')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Reanudar' })).toBeTruthy();
  });
});
