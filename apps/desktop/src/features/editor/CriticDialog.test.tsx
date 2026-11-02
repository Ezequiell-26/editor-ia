// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { createEmptyProject, type ProjectDocument } from '@editor-ia/project-schema';
import { ProjectProvider, useProjectStore } from '../../state/project-store';
import {
  addAsset,
  addClipFromAsset,
  ensureDelivery,
  updateAudioMix,
} from '../../state/project-actions';
import { createFakeService, readyAsset } from '../../test/fake-service';
import { CriticDialog } from './CriticDialog';

const NOW = '2026-11-02T00:00:00.000Z';

afterEach(cleanup);

let latestState: ReturnType<typeof useProjectStore>['state'] | null = null;

function Probe(): null {
  const store = useProjectStore();
  useEffect(() => {
    latestState = store.state;
  }, [store.state]);
  return null;
}

function projectWithGap(): ProjectDocument {
  const asset = readyAsset({ label: 'Toma', source: { type: 'local', path: 'media/toma.mp4' } });
  let project = addAsset(ensureDelivery(createEmptyProject('Crítica', NOW)), asset);
  project = addClipFromAsset(project, asset, { atFrame: 60, durationFrames: 90 }).project;
  return project;
}

function renderDialog(project: ProjectDocument) {
  latestState = null;
  render(
    <ProjectProvider
      service={createFakeService()}
      initial={{
        project,
        opened: {
          project,
          label: 'critica.editoria.json',
          path: 'C:\\tester\\critica.editoria.json',
          root: 'C:\\tester',
        },
      }}
    >
      <Probe />
      <CriticDialog onClose={() => {}} />
    </ProjectProvider>,
  );
}

describe('diálogo del crítico', () => {
  it('muestra el puntaje y los hallazgos con arreglo', () => {
    renderDialog(projectWithGap());
    expect(screen.getByText(/Puntaje medido/)).toBeTruthy();
    expect(screen.getByText('La edición arranca con aire')).toBeTruthy();
    expect(screen.getByText('La entrega no tiene objetivo de volumen')).toBeTruthy();
  });

  it('aplica los arreglos aceptados', async () => {
    renderDialog(projectWithGap());
    fireEvent.click(screen.getByRole('button', { name: /Aplicar/ }));
    await waitFor(() =>
      expect(latestState?.project?.timeline.clips[0]?.startFrame).toBe(0),
    );
    expect(latestState?.project?.audio.loudnessTarget?.integratedLufs).toBe(-14);
  });

  it('una edición sana no muestra hallazgos', () => {
    let project = projectWithGap();
    project = {
      ...project,
      timeline: {
        ...project.timeline,
        clips: project.timeline.clips.map((clip) => ({ ...clip, startFrame: 0 })),
      },
    };
    project = updateAudioMix(project, {
      loudnessTarget: {
        platform: 'youtube',
        integratedLufs: -14,
        truePeakDb: -1,
        toleranceDb: 1,
      },
      masterLimiter: true,
    });
    renderDialog(project);
    expect(screen.getByText(/No encontré problemas medibles/)).toBeTruthy();
  });
});
