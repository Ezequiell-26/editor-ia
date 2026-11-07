import { useRef, type PointerEvent as ReactPointerEvent } from 'react';
import {
  createNeutralLayer,
  type ColorGradeLayer,
  type ColorWheelValue,
  type GradeQualifier,
  type PowerWindow,
  type PowerWindowKind,
  type RgbMixer,
} from '@editor-ia/project-schema';

/**
 * All Color-page controls. There is no local-only state here: every change is
 * forwarded to `onChange`, which writes the grade into the project store (and
 * therefore into the live preview, the export and the undo history).
 */

export type LayerMutator = (draft: ColorGradeLayer) => void;
export type LayerChange = (mutate: LayerMutator, transient?: boolean) => void;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const round = (value: number, digits = 2) => Number(value.toFixed(digits));

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export function GradeSlider({
  label, value, min, max, step = 0.01, onChange, format,
}: {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step?: number;
  readonly onChange: (value: number, transient: boolean) => void;
  readonly format?: (value: number) => string;
}) {
  const display = format ? format(value) : String(round(value, 3));
  return (
    <label className="cg-row">
      <span className="cg-row-label">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(event) => onChange(Number(event.target.value), true)}
        onPointerUp={() => onChange(value, false)}
        onKeyUp={() => onChange(value, false)}
      />
      <input
        className="cg-number"
        type="number"
        min={min}
        max={max}
        step={step}
        value={round(value, 3)}
        aria-label={`${label} valor`}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isFinite(next)) onChange(clamp(next, min, max), false);
        }}
      />
      <span className="cg-row-value">{display}</span>
    </label>
  );
}

