import { useEffect, useState } from 'react';
import { useAppearance } from '../../state/AppearanceProvider';
import {
  contrastInk,
  hueOf,
  mixHex,
  paletteFromHue,
  type Density,
  type ThemePresetId,
} from '../../state/appearance';
import { THEME_PALETTES, type ThemePalette } from '../../state/theme-palette';

const PRESET_NAMES: Record<Exclude<ThemePresetId, 'custom'>, string> = {
  olyvia: 'Olyvia',
  resolve: 'Resolve',
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
  const [hue, setHue] = useState(() => hueOf(appearance.palette.accent));
  const [scale, setScale] = useState(appearance.scale);
  const [radius, setRadius] = useState(appearance.radius);
  const [rows, setRows] = useState(appearance.timelineRows);

  // Si la apariencia cambia por fuera (Restablecer, preset, carga inicial),
  // sincronizamos los espejos.
  useEffect(() => {
    setHue(hueOf(appearance.palette.accent));
    setScale(appearance.scale);
    setRadius(appearance.radius);
    setRows(appearance.timelineRows);
  }, [
    appearance.palette.accent,
    appearance.scale,
    appearance.radius,
    appearance.timelineRows,
  ]);

  const accentPreview = paletteFromHue(hue).accent;

  function dragHue(next: number): void {
    setHue(next);
    previewPalette(paletteWithAccent(appearance.palette, paletteFromHue(next).accent));
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
            aria-label={`Tema ${PRESET_NAMES[preset]}`}
            title={PRESET_NAMES[preset]}
            onClick={() => {
              setHue(hueOf(THEME_PALETTES[preset].accent));
              applyThemePreset(preset);
            }}
          >
            <span style={{ background: THEME_PALETTES[preset].accent }} />
          </button>
        ))}
        <span className="appearance-preset-name">
          {appearance.preset === 'custom' ? 'Personalizado' : PRESET_NAMES[appearance.preset]}
        </span>
      </div>

      <div className="hue-row">
        <span className="hue-swatch" style={{ background: accentPreview }} aria-hidden="true" />
        <input
          className="hue-slider"
          type="range"
          min={0}
          max={359}
          step={1}
          value={hue}
          aria-label="Color de acento"
          onChange={(event) => dragHue(Number(event.target.value))}
          onPointerUp={commitPreview}
          onKeyUp={commitPreview}
          onBlur={commitPreview}
        />
        <code className="hue-value">{accentPreview}</code>
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
            min={0.85}
            max={1.2}
            step={0.05}
            value={scale}
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
