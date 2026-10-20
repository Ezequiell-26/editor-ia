// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyProject, type ProjectDocument } from '@editor-ia/project-schema';
import { ScriptView } from './ScriptView';
import { ProjectProvider } from '../../state/project-store';
import { addScene, ensureDelivery, updateScene } from '../../state/project-actions';
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