/** Resolve-style wheel: angle = hue, radius = strength, side bar = luminance. */
export function GradeWheel({
  label, value, onChange,
}: {
  readonly label: string;
  readonly value: ColorWheelValue;
  readonly onChange: (value: ColorWheelValue, transient: boolean) => void;
}) {
  const padRef = useRef<HTMLDivElement | null>(null);
  const dragging = useRef(false);
  const luma = (value.r + value.g + value.b) / 3;
  const u = value.b - luma;
  const v = value.r - luma;
  const radius = clamp(Math.hypot(u, v) / 1.2, 0, 1);
  const angle = Math.atan2(v, u);
  const px = 50 + Math.cos(angle) * radius * 42;
  const py = 50 + Math.sin(angle) * radius * 42;

  const emitFromPointer = (event: ReactPointerEvent<HTMLDivElement>, transient: boolean) => {
    const pad = padRef.current;
    if (!pad) return;
    const rect = pad.getBoundingClientRect();
    const dx = (event.clientX - (rect.left + rect.width / 2)) / (rect.width / 2);
    const dy = (event.clientY - (rect.top + rect.height / 2)) / (rect.height / 2);
    const r = clamp(Math.hypot(dx, dy), 0, 1) * 1.2;
    const a = Math.atan2(dy, dx);
    const nextU = Math.cos(a) * r;
    const nextV = Math.sin(a) * r;
    onChange({
      r: round(clamp(luma + nextV, -1, 1), 3),
      g: round(clamp(luma - nextU - nextV, -1, 1), 3),
      b: round(clamp(luma + nextU, -1, 1), 3),
    }, transient);
  };

  return (
    <div className="cg-wheel">
      <div className="cg-wheel-head">{label}</div>
      <div className="cg-wheel-body">
        <input
          className="cg-wheel-luma"
          type="range"
          min={-1}
          max={1}
          step={0.01}
          value={round(luma, 3)}
          aria-label={`${label} luminancia`}
          onChange={(event) => {
            const next = Number(event.target.value);
            const shift = next - luma;
            onChange({
              r: round(clamp(value.r + shift, -1, 1), 3),
              g: round(clamp(value.g + shift, -1, 1), 3),
              b: round(clamp(value.b + shift, -1, 1), 3),
            }, true);
          }}
          onPointerUp={() => onChange(value, false)}
        />
        <div
          ref={padRef}
          className="cg-wheel-pad"
          role="slider"
          tabIndex={0}
          aria-label={`${label} rueda de color`}
          aria-valuenow={round(radius, 2)}
          aria-valuemin={0}
          aria-valuemax={1}
          onPointerDown={(event) => {
            dragging.current = true;
            event.currentTarget.setPointerCapture(event.pointerId);
            emitFromPointer(event, true);
          }}
          onPointerMove={(event) => {
            if (dragging.current) emitFromPointer(event, true);
          }}
          onPointerUp={(event) => {
            dragging.current = false;
            event.currentTarget.releasePointerCapture(event.pointerId);
            emitFromPointer(event, false);
          }}
          onKeyDown={(event) => {
            const step = event.shiftKey ? 0.1 : 0.02;
            if (event.key === 'ArrowUp') onChange({ ...value, g: round(clamp(value.g + step, -1, 1), 3) }, false);
            else if (event.key === 'ArrowDown') onChange({ ...value, g: round(clamp(value.g - step, -1, 1), 3) }, false);
            else if (event.key === 'ArrowRight') onChange({ ...value, r: round(clamp(value.r + step, -1, 1), 3) }, false);
            else if (event.key === 'ArrowLeft') onChange({ ...value, r: round(clamp(value.r - step, -1, 1), 3) }, false);
            else return;
            event.preventDefault();
          }}
        >
          <span className="cg-wheel-marker" style={{ left: `${px}%`, top: `${py}%` }} />
        </div>
      </div>
      <div className="cg-wheel-values">
        R {round(value.r)} · G {round(value.g)} · B {round(value.b)}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tool panels
// ---------------------------------------------------------------------------

export function PrimariesPanel({ layer, onChange }: { readonly layer: ColorGradeLayer; readonly onChange: LayerChange }) {
  const wheel = (key: 'lift' | 'gamma' | 'gain' | 'offset', label: string) => (
    <GradeWheel
      label={label}
      value={layer.primaries[key]}
      onChange={(value, transient) => onChange((draft) => { draft.primaries[key] = value; }, transient)}
    />
  );
  return (
    <div className="cg-panel">
      <div className="cg-wheel-grid">
        {wheel('lift', 'Lift')}
        {wheel('gamma', 'Gamma')}
        {wheel('gain', 'Gain')}
        {wheel('offset', 'Offset')}
      </div>
      <div className="cg-group-title">Maestros</div>
      <GradeSlider label="Contraste" value={layer.primaries.contrast} min={-1} max={1}
        onChange={(value, transient) => onChange((draft) => { draft.primaries.contrast = value; }, transient)} />
      <GradeSlider label="Pivot" value={layer.primaries.pivot} min={0} max={1}
        onChange={(value, transient) => onChange((draft) => { draft.primaries.pivot = value; }, transient)} />
      <GradeSlider label="Saturación" value={layer.primaries.saturation} min={0} max={3}
        onChange={(value, transient) => onChange((draft) => { draft.primaries.saturation = value; }, transient)} />
      <GradeSlider label="Temperature" value={layer.primaries.temperature} min={-1} max={1}
        onChange={(value, transient) => onChange((draft) => { draft.primaries.temperature = value; }, transient)} />
      <GradeSlider label="Tint" value={layer.primaries.tint} min={-1} max={1}
        onChange={(value, transient) => onChange((draft) => { draft.primaries.tint = value; }, transient)} />
      <GradeSlider label="Balance de blancos" value={(layer.primaries.temperature + layer.primaries.tint) / 2} min={-1} max={1}
        onChange={(value, transient) => onChange((draft) => {
          draft.primaries.temperature = round(value, 3);
          draft.primaries.tint = round(value, 3);
        }, transient)} />
    </div>
  );
}

const HDR_ZONES: readonly { key: keyof ColorGradeLayer['hdr']; label: string }[] = [
  { key: 'global', label: 'Global' },
  { key: 'shadows', label: 'Shadows' },
  { key: 'dark', label: 'Dark' },
  { key: 'light', label: 'Light' },
  { key: 'highlights', label: 'Highlights' },
  { key: 'specular', label: 'Specular' },
];

export function HdrPanel({ layer, onChange }: { readonly layer: ColorGradeLayer; readonly onChange: LayerChange }) {
  return (
    <div className="cg-panel">
      <div className="cg-hdr-grid">
        {HDR_ZONES.map((zone) => (
          <div className="cg-hdr-zone" key={zone.key}>
            <GradeWheel
              label={zone.label}
              value={{ r: layer.hdr[zone.key], g: layer.hdr[zone.key], b: layer.hdr[zone.key] }}
              onChange={(value, transient) => onChange((draft) => {
                draft.hdr[zone.key] = round((value.r + value.g + value.b) / 3, 3);
              }, transient)}
            />
          </div>
        ))}
      </div>
      <p className="cg-hint">Cada zona actúa sobre una banda de luminancia con caída gaussiana; se compone en el filtro SVG por canal.</p>
    </div>
  );
}

const MIXER_ROWS: readonly { key: keyof RgbMixer; label: string }[] = [
  { key: 'red', label: 'Rojo' }, { key: 'green', label: 'Verde' }, { key: 'blue', label: 'Azul' },
];

export function EffectsPanel({
  layer, onChange, onImportLut, lutLabel,
}: {
  readonly layer: ColorGradeLayer;
  readonly onChange: LayerChange;
  readonly onImportLut: () => void;
  readonly lutLabel: string;
}) {
  return (
    <div className="cg-panel">
      <div className="cg-group-title">Blur &amp; Sharpen</div>
      <GradeSlider label="Blur" value={layer.blur} min={0} max={50} step={0.5}
        onChange={(value, transient) => onChange((draft) => { draft.blur = value; }, transient)} />
      <GradeSlider label="Sharpen" value={layer.sharpen} min={0} max={5} step={0.1}
        onChange={(value, transient) => onChange((draft) => { draft.sharpen = value; }, transient)} />

      <div className="cg-group-title">RGB Mixer</div>
      <div className="cg-mixer">
        <span />
        <span>R</span><span>G</span><span>B</span>
        {MIXER_ROWS.map((row) => (
          <div className="cg-mixer-row" key={row.key}>
            <span>{row.label}</span>
            {([0, 1, 2] as const).map((column) => (
              <input
                key={column}
                type="number"
                min={-1}
                max={1}
                step={0.05}
                value={round(layer.mixer[row.key][column], 2)}
                aria-label={`${row.label} desde ${['R', 'G', 'B'][column]}`}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  if (!Number.isFinite(next)) return;
                  onChange((draft) => {
                    const values = [...draft.mixer[row.key]] as [number, number, number];
                    values[column] = round(clamp(next, -1, 1), 3);
                    draft.mixer[row.key] = values;
                  });
                }}
              />
            ))}
          </div>
        ))}
      </div>

      <div className="cg-group-title">Color Warper</div>
      <GradeSlider label="Hue" value={layer.warper.hue} min={-1} max={1}
        onChange={(value, transient) => onChange((draft) => { draft.warper.hue = value; }, transient)} />
      <GradeSlider label="Saturación" value={layer.warper.saturation} min={-1} max={1}
        onChange={(value, transient) => onChange((draft) => { draft.warper.saturation = value; }, transient)} />

      <div className="cg-group-title">LUT</div>
      <div className="cg-lut">
        <button type="button" className="cg-btn" onClick={onImportLut}>Importar .cube</button>
        <span className="cg-lut-name" title={lutLabel}>{lutLabel}</span>
      </div>
      <GradeSlider label="Intensidad LUT" value={layer.lutIntensity} min={0} max={1}
        onChange={(value, transient) => onChange((draft) => { draft.lutIntensity = value; }, transient)} />
      <p className="cg-hint">El LUT se aplica con <code>lut3d</code> en el export FFmpeg ya existente; el visor usa la proyección de color del nodo.</p>
    </div>
  );
}

