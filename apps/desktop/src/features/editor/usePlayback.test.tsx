// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyProject } from '@editor-ia/project-schema';
import { ProjectProvider, useProjectStore } from '../../state/project-store';
import { addAsset, addClipFromAsset } from '../../state/project-actions';
import { createFakeService, readyAsset } from '../../test/fake-service';
import { usePlayback } from './usePlayback';

/**
 * UI-001: el motor de reproducción es un singleton a nivel módulo — dos
 * superficies montadas a la vez (p.ej. MinimalEditor + EditorWorkspace)
 * comparten UN solo rAF. Antes cada `usePlayback()` abría el suyo y el
 * playhead recibía setPlayhead duplicado por frame.
 */

const NOW = '2026-10-20T00:00:00.000Z';

type RafCallback = (time: number) => void;

function Consumer({ label }: { label: string }) {
  usePlayback();
  return <span data-testid={label} />;
}

function PlayControl({ onReady }: { onReady: (api: { play: () => void }) => void }) {
  const store = useProjectStore();
  onReady({ play: () => store.setPlaying(true) });
  return null;
}

function makeProject() {
  const asset = readyAsset();
  let project = createEmptyProject('playback', NOW);
  project = addAsset(project, asset);
  project = addClipFromAsset(project, asset, { atFrame: 0, durationFrames: 300 }).project;
  return project;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('usePlayback · motor singleton', () => {
  it('dos consumidores montados comparten UN solo rAF', () => {
    const pending: RafCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: RafCallback) => {
      pending.push(cb);
      return pending.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});

    const project = makeProject();
    let api: { play: () => void } | null = null;
    render(
      <ProjectProvider
        service={createFakeService()}
        initial={{ project }}
      >
        <PlayControl onReady={(value) => (api = value)} />
        <Consumer label="a" />
        <Consumer label="b" />
      </ProjectProvider>,
    );

    act(() => api!.play());

    // Con el motor duplicado habría DOS callbacks pendientes (uno por
    // consumidor). El singleton deja exactamente uno.
    expect(pending).toHaveLength(1);

    // Cada tick reprograma un único rAF: nunca se acumulan loops.
    for (let step = 0; step < 10; step += 1) {
      const callbacks = pending.splice(0, pending.length);
      expect(callbacks).toHaveLength(1);
      act(() => callbacks[0]!(performance.now() + step * 16.7));
    }
    expect(pending).toHaveLength(1);
  });
});
