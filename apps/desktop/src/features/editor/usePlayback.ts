import { useEffect, useRef } from 'react';
import { fpsOf } from '../../state/project-actions';
import { useProjectPlayback, useProjectStore } from '../../state/project-store';
import { useEditorPreferences } from '../../state/useEditorPreferences';

export function usePlayback(): void {
  const store = useProjectStore();
  // Playback vive en contextos propios: este hook re-renderiza por frame,
  // pero el resto de la app ya no.
  const playback = useProjectPlayback();
  const playing = playback.playing;
  const project = store.state.project;
  const loop = useEditorPreferences().loopPlayback;
  const { setPlayhead, setPlaying, durationFrames, getPlaybackRate, getPlaybackDirection } = store;
  const playheadRef = useRef(playback.frame);
  playheadRef.current = playback.frame;

  // El documento cambia de identidad en cada edición. Si fuera dependencia
  // del efecto, editar durante la reproducción cancelaría y reiniciaría el
  // bucle rAF: basta con el fps (primitivo) y con saber si hay proyecto.
  const fps = project ? fpsOf(project) : 0;
  const hasProject = project !== null;

  useEffect(() => {
    if (!playing || !hasProject) {
      return;
    }
    const total = durationFrames;
    if (total <= 0) {
      setPlaying(false);
      return;
    }
    // Simétrico al forward, que al llegar al final vuelve a 0: el shuttle
    // inverso parado en el frame 0 arranca desde el último frame.
    let frame =
      getPlaybackDirection() > 0
        ? playheadRef.current >= total - 0.5
          ? 0
          : playheadRef.current
        : playheadRef.current <= 0.5
          ? total - 1
          : playheadRef.current;
    let last = performance.now();
    // El store redondea y descarta los valores repetidos, pero igualmente
    // encolaba un setState por cada rAF (60/s en monitores de 60 Hz para un
    // proyecto de 30 fps). Emitir sólo cuando cambia el frame entero evita
    // la mitad de actualizaciones sin alterar lo que ve el usuario.
    let emitted = Math.round(frame);
    let handle = 0;
    const tick = (now: number) => {
      const deltaSeconds = Math.min(0.1, (now - last) / 1000);
      last = now;
      // La velocidad y la dirección se leen de refs en cada tick: cambiarlas
      // a mitad de la reproducción no reinicia el bucle rAF ni corta el audio.
      const direction = getPlaybackDirection();
      frame += deltaSeconds * fps * getPlaybackRate() * direction;
      if (direction > 0 && frame >= total) {
        if (loop) {
          // Bucle: vuelve al inicio sin cortar la reproducción.
          frame = 0;
          emitted = 0;
          setPlayhead(0);
          handle = requestAnimationFrame(tick);
          return;
        }
        setPlayhead(total);
        setPlaying(false);
        return;
      }
      if (direction < 0 && frame <= 0) {
        if (loop) {
          // Bucle inverso: salta al último frame y sigue hacia atrás.
          frame = total - 1;
          emitted = Math.round(frame);
          setPlayhead(emitted);
          handle = requestAnimationFrame(tick);
          return;
        }
        setPlayhead(0);
        setPlaying(false);
        return;
      }
      const rounded = Math.round(frame);
      if (rounded !== emitted) {
        emitted = rounded;
        setPlayhead(rounded);
      }
      handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, [playing, hasProject, fps, setPlayhead, setPlaying, durationFrames, loop, getPlaybackRate, getPlaybackDirection]);
}