export function QualifierPanel({ layer, onChange }: { readonly layer: ColorGradeLayer; readonly onChange: LayerChange }) {
  const q: GradeQualifier = layer.qualifier;
  const patch = (key: keyof GradeQualifier, value: number | boolean, transient = false) =>
    onChange((draft) => { (draft.qualifier as unknown as Record<string, unknown>)[key] = value; }, transient);
  return (
    <div className="cg-panel">
      <label className="cg-check">
        <input type="checkbox" checked={q.enabled} onChange={(event) => patch('enabled', event.target.checked)} />
        Activar Qualifier (clave por color)
      </label>
      <GradeSlider label="Hue" value={q.hue} min={0} max={1} onChange={(value, transient) => patch('hue', value, transient)} />
      <GradeSlider label="Ancho de hue" value={q.hueWidth} min={0.01} max={1} onChange={(value, transient) => patch('hueWidth', value, transient)} />
      <GradeSlider label="Saturación mín" value={q.satMin} min={0} max={1} onChange={(value, transient) => patch('satMin', value, transient)} />
      <GradeSlider label="Saturación máx" value={q.satMax} min={0} max={1} onChange={(value, transient) => patch('satMax', value, transient)} />
      <GradeSlider label="Luma mín" value={q.lumMin} min={0} max={1} onChange={(value, transient) => patch('lumMin', value, transient)} />
      <GradeSlider label="Luma máx" value={q.lumMax} min={0} max={1} onChange={(value, transient) => patch('lumMax', value, transient)} />
      <GradeSlider label="Feather" value={q.feather} min={0} max={1} onChange={(value, transient) => patch('feather', value, transient)} />
      <label className="cg-check">
        <input type="checkbox" checked={q.invert} onChange={(event) => patch('invert', event.target.checked)} />
        Invertir selección
      </label>
      <p className="cg-hint">La clave se calcula por píxel en el muestreador del visor y limita la corrección del nodo activo.</p>
    </div>
  );
}

