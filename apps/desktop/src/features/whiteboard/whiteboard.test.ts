import { describe, expect, it } from 'vitest';
import {
  arcStroke,
  buildWhiteboardSchedule,
  demoWhiteboardStrokes,
  easeWhiteboardProgress,
  glideToward,
  lineStroke,
  pointAtDistance,
  polylineStroke,
  rectStroke,
  strokeEndPoint,
  strokeLength,
  strokeStartPoint,
  waveStroke,
  whiteboardFrameAt,
  type WhiteboardStroke,
} from './whiteboard';

const ASPECT = 16 / 9;

function hline(id: string, length = 0.5): WhiteboardStroke {
  // Línea horizontal de `length` en fracción del ancho.
  return lineStroke(id, 0.1, 0.5, 0.1 + length, 0.5, 0.01);
}

describe('strokeLength / pointAtDistance', () => {
  it('mide en unidades de altura: una línea horizontal de 0.5 del ancho vale 0.5*aspect', () => {
    const stroke = hline('l1');
    expect(strokeLength(stroke, ASPECT)).toBeCloseTo(0.5 * ASPECT, 6);
    // Con aspect 1 (cuadrado) la misma línea mide la mitad.
    expect(strokeLength(stroke, 1)).toBeCloseTo(0.5, 6);
  });

  it('interpola el punto a mitad de distancia con el ángulo del segmento', () => {
    const stroke = lineStroke('diag', 0, 0, 0.5, 0.5, 0.01);
    const half = strokeLength(stroke, ASPECT) / 2;
    const at = pointAtDistance(stroke, ASPECT, half);
    expect(at.point.x).toBeCloseTo(0.25, 5);
    expect(at.point.y).toBeCloseTo(0.25, 5);
    // El ángulo se mide en unidades de altura: dy=0.5, dx=0.5*aspect.
    expect(at.angle).toBeCloseTo(Math.atan2(0.5, 0.5 * ASPECT), 5);
  });

  it('clampea antes del inicio y después del final', () => {
    const stroke = hline('l2');
    expect(pointAtDistance(stroke, ASPECT, -1).point.x).toBeCloseTo(0.1, 6);
    const end = pointAtDistance(stroke, ASPECT, 9999);
    expect(end.point.x).toBeCloseTo(0.6, 6);
    expect(strokeEndPoint(stroke)?.x).toBeCloseTo(0.6, 6);
    expect(strokeStartPoint(stroke)?.x).toBeCloseTo(0.1, 6);
  });
});

describe('buildWhiteboardSchedule', () => {
  it('cada trazo se dibuja a velocidad constante y deja una pausa de viaje', () => {
    const strokes = [hline('a'), hline('b', 0.25)];
    const schedule = buildWhiteboardSchedule(strokes, { aspect: ASPECT, speed: 1, gap: 0.2 });
    const [a, b] = schedule.entries;
    // Velocidad 1 unidad-altura/s: el primero mide 0.5*aspect.
    expect(a!.duration).toBeCloseTo(0.5 * ASPECT, 6);
    expect(a!.start).toBe(0);
    expect(a!.end).toBeCloseTo(0.5 * ASPECT, 6);
    expect(b!.start).toBeCloseTo(0.5 * ASPECT + 0.2, 6);
    expect(schedule.totalDuration).toBeCloseTo(b!.slotEnd - 0.2, 6);
  });

  it('trazos degenerados (un punto) tienen duración mínima y no rompen', () => {
    const strokes = [polylineStroke('p', [{ x: 0.5, y: 0.5 }], 0.01)];
    const schedule = buildWhiteboardSchedule(strokes, { aspect: ASPECT, speed: 1 });
    expect(schedule.entries[0]!.duration).toBe(0.05);
    expect(schedule.totalDuration).toBeCloseTo(0.05, 6);
  });

  it('lista vacía produce duración total 0', () => {
    const schedule = buildWhiteboardSchedule([], { aspect: ASPECT, speed: 1 });
    expect(schedule.totalDuration).toBe(0);
    const frame = whiteboardFrameAt(schedule, 1);
    expect(frame.complete).toBe(true);
    expect(frame.tip).toBeNull();
  });
});

