import { useEffect, useRef } from 'react';
import { fpsOf } from '../../state/project-actions';
import { useProjectStore } from '../../state/project-store';

export function usePlayback(): void {
  const store = useProjectStore();
  const playing = store.state.playing;
  const project = store.state.project;
  const { setPlayhead, setPlaying, durationFrames } = store;
  const playheadRef = useRef(store.state.playheadFrame);
  playheadRef.current = store.state.playheadFrame;

  useEffect(() => {
    if (!playing || !project) {
      return;
    }
    const fps = fpsOf(project);
    const total = durationFrames;
    if (total <= 0) {
      setPlaying(false);
      return;
    }
    let frame = playheadRef.current >= total - 0.5 ? 0 : playheadRef.current;
    let last = performance.now();
    let handle = 0;
    const tick = (now: number) => {
      const deltaSeconds = Math.min(0.1, (now - last) / 1000);
      last = now;
      frame += deltaSeconds * fps;
      if (frame >= total) {
        setPlayhead(total);
        setPlaying(false);
        return;
      }
      setPlayhead(frame);
      handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, [playing, project, setPlayhead, setPlaying, durationFrames]);
}
