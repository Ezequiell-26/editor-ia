import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import {
  createNeutralHdrWheels,
  createNeutralLayer,
  createNeutralPanelState,
  createNeutralWheelXY,
  type ColorGradeLayer,
  type GradeCurvePoint,
  type GradePanelState,
  type HdrWheels,
  type WheelXY,
} from '@editor-ia/project-schema';
import { Icon } from '../../../components/Icon';
import { ColorStudio } from '../../color/ColorStudio';
import { createBuiltinLooks, deleteGradePreset, loadGradePresets, saveGradePreset, type GradePreset } from '../../color/grade-presets';
import { useClipGrade, type ClipGradeApi } from '../../color/useClipGrade';
import { wheelValueFromXY, xyFromWheelValue } from '../../color/wheel-math';
import { GradeCurveEditor } from '../../color/GradeCurves';
import { FilmoraWheel } from './FilmoraWheel';
import { PropertySlider } from './PropertySlider';
import './properties.css';

/**
 * Right-hand properties panel rebuilt from captures 118 (Color / Básico) and
 * 127 (Máscara de color / HDR). Every control writes through `useClipGrade` to
 * the project document, so preview, scopes, undo/redo, autosave and FFmpeg
 * export stay in sync. There is no decorative local copy of a correction.
 */

export type PropertiesMode = 'color' | 'mask';

type SliderKey = 'temperature' | 'tint' | 'intensity' | 'saturation' | 'light' | 'exposure';
type CurveChannel = 'master' | 'red' | 'green' | 'blue';
type PrimaryWheel = 'gamma' | 'lift' | 'gain';
type HdrZone = keyof HdrWheels;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));

const FIELDS: Record<SliderKey, {
  readonly label: string;
  readonly gradient: string;
  readonly get: (layer: ColorGradeLayer) => number;
  readonly set: (layer: ColorGradeLayer, signed: number) => void;
}> = {
  temperature: {
    label: 'Temperatura',
    gradient: 'linear-gradient(90deg,#38bdf8,#9ca3af,#f59e0b)',
    get: (layer) => layer.primaries.temperature * 100,
    set: (layer, signed) => { layer.primaries.temperature = clamp(signed, -1, 1); },
  },
  tint: {
    label: 'Tinte',
    gradient: 'linear-gradient(90deg,#22c55e,#9ca3af,#c026d3)',
    get: (layer) => layer.primaries.tint * 100,
    set: (layer, signed) => { layer.primaries.tint = clamp(signed, -1, 1); },
  },
  intensity: {
    label: 'Intensidad',
    gradient: 'linear-gradient(90deg,#b45309,#eab308,#22c55e,#3b82f6,#d946ef)',
    get: (layer) => layer.primaries.contrast * 100,
    set: (layer, signed) => { layer.primaries.contrast = clamp(signed, -1, 1); },
  },
  saturation: {
    label: 'Saturación',
    gradient: 'linear-gradient(90deg,#a16207,#d6d3d1,#22c55e,#ec4899)',
    get: (layer) => (layer.primaries.saturation - 1) * 100,
    set: (layer, signed) => { layer.primaries.saturation = clamp(1 + signed, 0, 3); },
  },
  light: {
    label: 'Luz',
    gradient: 'linear-gradient(90deg,#111827,#6b7280,#f8fafc)',
    get: (layer) => layer.hdr.light * 100,
    set: (layer, signed) => { layer.hdr.light = clamp(signed, -1, 1); },
  },
  exposure: {
    label: 'Exposición',
    gradient: 'linear-gradient(90deg,#111827,#9ca3af,#f8fafc)',
    get: (layer) => layer.hdr.global * 100,
    set: (layer, signed) => { layer.hdr.global = clamp(signed, -1, 1); },
  },
};

const HSL_SWATCHES = [
  '#e25252', '#d99a3c', '#d4c44a', '#5aa75f',
  '#3f9e9e', '#4a7fd4', '#7a56c2', '#c0509a',
] as const;

