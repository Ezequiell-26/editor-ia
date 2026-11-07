import {
  useCallback, useEffect, useMemo, useRef, useState,
  type CSSProperties, type MouseEvent as ReactMouseEvent, type RefObject,
} from 'react';
import {
  createDefaultColorGrade,
  createNeutralLayer,
  type Asset,
  type Clip,
  type ClipEffects,
  type ColorGrade,
  type ColorGradeLayer,
  type ProjectDocument,
} from '@editor-ia/project-schema';
import { updateClip } from '../../state/project-actions';
import { useProjectStore } from '../../state/project-store';
import { useThumbnail } from '../../hooks/useThumbnail';
import { ScopesPanel } from '../editor/ScopesPanel';
import { applyGradeProjection, compileGrade, gradeFilterId } from './color-engine';
import { GradeFilterDefs } from './GradeFilterDefs';
import { GradeNodes } from './GradeNodes';
import { GradeControlsPanel } from './GradeControlsPanel';
import {
  createBuiltinLooks, deleteGradePreset, getGradeClipboard, hasGradeClipboard,
  loadGradePresets, saveGradePreset, setGradeClipboard, type GradePreset,
} from './grade-presets';
import { buildGradeMask, livePreviewMedia, loadStill } from './grade-mask';
import './color.css';

/**
 * Professional Color page, mounted in the RIGHT inspector under the "Color"
 * tab. It reuses the app's single preview filter pipeline, its FFmpeg export
 * projection, its scopes and its thumbnail service — no parallel engine.
 */

type ToolId = 'primaries' | 'hdr' | 'curves' | 'masks' | 'effects' | 'scopes' | 'gallery';

const TOOLS: readonly { id: ToolId; label: string }[] = [
  { id: 'primaries', label: 'Primarias' },
  { id: 'hdr', label: 'HDR' },
  { id: 'curves', label: 'Curvas' },
  { id: 'masks', label: 'Máscaras' },
  { id: 'effects', label: 'Efectos' },
  { id: 'scopes', label: 'Scopes' },
  { id: 'gallery', label: 'Galería' },
];

const VISUAL_KINDS = new Set(['video', 'image', 'freeze', 'adjustment']);

function assetForClip(project: ProjectDocument | null, clip: Clip | undefined): Asset | null {
  if (!project || !clip) return null;
  const source: unknown = clip.source;
  if (!source || typeof source !== 'object' || !('assetId' in source)) return null;
  const assetId = (source as { assetId?: unknown }).assetId;
  if (typeof assetId !== 'string') return null;
  return project.assets.find((asset) => asset.id === assetId) ?? null;
}

function ClipStripItem({
  clip, project, active, checked, onSelect, onToggle,
}: {
  readonly clip: Clip;
  readonly project: ProjectDocument;
  readonly active: boolean;
  readonly checked: boolean;
  readonly onSelect: (event: ReactMouseEvent) => void;
  readonly onToggle: () => void;
}) {
  const store = useProjectStore();
  const asset = assetForClip(project, clip);
  const thumbnail = useThumbnail(store.service, asset, store.state.opened?.root ?? '');
  return (
    <div className={`cg-strip-item${active ? ' active' : ''}`}>
      <button type="button" className="cg-strip-thumb" onClick={onSelect} title={clip.label ?? clip.id}>
        {thumbnail ? <img src={thumbnail} alt="" draggable={false} /> : <span className="cg-strip-empty" />}
        <span className="cg-strip-name">{clip.label ?? clip.kind}</span>
      </button>
      <input type="checkbox" checked={checked} onChange={onToggle} aria-label={`Incluir ${clip.label ?? clip.id} en la selección`} />
    </div>
  );
}

