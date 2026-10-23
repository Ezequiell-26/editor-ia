import { useEffect, useMemo, useState } from 'react';
import type { Clip, ClipEffects, ClipTransition } from '@editor-ia/project-schema';
import type { ViewId } from '../../app/navigation';
import { Icon, type IconName } from '../../components/Icon';
import { ViewToolbar } from '../../components/ViewToolbar';
import type {
  VisualAudit,
  VisualCatalog,
  VisualPresetSpec,
} from '../../services/project-service';
import { updateClip } from '../../state/project-actions';
import { useProjectStore } from '../../state/project-store';
import {
  FALLBACK_VISUAL_CATALOG,
  assetLabel,
  clipLabel,
  clipTime,
  mergePresetEffects,
  quickEffects,
  safeTransitionFrames,
  trackLabel,
  visualClips,
} from './visuals';

interface QuickValues {
  brightness: number;
  contrast: number;
  saturation: number;
  temperature: number;
  vignette: number;
  blur: number;
  sharpen: number;
  grayscale: boolean;
  sepia: boolean;
}

const QUICK_DEFAULTS: QuickValues = {
  brightness: 0,
  contrast: 1,
  saturation: 1,
  temperature: 0,
  vignette: 0,
  blur: 0,
  sharpen: 0,
  grayscale: false,
  sepia: false,
};

function effectsOf(clip: Clip): ClipEffects | undefined {
  return 'effects' in clip ? clip.effects : undefined;
}

function severityIcon(severity: string): IconName {
  return severity === 'error' ? 'alert-triangle' : severity === 'warning' ? 'alert' : 'info';
}

