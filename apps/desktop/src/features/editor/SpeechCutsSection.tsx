import { useEffect, useState } from 'react';
import type { Clip } from '@editor-ia/project-schema';
import {
  applySpeechCuts,
  cuesForClip,
  planSpeechCutsFromCues,
  type SpeechCutPlan,
} from '../../state/speech-cuts';
import { fpsOf } from '../../state/project-actions';
import { useProjectStore } from '../../state/project-store';
import { InspectorSection } from './InspectorSection';
import { OptionField } from '../../components/ui/OptionField';
import { clipDisplayName, clipSpeedFactor } from './clip-display';

/**
 * Sección del Inspector para cortar por pausas de voz.
 *
 * A diferencia del detector de silencios (amplitud), éste usa los tiempos de
 * los subtítulos: corta entre frases, no en cada respiración. La fuente es la
 * pista de subtítulos del proyecto, así que el primer paso es generarlos
 * (Inspector → Audio → Transcribir, o «subtitulá el clip» en el asistente).
 */

interface ClipPlan {
  readonly clipId: string;
  readonly label: string;
  readonly plan: SpeechCutPlan;
}

interface Analysis {
  readonly plans: readonly ClipPlan[];
  readonly analyzedSeconds: number;
  /** Clips sin subtítulos que cubran su ventana. */
  readonly withoutCues: number;
}

