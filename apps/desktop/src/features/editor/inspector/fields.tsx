import { useEffect, useRef, useState } from 'react';

export function NumberField({
  label,
  value,
  min,
  max,
  step = 1,
  disabled = false,
  onCommit,
}: {
  readonly label: string;
  readonly value: number;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly disabled?: boolean;
  readonly onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const spinTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const spinBase = useRef(value);
  useEffect(() => {
    setDraft(String(value));
  }, [value]);
  useEffect(
    () => () => {
      if (spinTimer.current) clearTimeout(spinTimer.current);
    },
    [],
  );
  function stopSpin(): void {
    if (spinTimer.current) {
      clearTimeout(spinTimer.current);
      spinTimer.current = null;
    }
  }
  /** Paridad `caixa_numero.js` de AlaukCut: spinner con repetición
   * acelerada al mantener (primer tick a los 400 ms, luego 130 ms →
   * -14 ms por tick, mínimo 25 ms). Cada paso commitea en vivo como el
   * `input`+`change` del original. */
  /** Un paso del stepper con el mismo redondeo y clamp que el spinner. */
  function stepValue(base: number, direction: 1 | -1): number {
    const p = step || 1;
    const raw = base + p * direction;
    const rounded = Math.round(raw / p) * p;
    return min !== undefined || max !== undefined
      ? Math.max(min ?? -Infinity, Math.min(max ?? Infinity, rounded))
      : rounded;
  }
  function startSpin(direction: 1 | -1): void {
    if (disabled) return;
    spinBase.current = Number.isFinite(Number(draft)) ? Number(draft) : value;
    const stepOnce = (): void => {
      spinBase.current = stepValue(spinBase.current, direction);
      setDraft(String(spinBase.current));
      onCommit(spinBase.current);
    };
    stepOnce();
    let ritmo = 130;
    const tick = (): void => {
      stepOnce();
      ritmo = Math.max(25, ritmo - 14);
      spinTimer.current = setTimeout(tick, ritmo);
    };
    spinTimer.current = setTimeout(tick, 400);
  }
  function commit(): void {
    const numeric = Number(draft);
    if (Number.isFinite(numeric)) {
      const clamped =
        min !== undefined || max !== undefined
          ? Math.max(min ?? -Infinity, Math.min(max ?? Infinity, numeric))
          : numeric;
      onCommit(clamped);
      // Si el proyecto ya estaba en el valor clampado, el efecto de `value`
      // no corre y el input conservaría el texto fuera de rango (p. ej. 2).
      setDraft(String(clamped));
    } else {
      setDraft(String(value));
    }
  }
  return (
    <label className="field">
      <span>{label}</span>
      <span className="num-spin-wrap">
        <input
          type="number"
          value={draft}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commit();
              return;
            }
            // Stepper accesible por teclado: las flechas (y PgUp/PgDn ×10)
            // mueven el valor con el mismo clamp que los botones ▲▼, que
            // siguen siendo pointer-only dentro del campo. La repetición al
            // mantener la tecla la da el keydown repetido de forma nativa.
            const direction =
              event.key === 'ArrowUp' || event.key === 'PageUp'
                ? 1
                : event.key === 'ArrowDown' || event.key === 'PageDown'
                  ? -1
                  : 0;
            if (direction === 0 || disabled) return;
            event.preventDefault();
            const base = Number.isFinite(Number(draft)) ? Number(draft) : value;
            const times = event.key === 'PageUp' || event.key === 'PageDown' ? 10 : 1;
            let next = base;
            for (let index = 0; index < times; index += 1) {
              next = stepValue(next, direction);
            }
            setDraft(String(next));
            onCommit(next);
          }}
        />
        <span className="num-spin" aria-hidden="true">
          <button
            type="button"
            tabIndex={-1}
            disabled={disabled}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              startSpin(1);
            }}
            onPointerUp={stopSpin}
            onPointerCancel={stopSpin}
            onPointerLeave={stopSpin}
          >
            ▲
          </button>
          <button
            type="button"
            tabIndex={-1}
            disabled={disabled}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              startSpin(-1);
            }}
            onPointerUp={stopSpin}
            onPointerCancel={stopSpin}
            onPointerLeave={stopSpin}
          >
            ▼
          </button>
        </span>
      </span>
    </label>
  );
}
