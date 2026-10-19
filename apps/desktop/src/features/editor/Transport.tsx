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

  function scrub(next: number): void {
    store.setPlaying(false);
    store.setPlayhead(next);
  }

  return (
    <div className="transport" role="group" aria-label="Controles de reproducción">
      <button type="button" className="transport-button" aria-label="Ir al inicio" onClick={() => scrub(0)}>
        ⏮
      </button>
      <button
        type="button"
        className="transport-button"
        aria-label="Frame anterior"
        onClick={() => scrub(playhead - 1)}
      >
        ◀
      </button>
      <button
        type="button"
        className="transport-button primary-transport"
        aria-label={playing ? 'Pausar' : 'Reproducir'}
        onClick={() => store.setPlaying(!playing)}
      >
        {playing ? '❚❚' : '▶'}
      </button>
      <button
        type="button"
        className="transport-button"
        aria-label="Frame siguiente"
        onClick={() => scrub(playhead + 1)}
      >
        ▶
      </button>
      <button
        type="button"
        className="transport-button"
        aria-label="Ir al final"
        onClick={() => scrub(total)}
      >
        ⏭
      </button>
      <span className="transport-time" aria-live="off">
        {formatTimecode(playhead, fps)} <span>/ {formatTimecode(total, fps)}</span>
      </span>
      <span className="transport-frames">
        frame {playhead} / {total}
      </span>
    </div>
  );
}
