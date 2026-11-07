# Unificación total en un solo editor · estudio, prompt y plan

Fecha: 2026-11-06. Alcance: `apps/desktop` (Tauri 2 + React 19 + TypeScript + Vite).
Pedido del usuario: **estudiar la arquitectura**, **crear un prompt detallado** de
cómo mover todas las herramientas dentro del mismo editor, que sea
**extremadamente fácil de usar**, **sin emojis en la interfaz** y con
**iconos separados sólo lo suficiente** (densidad aplicada a todo).

Documento de trabajo. Los resultados medidos se registran en
`docs/IMPROVEMENT-QUEUE.md`; el estado de fases en `docs/UNIFICATION-PLAN.md`.

---

## 1. Estudio de arquitectura (medido, no inferido)

### 1.1 Registro único de superficies

`app/navigation.ts` define **33 `ViewId`**. `app/view-routing.ts` los normaliza:
12 alias a hubs (`HUB_ALIASES`), 6 alias a modos del editor
(`EDITOR_MODE_ALIASES`), 6 vistas de flujo embebidas en F2
(`EDITOR_EMBEDDED_VIEWS`), y 9 superficies canónicas que `App.tsx` sigue
renderizando como pantallas independientes.

| Clase | Cantidad | Superficie real cuando hay proyecto |
| --- | --- | --- |
| Canónicas standalone | 9 | `home`, `projects`, `download`, `creator`, `lab`, `mcp`, `learn`, `settings`, `editor` |
| Alias a hub | 12 | `download`/`creator`/`lab` + `hubTab` |
| Alias a modo del editor | 6 | `editor` + `editorMode` |
| F2 (ya dentro del editor) | 6 | `script`, `assets`, `production`, `director`, `auto-edit`, `ai-hub` |

`app/workspace-map.ts` es la única fuente de verdad conceptual: 6 etapas
derivadas de `app/pipeline.ts` y 4 grupos que cubren los 33 `ViewId`
exactamente una vez (`workspace-map.test.ts` lo verifica). Sin embargo, ese mapa
hoy **sólo se usa para aprender**: `WorkspaceGuide` muestra los grupos como
tarjetas informativas, no como puertas de navegación. Ahí está la oportunidad.

### 1.2 Componentes y contratos de props

| Componente | Props | Empty-state | Listener global |
| --- | --- | --- | --- |
| `HomeView`, `ProjectHome`, `LearnView`, `McpView`, `SettingsHome` | `onNavigate` (opcional en Settings) | ProjectHome sí | ninguno (salvo `ShortcutsCard` hijo de Settings) |
| `DownloadsHubView`, `CreatorHubView`, `MediaLabView` | `onNavigate`, `initialTab?`, `requestId?` | no | ninguno |
| 6 vistas F2 | `onNavigate` | 5 de 6 sí | ninguno |
| `EditorWorkspace` | `onNavigate`, `initialMode`, `modeRequest`, `onOpenTour`, `onOpenShortcuts`, `onModeChange` | sí (guía de 6 pasos) | `window keydown` (Delete/S/Arrow/Alt) |

Conclusión: **ninguna herramienta registra atajos globales propios**, así que
embeberlas no colisiona con el editor. El único cableado nuevo es
`initialTab`/`requestId` para los tres hubs. Ninguna `.view` usa
`min-height:100vh`; la única regla de altura completa
(`.view.view-empty-page`) se neutraliza dentro de `.editor-mode-panel`.

### 1.3 Superficies que NO son herramientas (no se unifican)

`StartScreen` (lanzador previo a la sesión), `SettingsWindow` (portal con
`role="dialog"`), `WelcomeDialog`, `OnboardingTour`, `ShortcutsCheatSheet`,
`CommandPalette`, `AssistantDock`, `WindowControls` y los banners. Son cromo de
aplicación, modales o flujos de ventana: deben seguir disponibles **sobre
cualquier** vista, incluidos los modos del editor. Meterlos en un panel
rompería su disponibilidad global y el dimensionado nativo de la ventana.

### 1.4 Cascada CSS y densidad

