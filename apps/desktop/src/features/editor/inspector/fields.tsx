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
  function startSpin(direction: 1 | -1): void {
    if (disabled) return;
    spinBase.current = Number.isFinite(Number(draft)) ? Number(draft) : value;
    const stepOnce = (): void => {
      const p = step || 1;
      const raw = spinBase.current + p * direction;
      const rounded = Math.round(raw / p) * p;
      const clamped =
        min !== undefined || max !== undefined
          ? Math.max(min ?? -Infinity, Math.min(max ?? Infinity, rounded))
          : rounded;
      spinBase.current = clamped;
      setDraft(String(clamped));
      onCommit(clamped);
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
            }
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
