// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { createEmptyProject, type ProjectDocument } from '@editor-ia/project-schema';
import { ProjectProvider, useProjectStore } from '../../state/project-store';
import { addAsset, addCaptionCue, addClipFromAsset, ensureDelivery } from '../../state/project-actions';
import { createFakeService, readyAsset } from '../../test/fake-service';
import { SpeechCutsSection } from './SpeechCutsSection';

const NOW = '2026-11-02T00:00:00.000Z';

afterEach(cleanup);

let latestState: ReturnType<typeof useProjectStore>['state'] | null = null;

function ProjectProbe(): null {
  const store = useProjectStore();
  useEffect(() => {
    latestState = store.state;
  }, [store.state]);
  return null;
}

function cue(id: string, trackId: string, startFrame: number, endFrame: number, withWords: boolean) {
  const middle = Math.round((startFrame + endFrame) / 2);
  return {
    id,
    trackId,
    text: `frase ${id}`,
    language: 'es',
    startFrame,
    endFrame,
    ...(withWords
      ? {
          words: [
            { text: 'frase', startFrame, endFrame: middle },
            { text: 'dos', startFrame: middle, endFrame },
          ],
        }
      : {}),
  };
}

function projectWithCues(withCues: boolean): ProjectDocument {
  const asset = readyAsset({
    kind: 'audio',
    label: 'Narración',
    source: { type: 'local', path: 'media/narracion.wav' },
    media: { sampleRate: 48_000, channels: 1, durationFrames: 300 },
  });
  let project = addAsset(ensureDelivery(createEmptyProject('Pausas', NOW)), asset);
  const added = addClipFromAsset(project, asset, { atFrame: 0, durationFrames: 150 });
  project = added.project;
  if (!withCues) return project;
  const seeded = addCaptionCue(project, { text: 'base', startFrame: 0, durationFrames: 1 });
  return {
    ...seeded.project,
    captions: {
      ...seeded.project.captions,
      cues: [
        cue('00000000-0000-4000-8000-00000000000c', seeded.trackId, 0, 30, true),
        cue('00000000-0000-4000-8000-00000000000d', seeded.trackId, 60, 90, true),
      ],
    },
  } as ProjectDocument;
}

function renderSection(withCues: boolean) {
  const project = projectWithCues(withCues);
  const service = createFakeService();
  latestState = null;
  render(
    <ProjectProvider
      service={service}
      initial={{
        project,
        opened: {
          project,
          label: 'pausas.editoria.json',
          path: 'C:\\tester\\pausas.editoria.json',
          root: 'C:\\tester',
        },
      }}
    >
      <ProjectProbe />
      <SpeechCutsSection clips={project.timeline.clips} />
    </ProjectProvider>,
  );
  return { project };
}

describe('cortes por pausas de voz', () => {
  it('sin subtítulos lo explica en vez de inventar pausas', () => {
    renderSection(false);
    fireEvent.click(screen.getByRole('button', { name: 'Analizar pausas' }));
    expect(
      screen.getByText(/Los clips no tienen subtítulos: generá los subtítulos primero/),
    ).toBeTruthy();
  });

  it('detecta la pausa entre frases y la quita al confirmar', async () => {
    renderSection(true);
    fireEvent.click(screen.getByRole('button', { name: 'Analizar pausas' }));
    expect(screen.getByText(/1 pausa\(s\) en 1 clip\(s\)/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar cortes' }));
    fireEvent.click(screen.getByRole('button', { name: /Confirmar: quitar/ }));
    await waitFor(() => expect(latestState?.project?.timeline.clips).toHaveLength(2));
    const clips = latestState!.project!.timeline.clips;
    expect(clips[0]!.durationFrames).toBe(32);
    expect(clips[1]!.startFrame).toBe(32);
    expect(latestState?.notice).toMatch(/Pausas recortadas: 1 en 1 clip/);
  });
});
