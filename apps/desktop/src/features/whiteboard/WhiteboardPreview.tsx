import { useEffect, useMemo, useRef, useState } from 'react';
import {
  buildWhiteboardSchedule,
  whiteboardFrameAt,
  type WhiteboardEasing,
  type WhiteboardStroke,
} from './whiteboard';
import { handVariantFor, whiteboardHandStyle } from './hands';

/** Alto del viewBox; el ancho se deriva del aspect (unidades = fracción de alto). */
const VIEW_H = 1000;
/** Altura de la mano como fracción del alto del lienzo (Inkplainer ≈ 0.7). */
const HAND_HEIGHT = 0.52;
/** Pausa extra con el dibujo completo antes de reiniciar el loop. */
const LOOP_HOLD_SECONDS = 1.2;
/**
 * "Smooth hand movement" de Inkplainer: la mano nunca teletransporta; el
 * CSS transition limita su velocidad percibida entre frames del rAF.
 */
const HAND_GLIDE_MS = 110;

export interface WhiteboardPreviewProps {
  readonly strokes: readonly WhiteboardStroke[];
  readonly aspect: number;
  /** Velocidad de dibujo en unidades de altura por segundo. */
  readonly speed: number;
  readonly inkHex: string;
  readonly boardHex: string;
  readonly showHand: boolean;
  readonly handStyle: string;
  readonly easing?: WhiteboardEasing;
  /** Si es false la preview queda congelada en el frame actual. */
  readonly playing?: boolean;
  /** Escala extra de la mano (1 = tamaño default). */
  readonly handScale?: number;
}

/**
 * Preview procedural del efecto whiteboard: trazos SVG que se dibujan con
 * `pathLength`/`stroke-dasharray` (misma técnica que `MotionPreview`) y la
 * mano (sprites webp de Inkplainer-OS) siguiendo la punta del trazo. El
 * "glide" de la mano se resuelve con una transición CSS sobre el <g> que la
 * contiene (equivalente al MAX_GLIDE_PX de `drawHand` en Inkplainer).
 */
export function WhiteboardPreview({
  strokes,
  aspect,
  speed,
  inkHex,
  boardHex,
  showHand,
  handStyle,
  easing = 'linear',
  playing = true,
  handScale = 1,
}: WhiteboardPreviewProps) {
  const schedule = useMemo(
    () => buildWhiteboardSchedule(strokes, { aspect, speed, gap: 0.18 }),
    [strokes, aspect, speed],
  );
  const viewW = Math.max(1, Math.round(VIEW_H * aspect));
  const style = whiteboardHandStyle(handStyle);
  const variant = handVariantFor(style, aspect);

  const [time, setTime] = useState(0);
  const lastTs = useRef<number | null>(null);

  useEffect(() => {
    if (!playing) return undefined;
    lastTs.current = null;
    // jsdom (tests) no siempre implementa rAF: caemos a setTimeout(~60fps).
    const scheduleFrame =
      typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame
        : (cb: FrameRequestCallback) => window.setTimeout(() => cb(performance.now()), 16);
    const cancelFrame =
      typeof cancelAnimationFrame === 'function'
        ? cancelAnimationFrame
        : (id: number) => window.clearTimeout(id);
    let handle = 0;
    const tick = (ts: number) => {
      const prev = lastTs.current;
      lastTs.current = ts;
      if (prev !== null) {
        const dt = Math.min(0.1, (ts - prev) / 1000);
        setTime((current) => {
          const next = current + dt;
          const limit = schedule.totalDuration + LOOP_HOLD_SECONDS;
          return next > limit ? 0 : next;
        });
      }
      handle = scheduleFrame(tick);
    };
    handle = scheduleFrame(tick);
    return () => cancelFrame(handle);
  }, [playing, schedule.totalDuration]);

  const frame = whiteboardFrameAt(schedule, time, easing);

  // Posición de la mano en unidades de viewBox: la punta del trazo menos el
  // ancla `tipU`/`tipV` del sprite (misma cuenta que `drawCustomHand`).
  const handVisible = showHand && frame.tip !== null;
  const spriteH = VIEW_H * HAND_HEIGHT * handScale;
  const spriteW = spriteH * (variant.width / Math.max(1, variant.height));
  const handX = frame.tip ? frame.tip.x * viewW - variant.tipU * spriteW : 0;
  const handY = frame.tip ? frame.tip.y * VIEW_H - variant.tipV * spriteH : 0;

  const pointsToPath = (stroke: WhiteboardStroke): string =>
    stroke.points
      .map(
        (p, i) =>
          `${i === 0 ? 'M' : 'L'}${(p.x * viewW).toFixed(2)} ${(p.y * VIEW_H).toFixed(2)}`,
      )
      .join(' ');

  return (
    <div
      className="whiteboard-preview"
      style={{ aspectRatio: `${aspect}`, background: boardHex }}
      role="img"
      aria-label="Previsualización de la animación de pizarra blanca"
    >
      {/* Rejilla tenue de pizarra */}
      <svg
        className="whiteboard-grid"
        viewBox={`0 0 ${viewW} ${VIEW_H}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {Array.from({ length: 9 }, (_, i) => (
          <line
            key={`v${i}`}
            x1={((i + 1) * viewW) / 10}
            y1={0}
            x2={((i + 1) * viewW) / 10}
            y2={VIEW_H}
            stroke="rgba(100,116,139,0.16)"
            strokeWidth={1}
          />
        ))}
        {Array.from({ length: 5 }, (_, i) => (
          <line
            key={`h${i}`}
            x1={0}
            y1={((i + 1) * VIEW_H) / 6}
            x2={viewW}
            y2={((i + 1) * VIEW_H) / 6}
            stroke="rgba(100,116,139,0.16)"
            strokeWidth={1}
          />
        ))}
      </svg>

      <svg
        className="whiteboard-stage"
        viewBox={`0 0 ${viewW} ${VIEW_H}`}
        preserveAspectRatio="xMidYMid meet"
        aria-hidden="true"
      >
        {schedule.entries.map((entry, index) => {
          const drawn = frame.drawn[index] ?? 0;
          const dash = Math.max(0, Math.min(1, drawn));
          return (
            <path
              key={entry.stroke.id}
              d={pointsToPath(entry.stroke)}
              fill="none"
              stroke={inkHex}
              strokeWidth={entry.stroke.width * VIEW_H}
              strokeLinecap="round"
              strokeLinejoin="round"
              pathLength={1}
              strokeDasharray={
                dash >= 1
                  ? '1 0'
                  : `${dash.toFixed(4)} ${Math.max(0.0001, 1 - dash).toFixed(4)}`
              }
              opacity={entry.stroke.tool === 'pencil' ? 0.85 : 1}
            />
          );
        })}
        {handVisible ? (
          <g
            style={{
              transform: `translate(${handX.toFixed(2)} ${handY.toFixed(2)})`,
              transition: `transform ${HAND_GLIDE_MS}ms linear`,
            }}
          >
            <image
              href={variant.url}
              x={0}
              y={0}
              width={spriteW}
              height={spriteH}
              preserveAspectRatio="none"
            />
          </g>
        ) : null}
      </svg>
    </div>
  );
}
