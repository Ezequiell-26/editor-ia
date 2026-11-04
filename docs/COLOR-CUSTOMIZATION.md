# Color completamente configurable — contrato de implementación

Actualizado: 2026-11-03. Documento de trabajo de la iteración «color customizable».
El objetivo es que **toda la interfaz** responda a una paleta editable por el
usuario, no sólo el acento actual. Este archivo es la fuente de verdad para los
agentes que tocan el motor, la UI y el CSS: no cambiarlo sin avisar al Lead.

## 1. Diagnóstico (estado real hoy)

- `state/appearance.ts` guarda sólo 5 colores (`accent`, `info`, `background`,
  `surface`, `text`) y emite ~20 variables CSS inline en `document.documentElement`.
- La capa visual que domina el shell es `styles/commercial.css`, que pinta con
  `--commercial-*` fijos (144 usos) y literales `rgba(31, 94, 255, …)`.
  `styles/olyvia.css` hace lo mismo con `--olyvia-*` fijos (38 usos) y literales
  cian/violeta. Por eso cambiar el acento hoy **no** repinta botones ni paneles.
- Hay variables usadas con fallback pero nunca definidas: `--color-ok`,
  `--color-ok-strong`, `--color-warn`, `--color-warn-strong`,
  `--color-text-faint`, `--color-panel-raised`, `--color-surface-raised`.
- Los clips del timeline (`.timeline-clip.kind-*`), las waveforms y los marcadores
  usan colores literales en `styles/app.css`; los colores de medios existen en
  `tokens.css` (`--color-video`…) pero casi no se usan.
- Los presets actuales (`THEME_PRESETS`) sólo aportan 5 colores; `olyvia` tiene
  además una rama `commercial` con derivados hardcodeados.

## 2. Contrato del motor (`state/theme-palette.ts`, nuevo)

### 2.1 Paleta editable (34 tokens)

Todos son hex `#rrggbb` (se normaliza a minúsculas). Grupos y orden de UI:

**superficies** (14): `bg`, `surface`, `panel`, `panel2`, `panel3`, `panelRaised`,
`surfaceRaised`, `border`, `borderStrong`, `text`, `textMuted`, `textSecondary`,
`textFaint`, `empty`.

**acento** (5): `accent`, `accentLight`, `accentStrong`, `accentInk`, `info`.

**estados** (5): `success`, `warning`, `danger`, `dangerStrong`, `cta`.

**medios** (6): `video`, `image`, `audio`, `narration`, `caption`, `graphic`.

**marca** (4): `brandCyan`, `brandBlue`, `brandViolet`, `brandMagenta`.

```ts
export type ThemeGroupId = 'superficies' | 'acento' | 'estados' | 'medios' | 'marca';
export interface ThemeTokenDefinition {
  readonly id: ThemeTokenId;      // 'bg' | 'surface' | ...
  readonly cssVar: string;        // '--color-bg'
  readonly label: string;         // 'Fondo'
  readonly group: ThemeGroupId;
  readonly hint: string;          // frase corta para el title/aria
}
export const COLOR_TOKENS: readonly ThemeTokenDefinition[];
export const COLOR_GROUPS: readonly { id: ThemeGroupId; label: string; icon?: string }[];
export type ThemePalette = Readonly<Record<ThemeTokenId, string>>;
```

### 2.2 Presets completos

```ts
export const THEME_PALETTES: Readonly<Record<Exclude<ThemePresetId,'custom'>, ThemePalette>>;
```

- `olyvia` (default) es **explícito** y debe reproducir exactamente el look actual:
  `bg #0f1115, surface #181b20, panel #181b20, panel2 #1c2027, panel3 #222731,
  panelRaised #1b2029, surfaceRaised #161a20, border #2d3240, borderStrong #3a4152,
  text #f2f5ff, textMuted #9ca3af, textSecondary #7a8ba8, textFaint #6b7480,
  empty #6b7280, accent #1f5eff, accentLight #6ee1ff, accentStrong #1748c9,
  accentInk #f8fffc, info #22c55e, success #22c55e, warning #f59e0b, danger #ef4444,
  dangerStrong #dc2626, cta #ff6b2b, video #4d8df0, image #8b74e8, audio #2eb8a6,
  narration #56b97f, caption #d9b34a, graphic #d76fa9, brandCyan #35d6ff,
  brandBlue #4f8dff, brandViolet #8b5cf6, brandMagenta #d35cff`.
