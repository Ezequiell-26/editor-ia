import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { hexToHsl, hslToHex } from '../state/theme-palette';
import { ColorWheel } from './ColorWheel';

const HEX = /^#?([0-9a-f]{6})$/i;

function normalizeHex(value: string): string {
  const match = HEX.exec(value.trim());
  return match ? `#${match[1]!.toLowerCase()}` : '#000000';
}

/**
 * Fila de deslizamiento del panel de color: rótulo, pista con degradado,
 * valor numérico y botón de reinicio. Es el modelo del panel HSL de Filmora
 * (Tono / Saturación / Luminancia).
 */
function ColorSlider({
  label,
  min,
  max,
  value,
  track,
  format,
  onChange,
  onCommit,
}: {
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly value: number;
  readonly track: string;
  readonly format: (value: number) => string;
  readonly onChange: (value: number) => void;
  readonly onCommit?: (() => void) | undefined;
}) {
  return (
    <label className="color-slider">
      <span className="color-slider-label">{label}</span>
      <input
        type="range"
        className="color-slider-input"
        min={min}
        max={max}
        step={1}
        value={Math.round(value)}
        style={{ '--color-slider-track': track } as CSSProperties}
        aria-label={label}
        onChange={(event) => onChange(Number(event.target.value))}
        onPointerUp={onCommit}
        onKeyUp={onCommit}
        onBlur={onCommit}
      />
      <span className="color-slider-value">{format(value)}</span>
    </label>
  );
}

export interface ColorSwatchProps {
  /** Color actual en hex `#rrggbb`. */
  readonly value: string;
  readonly onChange: (hex: string) => void;
  /** Fin de la interacción: momento de persistir (blur, pointerup, Enter). */
  readonly onCommit?: (() => void) | undefined;
  /** Nombre del color para lectores de pantalla y el título del popover. */
  readonly label: string;
  readonly disabled?: boolean;
  readonly className?: string | undefined;
}

/**
 * Muestra de color + rueda Lumetri en un popover.
 *
 * Sustituye a los `input[type=color]` nativos (que abrían el selector del
 * sistema) manteniendo el mismo contrato: `value` / `onChange`. El popover va
 * en un portal para que no lo recorte el panel que lo contiene y se cierra con
 * Escape o al tocar afuera, devolviendo el foco al disparador.
 */
export function ColorSwatch({
  value,
  onChange,
  onCommit,
  label,
  disabled = false,
  className,
}: ColorSwatchProps) {
  const hex = normalizeHex(value);
  const hsl = hexToHsl(hex);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(hex);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(hex);
  }, [hex, open]);

  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    if (!trigger) return;

    // Coloca el popover junto al disparador y lo mantiene pegado si la página
    // scrollea. Antes cualquier scroll lo cerraba: abrir la rueda en una lista
    // larga (Estudio de color) la cerraba sola al hacer scroll.
    const place = (): boolean => {
      const rect = trigger.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > window.innerHeight) return false;
      const width = popoverRef.current?.offsetWidth ?? 268;
      const height = popoverRef.current?.offsetHeight ?? 372;
      const left = Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - width - 8));
      const below = rect.bottom + 8;
      const top =
        below + height > window.innerHeight - 8 ? Math.max(8, rect.top - height - 8) : below;
      setPosition({ left, top });
      return true;
    };

    place();

    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setOpen(false);
        trigger.focus();
      }
    };
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node | null;
      if (!target) return;
      if (popoverRef.current?.contains(target) || trigger.contains(target)) return;
      setOpen(false);
    };
    const onScroll = (): void => {
      if (!place()) setOpen(false);
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('resize', onScroll);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('resize', onScroll);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  function commitDraft(): void {
    const next = normalizeHex(draft);
    if (next !== hex) onChange(next);
    setDraft(next);
    onCommit?.();
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`color-swatch color-input${className ? ` ${className}` : ''}`}
        style={{ '--swatch-color': hex } as CSSProperties}
        aria-label={`Color de ${label}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={`${label} · ${hex}`}
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          setOpen((current) => !current);
        }}
      >
        <span className="color-swatch-fill" aria-hidden="true" />
      </button>
      {open && position
        ? createPortal(
            <div
              ref={popoverRef}
              className="color-popover"
              role="dialog"
              aria-label={`Color de ${label}`}
              style={{ left: position.left, top: position.top }}
            >
              <ColorWheel
                value={hex}
                onChange={onChange}
                onCommit={onCommit}
                size={168}
                label={label}
              />
              <div className="color-sliders">
                <ColorSlider
                  label="Tono"
                  min={0}
                  max={360}
                  value={hsl.h}
                  track="linear-gradient(90deg,#ff0000,#ff00ff,#0000ff,#00ffff,#00ff00,#ffff00,#ff0000)"
                  format={(value) => `${Math.round(value)}°`}
                  onChange={(value) => onChange(hslToHex(value, hsl.s, hsl.l))}
                  onCommit={onCommit}
                />
                <ColorSlider
                  label="Saturación"
                  min={0}
                  max={100}
                  value={hsl.s * 100}
                  track={`linear-gradient(90deg,${hslToHex(hsl.h, 0, hsl.l)},${hslToHex(hsl.h, 1, hsl.l)})`}
                  format={(value) => `${Math.round(value)} %`}
                  onChange={(value) => onChange(hslToHex(hsl.h, value / 100, hsl.l))}
                  onCommit={onCommit}
                />
                <ColorSlider
                  label="Luminancia"
                  min={0}
                  max={100}
                  value={hsl.l * 100}
                  track={`linear-gradient(90deg,#000000,${hslToHex(hsl.h, hsl.s, 0.5)},#ffffff)`}
                  format={(value) => `${Math.round(value)} %`}
                  onChange={(value) => onChange(hslToHex(hsl.h, hsl.s, value / 100))}
                  onCommit={onCommit}
                />
              </div>
              <div className="color-popover-foot">
                <span className="color-popover-chip" style={{ background: hex }} aria-hidden="true" />
                <input
                  className="color-popover-hex"
                  value={draft}
                  spellCheck={false}
                  aria-label={`Valor hex de ${label}`}
                  onChange={(event) => {
                    const next = event.target.value;
                    setDraft(next);
                    if (HEX.test(next.trim())) onChange(normalizeHex(next));
                  }}
                  onBlur={commitDraft}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      commitDraft();
                      setOpen(false);
                    }
                  }}
                />
                <button
                  type="button"
                  className="color-popover-done"
                  onClick={() => {
                    commitDraft();
                    setOpen(false);
                    triggerRef.current?.focus();
                  }}
                >
                  Listo
                </button>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
