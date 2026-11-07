import { useCallback, useRef, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import type { WheelXY } from '@editor-ia/project-schema';

/**
 * Colour wheel of the reference captures (118/127): chromatic disc, two
 * luminance arcs, X/Y numeric fields and a per-wheel reset. Every interaction
 * writes through to the project grade; there is no local copy of the value.
 */
export interface FilmoraWheelProps {
  readonly label: string;
  readonly value: WheelXY;
  readonly onChange: (next: WheelXY, transient: boolean) => void;
  readonly size?: number;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
const round2 = (value: number): number => Math.round(value * 100) / 100;

export function FilmoraWheel({ label, value, onChange, size = 116 }: FilmoraWheelProps) {
  const padRef = useRef<HTMLDivElement | null>(null);
  const dragging = useRef(false);

  const emitFromPointer = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>, transient: boolean) => {
      const pad = padRef.current;
      if (!pad) return;
      const rect = pad.getBoundingClientRect();
      const dx = (event.clientX - (rect.left + rect.width / 2)) / (rect.width / 2);
      const dy = (event.clientY - (rect.top + rect.height / 2)) / (rect.height / 2);
      const radius = Math.hypot(dx, dy);
      const scale = radius > 1 ? 1 / radius : 1;
      onChange({ ...value, x: round2(clamp(dx * scale, -1, 1)), y: round2(clamp(dy * scale, -1, 1)) }, transient);
    },
    [onChange, value],
  );

  const setAxis = (axis: 'x' | 'y' | 'luma', raw: string | number): void => {
    const parsed = typeof raw === 'number' ? raw : Number(raw.replace(',', '.'));
    onChange({ ...value, [axis]: round2(clamp(parsed, -1, 1)) }, false);
  };

  const dotLeft = 50 + value.x * 42;
  const dotTop = 50 + value.y * 42;

  return (
    <div className="fp-wheel" style={{ '--fp-wheel-size': `${size}px` } as CSSProperties}>
      <div className="fp-wheel-head">
        <button
          type="button"
          className="fp-wheel-reset"
          aria-label={`Restablecer rueda ${label}`}
          title={`Restablecer ${label}`}
          onClick={() => onChange({ x: 0, y: 0, luma: 0 }, false)}
        >
          ◎
        </button>
        <span className="fp-wheel-label">{label}</span>
      </div>
      <div className="fp-wheel-body">
        <input
          className="fp-wheel-arc fp-wheel-arc--left"
          type="range"
          min={-1}
          max={1}
          step={0.01}
          value={value.luma}
          aria-label={`${label} luminancia`}
          title="Luminancia de la zona"
          onChange={(event) => setAxis('luma', event.target.value)}
        />
        <div
          ref={padRef}
          className="fp-wheel-disc"
          role="slider"
          tabIndex={0}
          aria-label={`${label} croma`}
          aria-valuemin={-1}
          aria-valuemax={1}
          aria-valuenow={value.x}
          aria-valuetext={`X ${value.x.toFixed(2)} Y ${value.y.toFixed(2)}`}
          onPointerDown={(event) => {
            dragging.current = true;
            event.currentTarget.setPointerCapture(event.pointerId);
            emitFromPointer(event, true);
          }}
          onPointerMove={(event) => {
            if (dragging.current) emitFromPointer(event, true);
          }}
          onPointerUp={(event) => {
            dragging.current = false;
            emitFromPointer(event, false);
          }}
          onKeyDown={(event) => {
            const step = event.shiftKey ? 0.1 : 0.02;
            const deltas: Record<string, [number, number]> = {
              ArrowLeft: [-step, 0], ArrowRight: [step, 0],
              ArrowUp: [0, -step], ArrowDown: [0, step],
            };
            const delta = deltas[event.key];
            if (!delta) return;
            event.preventDefault();
            onChange({
              ...value,
              x: round2(clamp(value.x + delta[0], -1, 1)),
              y: round2(clamp(value.y + delta[1], -1, 1)),
            }, false);
          }}
        >
          <span className="fp-wheel-dot" style={{ left: `${dotLeft}%`, top: `${dotTop}%` }} />
        </div>
        <input
          className="fp-wheel-arc fp-wheel-arc--right"
          type="range"
          min={-1}
          max={1}
          step={0.01}
          value={value.luma}
          aria-label={`${label} luminancia (derecha)`}
          title="Luminancia de la zona"
          onChange={(event) => setAxis('luma', event.target.value)}
        />
      </div>
      <div className="fp-wheel-values">
        <label>
          <span>X</span>
          <input
            type="text"
            inputMode="decimal"
            value={value.x.toFixed(2).replace('.', ',')}
            aria-label={`${label} X`}
            onChange={(event) => setAxis('x', event.target.value)}
          />
        </label>
        <label>
          <span>Y</span>
          <input
            type="text"
            inputMode="decimal"
            value={value.y.toFixed(2).replace('.', ',')}
            aria-label={`${label} Y`}
            onChange={(event) => setAxis('y', event.target.value)}
          />
        </label>
      </div>
    </div>
  );
}
