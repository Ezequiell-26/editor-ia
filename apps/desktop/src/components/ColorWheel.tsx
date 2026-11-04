import { useRef, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { hexToHsl, hslToHex } from '../state/theme-palette';

const HEX = /^#?([0-9a-f]{6})$/i;

function normalizeHex(value: string): string {
  const match = HEX.exec(value.trim());
  return match ? `#${match[1]!.toLowerCase()}` : '#000000';
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export interface ColorWheelProps {
  /** Color actual en hex `#rrggbb` (se normaliza si viene con 3 dígitos). */
  readonly value: string;
  /** Se llama en cada movimiento; el consumidor decide si previsualiza o guarda. */
  readonly onChange: (hex: string) => void;
  /** Fin de la interacción (soltar el puntero, tecla, blur): momento de persistir. */
  readonly onCommit?: (() => void) | undefined;
  /** Rótulo debajo de la rueda, como «Shadows / Midtones / Highlights». */
  readonly label?: string | undefined;
  /** Diámetro del disco en px. */
  readonly size?: number;
  /** Nombre accesible del control cuando no hay `label` visible. */
  readonly ariaLabel?: string | undefined;
  readonly disabled?: boolean;
  readonly className?: string | undefined;
}

/**
 * Rueda de color estilo Lumetri (Premiere Pro): anillo de tono, marcador que
 * se mueve en dos ejes (ángulo = tono, radio = saturación) y barra vertical de
 * luminosidad a la izquierda.
 *
 * Es el único control de color de la app: la usan el estudio de color, el
 * acento de Apariencia, el inspector, VFX, motion y miniaturas. Tono 0 (rojo)
 * arriba y el tono decrece en sentido horario, igual que el original.
 */
export function ColorWheel({
  value,
  onChange,
  onCommit,
  label,
  size = 168,
  ariaLabel,
  disabled = false,
  className,
}: ColorWheelProps) {
  const hex = normalizeHex(value);
  const { h, s, l } = hexToHsl(hex);
  const dialRef = useRef<HTMLDivElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const dragging = useRef<'dial' | 'bar' | null>(null);

  const emit = (next: { h?: number; s?: number; l?: number }): void => {
    onChange(hslToHex(next.h ?? h, next.s ?? s, next.l ?? l));
  };

  function readDial(event: { clientX: number; clientY: number }): { hue: number; saturation: number } | null {
    const element = dialRef.current;
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    const dx = event.clientX - (rect.left + rect.width / 2);
    const dy = event.clientY - (rect.top + rect.height / 2);
    const radius = Math.max(1, rect.width / 2);
    // Ángulo horario desde arriba: el tono crece al revés (0 arriba, 120 a las 8).
    let angle = (Math.atan2(dx, -dy) * 180) / Math.PI;
    if (angle < 0) angle += 360;
    return { hue: (360 - angle) % 360, saturation: clamp01(Math.hypot(dx, dy) / radius) };
  }

  function readBar(clientY: number): number | null {
    const element = barRef.current;
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    if (rect.height <= 0) return null;
    return clamp01(1 - (clientY - rect.top) / rect.height);
  }

  function onDialDown(event: ReactPointerEvent<HTMLDivElement>): void {
    if (disabled || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragging.current = 'dial';
    const point = readDial(event);
    if (point) emit({ h: point.hue, s: point.saturation });
  }

  function onDialMove(event: ReactPointerEvent<HTMLDivElement>): void {
    if (dragging.current !== 'dial') return;
    const point = readDial(event);
    if (point) emit({ h: point.hue, s: point.saturation });
  }

  function onBarDown(event: ReactPointerEvent<HTMLDivElement>): void {
    if (disabled || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragging.current = 'bar';
    const lightness = readBar(event.clientY);
    if (lightness !== null) emit({ l: lightness });
  }

  function onBarMove(event: ReactPointerEvent<HTMLDivElement>): void {
    if (dragging.current !== 'bar') return;
    const lightness = readBar(event.clientY);
    if (lightness !== null) emit({ l: lightness });
  }

  function finish(): void {
    if (!dragging.current) return;
    dragging.current = null;
    onCommit?.();
  }

  function onDialKey(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (disabled) return;
    const step = event.shiftKey ? 10 : 2;
    let handled = true;
    if (event.key === 'ArrowLeft') emit({ h: h - step });
    else if (event.key === 'ArrowRight') emit({ h: h + step });
    else if (event.key === 'ArrowUp') emit({ s: clamp01(s + 0.04) });
    else if (event.key === 'ArrowDown') emit({ s: clamp01(s - 0.04) });
    else if (event.key === 'Home') emit({ s: 0 });
    else if (event.key === 'End') emit({ s: 1 });
    else handled = false;
    if (!handled) return;
    event.preventDefault();
    onCommit?.();
  }

  function onBarKey(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (disabled) return;
    const step = event.shiftKey ? 0.1 : 0.02;
    let handled = true;
    if (event.key === 'ArrowUp') emit({ l: clamp01(l + step) });
    else if (event.key === 'ArrowDown') emit({ l: clamp01(l - step) });
    else if (event.key === 'Home') emit({ l: 0 });
    else if (event.key === 'End') emit({ l: 1 });
    else handled = false;
    if (!handled) return;
    event.preventDefault();
    onCommit?.();
  }

  const radius = size / 2;
  // El marcador no llega al borde exacto: así se mantiene visible sobre el anillo.
  const markerRadius = radius * (0.08 + 0.86 * s);
  const angleRad = (((360 - h) % 360) * Math.PI) / 180;
  const markerX = Math.sin(angleRad) * markerRadius;
  const markerY = -Math.cos(angleRad) * markerRadius;
  const markerStyle: CSSProperties = {
    left: `calc(50% + ${markerX.toFixed(2)}px)`,
    top: `calc(50% + ${markerY.toFixed(2)}px)`,
  };

  const style = {
    '--color-wheel-size': `${size}px`,
  } as CSSProperties;

  return (
    <div
      className={`color-wheel${disabled ? ' disabled' : ''}${className ? ` ${className}` : ''}`}
      style={style}
    >
      <div className="color-wheel-body">
        <div
          ref={barRef}
          className="color-wheel-bar"
          role="slider"
          tabIndex={disabled ? -1 : 0}
          aria-label={label ? `Luminosidad de ${label}` : 'Luminosidad'}
          aria-orientation="vertical"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(l * 100)}
          aria-valuetext={`${Math.round(l * 100)} %`}
          aria-disabled={disabled || undefined}
          onPointerDown={onBarDown}
          onPointerMove={onBarMove}
          onPointerUp={finish}
          onPointerCancel={finish}
          onKeyDown={onBarKey}
          title="Luminosidad"
        >
          <span
            className="color-wheel-bar-thumb"
            style={{ top: `${(1 - l) * 100}%` }}
            aria-hidden="true"
          />
        </div>
        <div
          ref={dialRef}
          className="color-wheel-dial"
          role="slider"
          tabIndex={disabled ? -1 : 0}
          aria-label={ariaLabel ?? (label ? `Tono y saturación de ${label}` : 'Tono y saturación')}
          aria-valuemin={0}
          aria-valuemax={360}
          aria-valuenow={Math.round(h)}
          aria-valuetext={hex}
          aria-disabled={disabled || undefined}
          onPointerDown={onDialDown}
          onPointerMove={onDialMove}
          onPointerUp={finish}
          onPointerCancel={finish}
          onKeyDown={onDialKey}
          title={hex}
        >
          <span className="color-wheel-ring" aria-hidden="true" />
          <span className="color-wheel-marker" style={markerStyle} aria-hidden="true" />
        </div>
      </div>
      {label ? <span className="color-wheel-label">{label}</span> : null}
    </div>
  );
}