- `resolve`, `mint`, `ember`, `violet`, `ocean`, `graphite` se construyen con
  `paletteFromBase(THEME_PRESETS[preset])` (mismas 5 bases que hoy).
- `light` (**«Claro neutro»**) es el único preset nativo de tema claro y también
  es **explícito** (no derivado: `paletteFromBase` reutilizaría los estados
  oscuros del contrato, ilegibles sobre fondo claro). Valores:
  `bg #eef0f3, surface #f7f8fa, panel #f2f3f6, panel2 #e9ebef, panel3 #e1e4ea,
  panelRaised #ffffff, surfaceRaised #fbfbfd, border #d5d9e0, borderStrong #7f8896,
  text #15181e, textMuted #4b5563, textSecondary #5d6673, textFaint #5f6874,
  empty #68717d, accent #1f5eff, accentLight #4a83ff, accentStrong #1748c9,
  accentInk #f8fffc, info #15803d, success #15803d, warning #b45309, danger #dc2626,
  dangerStrong #b91c1c, cta #c2410c, video #2563eb, image #7c3aed, audio #0d9488,
  narration #15803d, caption #b45309, graphic #be185d, brandCyan #0891b2,
  brandBlue #1f5eff, brandViolet #7c3aed, brandMagenta #c026d3`.
  `bg` tiene luminancia relativa 0.87 → `colorSchemeFor` emite `light`.
  Contraste medido con `contrastRatio`: texto 15.6:1 sobre bg, 16.7:1 sobre
  surface, 16.0:1 sobre panel; `textMuted` 7.1:1, `textSecondary` 5.5:1,
  `textFaint` 5.3:1 y `empty` 4.65:1 sobre surface; tinta del acento sobre acento
  5.0:1; estados y medios ≥4.5:1 sobre surface; `borderStrong` 3.4:1 (no textual).
  Todos los pares de `themeContrastReport` pasan y `fixTextContrast` no cambia
  ningún token (preset estable).
- `THEME_PRESETS` se conserva exportado (compatibilidad de la UI actual).

### 2.3 Derivación (`paletteFromBase(base: ThemeColors): ThemePalette`)

Con `mixHex(a,b,w)` existente (w = cantidad de `b`):

| token | derivación |
|---|---|
| panel | mix(surface, text, 0.035) |
| panel2 | mix(surface, text, 0.075) |
| panel3 | mix(surface, text, 0.115) |
| panelRaised | mix(panel2, text, 0.04) |
| surfaceRaised | mix(surface, text, 0.02) |
| border | mix(surface, text, 0.14) |
| borderStrong | mix(surface, text, 0.28) |
| textMuted | mix(text, bg, 0.42) |
| textSecondary | mix(text, bg, 0.24) |
| textFaint | mix(text, bg, 0.55) |
| empty | mix(text, bg, 0.6) |
| accentLight | mix(accent, '#ffffff', 0.35) |
| accentStrong | mix(accent, bg, 0.24) |
| accentInk | contrastInk(accent) |
| success/warning/danger/dangerStrong/cta | defaults fijos (`#22c55e / #f59e0b / #ef4444 / #dc2626 / #ff6b2b`) |
| video/image/audio/narration/caption/graphic | defaults fijos de `tokens.css` |
| brandCyan | accentLight |
| brandBlue | accent |
| brandViolet | info |
| brandMagenta | mix(info, accent, 0.5) |

### 2.4 Variables CSS emitidas (`paletteCssVariables(palette): Record<string,string>`)

Además de las 34 `--color-*` de la tabla de tokens, el motor DEBE emitir:

- Aliases comerciales: `--commercial-canvas`=bg, `--commercial-surface`=surface,
  `--commercial-border`=border, `--commercial-border-strong`=borderStrong,
  `--commercial-accent`=accent, `--commercial-success`=success,
  `--commercial-cta`=cta, `--commercial-text`=text, `--commercial-muted`=textMuted,
  `--commercial-input`=mix(bg, surface, 0.6).
- Aliases de marca: `--olyvia-cyan`=brandCyan, `--olyvia-blue`=brandBlue,
  `--olyvia-violet`=brandViolet, `--olyvia-magenta`=brandMagenta,
  `--olyvia-ink`=bg, `--olyvia-panel`=surface.
  `--olyvia-border` = `color-mix(in srgb, var(--color-border-strong) 70%, transparent)`.
- Estados alias usados con fallback: `--color-ok`=success, `--color-ok-strong`=
  mix(success, bg, 0.22), `--color-warn`=warning, `--color-warn-strong`=
  mix(warning, bg, 0.22).
- Gradientes de marca:
  `--brand-gradient`: `linear-gradient(135deg, brandCyan 0%, brandBlue 42%, brandViolet 76%, brandMagenta 100%)`.
  `--brand-gradient-hover`: una variante con `mixHex(color,'#ffffff',0.18)` por parada.
  `--brand-gradient-subtle`: las mismas paradas con `color-mix(in srgb, <color> 15%, transparent)`.
  `--brand-glow`: dos sombras `color-mix` de brandCyan/brandViolet.
  `--brand-border`: `color-mix(in srgb, brandBlue 25%, transparent)`.
  `--brand-ink`: `contrastInk(brandViolet)`.
- `--glow-accent`, `--glow-accent-strong` (con color-mix de accent y bg),
  `--glow-success`, `--glow-danger` (con success/danger).
- `--primary-hue`: matiz del accent (para lo que ya lo usa). Los marcadores del
  timeline son categorías semánticas: `.marker-*` en `app.css` declara
  `--marker-color` con tokens de estados/medios, y `MarkersPanel` usa esas mismas
  clases para que panel y timeline coincidan siempre.
- `color-scheme` en el root según luminancia de `bg` (`light` si luminance > 0.55).

Las variables no relacionadas con color (fuentes, radios, zoom, sidebar) siguen
emitiéndose como hoy desde `appearanceCssVariables`.

### 2.5 Modelo persistido (`state/appearance.ts`)

- `AppearanceSettings` gana `palette: ThemePalette` (mantiene `accent/info/background/
  surface/text` como espejos de `palette.accent/info/bg/surface/text`).
- `normalizeAppearance(raw)`:
  1. valida preset, colores base y resto de campos como hoy;
  2. `palette = normalizePalette(raw.palette, fallback)` con fallback =
     `THEME_PALETTES[preset]` si el preset no es `custom`, si no `paletteFromBase(base)`;
  3. **compatibilidad v4**: si un campo base (`accent/info/background/surface/text`)
     viene presente y difiere del valor de la paleta, ese campo manda y actualiza el
     token correspondiente (así siguen funcionando datos viejos y los tests que
     guardan sólo `accent`);
  4. espejos base := paleta final.
- `appearanceCssVariables(appearance)` = `paletteCssVariables(palette)` + las
  variables no-color de siempre + `--primary-hue`.
- Se elimina la rama `commercial` hardcodeada.
- `applyAppearance` aplica además `root.style.colorScheme`.

### 2.6 Contraste y validación

```ts
export function relativeLuminance(hex: string): number;      // 0..1
export function contrastRatio(a: string, b: string): number; // 1..21
export interface ContrastCheck { id, label, foreground, background, ratio, minimum, pass }
export function themeContrastReport(palette: ThemePalette): ContrastCheck[];
export function ensureContrast(foreground: string, background: string, minimum: number): string;
export function fixTextContrast(palette: ThemePalette): ThemePalette; // sube text/textMuted/textFaint/empty hasta 4.5:1
```