describe('whiteboardFrameAt', () => {
  const strokes = [hline('a', 0.5), hline('b', 0.25)];
  const schedule = buildWhiteboardSchedule(strokes, { aspect: ASPECT, speed: 1, gap: 0.2 });

  it('en t=0 la mano está en el inicio del primer trazo y nada está dibujado', () => {
    const frame = whiteboardFrameAt(schedule, 0);
    expect(frame.tip?.x).toBeCloseTo(0.1, 6);
    expect(frame.tip?.y).toBeCloseTo(0.5, 6);
    expect(frame.drawn).toEqual([0, 0]);
    expect(frame.activeIndex).toBe(-1);
  });

  it('a mitad del primer trazo dibuja la mitad y la punta avanza', () => {
    const mid = schedule.entries[0]!.duration / 2;
    const frame = whiteboardFrameAt(schedule, mid);
    expect(frame.drawn[0]).toBeCloseTo(0.5, 5);
    expect(frame.drawn[1]).toBe(0);
    expect(frame.activeIndex).toBe(0);
    // La punta está a ~la mitad del segmento horizontal.
    expect(frame.tip!.x).toBeGreaterThan(0.3);
    expect(frame.tip!.x).toBeLessThan(0.45);
    expect(frame.tip!.y).toBeCloseTo(0.5, 5);
    expect(frame.tip!.angle).toBeCloseTo(0, 5);
  });

  it('durante la pausa la mano viaja del fin del trazo A al inicio del B', () => {
    const gapMid = schedule.entries[0]!.end + schedule.gap / 2;
    const frame = whiteboardFrameAt(schedule, gapMid);
    expect(frame.drawn[0]).toBe(1);
    expect(frame.drawn[1]).toBe(0);
    expect(frame.activeIndex).toBe(-1);
    // Ambos trazos comparten y=0.5; el viaje es horizontal entre x=0.6 y x=0.1.
    expect(frame.tip!.y).toBeCloseTo(0.5, 5);
    expect(frame.tip!.x).toBeGreaterThan(0.1);
    expect(frame.tip!.x).toBeLessThan(0.6);
  });

  it('al final todo está dibujado y complete=true', () => {
    const frame = whiteboardFrameAt(schedule, schedule.totalDuration + 5);
    expect(frame.complete).toBe(true);
    expect(frame.drawn).toEqual([1, 1]);
    expect(frame.activeIndex).toBe(-1);
  });

  it('el easing smooth retrasa el arranque y el final del trazo', () => {
    const raw = easeWhiteboardProgress(0.5, 'smooth');
    expect(raw).toBeCloseTo(0.5, 6);
    expect(easeWhiteboardProgress(0.25, 'smooth')).toBeLessThan(0.25);
    expect(easeWhiteboardProgress(0.25, 'linear')).toBeCloseTo(0.25, 6);
    expect(easeWhiteboardProgress(-3)).toBe(0);
    expect(easeWhiteboardProgress(3)).toBe(1);
  });
});

describe('glideToward', () => {
  it('sin posición previa arranca en el objetivo', () => {
    expect(glideToward(null, { x: 1, y: 2 }, 0.1)).toEqual({ x: 1, y: 2 });
  });

  it('limita el salto a maxStep por frame', () => {
    const next = glideToward({ x: 0, y: 0 }, { x: 1, y: 0 }, 0.1);
    expect(next.x).toBeCloseTo(0.1, 6);
    expect(next.y).toBe(0);
  });

  it('llega al objetivo cuando está dentro del paso', () => {
    expect(glideToward({ x: 0, y: 0 }, { x: 0.05, y: 0 }, 0.1)).toEqual({
      x: 0.05,
      y: 0,
    });
  });
});

describe('constructores y escenas demo', () => {
  it('rectStroke cierra el polígono en el punto inicial', () => {
    const stroke = rectStroke('r', 0.1, 0.2, 0.3, 0.4, 0.01);
    const first = stroke.points[0]!;
    const last = stroke.points[stroke.points.length - 1]!;
    expect(last.x).toBeCloseTo(first.x, 6);
    expect(last.y).toBeCloseTo(first.y, 6);
    expect(strokeLength(stroke, ASPECT)).toBeGreaterThan(1);
  });

  it('arcStroke genera una polilínea cerrada con la cantidad de muestras pedida', () => {
    const stroke = arcStroke('a', 0.5, 0.5, 0.2, 0, Math.PI * 2, 0.01, 32);
    expect(stroke.points).toHaveLength(33);
    const length = strokeLength(stroke, ASPECT);
    // Circunferencia de radio 0.2 en coordenadas y (unidades de altura:
    // el arco en x también escala por aspect, así que el perímetro real
    // depende del aspect; sólo verificamos que sea positivo y finito).
    expect(length).toBeGreaterThan(0.5);
    expect(Number.isFinite(length)).toBe(true);
  });

  it('waveStroke produce puntos dentro del rango pedido', () => {
    const stroke = waveStroke('w', 0.1, 0.5, 0.6, 0.5, 0.02, 3, 0.005);
    expect(stroke.points.length).toBeGreaterThan(10);
    for (const p of stroke.points) {
      expect(p.x).toBeGreaterThanOrEqual(0.1 - 1e-6);
      expect(p.x).toBeLessThanOrEqual(0.6 + 1e-6);
    }
  });

  it('demoWhiteboardStrokes devuelve trazos válidos para ambas escenas', () => {
    for (const scene of ['sketch', 'circle'] as const) {
      const strokes = demoWhiteboardStrokes(scene);
      expect(strokes.length).toBeGreaterThan(2);
      for (const stroke of strokes) {
        expect(stroke.points.length).toBeGreaterThanOrEqual(2);
        expect(stroke.width).toBeGreaterThan(0);
      }
      const schedule = buildWhiteboardSchedule(strokes, { aspect: ASPECT, speed: 0.32 });
      expect(schedule.totalDuration).toBeGreaterThan(2);
      expect(schedule.totalDuration).toBeLessThan(60);
    }
  });
});