const CURVE_CHANNELS: readonly { id: CurveChannel; label: string; color: string }[] = [
  { id: 'master', label: 'Luma', color: '#c9ced3' },
  { id: 'red', label: 'Rojo', color: '#e25252' },
  { id: 'green', label: 'Verde', color: '#5aa75f' },
  { id: 'blue', label: 'Azul', color: '#4a7fd4' },
];

const HDR_ZONES: readonly { id: HdrZone; label: string }[] = [
  { id: 'black', label: 'Negro' },
  { id: 'dark', label: 'Oscuro' },
  { id: 'shadow', label: 'Sombra' },
  { id: 'light', label: 'Claro' },
];

const PRIMARY_WHEELS: readonly { id: PrimaryWheel; label: string }[] = [
  { id: 'gamma', label: 'Tonos medios' },
  { id: 'lift', label: 'Sombras' },
  { id: 'gain', label: 'Iluminaciones' },
];

const LUT_PRESETS: readonly { id: string; label: string; points: readonly GradeCurvePoint[] }[] = [
  { id: 'none', label: 'Ninguna', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
  { id: 'contrast', label: 'Contraste medio', points: [{ x: 0, y: 0 }, { x: 0.25, y: 0.2 }, { x: 0.5, y: 0.5 }, { x: 0.75, y: 0.82 }, { x: 1, y: 1 }] },
  { id: 'vintage', label: 'Vintage', points: [{ x: 0, y: 0.06 }, { x: 0.5, y: 0.48 }, { x: 1, y: 0.94 }] },
  { id: 'film', label: 'Filmic', points: [{ x: 0, y: 0.02 }, { x: 0.3, y: 0.26 }, { x: 0.7, y: 0.76 }, { x: 1, y: 0.98 }] },
];

function looks() {
  const builtin = createBuiltinLooks();
  const byId = (id: string): ColorGradeLayer =>
    builtin.find((item) => item.id === id)?.layer ?? createNeutralLayer();
  return [
    { id: 'none', label: 'Ninguna', tone: 'transparent', layer: createNeutralLayer() },
    { id: 'mono', label: 'Blanco y negro', tone: 'linear-gradient(135deg,#e5e5e5,#3f3f46)', layer: byId('mono') },
    { id: 'warm', label: 'Éxito de luz', tone: 'linear-gradient(135deg,#7dd3fc,#f59e0b)', layer: byId('warm') },
    { id: 'cinema', label: 'Restaurar color', tone: 'linear-gradient(135deg,#fca5a5,#5eead4)', layer: byId('cinema') },
  ] as const;
}

interface PanelContext {
  readonly api: ClipGradeApi;
  readonly panel: GradePanelState;
  readonly patchPanel: (patch: Partial<GradePanelState>) => void;
  readonly keyed: ReadonlySet<string>;
  readonly toggleKey: (id: string) => void;
  readonly setField: (key: SliderKey, value: number, transient: boolean) => void;
  readonly setNotice: (text: string) => void;
}

function usePanelContext(api: ClipGradeApi, setNotice: (text: string) => void): PanelContext {
  const { layer, patchLayer } = api;
  const panel = layer.panel ?? createNeutralPanelState();
  const keyed = useMemo(() => new Set(layer.keyed ?? []), [layer.keyed]);
  return {
    api,
    panel,
    keyed,
    patchPanel: (patch) => patchLayer((draft) => {
      draft.panel = { ...createNeutralPanelState(), ...draft.panel, ...patch };
    }),
    toggleKey: (id) => patchLayer((draft) => {
      const next = new Set(draft.keyed ?? []);
      if (next.has(id)) next.delete(id); else next.add(id);
      draft.keyed = [...next];
    }),
    setField: (key, value, transient) => patchLayer((draft) => {
      FIELDS[key].set(draft, value / 100);
    }, transient),
    setNotice,
  };
}

function Section({
  title, open, children, onToggle, badge,
}: {
  readonly title: string;
  readonly open: boolean;
  readonly children: ReactNode;
  readonly onToggle?: () => void;
  readonly badge?: string;
}) {
  return (
    <section className={`fp-section${open ? '' : ' is-collapsed'}`}>
      <h4>
        {onToggle ? (
          <button type="button" aria-expanded={open} onClick={onToggle}>
            <span>{title}</span>
            {badge ? <em className="fp-badge">{badge}</em> : null}
            <Icon name="chevron-down" size={11} />
          </button>
        ) : (
          <span className="fp-section-static">
            <span>{title}</span>
            {badge ? <em className="fp-badge">{badge}</em> : null}
          </span>
        )}
      </h4>
      {open ? <div className="fp-section-body">{children}</div> : null}
    </section>
  );
}

/* ── Básico (captura 118) ─────────────────────────────────────────────── */

function BasicPanel({ ctx }: { readonly ctx: PanelContext }) {
  const { api, panel, patchPanel, keyed, toggleKey, setField, setNotice } = ctx;
  const { layer, patchLayer, applyLayer } = api;
  const [styleOpen, setStyleOpen] = useState(true);
  const [colorOpen, setColorOpen] = useState(true);
  const [lightOpen, setLightOpen] = useState(true);
  const [presets, setPresets] = useState<readonly GradePreset[]>(() => loadGradePresets());
  const styleLooks = useMemo(() => looks(), []);
  const activeLook = layer.lookId ?? 'none';
  const lutPoints = layer.curves.master;
  const activeLut = LUT_PRESETS.find((item) =>
    item.points.length === (lutPoints?.length ?? 2) &&
    item.points.every((point, index) => Math.abs(point.y - (lutPoints?.[index]?.y ?? point.y)) < 0.001),
  )?.id ?? 'none';

  const applyLook = (id: string, next: ColorGradeLayer): void => {
    patchLayer((draft) => {
      Object.assign(draft, createNeutralLayer(), JSON.parse(JSON.stringify(next)) as ColorGradeLayer);
      draft.lookId = id;
      draft.keyed = [];
      draft.hdrWheels = createNeutralHdrWheels();
      draft.panel = { ...createNeutralPanelState(), ...draft.panel, styleTab: panel.styleTab };
    });
    setNotice(id === 'none' ? 'Estilo restablecido.' : `Estilo «${styleLooks.find((l) => l.id === id)?.label ?? id}» aplicado.`);
  };

  const saveCustom = (): void => {
    const next = saveGradePreset(`Personalizado ${presets.length + 1}`, { layer });
    setPresets(next);
    patchPanel({ styleTab: 'custom' });
    setNotice('Look guardado en «Personalizado».');
  };

  return (
    <>
      <Section title="Estilo" open={styleOpen} onToggle={() => setStyleOpen((v) => !v)}>
        <div className="fp-style-tabs" role="tablist" aria-label="Estilo">
          {(['default', 'custom'] as const).map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={panel.styleTab === id}
              className={panel.styleTab === id ? 'active' : ''}
              onClick={() => patchPanel({ styleTab: id })}
            >
              {id === 'default' ? 'Predeterminado' : 'Personalizado'}
            </button>
          ))}
        </div>
        {panel.styleTab === 'default' ? (
          <div className="fp-look-grid">
            {styleLooks.map((look) => (
              <button
                key={look.id}
                type="button"
                className={`fp-look${activeLook === look.id ? ' active' : ''}`}
                onClick={() => applyLook(look.id, look.layer)}
                title={look.label}
              >
                <span className="fp-look-thumb" style={{ background: look.tone } as CSSProperties}>
                  {look.id === 'none' ? <Icon name="close" size={16} /> : null}
                </span>
                <span className="fp-look-label">{look.label}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="fp-custom-list">
            {presets.length === 0 ? (
              <p className="fp-empty">Todavía no guardaste ningún look personalizado.</p>
            ) : presets.map((preset) => (
              <div className="fp-custom-row" key={preset.id}>
                <button
                  type="button"
                  className="fp-custom-apply"
                  onClick={() => {
                    if (preset.layer) applyLayer(preset.layer);
                    setNotice(`Look «${preset.name}» aplicado.`);
                  }}
                >
                  {preset.name}
                </button>
                <button
                  type="button"
                  className="fp-custom-delete"
                  aria-label={`Eliminar ${preset.name}`}
                  onClick={() => setPresets(deleteGradePreset(preset.id))}
                >
                  <Icon name="trash" size={12} />
                </button>
              </div>
            ))}
            <button type="button" className="fp-link" onClick={saveCustom}>Guardar el ajuste actual</button>
          </div>
        )}
        <button type="button" className="fp-more" aria-label="Más estilos" title="Más estilos">⌄</button>
      </Section>

      <div className="fp-auto-row">
        <label className="fp-check">
          <input
            type="checkbox"
            checked={panel.autoColor}
            onChange={(event) => {
              const enabled = event.target.checked;
              patchLayer((draft) => {
                draft.panel = { ...createNeutralPanelState(), ...draft.panel, autoColor: enabled };
                if (enabled) {
                  draft.primaries.temperature = 0;
                  draft.primaries.tint = 0;
                  draft.primaries.saturation = 1;
                }
              });
              setNotice(enabled ? 'Balance automático: temperatura, tinte y saturación neutros.' : 'Balance automático desactivado.');
            }}
          />
          <span>Color automático</span>
          <em className="fp-badge fp-badge--new">NEW</em>
        </label>
        <span className="fp-chevron"><Icon name="chevron-down" size={11} /></span>
        <button
          type="button"
          className={`fp-keyframe${keyed.has('autoColor') ? ' active' : ''}`}
          aria-label="Marcar color automático"
          onClick={() => toggleKey('autoColor')}
        >◇</button>
      </div>
      <div className="fp-interference">
        <span>Interferencia</span>
        <input
          type="range"
          min={0}
          max={100}
          value={panel.interference}
          aria-label="Interferencia"
          title="Mezcla del ajuste de color sobre el clip (0–100 %)"
          onChange={(event) => patchPanel({ interference: Number(event.target.value) })}
          onPointerUp={() => patchLayer((draft) => { draft.mix = clamp((draft.panel?.interference ?? 80) / 100, 0, 1); })}
        />
        <output>{panel.interference} %</output>
        <button
          type="button"
          className={`fp-keyframe${keyed.has('interference') ? ' active' : ''}`}
          aria-label="Marcar interferencia"
          onClick={() => toggleKey('interference')}
        >◇</button>
      </div>

      <div className="fp-group-head">
        <label className="fp-check">
          <input
            type="checkbox"
            checked={panel.lut}
            onChange={(event) => {
              patchLayer((draft) => {
                draft.panel = { ...createNeutralPanelState(), ...draft.panel, lut: event.target.checked };
                draft.lutIntensity = event.target.checked ? 1 : 0;
              });
            }}
          />
          <span>LUT</span>
          <Icon name="chevron-down" size={10} />
        </label>
        <select
          aria-label="LUT"
          value={activeLut}
          disabled={!panel.lut}
          onChange={(event) => {
            const preset = LUT_PRESETS.find((item) => item.id === event.target.value);
            if (!preset) return;
            patchLayer((draft) => {
              draft.curves = { ...draft.curves, master: [...preset.points] };
              draft.lutIntensity = 1;
            });
            setNotice(`Curva LUT «${preset.label}» aplicada.`);
          }}
        >
          {LUT_PRESETS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
        <button
          type="button"
          className={`fp-keyframe${keyed.has('lut') ? ' active' : ''}`}
          aria-label="Marcar LUT"
          onClick={() => toggleKey('lut')}
        >◇</button>
      </div>

      <Section
        title="Color"
        open={panel.color && colorOpen}
        onToggle={() => setColorOpen((v) => !v)}
      >
        <div className="fp-white-row">
          <span>Balance de blancos automático</span>
          <select
            aria-label="Balance de blancos automático"
            value={panel.whiteBalance}
            onChange={(event) => {
              const mode = event.target.value as GradePanelState['whiteBalance'];
              patchLayer((draft) => {
                draft.panel = { ...createNeutralPanelState(), ...draft.panel, whiteBalance: mode };
                if (mode === 'auto') { draft.primaries.temperature = 0; draft.primaries.tint = 0; }
              });
            }}
          >
            <option value="auto">Automática</option>
            <option value="manual">Manual</option>
          </select>
          <button type="button" className="fp-eyedropper" aria-label="Tomar muestra" title="Tomar muestra del visor (usa el balance neutro)">⌖</button>
        </div>
        {(['temperature', 'tint', 'intensity', 'saturation'] as const).map((key) => (
          <PropertySlider
            key={key}
            label={FIELDS[key].label}
            gradient={FIELDS[key].gradient}
            value={FIELDS[key].get(layer)}
            disabled={panel.whiteBalance === 'auto' && (key === 'temperature' || key === 'tint')}
            keyed={keyed.has(key)}
            onKeyToggle={() => toggleKey(key)}
            onChange={(value, transient) => setField(key, value, transient)}
          />
        ))}
      </Section>

      <Section title="Luz" open={panel.light && lightOpen} onToggle={() => setLightOpen((v) => !v)}>
        <PropertySlider
          label={FIELDS.exposure.label}
          gradient={FIELDS.exposure.gradient}
          value={FIELDS.exposure.get(layer)}
          keyed={keyed.has('exposure')}
          onKeyToggle={() => toggleKey('exposure')}
          onChange={(value, transient) => setField('exposure', value, transient)}
        />
      </Section>
    </>
  );
}

/* ── HSL (captura 121) ────────────────────────────────────────────────── */

function HslPanel({ ctx }: { readonly ctx: PanelContext }) {
  const { api, panel, patchPanel, keyed, toggleKey, setField } = ctx;
  const { layer, patchLayer } = api;
  return (
    <>
      <Section title="HSL" open>
        <div className="fp-hsl-swatches" role="radiogroup" aria-label="Canal HSL">
          {HSL_SWATCHES.map((color, index) => (
            <button
              key={color}
              type="button"
              role="radio"
              aria-checked={panel.hslSwatch === index}
              aria-label={`Canal HSL ${index + 1}`}
              className={panel.hslSwatch === index ? 'active' : ''}
              style={{ background: color }}
              onClick={() => {
                patchPanel({ hslSwatch: index });
                patchLayer((draft) => { draft.warper.hue = clamp((index / 7) * 2 - 1, -1, 1); });
              }}
            />
          ))}
        </div>
        <div className="fp-slider-row fp-hsl-tone">
          <label className="fp-slider-label" htmlFor="fp-hsl-hue">Tono</label>
          <input
            id="fp-hsl-hue"
            type="range"
            min={-100}
            max={100}
            value={layer.warper.hue * 100}
            aria-label="Tono"
            onChange={(event) => {
              const value = Number(event.target.value);
              patchLayer((draft) => { draft.warper.hue = clamp(value / 100, -1, 1); }, true);
            }}
            onPointerUp={() => patchLayer(() => {})}
          />
          <output>{(layer.warper.hue).toFixed(2).replace('.', ',')}</output>
          <button
            type="button"
            className={`fp-keyframe${keyed.has('hue') ? ' active' : ''}`}
            aria-label="Marcar tono"
            onClick={() => toggleKey('hue')}
          >◇</button>
        </div>
        <PropertySlider label="Saturación" gradient={FIELDS.saturation.gradient} value={FIELDS.saturation.get(layer)} keyed={keyed.has('saturation')} onKeyToggle={() => toggleKey('saturation')} onChange={(v, t) => setField('saturation', v, t)} />
        <PropertySlider label="Luminancia" gradient={FIELDS.light.gradient} value={FIELDS.light.get(layer)} keyed={keyed.has('light')} onKeyToggle={() => toggleKey('light')} onChange={(v, t) => setField('light', v, t)} />
      </Section>
    </>
  );
}

/* ── Curvas (captura 122) ─────────────────────────────────────────────── */

function CurvesPanel({ ctx }: { readonly ctx: PanelContext }) {
  const { api } = ctx;
  const [channel, setChannel] = useState<CurveChannel>('master');
  const { layer, patchLayer } = api;
  const meta = CURVE_CHANNELS.find((item) => item.id === channel) ?? CURVE_CHANNELS[0]!;
  return (
    <Section title="Curvas" open>
      <div className="fp-channel-row" role="tablist" aria-label="Canal de curva">
        {CURVE_CHANNELS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={channel === item.id}
            className={channel === item.id ? 'active' : ''}
            onClick={() => setChannel(item.id)}
          >
            <i style={{ background: item.color }} />{item.label}
          </button>
        ))}
      </div>
      <GradeCurveEditor
        label={meta.label}
        points={layer.curves[channel]}
        neutral="identity"
        color={meta.color}
        hint="Arrastrá para agregar puntos; doble clic para quitar"
        onChange={(points, transient) => patchLayer((draft) => {
          draft.curves = { ...draft.curves, [channel]: points };
        }, transient)}
      />
      <button
        type="button"
        className="fp-link"
        onClick={() => patchLayer((draft) => {
          draft.curves = { ...draft.curves, [channel]: [{ x: 0, y: 0 }, { x: 1, y: 1 }] };
        })}
      >
        Restablecer curva
      </button>
    </Section>
  );
}

/* ── Ruedas cromáticas (captura 123) ──────────────────────────────────── */

function WheelsPanel({ ctx }: { readonly ctx: PanelContext }) {
  const { api } = ctx;
  const { layer, patchLayer } = api;
  return (
    <Section title="Ruedas cromáticas" open>
      <div className="fp-wheel-grid fp-wheel-grid--primary">
        {PRIMARY_WHEELS.map((item) => {
          const xy = xyFromWheelValue(layer.primaries[item.id]);
          return (
            <FilmoraWheel
              key={item.id}
              label={item.label}
              value={xy}
              size={item.id === 'gamma' ? 132 : 104}
              onChange={(next, transient) => patchLayer((draft) => {
                draft.primaries[item.id] = wheelValueFromXY(next.x, next.y, next.luma);
              }, transient)}
            />
          );
        })}
      </div>
    </Section>
  );
}

/* ── HDR (captura 127) ────────────────────────────────────────────────── */

function HdrPanel({ ctx }: { readonly ctx: PanelContext }) {
  const { api } = ctx;
  const { layer, patchLayer } = api;
  const wheels: HdrWheels = layer.hdrWheels ?? createNeutralHdrWheels();
  const enabled = layer.hdrWheels !== undefined;
  return (
    <>
      <label className="fp-check fp-hdr-toggle">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => patchLayer((draft) => {
            if (event.target.checked) draft.hdrWheels = createNeutralHdrWheels();
            else delete draft.hdrWheels;
          })}
        />
        <span>Rueda cromática HDR</span>
        <Icon name="chevron-down" size={10} />
      </label>
      {/* Las ruedas nunca se bloquean: en la referencia el checkbox puede
          estar sin marcar y aun así se arrastran. La primera interacción
          materializa hdrWheels y activa la corrección automáticamente. */}
      <div className="fp-wheel-grid fp-wheel-grid--hdr">
        {HDR_ZONES.map((zone) => (
          <FilmoraWheel
            key={zone.id}
            label={zone.label}
            value={wheels[zone.id] ?? createNeutralWheelXY()}
            size={116}
            onChange={(next: WheelXY, transient: boolean) => patchLayer((draft) => {
              const current = draft.hdrWheels ?? createNeutralHdrWheels();
              current[zone.id] = { x: next.x, y: next.y, luma: next.luma };
              draft.hdrWheels = current;
            }, transient)}
          />
        ))}
      </div>
    </>
  );
}

