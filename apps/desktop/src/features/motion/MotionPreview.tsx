import type { CSSProperties } from 'react';
import { layerVisual } from '../../state/motion-plan';
import type { MotionPlan } from '../../state/motion-templates';

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

/** Paralelogramo y trapecio de `formas.js` (AlaukCut): paralelogramo con
 * lados inclinados ~22 %, trapecio con base inferior más ancha. Mismos
 * vértices que `polygon_drawing` del export ASS. */
function parallelogramClipPath(): string {
  return 'polygon(22% 0%, 100% 0%, 78% 100%, 0% 100%)';
}
function trapezoidClipPath(): string {
  return 'polygon(25% 0%, 75% 0%, 100% 100%, 0% 100%)';
}

/** Corazón de `formas.js`: muestreo de 18 puntos de la misma tabla que la
 * máscara `heart` de Preview.tsx (curva implícita del render), escalada
 * ×0.52 para entrar en la caja de la capa — cúspide abajo. */
const HEART_POINTS: ReadonlyArray<readonly [number, number]> = [
  [0, -0.72], [0.28, -0.78], [0.55, -0.62], [0.72, -0.38],
  [0.82, -0.1], [0.8, 0.18], [0.62, 0.42], [0.4, 0.62],
  [0.18, 0.78], [0, 0.86], [-0.18, 0.78], [-0.4, 0.62],
  [-0.62, 0.42], [-0.8, 0.18], [-0.82, -0.1], [-0.72, -0.38],
  [-0.55, -0.62], [-0.28, -0.78],
];
function heartClipPath(): string {
  const points = HEART_POINTS.map(
    ([u, v]) => `${((0.5 + u * 0.52) * 100).toFixed(2)}% ${((0.5 + v * 0.52) * 100).toFixed(2)}%`,
  );
  return `polygon(${points.join(', ')})`;
}

/** Mano señalando a la derecha (16 puntos, mismos vértices que
 * `polygon_drawing`/`HAND_POINTS` de Rust): índice extendido, pulgar
 * arriba, dorso con tres nudillos. Coordenadas 0..1 dentro de la caja. */
const HAND_POINTS: ReadonlyArray<readonly [number, number]> = [
  [0.98, 0.16], [1.0, 0.3], [0.84, 0.38], [0.74, 0.3],
  [0.6, 0.12], [0.52, 0.0], [0.42, 0.14], [0.34, 0.3],
  [0.16, 0.42], [0.14, 0.66], [0.34, 0.84], [0.6, 0.9],
  [0.74, 0.82], [0.84, 0.7], [0.9, 0.56], [0.92, 0.44],
];
function handClipPath(): string {
  const points = HAND_POINTS.map(
    ([x, y]) => `${(x * 100).toFixed(2)}% ${(y * 100).toFixed(2)}%`,
  );
  return `polygon(${points.join(', ')})`;
}

/** Vértices normalizados 0..100 de cada forma para el SVG de trazo —
 * mismos puntos que `polygon_drawing`/clip-path. */
