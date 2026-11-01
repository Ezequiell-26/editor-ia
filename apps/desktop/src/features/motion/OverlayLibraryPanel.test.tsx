// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createEmptyProject } from '@editor-ia/project-schema';
import { afterEach, describe, expect, it } from 'vitest';
import { createFakeService } from '../../test/fake-service';
import { ProjectProvider, useProjectStore } from '../../state/project-store';
import { OverlayLibraryPanel } from './OverlayLibraryPanel';

function Probe() {
  const store = useProjectStore();
  const tracks = store.state.project?.timeline.tracks ?? [];
  const clips = store.state.project?.timeline.clips ?? [];
  return (
    <output data-testid="overlay-probe">
      {JSON.stringify({
        tracks: tracks.map((track) => ({ label: track.label, kind: track.kind })),
        clips: clips.map((clip) => ({
          kind: clip.kind,
          blendMode: 'blendMode' in clip ? clip.blendMode : undefined,
          trackId: clip.trackId,
        })),
      })}
    </output>
  );
}

afterEach(cleanup);

describe('OverlayLibraryPanel', () => {
  it('lista los overlays empaquetados y los monta con mezcla Screen', async () => {
    const service = createFakeService();
    const project = createEmptyProject('Overlays');
    const opened = {
      project,
      label: 'overlays.editoria.json',
      path: 'C:\\tmp\\overlays.editoria.json',
      root: 'C:\\tmp',
    };
    service.current = opened;
    render(
      <ProjectProvider service={service} initial={{ project, opened }}>
        <OverlayLibraryPanel />
        <Probe />
      </ProjectProvider>,
    );
    expect(await screen.findByText('Polvo dorado')).toBeTruthy();
    expect(screen.getByText('Fuga cálida')).toBeTruthy();
    expect(screen.getByText('Mascota que saluda')).toBeTruthy();
    expect(screen.getByText(/Normal · Alfa/)).toBeTruthy();
    const buttons = screen.getAllByRole('button', { name: 'Agregar' });
    expect(buttons).toHaveLength(3);
    fireEvent.click(buttons[0]!);
    await waitFor(() => {
      const probe = screen.getByTestId('overlay-probe').textContent ?? '';
      expect(probe).toContain('"blendMode":"screen"');
    });
    const parsed = JSON.parse(screen.getByTestId('overlay-probe').textContent ?? '{}') as {
      tracks: { label: string; kind: string }[];
      clips: { kind: string; blendMode?: string }[];
    };
    expect(parsed.tracks).toContainEqual({ label: 'Overlays', kind: 'video' });
    expect(parsed.clips).toHaveLength(1);
    expect(parsed.clips[0]).toMatchObject({ kind: 'video', blendMode: 'screen' });
  });
});
