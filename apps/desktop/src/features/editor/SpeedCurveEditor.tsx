import { DndContext, PointerSensor, useDraggable, useSensor, useSensors } from '@dnd-kit/core';
import type { DragMoveEvent, DragStartEvent } from '@dnd-kit/core';
import { Bezier } from 'bezier-js';
import { useState, type KeyboardEvent } from 'react';
import type {
  KeyframeEasing,
  SpeedCurve,
  SpeedCurvePoint,
} from '@editor-ia/project-schema';
import {
  MAX_RAMP_SPEED,
  MIN_RAMP_SPEED,
  curveDurationFrames,
  meanSpeedCurve,
  sampleSpeedCurve,
} from '@editor-ia/project-schema';

/**
 * Editor Bézier de curvas de velocidad continuas.
 *
 * La curva se define sobre el tiempo de salida: `t` es la posición normalizada
 * en el clip y `speed` el multiplicador. Los puntos se arrastran con puntero
 * (dnd-kit) o con las flechas del teclado; la duración resultante se muestra en
 * vivo desde la media de la curva.
 *
 * `bezier-js` (MIT) dibuja cada tramo como un Bézier cúbico real: los controles
 * salen del easing del punto que abre el tramo, así el trazo coincide con lo
 * que evalúa el render.
 */

const WIDTH = 320;
const HEIGHT = 150;
const PAD = 10;
const TOP_SPEED = 4.25;
const MIN_GAP = 0.01;

const DEFAULT_CURVE: SpeedCurve = {
  points: [
    { t: 0, speed: 1, easing: 'ease-in-out' },
    { t: 1, speed: 1 },
  ],
};

const EASING_OPTIONS: readonly { value: KeyframeEasing; label: string }[] = [
  { value: 'linear', label: 'Lineal' },
  { value: 'ease-in', label: 'Suave entrada' },
  { value: 'ease-out', label: 'Suave salida' },
  { value: 'ease-in-out', label: 'Suave ambas' },
  { value: 'hold', label: 'Escalón' },
];