export function ColorStudio({ clipId }: { readonly clipId: string }) {
  const store = useProjectStore();
  const project = store.state.project;
  const clip = project?.timeline.clips.find((item) => item.id === clipId);
  const root = store.state.opened?.root ?? '';
  const asset = assetForClip(project, clip);
  const thumbnail = useThumbnail(store.service, asset, root || null);

  const [tool, setTool] = useState<ToolId>('primaries');
  const [compare, setCompare] = useState(false);
  const [split, setSplit] = useState(0.5);
  const [showNodes, setShowNodes] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [presets, setPresets] = useState<GradePreset[]>(() => loadGradePresets());
  const [presetName, setPresetName] = useState('');
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set([clipId]));
  const [maskUrl, setMaskUrl] = useState<string | null>(null);
  const hiddenScopeStageRef = useRef<HTMLDivElement | null>(null);
  // Scopes must follow the LIVE frame, not a still: prefer the editor's real
  // preview stage (ScopesPanel re-queries on every rAF tick) and fall back to
  // the graded still only when the preview is not mounted (e.g. unit tests).
  const scopeStageRef = useMemo<RefObject<HTMLDivElement | null>>(() => ({
    get current() {
      return document.querySelector<HTMLDivElement>('.preview-stage') ?? hiddenScopeStageRef.current;
    },
  }), []);
  const defaultGrades = useRef(new Map<string, ColorGrade>());
  const interaction = useRef(false);

  const effects: ClipEffects | undefined = clip && 'effects' in clip ? clip.effects : undefined;
  if (!effects?.colorGrade && !defaultGrades.current.has(clipId)) {
    defaultGrades.current.set(clipId, createDefaultColorGrade(`cg-${clipId.slice(0, 8)}`));
  }
  const grade: ColorGrade = effects?.colorGrade ?? defaultGrades.current.get(clipId)!;
  const studioFilterId = `${gradeFilterId(clipId)}-studio`;
  const compiled = useMemo(() => compileGrade(grade, studioFilterId), [grade, studioFilterId]);
  const specs = useMemo(() => (compiled.svg ? [compiled.svg] : []), [compiled.svg]);

  const activeNode =
    grade.nodes.find((node) => node.id === grade.activeNodeId && node.kind !== 'source' && node.kind !== 'output') ??
    grade.nodes.find((node) => node.kind === 'serial' || node.kind === 'parallel') ??
    grade.nodes[1];
  const layer: ColorGradeLayer = activeNode?.layer ?? createNeutralLayer();

  const viewerFilter = [compiled.css, compiled.svg ? `url(#${studioFilterId})` : ''].filter(Boolean).join(' ');

  // -------------------------------------------------------------------------
  // All writes go through the project store: live preview, scopes, FFmpeg
  // export, autosave and undo/redo stay in sync automatically.
  // -------------------------------------------------------------------------
  const commitGrade = useCallback((next: ColorGrade, options?: { readonly history?: boolean; readonly notice?: string }) => {
    const projection = compileGrade(next, gradeFilterId(clipId)).effects;
    const merged = applyGradeProjection(effects, projection);
    const nextEffects = { ...merged, colorGrade: next } as ClipEffects;
    const ok = store.update(
      (document) => updateClip(document, clipId, { effects: nextEffects }),
      options,
    );
    if (!ok) setNotice('No se pudo aplicar: la pista está bloqueada o el clip no admite corrección.');
    else setNotice(null);
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
        commitGrade(next, { history: false });
      } else {
        commitGrade(next, {});
      }
      return;
    }
    const skipHistory = interaction.current;
    interaction.current = true;
    commitGrade(next, skipHistory ? { history: false } : {});
  }, [activeNode, grade, commitGrade]);

  const setActiveNode = useCallback((id: string) => {
    commitGrade({ ...grade, activeNodeId: id }, { history: false });
  }, [grade, commitGrade]);

  const onGradeChange = useCallback((next: ColorGrade) => {
    commitGrade(next, {});
  }, [commitGrade]);

  // Real per-pixel qualifier / power-window mask, rebuilt whenever the frame
  // or the key changes. Applied as mask-image to the graded layer.
  useEffect(() => {
    let cancelled = false;
    if (!thumbnail) { setMaskUrl(null); return; }
    const needsMask = layer.qualifier.enabled || layer.windows.some((window) => window.enabled);
    if (!needsMask) { setMaskUrl(null); return; }
    void loadStill(thumbnail).then((image) => {
      if (cancelled) return;
      const result = buildGradeMask(image, layer.qualifier, layer.windows);
      setMaskUrl(result?.url ?? null);
    }).catch(() => { if (!cancelled) setMaskUrl(null); });
    return () => { cancelled = true; };
  }, [thumbnail, layer.qualifier, layer.windows]);

  const trackWindows = useCallback(async () => {
    const live = livePreviewMedia();
    let image: HTMLImageElement | HTMLVideoElement | null = live;
    if (!image && thumbnail) {
      try { image = await loadStill(thumbnail); } catch { image = null; }
    }
    if (!image) { setNotice('Sin fotograma para rastrear.'); return; }
    const result = buildGradeMask(image, layer.qualifier, layer.windows);
    if (!result?.centroid) { setNotice('La clave no encontró píxeles suficientes.'); return; }
    const { x, y } = result.centroid;
    patchLayer((draft) => {
      draft.windows = draft.windows.map((window) => window.tracking
        ? { ...window, dx: Number(Math.max(-1, Math.min(1, x - window.x)).toFixed(3)), dy: Number(Math.max(-1, Math.min(1, y - window.y)).toFixed(3)) }
        : window);
    });
    setNotice(`Tracking aplicado: centroide ${(x * 100).toFixed(0)}% / ${(y * 100).toFixed(0)}%.`);
  }, [thumbnail, layer.qualifier, layer.windows, patchLayer]);

  const importLut = useCallback(async () => {
    try {
      const result = await store.service.importLut();
      if (!result) return;
      patchLayer((draft) => { draft.lutFile = result.path; });
      setNotice(`LUT importado: ${result.name}`);
    } catch {
      setNotice('No se pudo importar el LUT.');
    }
  }, [store.service, patchLayer]);

  // -------------------------------------------------------------------------
  // Clip-level operations
  // -------------------------------------------------------------------------
  const visualClips = useMemo(
    () => (project?.timeline.clips ?? []).filter((item) => VISUAL_KINDS.has(item.kind)),
    [project?.timeline.clips],
  );

  const applyToSelection = useCallback(() => {
    const targets = [...selectedIds].filter((id) => visualClips.some((item) => item.id === id));
    if (targets.length === 0) { setNotice('Seleccioná al menos un clip en la tira.'); return; }
    const projection = compileGrade(grade, gradeFilterId('selection')).effects;
    const ok = store.update((document) => targets.reduce((next, id) => {
      const target = next.timeline.clips.find((item) => item.id === id);
      if (!target || !('effects' in target)) return next;
      const merged = applyGradeProjection(target.effects, projection);
      return updateClip(next, id, { effects: { ...merged, colorGrade: grade } as ClipEffects });
    }, document), { notice: `Corrección aplicada a ${targets.length} clip(s).` });
    if (!ok) setNotice('No se pudo aplicar a la selección (pista bloqueada).');
    else setNotice(`Corrección aplicada a ${targets.length} clip(s).`);
  }, [selectedIds, visualClips, grade, store]);

  const pasteGrade = useCallback(() => {
    const copied = getGradeClipboard();
    if (!copied) { setNotice('No hay una corrección copiada.'); return; }
    commitGrade({ ...copied, activeNodeId: copied.activeNodeId ?? grade.activeNodeId });
    setNotice('Corrección pegada.');
  }, [grade.activeNodeId, commitGrade]);

  const applyLook = useCallback((look: ColorGradeLayer) => {
    patchLayer((draft) => {
      const fresh = JSON.parse(JSON.stringify(look)) as ColorGradeLayer;
      Object.assign(draft, fresh);
    });
  }, [patchLayer]);

  if (!project || !clip) {
    return <div className="cg-studio cg-empty">Seleccioná un clip visual para abrir el estudio de color.</div>;
  }

  const gradedStyle: CSSProperties = {
    filter: viewerFilter || undefined,
    ...(maskUrl ? { maskImage: `url(${maskUrl})`, WebkitMaskImage: `url(${maskUrl})`, maskSize: '100% 100%', WebkitMaskSize: '100% 100%' } : {}),
    ...(compare ? { clipPath: `inset(0 0 0 ${split * 100}%)` } : {}),
  };

  return (
    <div className="cg-studio" data-tool={tool}>
      <GradeFilterDefs specs={specs} />

      <header className="cg-head">
        <div className="cg-head-title">
          <strong>Color Studio</strong>
          <span title={clip.label ?? clip.id}>{clip.label ?? clip.id}</span>
        </div>
        <div className="cg-head-actions">
          <button type="button" className="cg-btn small" onClick={() => setGradeClipboard(grade)} title="Copiar corrección">Copiar</button>
          <button type="button" className="cg-btn small" onClick={pasteGrade} disabled={!hasGradeClipboard()} title="Pegar corrección">Pegar</button>
          <button type="button" className="cg-btn small" onClick={() => store.undo()} disabled={!store.canUndo} title="Deshacer">↶</button>
          <button type="button" className="cg-btn small" onClick={() => store.redo()} disabled={!store.canRedo} title="Rehacer">↷</button>
          <button type="button" className={`cg-btn small${compare ? ' active' : ''}`} onClick={() => setCompare((value) => !value)} title="Comparar antes / después">A/B</button>
        </div>
      </header>

      {/* Visor del estudio: fotograma real del clip + el mismo grade del visor central. */}
      <div className="cg-viewer">
        {thumbnail ? (
          <>
            <img className="cg-viewer-base" src={thumbnail} alt="Fotograma original" draggable={false} />
            {!compare || split < 1 ? (
              <img className="cg-viewer-grade" src={thumbnail} alt="Fotograma corregido" draggable={false} style={gradedStyle} />
            ) : null}
            {compare ? (
              <>
                <div className="cg-viewer-split" style={{ left: `${split * 100}%` }} />
                <input className="cg-viewer-split-range" type="range" min={0} max={1} step={0.01} value={split}
                  aria-label="Posición de comparación" onChange={(event) => setSplit(Number(event.target.value))} />
              </>
            ) : null}
          </>
        ) : (
          <div className="cg-viewer-empty">Sin miniatura disponible para este clip.</div>
        )}
        <div className="cg-viewer-badge">{compare ? 'ANTES / DESPUÉS' : 'GRADE EN VIVO'}</div>
      </div>

      {/* Tira de clips: selecciona el fragmento activo y arma la selección múltiple. */}
      <div className="cg-strip-wrap">
        <div className="cg-section-label">
          <span>Clips</span>
          <button type="button" className="cg-btn small" onClick={applyToSelection}>Aplicar a selección ({selectedIds.size})</button>
        </div>
        <div className="cg-strip">
          {visualClips.map((item) => (
            <ClipStripItem
              key={item.id}
              clip={item}
              project={project}
              active={item.id === clipId}
              checked={selectedIds.has(item.id)}
              onSelect={(event) => {
                if (event.ctrlKey || event.metaKey || event.shiftKey) {
                  setSelectedIds((current) => {
                    const next = new Set(current);
                    if (next.has(item.id)) next.delete(item.id); else next.add(item.id);
                    return next;
                  });
                } else {
                  setSelectedIds(new Set([item.id]));
                }
                store.setSelection({ kind: 'clip', id: item.id });
              }}
              onToggle={() => setSelectedIds((current) => {
                const next = new Set(current);
                if (next.has(item.id)) next.delete(item.id); else next.add(item.id);
                return next;
              })}
            />
          ))}
        </div>
      </div>

      {/* Editor de nodos: el orden del grafo ES el orden de procesamiento. */}
      <div className="cg-nodes-wrap">
        <div className="cg-section-label">
          <span>Nodos · {grade.nodes.length}</span>
          <button type="button" className="cg-btn small" onClick={() => setShowNodes((value) => !value)}>
            {showNodes ? 'Ocultar' : 'Mostrar'}
          </button>
        </div>
        {showNodes ? (
          <GradeNodes grade={grade} onChange={onGradeChange} activeNodeId={activeNode?.id} onSelectNode={setActiveNode} />
        ) : null}
      </div>

      <div className="cg-active-node">
        <span>Nodo activo</span>
        <strong>{activeNode?.label ?? '—'}</strong>
        <label className="cg-mix">
          Mix
          <input type="range" min={0} max={1} step={0.01} value={layer.mix} aria-label="Mezcla del nodo"
            onChange={(event) => patchLayer((draft) => { draft.mix = Number(event.target.value); }, true)}
            onPointerUp={() => patchLayer((draft) => { draft.mix = layer.mix; }, false)} />
          <span>{Math.round(layer.mix * 100)}%</span>
        </label>
      </div>

      <div className="cg-tools" role="tablist" aria-label="Herramientas de color">
        {TOOLS.map((entry) => (
          <button key={entry.id} type="button" role="tab" aria-selected={tool === entry.id}
            className={tool === entry.id ? 'active' : ''} onClick={() => setTool(entry.id)}>
            {entry.label}
          </button>
        ))}
      </div>

      <div className="cg-tool-body">
        {tool === 'scopes' ? (
          <div className="cg-scopes">
            <div ref={hiddenScopeStageRef} className="preview-stage cg-scope-stage" aria-hidden="true">
              <div className="preview-canvas">
                <img className="preview-media" src={thumbnail ?? ''} alt="" crossOrigin="anonymous"
                  style={{ filter: compiled.css || undefined }} />
              </div>
            </div>
            <ScopesPanel stageRef={scopeStageRef} onClose={() => setTool('primaries')} />
            <p className="cg-hint">Waveform, RGB Parade, Vectorscope e Histograma calculados sobre el fotograma con el grade aplicado.</p>
          </div>
        ) : tool === 'gallery' ? (
          <div className="cg-gallery">
            <div className="cg-group-title">Looks integrados</div>
            <div className="cg-look-grid">
              {createBuiltinLooks().map((look) => (
                <button key={look.id} type="button" className="cg-look" onClick={() => applyLook(look.layer)}>
                  <span className="cg-look-swatch" style={{ filter: `saturate(${look.layer.primaries.saturation}) sepia(${Math.max(0, look.layer.primaries.temperature * 0.4)}) contrast(${1 + look.layer.primaries.contrast * 0.4})` }} />
                  {look.label}
                </button>
              ))}
            </div>
            <div className="cg-group-title">Referencias del proyecto</div>
            <div className="cg-reference-grid">
              {project.assets.filter((item) => item.kind === 'image').slice(0, 12).map((item) => (
                <ReferenceThumb key={item.id} asset={item} root={root} />
              ))}
              {project.assets.filter((item) => item.kind === 'image').length === 0
                ? <span className="cg-hint">Sin imágenes de referencia en el proyecto.</span> : null}
            </div>
            <div className="cg-group-title">Presets guardados</div>
            <div className="cg-preset-new">
              <input type="text" value={presetName} placeholder="Nombre del preset" aria-label="Nombre del preset"
                onChange={(event) => setPresetName(event.target.value)} />
              <button type="button" className="cg-btn" onClick={() => {
                if (!presetName.trim()) return;
                setPresets(saveGradePreset(presetName, { grade, layer }));
                setPresetName('');
                setNotice('Preset guardado.');
              }}>Guardar</button>
            </div>
            <div className="cg-presets">
              {presets.length === 0 ? <span className="cg-hint">Todavía no guardaste presets.</span> : null}
              {presets.map((preset) => (
                <div className="cg-preset" key={preset.id}>
                  <button type="button" className="cg-preset-apply" onClick={() => {
                    if (preset.grade) commitGrade({ ...preset.grade, activeNodeId: preset.grade.activeNodeId ?? grade.activeNodeId });
                    else if (preset.layer) applyLook(preset.layer);
                  }}>{preset.name}</button>
                  <button type="button" className="cg-btn small" aria-label={`Eliminar ${preset.name}`}
                    onClick={() => setPresets(deleteGradePreset(preset.id))}>×</button>
                </div>
              ))}
            </div>
            <div className="cg-group-title">Herramientas de máscara</div>
            <button type="button" className="cg-btn" onClick={() => void trackWindows()}>Rastrear ventana activa</button>
            <button type="button" className="cg-btn" onClick={() => { commitGrade(createDefaultColorGrade()); setNotice('Grade reiniciado.'); }}>Reiniciar grade</button>
          </div>
        ) : (
          <GradeControlsPanel
            tool={tool}
            layer={layer}
            onChange={patchLayer}
            onImportLut={() => void importLut()}
            lutLabel={layer.lutFile ?? 'Sin LUT'}
          />
        )}
      </div>

      {notice ? <div className="cg-notice" role="status">{notice}</div> : null}
      <footer className="cg-foot">
        <span>{compiled.stages.length} etapa(s) · {grade.links.length} conexiones</span>
        <span>{compiled.active ? 'Procesamiento activo' : 'Sin correcciones'}</span>
      </footer>
    </div>
  );
}

function ReferenceThumb({ asset, root }: { readonly asset: Asset; readonly root: string }) {
  const store = useProjectStore();
  const thumbnail = useThumbnail(store.service, asset, root || null);
  return thumbnail
    ? <img className="cg-reference" src={thumbnail} alt={asset.label ?? asset.id} title={asset.label ?? asset.id} />
    : null;
}
