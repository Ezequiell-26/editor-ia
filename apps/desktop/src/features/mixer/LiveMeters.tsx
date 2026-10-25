import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Track } from '@editor-ia/project-schema';
import { useProjectStore } from '../../state/project-store';
import {
  isPreviewAudioSupported,
  levelPercentFromDb,
  readPreviewAudioLevels,
  syncPreviewAudioFromProject,
  type TrackLevelReading,
} from './usePreviewAudio';

/**
 * Medidores en vivo de la vista Mezcla: nivel RMS por pista y master leído de
 * los AnalyserNode del grafo de la preview (`usePreviewAudio`), con marca de
 * pico sostenido. El bucle de `requestAnimationFrame` corre mientras el
 * proyecto está en reproducción (`state.playing`); al pausar, las barras caen
 * al piso y el pico queda sostenido hasta la próxima reproducción.
 */

const MASTER_KEY = '__master__';

/** Tiempo que el pico se mantiene fijo antes de empezar a caer. */
const PEAK_HOLD_MS = 1_500;
/** Velocidad de caída del pico después de la retención, en dB/s. */
const PEAK_DECAY_DB_PER_SECOND = 24;

interface PeakEntry {
  value: number;
  since: number;
}

const SILENCE: TrackLevelReading = {
  rmsDb: Number.NEGATIVE_INFINITY,
  peakDb: Number.NEGATIVE_INFINITY,
};

function formatDb(db: number): string {
  if (!Number.isFinite(db)) return '−∞';
  return `${db > 0 ? '+' : ''}${db.toFixed(1)} dB`;
}

function levelRow(
  key: string,
  label: string,
  level: TrackLevelReading,
  peakDb: number,
): ReactNode {
  const clipping = level.rmsDb > -0.1 || peakDb > -0.1;
  const peakPercent = levelPercentFromDb(peakDb);
  return (
    <div
      className="mixer-live-meter"
      key={key}
      style={{ display: 'flex', alignItems: 'center', gap: 8 }}
    >
      <span
        className="mixer-live-meter-name"
        style={{ width: 88, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        title={label}
      >
        {label}
      </span>
      <div
        className={`mixer-meter${clipping ? ' clipping' : ''}`}
        role="meter"
        aria-label={`Nivel en vivo de ${label}`}
        aria-valuemin={-60}
        aria-valuemax={0}
        aria-valuenow={
          Number.isFinite(level.rmsDb) ? Number(Math.max(-60, Math.min(0, level.rmsDb)).toFixed(1)) : -60
        }
        style={{ flex: 1 }}
      >
        <span
          className="mixer-meter-fill"
          style={{ width: `${levelPercentFromDb(level.rmsDb)}%` }}
        />
        {peakPercent > 0 ? (
          <span
            className="mixer-meter-peak-hold"
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              width: 2,
              left: `${peakPercent}%`,
              background: clipping ? '#ef8b7f' : '#f5f7fa',
              opacity: 0.9,
            }}
          />
        ) : null}
      </div>
      <span className={`mixer-peak${clipping ? ' clipping' : ''}`} style={{ width: 64, textAlign: 'right' }}>
        {formatDb(level.rmsDb)}
      </span>
    </div>
  );
}

export function LiveMeters({ tracks }: { readonly tracks: readonly Track[] }) {
  const store = useProjectStore();
  const playing = store.state.playing;
  const project = store.state.project;
  // Niveles instantáneos de la última lectura; el pico sostenido vive en un
  // ref para no depender del render.
  const [levels, setLevels] = useState<Record<string, TrackLevelReading>>({});
  const peaksRef = useRef(new Map<string, PeakEntry>());
  const trackIdsRef = useRef<string[]>([]);
  trackIdsRef.current = tracks.map((track) => track.id);
  const trackKey = trackIdsRef.current.join('|');

  // El grafo de la preview sigue los parámetros del proyecto aunque los
  // faders se muevan desde esta vista; sincronizar es barato e idempotente.
  useEffect(() => {
    if (project) syncPreviewAudioFromProject(project);
  }, [project]);

  useEffect(() => {
    if (!playing) return;
    let handle = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const deltaSeconds = Math.min(0.25, (now - last) / 1000);
      last = now;
      const reading = readPreviewAudioLevels(trackIdsRef.current);
      if (reading) {
        const merged: Record<string, TrackLevelReading> = { ...reading.tracks };
        merged[MASTER_KEY] = reading.master;
        for (const [key, value] of Object.entries(merged)) {
          const held = peaksRef.current.get(key);
          if (!held || value.peakDb >= held.value) {
            peaksRef.current.set(key, { value: value.peakDb, since: now });
          } else if (now - held.since > PEAK_HOLD_MS) {
            peaksRef.current.set(key, {
              value: Math.max(value.peakDb, held.value - PEAK_DECAY_DB_PER_SECOND * deltaSeconds),
              since: now,
            });
          }
        }
        setLevels(merged);
      }
      handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, [playing, trackKey]);

  if (!project) return null;

  const graphActive = readPreviewAudioLevels([]) !== null;
  const supported = isPreviewAudioSupported();

  const rows: ReactNode[] = tracks.map((track) => {
    const key = track.id;
    return levelRow(
      key,
      track.label,
      playing ? (levels[key] ?? SILENCE) : SILENCE,
      peaksRef.current.get(key)?.value ?? SILENCE.peakDb,
    );
  });
  rows.push(
    levelRow(
      MASTER_KEY,
      'Master',
      playing ? (levels[MASTER_KEY] ?? SILENCE) : SILENCE,
      peaksRef.current.get(MASTER_KEY)?.value ?? SILENCE.peakDb,
    ),
  );

  return (
    <section
      className="mixer-live-meters"
      aria-label="Medidores en vivo"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: '12px 0 4px',
        borderTop: '1px solid var(--color-border, #26303a)',
      }}
    >
      <div>
        <h2 style={{ margin: 0, fontSize: 14 }}>Medidores en vivo</h2>
        <p style={{ margin: '2px 0 0', fontSize: 12, opacity: 0.8 }}>
          Nivel RMS por pista y master con pico sostenido. Se actualizan mientras se reproduce la
          preview; el pico queda marcado hasta la próxima reproducción.
        </p>
      </div>
      {rows}
      {!supported ? (
        <p style={{ margin: 0, fontSize: 12, opacity: 0.7 }}>
          Este entorno no expone Web Audio: los medidores quedan en reposo y la preview usa el
          volumen del elemento.
        </p>
      ) : !graphActive && !playing ? (
        <p style={{ margin: 0, fontSize: 12, opacity: 0.7 }}>
          Los medidores se activan cuando la preview enruta su audio (reproducí desde el editor).
        </p>
      ) : null}
    </section>
  );
}