const PRESETS: readonly { id: string; label: string; points: readonly SpeedCurvePoint[] }[] = [
  {
    id: 'heroe',
    label: 'Héroe',
    points: [
      { t: 0, speed: 0.5, easing: 'ease-in-out' },
      { t: 1, speed: 2 },
    ],
  },
  {
    id: 'bala',
    label: 'Bala',
    points: [
      { t: 0, speed: 2, easing: 'ease-in' },
      { t: 1, speed: 0.5 },
    ],
  },
  {
    id: 'pulso',
    label: 'Pulso',
    points: [
      { t: 0, speed: 1 },
      { t: 0.3, speed: 0.45, easing: 'ease-in-out' },
      { t: 0.7, speed: 1.8, easing: 'ease-in-out' },
      { t: 1, speed: 1 },
    ],
  },
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function toX(t: number): number {
  return PAD + t * (WIDTH - PAD * 2);
}

function toY(speed: number): number {
  return HEIGHT - PAD - (speed / TOP_SPEED) * (HEIGHT - PAD * 2);
}

function clampSpeed(speed: number): number {
  return clamp(speed, MIN_RAMP_SPEED, MAX_RAMP_SPEED);
}

/** Controles cúbicos equivalentes al easing que evalúa el sampler. */
function easingControls(
  point: SpeedCurvePoint,
): readonly [number, number, number, number] {
  if (point.bezier) {
    const b = point.bezier;
    return [b.cp1X, b.cp1Y, b.cp2X, b.cp2Y];
  }
  switch (point.easing) {
    case 'ease-in':
      return [1 / 3, 0, 2 / 3, 0];
    case 'ease-out':
      return [1 / 3, 1, 2 / 3, 1];
    case 'ease-in-out':
      return [1 / 3, 0, 2 / 3, 1];
    case 'hold':
      return [1 / 3, 0, 2 / 3, 0];
    case 'linear':
    default:
      return [1 / 3, 1 / 3, 2 / 3, 2 / 3];
  }
}

function segmentPath(left: SpeedCurvePoint, right: SpeedCurvePoint): string {
  const x0 = toX(left.t);
  const y0 = toY(left.speed);
  const x1 = toX(right.t);
  const y1 = toY(right.speed);
  if (left.easing === 'hold' && !left.bezier) {
    return `L${x1} ${y0} L${x1} ${y1}`;
  }
  const [c1x, c1y, c2x, c2y] = easingControls(left);
  const bezier = new Bezier(
    { x: x0, y: y0 },
    { x: x0 + (x1 - x0) * c1x, y: y0 + (y1 - y0) * c1y },
    { x: x0 + (x1 - x0) * c2x, y: y0 + (y1 - y0) * c2y },
    { x: x1, y: y1 },
  );
  const lut = bezier.getLUT(24);
  return lut.map((point) => `L${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ');
}

export interface SpeedCurveEditorProps {
  readonly sourceFrames: number;
  readonly fps: number;
  readonly curve?: SpeedCurve | undefined;
  readonly disabled?: boolean;
  readonly onApply: (curve: SpeedCurve) => void;
  readonly onRemove?: (() => void) | undefined;
}

export function SpeedCurveEditor({
  sourceFrames,
  fps,
  curve,
  disabled = false,
  onApply,
  onRemove,
}: SpeedCurveEditorProps) {
  const [points, setPoints] = useState<readonly SpeedCurvePoint[]>(
    curve?.points ?? DEFAULT_CURVE.points,
  );
  const [opticalFlow, setOpticalFlow] = useState(curve?.opticalFlow === true);
  const [targetFps, setTargetFps] = useState<24 | 30 | 60 | 120>(curve?.targetFps ?? 60);
  const [selected, setSelected] = useState(0);
  const [dragging, setDragging] = useState<{ index: number; t: number; speed: number } | null>(
    null,
  );
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 2 } }),
  );

  const draft: SpeedCurve = { points: [...points] };
  const mean = meanSpeedCurve(draft);
  const durationFrames = curveDurationFrames(Math.max(1, sourceFrames), draft);
  const activePoint = points[selected];

  function updatePoint(index: number, patch: Partial<SpeedCurvePoint>): void {
    setPoints((current) =>
      current.map((point, position) =>
        position === index ? { ...point, ...patch } : point,
      ),
    );
  }

  function handleDragStart(event: DragStartEvent): void {
    if (disabled) return;
    const index = Number(event.active.id);
    const point = points[index];
    if (!point) return;
    setSelected(index);
    setDragging({ index, t: point.t, speed: point.speed });
  }

  function handleDragMove(event: DragMoveEvent): void {
    if (!dragging) return;
    const { index, t, speed } = dragging;
    const isEdge = index === 0 || index === points.length - 1;
    const previous = points[index - 1]?.t ?? 0;
    const next = points[index + 1]?.t ?? 1;
    const nextT = isEdge
      ? t
      : clamp(t + event.delta.x / (WIDTH - PAD * 2), previous + MIN_GAP, next - MIN_GAP);
    const nextSpeed = clampSpeed(
      speed + (event.delta.y / (HEIGHT - PAD * 2)) * TOP_SPEED * -1,
    );
    updatePoint(index, { t: nextT, speed: nextSpeed });
  }

  function addPoint(): void {
    let gapIndex = 0;
    let best = -1;
    for (let index = 0; index < points.length - 1; index += 1) {
      const gap = points[index + 1]!.t - points[index]!.t;
      if (gap > best) {
        best = gap;
        gapIndex = index;
      }
    }
    const left = points[gapIndex]!;
    const right = points[gapIndex + 1]!;
    const t = (left.t + right.t) / 2;
    const speed = clampSpeed(sampleSpeedCurve(draft, t));
    const next = [
      ...points.slice(0, gapIndex + 1),
      { t, speed, easing: 'ease-in-out' as const },
      ...points.slice(gapIndex + 1),
    ];
    setPoints(next);
    setSelected(gapIndex + 1);
  }

  function removePoint(): void {
    if (points.length <= 2 || selected === 0 || selected === points.length - 1) return;
    const next = points.filter((_, index) => index !== selected);
    setPoints(next);
    setSelected(Math.max(0, selected - 1));
  }

  function handleKeyDown(event: KeyboardEvent<SVGCircleElement>, index: number): void {
    setSelected(index);
    if (disabled) return;
    const point = points[index];
    if (!point) return;
    const isEdge = index === 0 || index === points.length - 1;
    if (event.key === 'ArrowLeft' && !isEdge) {
      event.preventDefault();
      updatePoint(index, { t: clamp(point.t - 0.01, 0.01, 0.99) });
    } else if (event.key === 'ArrowRight' && !isEdge) {
      event.preventDefault();
      updatePoint(index, { t: clamp(point.t + 0.01, 0.01, 0.99) });
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      updatePoint(index, { speed: clampSpeed(point.speed + 0.05) });
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      updatePoint(index, { speed: clampSpeed(point.speed - 0.05) });
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      if (points.length > 2 && !isEdge) {
        setPoints((current) => current.filter((_, position) => position !== index));
        setSelected(Math.max(0, index - 1));
      }
    }
  }

  const path = points
    .slice(0, -1)
    .map((point, index) => segmentPath(point, points[index + 1]!))
    .join(' ');

  return (
    <div className="speed-curve-editor">
      <div className="speed-curve-head">
        <span className="fine-print">
          {mean.toFixed(2)}× media · {durationFrames} frames ·{' '}
          {(durationFrames / Math.max(1, fps)).toFixed(2)} s
        </span>
      </div>
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragMove={handleDragMove}
        onDragEnd={() => setDragging(null)}
        onDragCancel={() => setDragging(null)}
      >
        <svg
          className="speed-curve-svg"
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="group"
          aria-label="Curva de velocidad continua"
        >
          {[0.5, 1, 2, 3, 4].map((speed) => (
            <g key={speed}>
              <line
                className="speed-curve-grid"
                x1={PAD}
                y1={toY(speed)}
                x2={WIDTH - PAD}
                y2={toY(speed)}
              />
              <text className="speed-curve-axis" x={2} y={toY(speed) + 3}>
                {speed}×
              </text>
            </g>
          ))}
          {[0.25, 0.5, 0.75].map((t) => (
            <line
              key={t}
              className="speed-curve-grid"
              x1={toX(t)}
              y1={PAD}
              x2={toX(t)}
              y2={HEIGHT - PAD}
            />
          ))}
          <path className="speed-curve-path" d={`M${toX(points[0]!.t)} ${toY(points[0]!.speed)} ${path}`} />
          {points.map((point, index) => (
            <CurveHandle
              key={index}
              index={index}
              point={point}
              selected={index === selected}
              disabled={disabled}
              onSelect={() => setSelected(index)}
              onKeyDown={(event) => handleKeyDown(event, index)}
            />
          ))}
        </svg>
      </DndContext>
      {activePoint ? (
        <div className="speed-curve-fields">
          <label className="field">
            <span>Tiempo (%)</span>
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              value={Math.round(activePoint.t * 100)}
              disabled={disabled || selected === 0 || selected === points.length - 1}
              onChange={(event) =>
                updatePoint(selected, {
                  t: clamp(Number(event.target.value) / 100, 0.01, 0.99),
                })
              }
            />
          </label>
          <label className="field">
            <span>Velocidad (×)</span>
            <input
              type="number"
              min={MIN_RAMP_SPEED}
              max={MAX_RAMP_SPEED}
              step={0.05}
              value={Number(activePoint.speed.toFixed(2))}
              disabled={disabled}
              onChange={(event) =>
                updatePoint(selected, { speed: clampSpeed(Number(event.target.value)) })
              }
            />
          </label>
          <label className="field">
            <span>Easing</span>
            <select
              value={activePoint.bezier ? 'custom' : activePoint.easing ?? 'linear'}
              disabled={disabled}
              onChange={(event) => {
                const value = event.target.value;
                if (value === 'custom') return;
                // Elegir un preset descarta un Bézier personalizado previo.
                setPoints((current) =>
                  current.map((point, index) =>
                    index === selected
                      ? { t: point.t, speed: point.speed, easing: value as KeyframeEasing }
                      : point,
                  ),
                );
              }}
            >
              {activePoint.bezier ? <option value="custom">Bézier personalizado</option> : null}
              {EASING_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}
      <div className="actions compact">
        {PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className="small"
            disabled={disabled}
            onClick={() => {
              setPoints(preset.points.map((point) => ({ ...point })));
              setSelected(0);
            }}
          >
            {preset.label}
          </button>
        ))}
        <button type="button" className="small" disabled={disabled} onClick={addPoint}>
          + Punto
        </button>
        <button
          type="button"
          className="small"
          disabled={disabled || points.length <= 2 || selected === 0 || selected === points.length - 1}
          onClick={removePoint}
        >
          − Quitar
        </button>
      </div>
      <label className="check">
        <input
          type="checkbox"
          checked={opticalFlow}
          disabled={disabled}
          onChange={(event) => setOpticalFlow(event.target.checked)}
        />
        <span>Interpolar frames con flujo óptico (minterpolate)</span>
      </label>
      <label className="field">
        <span>FPS objetivo</span>
        <select
          value={targetFps}
          disabled={disabled || !opticalFlow}
          onChange={(event) => setTargetFps(Number(event.target.value) as 24 | 30 | 60 | 120)}
        >
          {[24, 30, 60, 120].map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </label>
      <div className="actions compact">
        <button
          type="button"
          className="primary"
          disabled={disabled}
          onClick={() =>
            onApply({
              points: points.map((point) => ({ ...point })),
              ...(opticalFlow ? { opticalFlow: true, targetFps } : {}),
            })
          }
        >
          Aplicar curva
        </button>
        {onRemove ? (
          <button
            type="button"
            className="small ghost"
            disabled={disabled}
            onClick={onRemove}
          >
            Quitar curva
          </button>
        ) : null}
      </div>
      <p className="fine-print">
        Arrastrá los puntos o usá las flechas. La ventana de origen no cambia: la
        duración sale de la media. El audio acompaña la media de la curva.
      </p>
    </div>
  );
}

function CurveHandle({
  index,
  point,
  selected,
  disabled,
  onSelect,
  onKeyDown,
}: {
  readonly index: number;
  readonly point: SpeedCurvePoint;
  readonly selected: boolean;
  readonly disabled: boolean;
  readonly onSelect: () => void;
  readonly onKeyDown: (event: React.KeyboardEvent<SVGCircleElement>) => void;
}) {
  const { listeners, setNodeRef } = useDraggable({
    id: String(index),
    disabled,
  });
  return (
    <circle
      ref={(node) => setNodeRef(node as unknown as HTMLElement)}
      {...listeners}
      className={`speed-curve-point${selected ? ' selected' : ''}`}
      cx={toX(point.t)}
      cy={toY(point.speed)}
      r={selected ? 7 : 5}
      tabIndex={disabled ? -1 : 0}
      role="slider"
      aria-label={`Punto ${index + 1} de la curva`}
      aria-valuemin={MIN_RAMP_SPEED}
      aria-valuemax={MAX_RAMP_SPEED}
      aria-valuenow={Number(point.speed.toFixed(2))}
      aria-valuetext={`${point.speed.toFixed(2)} veces en ${Math.round(point.t * 100)} por ciento`}
      onFocus={onSelect}
      onPointerDown={onSelect}
      onKeyDown={onKeyDown}
    />
  );
}