Pares mínimos del reporte: texto/fondo 4.5; texto/superficie 4.5; texto/panel 4.5;
texto tenue/superficie 4.5; vacío/superficie 3; acento/fondo 3; tinta de acento/acento
4.5; éxito/superficie 3; aviso/superficie 3; peligro/superficie 3.

El preset nativo `light` («Claro neutro») pasa los 10 pares del reporte y además
`fixTextContrast` es idempotente sobre él (no modifica ningún token). Los presets
oscuros conservan la deuda de contraste previa documentada en §7.

### 2.7 Archivo de tema (exportar / importar)

```ts
export const THEME_FILE_KIND = 'olyvia-theme';
export function serializeThemeFile(palette: ThemePalette, name?: string): string;
export function parseThemeFile(raw: string | unknown):
  | { ok: true; name: string; palette: ThemePalette }
  | { ok: false; error: string };
```

Formato: `{ kind: 'olyvia-theme', version: 1, name, exportedAt, palette: { …34 tokens… } }`.
Un archivo corrupto, un token inválido o un token faltante se rechaza entero con
mensaje en español; no se aplica a medias.

## 3. Provider (`state/AppearanceProvider.tsx`)

Se agregan (sin romper `update`, `preview`, `commitPreview`, `reset`):

```ts
setPalette(palette: ThemePalette, preset?: ThemePresetId): void; // commit + guarda
previewPalette(palette: ThemePalette): void;                     // drag en vivo, sin re-render
applyThemePreset(preset: Exclude<ThemePresetId,'custom'>): void;
applyTheme(colors: ThemeColors, preset): void;                   // se mantiene (compat)
```

`setPalette`/`previewPalette` actualizan también los espejos base y ponen
`preset: preset ?? 'custom'`.

## 4. UI (`ColorStudioCard`)

- Nueva tarjeta en Ajustes → Apariencia, debajo de la tarjeta actual
  (`SettingsHome` sección `apariencia`).
- Encabezado «Color» + fila de presets (mismos dots, ahora aplican paleta completa)
  + acciones: **Exportar tema**, **Importar tema**, **Restablecer colores**.
- Tokens agrupados en 5 bloques colapsables (`<details>`), filas compactas:
  etiqueta, `<input type="color">` con swatch, `<input type="text">` hex,
  botón ↺ «Volver al preset» cuando el token difiere del preset.
- Cambio en vivo con `previewPalette` + `commitPreview` al soltar/blur; persistencia
  con el debounce existente.
- Preview vivo (`<div class="theme-preview">`): topbar, rail, panel, un clip de
  video, un clip de audio con waveform, botón primario, badge de éxito y aviso.
  Todo con var(--color-*), sin literales.
- Bloque de contraste: cada par del reporte con ratio, mínimo y estado; un botón
  «Corregir texto» que aplica `fixTextContrast`. Los pares que fallan usan
  `notice-warning`; los que pasan, estilo ok.
- Import/export con el patrón de `BackupCard` (Blob + `<a download>`, `<input type=file>`);
  mensajes `role="status"` de éxito/error.
- Accesibilidad: label por fila, `aria-label` en inputs, foco visible,
  botón de reset con `title` explicativo. Sin trampas de foco nuevas.

### 4.1 Contrato de selectores (UI ⇄ E2E)

La UI expone esta estructura estable (la usan los tests de `testing-library` y
Playwright):

- `.color-studio` — tarjeta completa.
- `.color-group[data-group="superficies|acento|estados|medios|marca"]`.
- `.color-row[data-token="accent"]` — fila de token; dentro:
  `input[type="color"]` (clase `color-input`), `input[type="text"]` (clase
  `color-hex`), `button.color-reset` (volver al preset).
- `.theme-preview` — preview vivo.
- `.contrast-row[data-check="text-bg"]` — fila del reporte de contraste;
  `.contrast-ratio`, `.contrast-state` (`is-pass` / `is-fail`).
