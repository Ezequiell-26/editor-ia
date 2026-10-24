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
  return (
    <div className="motion-fields">
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
              <input
                id={id}
                type="color"
                value={colorValue(raw)}
                disabled={disabled}
                onChange={(event) => update(event.target.value)}
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