`main.tsx` importa 20 hojas; `styles/filmora/filmora.css` es la capa visual
final y `filmora-states.css` va después. Los entries dinámicos
(`styles/entries/{editor,content}.css`) se inyectan **después** en runtime,
por eso las reglas que compiten usan `!important` (2.475 en la capa).
Valores finales medidos: `--ctl-gap:4px`, `--gap-8:8px`,
`.topbar gap:2px`, `.topbar-actions gap:2px`, `.icon-button` 26 px sin
padding, `.editor-mode-tab padding:0 10px`, `.view-toolbar gap:8px`,
`.timeline-toolbar gap:4px`, `.rail-tabs gap:0` con botones
`padding:2px 4px 0`, `.hub-tab padding:0 12px`, `.transport gap:6px`,
`.rail-list gap:10px 8px; padding:10px`.

Diagnóstico: hay dos escalas en conflicto (`premium/tokens.css` 12/16/24 px
vs `filmora.css` 10/12/16 px) y varios clusters conservan el aire de la capa
legacy. La densidad debe definirse en **un solo bloque de tokens** y aplicarse
a todos los clusters, no parchear selectores sueltos.

### 1.5 Auditoría de emojis

Escaneo de 484 `.ts/.tsx` + 36 `.css` + HTML: **119 líneas con glifos** fuera
del dataset de emojis. Categorías:

- **Interfaz (se eliminan)**: 55 líneas en 15 archivos — `OnboardingTour`
  (18), `ProgressSystem` (6), `ShortcutsCheatSheet` (7 categorías),
  `StartScreen` (4 chips), `EditorAssets` (biblioteca de stickers y 4 tabs),
  `MarkersPanel`, `ProductionView`, `PublicationReadiness`,
  `CapabilitiesCard`, `theme-palette.ts`, `app.css`, `dopamine-ux.css`,
  previews de Denoise/Sharpen.
- **Galerías de demostración (se eliminan)**: 26 líneas en 6 archivos.
- **Contenido de usuario (excepción documentada)**: `features/emoji/*`
  (dataset `emoji-data.ts` con 11.794 glifos, `EmojiPicker`, sus tests) es una
  herramienta para insertar emojis en subtítulos/títulos del **proyecto**, no
  decoración de la interfaz. Los títulos de proyectos demo en
  `test/fake-service.ts` y `StartScreen.test.tsx` sí se limpian porque se
  muestran en el lanzador.
- **Comentarios**: 0.

### 1.6 Contratos frágiles (no romper)

`navigation.test.ts` y `App.test.tsx:86-98` pinan las 11 etiquetas del rail en
orden; `EditorAssets.test.tsx` los 9 tabs del rail de medios; `App.test.tsx`
los tabs `Mezcla`/`Edición`/`Motion`/`Guía`; `e2e/helpers.ts` el tutorial;
`view-routing.test.ts` y `workspace-map.test.ts` el enrutado y el invariante
33/33. **Decisiones que evitan churn**: no renombrar `MAIN_NAV_VIEWS`, no
reordenar los tres primeros menús (`MenuBar.test.tsx`), no cambiar
`resolveViewRoute` (deep links + `WORKSPACE_TOOLS`), y conservar las etiquetas
de tabs ya probadas.

---

## 2. Prompt maestro (copiar y pegar)

