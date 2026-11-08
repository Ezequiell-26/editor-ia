import type { CSSProperties } from 'react';
import { layerVisual } from './plan';
import type { MotionPlan } from './templates';

/** Polígono regular de `sides` lados inscripto en la caja, primer vértice
 * arriba — mismos puntos que `polygon_drawing` del export ASS. */
function regularPolygonClipPath(sides: number): string {
  const points: string[] = [];
  for (let index = 0; index < sides; index += 1) {
    const angle = (-Math.PI / 2) + (index * 2 * Math.PI) / sides;
    const x = 50 + 50 * Math.cos(angle);
    const y = 50 + 50 * Math.sin(angle);
    points.push(`${x.toFixed(2)}% ${y.toFixed(2)}%`);
  }
  return `polygon(${points.join(', ')})`;
}

/** Flecha hacia arriba: punta al centro-superior, cola abierta abajo.
 * Coordenadas normalizadas 0..1 — las mismas que usa `polygon_drawing`. */
function arrowClipPath(): string {
  const points: [number, number][] = [
    [0.5, 0],
    [0.85, 0.38],
    [0.66, 0.38],
    [0.66, 1],
    [0.34, 1],
    [0.34, 0.38],
    [0.15, 0.38],
  ];
  return `polygon(${points.map(([x, y]) => `${x * 100}% ${y * 100}%`).join(', ')})`;
}

/** Estrella de 5 puntas: 10 vértices alternando radio externo (100%) e
 * interno (50%) sobre la elipse inscripta — mismos puntos que `polygon_drawing`
 * del export ASS. */
function starClipPath(): string {
  const points: string[] = [];
  for (let index = 0; index < 10; index += 1) {
    const angle = (-Math.PI / 2) + (index * Math.PI) / 5;
    const radius = index % 2 === 0 ? 1 : 0.5;
    const x = 50 + 50 * radius * Math.cos(angle);
    const y = 50 + 50 * radius * Math.sin(angle);
    points.push(`${x.toFixed(2)}% ${y.toFixed(2)}%`);
  }
  return `polygon(${points.join(', ')})`;
}

export function MotionPreview({
  plan,
  progress,
}: {
  readonly plan: MotionPlan;
  readonly progress: number;
}) {
  return (
    <div
      className="motion-preview"
      style={{
        aspectRatio: `${plan.width} / ${plan.height}`,
        containerType: 'inline-size',
      }}
      aria-label="Previsualización de motion graphics"
    >
      {plan.layers.map((layer, index) => {
        const visual = layerVisual(layer, progress, plan.durationFrames);
        const common: CSSProperties = {
          position: 'absolute',
          left: `${layer.x * 100}%`,
          top: `${layer.y * 100}%`,
          width: `${layer.width * 100}%`,
          height: `${layer.height * 100}%`,
          opacity: visual.opacity,
          transform: visual.transform,
        };
        if (layer.kind === 'rect') {
          const shape = layer.shape ?? 'rect';
          // clip-path en porcentajes del propio div: triángulo, rombo y
          // estrella se ven igual que el polígono ASS del export (mismos
          // vértices: estrella = 10 puntos alternando radio externo/interno).
          const clipPath =
            shape === 'triangle'
              ? 'polygon(50% 0%, 100% 100%, 0% 100%)'
              : shape === 'diamond'
                ? 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)'
                : shape === 'star'
                  ? starClipPath()
                  : shape === 'pentagon'
                    ? regularPolygonClipPath(5)
                    : shape === 'hexagon'
                      ? regularPolygonClipPath(6)
                      : shape === 'arrow'
                        ? arrowClipPath()
                        : undefined;
          return (
            <div
              key={`${layer.kind}-${index}`}
              data-layer-kind="rect"
              data-shape={shape}
              style={{
                ...common,
                background: layer.color,
                borderRadius: shape === 'ellipse' ? '50%' : shape === 'rect' ? 8 : 0,
                ...(clipPath ? { clipPath } : {}),
              }}
            />
          );
        }
        return (
          <div
            key={`${layer.kind}-${index}`}
            data-layer-kind="text"
            style={{
              ...common,
              color: layer.color,
              fontFamily: layer.fontFamily,
              fontSize: `${(layer.fontSizePx / plan.width) * 100}cqw`,
              fontWeight: layer.weight,
              textAlign: layer.align,
              lineHeight: 1.05,
              whiteSpace: 'pre-wrap',
              overflow: 'hidden',
            }}
          >
            {layer.text}
          </div>
        );
      })}
    </div>
  );
}
