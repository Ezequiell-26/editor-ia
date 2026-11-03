# Plan de rediseño premium y mejora funcional — Olyvia

Estado: en curso (2026-11-03). Lead: coordinación, arquitectura visual, integración
y verificación. Este documento fija alcance, arquitectura de capas, propiedad de
archivos y criterios de aceptación. Se actualiza al cerrar cada ola.

## 1. Objetivo

Elevar Olyvia a calidad **profesional/premium** sin perder ninguna función:

- Rediseño visual completo del front-end: launcher, shell (topbar/menubar/rail/
  statusbar), ventana de Ajustes, workspace de edición (preview, timeline,
  inspector, paneles) y las 33 vistas de herramientas.
- Mejorar y verificar todas las funciones existentes; que la IA funcione y que
  todo flujo roto se detecte y arregle (o se documente con evidencia).
- Mantener intactas las capacidades actuales (no eliminar vistas, atajos,
  persistencia, tema de 34 colores, import/export, e2e).
- Verificación real en cada ola: `typecheck`, tests, build, e2e y capturas.

## 2. Diagnóstico inicial (verificado)

- 33 vistas (`apps/desktop/src/app/navigation.ts`) cargadas con lazy import y
  precarga; shell en `components/AppShell.tsx` (topbar + menubar + sidebar +
  statusbar + AssistantDock).
- Hay **20 capas CSS** importadas en `main.tsx`; el orden actual termina en
  `commercial.css` y `shortcuts-and-tour.css`. `app.css` pesa ~256 KB y mezcla
  estilos de shell, componentes y timeline.
- `styles/resolve-theme.css` es una "piel DaVinci Resolve" importada **siempre**
  que impone un look plano con `!important`: elimina backdrop-filter en todo el
  shell, desactiva animaciones de contenido, `--radius-panel: 0px` y fuerza
  scrollbars neutras. Es la causa principal de que la app se vea plana y poco
  premium.
- La app ya tiene un sistema de color de 34 tokens (`state/theme-palette.ts` +
  66 variables CSS) con estudio de color, presets, contraste e import/export.
  El rediseño DEBE construir sobre esos tokens (mantener temas y presets).
- El launcher (`features/start/StartScreen.tsx`) y el shell son funcionales pero
  visualmente planos: jerarquía débil, bordes duros, tipografía sin escala
  premium, iconografía uniforme, cards sin profundidad, estados hover escasos.

## 3. Arquitectura de capas propuesta

Nueva carpeta `apps/desktop/src/styles/premium/` importada al final de
`main.tsx` (después de `shortcuts-and-tour.css`), con archivos pequeños y
duenos separados para evitar conflictos:

| Archivo | Dueño | Contenido |
|---|---|---|
| `premium/tokens.css` | Lead | Tokens nuevos (elevaciones, tipografía, motion, glass, densidad, focus). Derivados de los 34 colores, sin crear una paleta paralela. |
| `premium/base.css` | Lead | Base: scrollbars, selección, focus visible global, tipografía fina, utilidades, reduced-motion. |
| `premium/components.css` | Lead (luego Content) | Botones, inputs, selects, cards, badges, chips, tabs/segmented, toolbars, dialogs, menús, tooltips, toasts, empty states, tablas. |
| `premium/shell.css` | Shell | Topbar/menubar/rail/statusbar, banners, ventana de Ajustes, command palette, assistant dock. |
| `premium/launcher.css` | Shell | StartScreen completo (hero, acciones, plantillas, recientes, footer). |
| `premium/workspace.css` | Workspace | Editor: preview, timeline, inspector, paneles, mixer, dialogs de export. |
| `premium/views.css` | Content | Consistencia visual de las vistas de contenido (Home, Projects, Script, Assets, Production, Learn, Director, Factory, AI Hub, MCP y herramientas). |

Regla: los agentes sólo editan SUS archivos. El shell/launcher y el workspace
pueden editar sus CSS existentes (`start-screen.css`, `settings.css`,
`app.css` secciones puntuales) para quitar conflictos, avisando al Lead.