- `.color-studio-export`, `.color-studio-import` (botones; el input file oculto es
  `input[type="file"].color-studio-file`), `.color-studio-reset`.
- `.color-studio-status[role="status"]` — mensajes de exportar/importar.

## 5. CSS: reglas de tokenización (obligatorias)

1. **Rol de tema → variable**. Nada de literales para superficies, texto, bordes,
   acentos, estados ni colores de medios. Mapeo:
   `#0f1115/#070b16/#05070f/bg oscuros → var(--color-bg)`;
   superficies/paneles → `var(--color-surface|panel|panel-2|panel-3)`;
   blancos usados como texto → `var(--color-text)` (o `text-muted` si era gris);
   bordes → `var(--color-border|border-strong)`; acento y sus alfas →
   `var(--color-accent)` / `color-mix(in srgb, var(--color-accent) N%, transparent)`;
   cian/azul/violeta/magenta de marca → `var(--olyvia-cyan|blue|violet|magenta)` o
   `var(--brand-*)`.
2. **Alfa de un color de tema**: `color-mix(in srgb, var(--color-X) N%, transparent)`.
   No crear rgba con los hex viejos.
3. **Overlays blancos/negros de bajo alfa** (glass, sombras, veladuras):
   `rgba(255,255,255,.04)` → `color-mix(in srgb, var(--color-text) 4%, transparent)`;
   `rgba(0,0,0,.45)` (sombras/backdrops) se pueden dejar como literal.
4. **Glows y gradientes de marca** usan `var(--brand-gradient*)`, `var(--glow-*)`,
   `var(--brand-glow)`; las definiciones `:root` de esos nombres se dejan como
   fallback estático (el JS las pisa inline).
5. **No tocar**: arte del emblema/logo, mascota/pet, ilustraciones de `start-screen.css`
   que no sean superficies/texto (se documenta como límite), animaciones, layout.
6. **No agregar `!important` nuevos** salvo que la regla ya lo tuviera.
7. **Look por defecto intacto**: con la paleta `olyvia` los colores computados deben
   quedar iguales a los de hoy. Verificar con screenshots y, cuando aplique,
   `getComputedStyle` (ver §6).
8. Los literales `--color-*` de `:root` en `tokens.css` se actualizan sólo como
   fallback de primera pintura; la fuente de verdad es la paleta.

## 6. Verificación

- Unitarios (motor y UI) con `npx vitest run <archivos>` desde la raíz.
- `npm run typecheck` verde.
- E2E Playwright (`apps/desktop/e2e/theme.spec.ts`, nuevo): cambiar acento y
  superficie desde el estudio, comprobar variables computadas y persistencia tras
  recargar; exportar/importar archivo de tema; screenshot final del editor y de
  Ajustes en `.tmp-theme-shots/after/`.
- `npm run build` (vite) verde.
- Suite completa `npm test` la corre el verificador al final, cuando los demás
  hayan terminado (no correr suites completas en paralelo).
- Servidor de desarrollo ya corriendo en `http://localhost:3000` (job del Lead).
  No lanzar otro. Screenshots base en `.tmp-theme-shots/` (`02-shell.png`,
  `03-settings.png`, `04-appearance.png`) y script `.tmp-shots.mjs`.

## 7. Límites conocidos (medidos, no fingir cobertura)

- **Arte decorativo**: emblema orbital, mascota/panda y algunas ilustraciones del
  launcher conservan su paleta propia (`panda.css` aporta 18 literales de arte).
- **Sombras/backdrops** negros translúcidos y el arcoíris del selector de matiz
  no son tokens de color; quedan 2 literales documentados en `settings.css` por
  ese motivo.
- **Datos del proyecto**: `clip.colorTag` (etiqueta de color por clip) es dato
  del usuario, no tema. Los marcadores sí son semánticos y se pintan con tokens.
- **Tema claro**: el preset nativo «Claro neutro» está medido AA (0 pares por
  debajo en `themeContrastReport` y `fixTextContrast` estable), y `color-scheme`
  pasa a `light` solo por la luminancia de `bg`. Un tema claro *personalizado*
  puede seguir teniendo pares por debajo de AA: el estudio de color los reporta
  y «Corregir texto» los sube, pero el motor no impone correcciones automáticas
  sobre la paleta guardada del usuario.
