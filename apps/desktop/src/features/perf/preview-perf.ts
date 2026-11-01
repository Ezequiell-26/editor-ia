/**
 * Medidor de rendimiento real de la preview en WebView2.
 *
 * Cuenta frames de `requestAnimationFrame` mientras se reproduce y calcula FPS
 * efectivos y frames caídos contra el fps del proyecto. No altera el playhead:
 * sólo observa el compositor.
 */
export interface PreviewPerfSnapshot {
  readonly active: boolean;
  readonly fps: number;
  readonly targetFps: number;
  readonly frames: number;
  readonly dropped: number;
  readonly heapMb: number | null;
}

const EMPTY: PreviewPerfSnapshot = {
  active: false,
  fps: 0,
  targetFps: 0,
  frames: 0,
  dropped: 0,
  heapMb: null,
};

export function calculatePreviewPerf(
  timestamps: readonly number[],
  targetFps: number,
  active: boolean,
  heapBytes?: number,
): PreviewPerfSnapshot {
  const heapMb =
    typeof heapBytes === 'number' && Number.isFinite(heapBytes)
      ? Math.round((heapBytes / (1024 * 1024)) * 10) / 10
      : null;
  if (!active || timestamps.length < 2) {
    return { ...EMPTY, targetFps, active, heapMb };
  }
  const first = timestamps[0]!;
  const last = timestamps[timestamps.length - 1]!;
  const span = last - first;
  const fps = span > 0 ? ((timestamps.length - 1) * 1000) / span : 0;
  const expected = targetFps > 0 ? ((last - first) / 1000) * targetFps : timestamps.length;
  const dropped = Math.max(0, Math.round(expected) - (timestamps.length - 1));
  return {
    active,
    fps: Math.round(fps * 10) / 10,
    targetFps,
    frames: timestamps.length,
    dropped,
    heapMb,
  };
}

class PreviewPerfMeter {
  private timestamps: number[] = [];
  private raf = 0;
  private active = false;
  private targetFps = 30;

  start(targetFps: number): void {
    this.stop();
    this.targetFps = targetFps > 0 ? targetFps : 30;
    this.timestamps = [];
    this.active = true;
    if (typeof window === 'undefined') return;
    const loop = (time: number) => {
      if (!this.active) return;
      this.timestamps.push(time);
      if (this.timestamps.length > 240) this.timestamps.splice(0, this.timestamps.length - 240);
      this.raf = window.requestAnimationFrame(loop);
    };
    this.raf = window.requestAnimationFrame(loop);
  }

  stop(): void {
    this.active = false;
    if (this.raf && typeof window !== 'undefined') {
      window.cancelAnimationFrame(this.raf);
    }
    this.raf = 0;
  }

  reset(): void {
    this.stop();
    this.timestamps = [];
  }

  snapshot(): PreviewPerfSnapshot {
    const heap = (performance as Performance & { memory?: { usedJSHeapSize?: number } }).memory
      ?.usedJSHeapSize;
    return calculatePreviewPerf(this.timestamps, this.targetFps, this.active, heap);
  }
}

export const previewPerf = new PreviewPerfMeter();

export function previewPerfSnapshot(): PreviewPerfSnapshot {
  return previewPerf.snapshot();
}
