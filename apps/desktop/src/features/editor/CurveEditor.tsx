import { useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import {
  CURVE_CHANNELS,
  curvePointsFor,
  hasCustomCurves,
  sampleCurvePoints,
  type ClipCurves,
  type CurveChannel,
  type CurvePoint,
} from '@editor-ia/project-schema';

const GRAPH = 208;
const PAD = 12;
const INNER = GRAPH - PAD * 2;
const MIN_GAP = 0.02;
const MAX_POINTS = 16;

const LABELS: Record<CurveChannel, string> = {
  master: 'Maestro',
  red: 'Rojo',
  green: 'Verde',
  blue: 'Azul',
};

const COLORS: Record<CurveChannel, string> = {
  master: '#4b8fd6',
  red: '#ff7a7a',
  green: '#63e6a0',
  blue: '#5aa9ff',
};

const wrapStyle: CSSProperties = {
  display: 'grid',
  gap: 8,
  marginTop: 4,
};

const tabsStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 4,
};

const readoutStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 8,
  fontSize: 11,
  opacity: 0.82,
};

function tabStyle(active: boolean, custom: boolean, color: string): CSSProperties {
  return {
    flex: '1 1 auto',
    minWidth: 54,
    padding: '4px 6px',
    borderRadius: 6,
    border: `1px solid ${active ? color : 'rgba(255,255,255,0.14)'}`,
    background: active ? `${color}22` : 'transparent',
    color: active ? color : 'inherit',
    fontSize: 11,
    cursor: 'pointer',
    fontWeight: custom ? 700 : 500,
  };
}

function withChannel(
  curves: ClipCurves | undefined,
  channel: CurveChannel,
  points: CurvePoint[],
): ClipCurves {
  const next: ClipCurves = { ...curves };
  next[channel] = points;
  return next;
}

function withoutChannel(curves: ClipCurves | undefined, channel: CurveChannel): ClipCurves | undefined {
  const next: ClipCurves = { ...curves };
  delete next[channel];
  return hasCustomCurves(next) ? next : undefined;
}

function graphX(x: number): number {
  return PAD + x * INNER;
}

