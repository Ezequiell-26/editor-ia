import { useState } from 'react';
import type { Track } from '@editor-ia/project-schema';
import type { ViewId } from '../../app/navigation';
import { Icon } from '../../components/Icon';
import {
  effectivePeakDb,
  gainForTargetPeak,
  levelPercentFromDb,
  panLabel,
  peakDbFromPeaks,
  trackEqDb,
  trackGainDb,
  trackPan,
} from '../../state/audio-mix';
import { updateAudioMix, updateTrack } from '../../state/project-actions';
import { useProjectStore } from '../../state/project-store';
import { LoudnessMonitor } from './LoudnessMonitor';

export interface MixerViewProps {
  readonly onNavigate: (view: ViewId) => void;
}

const AUDIO_KINDS: ReadonlySet<Track['kind']> = new Set(['video', 'audio', 'narration']);

function kindLabel(track: Track): string {
  if (track.kind === 'narration') return 'Voz';
  if (track.kind === 'audio') return 'Audio';
  return 'Video';
}

function formatDb(value: number): string {
  return `${value > 0 ? '+' : ''}${value.toFixed(1)} dB`;
}

export function MixerView({ onNavigate }: MixerViewProps) {
  const store = useProjectStore();
  const project = store.state.project;
  const [levels, setLevels] = useState<Record<string, number>>({});
  const [measureBusy, setMeasureBusy] = useState(false);
  const [measureProgress, setMeasureProgress] = useState('');
  const [measureError, setMeasureError] = useState<string | null>(null);

  if (!project) {
    return (
      <section className="view mixer-view">
        <header className="view-toolbar">
          <div>
            <h1>Mezcla de audio</h1>
            <p>Ganancia, paneo y EQ de 3 bandas por pista, solo, mute y master.</p>
          </div>
        </header>
        <div className="empty-state">
          <Icon name="audio" size={28} />
          <h2>No hay un proyecto abierto</h2>
          <p>Abrí o creá un proyecto para mezclar sus pistas.</p>
          <button type="button" className="primary" onClick={() => onNavigate('projects')}>
            Ir a Proyectos
          </button>
        </div>
      </section>
    );
  }

  const tracks = project.timeline.tracks
    .filter((track) => AUDIO_KINDS.has(track.kind))
    .sort((left, right) => left.order - right.order);
  const soloCount = tracks.filter((track) => track.solo === true && !track.muted).length;
  const master = project.audio.master;
  const loudness = project.audio.loudnessTarget;
  const ducking = project.audio.ducking;
  const targetPeakDb = -6;

  async function measureLevels(): Promise<void> {
    if (measureBusy) return;
    const current = project;
    if (!current) return;
    setMeasureBusy(true);
    setMeasureError(null);
    const cache = new Map<string, number | null>();
    const next: Record<string, number> = {};
    let failures = 0;
    let done = 0;
    const pendingAssets = new Set<string>();
    for (const track of tracks) {
      for (const clip of current.timeline.clips) {
        if (clip.trackId !== track.id || clip.source.type !== 'asset') continue;
        const assetId = clip.source.assetId;
        const asset = current.assets.find((item) => item.id === assetId);
        if (asset?.status === 'ready' && (asset.kind === 'video' || asset.kind === 'audio')) {
          pendingAssets.add(asset.id);
        }
      }
    }
    try {
      for (const track of tracks) {
        let peak: number | null = null;
        for (const clip of current.timeline.clips) {
          if (clip.trackId !== track.id || clip.enabled === false) continue;
          if (clip.source.type !== 'asset') continue;
          const assetId = clip.source.assetId;
          const asset = current.assets.find((item) => item.id === assetId);
          if (!asset || asset.status !== 'ready') continue;
          if (asset.kind !== 'video' && asset.kind !== 'audio') continue;
          let assetPeak: number | null;
          if (cache.has(asset.id)) {
            assetPeak = cache.get(asset.id) ?? null;
          } else {
            try {
              assetPeak = peakDbFromPeaks(await store.service.audioPeaks(asset.id, 400));
            } catch {
              assetPeak = null;
              failures += 1;
            }
            cache.set(asset.id, assetPeak);
            done += 1;
            setMeasureProgress(`Midiendo ${done}/${pendingAssets.size}`);
          }
          if (assetPeak === null) continue;
          const withClipGain = assetPeak + (clip.audio?.gainDb ?? 0);
          peak = peak === null ? withClipGain : Math.max(peak, withClipGain);
        }
        if (peak !== null) next[track.id] = peak;
      }
      setLevels(next);
      if (Object.keys(next).length === 0) {
        setMeasureError(
          failures > 0
            ? 'No se pudo leer el audio de los clips. Revisá que los archivos existan y tengan sonido.'
            : 'No hay clips con audio para medir en este proyecto.',
        );
      }
    } finally {
      setMeasureBusy(false);
      setMeasureProgress('');
    }
  }

  return (
    <section className="view mixer-view">
      <header className="view-toolbar mixer-toolbar">
        <div>
          <h1>Mezcla de audio</h1>
          <p>
            Ganancia por pista, solo, mute y master. Se aplica a la preview y al render final.
          </p>
        </div>
        <div className="mixer-actions">
          <span className={`mixer-solo-summary${soloCount > 0 ? ' active' : ''}`}>
            {soloCount === 0
              ? 'Sin solo'
              : `${soloCount} ${soloCount === 1 ? 'pista en solo' : 'pistas en solo'}`}
          </span>
          <button
            type="button"
            className="small icon-text"
            disabled={measureBusy}
            onClick={() => void measureLevels()}
            title="Mide con FFmpeg el pico de cada clip y lo muestra en dBFS"
          >
            <Icon name="audio" size={14} />
            <span>{measureBusy ? measureProgress || 'Midiendo…' : 'Medir picos'}</span>
          </button>
          <button type="button" className="small icon-text" onClick={() => onNavigate('editor')}>
            <Icon name="editor" size={14} />
            <span>Volver al editor</span>
          </button>
        </div>
      </header>

      <div className="mixer-board">
        {tracks.length === 0 ? (
          <div className="mixer-empty">
            <Icon name="audio" size={22} />
            <p>Todavía no hay pistas con audio. Agregá una pista o separá el audio de un clip.</p>
            <button type="button" className="small" onClick={() => onNavigate('editor')}>
              Abrir el editor
            </button>
          </div>
        ) : (
          tracks.map((track, index) => {
            const clips = project.timeline.clips.filter((clip) => clip.trackId === track.id);
            const gain = trackGainDb(track);
            const measuredPeak = levels[track.id];
            const withFader =
              measuredPeak !== undefined ? effectivePeakDb(measuredPeak, gain) : null;
            return (
              <article className="mixer-strip" key={track.id}>
                <div className="mixer-strip-head">
                  <span className="mixer-index">{String(index + 1).padStart(2, '0')}</span>
                  <strong>{track.label}</strong>
                  <span className="mixer-channel-kind">{kindLabel(track)}</span>
                </div>
                <small className="mixer-clip-count">
                  {clips.length} {clips.length === 1 ? 'clip' : 'clips'}
                </small>
                <div className="mixer-fader-wrap">
                  <input
                    type="range"
                    className="mixer-fader"
                    aria-label={`Ganancia de ${track.label}`}
                    min={-60}
                    max={12}
                    step={0.5}
                    value={gain}
                    onChange={(event) =>
                      store.update((current) =>
                        updateTrack(current, track.id, { gainDb: Number(event.target.value) }),
                      )
                    }
                  />
                  <span className="mixer-db">{formatDb(gain)}</span>
                </div>
                <div className="mixer-pan-wrap">
                  <span className="mixer-control-label">Paneo</span>
                  <input
                    type="range"
                    className="mixer-pan"
                    aria-label={`Paneo de ${track.label}`}
                    min={-1}
                    max={1}
                    step={0.05}
                    value={trackPan(track)}
                    onChange={(event) =>
                      store.update((current) =>
                        updateTrack(current, track.id, { pan: Number(event.target.value) }),
                      )
                    }
                  />
                  <span className="mixer-pan-value">{panLabel(trackPan(track))}</span>
                </div>
                <div className="mixer-eq" role="group" aria-label={`EQ de ${track.label}`}>
                  {(
                    [
                      ['eqLowDb', 'Bajos', '120 Hz'],
                      ['eqMidDb', 'Medios', '1 kHz'],
                      ['eqHighDb', 'Agudos', '8 kHz'],
                    ] as const
                  ).map(([band, label, frequency]) => (
                    <label className="mixer-eq-row" key={band} title={`${label} · ${frequency}`}>
                      <span>{label}</span>
                      <input
                        type="range"
                        min={-12}
                        max={12}
                        step={0.5}
                        value={trackEqDb(track, band)}
                        aria-label={`${label} de ${track.label}`}
                        onChange={(event) =>
                          store.update((current) =>
                            updateTrack(current, track.id, {
                              [band]: Number(event.target.value),
                            }),
                          )
                        }
                      />
                      <span className="mixer-eq-db">{formatDb(trackEqDb(track, band))}</span>
                    </label>
                  ))}
                  <button
                    type="button"
                    className="mixer-eq-reset"
                    aria-label={`EQ plano de ${track.label}`}
                    title="Volver el EQ a 0 dB"
                    onClick={() =>
                      store.update((current) =>
                        updateTrack(current, track.id, {
                          eqLowDb: 0,
                          eqMidDb: 0,
                          eqHighDb: 0,
                        }),
                      )
                    }
                  >
                    EQ 0
                  </button>
                </div>
                {measuredPeak !== undefined && withFader !== null ? (
                  <div className="mixer-meter-block">
                    <div
                      className={`mixer-meter${withFader > -0.1 ? ' clipping' : ''}`}
                      role="meter"
                      aria-label={`Pico de ${track.label}`}
                      aria-valuemin={-60}
                      aria-valuemax={0}
                      aria-valuenow={Number(withFader.toFixed(1))}
                    >
                      <span
                        className="mixer-meter-fill"
                        style={{ width: `${levelPercentFromDb(withFader)}%` }}
                      />
                    </div>
                    <span className="mixer-peak">
                      Pico del material: {measuredPeak.toFixed(1)} dBFS
                    </span>
                    <span className={`mixer-peak${withFader > -0.1 ? ' clipping' : ''}`}>
                      Pico con fader: {withFader.toFixed(1)} dBFS
                    </span>
                    <button
                      type="button"
                      className="mixer-normalize"
                      onClick={() =>
                        store.update((current) =>
                          updateTrack(current, track.id, {
                            gainDb:
                              Math.round(gainForTargetPeak(measuredPeak, targetPeakDb) * 2) / 2,
                          }),
                        )
                      }
                      title={`Ajusta el fader para que el pico quede en ${targetPeakDb} dBFS`}
                    >
                      Normalizar {track.label} a {targetPeakDb} dB
                    </button>
                  </div>
                ) : null}
                <div className="mixer-flags">
                  <button
                    type="button"
                    className={`mixer-flag mute${track.muted ? ' active' : ''}`}
                    aria-label={`Silenciar ${track.label}`}
                    aria-pressed={track.muted}
                    title="Mute"
                    onClick={() =>
                      store.update((current) =>
                        updateTrack(current, track.id, { muted: !track.muted }),
                      )
                    }
                  >
                    M
                  </button>
                  <button
                    type="button"
                    className={`mixer-flag solo${track.solo === true ? ' active' : ''}`}
                    aria-label={`Solo ${track.label}`}
                    aria-pressed={track.solo === true}
                    title="Solo"
                    onClick={() =>
                      store.update((current) =>
                        updateTrack(current, track.id, { solo: !track.solo }),
                      )
                    }
                  >
                    S
                  </button>
                  <button
                    type="button"
                    className="mixer-flag"
                    aria-label={`${track.label} en 0 dB`}
                    title="Volver a 0 dB"
                    onClick={() =>
                      store.update((current) =>
                        updateTrack(current, track.id, { gainDb: 0 }),
                      )
                    }
                  >
                    0
                  </button>
                </div>
              </article>
            );
          })
        )}

        <article className="mixer-strip mixer-master">
          <div className="mixer-strip-head">
            <span className="mixer-index">M</span>
            <strong>Master</strong>
            <span className="mixer-channel-kind">Salida</span>
          </div>
          <small className="mixer-clip-count">
            {loudness ? `Objetivo ${loudness.integratedLufs} LUFS` : 'Sin normalización'} ·{' '}
            {master.limiter ? 'limitador' : 'sin limitador'}
          </small>
          <div className="mixer-fader-wrap">
            <input
              type="range"
              className="mixer-fader"
              aria-label="Ganancia master (dB)"
              min={-60}
              max={12}
              step={0.5}
              value={master.gainDb}
              onChange={(event) =>
                store.update((current) =>
                  updateAudioMix(current, { masterGainDb: Number(event.target.value) }),
                )
              }
            />
            <span className="mixer-db">{formatDb(master.gainDb)}</span>
          </div>
          <p className="mixer-meta">
            Ducking {ducking.enabled ? 'activo' : 'apagado'}
            {ducking.enabled
              ? ` · ${ducking.sourceTrackIds.length} fuente(s) → ${ducking.targetTrackIds.length} música(s)`
              : ' · configuralo en el inspector del proyecto'}
          </p>
        </article>
      </div>

      <LoudnessMonitor />

      <footer className="mixer-footer">
        <span>
          El mute siempre gana. Con una pista en solo, las demás pistas con audio se silencian.
        </span>
        <span>La ganancia de pista se suma a la ganancia de cada clip.</span>
        <span>
          Paneo y EQ de pista se aplican en el export; la preview reproduce ganancia y solo.
        </span>
        <span>
          Los picos se miden con FFmpeg sobre el material completo e incluyen ganancia de clip + fader; no son medidores en vivo.
        </span>
        {measureError ? <span className="mixer-error">{measureError}</span> : null}
      </footer>
    </section>
  );
}
