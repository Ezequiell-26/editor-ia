import { useEffect, useState } from 'react';
import type { MixLoudnessReport } from '../../services/project-service';
import { useProjectStore } from '../../state/project-store';

/**
 * Monitor de loudness de la mezcla (ITU-R BS.1770-4 / EBU R128).
 *
 * Mide el proyecto guardado con el mismo grafo de audio del export (previo a
 * loudnorm) y muestra integrated, LRA, picos y el historial de momentary y
 * short-term. El delta contra el objetivo dice cuánto falta sin depender de la
 * normalización.
 */

const SCALE_MIN_LUFS = -60;
const SCALE_MAX_LUFS = 0;
const CHART_WIDTH = 600;
const CHART_HEIGHT = 120;

function lufsY(value: number): number {
  const clamped = Math.min(SCALE_MAX_LUFS, Math.max(SCALE_MIN_LUFS, value));
  const ratio = (clamped - SCALE_MAX_LUFS) / (SCALE_MIN_LUFS - SCALE_MAX_LUFS);
  return ratio * CHART_HEIGHT;
}

function polylinePoints(report: MixLoudnessReport, key: 'momentaryLufs' | 'shortTermLufs'): string {
  const last = report.samples[report.samples.length - 1];
  const span = Math.max(0.001, last ? last.seconds : report.durationSeconds);
  return report.samples
    .map((sample) => {
      const x = (sample.seconds / span) * CHART_WIDTH;
      return `${x.toFixed(1)},${lufsY(sample[key]).toFixed(1)}`;
    })
    .join(' ');
}

function signedDb(value: number): string {
  return `${value > 0 ? '+' : ''}${value.toFixed(1)} dB`;
}

function deltaTone(delta: number): 'ok' | 'warn' {
  return Math.abs(delta) <= 1 ? 'ok' : 'warn';
}

function deltaHint(delta: number, normalized: boolean): string {
  if (Math.abs(delta) <= 1) return 'La mezcla ya está en el objetivo.';
  if (delta > 0) {
    return normalized
      ? `La normalización subirá la mezcla ≈ ${delta.toFixed(1)} dB al exportar.`
      : `Subí el master ≈ ${delta.toFixed(1)} dB para llegar al objetivo.`;
  }
  return normalized
    ? `La normalización bajará la mezcla ≈ ${Math.abs(delta).toFixed(1)} dB al exportar.`
    : `Bajá el master ≈ ${Math.abs(delta).toFixed(1)} dB para llegar al objetivo.`;
}

export function LoudnessMonitor() {
  const store = useProjectStore();
  const project = store.state.project;
  const target = project?.audio?.loudnessTarget?.integratedLufs ?? null;
  const normalized = Boolean(project?.audio?.loudnessTarget);
  const [report, setReport] = useState<MixLoudnessReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!busy) return () => { active = false; };
    const subscription = store.service
      .onLoudnessAnalysisProgress((event) => {
        if (!active) return;
        setProgress(`Midiendo… ${Math.round(event.percent)} %`);
      })
      .then((unlisten) => {
        if (!active) void unlisten();
        return unlisten;
      });
    return () => {
      active = false;
      void subscription.then((unlisten) => unlisten());
    };
  }, [busy, store.service]);

  async function measure(): Promise<void> {
    if (busy) return;
    setError(null);
    setBusy(true);
    setProgress('Guardando…');
    try {
      const saved = await store.saveNow();
      if (!saved) {
        setError('Guardá el proyecto antes de medir la mezcla.');
        return;
      }
      setProgress('Midiendo…');
      const measured = await store.service.analyzeMixLoudness();
      setReport(measured);
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : 'la medición de loudness falló';
      setError(message);
    } finally {
      setBusy(false);
      setProgress('');
    }
  }

  return (
    <section className="loudness-monitor" aria-label="Monitor de loudness de la mezcla">
      <header className="loudness-head">
        <div>
          <h2>Loudness de la mezcla (EBU R128)</h2>
          <p>
            Mide el proyecto guardado con el grafo de audio del export, antes de la
            normalización.
            {target !== null ? ` Objetivo: ${target} LUFS.` : ' Sin objetivo configurado.'}
          </p>
        </div>
        <button
          type="button"
          className="primary"
          disabled={busy || !project}
          onClick={() => void measure()}
        >
          {busy ? progress || 'Midiendo…' : 'Medir loudness'}
        </button>
      </header>

      {error ? <p className="loudness-error" role="alert">{error}</p> : null}

      {report ? (
        <div className="loudness-body">
          <dl className="loudness-readouts">
            <div>
              <dt>Integrado</dt>
              <dd className="loudness-main">{report.integratedLufs.toFixed(1)} LUFS</dd>
            </div>
            <div>
              <dt>Rango (LRA)</dt>
              <dd>{report.loudnessRangeLu.toFixed(1)} LU</dd>
            </div>
            <div>
              <dt>Máx. momentary</dt>
              <dd>{report.maxMomentaryLufs.toFixed(1)} LUFS</dd>
            </div>
            <div>
              <dt>Máx. short-term</dt>
              <dd>{report.maxShortTermLufs.toFixed(1)} LUFS</dd>
            </div>
            <div>
              <dt>Pico digital</dt>
              <dd>{report.samplePeakDbfs.toFixed(1)} dBFS</dd>
            </div>
            <div>
              <dt>Pico real</dt>
              <dd>{report.truePeakDbtp.toFixed(1)} dBTP</dd>
            </div>
          </dl>

          {report.targetDeltaDb !== null && target !== null ? (
            <p className={`loudness-delta ${deltaTone(report.targetDeltaDb)}`}>
              <strong>{signedDb(report.targetDeltaDb)}</strong> vs objetivo {target} LUFS ·{' '}
              {deltaHint(report.targetDeltaDb, normalized)}
            </p>
          ) : null}

          <figure className="loudness-history" aria-label="Historial de loudness">
            <svg
              viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
              preserveAspectRatio="none"
              role="img"
            >
              {[-18, -30, -45].map((line) => (
                <line
                  key={line}
                  className="loudness-grid"
                  x1="0"
                  x2={CHART_WIDTH}
                  y1={lufsY(line)}
                  y2={lufsY(line)}
                />
              ))}
              {target !== null ? (
                <line
                  className="loudness-target-line"
                  x1="0"
                  x2={CHART_WIDTH}
                  y1={lufsY(target)}
                  y2={lufsY(target)}
                />
              ) : null}
              <polyline
                className="loudness-momentary"
                points={polylinePoints(report, 'momentaryLufs')}
              />
              <polyline
                className="loudness-short-term"
                points={polylinePoints(report, 'shortTermLufs')}
              />
            </svg>
            <figcaption>
              <span className="loudness-legend momentary">Momentary (400 ms)</span>
              <span className="loudness-legend short-term">Short-term (3 s)</span>
              <span className="loudness-legend scale">
                Escala {SCALE_MIN_LUFS} a {SCALE_MAX_LUFS} LUFS
              </span>
            </figcaption>
          </figure>
        </div>
      ) : (
        <p className="loudness-empty">
          Todavía no hay medición. El botón mide la mezcla completa del proyecto
          guardado.
        </p>
      )}
    </section>
  );
}
