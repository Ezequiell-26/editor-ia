import { useEffect, useState } from 'react';
import { ColorField } from '../../components/ColorField';
import {
  DESIGN_APPLIED_EVENT,
  loadDesignSelection,
  type DesignSelection,
} from '../design/design-selection';
import type { MotionTemplate } from './templates';

function colorValue(value: unknown): string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#ffffff';
}

export function MotionForm({
  template,
  props,
  onChange,
  disabled = false,
}: {
  readonly template: MotionTemplate;
  readonly props: Readonly<Record<string, unknown>>;
  readonly onChange: (props: Record<string, unknown>) => void;
  readonly disabled?: boolean;
}) {
  const [design, setDesign] = useState<DesignSelection | null>(() => loadDesignSelection());

  useEffect(() => {
    const onApplied = (event: Event): void => {
      const detail = (event as CustomEvent<DesignSelection | undefined>).detail;
      setDesign(detail ?? loadDesignSelection());
    };
    window.addEventListener(DESIGN_APPLIED_EVENT, onApplied);
    return () => window.removeEventListener(DESIGN_APPLIED_EVENT, onApplied);
  }, []);

  const colorFields = template.fields.filter((field) => field.kind === 'color');
  const canApplyPalette = Boolean(design) && colorFields.length > 0;

  function applyPalette(): void {
    if (!design) return;
    const next = { ...props };
    for (const field of colorFields) {
      const value =
        field.id === 'background'
          ? design.bg
          : field.id === 'color'
            ? design.fg
            : field.id === 'glitchB'
              ? (design.accentOn ?? design.accent)
              : design.accent;
      if (value && /^#[0-9a-fA-F]{6}$/.test(value)) next[field.id] = value;
    }
    onChange(next);
  }

  return (
    <div className="motion-fields">
      {canApplyPalette && design ? (
        <div className="motion-design-palette">
          <span className="motion-design-swatches" aria-hidden="true">
            <i style={{ background: design.bg ?? '#000000' }} />
            <i style={{ background: design.accent }} />
            <i style={{ background: design.fg ?? '#ffffff' }} />
          </span>
          <div>
            <strong>{design.name}</strong>
            <small>Paleta del sistema de diseño</small>
          </div>
          <button type="button" className="small ghost" onClick={applyPalette} disabled={disabled}>
            Aplicar
          </button>
        </div>
      ) : null}
      {template.fields.map((field) => {
        const id = `motion-${template.id}-${field.id}`;
        const raw = props[field.id];
        const value = raw === undefined || raw === null ? '' : String(raw);
        const update = (next: unknown): void => {
          onChange({ ...props, [field.id]: next });
        };
        return (
          <label key={field.id} className="motion-field" htmlFor={id}>
            <span>{field.label}</span>
            {field.kind === 'select' ? (
              <select
                id={id}
                value={value}
                disabled={disabled}
                onChange={(event) => update(event.target.value)}
              >
                {(field.options ?? []).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : field.kind === 'color' ? (
              <ColorField
                id={id}
                label={field.label}
                value={colorValue(raw)}
                disabled={disabled}
                onChange={update}
              />
            ) : field.kind === 'textarea' ? (
              <textarea
                id={id}
                rows={3}
                value={value}
                disabled={disabled}
                onChange={(event) => update(event.target.value)}
              />
            ) : field.kind === 'number' ? (
              <input
                id={id}
                type="number"
                value={value}
                min={field.min}
                max={field.max}
                disabled={disabled}
                onChange={(event) => update(Number(event.target.value))}
              />
            ) : (
              <input
                id={id}
                type="text"
                value={value}
                disabled={disabled}
                onChange={(event) => update(event.target.value)}
              />
            )}
          </label>
        );
      })}
    </div>
  );
}
