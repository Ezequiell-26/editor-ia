// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ClipTransformKeyframe, CubicBezier } from '@editor-ia/project-schema';
import {
  KeyframeCurveEditor,
  handleDistance,
  initialBezier,
  segmentsOf,
} from './KeyframeCurveEditor';

afterEach(cleanup);

const CANVAS_WIDTH = 600;
const CANVAS_HEIGHT = 200;

/** Convierte una fracción de la curva (0..1) al clientX/clientY que el editor interpreta. */
function toClient(xFraction: number, yFraction: number): { clientX: number; clientY: number } {
  return {
    clientX: xFraction * CANVAS_WIDTH,
    clientY: (1 - yFraction) * CANVAS_HEIGHT,
  };
}

/**
 * Despacha un evento de puntero con coordenadas reales: jsdom no tiene
 * PointerEvent, así que fireEvent.pointerDown crearía un Event plano sin
 * clientX/clientY; un MouseEvent con tipo pointer* sí las porta y React lo
 * reparte a los handlers onPointer* por el tipo.
 */
function firePointer(
  canvas: HTMLCanvasElement,
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  xFraction: number,
  yFraction: number,
): void {
  const { clientX, clientY } = toClient(xFraction, yFraction);
  fireEvent(
    canvas,
    new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY }),
  );
}

const keyframes: ClipTransformKeyframe[] = [
  { frame: 0, scale: 1 },
  { frame: 50, scale: 1.5 },
  { frame: 100, scale: 2 },
];

describe('segmentsOf e initialBezier', () => {
  it('crea un segmento por par de keyframes con span real en frames', () => {
    const segments = segmentsOf(keyframes);
    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({ index: 0, frameStart: 0, frameEnd: 50 });
    expect(segments[1]).toMatchObject({ index: 1, frameStart: 50, frameEnd: 100 });
  });

  it('usa el bezier guardado del keyframe de inicio y si no el preset de easing', () => {
    const guardado: ClipTransformKeyframe[] = [
      { frame: 0, scale: 1, bezier: { cp1X: 0.1, cp1Y: 0.2, cp2X: 0.3, cp2Y: 0.4 } },
      { frame: 100, scale: 2 },
    ];
    expect(initialBezier(guardado, 0)).toEqual({ cp1X: 0.1, cp1Y: 0.2, cp2X: 0.3, cp2Y: 0.4 });

    const preset: ClipTransformKeyframe[] = [
      { frame: 0, scale: 1, easing: 'ease-out' },
      { frame: 100, scale: 2 },
    ];
    expect(initialBezier(preset, 0).cp2X).toBeCloseTo(0.58, 6);

    const porDefecto: ClipTransformKeyframe[] = [
      { frame: 0, scale: 1 },
      { frame: 100, scale: 2 },
    ];
    expect(initialBezier(porDefecto, 0)).toEqual({ cp1X: 0, cp1Y: 0, cp2X: 1, cp2Y: 1 });
  });
});

