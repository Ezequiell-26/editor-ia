import { useRef, useState } from 'react';
import type { MaskPoint } from '@editor-ia/project-schema';

/**
 * Editor de vértices del polígono de máscara (paridad del «editor de
 * formas con handles» de AlaukCut `formas.js`): SVG 100×100 con la
 * silueta y un handle por vértice; arrastrar actualiza el punto en
 * coordenadas normalizadas 0..1 de la máscara.
 */
export function PolygonPointEditor({
  points,
  onChange,
}: {
  readonly points: readonly MaskPoint[];
  readonly onChange: (points: MaskPoint[]) => void;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const polygon = points.map((point) => `${point.x * 100},${point.y * 100}`).join(' ');

  function pointFromEvent(event: React.PointerEvent<SVGSVGElement>): MaskPoint {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return { x: 0.5, y: 0.5 };
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    };
  }

  function handlePointerMove(event: React.PointerEvent<SVGSVGElement>): void {
    if (dragIndex === null) return;
    const next = pointFromEvent(event);
    onChange(points.map((point, index) => (index === dragIndex ? next : point)));
  }

  return (
    <svg
      ref={svgRef}
      className="polygon-point-editor"
      viewBox="0 0 100 100"
      role="application"
      aria-label="Editor de vértices del polígono"
      onPointerMove={handlePointerMove}
      onPointerUp={() => setDragIndex(null)}
      onPointerLeave={() => setDragIndex(null)}
    >
      <polygon
        points={polygon}
        fill="rgba(62, 228, 255, 0.12)"
        stroke="#3fe4ff"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
      {points.map((point, index) => (
        <circle
          key={index}
          cx={point.x * 100}
          cy={point.y * 100}
          r="3.5"
          fill={dragIndex === index ? '#ffffff' : '#3fe4ff'}
          stroke="#0b0e13"
          strokeWidth="1"
          style={{ cursor: 'grab', touchAction: 'none' }}
          onPointerDown={(event) => {
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            setDragIndex(index);
          }}
        />
      ))}
    </svg>
  );
}