function graphY(y: number): number {
  return PAD + (1 - y) * INNER;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function CurveEditor({
  curves,
  onChange,
}: {
  readonly curves: ClipCurves | undefined;
  readonly onChange: (next: ClipCurves | undefined) => void;
}) {
  const [channel, setChannel] = useState<CurveChannel>('master');
  const [dragging, setDragging] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const points = curvePointsFor(curves, channel);
  const color = COLORS[channel];

  const path = useMemo(() => {
    return Array.from({ length: 41 }, (_, index) => {
      const x = index / 40;
      const command = index === 0 ? 'M' : 'L';
      return `${command}${graphX(x).toFixed(2)} ${graphY(sampleCurvePoints(points, x)).toFixed(2)}`;
    }).join(' ');
  }, [points]);

  function toUnit(event: ReactPointerEvent): CurvePoint {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 };
    const x = (event.clientX - rect.left - PAD) / INNER;
    const y = 1 - (event.clientY - rect.top - PAD) / INNER;
    return { x: clamp(x, 0, 1), y: clamp(y, 0, 1) };
  }

  function startDrag(index: number, event: ReactPointerEvent): void {
    event.stopPropagation();
    event.preventDefault();
    setDragging(index);
    setSelected(index);
    svgRef.current?.setPointerCapture(event.pointerId);
  }

  function move(event: ReactPointerEvent): void {
    if (dragging === null) return;
    const unit = toUnit(event);
    const next = points.map((point) => ({ ...point }));
    const current = next[dragging];
    if (!current) return;
    if (dragging === 0) {
      current.x = 0;
      current.y = unit.y;
    } else if (dragging === next.length - 1) {
      current.x = 1;
      current.y = unit.y;
    } else {
      const left = next[dragging - 1]?.x ?? 0;
      const right = next[dragging + 1]?.x ?? 1;
      current.x = clamp(unit.x, left + MIN_GAP, right - MIN_GAP);
      current.y = unit.y;
    }
    onChange(withChannel(curves, channel, next));
  }

  function endDrag(event: ReactPointerEvent): void {
    if (dragging === null) return;
    setDragging(null);
    if (svgRef.current?.hasPointerCapture(event.pointerId)) {
      svgRef.current.releasePointerCapture(event.pointerId);
    }
  }

  function addPoint(event: ReactPointerEvent): void {
    if (points.length >= MAX_POINTS) return;
    const unit = toUnit(event);
    if (unit.x <= 0.001 || unit.x >= 0.999) return;
    const index = points.findIndex((point) => point.x > unit.x);
    const insertAt = index === -1 ? points.length - 1 : index;
    const next = points.map((point) => ({ ...point }));
    const y = sampleCurvePoints(points, unit.x);
    next.splice(insertAt, 0, { x: unit.x, y });
    onChange(withChannel(curves, channel, next));
    setSelected(insertAt);
  }

  function removePoint(index: number): void {
    if (index <= 0 || index >= points.length - 1 || points.length <= 2) return;
    const next = points.filter((_, position) => position !== index).map((point) => ({ ...point }));
    onChange(withChannel(curves, channel, next));
    setSelected(null);
    setDragging(null);
  }

  function resetChannel(): void {
    onChange(withoutChannel(curves, channel));
    setSelected(null);
    setDragging(null);
  }

  const selectedPoint = selected !== null ? points[selected] : undefined;

  return (
    <div style={wrapStyle}>
      <div style={tabsStyle} role="tablist" aria-label="Canal de la curva">
        {CURVE_CHANNELS.map((item) => {
          const custom = curves?.[item] !== undefined;
          return (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={channel === item}
              style={tabStyle(channel === item, custom, COLORS[item])}
              onClick={() => {
                setChannel(item);
                setSelected(null);
                setDragging(null);
              }}
            >
              {LABELS[item]}
              {custom ? ' •' : ''}
            </button>
          );
        })}
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${GRAPH} ${GRAPH}`}
        width="100%"
        height={GRAPH}
        role="img"
        aria-label={`Curva ${LABELS[channel]}: ${points.length} puntos`}
        style={{ touchAction: 'none', cursor: 'crosshair', borderRadius: 8, background: '#0b0e13' }}
        onPointerMove={move}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <rect
          x={PAD}
          y={PAD}
          width={INNER}
          height={INNER}
          fill="rgba(255,255,255,0.02)"
          stroke="rgba(255,255,255,0.18)"
          onPointerDown={(event) => {
            addPoint(event);
            svgRef.current?.setPointerCapture(event.pointerId);
          }}
        />
        {[0.25, 0.5, 0.75].map((fraction) => (
          <g key={fraction} pointerEvents="none">
            <line
              x1={graphX(fraction)}
              y1={PAD}
              x2={graphX(fraction)}
              y2={PAD + INNER}
              stroke="rgba(255,255,255,0.08)"
            />
            <line
              x1={PAD}
              y1={graphY(fraction)}
              x2={PAD + INNER}
              y2={graphY(fraction)}
              stroke="rgba(255,255,255,0.08)"
            />
          </g>
        ))}
        <line
          x1={graphX(0)}
          y1={graphY(0)}
          x2={graphX(1)}
          y2={graphY(1)}
          stroke="rgba(255,255,255,0.18)"
          strokeDasharray="4 5"
          pointerEvents="none"
        />
        <path d={path} fill="none" stroke={color} strokeWidth={2} pointerEvents="none" />
        {points.map((point, index) => (
          <circle
            key={`${index}-${point.x.toFixed(4)}`}
            cx={graphX(point.x)}
            cy={graphY(point.y)}
            r={selected === index ? 6.5 : 5}
            fill={selected === index ? '#0b0e13' : color}
            stroke={color}
            strokeWidth={2}
            style={{ cursor: index === 0 || index === points.length - 1 ? 'ns-resize' : 'grab' }}
            onPointerDown={(event) => startDrag(index, event)}
            onDoubleClick={(event) => {
              event.stopPropagation();
              removePoint(index);
            }}
          >
            <title>
              {`Punto ${index + 1}: x ${point.x.toFixed(2)} → y ${point.y.toFixed(2)} (doble clic para quitarlo)`}
            </title>
          </circle>
        ))}
      </svg>
      <div style={readoutStyle}>
        <span>
          x {selectedPoint ? selectedPoint.x.toFixed(2) : '—'} → y{' '}
          {selectedPoint ? selectedPoint.y.toFixed(2) : '—'} · {points.length}/{MAX_POINTS} puntos
        </span>
        <button
          type="button"
          className="small"
          onClick={resetChannel}
          disabled={curves?.[channel] === undefined}
        >
          Lineal
        </button>
      </div>
      <p className="fine-print" style={{ margin: 0 }}>
        Clic en el gráfico agrega un punto; arrastrá para moverlo; doble clic quita uno intermedio.
        Los extremos fijan negro y blanco.
      </p>
    </div>
  );
}
