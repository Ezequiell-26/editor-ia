import type { CSSProperties, ReactNode } from 'react';
import { Icon, type IconName } from '../../../components/Icon';

/** Controles de la réplica: se dibujan con spans para no inundar el árbol de
 *  accesibilidad con cientos de `slider`/`spinbutton` que no hacen nada. */

export function Keyframes(): ReactNode {
  return (
    <span className="me-kf" aria-hidden="true">
      <span>‹</span><span className="me-kf-diamond">◇</span><span>›</span>
    </span>
  );
}

export function NumberField({ value, suffix, wide = false, onCommit, min, max, step, ariaLabel }: {
  readonly value: string;
  readonly suffix?: string;
  readonly wide?: boolean;
  /** Si existe, el campo es editable de verdad (commitea al blur/Enter). */
  readonly onCommit?: ((value: number) => void) | undefined;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  /** Nombre accesible del input editable (varios campos por panel). */
  readonly ariaLabel?: string;
}): ReactNode {
  if (onCommit) {
    return (
      <span className={`me-num${wide ? ' me-num-wide' : ''}`}>
        {/* key remonta el input cuando el valor cambia desde afuera (undo,
            otra superficie) — defaultValue solo no reflejaría el nuevo prop. */}
        <input
          key={value}
          className="me-num-input"
          type="number"
          defaultValue={value}
          {...(min !== undefined ? { min } : {})}
          {...(max !== undefined ? { max } : {})}
          {...(step !== undefined ? { step } : {})}
          aria-label={ariaLabel ?? 'Valor numérico'}
          onBlur={(event) => {
            const raw = event.currentTarget.value;
            // Vacío o no numérico no escribe: Number('') === 0 commitearía un
            // borrado accidental del campo.
            if (raw.trim() === '') return;
            const next = Number(raw);
            if (Number.isFinite(next)) onCommit(next);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
          }}
        />
        {suffix ? <span className="me-num-suffix">{suffix}</span> : null}
      </span>
    );
  }
  return (
    <span className={`me-num${wide ? ' me-num-wide' : ''}`} aria-hidden="true">
      <span className="me-num-value">{value}</span>
      {suffix ? <span className="me-num-suffix">{suffix}</span> : null}
      <span className="me-num-spin"><i>▲</i><i>▼</i></span>
    </span>
  );
}

export function SliderRow({ label, value, percent, gradient, suffix = '', kf = true, muted = false, onCommit, min, max, step, ariaLabel }: {
  readonly label?: string;
  readonly value: string;
  readonly percent: number;
  readonly gradient?: string;
  readonly suffix?: string;
  readonly kf?: boolean;
  readonly muted?: boolean;
  /** Si existe, el número del slider es editable (commitea el valor mostrado). */
  readonly onCommit?: ((value: number) => void) | undefined;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly ariaLabel?: string;
}): ReactNode {
  return (
    <div className="me-ctrl-row">
      {label ? <span className="me-ctrl-label">{label}</span> : null}
      <span className={`me-slider${muted ? ' me-slider-muted' : ''}`} aria-hidden="true">
        <span
          className="me-slider-fill"
          style={{ width: `${Math.max(0, Math.min(100, percent))}%`, ...(gradient ? { '--me-grad': gradient } : null) } as CSSProperties}
        />
        <span className="me-slider-thumb" style={{ left: `${Math.max(0, Math.min(100, percent))}%` }} />
      </span>
      <NumberField value={value} {...(suffix ? { suffix } : {})} {...(onCommit ? { onCommit, min, max, step } : {})} {...(ariaLabel ? { ariaLabel } : {})} />
      {kf ? <Keyframes /> : null}
    </div>
  );
}

export function Toggle({ on = true, onToggle, label }: {
  readonly on?: boolean;
  /** Si existe, el toggle es real (botón role=switch); si no, span de la réplica. */
  readonly onToggle?: (() => void) | undefined;
  readonly label?: string;
}): ReactNode {
  const visual = <span className={`me-toggle${on ? ' on' : ''}`} aria-hidden="true"><i /></span>;
  if (!onToggle) return visual;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label ?? 'Alternar'}
      className="me-toggle-btn"
      onClick={onToggle}
    >
      {visual}
    </button>
  );
}

export function SectionTitle({ children, action, reset = false }: {
  readonly children: ReactNode;
  readonly action?: ReactNode;
  readonly reset?: boolean;
}): ReactNode {
  return (
    <div className="me-section-head">
      <strong>{children}</strong>
      <span className="me-section-rule" />
      {action ?? (reset ? <span className="me-reset" aria-hidden="true"><Icon name="refresh" size={11} /></span> : null)}
    </div>
  );
}