export function VisualsView({
  onNavigate,
}: {
  readonly onNavigate: (id: ViewId) => void;
}) {
  const store = useProjectStore();
  const project = store.state.project;
  const clips = useMemo(() => visualClips(project), [project]);
  const fps = project
    ? project.video.frameRate.num / Math.max(1, project.video.frameRate.den)
    : 30;
  const [catalog, setCatalog] = useState<VisualCatalog>(FALLBACK_VISUAL_CATALOG);
  const [measured, setMeasured] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [transitionType, setTransitionType] = useState('dissolve');
  const [transitionFrames, setTransitionFrames] = useState(12);
  const [quick, setQuick] = useState<QuickValues>(QUICK_DEFAULTS);
  const [audit, setAudit] = useState<VisualAudit | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void store.service
      .listVisualCatalog()
      .then((next) => {
        if (!active) return;
        setCatalog(next);
        setMeasured(true);
      })
      .catch(() => {
        if (!active) return;
        setCatalog(FALLBACK_VISUAL_CATALOG);
        setMeasured(false);
      });
    return () => {
      active = false;
    };
  }, [store.service]);

  useEffect(() => {
    if (!project) {
      setSelectedIds([]);
      return;
    }
    const available = visualClips(project);
    const selected = store.state.selection;
    if (
      selected.kind === 'clip' &&
      available.some((clip) => clip.id === selected.id)
    ) {
      setSelectedIds([selected.id]);
      return;
    }
    setSelectedIds(available.map((clip) => clip.id));
    // La selección se reinicia al abrir otro proyecto, no después de cada edición.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id]);

  const selectedClips = clips.filter((clip) => selectedIds.includes(clip.id));
  const primary = selectedClips[0] ?? null;
  const transitionSpec = catalog.transitions.find((item) => item.id === transitionType);
  const availableEffects = catalog.effects.filter((effect) => effect.available);

  function toggleClip(id: string): void {
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
    setAudit(null);
  }

  function applyPreset(preset: VisualPresetSpec): void {
    if (!project || selectedClips.length === 0) {
      setError('Elegí al menos un clip visual.');
      return;
    }
    setError(null);
    const ok = store.update(
      (current) =>
        selectedIds.reduce((next, id) => {
          const clip = next.timeline.clips.find((item) => item.id === id);
          if (!clip) return next;
          return updateClip(next, id, {
            effects: mergePresetEffects(effectsOf(clip), preset),
          });
        }, current),
      { notice: `Preset ${preset.label} aplicado a ${selectedClips.length} clip(s).` },
    );
    if (ok) setAudit(null);
  }

  function applyQuick(): void {
    if (!project || selectedClips.length === 0) {
      setError('Elegí al menos un clip visual.');
      return;
    }
    setError(null);
    const ok = store.update(
      (current) =>
        selectedIds.reduce((next, id) => {
          const clip = next.timeline.clips.find((item) => item.id === id);
          if (!clip) return next;
          return updateClip(next, id, {
            effects: quickEffects(quick, effectsOf(clip)),
          });
        }, current),
      { notice: `Ajustes visuales aplicados a ${selectedClips.length} clip(s).` },
    );
    if (ok) setAudit(null);
  }

  function applyTransition(): void {
    if (!project || selectedClips.length === 0) {
      setError('Elegí al menos un clip visual.');
      return;
    }
    const type = transitionType as ClipTransition['type'];
    setError(null);
    let clamped = 0;
    const ok = store.update(
      (current) =>
        selectedIds.reduce((next, id) => {
          const clip = next.timeline.clips.find((item) => item.id === id);
          if (!clip) return next;
          const frames = safeTransitionFrames(transitionFrames, clip);
          if (frames !== transitionFrames) clamped += 1;
          return updateClip(next, id, {
            transitionIn: { type, frames },
          });
        }, current),
      {
        notice:
          clamped > 0
            ? `Transición aplicada; ${clamped} clip(s) se acotaron a su duración.`
            : `Transición aplicada a ${selectedClips.length} clip(s).`,
      },
    );
    if (ok) setAudit(null);
  }

  function removeTransition(): void {
    if (!project || selectedClips.length === 0) {
      setError('Elegí al menos un clip visual.');
      return;
    }
    setError(null);
    const ok = store.update(
      (current) =>
        selectedIds.reduce(
          (next, id) => updateClip(next, id, { transitionIn: {} }),
          current,
        ),
      { notice: 'Transición de entrada quitada.' },
    );
    if (ok) setAudit(null);
  }

  function loadQuickFromPrimary(): void {
    const effects = primary ? effectsOf(primary) : undefined;
    setQuick({
      brightness: effects?.brightness ?? 0,
      contrast: effects?.contrast ?? 1,
      saturation: effects?.saturation ?? 1,
      temperature: effects?.temperature ?? 0,
      vignette: effects?.vignette ?? 0,
      blur: effects?.blur ?? 0,
      sharpen: effects?.sharpen ?? 0,
      grayscale: effects?.grayscale ?? false,
      sepia: effects?.sepia ?? false,
    });
  }

  async function runAudit(): Promise<void> {
    if (!project) return;
    setBusy(true);
    setError(null);
    try {
      const result = await store.service.auditVisuals(project);
      setAudit(result);
      store.setNotice(
        result.findings.length === 0
          ? 'Auditoría visual sin hallazgos.'
          : `Auditoría visual: ${result.findings.length} hallazgo(s).`,
      );
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : 'no se pudo auditar el proyecto',
      );
    } finally {
      setBusy(false);
    }
  }

  function selectAll(): void {
    setSelectedIds(clips.map((clip) => clip.id));
    setAudit(null);
  }

  function selectNone(): void {
    setSelectedIds([]);
    setAudit(null);
  }

  if (!project) {
    return (
      <section className="view">
        <p className="empty-state">
          No hay un proyecto abierto. Creá o abrí uno para configurar efectos y transiciones.
        </p>
        <div className="actions">
          <button type="button" className="primary" onClick={() => onNavigate('projects')}>
            Ir a Proyectos
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="view visuals-view">
      <ViewToolbar
        label="Efectos y transiciones"
        actions={
          <>
            <button type="button" className="ghost" onClick={selectAll}>
              Todos
            </button>
            <button type="button" className="ghost" onClick={selectNone}>
              Ninguno
            </button>
            <button
              type="button"
              className="primary icon-text"
              onClick={() => void runAudit()}
              disabled={busy}
            >
              <Icon name="shield" size={14} />
              <span>{busy ? 'Auditando…' : 'Auditar'}</span>
            </button>
          </>
        }
      />

      <header className="compress-head">
        <div>
          <h2>El mismo look para varios clips, sin perder el control</h2>
          <p>
            Elegí clips visuales y aplicá un preset, ajustes rápidos o una transición.
            La auditoría revisa rangos, LUT, filtros de FFmpeg y transiciones antes del render.
          </p>
        </div>
      </header>

      {error ? (
        <p className="notice notice-warning" role="alert">
          {error}
        </p>
      ) : null}

      <div className="visuals-selection">
        <div className="visuals-selection-head">
          <strong>Clips visuales</strong>
          <span>
            {selectedClips.length} de {clips.length} seleccionados
            {measured ? ' · catálogo medido' : ' · catálogo local'}
          </span>
        </div>
        {clips.length === 0 ? (
          <p className="fine-print">
            La timeline no tiene clips visuales. Importá video o imágenes en Medios.
          </p>
        ) : (
          <div className="visuals-clips" role="group" aria-label="Clips visuales">
            {clips.map((clip) => {
              const transition = 'transitionIn' in clip ? clip.transitionIn : undefined;
              return (
                <label
                  key={clip.id}
                  className={`visuals-clip${selectedIds.includes(clip.id) ? ' active' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(clip.id)}
                    onChange={() => toggleClip(clip.id)}
                  />
                  <span>
                    <strong>{clipLabel(clip)}</strong>
                    <small>
                      {trackLabel(project, clip)} · {clipTime(clip, fps)}
                      {assetLabel(project.assets, clip)
                        ? ` · ${assetLabel(project.assets, clip)}`
                        : ''}
                      {' · '}
                      {Object.keys(effectsOf(clip) ?? {}).length} efectos
                    </small>
                  </span>
                  <em>{transition ? transition.type : 'sin transición'}</em>
                </label>
              );
            })}
          </div>
        )}
      </div>

      <div className="visuals-layout">
        <div className="visuals-main">
          <section className="card visuals-card">
            <div className="visuals-card-head">
              <div>
                <p className="eyebrow">Presets</p>
                <h3>Un look en un clic</h3>
              </div>
              <span className="fine-print">Conserva fades y LUT</span>
            </div>
            <div className="visuals-presets">
              {catalog.presets.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className="visuals-preset"
                  onClick={() => applyPreset(preset)}
                  disabled={selectedClips.length === 0}
                >
                  <strong>{preset.label}</strong>
                  <span>{preset.description}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="card visuals-card">
            <div className="visuals-card-head">
              <div>
                <p className="eyebrow">Ajuste rápido</p>
                <h3>Color y textura</h3>
              </div>
              <div className="actions compact">
                <button type="button" className="ghost" onClick={loadQuickFromPrimary} disabled={!primary}>
                  Cargar del primer clip
                </button>
                <button
                  type="button"
                  className="primary"
                  onClick={applyQuick}
                  disabled={selectedClips.length === 0}
                >
                  Aplicar
                </button>
              </div>
            </div>
            <div className="visuals-sliders">
              {(
                [
                  ['brightness', 'Brillo', -1, 1, 0.01],
                  ['contrast', 'Contraste', 0, 3, 0.01],
                  ['saturation', 'Saturación', 0, 3, 0.01],
                  ['temperature', 'Temperatura', -1, 1, 0.01],
                  ['vignette', 'Viñeta', 0, 1, 0.01],
                  ['blur', 'Desenfoque', 0, 20, 0.1],
                  ['sharpen', 'Nitidez', 0, 5, 0.1],
                ] as const
              ).map(([key, label, min, max, step]) => (
                <label className="visuals-slider" key={key}>
                  <span>
                    {label}
                    <output>{quick[key].toFixed(2)}</output>
                  </span>
                  <input
                    type="range"
                    min={min}
                    max={max}
                    step={step}
                    value={quick[key]}
                    onChange={(event) =>
                      setQuick((current) => ({
                        ...current,
                        [key]: Number(event.target.value),
                      }))
                    }
                  />
                </label>
              ))}
            </div>
            <div className="visuals-toggles">
              <label className="check">
                <input
                  type="checkbox"
                  checked={quick.grayscale}
                  onChange={(event) =>
                    setQuick((current) => ({ ...current, grayscale: event.target.checked }))
                  }
                />
                <span>Blanco y negro</span>
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={quick.sepia}
                  onChange={(event) =>
                    setQuick((current) => ({ ...current, sepia: event.target.checked }))
                  }
                />
                <span>Sepia</span>
              </label>
              <button
                type="button"
                className="ghost"
                onClick={() => setQuick(QUICK_DEFAULTS)}
              >
                Restablecer
              </button>
            </div>
          </section>

          <section className="card visuals-card">
            <div className="visuals-card-head">
              <div>
                <p className="eyebrow">Transición de entrada</p>
                <h3>Un corte que no se siente</h3>
              </div>
              <span className="fine-print">Máximo útil: 2 s</span>
            </div>
            <div className="visuals-transition-row">
              <label className="field">
                <span>Tipo</span>
                <select
                  value={transitionType}
                  onChange={(event) => {
                    const id = event.target.value;
                    setTransitionType(id);
                    const spec = catalog.transitions.find((item) => item.id === id);
                    if (spec) setTransitionFrames(spec.defaultFrames);
                  }}
                >
                  {catalog.transitions.map((item) => (
                    <option key={item.id} value={item.id} disabled={!item.available}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Frames</span>
                <input
                  type="number"
                  min={1}
                  max={transitionSpec?.maxFrames ?? 120}
                  value={transitionFrames}
                  onChange={(event) =>
                    setTransitionFrames(
                      Math.max(1, Math.min(120, Number(event.target.value) || 1)),
                    )
                  }
                />
              </label>
              <button
                type="button"
                className="primary"
                onClick={applyTransition}
                disabled={selectedClips.length === 0}
              >
                Aplicar
              </button>
              <button
                type="button"
                className="ghost"
                onClick={removeTransition}
                disabled={selectedClips.length === 0}
              >
                Quitar
              </button>
            </div>
            <p className="fine-print">{transitionSpec?.description ?? 'Sin transición.'}</p>
          </section>
        </div>

        <aside className="visuals-side">
          <section className="card visuals-card">
            <div className="visuals-card-head">
              <div>
                <p className="eyebrow">Catálogo</p>
                <h3>{availableEffects.length} efectos disponibles</h3>
              </div>
              <span className="fine-print">
                {catalog.ffmpegAvailable ? 'FFmpeg medido' : 'sin medición'}
              </span>
            </div>
            <div className="visuals-filters">
              {catalog.filters.map((filter) => (
                <span
                  key={filter.name}
                  className={`visuals-filter${filter.available ? ' ok' : ' missing'}`}
                  title={filter.label}
                >
                  {filter.name}
                </span>
              ))}
            </div>
            <ul className="visuals-effects">
              {catalog.effects.map((effect) => (
                <li key={effect.id} className={effect.available ? '' : 'missing'}>
                  <span>{effect.label}</span>
                  <em>{effect.category}</em>
                  {effect.available ? null : <strong>no disponible</strong>}
                </li>
              ))}
            </ul>
          </section>

          <section className="card visuals-card visuals-audit">
            <div className="visuals-card-head">
              <div>
                <p className="eyebrow">Preflight</p>
                <h3>{audit ? `${audit.findings.length} hallazgo(s)` : 'Sin auditar'}</h3>
              </div>
              <button type="button" className="ghost" onClick={() => void runAudit()} disabled={busy}>
                Revisar
              </button>
            </div>
            {audit ? (
              <>
                <p className="fine-print">
                  {audit.clipsScanned} clips · {audit.transitions} transiciones ·{' '}
                  {audit.effectsClips} con efectos.
                </p>
                {audit.findings.length === 0 ? (
                  <p className="fine-print">No hay problemas: el proyecto puede renderizar.</p>
                ) : (
                  <ul className="visuals-findings">
                    {audit.findings.map((finding, index) => (
                      <li key={`${finding.code}-${index}`} className={`severity-${finding.severity}`}>
                        <Icon name={severityIcon(finding.severity)} size={13} />
                        <span>
                          <strong>
                            {finding.clipLabel ?? finding.clipId ?? 'Proyecto'}
                          </strong>
                          {finding.message}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <p className="fine-print">
                Auditá para detectar transiciones inválidas, LUT fuera del proyecto o filtros
                que este FFmpeg no tiene.
              </p>
            )}
          </section>
        </aside>
      </div>
    </section>
  );
}
