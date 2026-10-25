import { useCallback, useEffect, useRef, useState } from 'react';
import {
  cubicBezierProgress,
  getBezierFromEasing,
  type ClipTransformKeyframe,
  type CubicBezier,
} from '@editor-ia/project-schema';

const HANDLE_HIT_RADIUS = 10;
const HANDLE_DRAW_RADIUS = 4;
const CURVE_SAMPLES = 48;

export type CurveSegment = {
  /** Indice del keyframe de inicio del segmento (el extremo es index + 1). */
  index: number;
  frameStart: number;
  frameEnd: number;
  bezier: CubicBezier;
};

type KeyframeCurveEditorProps = {
  keyframes: readonly ClipTransformKeyframe[];
  /** Propiedad animada que se muestra como referencia en la etiqueta. */
  property?: 'scale' | 'opacity' | 'offsetX' | 'offsetY' | 'rotationDeg';
  /** Se llama al soltar el arrastre de un manejador con la curva editada del segmento. */
  onEditBezier?: (index: number, bezier: CubicBezier) => void;
};

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Curva inicial de un segmento: la guardada en su keyframe de inicio o la del preset de easing. */
export function initialBezier(keyframes: readonly ClipTransformKeyframe[], index: number): CubicBezier {
  const start = keyframes[index];
  return start?.bezier ?? getBezierFromEasing(start?.easing);
}

/** Segmentos con span real en frames entre keyframes consecutivos. */
export function segmentsOf(keyframes: readonly ClipTransformKeyframe[]): CurveSegment[] {
  const sorted = [...keyframes].sort((a, b) => a.frame - b.frame);
  const segments: CurveSegment[] = [];
  for (let i = 0; i + 1 < sorted.length; i += 1) {
    const start = sorted[i]!;
    const end = sorted[i + 1]!;
    segments.push({ index: i, frameStart: start.frame, frameEnd: end.frame, bezier: initialBezier(sorted, i) });
  }
  return segments;
}

/**
 * Distancia cuadrada entre el puntero (en coordenadas del canvas 0..1) y un
 * manejador del segmento; expuesto para probar el hit-test sin DOM.
 */
export function handleDistance(
  point: { x: number; y: number },
  segment: CurveSegment,
  kind: 'cp1' | 'cp2',
): number {
  const hx = kind === 'cp1' ? segment.bezier.cp1X : segment.bezier.cp2X;
  const hy = kind === 'cp1' ? segment.bezier.cp1Y : segment.bezier.cp2Y;
  return Math.hypot(point.x - hx, point.y - hy);
}

