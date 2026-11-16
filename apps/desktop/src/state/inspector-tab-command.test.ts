import { describe, expect, it, vi } from 'vitest';
import { createEmptyProject, type Asset, type ProjectDocument } from '@editor-ia/project-schema';
import type { ProjectStoreValue, Selection } from './project-store';
import {
  addAsset,
  addClipFromAsset,
  ensureDelivery,
  newId,
} from './project-actions';
import {
  clipSupportsInspectorTab,
  openClipInspectorTab,
  type ClipInspectorTab,
} from './inspector-tab-command';

const NOW = '2026-11-09T00:00:00.000Z';

function fakeStore(
  project: ProjectDocument | null,
  selection: Selection = { kind: 'none' },
): { store: ProjectStoreValue; notices: string[] } {
  const notices: string[] = [];
  const store = {
    state: { project, selection },
    getPlayhead: () => 0,
    getProject: () => project,
    setNotice: (notice: string | null) => {
      if (notice) notices.push(notice);
    },
    update: () => true,
  } as unknown as ProjectStoreValue;
  return { store, notices };
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
    media: { width: 1920, height: 1080, durationFrames: 300, frameRate: { num: 30, den: 1 } },
  } as Asset;
}

function projectWithClip(): { project: ProjectDocument; clipId: string } {
  const asset = videoAsset();
  const added = addClipFromAsset(addAsset(ensureDelivery(createEmptyProject('Tabs', NOW)), asset), asset, {
    atFrame: 0,
    durationFrames: 90,
  });
  return { project: added.project, clipId: added.clipId };
}

function projectWithImageClip(): { project: ProjectDocument; clipId: string } {
  const asset: Asset = {
    ...videoAsset(),
    id: newId(),
    label: 'Card',
    kind: 'image',
    source: { type: 'local', path: 'media/card.png' },
    media: { width: 1920, height: 1080 },
  } as Asset;
  const added = addClipFromAsset(addAsset(ensureDelivery(createEmptyProject('Tabs', NOW)), asset), asset, {
    atFrame: 0,
    durationFrames: 90,
  });
  return { project: added.project, clipId: added.clipId };
}

describe('clipSupportsInspectorTab', () => {
  it('speed y trim exigen clip con duración; all siempre', () => {
    const { project, clipId } = projectWithClip();
    const clip = project.timeline.clips.find((item) => item.id === clipId)!;
    expect(clipSupportsInspectorTab(clip, 'speed')).toBe(true);
    expect(clipSupportsInspectorTab(clip, 'trim')).toBe(true);
    expect(clipSupportsInspectorTab(clip, 'all')).toBe(true);
    expect(clipSupportsInspectorTab(clip, 'video')).toBe(true);
  });

  it('una imagen no admite speed ni trim pero sí all y color', () => {
    const { project, clipId } = projectWithImageClip();
    const clip = project.timeline.clips.find((item) => item.id === clipId)!;
    expect(clipSupportsInspectorTab(clip, 'speed')).toBe(false);
    expect(clipSupportsInspectorTab(clip, 'trim')).toBe(false);
    expect(clipSupportsInspectorTab(clip, 'all')).toBe(true);
    expect(clipSupportsInspectorTab(clip, 'color')).toBe(true);
  });
});

describe('openClipInspectorTab', () => {
  it('sin proyecto no hace nada', () => {
    const { store, notices } = fakeStore(null);
    const requestTab = vi.fn();
    openClipInspectorTab(store, 'trim', requestTab);
    expect(requestTab).not.toHaveBeenCalled();
    expect(notices).toHaveLength(0);
  });

  it('sin clip seleccionado avisa y no pide la pestaña', () => {
    const { project } = projectWithClip();
    const { store, notices } = fakeStore(project, { kind: 'none' });
    const requestTab = vi.fn();
    openClipInspectorTab(store, 'trim', requestTab);
    expect(requestTab).not.toHaveBeenCalled();
    expect(notices[0]).toMatch(/Seleccioná un clip/);
  });

  it('pide la pestaña trim para un clip de video seleccionado', () => {
    const { project, clipId } = projectWithClip();
    const { store } = fakeStore(project, { kind: 'clip', id: clipId });
    const requestTab = vi.fn();
    openClipInspectorTab(store, 'trim', requestTab);
    expect(requestTab).toHaveBeenCalledWith('trim');
  });

  it('«Duración» abre la pestaña speed y «Editar» abre all', () => {
    const { project, clipId } = projectWithClip();
    const { store } = fakeStore(project, { kind: 'clip', id: clipId });
    const requestTab = vi.fn();
    openClipInspectorTab(store, 'speed', requestTab);
    openClipInspectorTab(store, 'all', requestTab);
    expect(requestTab).toHaveBeenNthCalledWith(1, 'speed');
    expect(requestTab).toHaveBeenNthCalledWith(2, 'all');
  });

  it('una imagen no puede abrir speed ni trim', () => {
    const { project, clipId } = projectWithImageClip();
    const { store, notices } = fakeStore(project, { kind: 'clip', id: clipId });
    const requestTab = vi.fn();
    openClipInspectorTab(store, 'speed', requestTab);
    expect(requestTab).not.toHaveBeenCalled();
    expect(notices[0]).toMatch(/no aplica/);
  });

  it('reenvía la subpestaña pedida junto a la pestaña', () => {
    const { project, clipId } = projectWithClip();
    const { store } = fakeStore(project, { kind: 'clip', id: clipId });
    const requestTab = vi.fn();
    openClipInspectorTab(store, 'color', requestTab, 'wheels');
    expect(requestTab).toHaveBeenCalledWith('color', 'wheels');
  });

  it('sin subpestaña el callback recibe sólo la pestaña', () => {
    const { project, clipId } = projectWithClip();
    const { store } = fakeStore(project, { kind: 'clip', id: clipId });
    const requestTab = vi.fn();
    openClipInspectorTab(store, 'trim', requestTab);
    expect(requestTab).toHaveBeenCalledWith('trim');
    expect(requestTab.mock.calls[0]).toHaveLength(1);
  });

  it('un clip compuesto no tiene pestañas de edición', () => {
    const { project, clipId } = projectWithClip();
    const compound: ProjectDocument = structuredClone(project);
    const clip = compound.timeline.clips.find((item) => item.id === clipId)!;
    // Forzar la forma de clip compuesto: el comando sólo mira `kind`.
    (clip as { kind: string }).kind = 'compound';
    const { store, notices } = fakeStore(compound, { kind: 'clip', id: clipId });
    const requestTab = vi.fn();
    openClipInspectorTab(store, 'all', requestTab);
    expect(requestTab).not.toHaveBeenCalled();
    expect(notices[0]).toMatch(/compuesto/);
  });
});