Cambio quirúrgico inicial (Lead): en `resolve-theme.css` quitar los
"kill-switches" visuales que impiden el rediseño (`backdrop-filter: none` global,
`animation: none`, `--radius-panel: 0px`), conservando sus reglas estructurales
que hoy mantienen coherente la app.

## 4. Olas de trabajo

### Ola 0 — Reconocimiento y baseline (en curso)
- Investigación de referencias premium (repos MIT/open-source y design systems)
  → `docs/PREMIUM-REDESIGN-SPEC.md`.
- Auditoría funcional + IA de las 33 vistas → `docs/APP-FEATURE-AUDIT.md`.
- Baseline verificado (typecheck/build/tests + capturas de todas las vistas)
  → `.tmp-redesign/baseline/`.
- Plan y ownership acordados en este documento.

### Ola 1 — Fundación visual + shell + launcher
- Tokens premium, base y componentes compartidos.
- Shell completo (más importante: primera impresión) + ventana de Ajustes +
  paleta de comandos + launcher premium.
- Criterio: capturas antes/después de launcher, shell en 5 vistas clave y
  Ajustes; cero regresiones funcionales; tests de componentes del shell verdes.

### Ola 2 — Workspace de edición
- Editor: preview, timeline (clips, waveforms, ruler, marcadores), inspector,
  paneles, toolbar, estados vacíos, diálogos de export/render.
- Criterio: e2e existentes verdes + capturas del editor con y sin proyecto;
  timeline legible a densidad real; atajos y drag intactos.

### Ola 3 — Vistas de contenido y consistencia
- Home, Projects, Script, Assets, Production, Learn, Director, Factory, AI Hub,
  MCP y herramientas: cards, formularios, tablas, estados y spacing premium.
- Criterio: capturas de las 33 vistas; sin textos cortados ni scroll roto;
  contraste AA donde aplique.

### Ola 4 — Funcional + IA
- Cierre de los P0/P1 de la auditoría (IA de texto/TTS/MCP/modelos locales,
  flujos rotos, feedback de errores, estados nativos vs navegador).
- Criterio: pruebas específicas nuevas o existentes para cada fix; typecheck
  verde; sin "éxitos falsos".

### Ola 5 — Verificación final y cierre
- `npm run typecheck`, `npm test` (serial si hace falta), `npm run build`,
  e2e (`theme.spec.ts`, `settings.spec.ts`, `app.spec.ts`…), capturas finales y
  reporte honesto de límites.
- Criterio: suites verdes o flakes explicados con evidencia; sin commits.

## 5. Reglas del equipo

- Repo `D:\Users\ofici\QODER-WORK\editor-ia`; **sin git commit/push/reset/stash**.
- No revertir trabajo ajeno; no tocar archivos fuera del scope de cada tarea.
- `read/edit/write` para archivos con acentos (nunca PowerShell para
  reescribirlos).
- Dev server del equipo en `http://localhost:3000` (reutilizar, no lanzar otro).
- Mantener todas las features y la API pública; el rediseño es visual y de UX,
  no una reescritura funcional.
- Cada ola se cierra con evidencia: comandos con números, capturas y hallazgos.

## 6. Riesgos y mitigaciones

- **Cascada CSS hostil (`!important` en varias capas)**: capa premium al final,
  selectores con especificidad controlada y `!important` sólo donde la capa
  legacy lo impone; verificación visual de todas las vistas.
- **Regresiones funcionales por CSS/layout**: los tests de componente/`testing-
  library` y e2e existentes se corren en cada ola; e2e de color y settings ya
  cubren apariencia.
- **Exceso de alcance**: trabajo por olas con criterios de aceptación; lo que no
  entre se documenta como siguiente paso, no se finge terminado.
- **Rendimiento**: la capa premium evita animar propiedades costosas; se mide
  con capturas y `performance.now` cuando aplique.
