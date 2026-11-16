import { useEffect } from 'react';
import { fpsOf } from '../../state/project-actions';
import { useProjectPlayback, useProjectStore } from '../../state/project-store';
import { useEditorPreferences } from '../../state/useEditorPreferences';

/**
 * UI-001: el motor de reproducción es un SINGLETON a nivel módulo. Antes
 * cada componente que llamaba `usePlayback()` abría su propio rAF y dos
 * superficies montadas a la vez (MinimalEditor + EditorWorkspace)
 * duplicaban `setPlayhead` por frame. Ahora el primero que lo necesita
 * arranca el bucle y el último que lo suelta lo detiene; los cambios de
 * parámetros (fps, duración, loop, velocidad) actualizan el motor en
 * caliente sin reiniciar el rAF.
 */
interface PlaybackEngineParams {
  readonly fps: number;
  readonly total: number;
  readonly loop: boolean;
  readonly getPlayhead: () => number;
  readonly getPlaybackRate: () => number;
  readonly getPlaybackDirection: () => number;
  readonly setPlayhead: (frame: number) => void;
  readonly setPlaying: (playing: boolean) => void;
}

interface PlaybackEngine {
  params: PlaybackEngineParams;
  refs: number;
  raf: number;
  frame: number;
  last: number;
  emitted: number;
}

let engine: PlaybackEngine | null = null;

function tickEngine(now: number): void {
  const current = engine;
  if (!current) return;
  const { params } = current;
  const deltaSeconds = Math.min(0.1, (now - current.last) / 1000);
  current.last = now;
  // La velocidad y la dirección se leen de refs en cada tick: cambiarlas
  // a mitad de la reproducción no reinicia el bucle rAF ni corta el audio.
  const direction = params.getPlaybackDirection();
  current.frame += deltaSeconds * params.fps * params.getPlaybackRate() * direction;
  if (direction > 0 && current.frame >= params.total) {
    if (params.loop) {
      // Bucle: vuelve al inicio sin cortar la reproducción.
      current.frame = 0;
      current.emitted = 0;
      params.setPlayhead(0);
      current.raf = requestAnimationFrame(tickEngine);
      return;
    }
    params.setPlayhead(params.total);
    params.setPlaying(false);
    return;
  }
  if (direction < 0 && current.frame <= 0) {
    if (params.loop) {
      // Bucle inverso: salta al último frame y sigue hacia atrás.
      current.frame = params.total - 1;
      current.emitted = Math.round(current.frame);
      params.setPlayhead(current.emitted);
      current.raf = requestAnimationFrame(tickEngine);
      return;
    }
    params.setPlayhead(0);
    params.setPlaying(false);
    return;
  }
  const rounded = Math.round(current.frame);
  if (rounded !== current.emitted) {
    current.emitted = rounded;
    params.setPlayhead(rounded);
  }
  current.raf = requestAnimationFrame(tickEngine);
}

function acquirePlayback(params: PlaybackEngineParams): () => void {
  if (engine) {
    engine.refs += 1;
    engine.params = params;
  } else {
    const direction = params.getPlaybackDirection();
    // Simétrico al forward, que al llegar al final vuelve a 0: el shuttle
    // inverso parado en el frame 0 arranca desde el último frame.
    const start = params.getPlayhead();
    engine = {
      params,
      refs: 1,
      raf: 0,
      frame:
        direction > 0
          ? start >= params.total - 0.5
            ? 0
            : start
          : start <= 0.5
            ? params.total - 1
            : start,
      last: performance.now(),
      emitted: 0,
    };
    engine.emitted = Math.round(engine.frame);
    engine.raf = requestAnimationFrame(tickEngine);
  }
  return () => {
    const current = engine;
    if (!current) return;
    current.refs -= 1;
    if (current.refs <= 0) {
      cancelAnimationFrame(current.raf);
      engine = null;
    }
  };
}

export function usePlayback(): void {
  const store = useProjectStore();
  // Playback vive en contextos propios: este hook re-renderiza por frame,
  // pero el resto de la app ya no.
  const playback = useProjectPlayback();
  const playing = playback.playing;
  const project = store.state.project;
  const loop = useEditorPreferences().loopPlayback;
  const {
    setPlayhead,
    setPlaying,
    durationFrames,
    getPlayhead,
    getPlaybackRate,
    getPlaybackDirection,
  } = store;

  // El documento cambia de identidad en cada edición. Si fuera dependencia
  // del efecto, editar durante la reproducción cancelaría y reiniciaría el
  // bucle rAF: basta con el fps (primitivo) y con saber si hay proyecto.
  const fps = project ? fpsOf(project) : 0;
  const hasProject = project !== null;

  useEffect(() => {
    if (!playing || !hasProject) {
      return;
    }
    if (durationFrames <= 0) {
      setPlaying(false);
      return;
    }
    return acquirePlayback({
      fps,
      total: durationFrames,
      loop,
      getPlayhead,
      getPlaybackRate,
      getPlaybackDirection,
      setPlayhead,
      setPlaying,
    });
  }, [
    playing,
    hasProject,
    fps,
    durationFrames,
    loop,
    setPlayhead,
    setPlaying,
    getPlayhead,
    getPlaybackRate,
    getPlaybackDirection,
  ]);
}
