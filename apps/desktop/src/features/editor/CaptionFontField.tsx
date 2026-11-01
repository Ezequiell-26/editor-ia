/**
 * Campo de familia tipográfica para estilos de subtítulos.
 *
 * El datalist se llena con las familias instaladas que expone `fontdb` en Rust.
 * El texto libre sigue permitido: si la familia no está en la lista, libass
 * puede resolverla por alias o caer al fallback; no bloqueamos el valor.
 */
export function CaptionFontField({
  value,
  fonts,
  onChange,
  disabled = false,
}: {
  readonly value: string;
  readonly fonts: readonly string[];
  readonly onChange: (value: string) => void;
  readonly disabled?: boolean;
}) {
  return (
    <label className="field">
      <span>Fuente</span>
      <input
        type="text"
        list="caption-system-fonts"
        value={value}
        disabled={disabled}
        aria-label="Fuente de subtítulos"
        onChange={(event) => {
          const next = event.target.value;
          // El esquema exige min(1); no dejamos un valor vacío en el proyecto.
          if (next.trim()) onChange(next);
        }}
      />
      {fonts.length > 0 ? (
        <datalist id="caption-system-fonts" data-testid="caption-fonts">
          {fonts.map((font) => (
            <option key={font} value={font} />
          ))}
        </datalist>
      ) : null}
    </label>
  );
}