```
# Objetivo
Unificá TODAS las herramientas de Olyvia en UN SOLO EDITOR. Con proyecto
abierto, ninguna herramienta debe abrir una pantalla separada: se monta como
panel dentro de EditorWorkspace, la timeline sigue visible y el usuario
encuentra cualquier función en UN SOLO MAPA con una búsqueda. Tiene que ser
extremadamente fácil de usar: una puerta, un clic, vuelta explícita, y el
mismo recorrido de seis pasos en todas partes. Además: CERO emojis en la
interfaz y densidad de iconos «sólo lo suficiente» en TODA la app.

# Repo y estado verificado (leer antes de tocar)
D:\Users\ofici\QODER-WORK\editor-ia · apps/desktop · Tauri 2 + React 19 + TS +
Vite 5. Estado: useProjectStore() montado una vez en App.tsx. F1 (mapa único,
WorkspaceGuide, tour/atajos, loaders muertos) y F2 (6 vistas de flujo como
modos del editor) ya están ejecutadas y verificadas.
- app/view-routing.ts: resolveViewRoute = 12 alias a hubs + 6 alias a modos;
  EDITOR_EMBEDDED_VIEWS = las 6 de F2. NO MODIFICAR resolveViewRoute.
- app/workspace-map.ts: WORKSPACE_STEPS (6) + WORKSPACE_GROUPS (4, cubren los
  33 ViewId una vez) + WORKSPACE_TOOLS (etiqueta/hint/ruta real por vista).
- App.tsx: navigate() resuelve la ruta; renderView() decide superficie. Con
  proyecto, F2 monta EditorWorkspace(initialMode) y conserva activeId lógico;
  sin proyecto mantiene la pantalla standalone con su empty-state real.
  editorSurface controla immersive/flush/playback y carga AMBOS entries CSS.
- EditorWorkspace.tsx: 15 modos en 2 grupos, .timeline-panel SIEMPRE montado,
  cabecera «Editor › modo», «Volver a Edición», onModeChange sincroniza el rail.
- 9 superficies canónicas siguen fuera: home, projects, download, creator,
  lab, mcp, learn, settings, editor. Los 3 hubs necesitan initialTab/requestId.
- filmora.css es la capa final (2.475 !important); los entries dinámicos se
  inyectan después. Los iconos están a 26 px con gaps de 2–10 px dispersos.

# Reglas inviolables
1. git status al inicio; preservar TODO el trabajo no confirmado. Sin commit,
   push, reset --hard, clean, instalación de la app en uso ni cambios de
   firma/licencia sin autorización explícita.
2. Conservar TODA la funcionalidad real. Nada de botones decorativos, backend
   simulado ni éxitos falsos. Lo que no existe va disabled + motivo.
3. Conservar los contratos de tests/e2e o actualizarlos HONESTAMENTE en el
   mismo cambio; nunca desactivar ni maquillar una prueba. Están pinados: las
   11 etiquetas del rail, los 9 tabs de medios, los tabs Mezcla/Edición/
   Motion/Guía, 'Tutorial' exacto, resolveViewRoute completo, invariante 33/33.
4. Sin dependencias nuevas. Sin gradientes/glow en botones ni tarjetas;
   transiciones 90–160 ms; prefers-reduced-motion; tema claro y oscuro;
   contraste AA >= 4,5:1; foco visible. Usar tokens --fm* / --fm2*.
5. Rendimiento: no agregar trabajo por frame ni CSS/JS al arranque; mantener
   CSS splitting y chunks lazy. Presupuesto: CSS/JS iniciales <= +2 %,
   pageOverflow 0, tabsOverflow 0, 0 console errors, CLS 0.
6. Una sola fuente de verdad por concepto. Prohibido copiar listas de pasos,
   modos, vistas o etiquetas entre archivos: todo se deriva de NAV_VIEWS,
   WORKSPACE_GROUPS, WORKSPACE_TOOLS y resolveViewRoute.
7. CERO emojis en cadenas visibles, aria-label, tooltips, placeholders y
   `content:` CSS. Excepción única y documentada: features/emoji/* es
   CONTENIDO DEL USUARIO (selector para subtítulos/títulos), no cromo.
8. Objetivos de clic: la densidad se logra reduciendo ESPACIO ENTRE controles,
   NO su área de clic. Los controles nuevos y los de las barras cumplen
   24×24 px. Excepción honesta y documentada: los micro-controles heredados
   de cabecera de pista (16×24 px) y las etiquetas `sr-only` de 1 px de la
   timeline no se agrandan para no romper su proporción verificada.

# Arquitectura objetivo: UN MAPA → UN SHELL → UN PANEL → UN RECORRIDO
- UN MAPA: EditorToolMap (nuevo) lista los 33 ViewId en los 4 grupos de
  WORKSPACE_GROUPS, con buscador, usando WORKSPACE_TOOLS para etiqueta, hint y
  ruta canónica. Es la ÚNICA puerta cuando hay proyecto. Sin «Más» escondido,
  sin nombres duplicados sin contexto: cada chip muestra grupo + hint.
- UN SHELL: EditorWorkspace es el contenedor de TODAS las herramientas. La
  timeline NUNCA se desmonta. Un modo nuevo «Todo» abre el mapa; al elegir una
  herramienta, el mismo panel muestra ese componente con breadcrumb
  «Editor › Todo › <herramienta>» y un botón «Volver al mapa».
- UN PANEL: los 9 hosts canónicos y los 12 alias a hubs se resuelven a un
  `toolView` + `toolTab` + `toolRequest` que App.tsx pasa a EditorWorkspace.
  Los 3 hubs reciben initialTab/requestId. Sin proyecto, TODO vuelve a su
  pantalla standalone con su empty-state real (no hay timeline que preservar).
  Settings sigue siendo ventana flotante; StartScreen sigue siendo lanzador.
- UN RECORRIDO: WorkspaceGuide conserva los 6 pasos canónicos y el mapa de 4
  grupos; el mapa de herramientas reutiliza ese mismo registro, no crea otro.

# Trabajo detallado por fases (una fase = una iteración verificable)

T1 · REGISTRO Y CABLEADO (sin mover UI todavía)
 1. En app/view-routing.ts agregar EDITOR_TOOL_HOSTS = Set con los 7 hosts
    embebibles (home, projects, download, creator, lab, mcp, learn) y la
    función editorToolForView(id): usa resolveViewRoute(id) y devuelve
    { view: route.view, hubTab?: route.hubTab } si el host está en el set.
    No agregar un mapa de 19 entradas: reutilizar HUB_ALIASES. settings y
    editor quedan fuera. Agregar tests: alias youtube -> {view:'download',
    hubTab:'youtube'}; resolveViewRoute sigue intacto.
 2. En App.tsx agregar estado toolView/toolTab/toolRequest. navigate():
    con proyecto, si editorToolForView(id) existe -> setear activeId lógico,
    toolView/toolTab e incrementar toolRequest; editorSurface = true. Sin
    proyecto, no setear toolView. renderView(): nueva rama que monta
    EditorWorkspace con toolView/toolTab/toolRequest e initialMode='tools'.
    Mantener la rama F2 y las standalone. handleModeChange y el botón
    «Herramientas» del shell deben poder limpiar toolView y volver al mapa.
 3. Verificar que los 33 ViewId siguen cubiertos por WORKSPACE_GROUPS y que
    ningún loader nuevo queda muerto (cada import dinámico tiene un caso).

T2 · PANEL DE HERRAMIENTAS DENTRO DEL EDITOR
 4. EditorModeId += 'tools'. EDITOR_MODES agrega el tab «Todo» al grupo flujo
    (16 tabs, 1 separador). No renombrar los tabs existentes.
 5. Crear features/editor/EditorToolMap.tsx: buscador (filtrado local, sin
    librería nueva), 4 grupos de WORKSPACE_GROUPS, chips de WORKSPACE_TOOLS
    con etiqueta real + hint + grupo + estado «aquí» cuando corresponde, y
    onNavigate(tool.view). Accesible: input con label, botones con aria-label,
    sin emojis, densidad compacta. Test nuevo: 4 grupos, 33 herramientas,
    filtro reduce la lista y navega a la vista real.
 6. EditorWorkspace: props toolView/toolTab/toolRequest/onClearTool. Nuevos
    loaders lazy para HomeView, ProjectHome, DownloadsHubView,
    CreatorHubView, MediaLabView, LearnView y McpView. Cuando mode==='tools'
    y hay toolView, renderizar ese componente dentro de .editor-mode-content
    con initialTab/requestId para hubs y cabecera de contexto con botón
    «Volver al mapa». Cuando mode==='tools' sin toolView, renderizar
    EditorToolMap. La timeline sigue montada en ambos casos.
 7. AppShell: un único botón compacto «Herramientas» (icono grid) visible
    siempre que hay proyecto; abre el mapa desde CUALQUIER superficie.
    Conservar «Volver al editor» cuando la superficie no es el editor.

T3 · CERO EMOJIS Y DENSIDAD
 8. Eliminar TODOS los glifos emoji de la interfaz (55 líneas + 26 de
    galerías + títulos demo + `content:` CSS). Sustituir por el componente
    Icon existente, por texto neutro o por CSS sin glifos. No tocar
    features/emoji/* (contenido del usuario). Comprobar con un escaneo
    automático que queden 0 fuera de esa excepción.
 9. Definir en filmora.css un bloque ÚNICO de tokens de densidad
    (--ui-gap:2px, --ui-pad:4px, --ui-pad-label:6px, --ui-gap-text:3px) y
    aplicarlo con !important a TODOS los clusters: topbar, menubar y
    dropdown, sidebar, mode tabs, rail tabs, view/hub/timeline toolbars,
    inspector tabs, transport, statusbar, rail-list, guía y contexto del modo.
    Reducir el espacio ENTRE iconos, nunca el área de clic de 24 px.
    Verificar que no aparece solape ni scroll horizontal a 1100/1360/1600.

T4 · VERIFICACIÓN
 10. typecheck 0 · build 0 · suite serial >= 2051 passed / 3 skipped /
     0 failed · e2e sin regresiones nuevas (línea base 19/1/4) · arnés
     visual con el mapa, un hub embebido, un alias de hub, un modo F2 y el
     retorno: 0 errores, pageOverflow 0, tabsOverflow 0, timeline presente,
     contraste AA 0 fallos, 0 emojis en DOM visible, áreas de clic >= 24 px.

# Criterios de aceptación (medibles)
- Con proyecto abierto, los 7 hosts + 12 alias a hubs se renderizan DENTRO de
  .editor-workspace y .timeline-panel sigue en el DOM. Sin proyecto, conservan
  su pantalla y empty-state.
- El mapa muestra las 33 herramientas en 4 grupos, con búsqueda funcional, y
  un clic abre la herramienta correcta sin salir del editor.
- 16 tabs, 1 separador, tabsOverflow 0; el botón «Herramientas» existe desde
  cualquier superficie con proyecto.
- 0 glifos emoji en cadenas visibles / CSS `content:` fuera de features/emoji/*.
- Densidad: gap de 0–2 px entre iconos (medido: rail 0, tabs 0, topbar 1);
  los separadores de grupo miden 5–7 px y son intencionales. Sin solapes ni
  recortes; contraste AA 0 fallos; controles nuevos >= 24×24 px.
- Bundle inicial <= +2 %; 0 console errors; 0 pageerror; CLS 0.
- Los 33 ViewId siguen exactamente una vez en WORKSPACE_GROUPS.

# Proceso y entrega
Estudiar -> escribir este documento -> implementar por fases -> medir antes y
después -> verificar -> informar. Entregá tabla de hallazgos, archivos tocados,
comandos con resultado exacto, capturas antes/después, métricas de densidad,
deuda restante y siguiente paso. Informe en español, estructurado, con números
exactos. No declarar «100 %» mientras haya una brecha conocida.
```