describe('handleDistance', () => {
  it('mide la distancia al manejador pedido del segmento', () => {
    const segments = segmentsOf(keyframes);
    const segment = segments[0]!;
    // Segmento sin bezier ni easing: curva linear, cp1 en el origen (0, 0).
    const onHandle = handleDistance({ x: 0, y: 0 }, segment, 'cp1');
    expect(onHandle).toBeCloseTo(0, 9);
    const far = handleDistance({ x: 0.9, y: 0.9 }, segment, 'cp1');
    expect(far).toBeGreaterThan(60);
  });

  it('ubica el manejador del segundo segmento en su tramo global, no en x=0', () => {
    const segments = segmentsOf(keyframes);
    const second = segments[1]!;
    // El segundo segmento empieza en la mitad del canvas: su cp1=(0,0) se
    // dibuja en (0.5, 0), no en (0, 0).
    expect(handleDistance({ x: 0.5, y: 0 }, second, 'cp1', 0.5, 0.5, 600, 200)).toBeCloseTo(0, 6);
    expect(handleDistance({ x: 0, y: 0 }, second, 'cp1', 0.5, 0.5, 600, 200)).toBeGreaterThan(200);
  });

  it('responde al teclado sobre el manejador inicial', () => {
    const changes: CubicBezier[] = [];
    const { getByRole } = render(
      <KeyframeCurveEditor
        keyframes={keyframes}
        property="scale"
        onEditBezier={(_i, b) => {
          changes.push(b);
        }}
      />,
    );
    const canvas = getByRole('application') as HTMLCanvasElement;
    fireEvent.keyDown(canvas, { key: 'ArrowRight' });
    expect(changes).toHaveLength(1);
    expect(changes[0]!.cp1X).toBeCloseTo(0.01, 6);
  });

  it('no secuestra Tab: el foco puede salir del editor', () => {
    const { getByRole } = render(<KeyframeCurveEditor keyframes={keyframes} />);
    const canvas = getByRole('application') as HTMLCanvasElement;
    const event = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    });
    canvas.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it('revierte la curva local si el proyecto rechaza el cambio', () => {
    const changes: CubicBezier[] = [];
    const { getByRole } = render(
      <KeyframeCurveEditor
        keyframes={keyframes}
        onEditBezier={(_i, b) => {
          changes.push(b);
          return false;
        }}
      />,
    );
    const canvas = getByRole('application') as HTMLCanvasElement;
    fireEvent.keyDown(canvas, { key: 'ArrowRight' });
    fireEvent.keyDown(canvas, { key: 'ArrowRight' });
    expect(changes).toHaveLength(2);
    // Ambos intentos parten de la curva original (0), no de la edición
    // fantasma anterior.
    expect(changes[0]!.cp1X).toBeCloseTo(0.01, 6);
    expect(changes[1]!.cp1X).toBeCloseTo(0.01, 6);
  });
});

describe('KeyframeCurveEditor (interacción)', () => {
  it('renderiza el editor con aria y el aviso de canvas no disponible en jsdom', () => {
    const { getByRole, getByText } = render(<KeyframeCurveEditor keyframes={keyframes} property="scale" />);
    const canvas = getByRole('application');
    expect(canvas.getAttribute('aria-label')).toContain('2 segmentos');
    expect(canvas.getAttribute('aria-label')).toContain('escala');
    expect(getByText(/la edición por arrastre requiere canvas/i)).toBeTruthy();
  });

  it('arrastra el manejador cp1 del primer segmento y reporta la curva editada', () => {
    const onEditBezier = vi.fn();
    const { getByRole } = render(
      <KeyframeCurveEditor keyframes={keyframes} property="scale" onEditBezier={onEditBezier} />,
    );
    const canvas = getByRole('application') as HTMLCanvasElement;

    // Segmento 0 (frames 0..50) sin estilo: curva linear con cp1 en (0, 0);
    // en pantalla queda en la fracción 0 del ancho total.
    firePointer(canvas, 'pointerdown', 0, 0);
    // Arrastre a la fracción 0.1 del total = frame 10 = 0.2 del segmento.
    firePointer(canvas, 'pointermove', 0.1, 0.35);
    firePointer(canvas, 'pointerup', 0.1, 0.35);

    expect(onEditBezier).toHaveBeenCalledTimes(1);
    const [index, bezier] = onEditBezier.mock.calls[0]! as [number, CubicBezier];
    expect(index).toBe(0);
    expect(bezier.cp1X).toBeCloseTo(0.2, 5);
    expect(bezier.cp1Y).toBeCloseTo(0.35, 5);
    // cp2 del segmento no fue tocado.
    expect(bezier.cp2X).toBeCloseTo(1, 6);
    expect(bezier.cp2Y).toBeCloseTo(1, 6);
  });

  it('un pointerdown lejos de todo manejador no inicia arrastre ni edita', () => {
    const onEditBezier = vi.fn();
    const { getByRole } = render(
      <KeyframeCurveEditor keyframes={keyframes} property="scale" onEditBezier={onEditBezier} />,
    );
    const canvas = getByRole('application') as HTMLCanvasElement;

    firePointer(canvas, 'pointerdown', 0.5, 0.5);
    firePointer(canvas, 'pointermove', 0.3, 0.3);
    firePointer(canvas, 'pointerup', 0.3, 0.3);

    expect(onEditBezier).not.toHaveBeenCalled();
  });

  it('sin keyframes suficientes muestra el mensaje vacío', () => {
    const { getByLabelText, queryByRole } = render(
      <KeyframeCurveEditor keyframes={[{ frame: 0, scale: 1 }]} property="scale" />,
    );
    expect(getByLabelText('Curvas sin keyframes')).toBeTruthy();
    expect(queryByRole('img')).toBeNull();
  });
});
