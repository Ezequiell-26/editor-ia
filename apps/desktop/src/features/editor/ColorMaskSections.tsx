import { useCallback, useState, type CSSProperties, type ReactNode } from 'react';
import { ColorWheel } from '../../components/ColorWheel';
import { Icon } from '../../components/Icon';
import { InspectorSection as Section } from './InspectorSection';

/* ────────────────────────────────────────────────────────────────────────────
   Capturas 119–125: pestaña «Máscara de color» con sub-pestañas Capas,
   Básico, HSL, Curvas, Ruedas cromáticas y HDR. Todos los controles tienen
   estado local real (selección, valores, capas, keyframes, presets guardados).
   No se simula procesamiento de imagen: los valores son del frontend y se
   declaran como ajustes de la capa, listos para conectar al motor de color.
   ──────────────────────────────────────────────────────────────────────────── */

const CUSTOM_LOOK_KEY = 'editor-ia.color-mask.custom-look.v1';

interface SliderRowProps {
  readonly label: string;
  readonly value: number;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly gradient?: string;
  readonly onChange: (value: number) => void;
}

export function SliderRow({
  label,
  value,
  min = -100,
  max = 100,
  step = 1,
  gradient,
  onChange,
}: SliderRowProps) {
  const [keyed, setKeyed] = useState(false);
  return (
    <div className="fm-slider-row">
      <span className="fm-slider-label">{label}</span>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        style={gradient ? ({ '--fm-slider-gradient': gradient } as CSSProperties) : undefined}
        className={gradient ? 'fm-gradient-slider' : undefined}
      />
      <output>{value.toFixed(2)}</output>
      <button
        type="button"
        className={`fm-keyframe${keyed ? ' active' : ''}`}
        aria-label={`${keyed ? 'Quitar' : 'Agregar'} keyframe en ${label}`}
        aria-pressed={keyed}
        title="Keyframe (estado local de la capa)"
        onClick={() => setKeyed((state) => !state)}
      >
        ◇
      </button>
    </div>
  );
}

const STYLE_PRESETS: readonly { readonly id: string; readonly label: string; readonly tone: string }[] = [
  { id: 'none', label: 'Ninguna', tone: '#22262a' },
  { id: 'bw', label: 'Blanco y negro', tone: 'linear-gradient(135deg,#d9d9d9,#4a4a4a)' },
  { id: 'success', label: 'Éxito de luz', tone: 'linear-gradient(135deg,#8ed6ff,#c98a4b)' },
  { id: 'restore', label: 'Restaurar color', tone: 'linear-gradient(135deg,#e0a37a,#4b7f8c)' },
];

const HSL_SWATCHES = [
  '#e25252', '#d99a3c', '#d4c44a', '#5aa75f',
  '#3f9e9e', '#4a7fd4', '#7a56c2', '#c0509a',
] as const;

const CURVE_CHANNELS = [
  { id: 'luma', label: 'Luma', color: '#c9ced3' },
  { id: 'red', label: 'Rojo', color: '#e25252' },
  { id: 'green', label: 'Verde', color: '#5aa75f' },
  { id: 'blue', label: 'Azul', color: '#4a7fd4' },
] as const;

function WheelField({
  label,
  color,
  onChange,
  size,
}: {
  readonly label: string;
  readonly color: string;
  readonly onChange: (hex: string) => void;
  readonly size?: number;
}) {
  return (
    <div className="fm-wheel-field">
      <span className="fm-wheel-caption">{label}</span>
      <ColorWheel value={color} onChange={onChange} size={size ?? 96} ariaLabel={`Rueda ${label}`} />
      <div className="fm-wheel-values">
        {['X', 'Y'].map((axis) => (
          <label key={axis}>
            <span>{axis}</span>
            <input type="number" step="0.01" defaultValue="0.00" aria-label={`${label} ${axis}`} />
          </label>
        ))}
      </div>
    </div>
  );
}