/* ── Capas (capturas 119/120) ─────────────────────────────────────────── */

function LayersPanel({ ctx }: { readonly ctx: PanelContext }) {
  const { api, setNotice } = ctx;
  const { layers, activeNodeId, selectLayer, removeLayer, addLayer, setGrade, grade } = api;
  return (
    <Section title="Capas de gradación" open>
      {layers.length === 0 ? (
        <p className="fp-empty">Sin capas. Agregá una para corregir por zonas.</p>
      ) : layers.map((item) => (
        <div key={item.id} className={`fp-layer${activeNodeId === item.id ? ' active' : ''}`}>
          <button type="button" className="fp-layer-select" onClick={() => selectLayer(item.id)}>
            <Icon name="layers" size={12} />
            <span>{item.label}</span>
          </button>
          <label className="fp-layer-toggle" title="Activar capa">
            <input
              type="checkbox"
              checked={item.enabled}
              aria-label={`Activar ${item.label}`}
              onChange={() => setGrade({
                ...grade,
                nodes: grade.nodes.map((node) => node.id === item.id ? { ...node, enabled: !node.enabled } : node),
              })}
            />
          </label>
          <button
            type="button"
            className="fp-layer-delete"
            aria-label={`Eliminar ${item.label}`}
            title="Eliminar capa"
            disabled={layers.length <= 1}
            onClick={() => { removeLayer(item.id); setNotice(`${item.label} eliminada.`); }}
          >
            <Icon name="trash" size={12} />
          </button>
        </div>
      ))}
      <button type="button" className="fp-add-layer" onClick={addLayer}>
        <Icon name="plus" size={12} /><span>Añadir capa de gradación de color</span>
      </button>
    </Section>
  );
}