---

## 3. Decisiones de diseño para «extremadamente fácil de usar»

1. **Una puerta, no treinta**: con proyecto abierto el rail queda oculto por el
   modo inmersivo; el usuario no debe adivinar entre sidebar, «Más», menú
   Herramientas, menú Avanzado y 16 tabs. El mapa «Todo» es la puerta única y
   está siempre accesible desde la barra superior.
2. **Búsqueda antes que jerarquía profunda**: el mapa tiene un buscador que
   filtra por etiqueta y hint reales (`WORKSPACE_TOOLS`), sin librerías nuevas.
3. **Contexto permanente**: breadcrumb `Editor › Todo › <herramienta>`,
   «Volver al mapa», «Volver a Edición» y la timeline a la vista. Nunca se
   pierde el proyecto ni el cabezal.
4. **Sin proyecto no se unifica a la fuerza**: antes de abrir un proyecto no
   hay timeline; las herramientas conservan sus pantallas y sus empty-states.
5. **Cero ruido visual**: sin emojis decorativos, sin glows, sin aire muerto.
   El espacio se reserva para el contenido, no para separar iconos.

---

## 4. Riesgos y límites honestos

- `SettingsWindow`, `StartScreen` y los overlays globales **no** se unifican:
  son cromo de aplicación, no herramientas. Se documenta como decisión, no
  como deuda.
- Renombrar tabs o puertas para resolver «Efectos»/«Texto»/«Audio» exigiría
  reescribir tests y e2e pinados (F3). En esta iteración se resuelve con
  **contexto** en el mapa (grupo + hint) en lugar de renombrar contratos.
- `features/emoji/*` queda como excepción explícita: es contenido que el
  usuario inserta en su video, no decoración de la app. Si el usuario quiere
  eliminar también esa herramienta, es una decisión de producto separada.
- La densidad extrema puede afectar la legibilidad en pantallas < 1100 px; se
  mide en tres anchos y se conserva el área de clic de 24 px.
- No se declara 100 % mientras falte el cotejo 45/45 de capturas, miniaturas
  reales, nombres de pista visibles, los 4 specs e2e desfasados, la firma
  OV/EV y la verificación CDP nativa.
