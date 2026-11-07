import type { CSSProperties } from 'react';

/**
 * Gradient slider of the reference (118): label, coloured track, editable
 * numeric value and keyframe diamond. The value shown is always the persisted
 * project value; the component holds no copy.
 */
export interface PropertySliderProps {
  readonly label: string;
  readonly value: number;
  readonly gradient?: string;
  readonly keyed: boolean;
  readonly disabled?: boolean;
  readonly onChange: (value: number, transient: boolean) => void;
  readonly onKeyToggle: () => void;
}

const clamp = (value: number): number => Math.min(100, Math.max(-100, value));

export function PropertySlider({
  label, value, gradient, keyed, disabled = false, onChange, onKeyToggle,
}: PropertySliderProps) {
  return (
    <div className={`fp-slider-row${disabled ? ' is-disabled' : ''}`}>
      <label className="fp-slider-label" htmlFor={`fp-slider-${label}`}>{label}</label>
      <input
        id={`fp-slider-${label}`}
        className={`fp-slider${gradient ? ' fp-slider--gradient' : ''}`}
        type="range"
        min={-100}
        max={100}
        step={1}
        value={value}
        disabled={disabled}
        aria-label={label}
        style={gradient ? ({ '--fp-slider-gradient': gradient } as CSSProperties) : undefined}
        onChange={(event) => onChange(clamp(Number(event.target.value)), true)}
        onPointerUp={() => onChange(value, false)}
        onKeyUp={() => onChange(value, false)}
      />
      <input
        className="fp-slider-number"
        type="text"
        inputMode="decimal"
        value={(value / 100).toFixed(2).replace('.', ',')}
        disabled={disabled}
        aria-label={`${label} valor`}
        onChange={(event) => {
          const raw = Number(event.target.value.replace(',', '.'));
          if (Number.isFinite(raw)) onChange(clamp(raw * 100), false);
        }}
      />
      <button
        type="button"
        className={`fp-keyframe${keyed ? ' active' : ''}`}
        aria-label={`${keyed ? 'Quitar' : 'Agregar'} marca de animación en ${label}`}
        aria-pressed={keyed}
        title="Marcar parámetro para animación (la marca se guarda en el proyecto)"
        onClick={onKeyToggle}
      >
        ◇
      </button>
    </div>
  );
}
