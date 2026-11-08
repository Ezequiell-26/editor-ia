// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createEmptyProject, type ProjectDocument } from '@editor-ia/project-schema';
import { ProjectProvider, useProjectStore } from '../../state/project-store';
import {
  addAsset,
  addClipFromAsset,
  ensureDelivery,
  updateClip,
} from '../../state/project-actions';
import { createFakeService, readyAsset } from '../../test/fake-service';
import { VisualsView } from './VisualsView';

const NOW = '2026-11-08T00:00:00.000Z';

afterEach(() => {
  cleanup();
});

function Probe() {
  const store = useProjectStore();
  const project = store.state.project;
  if (!project) return null;
  const dips = project.timeline.clips.map(
    (clip) =>
      `${clip.id}:${'transitionIn' in clip ? JSON.stringify(clip.transitionIn) : '-'}`,
  );
  return (
    <div data-testid="probe">
      {`${dips.join('|')}||err:${store.state.error ?? ''}|notice:${store.state.notice ?? ''}`}
    </div>
  );
}

function renderView(
  prepare?: (project: ProjectDocument) => ProjectDocument,
) {
  let project: ProjectDocument = ensureDelivery(createEmptyProject('Demo fundidos', NOW));
  const assetA = readyAsset({ label: 'Toma Alfa' });
  const assetB = readyAsset({ label: 'Toma Beta' });
  project = addAsset(project, assetA);
  project = addAsset(project, assetB);
  project = addClipFromAsset(project, assetA, {
    atFrame: 0,
    durationFrames: 240,
  }).project;
  project = addClipFromAsset(project, assetB, {
    atFrame: 300,
    durationFrames: 120,
  }).project;
  if (prepare) project = prepare(project);
  const clipIds = project.timeline.clips.map((clip) => clip.id);
  const service = createFakeService();
  render(
    <ProjectProvider
      service={service}
      initial={{
        project,
        opened: {
          project,
          label: 'demo.editoria.json',
          path: 'C:\\tester\\demo.editoria.json',
          root: 'C:\\tester',
        },
      }}
    >
      <VisualsView onNavigate={() => {}} />
      <Probe />
    </ProjectProvider>,
  );
  return { clipIds };
}

function transitionSection() {
  const head = screen.getByText('Transición de entrada');
  const section = head.closest('section');
  if (!section) throw new Error('sección de transición no encontrada');
  return within(section as HTMLElement);
}

async function chooseDipColor() {
  const card = await screen.findByRole('button', { name: 'Fundido a color' });
  fireEvent.click(card);
  await screen.findByText('Color general del fundido');
}

function setClipColor(clipName: string, hex: string) {
  fireEvent.click(screen.getByRole('button', { name: `Color de ${clipName}` }));
  const input = screen.getByLabelText(`Valor hex de ${clipName}`);
  fireEvent.change(input, { target: { value: hex } });
}

describe('VisualsView · fundido a color por clip', () => {
  it('aplica el color general a todos y permite un color propio por clip', async () => {
    const { clipIds } = renderView();
    const [idA, idB] = clipIds;
    await screen.findByText(/2 de 2 seleccionados/);
    await chooseDipColor();

    // Con más de un clip seleccionado aparece una muestra por clip.
    expect(
      screen.getByRole('button', { name: 'Color de Toma Alfa' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Color de Toma Beta' }),
    ).toBeTruthy();

    setClipColor('Toma Alfa', '#ff0000');
    fireEvent.click(transitionSection().getByRole('button', { name: 'Aplicar' }));

    const probe = await screen.findByTestId('probe');
    await waitFor(() => {
      expect(probe.textContent).toContain(
        `${idA}:{"type":"dip-color","frames":12,"color":"#ff0000"}`,
      );
      expect(probe.textContent).toContain(
        `${idB}:{"type":"dip-color","frames":12,"color":"#1b2a4a"}`,
      );
    });
  });

  it('el botón General quita el override y vuelve al color general', async () => {
    const { clipIds } = renderView();
    const [idA, idB] = clipIds;
    await screen.findByText(/2 de 2 seleccionados/);
    await chooseDipColor();

    setClipColor('Toma Alfa', '#00ff00');

    fireEvent.click(
      screen.getByRole('button', { name: 'Quitar color propio de Toma Alfa' }),
    );
    expect(
      screen.queryByRole('button', { name: 'Quitar color propio de Toma Alfa' }),
    ).toBeNull();

    fireEvent.click(transitionSection().getByRole('button', { name: 'Aplicar' }));
    const probe = await screen.findByTestId('probe');
    await waitFor(() => {
      expect(probe.textContent).toContain(
        `${idA}:{"type":"dip-color","frames":12,"color":"#1b2a4a"}`,
      );
      expect(probe.textContent).toContain(
        `${idB}:{"type":"dip-color","frames":12,"color":"#1b2a4a"}`,
      );
    });
  });

  it('conserva el color propio que el clip ya tiene en su transitionIn', async () => {
    const { clipIds } = renderView((project) =>
      updateClip(project, project.timeline.clips[0]!.id, {
        transitionIn: { type: 'dip-color', frames: 12, color: '#123456' },
      }),
    );
    const [idA, idB] = clipIds;
    await screen.findByText(/2 de 2 seleccionados/);
    await chooseDipColor();

    // La muestra del clip con color propio lo muestra y ofrece volver al general.
    expect(
      screen.getByRole('button', { name: 'Quitar color propio de Toma Alfa' }),
    ).toBeTruthy();

    // Sin tocar nada, Aplicar respeta el color propio y da el general al otro.
    fireEvent.click(transitionSection().getByRole('button', { name: 'Aplicar' }));
    const probe = await screen.findByTestId('probe');
    await waitFor(() => {
      expect(probe.textContent).toContain(
        `${idA}:{"type":"dip-color","frames":12,"color":"#123456"}`,
      );
      expect(probe.textContent).toContain(
        `${idB}:{"type":"dip-color","frames":12,"color":"#1b2a4a"}`,
      );
    });
  });

  it('con un solo clip seleccionado no muestra filas por clip', async () => {
    renderView();
    await screen.findByText(/2 de 2 seleccionados/);

    const row = screen.getByText('Toma Beta').closest('label');
    const checkbox = row?.querySelector('input[type="checkbox"]');
    if (!checkbox) throw new Error('checkbox del clip no encontrado');
    fireEvent.click(checkbox);
    await screen.findByText(/1 de 2 seleccionados/);

    await chooseDipColor();
    expect(
      screen.queryByRole('button', { name: 'Color de Toma Beta' }),
    ).toBeNull();
    expect(screen.getByText('Color general del fundido')).toBeTruthy();
  });
});