const WINDOW_KINDS: readonly { id: PowerWindowKind; label: string }[] = [
  { id: 'circle', label: 'Círculo' }, { id: 'rect', label: 'Rectángulo' },
  { id: 'polygon', label: 'Polígono' }, { id: 'gradient', label: 'Degradado' },
];

export function WindowsPanel({ layer, onChange }: { readonly layer: ColorGradeLayer; readonly onChange: LayerChange }) {
  const addWindow = (kind: PowerWindowKind) => {
    const window: PowerWindow = {
      id: `win-${Date.now().toString(36)}`, kind, enabled: true,
      x: 0.5, y: 0.5, width: 0.4, height: 0.4, rotation: 0, feather: 0.25,
      tracking: false, dx: 0, dy: 0,
      ...(kind === 'polygon' ? { points: [{ x: 0.3, y: 0.2 }, { x: 0.7, y: 0.2 }, { x: 0.8, y: 0.8 }, { x: 0.2, y: 0.8 }] } : {}),
    };
    onChange((draft) => { draft.windows = [...draft.windows, window].slice(0, 8); });
  };
  const patchWindow = (id: string, key: keyof PowerWindow, value: number | boolean, transient = false) =>
    onChange((draft) => {
      const target = draft.windows.find((item) => item.id === id);
      if (target) (target as unknown as Record<string, unknown>)[key] = value;
    }, transient);

  return (
    <div className="cg-panel">
      <div className="cg-window-add">
        {WINDOW_KINDS.map((kind) => (
          <button key={kind.id} type="button" className="cg-btn" onClick={() => addWindow(kind.id)}>+ {kind.label}</button>
        ))}
      </div>
      {layer.windows.length === 0 ? <p className="cg-hint">Sin Power Windows: la corrección afecta a todo el fotograma.</p> : null}
      {layer.windows.map((window, index) => (
        <div className="cg-window" key={window.id}>
          <div className="cg-window-head">
            <input
              type="checkbox"
              checked={window.enabled}
              aria-label={`Activar ventana ${index + 1}`}
              onChange={(event) => patchWindow(window.id, 'enabled', event.target.checked)}
            />
            <strong>{WINDOW_KINDS.find((item) => item.id === window.kind)?.label} {index + 1}</strong>
            <button type="button" className="cg-btn small" aria-label="Eliminar ventana"
              onClick={() => onChange((draft) => { draft.windows = draft.windows.filter((item) => item.id !== window.id); })}>×</button>
          </div>
          <GradeSlider label="X" value={window.x} min={0} max={1} onChange={(value, transient) => patchWindow(window.id, 'x', value, transient)} />
          <GradeSlider label="Y" value={window.y} min={0} max={1} onChange={(value, transient) => patchWindow(window.id, 'y', value, transient)} />
          <GradeSlider label="Ancho" value={window.width} min={0.02} max={1} onChange={(value, transient) => patchWindow(window.id, 'width', value, transient)} />
          <GradeSlider label="Alto" value={window.height} min={0.02} max={1} onChange={(value, transient) => patchWindow(window.id, 'height', value, transient)} />
          <GradeSlider label="Rotación" value={window.rotation} min={-180} max={180} step={1} onChange={(value, transient) => patchWindow(window.id, 'rotation', value, transient)} />
          <GradeSlider label="Feather" value={window.feather} min={0} max={1} onChange={(value, transient) => patchWindow(window.id, 'feather', value, transient)} />
          <label className="cg-check">
            <input type="checkbox" checked={window.tracking}
              onChange={(event) => patchWindow(window.id, 'tracking', event.target.checked)} />
            Tracking de máscara (centroide de la clave)
          </label>
        </div>
      ))}
    </div>
  );
}

/** Used by the node toolbar when creating a fresh corrector. */
export { createNeutralLayer };
