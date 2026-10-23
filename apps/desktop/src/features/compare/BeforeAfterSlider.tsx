import { useCallback, useRef, type KeyboardEvent, type PointerEvent } from 'react';
import {
  afterClip,
  clampPosition,
  positionFromPointerX,
  stepForKey,
  zoomTransform,
  type BeforeAfterMode,
} from './before-after';

interface BeforeAfterSliderProps {
  readonly beforeUrl: string;
  readonly afterUrl: string;
  readonly position: number;
  readonly mode: BeforeAfterMode;
  readonly zoom: number;
  readonly onPositionChange: (position: number) => void;
}

/**
 * Las dos imágenes superpuestas con la línea arrastrable.
 *
 * La capa "después" se recorta con `clip-path` y la línea es un `role=slider`
 * operable con puntero y teclado: el comparador tiene que ser usable sin mouse.
 * Todo el cálculo vive en `before-after.ts`; acá sólo hay pintura y eventos.
 */
export function BeforeAfterSlider({
  beforeUrl,
  afterUrl,
  position,
  mode,
  zoom,
  onPositionChange,
}: BeforeAfterSliderProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);

  const moveFromEvent = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      onPositionChange(positionFromPointerX(event.clientX, rect));
    },
    [onPositionChange],
  );

  const onPointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      draggingRef.current = true;
      // `setPointerCapture` no existe en todos los entornos (jsdom): si falla,
      // el arrastre igual funciona mientras el botón esté presionado.
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // sin captura: los pointermove siguen llegando al elemento
      }
      moveFromEvent(event);
    },
    [moveFromEvent],
  );

  const onPointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;
      moveFromEvent(event);
    },
    [moveFromEvent],
  );

  const stopDrag = useCallback(() => {
    draggingRef.current = false;
  }, []);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const step = stepForKey(event.key, event.shiftKey);
      if (step === null) return;
      event.preventDefault();
      const next = step === Infinity ? 100 : step === -Infinity ? 0 : position + step;
      onPositionChange(clampPosition(next));
    },
    [onPositionChange, position],
  );

  const difference = mode === 'difference';
  const sliderMode = mode === 'slider';

  return (
    <div
      ref={containerRef}
      className="ba-stage"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={stopDrag}
      onPointerCancel={stopDrag}
    >
      <img
        className="ba-image"
        src={beforeUrl}
        alt="Versión original"
        draggable={false}
        style={{ transform: zoomTransform(zoom) }}
      />
      {afterUrl ? (
        <img
          className="ba-image ba-after"
          src={afterUrl}
          alt="Versión procesada"
          draggable={false}
          style={
            difference
              ? { transform: zoomTransform(zoom), mixBlendMode: 'difference' }
              : { transform: zoomTransform(zoom), clipPath: afterClip(position) }
          }
        />
      ) : null}
      {sliderMode && afterUrl ? (
        <>
          <div className="ba-line" style={{ left: `${position}%` }} aria-hidden="true" />
          <div
            className="ba-handle"
            role="slider"
            tabIndex={0}
            aria-label="Línea de comparación"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(position)}
            aria-valuetext={`${Math.round(position)} % de la versión procesada`}
            style={{ left: `${position}%` }}
            onKeyDown={onKeyDown}
          >
            <span className="ba-handle-grip" aria-hidden="true" />
          </div>
          <span className="ba-badge ba-badge-before" aria-hidden="true">
            Antes
          </span>
          <span className="ba-badge ba-badge-after" aria-hidden="true">
            Después
          </span>
        </>
      ) : null}
    </div>
  );
}
