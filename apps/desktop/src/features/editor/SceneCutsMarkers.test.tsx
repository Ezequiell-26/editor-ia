// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyProject, type ProjectDocument } from '@editor-ia/project-schema';
import { ProjectProvider, useProjectStore } from '../../state/project-store';
import { addAsset, addClipFromAsset, ensureDelivery } from '../../state/project-actions';
import { createFakeService, readyAsset } from '../../test/fake-service';
import { Inspector } from './Inspector';

const NOW = '2026-10-26T00:00:00.000Z';

afterEach(cleanup);

function projectWithVideoClip(): {
  project: ProjectDocument;
  assetId: string;
  clipId: string;
  trackId: string;
} {
  const asset = readyAsset({
    kind: 'video',
    label: 'Toma con cortes',
    source: { type: 'local', path: 'media/cortes.mp4' },
    media: { width: 1920, height: 1080, durationFrames: 300, frameRate: { num: 30, den: 1 } },
  });
  let project = addAsset(ensureDelivery(createEmptyProject('Escenas', NOW)), asset);
  const added = addClipFromAsset(project, asset, {
    atFrame: 0,
    durationFrames: 300,
  });
  project = added.project;
  return { project, assetId: asset.id, clipId: added.clipId, trackId: added.trackId };
}

let latestState: ReturnType<typeof useProjectStore>['state'] | null = null;

function ProjectProbe(): null {
  const store = useProjectStore();
  useEffect(() => {
    latestState = store.state;
  }, [store.state]);
  return null;
}

function SelectOnMount(props: { kind: 'clip'; id: string }): null {
  const store = useProjectStore();
  useEffect(() => {
    store.setSelection({ kind: props.kind, id: props.id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

function renderInspector(service = createFakeService()) {
  const built = projectWithVideoClip();
  latestState = null;
  render(
    <ProjectProvider
      service={service}
      initial={{
        project: built.project,
        opened: {
          project: built.project,
          label: 'escenas.editoria.json',
          path: 'C:\\tester\\escenas.editoria.json',
          root: 'C:\\tester',
        },
      }}
    >
      <ProjectProbe />
      <SelectOnMount kind="clip" id={built.clipId} />
      <Inspector />
    </ProjectProvider>,
  );
  return { service, ...built };
}

async function detectAndOpenMarkersTab(): Promise<void> {
  fireEvent.click(screen.getByRole('tab', { name: 'IA' }));
  fireEvent.click(screen.getByRole('button', { name: 'Detectar escenas' }));
  await screen.findByRole('button', { name: /Crear 2 marcador/ });
}

describe('Inspector · cortes de escena a marcadores', () => {
  it('detecta cortes con el servicio y crea un marcador por corte', async () => {
    const { service } = renderInspector();
    const spy = vi.spyOn(service, 'detectScenes');
    await detectAndOpenMarkersTab();
    expect(spy).toHaveBeenCalledWith(expect.any(String), 0.35);

    fireEvent.click(screen.getByRole('button', { name: /Crear 2 marcador/ }));

    await waitFor(() => {
      expect(latestState?.project?.markers).toHaveLength(2);
    });
    // El fake devuelve cortes en frames de asset 60 y 120; el clip cubre el
    // asset completo a 30 fps, así que los marcadores caen en esos frames.
    expect(latestState?.project?.markers.map((marker) => marker.frame)).toEqual([60, 120]);
    expect(latestState?.notice).toContain('2 marcador(es) creados');
  });

  it('no crea marcadores duplicados si se vuelve a pulsar', async () => {
    renderInspector();
    await detectAndOpenMarkersTab();
    fireEvent.click(screen.getByRole('button', { name: /Crear 2 marcador/ }));
    await waitFor(() => {
      expect(latestState?.project?.markers).toHaveLength(2);
    });
    fireEvent.click(screen.getByRole('button', { name: /Crear 2 marcador/ }));
    await waitFor(() => {
      expect(latestState?.notice).toContain('ya tenían marcador');
    });
    expect(latestState?.project?.markers).toHaveLength(2);
  });
});
