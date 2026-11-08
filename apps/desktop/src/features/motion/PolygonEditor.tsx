import { useRef, useState } from 'react';
import type { MotionPoint } from './templates';

const MIN_POINTS = 3;
const MAX_POINTS = 16;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Punto del evento dentro del SVG normalizado a 0..1. */
function pointFromEvent(
  clientX: number,
  clientY: number,
  svg: SVGSVGElement,
): MotionPoint {
  const rect = svg.getBoundingClientRect();
  return {
    x: clamp01((clientX - rect.left) / Math.max(1, rect.width)),
    y: clamp01((clientY - rect.top) / Math.max(1, rect.height)),
  };
}

/**
 * Editor de vértices del polígono `shape: 'custom'` del titler: clic en el
 * fondo agrega un punto, arrastrar un vértice lo mueve y doble clic lo quita
 * (mínimo 3). Las coordenadas son 0..1 dentro de la caja de la capa — las
 * mismas que consume `polygon()` del clip-path del preview y el dibujo ASS
 * del export.
 */
export function PolygonEditor({
  value,
  onChange,
  disabled = false,
}: {
  readonly value: unknown;
  readonly onChange: (points: MotionPoint[]) => void;
  readonly disabled?: boolean;
}) {
  const points: MotionPoint[] = Array.isArray(value)
    ? value
        .filter(
          (point): point is MotionPoint =>
            typeof point === 'object' &&
            point !== null &&
            typeof (point as MotionPoint).x === 'number' &&
            typeof (point as MotionPoint).y === 'number' &&
            (point as MotionPoint).x >= 0 &&
            (point as MotionPoint).x <= 1 &&
            (point as MotionPoint).y >= 0 &&
            (point as MotionPoint).y <= 1,
        )
        .map((point) => ({ x: point.x, y: point.y }))
        .slice(0, MAX_POINTS)
    : [];
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const polygon = `${points.map((point) => `${point.x * 100},${point.y * 100}`).join(' ')}`;

  const addPoint = (event: React.MouseEvent<SVGSVGElement>): void => {
    if (disabled || points.length >= MAX_POINTS || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    onChange([
      ...points,
      {
        x: clamp01((event.clientX - rect.left) / Math.max(1, rect.width)),
        y: clamp01((event.clientY - rect.top) / Math.max(1, rect.height)),
      },
    ]);
  };

  const movePoint = (index: number, clientX: number, clientY: number): void => {
    if (disabled || !svgRef.current) return;
    const next = pointFromEvent(clientX, clientY, svgRef.current);
    onChange(points.map((point, i) => (i === index ? next : point)));
  };

  const removePoint = (index: number): void => {
    if (disabled || points.length <= MIN_POINTS) return;
    onChange(points.filter((_, i) => i !== index));
  };

  return (
    <div className="motion-polygon-editor">
      <svg
        ref={svgRef}
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="motion-polygon-svg"
        data-disabled={disabled ? 'true' : undefined}
        role="img"
        aria-label="Editor de puntos de la forma personalizada"
        onClick={addPoint}
      >
        {points.length >= MIN_POINTS ? (
          <polygon
            points={polygon}
            className="motion-polygon-shape"
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
        {points.map((point, index) => (
          <circle
            key={index}
            cx={point.x * 100}
            cy={point.y * 100}
            r={dragIndex === index ? 4 : 3}
            className="motion-polygon-vertex"
            role="button"
            aria-label={`Vértice ${index + 1} de la forma`}
            tabIndex={disabled ? -1 : 0}
            onPointerDown={(event) => {
              if (disabled) return;
              event.stopPropagation();
              event.currentTarget.setPointerCapture?.(event.pointerId);
              setDragIndex(index);
            }}
            onClick={(event) => event.stopPropagation()}
            onPointerMove={(event) => {
              if (dragIndex === index) movePoint(index, event.clientX, event.clientY);
            }}
            onPointerUp={() => setDragIndex(null)}
            onDoubleClick={(event) => {
              event.stopPropagation();
              removePoint(index);
            }}
          />
        ))}
      </svg>
      <span className="motion-polygon-hint">
        {disabled
          ? 'Elegí «Personalizada» en Forma para editar los puntos.'
          : `Clic agrega un punto · arrastrá un vértice · doble clic lo quita (${points.length}/${MAX_POINTS})`}
      </span>
    </div>
  );
}
