import { useAppearance } from '../../state/AppearanceProvider';
import {
  DISPLAY_FONTS,
  MONO_FONTS,
  THEME_PRESETS,
  UI_FONTS,
  type AppearanceSettings,
  type Density,
  type ThemePresetId,
} from '../../state/appearance';

const PRESET_NAMES: Record<Exclude<ThemePresetId, 'custom'>, string> = {
  mint: 'Menta',
  ember: 'Ámbar',
  violet: 'Violeta',
  ocean: 'Océano',
  graphite: 'Grafito',
};

const DENSITIES: readonly { readonly id: Density; readonly label: string }[] = [
  { id: 'compact', label: 'Compacta' },
  { id: 'comfortable', label: 'Cómoda' },
  { id: 'spacious', label: 'Amplia' },
];

const COLOR_FIELDS = [
  { key: 'accent', label: 'Acento' },
  { key: 'info', label: 'Secundario' },
  { key: 'background', label: 'Fondo' },
  { key: 'surface', label: 'Superficie' },
  { key: 'text', label: 'Texto' },
] as const;

export function AppearanceCard() {
  const { appearance, update, applyTheme, reset } = useAppearance();

  function setColor(key: (typeof COLOR_FIELDS)[number]['key'], value: string): void {
    const next: AppearanceSettings = {
      ...appearance,
      preset: 'custom',
      ...(key === 'accent' ? { accent: value } : {}),
      ...(key === 'info' ? { info: value } : {}),
      ...(key === 'background' ? { background: value } : {}),
      ...(key === 'surface' ? { surface: value } : {}),
      ...(key === 'text' ? { text: value } : {}),
    };
    update(next);
  }

  return (
    <article className="card appearance-card">
      <div className="appearance-head">
        <div>
          <p className="eyebrow">Interfaz</p>
          <h3>Apariencia</h3>
          <p className="muted">
            Todo se guarda en este equipo. Podés volver a los valores de fábrica cuando quieras.
          </p>
        </div>
        <div className="appearance-preview" aria-hidden="true">
          <div className="preview-window-top">
            <span />
            <span />
            <span />
            <em>Menú</em>
          </div>
          <div className="preview-window-body">
            <div className="preview-mini-rail">
              <span />
              <span />
              <span />
            </div>
            <div className="preview-mini-main">
              <div className="preview-mini-screen" />
              <div className="preview-mini-timeline">
                <span />
                <span />
                <span />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="appearance-section">
        <span className="appearance-label">Tema</span>
        <div className="theme-presets">
          {(Object.keys(THEME_PRESETS) as Exclude<ThemePresetId, 'custom'>[]).map((preset) => (
            <button
              key={preset}
              type="button"
              className={`theme-preset${appearance.preset === preset ? ' active' : ''}`}
              aria-pressed={appearance.preset === preset}
              onClick={() => applyTheme(THEME_PRESETS[preset], preset)}
            >
              <span className="theme-swatch" style={{ background: THEME_PRESETS[preset].accent }} />
              <span className="theme-name">{PRESET_NAMES[preset]}</span>
              <span className="theme-chips">
                <i style={{ background: THEME_PRESETS[preset].background }} />
                <i style={{ background: THEME_PRESETS[preset].surface }} />
                <i style={{ background: THEME_PRESETS[preset].text }} />
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="appearance-section">
        <span className="appearance-label">Colores exactos</span>
        <div className="color-grid">
          {COLOR_FIELDS.map((field) => (
            <label className="color-field" key={field.key}>
              <input
                type="color"
                value={appearance[field.key]}
                onChange={(event) => setColor(field.key, event.target.value)}
                aria-label={`Color ${field.label}`}
              />
              <span>{field.label}</span>
              <code>{appearance[field.key]}</code>
            </label>
          ))}
        </div>
      </div>

      <div className="appearance-section">
        <span className="appearance-label">Tipografía</span>
        <div className="form-grid appearance-fonts">
          <label className="field">
            <span>Interfaz</span>
            <select
              value={appearance.fontUi}
              onChange={(event) => update({ fontUi: event.target.value })}
            >
              {UI_FONTS.map((font) => (
                <option key={font.id} value={font.id}>
                  {font.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Títulos</span>
            <select
              value={appearance.fontDisplay}
              onChange={(event) => update({ fontDisplay: event.target.value })}
            >
              {DISPLAY_FONTS.map((font) => (
                <option key={font.id} value={font.id}>
                  {font.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Monoespaciada</span>
            <select
              value={appearance.fontMono}
              onChange={(event) => update({ fontMono: event.target.value })}
            >
              {MONO_FONTS.map((font) => (
                <option key={font.id} value={font.id}>
                  {font.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="range-field">
          <span>Tamaño general</span>
          <input
            type="range"
            min={0.85}
            max={1.2}
            step={0.05}
            value={appearance.scale}
            onChange={(event) => update({ scale: Number(event.target.value) })}
          />
          <output>{Math.round(appearance.scale * 100)}%</output>
        </label>
      </div>

      <div className="appearance-section">
        <span className="appearance-label">Disposición</span>
        <div className="density-row" role="group" aria-label="Densidad">
          {DENSITIES.map((density) => (
            <button
              key={density.id}
              type="button"
              className={appearance.density === density.id ? 'active' : ''}
              aria-pressed={appearance.density === density.id}
              onClick={() => update({ density: density.id })}
            >
              {density.label}
            </button>
          ))}
        </div>
        <label className="range-field">
          <span>Ancho del rail con etiquetas</span>
          <input
            type="range"
            min={150}
            max={320}
            step={2}
            value={appearance.sidebarWidth}
            disabled={!appearance.sidebarLabels}
            onChange={(event) => update({ sidebarWidth: Number(event.target.value) })}
          />
          <output>{appearance.sidebarWidth} px</output>
        </label>
        <label className="range-field">
          <span>Radio de las esquinas</span>
          <input
            type="range"
            min={2}
            max={18}
            step={1}
            value={appearance.radius}
            onChange={(event) => update({ radius: Number(event.target.value) })}
          />
          <output>{appearance.radius} px</output>
        </label>
        <label className="range-field">
          <span>Alto de filas de timeline</span>
          <input
            type="range"
            min={34}
            max={76}
            step={2}
            value={appearance.timelineRows}
            onChange={(event) => update({ timelineRows: Number(event.target.value) })}
          />
          <output>{appearance.timelineRows} px</output>
        </label>
        <div className="appearance-checks">
          <label className="check">
            <input
              type="checkbox"
              checked={appearance.sidebarLabels}
              onChange={(event) => update({ sidebarLabels: event.target.checked })}
            />
            Mostrar etiquetas en el rail
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={appearance.showStatusbar}
              onChange={(event) => update({ showStatusbar: event.target.checked })}
            />
            Mostrar barra de estado
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={appearance.reduceMotion}
              onChange={(event) => update({ reduceMotion: event.target.checked })}
            />
            Reducir animaciones
          </label>
        </div>
      </div>

      <div className="actions">
        <button type="button" className="ghost" onClick={reset}>
          Restaurar valores de fábrica
        </button>
      </div>
    </article>
  );
}
