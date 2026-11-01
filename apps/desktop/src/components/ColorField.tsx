import { useEffect, useId, useRef, useState } from 'react';
import { HexColorPicker } from 'react-colorful';

/** Colores de marca de Olyvia disponibles como atajos en todos los campos. */
export const COLOR_PRESETS = [
  '#7dd3c0',
  '#ffffff',
  '#000000',
  '#f97316',
  '#3b82f6',
  '#a855f7',
] as const;

const FALLBACK_COLOR = '#ffffff';
const HEX_PATTERN = /^#?([0-9a-fA-F]{6})$/;

/** Acepta `rrggbb` o `#rrggbb` y devuelve el valor canónico en minúsculas. */
export function normalizeHexColor(input: string): string | null {
  const digits = HEX_PATTERN.exec(input.trim())?.[1];
  return digits ? `#${digits.toLowerCase()}` : null;
}

/**
 * Selector de color para las plantillas Motion.
 *
 * Mantiene la API controlada de un input: solo emite `#rrggbb` válidos. El
 * texto hex se edita en local para no propagar estados intermedios, y el
 * popover se cierra con Escape o con un click fuera.
 */
export function ColorField({
  id,
  label,
  value,
  onChange,
  disabled = false,
  presets = COLOR_PRESETS,
}: {
  readonly id?: string;
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly disabled?: boolean;
  readonly presets?: readonly string[];
}) {
  const generatedId = useId();
  const fieldId = id ?? `color-field-${generatedId}`;
  const dialogId = `${fieldId}-popover`;

  const current = normalizeHexColor(value) ?? FALLBACK_COLOR;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(current);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const hexRef = useRef<HTMLInputElement>(null);

  const draftColor = normalizeHexColor(draft);
  const invalidDraft = draft.trim() !== '' && draftColor === null;

  useEffect(() => {
    setDraft(current);
  }, [current]);

  useEffect(() => {
    if (!open) return;
    setDraft(current);
    // El foco entra al campo hex: se puede editar o tabular a los presets.
    hexRef.current?.focus();
    hexRef.current?.select();
  }, [open]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  const emit = (next: string): void => {
    const normalized = normalizeHexColor(next);
    if (!normalized) return;
    setDraft(normalized);
    onChange(normalized);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Escape' || !open) return;
    event.stopPropagation();
    setOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <div
      ref={rootRef}
      className="color-field"
      data-open={open ? 'true' : undefined}
      onKeyDown={handleKeyDown}
    >
      <button
        ref={triggerRef}
        id={fieldId}
        type="button"
        className="color-field-trigger"
        aria-label={`${label}. Color actual: ${current}. Abrir selector de color`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? dialogId : undefined}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        <span
          className="color-field-swatch"
          style={{ backgroundColor: current }}
          aria-hidden="true"
        />
        <span className="color-field-value">{current}</span>
      </button>

      {open ? (
        <div
          id={dialogId}
          className="color-field-popover"
          role="dialog"
          aria-label={`Selector de color para ${label}`}
          // MotionForm envuelve el campo en un <label>: sin esto, el navegador
          // reenvía el click del popover al trigger y lo cerraría al arrastrar.
          onClick={(event) => event.preventDefault()}
        >
          <HexColorPicker
            color={current}
            onChange={emit}
            role="group"
            aria-label={`Selección de color para ${label}`}
          />
          <div className="color-field-hex-row">
            <input
              ref={hexRef}
              type="text"
              className="color-field-hex"
              value={draft}
              maxLength={7}
              spellCheck={false}
              autoComplete="off"
              placeholder="#rrggbb"
              aria-label={`Valor hex para ${label}`}
              aria-invalid={invalidDraft || undefined}
              aria-describedby={invalidDraft ? `${fieldId}-hex-hint` : undefined}
              onChange={(event) => {
                const next = event.target.value;
                setDraft(next);
                const normalized = normalizeHexColor(next);
                if (normalized) onChange(normalized);
              }}
              onBlur={() => {
                if (draftColor) {
                  setDraft(draftColor);
                } else {
                  setDraft(current);
                }
              }}
            />
            {invalidDraft ? (
              <span id={`${fieldId}-hex-hint`} className="color-field-hint">
                Formato #rrggbb
              </span>
            ) : null}
          </div>
          <div
            className="color-field-swatches"
            role="group"
            aria-label={`Colores de marca para ${label}`}
          >
            {presets.map((preset) => (
              <button
                key={preset}
                type="button"
                className="color-field-swatch-button"
                style={{ backgroundColor: preset }}
                aria-label={`${label}: usar ${preset}`}
                aria-pressed={normalizeHexColor(preset) === current}
                disabled={disabled}
                onClick={() => emit(preset)}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