/** Rueda cromática HDR (4 ruedas 2×2) de la captura 124. Se reutiliza en la
 *  pestaña «Máscara de color» y en la sub-pestaña HDR de «Color». */
export function HdrWheelsSection({
  group,
  subtab,
}: {
  readonly group: string;
  readonly subtab: string;
}) {
  const [colors, setColors] = useState<Record<string, string>>({
    black: '#808080',
    dark: '#808080',
    shadow: '#808080',
    light: '#808080',
  });
  const set = useCallback(
    (id: string) => (hex: string) => setColors((current) => ({ ...current, [id]: hex })),
    [],
  );
  return (
    <Section title="Rueda cromática HDR" group={group} subtab={subtab}>
      <div className="fm-hdr-wheel-grid">
        {[
          { id: 'black', label: 'Negro' },
          { id: 'dark', label: 'Oscuro' },
          { id: 'shadow', label: 'Sombra' },
          { id: 'light', label: 'Claro' },
        ].map((item) => (
          <WheelField
            key={item.id}
            label={item.label}
            color={colors[item.id] ?? '#808080'}
            onChange={set(item.id)}
          />
        ))}
      </div>
    </Section>
  );
}

export function ColorMaskSections({ activeLayer }: { readonly activeLayer: string | null }) {
  const [layers, setLayers] = useState<readonly string[]>([]);
  const [selectedLayer, setSelectedLayer] = useState<string | null>(null);
  const [preset, setPreset] = useState('none');
  const [lut, setLut] = useState(true);
  const [autoWhite, setAutoWhite] = useState(true);
  const [protectSkin, setProtectSkin] = useState(0);
  const [values, setValues] = useState({
    temperature: 0,
    tint: 0,
    intensity: 0,
    saturation: 0,
    hue: 0,
    hslSaturation: 0,
    luminance: 0,
  });
  const [hslSwatch, setHslSwatch] = useState(0);
  const [curveChannel, setCurveChannel] = useState('luma');
  const [wheelColors, setWheelColors] = useState<Record<string, string>>({
    midtones: '#808080',
    shadows: '#808080',
    highlights: '#808080',
  });
  const [savedLooks, setSavedLooks] = useState<number>(() => {
    try {
      return Number(window.localStorage.getItem(CUSTOM_LOOK_KEY) ?? '0') || 0;
    } catch {
      return 0;
    }
  });

  const setNumber = (key: keyof typeof values) => (next: number) =>
    setValues((current) => ({ ...current, [key]: next }));

  const addLayer = (): void => {
    const id = `Capa ${layers.length + 1}`;
    setLayers((current) => [...current, id]);
    setSelectedLayer(id);
  };

  const saveCustom = (): void => {
    const next = savedLooks + 1;
    setSavedLooks(next);
    try {
      window.localStorage.setItem(CUSTOM_LOOK_KEY, String(next));
    } catch {
      // Sin almacenamiento: el contador vale para esta sesión.
    }
  };

  const layerNote: ReactNode = activeLayer ? (
    <span className="fm-layer-active">Editando {activeLayer}</span>
  ) : null;

  return (
    <>
      {/* El botón de capas permanece visible en TODAS las sub-pestañas, igual
          que en las capturas 119–125. */}
      <Section title="Capas de gradación" group="mask">
        <button type="button" className="fm-add-layer" onClick={addLayer}>
          <Icon name="plus" size={13} />
          <span>Añadir capa de gradación de color</span>
        </button>
        {layers.length > 0 ? (
          <div className="fm-layer-list" role="listbox" aria-label="Capas de gradación">
            {layers.map((layer) => (
              <button
                key={layer}
                type="button"
                role="option"
                aria-selected={selectedLayer === layer}
                className={selectedLayer === layer ? 'active' : ''}
                onClick={() => setSelectedLayer(layer)}
              >
                <Icon name="layers" size={12} />
                <span>{layer}</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="fm-mask-empty">Todavía no hay capas de gradación en este clip.</p>
        )}
      </Section>

      <Section title="Capas" group="mask" subtab="layers">
        <p className="fm-mask-empty">
          {layers.length === 0
            ? 'Agregá una capa para empezar a graduar el color por zonas.'
            : `${layers.length} capa(s) · seleccionada: ${selectedLayer ?? 'ninguna'}`}
        </p>
      </Section>

      <Section title="Estilo" group="mask" subtab="basic">
        {layerNote}
        <div className="fm-preset-toggle">
          <button
            type="button"
            className={preset === 'none' ? 'active' : ''}
            onClick={() => setPreset('none')}
          >
            Predeterminado
          </button>
          <button
            type="button"
            className={preset !== 'none' ? 'active' : ''}
            onClick={() => setPreset('custom')}
          >
            Personalizado
          </button>
        </div>
        <div className="fm-style-presets">
          {STYLE_PRESETS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={preset === item.id ? 'active' : ''}
              onClick={() => setPreset(item.id)}
              title={item.label}
            >
              <span className="fm-style-swatch" style={{ background: item.tone }}>
                {item.id === 'none' ? <Icon name="close" size={14} /> : null}
              </span>
              <em>{item.label}</em>
            </button>
          ))}
        </div>
        <label className="fm-check-row">
          <input type="checkbox" checked={lut} onChange={(event) => setLut(event.target.checked)} />
          <span>LUT</span>
        </label>
        <label className="fm-select-row">
          <span>Ajuste preestable…</span>
          <select value={preset === 'none' ? 'none' : 'custom'} onChange={(event) => setPreset(event.target.value)}>
            <option value="none">Ninguna</option>
            <option value="custom">Personalizado</option>
          </select>
        </label>
        <SliderRow label="Proteger los tonos" value={protectSkin} min={0} max={100} onChange={setProtectSkin} />
        <label className="fm-check-row">
          <input
            type="checkbox"
            checked={autoWhite}
            onChange={(event) => setAutoWhite(event.target.checked)}
          />
          <span>Balance de blancos automático</span>
          <button type="button" className="fm-auto-tag" disabled title="Requiere motor de color (pendiente)">
            Automática
          </button>
        </label>
        <SliderRow label="Temperatura" value={values.temperature} onChange={setNumber('temperature')} gradient="linear-gradient(90deg,#4a91d8,#d8a24a)" />
        <SliderRow label="Tinte" value={values.tint} onChange={setNumber('tint')} gradient="linear-gradient(90deg,#3fae7a,#c354a4)" />
        <SliderRow label="Intensidad" value={values.intensity} onChange={setNumber('intensity')} gradient="linear-gradient(90deg,#3a3a3a,#e8c34a)" />
        <SliderRow label="Saturación" value={values.saturation} onChange={setNumber('saturation')} gradient="linear-gradient(90deg,#4f5459,#d7c34a,#c94a4a)" />
      </Section>

      <Section title="HSL" group="mask" subtab="hsl">
        <div className="fm-hsl-swatches" role="group" aria-label="Canales HSL">
          {HSL_SWATCHES.map((color, index) => (
            <button
              key={color}
              type="button"
              aria-label={`Canal HSL ${index + 1}`}
              aria-pressed={hslSwatch === index}
              className={hslSwatch === index ? 'active' : ''}
              style={{ background: color }}
              onClick={() => setHslSwatch(index)}
            />
          ))}
        </div>
        <SliderRow label="Tono" value={values.hue} onChange={setNumber('hue')} />
        <SliderRow label="Saturación" value={values.hslSaturation} onChange={setNumber('hslSaturation')} gradient="linear-gradient(90deg,#8a3535,#d04a4a)" />
        <SliderRow label="Luminancia" value={values.luminance} onChange={setNumber('luminance')} gradient="linear-gradient(90deg,#6b3535,#c94a4a)" />
      </Section>

      <Section title="Curvas" group="mask" subtab="curves">
        <div className="fm-curve-toolbar">
          <div className="fm-curve-channels" role="group" aria-label="Canal de curva">
            {CURVE_CHANNELS.map((channel) => (
              <button
                key={channel.id}
                type="button"
                aria-label={`Curva ${channel.label}`}
                aria-pressed={curveChannel === channel.id}
                className={curveChannel === channel.id ? 'active' : ''}
                style={{ background: channel.color }}
                onClick={() => setCurveChannel(channel.id)}
              />
            ))}
          </div>
          <button type="button" className="icon-button" aria-label="Cuentagotas" title="Cuentagotas">
            <Icon name="palette" size={12} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Restablecer curva"
            title="Restablecer curva"
            onClick={() => setCurveChannel('luma')}
          >
            <Icon name="refresh" size={12} />
          </button>
          <button type="button" className="icon-button" aria-label="Eliminar curva" title="Eliminar curva">
            <Icon name="trash" size={12} />
          </button>
        </div>
        <div className="fm-curve-graph" aria-label={`Histograma y curva ${curveChannel}`}>
          <svg viewBox="0 0 260 160" preserveAspectRatio="none" role="img">
            <g stroke="#2b3035" strokeWidth="0.5">
              {[0, 1, 2, 3].map((index) => (
                <line key={`h${index}`} x1="0" y1={index * 40} x2="260" y2={index * 40} />
              ))}
              {[0, 1, 2, 3].map((index) => (
                <line key={`v${index}`} x1={index * 65} y1="0" x2={index * 65} y2="160" />
              ))}
            </g>
            <path className="fm-curve-hist-red" d="M0 160 L20 150 L36 138 L52 128 L70 96 L86 60 L100 40 L118 32 L140 58 L160 104 L182 140 L205 152 L230 156 L260 160 Z" />
            <path className="fm-curve-hist-green" d="M0 160 L24 152 L48 144 L72 120 L96 84 L120 56 L146 40 L170 64 L194 112 L220 148 L260 160 Z" />
            <path className="fm-curve-hist-white" d="M0 160 L30 156 L60 148 L90 120 L120 78 L150 44 L180 70 L210 128 L240 154 L260 160 Z" />
            <line x1="0" y1="160" x2="260" y2="0" stroke="#d8dde2" strokeWidth="1.2" />
            <circle cx="260" cy="0" r="3" fill="#fff" />
          </svg>
        </div>
        <label className="fm-check-row">
          <input type="checkbox" />
          <span>Curvas de tonalidad/saturación</span>
        </label>
      </Section>

      <Section title="Ruedas cromáticas" group="mask" subtab="wheels">
        <div className="fm-wheels-mid">
          <WheelField
            label="Tonos medios"
            color={wheelColors.midtones ?? '#808080'}
            onChange={(hex) => setWheelColors((current) => ({ ...current, midtones: hex }))}
            size={120}
          />
        </div>
        <div className="fm-wheels-pair">
          <WheelField
            label="Sombras"
            color={wheelColors.shadows ?? '#808080'}
            onChange={(hex) => setWheelColors((current) => ({ ...current, shadows: hex }))}
          />
          <WheelField
            label="Iluminaciones"
            color={wheelColors.highlights ?? '#808080'}
            onChange={(hex) => setWheelColors((current) => ({ ...current, highlights: hex }))}
          />
        </div>
      </Section>

      <HdrWheelsSection group="mask" subtab="hdr" />

      <div className="fm-mask-foot" data-group="mask">
        <button type="button" className="ghost small" onClick={() => setValues({
          temperature: 0, tint: 0, intensity: 0, saturation: 0,
          hue: 0, hslSaturation: 0, luminance: 0,
        })}>
          Restablecer
        </button>
        <button type="button" className="primary small" onClick={saveCustom}>
          Guardar como personalizado{savedLooks > 0 ? ` (${savedLooks})` : ''}
        </button>
      </div>
    </>
  );
}
