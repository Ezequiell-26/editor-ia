# Color completamente configurable — 2026-11-03

## Qué se hizo

El usuario pidió que la app sea «completamente customizable en colores». El
diagnóstico fue contundente: el modelo de apariencia sólo tenía 5 colores
(`accent`, `info`, `background`, `surface`, `text`) y la capa visual dominante
(`commercial.css`, 144 usos de `--commercial-*` fijos; `olyvia.css` con marca
fija; `app.css` con clips/marcadores literales) no respondía a la paleta. Se
midió antes de tocar nada: con `--color-accent` rojo, el topbar seguía en
`rgba(24,27,32,.85)` y sólo el botón `.primary` cambiaba; el cambio además se
perdía al recargar si el picker nativo no disparaba `blur`.

Se implementó el sistema completo (contrato en `docs/COLOR-CUSTOMIZATION.md`):

1. **Motor** (`apps/desktop/src/state/theme-palette.ts`, nuevo):
   - 34 tokens en 5 grupos: superficies (14), acento (5), estados (5), medios
     (6) y marca (4).
   - 7 presets completos: `olyvia` explícita (reproduce el look actual) y
     resolve/mint/ember/violet/ocean/graphite derivados de los 5 colores base.
   - 66 variables CSS emitidas inline: 34 `--color-*`, aliases
     `--commercial-*` (10) y `--olyvia-*` (7), `--color-ok/warn*`, degradados
     de marca (normal/hover/subtle), glows, `--brand-border/ink`, `--primary-hue`.
   - Contraste WCAG (`relativeLuminance`, `contrastRatio`,
     `themeContrastReport` con 10 pares, `ensureContrast`, `fixTextContrast`) y
     archivo de tema JSON estricto (`olyvia-theme`, 34 tokens, rechazo entero
     con error en español si falta/corrompe algo).
   - Compatibilidad v4: si un registro viejo trae sólo los 5 colores, se deriva
     la paleta y ese campo base manda sobre su token; los tests viejos de
     `preferences-backup` pasan sin tocarlos.
2. **UI** (`features/settings/ColorStudioCard.tsx`, nuevo + integración en
   `SettingsHome`/`AppearanceCard`): estudio de color con 5 grupos colapsables,
   por token color picker + hex + reset; preview vivo del shell (topbar, rail,
   panel, clip de video, clip de audio con waveform, botón primario, badge,
   aviso); reporte de contraste con «Corregir texto»; exportar/importar tema;
   restablecer con confirmación. El slider de matiz de la tarjeta de Apariencia
   ahora deriva acento + marca completa.
3. **CSS tokenizado** en todas las capas que se importan en `main.tsx`:
   `tokens.css` (fallback de primera pintura), `commercial.css`, `olyvia.css`,
   `flat.css`, `chrome.css`, `resolve-theme.css` (la última capa con
   `!important` que fijaba iconos del rail, statusbar, segmented, badges,
   menús y diálogos), `app.css` (clips de timeline, waveforms, marcadores,
   banners, badges, progreso), `home.css` y `start-screen.css` (launcher y sus
   6 tonos). Regla: rol de tema → variable; alfa → `color-mix`; arte/sombras/
   datos de usuario quedan documentados como límite.
4. **Persistencia robusta**: `ColorStudioCard` hace commit agrupado (320 ms)
   además de blur/pointerup. Se detectó con una prueba propia (cambiar acento y
   panel, cerrar Ajustes con Escape, recargar) que sin esto el cambio se
   perdía; tras el fix `palette.accent`/`palette.panel` quedan en
   `localStorage` y sobreviven la recarga.
5. **Marcadores**: `MarkersPanel` dejó de tener hex fijos
   (`MARKER_COLOR_HEX`) y usa las mismas clases `.marker-*` +
   `var(--marker-color)` que el timeline; se eliminaron variables globales
   `--marker-*` que nadie usaba.
6. **Ajustes de arnés** (pre-existentes, autorizados): `e2e/helpers.ts` con
   `exact: true` para «Tutorial» (el lanzador siembra 3 demos con ese nombre) y
   `playwright.config.ts` apuntando a 3000 con `reuseExistingServer` (antes
   5173, un puerto que `npm run dev` nunca abre). `vite.config.ts` ignora los
   temporales de edición para que el watcher no muera con EBUSY en Windows.

