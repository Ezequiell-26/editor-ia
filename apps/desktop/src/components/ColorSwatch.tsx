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
 * Paleta fija y colores recientes (paridad `seletor_cor.js` de AlaukCut):
 * el popover ofrece una fila «Mis colores» persistida en localStorage más
 * una paleta de 48 muestras organizadas por familia de tono.
 */
export const COLOR_PALETTE: readonly string[] = [
  '#ffffff', '#f2f3f5', '#c8ccd2', '#9aa0a8', '#6b7178', '#3c4147', '#22262b', '#000000',
  '#ffd9d9', '#ff9d9d', '#ff5a5a', '#ff2233', '#d10f1e', '#9c0a15', '#5e060d', '#2b0306',
  '#ffe7cc', '#ffc98a', '#ffa53d', '#ff8a00', '#e06b00', '#a34d00', '#6b3200', '#331800',
  '#fff6cc', '#ffec99', '#ffe04d', '#f4c70f', '#d4a800', '#9c7b00', '#6b5400', '#332800',
  '#dcf7dc', '#a8eca8', '#5fd75f', '#1fd41f', '#12a312', '#0c7a0c', '#074f07', '#032603',
  '#d6f5f7', '#9de8ee', '#4fd3de', '#12b5c4', '#0c8b96', '#08646c', '#053f45', '#021f22',
  '#dbe7ff', '#a9c4ff', '#5f8dff', '#3d7bdc', '#0045c8', '#00308c', '#001f5c', '#00102e',
  '#f3ddff', '#e0b0ff', '#c77dff', '#ee7aff', '#a63fd9', '#7a2ba3', '#4f1a6b', '#280d36',
];

export const RECENT_COLORS_KEY = 'editoria.colores-recientes.v1';
export const RECENT_COLORS_LIMIT = 16;

export function loadRecentColors(
  storage: Pick<Storage, 'getItem'> | null =
    typeof window === 'undefined' ? null : window.localStorage,
): string[] {
  if (!storage) return [];
  try {
    const parsed: unknown = JSON.parse(storage.getItem(RECENT_COLORS_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => (typeof item === 'string' && HEX.test(item.trim()) ? normalizeHex(item) : null))
      .filter((item): item is string => item !== null)
      .slice(0, RECENT_COLORS_LIMIT);
  } catch {
    return [];
  }
}

function rememberColor(hex: string): void {
  try {
    const storage = window.localStorage;
    const list = [hex, ...loadRecentColors(storage).filter((item) => item !== hex)]
      .slice(0, RECENT_COLORS_LIMIT);
    storage.setItem(RECENT_COLORS_KEY, JSON.stringify(list));
  } catch {
    // Cuota llena o storage bloqueado: los recientes valen para la sesión.
  }
}

interface EyeDropperLike {
  open(): Promise<{ sRGBHex: string }>;
}

function eyeDropper(): EyeDropperLike | null {
  const candidate = (window as unknown as { EyeDropper?: new () => EyeDropperLike })
    .EyeDropper;
  return typeof candidate === 'function' ? new candidate() : null;
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
  const [recent, setRecent] = useState<string[]>([]);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const canPick = typeof window !== 'undefined' && eyeDropper() !== null;

  useEffect(() => {
    if (!open) return;
    setDraft(hex);
    setRecent(loadRecentColors());
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

  function pickFromPalette(color: string): void {
    const next = normalizeHex(color);
    onChange(next);
    onCommit?.();
    rememberColor(next);
    setRecent(loadRecentColors());
    setDraft(next);
  }

  async function pickFromScreen(): Promise<void> {
    const picker = eyeDropper();
    if (!picker) return;
    try {
      const result = await picker.open();
      pickFromPalette(result.sRGBHex);
    } catch {
      // El usuario canceló el cuentagotas o el webview no lo soporta del
      // todo: el selector sigue usable con la rueda y la paleta.
    }
  }

  function commitDraft(): void {
    const next = normalizeHex(draft);
    if (next !== hex) {
      onChange(next);
      rememberColor(next);
    }
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
              {recent.length > 0 ? (
                <div className="color-popover-section">
                  <span className="color-popover-section-title">Mis colores</span>
                  <div className="color-popover-palette">
                    {recent.map((color) => (
                      <button
                        key={color}
                        type="button"
                        className="color-popover-swatch"
                        style={{ background: color }}
                        title={color.toUpperCase()}
                        aria-label={`Usar ${color}`}
                        onClick={() => pickFromPalette(color)}
                      />
                    ))}
                  </div>
                </div>
              ) : null}
              <div className="color-popover-section">
                <span className="color-popover-section-title">Paleta</span>
                <div className="color-popover-palette">
                  {COLOR_PALETTE.map((color) => (
                    <button
                      key={color}
                      type="button"
                      className={`color-popover-swatch${color === hex ? ' active' : ''}`}
                      style={{ background: color }}
                      title={color.toUpperCase()}
                      aria-label={`Usar ${color}`}
                      onClick={() => pickFromPalette(color)}
                    />
                  ))}
                </div>
              </div>
              <div className="color-popover-foot">
                <span className="color-popover-chip" style={{ background: hex }} aria-hidden="true" />
                {canPick ? (
                  <button
                    type="button"
                    className="color-popover-eyedropper"
                    title="Tomar color de la pantalla"
                    aria-label="Tomar color de la pantalla"
                    onClick={() => void pickFromScreen()}
                  >
                    ⌖
                  </button>
                ) : null}
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
