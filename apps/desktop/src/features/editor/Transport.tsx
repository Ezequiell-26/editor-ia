import type { PointerEvent } from 'react';
import { Icon } from '../../components/Icon';
import { formatTimecode } from '../../state/project-actions';
import { useProjectStore } from '../../state/project-store';

export function Transport() {
  const store = useProjectStore();
  const project = store.state.project;
  if (!project) return null;
  const fps = project.video.frameRate.num / project.video.frameRate.den;
  const playhead = store.state.playheadFrame;
  const total = store.durationFrames;
  const playing = store.state.playing;
  const progress = total > 0 ? Math.max(0, Math.min(100, (playhead / total) * 100)) : 0;

  function scrub(next: number): void {
    store.setPlaying(false);
    store.setPlayhead(next);
  }

  function scrubAt(event: PointerEvent<HTMLDivElement>): void {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || total <= 0) return;
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    scrub(Math.round(ratio * total));
  }

  return (
    <div className="transport" role="group" aria-label="Controles de reproducción">
      <div className="transport-buttons">
        <button type="button" className="transport-button" aria-label="Ir al inicio" onClick={() => scrub(0)}>
          <Icon name="skipBack" size={16} />
        </button>
        <button
          type="button"
          className="transport-button"
          aria-label="Frame anterior"
          onClick={() => scrub(playhead - 1)}
        >
          <Icon name="frameBack" size={15} />
        </button>
        <button
          type="button"
          className="transport-button primary-transport"
          aria-label={playing ? 'Pausar' : 'Reproducir'}
          onClick={() => store.setPlaying(!playing)}
        >
          <Icon name={playing ? 'pause' : 'play'} size={18} />
        </button>
        <button
          type="button"
          className="transport-button"
          aria-label="Frame siguiente"
          onClick={() => scrub(playhead + 1)}
        >
          <Icon name="frameForward" size={15} />
        </button>
        <button type="button" className="transport-button" aria-label="Ir al final" onClick={() => scrub(total)}>
          <Icon name="skipForward" size={16} />
        </button>
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