## Archivos

- Nuevos: `apps/desktop/src/state/theme-palette.ts`,
  `apps/desktop/src/features/settings/ColorStudioCard.tsx`,
  `apps/desktop/e2e/theme.spec.ts`,
  `apps/desktop/src/state/theme-palette.test.ts`,
  `apps/desktop/src/features/settings/ColorStudioCard.test.tsx`,
  `apps/desktop/src/features/settings/AppearanceCard.test.tsx`,
  `docs/COLOR-CUSTOMIZATION.md`.
- Modificados: `state/appearance.ts`, `state/AppearanceProvider.tsx`,
  `state/appearance.test.ts`, `features/settings/AppearanceCard.tsx`,
  `features/settings/SettingsHome.tsx`, `features/editor/MarkersPanel.tsx`,
  `styles/tokens.css`, `styles/commercial.css`, `styles/olyvia.css`,
  `styles/flat.css`, `styles/chrome.css`, `styles/resolve-theme.css`,
  `styles/app.css`, `styles/home.css`, `styles/start-screen.css`,
  `styles/settings.css`, `README.md`, `e2e/helpers.ts`,
  `apps/desktop/playwright.config.ts`, `apps/desktop/vite.config.ts`.
- 20 modificados + 7 nuevos. **Sin commit/push** (el usuario no lo autorizó).

## Evidencia medida

- Tests nuevos: motor **38**, apariencia **14** (antes 5), estudio **10**,
  AppearanceCard **3**; E2E del tema **7**.
- `npx playwright test e2e/theme.spec.ts` → **7/7** (22,6 s);
  `e2e/settings.spec.ts` → **4/4**. `npm run typecheck` → exit 0.
  `npm run build` → exit 0 (5,24 s).
- Suite serial: **1829 passed / 3 skipped** (205/206 archivos; 1 skipped).
  `npm test` paralelo: 1828 + 1 flake de carga de `App.test.tsx` (timeout 5 s),
  aislado 66/66 y serial verde.
- Cobertura de tema medida por el verificador independiente: **66,7 %** de las
  propiedades pintadas (806/1209, 608 elementos); **0 tokens sin efecto visible**;
  literales de rol que ganan la cascada **24 → 0**.
- CSS por archivo (hex): commercial 29→1, olyvia 87→6, start-screen 261→0,
  home 16→0, resolve-theme 162→7, app.css 497→243 (restantes justificados).
- Look por defecto: pixel diff shell **0,52 %**, Ajustes/Apariencia **0,76 %**
  tras tokenizar resolve-theme; sin cambios de layout.
- Persistencia real verificada en Chrome: acento `#ff2d55` + panel `#1b1030`
  guardados con `preset: custom` y 34 claves, y siguen aplicados tras recargar.

## Límites conocidos (honestos)

- Arte decorativo (emblema, mascota/panda, algunas ilustraciones del launcher),
  sombras/backdrops negros y `clip.colorTag` no son tema.
- Tema claro: funciones de superficie/texto/borde y `color-scheme`, pero quedan
  13+8 pares de texto de estado/tenue < AA (mín. 2,36:1) y botones de acento
  oscuros. No está prometido como tema claro completo.
- Contraste del tema por defecto: 50 pares < AA (acento sobre superficie =
  3,37:1) es deuda previa; el estudio de color permite corregirla.
- La cobertura es conductual y el estado medido no incluye un proyecto abierto
  (clips reales de timeline no medidos directamente; se validaron con fixture
  que carga los CSS reales y con `getComputedStyle`).

## Próximo paso sugerido

1. Derivar estados legibles automáticamente para fondos claros (tema claro
   completo) y ofrecer un preset accesible de fábrica.
2. Revisar el contraste del preset Olyvia (links/acento 3,37:1) y decidir si se
   sube `accentLight` para texto o se usa otro token en enlaces.
3. Evaluar exponer `clip.colorTag` en el estudio o mantenerlo como dato.
