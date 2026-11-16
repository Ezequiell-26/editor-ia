import { useRef } from 'react';
import type { ClipEffects } from '@editor-ia/project-schema';
import { createRafCoalescer } from './timeline-raf';

/**
 * Región arrastrable del visualizador de espectro (paridad de
 * `regiao_efeito.js` de AlaukCut): la caja del espectro se mueve
 * arrastrando el cuerpo y se redimensiona desde las 4 esquinas. La
 * geometría se deriva de `effects.spectrum` ({x, y, width, height}) en
 * fracciones del frame, igual que el `overlay` de FFmpeg del export.
 */

type SpectrumConfig = NonNullable<ClipEffects['spectrum']>;

interface Region {
  readonly l: number;
  readonly t: number;
  readonly r: number;
  readonly b: number;
}

const MIN_W = 0.1;
const MAX_W = 1;
const MIN_H = 0.05;
const MAX_H = 0.6;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Caja visible del espectro en fracciones del frame (0..1). */
export function spectrumRegion(spec: SpectrumConfig): Region {
  const w = clamp(spec.width ?? 1, MIN_W, MAX_W);
  const h = clamp(spec.height ?? 0.28, MIN_H, MAX_H);
  const x = clamp(spec.x ?? 0, -1, 1);
  const y = spec.y ?? 0;
  const span = 1 - w;
  const l = span / 2 + x * (span / 2);
  const t = 1 - h - y;
  return { l, t, r: l + w, b: t + h };
}

/**
 * Traduce una región {l,t,r,b} de vuelta a props de `effects.spectrum`.
 * `x` se resuelve desde el borde izquierdo (mismo mapeo que el overlay de
 * FFmpeg `(W-w)/2 + x*(W-w)/2`); `y` desde el borde inferior.
 */
export function spectrumPropsFromRegion(region: Region): SpectrumConfig {
  const w = clamp(region.r - region.l, MIN_W, MAX_W);
  const h = clamp(region.b - region.t, MIN_H, MAX_H);
  const l = clamp(region.l, -0.5, 1.5 - w);
  const t = clamp(region.t, -0.5, 1.5 - h);
  const span = 1 - w;
  const x = span > 0.0001 ? clamp((2 * l - span) / span, -1, 1) : 0;
  const y = clamp(1 - h - t, 0, 0.95);
  return { width: w, height: h, x, y };
}

type DragMode = 'move' | 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w';

const CORNERS: ReadonlyArray<{ mode: Exclude<DragMode, 'move'>; className: string }> = [
  { mode: 'nw', className: 'preview-spectrum-handle nw' },
  { mode: 'ne', className: 'preview-spectrum-handle ne' },
  { mode: 'sw', className: 'preview-spectrum-handle sw' },
  { mode: 'se', className: 'preview-spectrum-handle se' },
  { mode: 'n', className: 'preview-spectrum-handle n' },
  { mode: 's', className: 'preview-spectrum-handle s' },
  { mode: 'e', className: 'preview-spectrum-handle e' },
  { mode: 'w', className: 'preview-spectrum-handle w' },
];

export function PreviewSpectrumRegion({
  spec,
  onLive,
  onCommit,
}: {
  readonly spec: SpectrumConfig;
  /** Actualización continua durante el arrastre (sin entrada de historial). */
  readonly onLive: (patch: SpectrumConfig) => void;
  /** Commit único al soltar (una entrada de historial para todo el gesto). */
  readonly onCommit: (patch: SpectrumConfig) => void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const latestRef = useRef<SpectrumConfig | null>(null);

  const region = spectrumRegion(spec);
  const style = {
    left: `${region.l * 100}%`,
    top: `${region.t * 100}%`,
    width: `${(region.r - region.l) * 100}%`,
    height: `${(region.b - region.t) * 100}%`,
  };

  function beginDrag(event: React.PointerEvent, mode: DragMode): void {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const el = rootRef.current;
    const canvas = el?.closest('.preview-canvas');
    if (!canvas) return;
    const canvasRect = canvas.getBoundingClientRect();
    if (canvasRect.width <= 0 || canvasRect.height <= 0) return;
    const startX = event.clientX;
    const startY = event.clientY;
    const startRegion = region;
    latestRef.current = null;
    const target = event.currentTarget;
    target.setPointerCapture?.(event.pointerId);

    const applyDelta = (clientX: number, clientY: number): void => {
      const dx = (clientX - startX) / canvasRect.width;
      const dy = (clientY - startY) / canvasRect.height;
      let { l, t, r, b } = startRegion;
      if (mode === 'move' || mode.includes('e')) r += dx;
      if (mode === 'move' || mode.includes('w')) l += dx;
      if (mode === 'move' || mode.includes('s')) b += dy;
      if (mode === 'move' || mode.includes('n')) t += dy;
      const patch = spectrumPropsFromRegion({ l, t, r, b });
      latestRef.current = patch;
      onLive(patch);
    };

    const coalescer = createRafCoalescer<{ x: number; y: number }>((point) =>
      applyDelta(point.x, point.y),
    );
    const onMove = (moveEvent: Event): void => {
      const pointer = moveEvent as PointerEvent;
      coalescer.push({ x: pointer.clientX, y: pointer.clientY });
    };
    const finish = (): void => {
      coalescer.flush();
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', finish);
      target.removeEventListener('pointercancel', finish);
      if (target.hasPointerCapture?.(event.pointerId)) {
        target.releasePointerCapture(event.pointerId);
      }
      // Commit único: `latestRef` guarda el último patch aplicado (el
      // closure `region` sería el del render inicial, no el final).
      const patch = latestRef.current ?? spectrumPropsFromRegion(startRegion);
      latestRef.current = null;
      onCommit(patch);
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', finish);
    target.addEventListener('pointercancel', finish);
  }

  return (
    <div
      ref={rootRef}
      className="preview-spectrum-region"
      style={style}
      onPointerDown={(event) => beginDrag(event, 'move')}
      role="application"
      aria-label="Región del espectro: arrastrar para mover, 8 asas para redimensionar"
    >
      {CORNERS.map((corner) => (
        <span
          key={corner.mode}
          className={corner.className}
          onPointerDown={(event) => beginDrag(event, corner.mode)}
        />
      ))}
    </div>
  );
}
