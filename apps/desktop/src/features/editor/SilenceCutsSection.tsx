import { useEffect, useState } from 'react';
import type { Clip } from '@editor-ia/project-schema';
import type { AudioPeaks } from '../../services/project-service';
import {
  applySilenceCuts,
  planSilenceCutsForProject,
  type SilenceCutPlan,
} from '../../state/silence-cuts';
import { fpsOf } from '../../state/project-actions';
import { useProjectStore } from '../../state/project-store';

/**
 * Sección del Inspector para "cortar silencios": expone el motor de
 * `state/silence-cuts` con umbral, silencio mínimo y colchón configurables.
 * Analiza los picos que mide FFmpeg, muestra una vista previa de cuánto se
 * recortaría y pide confirmación antes de aplicar. Sin lógica propia: sólo
 * llama a `planSilenceCutsForProject` + `applySilenceCuts`, que ya traen la
 * guardia anti-borrado masivo (>80% de un clip) y aplican por split + ripple.
 */

interface ClipPlan {
  readonly clipId: string;
  readonly label: string;
  readonly plan: SilenceCutPlan;
  /** Picos del asset: permiten rearmar el plan al aplicar (ver `apply`). */
  readonly peaks: AudioPeaks;
}

interface SilenceAnalysis {
  readonly plans: readonly ClipPlan[];
  /** Segundos de material analizado (clips con picos medidos), para el %. */
  readonly analyzedSeconds: number;
}

function speedFactorOf(clip: Clip): number {
  const speed = 'speed' in clip ? clip.speed : undefined;
  if (!speed) return 1;
  return speed.num / Math.max(1, speed.den);
}

function clipLabel(clip: Clip): string {
  return clip.label ?? 'sin nombre';
}

function OptionField({
  label,
  value,
  min,
  max,
  step,
  onCommit,
}: {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => {
    setDraft(String(value));
  }, [value]);
  function commit(): void {
    const numeric = Number(draft);
    if (Number.isFinite(numeric)) {
      onCommit(Math.max(min, Math.min(max, numeric)));
    } else {
      setDraft(String(value));
    }
  }
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        value={draft}
        min={min}
        max={max}
        step={step}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
          }
        }}
      />
    </label>
  );
}