export function ModeTabs({ tabs, active, onSelect, compact = false }: {
  readonly tabs: readonly string[];
  readonly active: string;
  readonly onSelect?: (id: string) => void;
  readonly compact?: boolean;
}): ReactNode {
  return (
    <div className={`me-insp-tabs${compact ? ' me-insp-tabs-compact' : ''}`} role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab}
          type="button"
          role="tab"
          aria-selected={active === tab}
          className={`me-insp-tab${active === tab ? ' active' : ''}`}
          onClick={() => onSelect?.(tab)}
        >
          {tab}
        </button>
      ))}
    </div>
  );
}

export function PillTabs({ tabs, active, onSelect }: {
  readonly tabs: readonly string[];
  readonly active: string;
  readonly onSelect?: (id: string) => void;
}): ReactNode {
  return (
    <div className="me-pill-tabs">
      {tabs.map((tab) => (
        <button
          key={tab}
          type="button"
          className={`me-pill${active === tab ? ' active' : ''}`}
          onClick={() => onSelect?.(tab)}
        >
          {tab}
        </button>
      ))}
    </div>
  );
}

/** Osciloscopio «Parade RGB» de la captura 156. */
export function ScopesChart(): ReactNode {
  const bars: ReactNode[] = [];
  for (let channel = 0; channel < 3; channel += 1) {
    const color = ['#ff2d3f', '#25e04a', '#3b6cff'][channel];
    for (let i = 0; i < 46; i += 1) {
      const x = channel * 33.33 + (i / 46) * 33.33;
      const seed = Math.sin(i * 12.9898 + channel * 78.233) * 43758.5453;
      const r = seed - Math.floor(seed);
      const height = 8 + r * 60 + (i % 7 === 0 ? 18 : 0);
      bars.push(
        <rect
          key={`${channel}-${i}`}
          x={x}
          y={100 - height}
          width={0.72}
          height={height}
          fill={color}
          opacity={0.55 + r * 0.4}
        />,
      );
    }
  }
  return (
    <div className="me-scopes" aria-hidden="true">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none">
        {[25, 50, 75].map((y) => <line key={y} x1="0" y1={y} x2="100" y2={y} stroke="#2a2931" strokeWidth="0.3" />)}
        {bars}
      </svg>
      <span className="me-scopes-axis">100</span>
      <span className="me-scopes-axis y75">75</span>
      <span className="me-scopes-axis y50">50</span>
      <span className="me-scopes-axis y25">25</span>
      <span className="me-scopes-axis y0">0</span>
    </div>
  );
}

/** Rueda de color (Lift/Gamma/Gain/Offset y HSL). */
const WHEEL_GRADIENT =
  'radial-gradient(circle at 50% 50%, rgba(0,0,0,0.42), transparent 62%), ' +
  'conic-gradient(from 90deg, #ff3b3b, #ffe23b, #3be06a, #3bc8e0, #3b5be0, #c73be0, #ff3b3b)';

export function ColorWheel({ dot = [50, 50], radius = 62 }: {
  readonly dot?: readonly [number, number];
  readonly radius?: number;
}): ReactNode {
  return (
    <span
      className="me-wheel"
      style={{ width: radius * 2, height: radius * 2, '--me-grad': WHEEL_GRADIENT } as CSSProperties}
      aria-hidden="true"
    >
      <span className="me-wheel-dot" style={{ left: `${dot[0]}%`, top: `${dot[1]}%` }} />
    </span>
  );
}

/** Curva de tono de la captura 159. */
export function CurveChart(): ReactNode {
  return (
    <div className="me-curve" aria-hidden="true">
      <svg viewBox="0 0 100 60" preserveAspectRatio="none">
        {[25, 50, 75].map((x) => <line key={`v${x}`} x1={x} y1="0" x2={x} y2="60" stroke="#2a2931" strokeWidth="0.4" />)}
        {[20, 40].map((y) => <line key={`h${y}`} x1="0" y1={y} x2="100" y2={y} stroke="#2a2931" strokeWidth="0.4" />)}
        <line x1="5" y1="55" x2="28" y2="5" stroke="#e8e8ee" strokeWidth="0.9" />
        <line x1="7" y1="55" x2="30" y2="5" stroke="#8d8c95" strokeWidth="0.5" />
      </svg>
    </div>
  );
}

/** Forma de onda de audio determinista para los clips de la timeline. */
export function Waveform({ blocks = 110, height = 16, seed = 1 }: {
  readonly blocks?: number;
  readonly height?: number;
  readonly seed?: number;
}): ReactNode {
  const bars: ReactNode[] = [];
  for (let i = 0; i < blocks; i += 1) {
    const raw = Math.sin(i * 1.37 + seed * 2.1) * Math.cos(i * 0.31 + seed);
    const h = 2 + Math.abs(raw) * (height - 3);
    bars.push(<rect key={i} x={i} y={(height - h) / 2} width={0.62} height={h} rx={0.2} />);
  }
  return (
    <svg className="me-wave" viewBox={`0 0 ${blocks} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      {bars}
    </svg>
  );
}

export function Glyph({ name, size = 12 }: { readonly name: IconName; readonly size?: number }): ReactNode {
  return <Icon name={name} size={size} />;
}