export function KeyframeCurveEditor({ keyframes, property, onEditBezier }: KeyframeCurveEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [segments, setSegments] = useState<CurveSegment[]>(() => segmentsOf(keyframes));
  const draggingRef = useRef<{ index: number; kind: 'cp1' | 'cp2' } | null>(null);

  useEffect(() => {
    setSegments(segmentsOf(keyframes));
  }, [keyframes]);

  const width = 600;
  const height = 200;
  const [canvasReady, setCanvasReady] = useState(false);

  useEffect(() => {
    setCanvasReady(canvasRef.current?.getContext('2d') != null);
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    ctx.strokeStyle = '#3a3f46';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();

    ctx.strokeStyle = '#565d66';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(w, 0);
    ctx.moveTo(0, h);
    ctx.lineTo(w, h);
    ctx.stroke();
    ctx.setLineDash([]);

    const totalFrames = segments.length > 0 ? segments[segments.length - 1]!.frameEnd - segments[0]!.frameStart : 1;
    const firstFrame = segments[0]?.frameStart ?? 0;
    for (const segment of segments) {
      const x0 = ((segment.frameStart - firstFrame) / totalFrames) * w;
      const x1 = ((segment.frameEnd - firstFrame) / totalFrames) * w;
      const span = Math.max(1, x1 - x0);

      ctx.strokeStyle = '#2a9df8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x0, h);
      for (let s = 0; s <= CURVE_SAMPLES; s += 1) {
        const progress = s / CURVE_SAMPLES;
        const eased = cubicBezierProgress(
          progress,
          segment.bezier.cp1X,
          segment.bezier.cp1Y,
          segment.bezier.cp2X,
          segment.bezier.cp2Y,
        );
        ctx.lineTo(x0 + progress * span, h * (1 - eased));
      }
      ctx.stroke();

      ctx.strokeStyle = 'rgba(251, 176, 59, 0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x0, h);
      ctx.lineTo(x0 + segment.bezier.cp1X * span, h * (1 - segment.bezier.cp1Y));
      ctx.moveTo(x1, 0);
      ctx.lineTo(x0 + segment.bezier.cp2X * span, h * (1 - segment.bezier.cp2Y));
      ctx.stroke();

      ctx.fillStyle = '#fbb03b';
      for (const kind of ['cp1', 'cp2'] as const) {
        const hx = kind === 'cp1' ? segment.bezier.cp1X : segment.bezier.cp2X;
        const hy = kind === 'cp1' ? segment.bezier.cp1Y : segment.bezier.cp2Y;
        ctx.beginPath();
        ctx.arc(x0 + hx * span, h * (1 - hy), HANDLE_DRAW_RADIUS, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }, [segments]);

  useEffect(() => {
    draw();
  }, [draw]);

  const toLocalFraction = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const scaleX = rect.width > 0 ? width / rect.width : 1;
    const scaleY = rect.height > 0 ? height / rect.height : 1;
    return {
      x: clamp01(((event.clientX - rect.left) * scaleX) / width),
      y: clamp01(1 - ((event.clientY - rect.top) * scaleY) / height),
    };
  };

  const hitHandle = (point: { x: number; y: number }): { index: number; kind: 'cp1' | 'cp2' } | null => {
    const radius = HANDLE_HIT_RADIUS / width;
    for (const segment of segments) {
      for (const kind of ['cp2', 'cp1'] as const) {
        if (handleDistance(point, segment, kind) <= radius) {
          return { index: segment.index, kind };
        }
      }
    }
    return null;
  };

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const hit = hitHandle(toLocalFraction(event));
    if (!hit) return;
    // El estado del arrastre va primero: la captura de puntero es una mejora
    // opcional que falla en entornos sin punteros activos (jsdom, tests).
    draggingRef.current = hit;
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // Sin captura el arrastre igual funciona mientras el puntero siga encima.
    }
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = draggingRef.current;
    if (!drag) return;
    const point = toLocalFraction(event);
    const segment = segments.find((s) => s.index === drag.index);
    if (!segment) return;
    const firstFrame = segments[0]!.frameStart;
    const totalFrames = segments[segments.length - 1]!.frameEnd - firstFrame;
    const spanFrames = Math.max(1, segment.frameEnd - segment.frameStart);
    const pointerFrame = firstFrame + point.x * totalFrames;
    const segmentX = clamp01((pointerFrame - segment.frameStart) / spanFrames);
    setSegments((prev) =>
      prev.map((s) => {
        if (s.index !== drag.index) return s;
        const cp = drag.kind === 'cp1' ? { cp1X: segmentX, cp1Y: point.y } : { cp2X: segmentX, cp2Y: point.y };
        return { ...s, bezier: { ...s.bezier, ...cp } };
      }),
    );
  };

  const onPointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = draggingRef.current;
    if (!drag) return;
    draggingRef.current = null;
    try {
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture?.(event.pointerId);
      }
    } catch {
      // La liberación falla si no hubo captura; no afecta al resultado.
    }
    const segment = segments.find((s) => s.index === drag.index);
    if (segment) {
      onEditBezier?.(drag.index, segment.bezier);
    }
  };

  const propertyLabel =
    property === 'scale'
      ? 'escala'
      : property === 'opacity'
        ? 'opacidad'
        : property === 'rotationDeg'
          ? 'rotación'
          : property === 'offsetX' || property === 'offsetY'
            ? 'posición'
            : 'transformación';

  if (segments.length === 0) {
    return (
      <p className="fine-print" aria-label="Curvas sin keyframes">
        No hay keyframes suficientes para editar curvas.
      </p>
    );
  }

  return (
    <div className="keyframe-curve-editor">
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        role="img"
        tabIndex={0}
        aria-label={`Editor de curvas Bézier de ${propertyLabel}: ${segments.length} segmentos entre ${keyframes.length} keyframes. Arrastrá los manejadores naranjas para ajustar la interpolación.`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
      {!canvasReady ? (
        <p className="fine-print">Vista de curvas no disponible en este entorno; la edición por arrastre requiere canvas.</p>
      ) : null}
      <p className="fine-print">
        Arrastrá los puntos naranjas para editar la curva de cada segmento; el extremo de cada manejador respeta el
        rango 0–1 del esquema.
      </p>
    </div>
  );
}
