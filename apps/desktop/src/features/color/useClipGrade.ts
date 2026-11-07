import { useCallback, useMemo, useRef, useState } from 'react';
import {
  createDefaultColorGrade,
  createNeutralLayer,
  type ClipEffects,
  type ColorGrade,
  type ColorGradeLayer,
} from '@editor-ia/project-schema';
import { updateClip } from '../../state/project-actions';
import { useProjectStore } from '../../state/project-store';
import { applyGradeProjection, compileGrade, gradeFilterId } from './color-engine';

/**
 * Single write path for every colour control in the right properties panel.
 *
 * It mirrors the (already verified) persistence contract of ColorStudio:
 * grade -> compileGrade projection -> flat ClipEffects -> updateClip, which is
 * what keeps live preview, scopes, undo/redo, autosave and FFmpeg export in
 * sync. Panels must never keep their own copy of a correction value.
 */
export interface ClipGradeApi {
  readonly grade: ColorGrade;
  readonly layer: ColorGradeLayer;
  readonly activeNodeId: string | null;
  readonly layers: readonly { readonly id: string; readonly label: string; readonly enabled: boolean }[];
  readonly error: string | null;
  patchLayer(mutate: (draft: ColorGradeLayer) => void, transient?: boolean): void;
  applyLayer(next: ColorGradeLayer): void;
  resetLayer(): void;
  addLayer(): void;
  removeLayer(id: string): void;
  selectLayer(id: string): void;
  setGrade(next: ColorGrade): void;
}

export function useClipGrade(clipId: string): ClipGradeApi {
  const store = useProjectStore();
  const project = store.state.project;
  const clip = useMemo(
    () => project?.timeline.clips.find((item) => item.id === clipId),
    [project?.timeline.clips, clipId],
  );
  const effects = clip && 'effects' in clip ? (clip.effects as ClipEffects | undefined) : undefined;
  const grade: ColorGrade = effects?.colorGrade ?? createDefaultColorGrade();
  const [error, setError] = useState<string | null>(null);
  const interaction = useRef(false);

  const activeNode =
    grade.nodes.find((node) => node.id === grade.activeNodeId && node.kind !== 'source' && node.kind !== 'output') ??
    grade.nodes.find((node) => node.kind === 'serial' || node.kind === 'parallel') ??
    grade.nodes[1];
  const layer: ColorGradeLayer = activeNode?.layer ?? createNeutralLayer();

  const layers = useMemo(
    () => grade.nodes
      .filter((node) => node.kind !== 'source' && node.kind !== 'output')
      .map((node) => ({ id: node.id, label: node.label, enabled: node.enabled })),
    [grade.nodes],
  );

  const commit = useCallback((next: ColorGrade, options?: { readonly history?: boolean; readonly notice?: string }) => {
    const projection = compileGrade(next, gradeFilterId(clipId)).effects;
    const merged = applyGradeProjection(effects, projection);
    const nextEffects = { ...merged, colorGrade: next } as ClipEffects;
    const ok = store.update(
      (document) => updateClip(document, clipId, { effects: nextEffects }),
      options,
    );
    setError(ok ? null : 'No se pudo aplicar: la pista está bloqueada o el clip no admite corrección.');
  }, [clipId, effects, store]);

  const patchLayer = useCallback((mutate: (draft: ColorGradeLayer) => void, transient = false) => {
    if (!activeNode) return;
    const draft = JSON.parse(JSON.stringify(activeNode.layer)) as ColorGradeLayer;
    mutate(draft);
    const next: ColorGrade = {
      ...grade,
      nodes: grade.nodes.map((node) => (node.id === activeNode.id ? { ...node, layer: draft } : node)),
    };
    if (!transient) {
      if (interaction.current) {
        interaction.current = false;
        commit(next, { history: false });
      } else {
        commit(next, {});
      }
      return;
    }
    const skipHistory = interaction.current;
    interaction.current = true;
    commit(next, skipHistory ? { history: false } : {});
  }, [activeNode, grade, commit]);

  const applyLayer = useCallback((next: ColorGradeLayer) => {
    if (!activeNode) return;
    const fresh = JSON.parse(JSON.stringify(next)) as ColorGradeLayer;
    commit({
      ...grade,
      nodes: grade.nodes.map((node) => (node.id === activeNode.id ? { ...node, layer: fresh } : node)),
    }, {});
  }, [activeNode, grade, commit]);

  const resetLayer = useCallback(() => {
    applyLayer(createNeutralLayer());
  }, [applyLayer]);

  const setGrade = useCallback((next: ColorGrade) => commit(next, {}), [commit]);

  const selectLayer = useCallback((id: string) => {
    commit({ ...grade, activeNodeId: id }, { history: false });
  }, [grade, commit]);

  const addLayer = useCallback(() => {
    const serials = layers;
    const id = `color-node-${Date.now().toString(36)}`;
    const outputId = 'color-output';
    const sourceId = 'color-source';
    const last = serials[serials.length - 1];
    const nodes = [...grade.nodes];
    const outputIndex = nodes.findIndex((node) => node.id === outputId);
    const node = {
      id,
      label: `Capa ${serials.length + 1}`,
      kind: 'serial' as const,
      enabled: true,
      layer: createNeutralLayer(),
      x: 0.5,
      y: 0.5,
    };
    nodes.splice(outputIndex < 0 ? nodes.length : outputIndex, 0, node);
    const links = grade.links.map((link) => (link.to === outputId ? { ...link, to: id } : link));
    links.push({
      id: `color-link-${id}`,
      from: last?.id ?? sourceId,
      to: outputId,
    });
    commit({ ...grade, nodes, links, activeNodeId: id }, { notice: `${node.label} agregada.` });
  }, [grade, layers, commit]);

  const removeLayer = useCallback((id: string) => {
    if (layers.length <= 1) {
      setError('Tiene que quedar al menos una capa de corrección.');
      return;
    }
    const incoming = grade.links.find((link) => link.to === id);
    const outgoing = grade.links.find((link) => link.from === id);
    const nodes = grade.nodes.filter((node) => node.id !== id);
    let links = grade.links.filter((link) => link.to !== id && link.from !== id);
    if (incoming && outgoing) {
      links = [...links, {
        id: `color-link-${incoming.from}-${outgoing.to}`,
        from: incoming.from,
        to: outgoing.to,
      }];
    }
    const nextActive = nodes.find((node) => node.id !== id && node.kind !== 'source' && node.kind !== 'output')?.id;
    commit({ ...grade, nodes, links, activeNodeId: nextActive }, { notice: 'Capa eliminada.' });
  }, [grade, layers.length, commit]);

  return {
    grade,
    layer,
    activeNodeId: activeNode?.id ?? null,
    layers,
    error,
    patchLayer,
    applyLayer,
    resetLayer,
    addLayer,
    removeLayer,
    selectLayer,
    setGrade,
  };
}
