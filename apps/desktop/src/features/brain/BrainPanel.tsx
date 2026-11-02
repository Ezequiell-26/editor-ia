import { useMemo, useState } from 'react';
import {
  applyProposal,
  applySafeProposals,
  planEdits,
  INTENT_PROFILES,
  type BeatGrid,
  type EditIntent,
  type EditProposal,
} from '../../state/brain';
import { detectBeats, decodeAudioSamples, planBeatCuts } from '../../state/beat-sync';
import { totalFrames } from '../../state/project-actions';
import { useProjectStore } from '../../state/project-store';

/**
 * Panel del cerebro de edición.
 *
 * Muestra lo que la app mide y lo que propone, con el motivo a la vista. El
 * usuario acepta o descarta; el asistente recibe el mismo plan como contexto.
 * La idea es que la edición se pueda discutir, no que ocurra sola.
 */

const INTENTS: readonly EditIntent[] = [
  'cleanup',
  'tighten',
  'short',
  'reel',
  'trailer',
  'tutorial',
  'vlog',
];

const RISK_LABEL: Record<EditProposal['risk'], string> = {
  safe: 'seguro',
  moderate: 'moderado',
  aggressive: 'agresivo',
};

function scoreTone(score: number): string {
  if (score >= 80) return 'ok';
  if (score >= 60) return 'warn';
  return 'bad';
}