function shapeSvgPoints(
  shape: string,
  custom?: readonly { x: number; y: number }[],
): string | null {
  const pts = (list: readonly (readonly [number, number])[]) =>
    list.map(([x, y]) => `${x * 100},${y * 100}`).join(' ');
  switch (shape) {
    case 'triangle':
      return pts([[0.5, 0], [1, 1], [0, 1]]);
    case 'diamond':
      return pts([[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]]);
    case 'star': {
      const list: [number, number][] = [];
      for (let index = 0; index < 10; index += 1) {
        const angle = (-Math.PI / 2) + (index * Math.PI) / 5;
        const radius = index % 2 === 0 ? 1 : 0.5;
        list.push([0.5 + 0.5 * radius * Math.cos(angle), 0.5 + 0.5 * radius * Math.sin(angle)]);
      }
      return pts(list);
    }
    case 'pentagon':
    case 'hexagon': {
      const sides = shape === 'pentagon' ? 5 : 6;
      const list: [number, number][] = [];
      for (let index = 0; index < sides; index += 1) {
        const angle = (-Math.PI / 2) + (index * 2 * Math.PI) / sides;
        list.push([0.5 + 0.5 * Math.cos(angle), 0.5 + 0.5 * Math.sin(angle)]);
      }
      return pts(list);
    }
    case 'arrow':
      return pts([
        [0.5, 0], [0.85, 0.38], [0.66, 0.38], [0.66, 1], [0.34, 1], [0.34, 0.38], [0.15, 0.38],
      ]);
    case 'parallelogram':
      return pts([[0.22, 0], [1, 0], [0.78, 1], [0, 1]]);
    case 'trapezoid':
      return pts([[0.25, 0], [0.75, 0], [1, 1], [0, 1]]);
    case 'heart':
      return pts(HEART_POINTS.map(([u, v]) => [0.5 + u * 0.52, 0.5 + v * 0.52] as const));
    case 'hand':
      return pts(HAND_POINTS);
    case 'custom':
      return custom && custom.length >= 3 ? pts(custom.map((p) => [p.x, p.y] as const)) : null;
    default:
      return null;
  }
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
          ...(visual.clipPath ? { clipPath: visual.clipPath } : {}),
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
                        : shape === 'parallelogram'
                          ? parallelogramClipPath()
                          : shape === 'trapezoid'
                            ? trapezoidClipPath()
                            : shape === 'heart'
                              ? heartClipPath()
                              : shape === 'hand'
                                ? handClipPath()
                              : shape === 'custom' && Array.isArray(layer.points)
                          ? `polygon(${layer.points
                              .map(
                                (point) =>
                                  `${(point.x * 100).toFixed(2)}% ${(point.y * 100).toFixed(2)}%`,
                              )
                              .join(', ')})`
                          : undefined;
          // strokeWidth es fracción del lado menor de la capa; en el
          // viewBox 0-100 eso equivale a strokeWidth*100*min(w,h).
          const isLine = shape === 'line';
          // `line` es una polilínea abierta: no hay relleno, sólo trazo.
          const linePoints =
            isLine && Array.isArray(layer.points) && layer.points.length >= 2
              ? layer.points.map((p) => `${p.x * 100},${p.y * 100}`).join(' ')
              : null;
          const strokeWidth = (layer.strokeWidth ?? 0) * 100 * Math.min(layer.width, layer.height);
          const strokePoints =
            !isLine && strokeWidth > 0 && shape !== 'ellipse' && shape !== 'rect'
              ? shapeSvgPoints(shape, layer.points)
              : null;
          const shadow = layer.shadow;
          // offsetPx está en px de proyecto; el preview usa cqw (1cqw = 1% del
          // ancho del contenedor) para que la sombra escale con la vista.
          // angleDeg: 90 = abajo, 0 = derecha (y hacia abajo en pantalla).
          const shadowDistanceCqw =
            shadow && plan.width > 0 ? (shadow.offsetPx / plan.width) * 100 : 0;
          const shadowAngle = ((shadow?.angleDeg ?? 90) * Math.PI) / 180;
          const shadowX = shadowDistanceCqw * Math.cos(shadowAngle);
          const shadowY = shadowDistanceCqw * Math.sin(shadowAngle);
          const shadowOpacity = shadow?.opacity ?? 1;
          const shadowBlurCqw =
            shadow && plan.width > 0 ? (shadow.blurPx ?? 0) / plan.width * 100 : 0;
          const hexToRgba = (hex: string, alpha: number): string => {
            const value = parseInt(hex.slice(1), 16);
            const r = (value >> 16) & 255;
            const g = (value >> 8) & 255;
            const b = value & 255;
            return `rgba(${r},${g},${b},${alpha})`;
          };
          const shadowFilter =
            shadow && shadowDistanceCqw > 0
              ? `drop-shadow(${shadowX.toFixed(3)}cqw ${shadowY.toFixed(3)}cqw ${shadowBlurCqw.toFixed(3)}cqw ${hexToRgba(shadow.color, shadowOpacity)})`
              : undefined;
          return (
            <div
              key={`${layer.kind}-${index}`}
              data-layer-kind="rect"
              data-shape={shape}
              style={{
                ...common,
                background: isLine ? 'transparent' : layer.color,
                borderRadius: shape === 'ellipse' ? '50%' : shape === 'rect' ? 8 : 0,
                ...(clipPath ? { clipPath } : {}),
                ...(shadowFilter ? { filter: shadowFilter } : {}),
              }}
            >
              {strokeWidth > 0 ? (
                <svg
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    inset: 0,
                    width: '100%',
                    height: '100%',
                    overflow: 'visible',
                    pointerEvents: 'none',
                  }}
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                >
                  {isLine && linePoints ? (
                    <polyline
                      points={linePoints}
                      fill="none"
                      stroke={layer.strokeColor ?? layer.color}
                      strokeWidth={Math.max(strokeWidth, 1.5)}
                      strokeOpacity={layer.strokeOpacity ?? 1}
                      strokeLinecap="butt"
                      strokeLinejoin="miter"
                    />
                  ) : shape === 'ellipse' ? (
                    <ellipse
                      cx="50"
                      cy="50"
                      rx="50"
                      ry="50"
                      fill="none"
                      stroke={layer.strokeColor ?? '#ffffff'}
                      strokeWidth={strokeWidth}
                      strokeOpacity={layer.strokeOpacity ?? 1}
                    />
                  ) : shape === 'rect' ? (
                    <rect
                      x="0"
                      y="0"
                      width="100"
                      height="100"
                      rx="8"
                      fill="none"
                      stroke={layer.strokeColor ?? '#ffffff'}
                      strokeWidth={strokeWidth}
                      strokeOpacity={layer.strokeOpacity ?? 1}
                    />
                  ) : strokePoints ? (
                    <polygon
                      points={strokePoints}
                      fill="none"
                      stroke={layer.strokeColor ?? '#ffffff'}
                      strokeWidth={strokeWidth}
                      strokeOpacity={layer.strokeOpacity ?? 1}
                    />
                  ) : null}
                </svg>
              ) : null}
            </div>
          );
        }
        if (layer.kind === 'stroke') {
          // Trazo que se dibuja solo (paridad `contorno.js`): un <rect> SVG
          // con pathLength=1 y dasharray recortado por el progreso coseno —
          // mismo easing que emite el export ASS por segmentos.
          const fps = plan.fps.num / Math.max(1, plan.fps.den);
          const clipSeconds = (progress * plan.durationFrames) / Math.max(1, fps);
          const drawSeconds = Math.max(0, layer.drawSeconds);
          const raw =
            drawSeconds > 0 ? Math.min(1, clipSeconds / drawSeconds) : 1;
          const drawn = raw >= 1 ? 1 : (1 - Math.cos(Math.PI * raw)) / 2;
          const thicknessPx = layer.thickness * Math.min(plan.width, plan.height);
          const inset = thicknessPx / 2;
          return (
            <svg
              key={`${layer.kind}-${index}`}
              data-layer-kind="stroke"
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                width: '100%',
                height: '100%',
                opacity: visual.opacity * layer.opacity,
                overflow: 'visible',
              }}
              viewBox={`0 0 ${plan.width} ${plan.height}`}
              aria-hidden="true"
            >
              <rect
                x={layer.x * plan.width + inset}
                y={layer.y * plan.height + inset}
                width={Math.max(0, layer.width * plan.width - thicknessPx)}
                height={Math.max(0, layer.height * plan.height - thicknessPx)}
                rx={Math.min(
                  layer.radius * Math.min(layer.width * plan.width, layer.height * plan.height),
                  Math.min(layer.width * plan.width, layer.height * plan.height) / 2,
                )}
                fill="none"
                stroke={layer.color}
                strokeWidth={thicknessPx}
                strokeLinecap="round"
                strokeLinejoin="round"
                pathLength={1}
                strokeDasharray={`${Math.max(0, drawn)} ${Math.max(0.0001, 1 - drawn)}`}
              />
            </svg>
          );
        }
        const skewX = layer.skewXDeg ?? 0;
        const skewY = layer.skewYDeg ?? 0;
        const skewTransform =
          skewX !== 0 || skewY !== 0
            ? `skewX(${skewX}deg)${skewY !== 0 ? ` skewY(${skewY}deg)` : ''}`
            : undefined;
        return (
          <div
            key={`${layer.kind}-${index}`}
            data-layer-kind="text"
            style={{
              ...common,
              transform:
                [visual.transform, skewTransform].filter(Boolean).join(' ') ||
                undefined,
              color: layer.color,
              fontFamily: layer.fontFamily,
              fontSize: `${(layer.fontSizePx / plan.width) * 100}cqw`,
              fontWeight: layer.weight,
              textAlign: layer.align,
              lineHeight: 1.05,
              whiteSpace: 'pre-wrap',
              overflow: 'hidden',
              textShadow: (() => {
                const shadow = layer.shadow;
                if (!shadow) return undefined;
                const distanceCqw = (shadow.offsetPx / plan.width) * 100;
                const angle = ((shadow.angleDeg ?? 90) * Math.PI) / 180;
                const dx = distanceCqw * Math.cos(angle);
                const dy = distanceCqw * Math.sin(angle);
                const blurCqw = (shadow.blurPx ?? 0) / plan.width * 100;
                const value = parseInt(shadow.color.slice(1), 16);
                const alpha = shadow.opacity ?? 1;
                const color = `rgba(${(value >> 16) & 255},${(value >> 8) & 255},${value & 255},${alpha})`;
                return `${dx.toFixed(3)}cqw ${dy.toFixed(3)}cqw ${blurCqw.toFixed(3)}cqw ${color}`;
              })(),
            }}
          >
            {layer.text}
          </div>
        );
      })}
    </div>
  );
}