- **Contraste del tema por defecto**: 50 pares por debajo de AA (mín. 3.37:1,
  acento `#1f5eff` sobre superficie `#181b20`) es deuda de diseño previa a esta
  iteración; el estudio de color permite corregirla.
- La medición de cobertura es conductual: un token con 1 elemento visible
  (impacto mínimo) sigue siendo real, pero su alcance es acotado.

## 8. Estado de implementación y evidencia (2026-11-03)

Implementado y verificado en el árbol `3a886f0` + cambios sin commitear:

| Pieza | Archivos | Evidencia |
|---|---|---|
| Motor de paleta | `state/theme-palette.ts` (nuevo), `state/appearance.ts`, `state/AppearanceProvider.tsx`, `styles/tokens.css` | 38 tests de motor + 14 de apariencia, 66 variables emitidas (0 faltantes), compat v4 con datos viejos |
| Estudio de color | `features/settings/ColorStudioCard.tsx` (nuevo), `AppearanceCard.tsx`, `SettingsHome.tsx`, `styles/settings.css` | 10 + 3 tests de UI; Chrome real: cambio en vivo, persistencia, import/export, contraste fail→pass |
| Tokenización CSS | `tokens.css`, `commercial.css`, `olyvia.css`, `flat.css`, `chrome.css`, `resolve-theme.css`, `app.css`, `home.css`, `start-screen.css`, `settings.css` | Literales de rol que ganan cascada: **24 → 0**; hex por archivo: commercial 29→1, olyvia 87→6, start-screen 261→0, resolve-theme 162→7, app.css 497→243 (los restantes son sombras, fallbacks y secciones legacy pisadas) |
| Marcadores | `features/editor/MarkersPanel.tsx` + `.marker-*` en `app.css` | Panel y timeline usan la misma `--marker-color`, 6 categorías distinguibles |
| E2E | `e2e/theme.spec.ts` (nuevo), `playwright.config.ts` | 7/7 en 22,6 s; `settings.spec` 4/4; config alineada al puerto 3000 |
| Preset claro nativo | `state/theme-palette.ts` (`light` + `LIGHT_PALETTE`), `state/appearance.ts`, `features/settings/AppearanceCard.tsx`, `premium/shell.css` (deuda chips/sub-tabs) | 42 tests de motor (34 tokens, AA, round-trip `olyvia-theme`), 4 de `AppearanceCard` (aplica, persiste, vuelve a oscuro), e2e «Claro neutro» 1/1 (color-scheme, superficies, AA, persistencia tras recargar) |
| Docs | `README.md`, este documento | Bullet de apariencia y arquitectura actualizados |

Medición final (`.tmp-theme-shots/after/report.json` y `METHOD.md`,
verificador independiente):

- **Cobertura de tema: 66,7 %** de las propiedades pintadas (806/1209, 608
  elementos), medida conductualmente (cambiar los 34 tokens y ver qué se
  repinta). Antes de tokenizar `resolve-theme.css` era 54,8 % con el método
  anterior; el salto real es que los literales de rol ganadores pasaron de 24 a 0.
- **0 tokens sin efecto visible**; 12 con impacto mínimo medido (1 elemento).
- `resolve-theme.css` ya no aporta literales de rol; `app.css` tampoco.
- `--glass-bg` tokenizado; `--brand-*` de fallback queda estático porque el motor
  los emite inline.
- Suite completa (`npm run test:serial`): **1829 passed / 3 skipped** (205/206
  archivos, 1 skipped). `npm test` paralelo tuvo 1 flake de carga
  (`App.test.tsx > abre AI Hub…`, timeout 5 s; aislado 66/66 y serial verde).
- `npm run typecheck` exit 0; `npm run build` exit 0 en 5,24 s.
- Sin regresiones del feature y sin commits/push.

