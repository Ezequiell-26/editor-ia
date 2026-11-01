import { useEffect, useState } from 'react';
import { previewPerf, type PreviewPerfSnapshot } from './preview-perf';

const IDLE: PreviewPerfSnapshot = {
  active: false,
  fps: 0,
  targetFps: 0,
  frames: 0,
  dropped: 0,
  heapMb: null,
};

/** Mide FPS reales mientras `playing`; publica un snapshot cada 500 ms. */
export function usePreviewPerf(playing: boolean, targetFps: number): PreviewPerfSnapshot {
  const [snapshot, setSnapshot] = useState<PreviewPerfSnapshot>(IDLE);
  useEffect(() => {
    if (!playing) {
      previewPerf.stop();
      setSnapshot(IDLE);
      return;
    }
    previewPerf.start(targetFps);
    setSnapshot(previewPerf.snapshot());
    const timer = window.setInterval(() => setSnapshot(previewPerf.snapshot()), 500);
    return () => {
      window.clearInterval(timer);
      previewPerf.stop();
    };
  }, [playing, targetFps]);
  return snapshot;
}
