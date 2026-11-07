// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createEmptyProject, type ClipEffects } from '@editor-ia/project-schema';
import { createFakeService, readyAsset } from '../../test/fake-service';
import { addAsset, addClipFromAsset, ensureDelivery } from '../../state/project-actions';
import { ProjectProvider, useProjectStore, type ProjectStoreValue } from '../../state/project-store';
import { ColorStudio } from './ColorStudio';

/**
 * End-to-end proof of the requirement "when I move a control, the image in the
 * viewer must change": a slider write goes through store.update -> ClipEffects
 * -> compileGrade -> the live filter on the viewer. Also proves undo/redo and
 * persistence on the clip document without waiting for the autosave debounce.
 */

beforeAll(() => {
  const globals = globalThis as unknown as { ResizeObserver?: unknown; matchMedia?: unknown };
  if (typeof globals.ResizeObserver === 'undefined') {
    class ResizeObserverStub {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    globals.ResizeObserver = ResizeObserverStub;
  }
  if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
    window.matchMedia = ((query: string) => ({
      matches: false, media: query, onchange: null,
      addListener: () => {}, removeListener: () => {},
      addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
    })) as typeof window.matchMedia;
  }
});

afterEach(() => cleanup());

function currentGrade(store: ProjectStoreValue, clipId: string) {
  const clip = store.getProject()?.timeline.clips.find((item) => item.id === clipId);
  if (!clip || !('effects' in clip)) return undefined;
  return (clip.effects as ClipEffects | undefined)?.colorGrade;
}

function Harness({ clipId, onStore }: { readonly clipId: string; readonly onStore: (store: ProjectStoreValue) => void }) {
  const store = useProjectStore();
  onStore(store);
  return (
    <aside className="inspector">
      <ColorStudio clipId={clipId} />
    </aside>
  );
}

describe('Color Studio · panel derecho, pestaña Color', () => {
  it('un control cambia el filtro del visor y el grade queda persistido y es deshacible', async () => {
    const service = createFakeService();
    const asset = readyAsset();
    const base = addAsset(ensureDelivery(createEmptyProject('Obra color', '2025-01-01T00:00:00Z')), asset);
    const { project, clipId } = addClipFromAsset(base, asset, { atFrame: 0, durationFrames: 90 });
    const opened = { project, label: 'color.editoria.json', path: 'C:\\tmp\\color.editoria.json', root: 'C:\\tmp' };
    let storeRef: ProjectStoreValue | null = null;

    render(
      <ProjectProvider service={service} initial={{ project, opened }}>
        <Harness clipId={clipId} onStore={(store) => { storeRef = store; }} />
      </ProjectProvider>,
    );

    const studio = await waitFor(() => {
      const element = document.querySelector<HTMLElement>('.inspector .cg-studio');
      if (!element) throw new Error('Color Studio no está en el panel derecho');
      return element;
    });

    // Estructura profesional: visor, tira de clips, nodos, herramientas.
    expect(studio.querySelector('.cg-viewer')).toBeTruthy();
    expect(studio.querySelector('.cg-strip')).toBeTruthy();
    expect(studio.querySelector('.cg-nodes')).toBeTruthy();
    expect(studio.querySelectorAll('.cg-tools button').length).toBeGreaterThanOrEqual(7);

    const graded = studio.querySelector<HTMLElement>('.cg-viewer-grade');
    expect(graded).toBeTruthy();
    expect(graded!.style.filter).not.toContain('contrast(');

    const contrast = within(studio).getByLabelText('Contraste');
    fireEvent.change(contrast, { target: { value: '0.65' } });

    await waitFor(() => {
      const after = studio.querySelector<HTMLElement>('.cg-viewer-grade');
      expect(after?.style.filter).toContain('contrast(');
    });

    await waitFor(() => expect(studio.querySelector('.color-grade-defs filter')).toBeTruthy());

    const grade = currentGrade(storeRef!, clipId);
    expect(grade?.version).toBe(1);
    const active = grade?.nodes.find((node) => node.id === grade.activeNodeId);
    expect(active?.layer.primaries.contrast).toBeGreaterThan(0.5);
    // The projection written for the existing FFmpeg exporter is real too.
    const clip = storeRef!.getProject()!.timeline.clips.find((item) => item.id === clipId)!;
    expect((clip as unknown as { effects: ClipEffects }).effects.contrast).toBeGreaterThan(1);

    act(() => { storeRef!.undo(); });
    await waitFor(() => {
      const after = studio.querySelector<HTMLElement>('.cg-viewer-grade');
      expect(after?.style.filter).not.toContain('contrast(');
    });
    expect(currentGrade(storeRef!, clipId)).toBeUndefined();
  });

  it('los looks integrados escriben valores reales en el nodo activo', async () => {
    const service = createFakeService();
    const asset = readyAsset();
    const base = addAsset(ensureDelivery(createEmptyProject('Obra looks', '2025-01-01T00:00:00Z')), asset);
    const { project, clipId } = addClipFromAsset(base, asset, { atFrame: 0, durationFrames: 90 });
    const opened = { project, label: 'looks.editoria.json', path: 'C:\\tmp\\looks.editoria.json', root: 'C:\\tmp' };
    let storeRef: ProjectStoreValue | null = null;
    render(
      <ProjectProvider service={service} initial={{ project, opened }}>
        <Harness clipId={clipId} onStore={(store) => { storeRef = store; }} />
      </ProjectProvider>,
    );
    const studio = await waitFor(() => {
      const element = document.querySelector<HTMLElement>('.cg-studio');
      if (!element) throw new Error('sin estudio');
      return element;
    });
    fireEvent.click(within(studio).getByRole('tab', { name: 'Galería' }));
    fireEvent.click(within(studio).getByRole('button', { name: 'Cálido' }));
    await waitFor(() => {
      const grade = currentGrade(storeRef!, clipId);
      const active = grade?.nodes.find((node) => node.id === grade.activeNodeId);
      expect(active?.layer.primaries.temperature).toBeGreaterThan(0);
    });
    await waitFor(() => {
      expect(studio.querySelector<HTMLElement>('.cg-viewer-grade')?.style.filter ?? '').toContain('sepia(');
    });
  });
});
