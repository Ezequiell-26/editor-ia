import { useRef, type KeyboardEvent, type PointerEvent } from 'react';

export interface PanelSplitterProps {
  readonly axis: 'x' | 'y';
  readonly side?: 'left' | 'right';
  /** Valor actual del panel que controla. */
  readonly value: number;
  readonly min: number;
  readonly max: number;
  /** `true` cuando mover el puntero hacia la izquierda/arriba agranda el panel. */
  readonly invert?: boolean;
  readonly label: string;
  readonly onChange: (value: number) => void;
  readonly onCommit: (value: number) => void;
  readonly onReset?: () => void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.round(Math.min(max, Math.max(min, value)));
}

/**
 * Divisor accesible entre paneles del Studio. Usa pointer capture para seguir
 * el arrastre aunque el cursor salga del divisor, y no propaga el evento para
 * que la timeline o el playhead no interpreten el gesto.
 */
export function PanelSplitter({
  axis,
  side,
  value,
  min,
  max,
  invert = false,
  label,
  onChange,
  onCommit,
  onReset,
}: PanelSplitterProps) {
  const dragRef = useRef<{ start: number; value: number; pointerId: number } | null>(null);

  function pointerDown(event: PointerEvent<HTMLDivElement>): void {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      start: axis === 'x' ? event.clientX : event.clientY,
      value,
      pointerId: event.pointerId,
    };
  }

  function pointerMove(event: PointerEvent<HTMLDivElement>): void {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const current = axis === 'x' ? event.clientX : event.clientY;
    const delta = (current - drag.start) * (invert ? -1 : 1);
    onChange(clamp(drag.value + delta, min, max));
  }

  function pointerUp(event: PointerEvent<HTMLDivElement>): void {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
    const current = axis === 'x' ? event.clientX : event.clientY;
    const delta = (current - drag.start) * (invert ? -1 : 1);
    onCommit(clamp(drag.value + delta, min, max));
  }

  function keyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const step = event.shiftKey ? 64 : 16;
    let next: number | null = null;
    if (event.key === 'ArrowLeft') next = value - (invert ? -step : step);
    else if (event.key === 'ArrowRight') next = value + (invert ? -step : step);
    else if (event.key === 'ArrowUp') next = value - (invert ? -step : step);
    else if (event.key === 'ArrowDown') next = value + (invert ? -step : step);
    else if (event.key === 'Home') next = min;
    else if (event.key === 'End') next = max;
    if (next === null) return;
    event.preventDefault();
    event.stopPropagation();
    onCommit(clamp(next, min, max));
  }

  return (
    <div
      className={`studio-splitter studio-splitter-${axis}${side ? ` studio-splitter-${side}` : ''}`}
      role="separator"
      aria-label={label}
      aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      tabIndex={0}
      data-studio-splitter={axis}
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={pointerUp}
      onPointerCancel={pointerUp}
      onDoubleClick={onReset}
      onKeyDown={keyDown}
    >
      <span aria-hidden="true" />
    </div>
  );
}
