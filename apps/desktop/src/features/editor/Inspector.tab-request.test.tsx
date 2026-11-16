// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { createEmptyProject, type ProjectDocument } from '@editor-ia/project-schema';
import { ProjectProvider, useProjectStore } from '../../state/project-store';
import { addAsset, addClipFromAsset, ensureDelivery } from '../../state/project-actions';
import { createFakeService, readyAsset } from '../../test/fake-service';
import type { ClipInspectorTab, InspectorTabRequest } from '../../state/inspector-tab-command';
import { Inspector } from './Inspector';

const NOW = '2026-11-09T00:00:00.000Z';

afterEach(cleanup);

function SelectOnMount(props: { kind: 'clip'; id: string }): null {
  const store = useProjectStore();
  useEffect(() => {
    store.setSelection({ kind: props.kind, id: props.id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

function projectWithClip(kind: 'video' | 'image'): {
  project: ProjectDocument;
  clipId: string;
} {
  const asset = readyAsset({
    kind,
    label: kind === 'video' ? 'Toma' : 'Card',
    source: { type: 'local', path: kind === 'video' ? 'media/toma.mp4' : 'media/card.png' },
  });
  const added = addClipFromAsset(
    addAsset(ensureDelivery(createEmptyProject('Tabs', NOW)), asset),
    asset,
    { atFrame: 0, durationFrames: 90 },
  );
  return { project: added.project, clipId: added.clipId };
}

function renderInspector(
  clipId: string,
  project: ProjectDocument,
  tabRequest?: InspectorTabRequest,
) {
  return render(
    <ProjectProvider
      service={createFakeService()}
      initial={{
        project,
        opened: {
          project,
          label: 'tabs.editoria.json',
          path: 'C:\\tester\\tabs.editoria.json',
          root: 'C:\\tester',
        },
      }}
    >
      <SelectOnMount kind="clip" id={clipId} />
      <Inspector tabRequest={tabRequest} />
    </ProjectProvider>,
  );
}

function selectedTab(): string | null {
  return (
    screen
      .getAllByRole('tab')
      .find((tab) => tab.getAttribute('aria-selected') === 'true')
      ?.textContent ?? null
  );
}

describe('Inspector · tabRequest', () => {
  it('abre la pestaña Recorte para un clip de video', () => {
    const { project, clipId } = projectWithClip('video');
    renderInspector(clipId, project, { tab: 'trim', nonce: 1 });
    expect(selectedTab()).toBe('Recorte');
  });

  it('«Duración» abre Velocidad y «Editar» abre Todo', () => {
    const { project, clipId } = projectWithClip('video');
    const { rerender } = renderInspector(clipId, project, { tab: 'speed', nonce: 1 });
    expect(selectedTab()).toBe('Velocidad');
    // Un pedido nuevo con otro nonce vuelve a aplicar aunque la pestaña ya
    // esté seleccionada; el mismo nonce no se re-aplica.
    rerender(
      <ProjectProvider
        service={createFakeService()}
        initial={{
          project,
          opened: { project, label: 't', path: 'C:\\t', root: 'C:\\t' },
        }}
      >
        <SelectOnMount kind="clip" id={clipId} />
        <Inspector tabRequest={{ tab: 'all', nonce: 2 }} />
      </ProjectProvider>,
    );
    expect(selectedTab()).toBe('Todo');
  });

  it('aplica la subpestaña pedida dentro de la pestaña Color', () => {
    const { project, clipId } = projectWithClip('video');
    const view = renderInspector(clipId, project, {
      tab: 'color',
      subTab: 'hdr',
      nonce: 1,
    });
    expect(selectedTab()).toBe('Color');
    const activeSub = view.container.querySelector(
      '.inspector-subtabs [aria-selected="true"]',
    );
    expect(activeSub?.textContent).toBe('HDR');
  });

  it('aplica la subpestaña Paleta dentro de la pestaña Color', () => {
    const { project, clipId } = projectWithClip('video');
    const view = renderInspector(clipId, project, {
      tab: 'color',
      subTab: 'palette',
      nonce: 1,
    });
    expect(selectedTab()).toBe('Color');
    const activeSub = view.container.querySelector(
      '.inspector-subtabs [aria-selected="true"]',
    );
    expect(activeSub?.textContent).toBe('Paleta');
  });

  it('ignora una subpestaña que no existe en la pestaña pedida', () => {
    const { project, clipId } = projectWithClip('video');
    const view = renderInspector(clipId, project, {
      tab: 'color',
      subTab: 'inventada',
      nonce: 1,
    });
    expect(selectedTab()).toBe('Color');
    const activeSub = view.container.querySelector(
      '.inspector-subtabs [aria-selected="true"]',
    );
    expect(activeSub?.textContent).toBe('Básico');
  });

  it('ignora una pestaña que el clip no admite', () => {
    const { project, clipId } = projectWithClip('image');
    renderInspector(clipId, project, { tab: 'speed' as ClipInspectorTab, nonce: 1 });
    // La imagen arranca en «Video»; speed no aplica y no debe cambiarla.
    expect(selectedTab()).toBe('Video');
  });
});
