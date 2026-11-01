// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyProject, type Asset, type ProjectDocument } from '@editor-ia/project-schema';
import { ScriptView } from './ScriptView';
import { ProjectProvider, useProjectStore } from '../../state/project-store';
import {
  addAsset,
  addClipFromAsset,
  addScene,
  ensureDelivery,
  newId,
  updateScene,
} from '../../state/project-actions';
import { createFakeService } from '../../test/fake-service';

const NOW = '2026-10-19T00:00:00.000Z';

function withScenes(): ProjectDocument {
  let project = ensureDelivery(createEmptyProject('Prompts UI', NOW));
  const first = addScene(project, {
    title: 'El faro',
    intent: 'hook',
    narration: 'Un faro resiste la tormenta.',
  });
  project = updateScene(first.project, first.sceneId, {
    notes: 'Un faro azul sobre un acantilado.',
  });
  const second = addScene(project, {
    title: 'La calma',
    intent: 'outro',
    narration: 'El mar vuelve a estar quieto.',
  });
  project = updateScene(second.project, second.sceneId, {
    notes: 'El mismo faro al amanecer.',
  });
  return project;
}

function videoAsset(): Asset {
  return {
    id: newId(),
    label: 'Toma',
    kind: 'video',
    source: { type: 'local', path: 'media/toma.mp4' },
    status: 'ready',
    integrity: { sha256: 'a'.repeat(64), bytes: 10_000 },
    rights: {
      license: { id: 'owned', commercialUse: 'allowed' },
      provenance: { origin: 'user-imported', acquiredAt: NOW },
    },
    media: { width: 1280, height: 720, durationFrames: 300, frameRate: { num: 30, den: 1 } },
  } as Asset;
}

function withSceneAndClip(): { project: ProjectDocument; sceneId: string; clipId: string } {
  const asset = videoAsset();
  const withAsset = addAsset(withScenes(), asset);
  const added = addClipFromAsset(withAsset, asset, { atFrame: 0 });
  const sceneId = added.project.scenes[0]!.id;
  return {
    project: updateScene(added.project, sceneId, { clipIds: [added.clipId] }),
    sceneId,
    clipId: added.clipId,
  };
}

function Probe() {
  const store = useProjectStore();
  return (
    <pre data-testid="probe">
      {JSON.stringify(
        store.state.project?.scenes.map((scene) => ({
          id: scene.id,
          clipIds: scene.clipIds,
          engine: scene.engine ?? null,
        })) ?? [],
      )}
    </pre>
  );
}

function renderView(project: ProjectDocument) {
  const service = createFakeService();
  const onNavigate = vi.fn();
  render(
    <ProjectProvider
      service={service}
      initial={{
        project,
        opened: {
          project,
          label: 'prompts.editoria.json',
          path: 'C:\\tester\\prompts.editoria.json',
          root: 'C:\\tester',
        },
      }}
    >
      <ScriptView onNavigate={onNavigate} />
      <Probe />
    </ProjectProvider>,
  );
  return { onNavigate };
}

afterEach(() => cleanup());

describe('ScriptView · prompts para Flow', () => {
  it('muestra un prompt por escena y el primero se puede previsualizar', () => {
    renderView(withScenes());

    expect(screen.getByText('Prompts para Flow')).toBeTruthy();
    expect(screen.getByText('2 prompts')).toBeTruthy();
    expect(screen.getByText(/Ver el primer prompt/i)).toBeTruthy();
    expect(screen.getByText(/Un faro azul sobre un acantilado/)).toBeTruthy();
    const download = screen.getByRole('button', {
      name: /Descargar \.txt para Flow Queue/i,
    }) as HTMLButtonElement;
    expect(download.disabled).toBe(false);
  });

  it('deshabilita la descarga cuando no hay escenas', () => {
    renderView(ensureDelivery(createEmptyProject('Sin escenas', NOW)));

    const download = screen.getByRole('button', {
      name: /Descargar \.txt para Flow Queue/i,
    }) as HTMLButtonElement;
    expect(download.disabled).toBe(true);
    expect(screen.getByText(/Generá o agregá escenas/i)).toBeTruthy();
  });
});

describe('ScriptView · constructor de escenas', () => {
  it('asocia clips visuales, fija el motor y persiste ambos', () => {
    const { project, clipId } = withSceneAndClip();
    renderView(project);

    const clip = screen.getByRole('checkbox', {
      name: /Clip Toma en El faro/i,
    }) as HTMLInputElement;
    expect(clip.checked).toBe(true);
    fireEvent.click(clip);
    expect(clip.checked).toBe(false);

    const engine = screen.getByRole('combobox', {
      name: /Motor de El faro/i,
    }) as HTMLSelectElement;
    fireEvent.change(engine, { target: { value: 'ken-burns' } });

    const save = screen.getAllByRole('button', { name: /Guardar escena/i })[0]! as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    expect(screen.queryByText('cambios sin guardar')).toBeNull();

    const saved = JSON.parse(screen.getByTestId('probe').textContent ?? '[]') as {
      clipIds: string[];
      engine: string | null;
    }[];
    expect(saved[0]?.clipIds).toEqual([]);
    expect(saved[0]?.engine).toBe('ken-burns');
    expect(clipId).toBeTruthy();
  });
});
