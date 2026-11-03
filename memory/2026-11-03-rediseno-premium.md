# Rediseño premium + honestidad funcional — 2026-11-03

## Qué se hizo

El usuario pidió mejorar el editor completo: front-end premium/profesional,
todas las funciones revisadas, IA funcionando, y mantener lo existente. Se
trabajó en dos bloques con un equipo de 5 agentes de implementación + 2
investigadores y verificación del Lead.

1. **Investigación y auditoría primero**:
   - `docs/PREMIUM-REDESIGN-SPEC.md` (1.552 líneas): referencias MIT/open-source
     (VS Code, OpenCut, Carbon Motion, Linear/Raycast/Figma), diagnóstico de
     cascada (1.511 `!important`), tokens, 14 componentes, layout de shell,
     timeline, accesibilidad, estrategia de capas.
   - `docs/APP-FEATURE-AUDIT.md`: 33 vistas mapeadas, matriz de IA honesta
     (funciona / mock / sólo nativo / backend sin UI), 5 P0 + 10 P1 + 8 P2.
   - Baseline: typecheck/build/suite + 22 capturas de las 19 vistas del rail.

2. **Capa premium nueva** `apps/desktop/src/styles/premium/`
   (`tokens/base/components/shell/launcher/workspace/views.css`, importada al
   final de `main.tsx`): topbar 44 con vidrio, rail 48, statusbar 24, launcher
   premium, editor con timeline (ruler 28, track-head 160, clips con color de
   medio, waveforms, selección, handles, playhead), vistas consistentes.
   Se construye SOBRE los 34 tokens de tema: estudio de color, presets y tema
   claro siguen funcionando. Regla Quiet Premium: primario sólido, hairlines,
   hover 110–150 ms, sin translateY/glow/gradientes en botones/cards.

3. **Neutralización en origen** (menos `!important`, look real): `flat.css`
   608→87 líneas; `resolve-theme.css` 2.074→610 y 1.036→152 `!important`;
   fuera el ripple/overflow de `premium-animations.css`; `workspace.css`
   1.149→16. Cada bloque restante está documentado como impasse.

4. **Honestidad funcional/IA** (el problema real de la app no era cantidad de
   features sino bordes deshonestos): banner de modo navegador en el flujo (no
   flotante) y quita de checks "LISTO" falsos; Whisper ya no tiene la ruta
   hardcodeada del autor y reporta motivo accionable; comando `test_provider` +
   «Probar conexión» en Ajustes y recuperación en el asistente; Fábrica rechaza
   guion simulado; demos `demo://` eliminadas (`=0`); gate de modelos on-device
   con descarga y requisito ONNX; panel de estado del servidor MCP (sin
   stop/restart, dicho explícitamente); README/TUTORIAL con requisitos reales;
   `docs/FOLLOW-UPS.md` con backend sin UI.

5. **Arneses de verificación**: playwright config a 3000 con reuseExistingServer;
   `e2e/theme.spec.ts` (7 tests del sistema de color); fix de `helpers.ts`
   (`exact:true`); actualización de e2e con deriva previa (nav «Más», versión
   dinámica del updater, Lottie documentado); `verify-shots.mjs` del Lead.

## Evidencia (números)

- `npm run typecheck` (4 proyectos): exit 0.
- `npm run build`: exit 0 (`✓ built in 5.68 s`; CSS 621 KB min / ~95 KB gzip;
  JS main 623,6 KB / 184 KB gzip).
- `npm run test:serial`: **1869 passed, 3 skipped (1872)**, 212 archivos passed
  + 1 skipped (213).
- `cargo test -p editor-ia-desktop --lib`: **541 passed, 0 failed, 49 ignored**.
- `npx playwright test`: **21 passed, 1 skipped** (Lottie UI no montable en
  navegador sin proyecto; cubierto por tests de componente + rasterizador).
- Verificación visual del Lead: 0 console errors, 0 overflow; topbar/rail/
  statusbar 44/48/24; tema claro `#ffffff` + color-scheme light.
- Capturas: `.tmp-redesign/views/final-real/` (33+4), `final-real-1280/`,
  `final-real-shell/`, `.tmp-redesign/baseline/shots/` (antes),
  `.tmp-redesign/verify/shots/`, `.tmp-redesign/shell/`, `.tmp-redesign/workspace/`.
- Build nativo: `target/release/editor-ia-desktop.exe` (38,9 MB) +
  `Olyvia_0.2.0_x64-setup.exe` (158,5 MB) firmados; app abierta para el usuario.

## Ola polish (misma fecha)

Pedido extra del usuario: más minimalista/compacto, rendimiento y timeline
customizable/fluido, estudiando repos MIT. Se implementó (`docs/PREMIUM-POLISH-SPEC.md`):

- Timeline: 3 preferencias persistentes en Ajustes→Editor (densidad
  cómoda/compacta, etiquetas completas/minimal, rejilla alineada a la regla),
  cabeceras con chip/nombre/flags/grip, regla con ticks, rejilla
  `--tl-grid-step`, clips con radio/borde/degradado/waveform/thumb/label 11,
  selección ring, handles al hover, playhead 2 px + grip, toolbar en 4 grupos.
  Fluidez igual que antes (long tasks 2/150 ms, DOM 238→239, demo 1569→1564 ms).
- Vistas: hub-tabs 22→24, chips 9→10, anillo Aprender 8→10, Home compacto con
  notas a 2 líneas; 33/33 sin overflow a 1440/1280, 0 console errors.
- Verificación final post-polish: typecheck 0; build 0 (CSS 628,65 KB min /
  95,7 gzip, JS main 623,9 KB / 184,2 gzip); suite serial 1869 passed/3 skipped;
  e2e 21 passed/1 skipped; visual 0 errores/0 overflow; capturas en
  `.tmp-redesign/polish/final-views-1440|1280/` y `shots/final3-*`.
- Rebuild nativo en `target-polish/` (para no bloquear el exe en uso).

## Límites y próximo paso

- Runtime nativo no ejercitado end-to-end (Ollama real, faster-whisper, TTS,
  FFmpeg, MCP): contrato + tests unitarios; checklist en `FOLLOW-UPS.md`.
- Tema claro: superficies siguen la paleta, pero texto de estado/tenue sigue
  bajo AA en algunos pares (deuda previa); contraste del tema por defecto ya
  incumplía AA antes.
- Arte decorativo, sombras/backdrops y datos de proyecto fuera de paleta por
  diseño (§7).
- Ola polish en curso (`docs/PREMIUM-POLISH-SPEC.md`): timeline
  customizable/fluido + vistas más compactas + performance antes/después.
- 127 `!important` de bloques muertos del rail legado en `resolve-theme.css`
  (sin consumidores en TSX).
- Sin commits/push: HEAD `3a886f0`, 70 archivos modificados + nuevos del
  feature. No se tocó la instalación existente ni procesos del usuario.

## Archivos clave

`styles/premium/*`, `styles/resolve-theme.css`, `styles/flat.css`,
`components/BrowserModeBanner.tsx`, `features/settings/SettingsHome.tsx`,
`features/factory/FactoryView.tsx`, `features/ai/LocalModelGate.tsx`,
`features/mcp/McpView.tsx`, `src-tauri/src/commands/{transcribe,providers,
assistant,capabilities,background}.rs`, `e2e/theme.spec.ts`, `e2e/helpers.ts`,
`docs/PREMIUM-REDESIGN-{SPEC,PLAN,RESULT}.md`, `docs/APP-FEATURE-AUDIT.md`,
`docs/FOLLOW-UPS.md`, `docs/PREMIUM-POLISH-SPEC.md`.