export function SpeechCutsSection(props: {
  readonly clips: readonly Clip[];
  readonly title?: string;
  readonly group?: 'audio';
}) {
  const store = useProjectStore();
  const project = store.state.project;
  const [minPauseSeconds, setMinPauseSeconds] = useState(0.35);
  const [paddingSeconds, setPaddingSeconds] = useState(0.08);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const clipKey = props.clips.map((clip) => clip.id).join(',');
  useEffect(() => {
    setAnalysis(null);
    setConfirming(false);
    setInfo(null);
  }, [clipKey, minPauseSeconds, paddingSeconds]);

  const fps = project ? fpsOf(project) : 0;
  const candidates = props.clips.filter(
    (clip) =>
      (clip.kind === 'video' || clip.kind === 'audio') &&
      clip.source.type === 'asset' &&
      Math.abs(clipSpeedFactor(clip) - 1) < 0.001,
  );
  const lockedCount = project
    ? candidates.filter(
        (clip) =>
          project.timeline.tracks.find((item) => item.id === clip.trackId)?.locked === true,
      ).length
    : 0;

  const plans = analysis?.plans ?? [];
  const totalPauses = plans.reduce((sum, item) => sum + item.plan.pauses, 0);
  const totalRemoved = plans.reduce((sum, item) => sum + item.plan.removedSeconds, 0);
  const excessive = plans.filter((item) => item.plan.excessive);
  const percent =
    analysis && analysis.analyzedSeconds > 0
      ? Math.round((totalRemoved / analysis.analyzedSeconds) * 100)
      : 0;
  const canApply =
    analysis !== null && plans.length > 0 && excessive.length === 0 && lockedCount === 0;

  function analyze(): void {
    if (!project || fps <= 0) return;
    setInfo(null);
    setConfirming(false);
    const found: ClipPlan[] = [];
    let analyzedSeconds = 0;
    let withoutCues = 0;
    for (const clip of candidates) {
      const cues = cuesForClip(project, clip.id);
      if (cues.length === 0) {
        withoutCues += 1;
        continue;
      }
      analyzedSeconds += clip.durationFrames / fps;
      const plan = planSpeechCutsFromCues(cues, clip, fps, {
        minPauseSeconds,
        paddingSeconds,
      });
      if (plan) found.push({ clipId: clip.id, label: clipDisplayName(clip), plan });
    }
    setAnalysis({ plans: found, analyzedSeconds, withoutCues });
    if (found.length === 0) {
      setInfo(
        withoutCues > 0
          ? 'Los clips no tienen subtítulos: generá los subtítulos primero y volvé a analizar.'
          : 'No hay pausas entre frases con este mínimo.',
      );
    }
  }

  function apply(): void {
    if (!analysis) return;
    const options = { minPauseSeconds, paddingSeconds };
    let touched = 0;
    let removed = 0;
    let pauses = 0;
    const ok = store.update((current) => {
      let next = current;
      for (const item of analysis.plans) {
        // Se rearma contra el proyecto vigente: el ripple de un clip corre a
        // los siguientes y mueve sus subtítulos.
        const clip = next.timeline.clips.find((entry) => entry.id === item.clipId);
        if (!clip) continue;
        const fresh = planSpeechCutsFromCues(
          cuesForClip(next, item.clipId),
          clip,
          fpsOf(next),
          options,
        );
        if (!fresh || fresh.excessive) continue;
        const after = applySpeechCuts(next, item.clipId, fresh);
        if (after !== next) {
          touched += 1;
          removed += fresh.removedSeconds;
          pauses += fresh.pauses;
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
          ? `Pausas recortadas: ${pauses} en ${touched} clip(s), ${removed.toFixed(2)} s menos. Deshacelo con Ctrl+Z.`
          : 'No se recortó nada: las pausas quedaron fuera de los clips.',
      );
    }
  }

  return (
    <InspectorSection
      title={props.title ?? 'Cortar pausas de voz'}
      group={props.group}
      className="speech-cuts"
    >
      <p className="fine-print">
        Usa los tiempos de los subtítulos para cortar entre frases y eliminar el aire, sin tocar
        las respiraciones internas. Necesita subtítulos generados en este clip.
      </p>
      <div className="inspector-grid">
        <OptionField
          label="Pausa mínima (s)"
          value={minPauseSeconds}
          min={0.1}
          max={3}
          step={0.05}
          onCommit={setMinPauseSeconds}
        />
        <OptionField
          label="Aire conservado (s)"
          value={paddingSeconds}
          min={0}
          max={0.5}
          step={0.01}
          onCommit={setPaddingSeconds}
        />
      </div>
      {candidates.length === 0 ? (
        <p className="fine-print">
          {props.clips.length === 0
            ? 'Esta pista no tiene clips con audio para analizar.'
            : 'Ningún clip con audio a velocidad 1×.'}
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
          onClick={analyze}
          disabled={fps <= 0 || candidates.length === 0}
        >
          {analysis ? 'Reanalizar pausas' : 'Analizar pausas'}
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
              Confirmar: quitar {totalRemoved.toFixed(2)} s
            </button>
            <button type="button" className="small ghost" onClick={() => setConfirming(false)}>
              Cancelar
            </button>
          </>
        )}
      </div>
      {analysis && plans.length > 0 ? (
        <div data-testid="speech-plan">
          <p className="inspector-meta">
            Vista previa: {totalPauses} pausa(s) en {plans.length} clip(s) · se quitarían ≈{' '}
            {totalRemoved.toFixed(2)} s ({percent}% del material analizado)
          </p>
          <ul className="keyframe-list">
            {plans.map((item) => (
              <li key={item.clipId} className="fine-print">
                {item.label}: {item.plan.pauses} pausa(s) ·{' '}
                {item.plan.removedSeconds.toFixed(2)} s
                {item.plan.excessive ? ' · excede el 60%' : ''}
              </li>
            ))}
          </ul>
          {excessive.length > 0 ? (
            <p className="notice notice-warning" role="alert">
              Este plan quitaría más del 60% de {excessive.length} clip(s): subí la pausa mínima
              o el aire conservado y reanalizá.
            </p>
          ) : null}
        </div>
      ) : (
        <p className="fine-print">
          {info ??
            (analysis && analysis.withoutCues > 0
              ? `${analysis.withoutCues} clip(s) sin subtítulos: generá los subtítulos para poder cortar por voz.`
              : 'Analizá para ver cuánto aire se quitaría antes de aplicar.')}
        </p>
      )}
    </InspectorSection>
  );
}