export function BrainPanel() {
  const store = useProjectStore();
  const project = store.state.project;
  const [intent, setIntent] = useState<EditIntent>('tighten');
  const [dismissed, setDismissed] = useState<readonly string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [beats, setBeats] = useState<BeatGrid | null>(null);
  const [beatBusy, setBeatBusy] = useState(false);

  const plan = useMemo(
    () =>
      project
        ? planEdits(project, { intent, ...(beats ? { beats } : {}) })
        : null,
    [project, intent, beats],
  );

  if (!project || !plan) {
    return (
      <section className="view brain-view">
        <header className="view-toolbar">
          <div>
            <h1>Cerebro de edición</h1>
            <p>Mide la timeline y propone cortes con motivo. No hay proyecto abierto.</p>
          </div>
        </header>
        <div className="empty-state">
          <h2>Abrí un proyecto para analizarlo</h2>
        </div>
      </section>
    );
  }

  const visible = plan.proposals.filter((proposal) => !dismissed.includes(proposal.id));
  const autoCount = visible.filter((proposal) => proposal.payload).length;

  function applyOne(proposal: EditProposal): void {
    const current = store.state.project;
    if (!current) return;
    const result = applyProposal(current, proposal);
    if (result.applied) {
      store.update(() => result.project);
      setNotice(result.message);
    } else {
      setNotice(result.message);
    }
  }

  function applyAllSafe(): void {
    const current = store.state.project;
    if (!current) return;
    const outcome = applySafeProposals(current, plan!);
    if (outcome.applied.length > 0) store.update(() => outcome.project);
    setNotice(
      outcome.applied.length > 0
        ? `${outcome.summary} ${outcome.skipped.map((entry) => entry.reason).join(' ')}`.trim()
        : outcome.summary,
    );
  }

  /**
   * Detecta la grilla de beats sobre el audio del proyecto y la mapea a frames.
   *
   * Se prefiere un clip de audio de la timeline porque su ventana de origen y su
   * velocidad definen dónde suena cada pulso. Si sólo hay música de fondo, los
   * beats se cuentan desde el frame 0.
   */
  async function detectGrid(): Promise<void> {
    const current = store.state.project;
    if (!current) return;
    const fps = current.video.frameRate.num / Math.max(1, current.video.frameRate.den);
    const audioClip = current.timeline.clips.find(
      (clip) => clip.kind === 'audio' && clip.source.type === 'asset',
    );
    const assetId =
      audioClip?.source.type === 'asset' ? audioClip.source.assetId : current.audio.music?.assetId;
    const asset = assetId ? current.assets.find((item) => item.id === assetId) : undefined;
    if (!asset) {
      setNotice('No hay audio en el proyecto: sumá música o una pista de voz para medir el pulso.');
      return;
    }
    setBeatBusy(true);
    setNotice(null);
    try {
      const root = store.state.opened?.root ?? '';
      const url = store.service.mediaUrl(root, asset.source.path);
      const decoded = await decodeAudioSamples(url);
      if (!decoded) {
        setNotice('No se pudo decodificar el audio del proyecto.');
        return;
      }
      const analysis = detectBeats(decoded.samples, decoded.sampleRate);
      if (analysis.beatsSeconds.length === 0 || analysis.confidence < 0.4) {
        setBeats(null);
        setNotice('Pulso poco claro: no se corta en beat para no inventar una grilla.');
        return;
      }
      let frames: number[];
      if (audioClip && audioClip.source.type === 'asset' && 'inFrame' in audioClip.source) {
        const speed =
          'speed' in audioClip && audioClip.speed
            ? audioClip.speed.num / Math.max(1, audioClip.speed.den)
            : 1;
        frames = planBeatCuts({
          beatsSeconds: analysis.beatsSeconds,
          fps,
          audioInFrame: audioClip.source.inFrame,
          audioOutFrame: audioClip.source.outFrame,
          audioStartFrame: audioClip.startFrame,
          speed,
          stride: 1,
          targetStartFrame: 0,
          targetEndFrame: totalFrames(current),
        });
      } else {
        frames = analysis.beatsSeconds.map((seconds) => Math.round(seconds * fps));
      }
      if (frames.length < 3) {
        setBeats(null);
        setNotice('Los pulsos detectados no caen dentro de la timeline.');
        return;
      }
      setBeats({ bpm: analysis.bpm, confidence: analysis.confidence, beatsFrames: frames });
      setNotice(
        `Grilla: ${Math.round(analysis.bpm)} BPM · ${frames.length} beats · confianza ${Math.round(analysis.confidence * 100)} %.`,
      );
    } finally {
      setBeatBusy(false);
    }
  }

  return (
    <section className="view brain-view">
      <header className="view-toolbar">
        <div>
          <h1>Cerebro de edición</h1>
          <p>
            La app mide la timeline, encuentra problemas y propone ediciones concretas. El
            asistente recibe este mismo plan como contexto.
          </p>
        </div>
        <div className="brain-controls">
          <label className="field">
            <span>Formato</span>
            <select value={intent} onChange={(event) => setIntent(event.target.value as EditIntent)}>
              {INTENTS.map((id) => (
                <option key={id} value={id}>
                  {INTENT_PROFILES[id].label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="small"
            disabled={beatBusy}
            aria-pressed={Boolean(beats)}
            onClick={() => void detectGrid()}
          >
            {beatBusy ? 'Midiendo…' : beats ? 'Re-medir beats' : 'Detectar beats'}
          </button>
          {beats ? (
            <button type="button" className="small ghost" onClick={() => setBeats(null)}>
              Quitar grilla
            </button>
          ) : null}
          <button
            type="button"
            className="primary"
            disabled={autoCount === 0}
            onClick={applyAllSafe}
          >
            Aplicar lo seguro ({autoCount})
          </button>
        </div>
      </header>

      <div className="brain-score">
        <div className={`brain-score-value ${scoreTone(plan.score.now)}`}>
          <strong>{plan.score.now}</strong>
          <span>/100</span>
        </div>
        <div className="brain-score-detail">
          <p>
            Potencial con las propuestas aplicadas: <strong>{plan.score.potential}</strong>
          </p>
          <p className="fine-print">
            {plan.profile.label} · plano medio objetivo {plan.profile.aslSeconds || '—'} s ·{' '}
            {plan.profile.captionsRequired ? 'subtítulos obligatorios' : 'subtítulos opcionales'}
          </p>
        </div>
      </div>

      <div className="brain-metrics">
        {plan.metrics.map((metric) => (
          <article key={metric.id} className={`brain-metric ${metric.status}`}>
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
            {metric.target ? <em>objetivo {metric.target}</em> : null}
          </article>
        ))}
      </div>

      {plan.findings.length > 0 ? (
        <ul className="brain-findings">
          {plan.findings.map((finding) => (
            <li key={finding.id} className={finding.severity}>
              <strong>{finding.title}</strong>
              <span>{finding.detail}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="brain-empty">No hay problemas medibles en esta timeline.</p>
      )}

      {plan.script.length > 0 ? (
        <ul className="brain-script" aria-label="Guion medido">
          {plan.script.map((scene) => (
            <li key={scene.sceneId} className={scene.clipCount === 0 ? 'warn' : undefined}>
              <span className="brain-script-order">{String(scene.order + 1).padStart(2, '0')}</span>
              <strong>{scene.title}</strong>
              <span>{scene.clipCount} clip(s)</span>
              <span>
                {scene.narrationWords} palabras
                {scene.narrationSeconds > 0 ? ` · ${scene.narrationSeconds} s` : ''}
              </span>
              <span className={`brain-badge ${scene.status === 'draft' ? 'moderate' : 'safe'}`}>
                {scene.status}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <ol className="brain-proposals">        {visible.map((proposal, index) => (
          <li key={proposal.id} className={`brain-proposal ${proposal.risk}`}>
            <header>
              <span className="brain-proposal-index">{String(index + 1).padStart(2, '0')}</span>
              <strong>{proposal.title}</strong>
              <span className={`brain-badge ${proposal.risk}`}>{RISK_LABEL[proposal.risk]}</span>
              <span className="brain-confidence">
                confianza {Math.round(proposal.confidence * 100)} %
              </span>
            </header>
            <p>{proposal.reason}</p>
            <p className="brain-preview">{proposal.preview}</p>
            <div className="brain-actions">
              {proposal.payload ? (
                <button type="button" className="small" onClick={() => applyOne(proposal)}>
                  Aplicar
                </button>
              ) : (
                <span className="brain-manual">Requiere tu intervención</span>
              )}
              <button
                type="button"
                className="small ghost"
                onClick={() => setDismissed((current) => [...current, proposal.id])}
              >
                Descartar
              </button>
            </div>
          </li>
        ))}
      </ol>

      {visible.length === 0 ? (
        <p className="brain-empty">Sin propuestas pendientes para este formato.</p>
      ) : null}
      {notice ? <p className="brain-notice">{notice}</p> : null}
    </section>
  );
}
