import type { PointerEvent } from 'react';
import { Icon } from '../../components/Icon';
import { formatTimecode, splitClip } from '../../state/project-actions';
import { useProjectPlayback, useProjectStore } from '../../state/project-store';
import { updateEditorPreferences } from '../../state/editor-preferences';
import { useEditorPreferences } from '../../state/useEditorPreferences';

const PLAYBACK_RATES = [0.25, 0.5, 1, 2, 4, 8] as const;

export function Transport() {
  const store = useProjectStore();
  const project = store.state.project;
  // El bucle es la preferencia persistida `loopPlayback`: la misma que lee
  // `usePlayback` y el checkbox de Ajustes → Editor, así el botón del
  // transporte nunca muestra un estado que la reproducción no cumple.
  const loop = useEditorPreferences().loopPlayback;
  // El transport sí necesita el frame en cada tick (timecode y scrubber).
  const playback = useProjectPlayback();
  if (!project) return null;
  const fps = project.video.frameRate.num / project.video.frameRate.den;
  const playhead = playback.frame;
  const total = store.durationFrames;
  const playing = playback.playing;
  const reverse = playback.direction < 0;
  const progress = total > 0 ? Math.max(0, Math.min(100, (playhead / total) * 100)) : 0;

  function scrub(next: number): void {
    store.setPlaying(false);
    store.setPlayhead(Math.max(0, Math.min(total, next)));
  }

  function scrubAt(event: PointerEvent<HTMLDivElement>): void {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || total <= 0) return;
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    scrub(Math.round(ratio * total));
  }

  function handleSplit(): void {
    const selection = store.state.selection;
    if (selection.kind === 'clip') {
      try {
        const result = store.mutate((current) => {
          const split = splitClip(current, selection.id, store.getPlayhead());
          if (!split) throw new Error('El playhead no está dentro del clip');
          return { project: split.project, rightClipId: split.rightClipId };
        });
        if (result) {
          store.setNotice('Clip dividido en el playhead.');
        }
      } catch {
        store.setNotice('El playhead debe estar dentro del clip seleccionado para dividirlo.');
      }
    } else {
      const clipUnderPlayhead = project?.timeline.clips.find(
        (c) => playhead > c.startFrame && playhead < c.startFrame + c.durationFrames,
      );
      if (clipUnderPlayhead) {
        try {
          const result = store.mutate((current) => {
            const split = splitClip(current, clipUnderPlayhead.id, store.getPlayhead());
            if (!split) throw new Error('No se pudo dividir');
            return { project: split.project, rightClipId: split.rightClipId };
          });
          if (result) {
            store.setNotice('Clip dividido en el playhead.');
          }
        } catch {
          store.setNotice('No se pudo dividir el clip en este punto.');
        }
      } else {
        store.setNotice('Posicioná el playhead sobre un clip o seleccionalo para dividirlo (S).');
      }
    }
  }

  return (
    <div className="transport" role="group" aria-label="Controles de reproducción">
      <div className="transport-buttons">
        <button
          type="button"
          className="transport-button"
          aria-label="Ir al inicio"
          title="Ir al inicio (Home)"
          onClick={() => scrub(0)}
        >
          <Icon name="skipBack" size={15} />
        </button>
        <button
          type="button"
          className="transport-button"
          aria-label="Frame anterior"
          title="Frame anterior (←)"
          onClick={() => scrub(playhead - 1)}
        >
          <Icon name="frameBack" size={14} />
        </button>
        <button
          type="button"
          className="transport-button primary-transport"
          aria-label={playing ? 'Pausar' : 'Reproducir'}
          title={
            playing
              ? reverse
                ? 'Pausar (Espacio) · reproduciendo hacia atrás (J)'
                : 'Pausar (Espacio)'
              : reverse
                ? 'Reanudar hacia atrás (Espacio) · L vuelve a adelante'
                : 'Reproducir (Espacio)'
          }
          onClick={() => store.setPlaying(!playing)}
        >
          <Icon name={playing ? (reverse ? 'playReverse' : 'pause') : 'play'} size={17} />
        </button>
        <button
          type="button"
          className="transport-button"
          aria-label="Frame siguiente"
          title="Frame siguiente (→)"
          onClick={() => scrub(playhead + 1)}
        >
          <Icon name="frameForward" size={14} />
        </button>
        <button
          type="button"
          className="transport-button"
          aria-label="Ir al final"
          title="Ir al final (End)"
          onClick={() => scrub(total)}
        >
          <Icon name="skipForward" size={15} />
        </button>
        <button
          type="button"
          className="transport-button"
          aria-label="Dividir clip en el playhead"
          title="Dividir clip en el playhead (S)"
          onClick={handleSplit}
        >
          <Icon name="split" size={14} />
        </button>
        <button
          type="button"
          className={`transport-button${loop ? ' active' : ''}`}
          aria-label="Bucle de reproducción"
          title={loop ? 'Bucle activado' : 'Activar bucle'}
          onClick={() => updateEditorPreferences({ loopPlayback: !loop })}
        >
          <Icon name="refresh" size={13} />
        </button>
        <select
          className="transport-rate"
          aria-label="Velocidad de reproducción"
          title="Velocidad de reproducción"
          value={playback.rate}
          onChange={(event) => store.setPlaybackRate(Number(event.target.value))}
        >
          {PLAYBACK_RATES.map((rate) => (
            <option key={rate} value={rate}>
              {rate}×
            </option>
          ))}
        </select>
      </div>

      <div className="transport-timeline">
        <div
          className="transport-scrub"
          role="slider"
          aria-label="Posición de reproducción"
          aria-valuemin={0}
          aria-valuemax={Math.max(0, total)}
          aria-valuenow={Math.max(0, Math.min(total, playhead))}
          tabIndex={0}
          onPointerDown={scrubAt}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft') scrub(playhead - 1);
            if (event.key === 'ArrowRight') scrub(playhead + 1);
          }}
        >
          <span style={{ width: `${progress}%` }} />
          <span
            className="transport-scrub-knob"
            style={{ left: `${progress}%` }}
            aria-hidden="true"
          />
        </div>
        <div className="transport-readout">
          <span className="transport-time" aria-live="off">
            {formatTimecode(playhead, fps)} <span>/ {formatTimecode(total, fps)}</span>
          </span>
          <span className="transport-frames">
            frame {playhead} / {total}
          </span>
        </div>
      </div>
    </div>
  );
}
