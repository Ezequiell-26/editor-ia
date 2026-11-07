import { useEffect, useState } from 'react';

/**
 * Campo numérico con borrador local y confirmación explícita.
 *
 * Antes existía una copia idéntica en `SilenceCutsSection.tsx` y
 * `SpeechCutsSection.tsx`. Se extrae sin cambiar el contrato: el valor sólo
 * se confirma al perder foco o al pulsar Enter, se acota a [min, max] y una
 * entrada no numérica restaura el valor vigente.
 */
export function OptionField({
  label,
  value,
  min,
  max,
  step,
  onCommit,
}: {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => {
    setDraft(String(value));
  }, [value]);
  function commit(): void {
    const numeric = Number(draft);
    if (Number.isFinite(numeric)) {
      onCommit(Math.max(min, Math.min(max, numeric)));
    } else {
      setDraft(String(value));
    }
  }
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        value={draft}
        min={min}
        max={max}
        step={step}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
          }
        }}
      />
    </label>
  );
}
