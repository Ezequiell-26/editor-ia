import { useEffect, useState } from 'react';
import { ColorWheel } from '../../components/ColorWheel';
import { useAppearance } from '../../state/AppearanceProvider';
import {
  contrastInk,
  mixHex,
  type Density,
  type ThemePresetId,
} from '../../state/appearance';
import { THEME_PALETTES, THEME_PRESET_LABELS, type ThemePalette } from '../../state/theme-palette';

/**
 * Color de la muestra de cada preset. El resto usa su acento; el preset claro
 * usa el fondo claro para que se lea como tema claro a simple vista.
 */
function presetSwatch(preset: Exclude<ThemePresetId, 'custom'>): string {
  const palette = THEME_PALETTES[preset];
  return preset === 'light' ? palette.bg : palette.accent;
}

const DENSITIES: readonly { readonly id: Density; readonly label: string }[] = [
  { id: 'compact', label: 'Compacta' },
  { id: 'comfortable', label: 'Cómoda' },
  { id: 'spacious', label: 'Amplia' },
];

/**
 * Deriva la paleta al mover el matiz: el acento y sus derivados cambian juntos
 * para que el botón primario, la tinta y los alias de marca sigan siendo
 * coherentes. El resto de los 34 tokens se conserva.
 */
function paletteWithAccent(palette: ThemePalette, accent: string): ThemePalette {
  const accentLight = mixHex(accent, '#ffffff', 0.35);
  return {
    ...palette,
    accent,
    accentLight,
    accentStrong: mixHex(accent, palette.bg, 0.24),
    accentInk: contrastInk(accent),
    // Mismos derivados que paletteFromBase: la marca acompaña al acento.
    brandCyan: accentLight,
    brandBlue: accent,
  };
}

export function AppearanceCard() {
  const {
    appearance,
    update,
    preview,
    commitPreview,
    applyThemePreset,
    previewPalette,
    reset,
  } = useAppearance();

  // Espejos locales: los sliders son controlados por el estado local para que
  // el pulgar avance en tiempo real mientras se arrastra; `appearance` (React)
  // solo se actualiza al soltar. Sin esto, el input controlado pelea contra el
  // arrastre y el cambio "aparece después".
  // Acento en vivo: la rueda mueve este espejo y el proveedor pinta las
  // variables al instante; `appearance` sólo cambia al confirmar.
  const [accent, setAccent] = useState(() => appearance.palette.accent);
  const [scale, setScale] = useState(appearance.scale);
  const [radius, setRadius] = useState(appearance.radius);
  const [rows, setRows] = useState(appearance.timelineRows);

  // Si la apariencia cambia por fuera (Restablecer, preset, carga inicial),
  // sincronizamos los espejos.
  useEffect(() => {
    setAccent(appearance.palette.accent);
    setScale(appearance.scale);
    setRadius(appearance.radius);
    setRows(appearance.timelineRows);
  }, [
    appearance.palette.accent,
    appearance.scale,
    appearance.radius,
    appearance.timelineRows,
  ]);

  function dragAccent(next: string): void {
    setAccent(next);
    previewPalette(paletteWithAccent(appearance.palette, next));
  }

  return (
    <article className="card appearance-card is-compact">
      <header className="appearance-top">
        <div>
          <h3>Apariencia</h3>
          <p className="muted">Se guarda en este equipo y se aplica al instante.</p>
        </div>
        <button type="button" className="ghost appearance-reset" onClick={reset}>
          Restablecer
        </button>
      </header>

      <div className="appearance-presets" role="group" aria-label="Temas">
        {(Object.keys(THEME_PALETTES) as Exclude<ThemePresetId, 'custom'>[]).map((preset) => (
          <button
            key={preset}
            type="button"
            className={`theme-dot${appearance.preset === preset ? ' active' : ''}`}
            aria-pressed={appearance.preset === preset}
            aria-label={`Tema ${THEME_PRESET_LABELS[preset]}`}
            title={THEME_PRESET_LABELS[preset]}
            onClick={() => {
              setAccent(THEME_PALETTES[preset].accent);
              applyThemePreset(preset);
            }}
          >
            <span style={{ background: presetSwatch(preset) }} />
          </button>
        ))}
        <span className="appearance-preset-name">
          {appearance.preset === 'custom' ? 'Personalizado' : THEME_PRESET_LABELS[appearance.preset]}
        </span>
      </div>

      <div className="appearance-wheel-row">
        <ColorWheel
          value={accent}
          onChange={dragAccent}
          onCommit={commitPreview}
          ariaLabel="Color de acento"
          size={124}
        />
        <div className="appearance-wheel-meta">
          <span className="hue-swatch" style={{ background: accent }} aria-hidden="true" />
          <code className="hue-value">{accent}</code>
          <span className="appearance-wheel-hint">
            Tono y saturación en la rueda; la barra ajusta la luminosidad.
          </span>
        </div>
      </div>

      <div className="appearance-grid">
        <div className="appearance-field">
          <span className="appearance-label">Densidad</span>
          <div className="segmented" role="group" aria-label="Densidad">
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
        </div>

        <label className="appearance-field">
          <span className="appearance-label">
            Escala <span className="appearance-value">{Math.round(scale * 100)}%</span>
          </span>
          <input
            type="range"
            min={0.9}
            max={1.2}
            step={0.1}
            value={scale}
            title="100 % es la escala más nítida: los pasos intermedios obligan a dibujar las letras a tamaños fraccionarios y se ven más suaves"
            onChange={(event) => {
              const next = Number(event.target.value);
              setScale(next);
              preview({ scale: next });
            }}
            onPointerUp={commitPreview}
            onKeyUp={commitPreview}
            onBlur={commitPreview}
          />
        </label>

        <label className="appearance-field">
          <span className="appearance-label">
            Esquinas <span className="appearance-value">{radius} px</span>
          </span>
          <input
            type="range"
            min={2}
            max={18}
            step={1}
            value={radius}
            onChange={(event) => {
              const next = Number(event.target.value);
              setRadius(next);
              preview({ radius: next });
            }}
            onPointerUp={commitPreview}
            onKeyUp={commitPreview}
            onBlur={commitPreview}
          />
        </label>

        <label className="appearance-field">
          <span className="appearance-label">
            Filas <span className="appearance-value">{rows} px</span>
          </span>
          <input
            type="range"
            min={34}
            max={76}
            step={2}
            value={rows}
            onChange={(event) => {
              const next = Number(event.target.value);
              setRows(next);
              preview({ timelineRows: next });
            }}
            onPointerUp={commitPreview}
            onKeyUp={commitPreview}
            onBlur={commitPreview}
          />
        </label>
      </div>

      <div className="appearance-checks">
        <label className="check">
          <input
            type="checkbox"
            checked={appearance.sidebarLabels}
            onChange={(event) => update({ sidebarLabels: event.target.checked })}
          />
          Etiquetas en el rail
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={appearance.showStatusbar}
            onChange={(event) => update({ showStatusbar: event.target.checked })}
          />
          Barra de estado
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
    </article>
  );
}