export function SilenceCutsSection(props: {
  readonly clips: readonly Clip[];
  readonly title?: string;
  readonly group?: 'audio';
}) {
  const store = useProjectStore();
  const project = store.state.project;
  const [thresholdDb, setThresholdDb] = useState(-45);
  const [minSilenceSeconds, setMinSilenceSeconds] = useState(0.35);
  const [paddingSeconds, setPaddingSeconds] = useState(0.15);
  const [analysis, setAnalysis] = useState<SilenceAnalysis | null>(null);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const clipKey = props.clips.map((clip) => clip.id).join(',');
  // Cambiar parámetros o de clip invalida la vista previa: el plan viejo ya
  // no representa lo que se recortaría.
  useEffect(() => {
    setAnalysis(null);
    setConfirming(false);
    setInfo(null);
  }, [clipKey, thresholdDb, minSilenceSeconds, paddingSeconds]);

  const fps = project ? fpsOf(project) : 0;
  // Sólo clips con audio medible: video y audio montados de un asset. Los
  // compuestos no se dividen y a otra velocidad el mapeo de frames no aplica.
  const candidates = props.clips.filter(
    (clip) =>
      (clip.kind === 'video' || clip.kind === 'audio') && clip.source.type === 'asset',
  );
  const slowClips = candidates.filter((clip) => Math.abs(speedFactorOf(clip) - 1) > 0.001);
  const targets = candidates.filter((clip) => !slowClips.includes(clip));
  const lockedCount = project
    ? targets.filter(
        (clip) =>
          project.timeline.tracks.find((item) => item.id === clip.trackId)?.locked === true,
      ).length
    : 0;

  const plans = analysis?.plans ?? [];
  const totalRemoved = plans.reduce((sum, item) => sum + item.plan.removedSeconds, 0);
  const totalSpans = plans.reduce((sum, item) => sum + item.plan.spans.length, 0);
  const excessive = plans.filter((item) => item.plan.excessive);
  const percent =
    analysis && analysis.analyzedSeconds > 0
      ? Math.round((totalRemoved / analysis.analyzedSeconds) * 100)
      : 0;
  const canApply =
    analysis !== null && plans.length > 0 && excessive.length === 0 && lockedCount === 0;

  async function analyze(): Promise<void> {
    if (!project || fps <= 0 || busy || targets.length === 0) return;
    setBusy(true);
    setInfo(null);
    setConfirming(false);
    try {
      const peaksCache = new Map<string, AudioPeaks | null>();
      const found: ClipPlan[] = [];
      let analyzedSeconds = 0;
      for (const clip of targets) {
        if (clip.source.type !== 'asset') continue;
        let peaks = peaksCache.get(clip.source.assetId);
        if (peaks === undefined) {
          try {
            peaks = await store.service.audioPeaks(clip.source.assetId);
          } catch {
            peaks = null;
          }
          peaksCache.set(clip.source.assetId, peaks);
        }
        if (!peaks) continue;
        analyzedSeconds += clip.durationFrames / fps;
        const plan = planSilenceCutsForProject(project, clip.id, peaks, {
          thresholdDb,
          minSilenceSeconds,
          paddingSeconds,
        });
        if (plan) found.push({ clipId: clip.id, label: clipLabel(clip), plan, peaks });
      }
      setAnalysis({ plans: found, analyzedSeconds });
      if (found.length === 0) {
        setInfo('No hay silencios que recortar con estos parámetros.');
      }
    } finally {
      setBusy(false);
    }
  }

  function apply(): void {
    if (!analysis) return;
    const options = { thresholdDb, minSilenceSeconds, paddingSeconds };
    let touched = 0;
    let removedSeconds = 0;
    const ok = store.update((current) => {
      let next = current;
      for (const item of analysis.plans) {
        if (item.plan.excessive) continue;
        // Se rearma el plan contra el proyecto ACTUAL: el ripple de un clip
        // anterior corre a los siguientes de la misma pista y un plan viejo
        // cortaría en frames equivocados.
        const fresh = planSilenceCutsForProject(next, item.clipId, item.peaks, options);
        if (!fresh || fresh.excessive) continue;
        const after = applySilenceCuts(next, item.clipId, fresh);
        if (after !== next) {
          touched += 1;
          removedSeconds += fresh.removedSeconds;
        }
        next = after;
      }
      return next;
    });
    setAnalysis(null);
    setConfirming(false);
    if (ok) {
      store.setNotice(
        touched > 0
          ? `Silencios recortados en ${touched} clip(s): ${removedSeconds.toFixed(2)} s menos. Deshacelo con Ctrl+Z.`
          : 'No se recortó nada: los silencios quedaron fuera de los clips.',
      );
    }
  }

  return (
    <section className="inspector-section silence-cuts" data-group={props.group}>
      <h4>{props.title ?? 'Cortar silencios'}</h4>
      <p className="fine-print">
        Detecta los tramos bajo el umbral con los picos que mide FFmpeg, muestra cuánto
        recortaría y aplica dividiendo el clip y corriendo el resto (ripple). Nunca borra
        más del 80% de un clip.
      </p>
      <div className="inspector-grid">
        <OptionField
          label="Umbral (dBFS)"
          value={thresholdDb}
          min={-90}
          max={-10}
          step={1}
          onCommit={setThresholdDb}
        />
        <OptionField
          label="Silencio mínimo (s)"
          value={minSilenceSeconds}
          min={0.05}
          max={5}
          step={0.05}
          onCommit={setMinSilenceSeconds}
        />
        <OptionField
          label="Colchón (s)"
          value={paddingSeconds}
          min={0}
          max={2}
          step={0.05}
          onCommit={setPaddingSeconds}
        />
      </div>
      {slowClips.length > 0 ? (
        <p className="fine-print">
          Se omiten clip(s) con velocidad distinta de 1× ({slowClips.map(clipLabel).join(', ')}).
        </p>
      ) : null}
      {targets.length === 0 ? (
        <p className="fine-print">
          {props.clips.length === 0
            ? 'Esta pista no tiene clips con audio para analizar.'
            : 'Ningún clip tiene audio medible a velocidad 1×.'}
        </p>
      ) : null}
      {lockedCount > 0 ? (
        <p className="fine-print">
          La pista de {lockedCount} clip(s) está bloqueada: desbloqueala para aplicar.
        </p>
      ) : null}
      <div className="actions compact">
        <button
          type="button"
          className="small"
          onClick={() => void analyze()}
          disabled={busy || fps <= 0 || targets.length === 0}
        >
          {busy ? 'Analizando…' : analysis ? 'Reanalizar' : 'Analizar silencios'}
        </button>
        {!confirming ? (
          <button
            type="button"
            className="small danger-ghost"
            disabled={!canApply}
            onClick={() => setConfirming(true)}
          >
            Aplicar cortes
          </button>
        ) : (
          <>
            <button type="button" className="small danger-ghost" onClick={apply}>
              Confirmar: eliminar {totalRemoved.toFixed(2)} s
            </button>
            <button type="button" className="small ghost" onClick={() => setConfirming(false)}>
              Cancelar
            </button>
          </>
        )}
      </div>
      {analysis && plans.length > 0 ? (
        <div data-testid="silence-plan">
          <p className="inspector-meta">
            Vista previa: {totalSpans} silencio(s) en {plans.length} clip(s) · se recortarían ≈{' '}
            {totalRemoved.toFixed(2)} s ({percent}% del material analizado)
          </p>
          <ul className="keyframe-list">
            {plans.map((item) => (
              <li key={item.clipId} className="fine-print">
                {item.label}: {item.plan.spans.length} silencio(s) ·{' '}
                {item.plan.removedSeconds.toFixed(2)} s
                {item.plan.excessive ? ' · excede el 80%' : ''}
              </li>
            ))}
          </ul>
          {excessive.length > 0 ? (
            <p className="notice notice-warning" role="alert">
              Este plan eliminaría más del 80% de {excessive.length} clip(s): ajustá el umbral
              o el colchón y reanalizá antes de aplicar.
            </p>
          ) : null}
        </div>
      ) : (
        <p className="fine-print">
          {info ?? 'Analizá los picos para ver cuánto se recortaría antes de aplicar.'}
        </p>
      )}
    </section>
  );
}
