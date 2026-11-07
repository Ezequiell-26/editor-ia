import { useRef, type PointerEvent as ReactPointerEvent } from 'react';
import type { GradeCurvePoint, GradeCurves } from '@editor-ia/project-schema';
import { IDENTITY_CURVE, MIDLINE_CURVE, sampleGradeCurve } from './color-engine';
import type { LayerChange } from './GradeControls';

/**
 * Real, editable tone curves. Every point writes to the persisted node layer;
 * the compiler samples these exact points into `feComponentTransfer` tables
 * (live) and into the existing FFmpeg `curves` filter (export).
 */

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const round = (value: number) => Number(value.toFixed(3));

interface CurveEditorProps {
  readonly label: string;
  readonly points: readonly GradeCurvePoint[] | undefined;
  readonly onChange: (points: GradeCurvePoint[], transient: boolean) => void;
  readonly neutral: 'identity' | 'midline';
  readonly color: string;
  readonly hint?: string;
}

export function GradeCurveEditor({ label, points, onChange, neutral, color, hint }: CurveEditorProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragging = useRef<number | null>(null);
  const baseline = neutral === 'midline' ? MIDLINE_CURVE : IDENTITY_CURVE;
  const curve = points && points.length >= 2 ? points : baseline;
  const samples = Array.from({ length: 33 }, (_, index) => {
    const x = index / 32;
    return `${x * 100},${100 - sampleGradeCurve(curve, x) * 100}`;
  }).join(' ');

  const toPoint = (event: ReactPointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    return {
      x: clamp01((event.clientX - rect.left) / Math.max(1, rect.width)),
      y: clamp01(1 - (event.clientY - rect.top) / Math.max(1, rect.height)),
    };
  };

  const updatePoint = (index: number, point: { x: number; y: number }, transient: boolean) => {
    const next = curve.map((item) => ({ ...item }));
    const edge = index === 0 || index === next.length - 1;
    next[index] = { x: edge ? next[index]!.x : point.x, y: round(point.y) };
    next.sort((a, b) => a.x - b.x);
    // Keep anchors and strict ordering; drop a point that would collide.
    const clean = next.filter((item, i) => i === 0 || item.x > next[i - 1]!.x + 0.001);
    if (clean.length < 2) return;
    clean[0] = { ...clean[0]!, x: 0 };
    clean[clean.length - 1] = { ...clean[clean.length - 1]!, x: 1 };
    onChange(clean, transient);
  };

  return (
    <div className="cg-curve">
      <div className="cg-curve-head">
        <strong>{label}</strong>
        <div className="cg-curve-actions">
          {hint ? <span className="cg-curve-hint">{hint}</span> : null}
          <button type="button" className="cg-btn small" onClick={() => onChange([...baseline], false)}>Reset</button>
        </div>
      </div>
      <svg
        ref={svgRef}
        className="cg-curve-svg"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        role="img"
        aria-label={`Curva ${label}`}
        onPointerDown={(event) => {
          if (dragging.current !== null) return;
          const point = toPoint(event);
          if (!point) return;
          // Click on empty space adds a control point (max 16).
          if (curve.length < 16 && point.x > 0.01 && point.x < 0.99) {
            const next = [...curve.map((item) => ({ ...item })), { x: round(point.x), y: round(point.y) }];
            next.sort((a, b) => a.x - b.x);
            onChange(next, false);
          }
        }}
        onPointerMove={(event) => {
          if (dragging.current === null) return;
          const point = toPoint(event);
          if (point) updatePoint(dragging.current, point, true);
        }}
        onPointerUp={() => {
          if (dragging.current !== null) {
            const index = dragging.current;
            dragging.current = null;
            onChange(curve.map((item) => ({ ...item })), false);
            void index;
          }
        }}
        onPointerCancel={() => { dragging.current = null; }}
      >
        <rect x="0" y="0" width="100" height="100" className="cg-curve-bg" />
        {[25, 50, 75].map((value) => (
          <g key={value}>
            <line x1={value} y1="0" x2={value} y2="100" className="cg-curve-grid" />
            <line x1="0" y1={value} x2="100" y2={value} className="cg-curve-grid" />
          </g>
        ))}
        <polyline points={`0,100 100,0`} className="cg-curve-identity" />
        <polyline points={samples} fill="none" stroke={color} className="cg-curve-line" />
        {curve.map((point, index) => (
          <circle
            key={index}
            cx={point.x * 100}
            cy={100 - point.y * 100}
            r="2.6"
            fill={color}
            className="cg-curve-point"
            onPointerDown={(event) => {
              event.stopPropagation();
              dragging.current = index;
              (event.currentTarget.ownerSVGElement ?? svgRef.current)?.setPointerCapture?.(event.pointerId);
            }}
            onDoubleClick={(event) => {
              event.stopPropagation();
              if (index === 0 || index === curve.length - 1 || curve.length <= 2) return;
              onChange(curve.filter((_, i) => i !== index).map((item) => ({ ...item })), false);
            }}
          />
        ))}
      </svg>
      <div className="cg-curve-foot"><span>0</span><span>{neutral === 'midline' ? '±' : 'salida'}</span><span>1</span></div>
    </div>
  );
}

export type GradeCurveTool = 'custom' | 'rgb' | 'selective';

export function CurvesPanel({
  layer, onChange, tool,
}: {
  readonly layer: import('@editor-ia/project-schema').ColorGradeLayer;
  readonly onChange: LayerChange;
  readonly tool: GradeCurveTool;
}) {
  const curves: GradeCurves = layer.curves;
  const set = (key: keyof GradeCurves, points: GradeCurvePoint[], transient: boolean) =>
    onChange((draft) => { draft.curves = { ...draft.curves, [key]: points }; }, transient);

  const tone = (key: 'master' | 'red' | 'green' | 'blue', label: string, color: string) => (
    <GradeCurveEditor key={key} label={label} points={curves[key]} neutral="identity" color={color}
      onChange={(points, transient) => set(key, points, transient)} />
  );

  if (tool === 'custom') {
    return <div className="cg-panel cg-curves">{tone('master', 'Custom · Master', '#f4f6fa')}</div>;
  }
  if (tool === 'rgb') {
    return (
      <div className="cg-panel cg-curves">
        {tone('master', 'Master', '#f4f6fa')}
        {tone('red', 'Rojo', '#ef5d5d')}
        {tone('green', 'Verde', '#4fcf7f')}
        {tone('blue', 'Azul', '#5b8dff')}
      </div>
    );
  }
  return (
    <div className="cg-panel cg-curves">
      <GradeCurveEditor label="Hue vs Hue" points={curves.hueVsHue} neutral="midline" color="#e6b45c" hint="0..1 = rueda de hue"
        onChange={(points, transient) => set('hueVsHue', points, transient)} />
      <GradeCurveEditor label="Hue vs Saturation" points={curves.hueVsSat} neutral="midline" color="#e6b45c"
        onChange={(points, transient) => set('hueVsSat', points, transient)} />
      <GradeCurveEditor label="Hue vs Luminance" points={curves.hueVsLum} neutral="midline" color="#e6b45c"
        onChange={(points, transient) => set('hueVsLum', points, transient)} />
      <GradeCurveEditor label="Luminance vs Saturation" points={curves.lumVsSat} neutral="midline" color="#8d9bff"
        onChange={(points, transient) => set('lumVsSat', points, transient)} />
    </div>
  );
}

export { IDENTITY_CURVE, MIDLINE_CURVE };
