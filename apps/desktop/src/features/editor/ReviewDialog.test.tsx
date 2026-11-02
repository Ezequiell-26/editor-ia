// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { createEmptyProject, type ProjectDocument } from '@editor-ia/project-schema';
import { ProjectProvider, useProjectStore } from '../../state/project-store';
import { addAsset, addCaptionCue, addClipFromAsset, ensureDelivery } from '../../state/project-actions';
import { createFakeService, readyAsset } from '../../test/fake-service';
import type { AudioPeaks } from '../../services/project-service';
import { ReviewDialog } from './ReviewDialog';

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

function peaks(pattern: readonly ('voz' | 'silencio')[]): AudioPeaks {
  return {
    assetId: 'asset',
    durationSeconds: pattern.length * 0.1,
    buckets: pattern.length,
    peaks: pattern.map((kind) =>
      kind === 'voz' ? { min: -0.5, max: 0.5 } : { min: -0.002, max: 0.002 },
    ),
  };
}

const ALL_VOICE = peaks(Array.from({ length: 50 }, () => 'voz' as const));

function projectWithCues(): ProjectDocument {
  const asset = readyAsset({
    kind: 'audio',
    label: 'Voz',
    source: { type: 'local', path: 'media/voz.wav' },
    media: { sampleRate: 48_000, channels: 1, durationFrames: 300 },
  });
  let project = addAsset(ensureDelivery(createEmptyProject('Revisión', NOW)), asset);
  const added = addClipFromAsset(project, asset, { atFrame: 0, durationFrames: 150 });
  project = added.project;
  const seeded = addCaptionCue(project, { text: 'base', startFrame: 0, durationFrames: 1 });
  return {
    ...seeded.project,
    captions: {
      ...seeded.project.captions,
      cues: [
        {
          id: '00000000-0000-4000-8000-00000000000c',
          trackId: seeded.trackId,
          text: 'Primera',
          language: 'es',
          startFrame: 0,
          endFrame: 30,
          words: [
            { text: 'Primera', startFrame: 0, endFrame: 15 },
            { text: 'frase', startFrame: 15, endFrame: 30 },
          ],
        },
        {
          id: '00000000-0000-4000-8000-00000000000d',
          trackId: seeded.trackId,
          text: 'Segunda',
          language: 'es',
          startFrame: 60,
          endFrame: 90,
          words: [
            { text: 'Segunda', startFrame: 60, endFrame: 75 },
            { text: 'frase', startFrame: 75, endFrame: 90 },
          ],
        },
      ],
    },
  } as ProjectDocument;
}

function renderDialog() {
  const project = projectWithCues();
  const service = createFakeService();
  service.audioPeaks = async (assetId: string) => ({ ...ALL_VOICE, assetId });
  latestState = null;
  render(
    <ProjectProvider
      service={service}
      initial={{
        project,
        opened: {
          project,
          label: 'revision.editoria.json',
          path: 'C:\\tester\\revision.editoria.json',
          root: 'C:\\tester',
        },
      }}
    >
      <Probe />
      <ReviewDialog onClose={() => {}} />
    </ProjectProvider>,
  );
  return { project };
}

describe('diálogo de revisión', () => {
  it('lista las decisiones agrupadas y aplica lo aceptado', async () => {
    const { project } = renderDialog();
    expect(await screen.findByText('Pausas entre frases')).toBeTruthy();
    expect(screen.getByText('Nivelado')).toBeTruthy();
    expect(screen.getByText(/Desmarcá lo que no quieras aplicar/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Aplicar/ }));
    await waitFor(() =>
      expect(latestState?.project?.timeline.clips.length).toBeGreaterThan(
        project.timeline.clips.length,
      ),
    );
    expect(latestState?.project?.audio.loudnessTarget?.integratedLufs).toBe(-14);
  });

  it('si se desmarca un grupo, ese cambio no se aplica', async () => {
    renderDialog();
    await screen.findByText('Nivelado');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Aceptar todos: Nivelado' }));
    fireEvent.click(screen.getByRole('button', { name: /Aplicar/ }));
    await waitFor(() => expect(latestState?.project).not.toBeNull());
    expect(latestState?.project?.audio.loudnessTarget).toBeUndefined();
  });
});