/* ── Orquestador ──────────────────────────────────────────────────────── */

export function ColorPropertiesPanel({
  clipId, mode, subTab,
}: {
  readonly clipId: string;
  readonly mode: PropertiesMode;
  readonly subTab: string;
}) {
  const api = useClipGrade(clipId);
  const [notice, setNotice] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const ctx = usePanelContext(api, setNotice);
  const { layer, resetLayer, addLayer, error } = api;

  if (advanced) {
    return (
      <div className="fp-root fp-root--advanced">
        <button type="button" className="fp-back" onClick={() => setAdvanced(false)}>
          <Icon name="chevron-down" size={12} /> Volver a propiedades
        </button>
        <ColorStudio clipId={clipId} />
      </div>
    );
  }

  return (
    <div className="fp-root" data-mode={mode} data-subtab={subTab}>
      <div className="fp-scroll">
        {mode === 'mask' && subTab !== 'layers' ? (
          <button type="button" className="fp-add-layer fp-add-layer--top" onClick={addLayer}>
            <Icon name="plus" size={12} /><span>Añadir capa de gradación de color</span>
          </button>
        ) : null}

        {subTab === 'layers' ? <LayersPanel ctx={ctx} /> : null}
        {subTab === 'basic' ? <BasicPanel ctx={ctx} /> : null}
        {subTab === 'hsl' ? <HslPanel ctx={ctx} /> : null}
        {subTab === 'curves' ? <CurvesPanel ctx={ctx} /> : null}
        {subTab === 'wheels' ? <WheelsPanel ctx={ctx} /> : null}
        {subTab === 'hdr' ? <HdrPanel ctx={ctx} /> : null}
        {subTab === 'all' ? <BasicPanel ctx={ctx} /> : null}

        {(error || notice) ? (
          <p className={`fp-notice${error ? ' fp-notice--error' : ''}`} role="status">{error ?? notice}</p>
        ) : null}
      </div>

      <footer className="fp-foot">
        <button
          type="button"
          className="fp-ghost"
          onClick={() => {
            resetLayer();
            setNotice('Ajustes de color restablecidos.');
          }}
          title="Volver todos los valores de esta capa a neutro"
        >
          Restablecer
        </button>
        <button
          type="button"
          className="fp-primary"
          onClick={() => {
            const name = `Personalizado ${loadGradePresets().length + 1}`;
            saveGradePreset(name, { layer });
            setNotice(`«${name}» guardado. Está disponible en Estilo → Personalizado.`);
          }}
          title="Guardar el ajuste actual como look personalizado"
        >
          Guardar como personalizado
        </button>
      </footer>
      <button type="button" className="fp-advanced" onClick={() => setAdvanced(true)}>
        Estudio avanzado de color <Icon name="chevron-down" size={11} />
      </button>
    </div>
  );
}
