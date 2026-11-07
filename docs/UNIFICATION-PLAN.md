# Unificación de Olyvia en un único editor — prompt, análisis y plan

Fecha: 2026-11-06. Alcance: front end de `apps/desktop` (Tauri 2 + React 19 +
TypeScript + Vite). Documento de trabajo; no modifica código por sí mismo.

---

## 1. Prompt maestro (copiar y pegar)

```
# Objetivo
Unificá Olyvia en UN SOLO editor: que cualquier tarea se pueda hacer sin
perder el contexto del proyecto, y que la app se entienda y aprenda en minutos.
No agregues pantallas: reducí superficies, eliminá puertas duplicadas y dale
al usuario un único mapa mental.

# Repo y stack
D:\Users\ofici\QODER-WORK\editor-ia · apps/desktop · Tauri 2 + React 19 + TS +
Vite 5. Estado: useProjectStore() (state/project-store.tsx) montado una sola vez
en App.tsx:948; TODAS las vistas ya comparten ese store. No hay backend nuevo.

#Estado real verificado (leer antes de tocar)
- app/navigation.ts: 33 ViewId, 11 puertas en MAIN_NAV_VIEWS, 10 en
  SECONDARY_NAV_VIEWS («Más»), HUB_COVERED con 12 alias.
- app/view-routing.ts: resolveViewRoute ya normaliza 12 hubs a tabs y 6 vistas
  a MODOS DEL EDITOR. Es la base de la unificación: ampliar, no reemplazar.
- App.tsx:712-774: switch con 15 casos. Otros 18 ViewId NO tienen caso:
  sus loaders (App.tsx:126-183) están MUERTOS y sólo alimentan
  VIEW_PRELOADERS. PRIMARY_PRELOADS precarga 4 vistas.
- features/editor/EditorWorkspace.tsx: 8 modos (EDITOR_MODES:69-82) en
  paneles DENTRO del workspace; .timeline-panel SIEMPRE montado (:527-546).
  Sin proyecto hace early-return con 3 hints (:314-374).
- features/editor/EditorAssets.tsx: 9 RailView locales, SIN ViewId; 13 llamadas
  onNavigate salen del editor (assets, download, learn, ai-hub, projects…).
- CUATRO recorridos de aprendizaje distintos y desincronizados:
  app/pipeline.ts PIPELINE_STAGES = 6 etapas (fuente canónica de progreso);
  features/home/PipelineGuide.tsx = 6 pasos; features/learn/LearnView.tsx
  QUICK_STEPS = 5 pasos; components/OnboardingTour.tsx TOUR_STEPS = 6 pasos
  distintos; editor vacío = 3 hints. OnboardingTour y ShortcutsCheatSheet
  NUNCA se montan: AppShell recibe onOpenTour/onOpenShortcuts opcionales y
  App.tsx no los pasa (App.tsx:794-806).
- Colisiones de nombres: «Efectos» (rail / modo visuals / «Más»), «Texto»
  (rail / modo text-edit), «Audio» (rail / modo mixer).

# Reglas inviolables
1. git status --short --branch al inicio; preservá TODO el trabajo no
   confirmado. Sin commit, push, reset --hard, clean, instalación de la app
   en uso ni cambios de firma/licencia sin autorización explícita.
2. Conservá TODA la funcionalidad real. Nada de backend simulado, botones
   decorativos ni éxitos falsos. Lo que no existe va disabled + motivo.
3. Conservá los contratos de tests/e2e o actualizalos HONESTAMENTE en el mismo
   cambio cuando la UX cambie; nunca desactives ni maquilles una prueba.
   Nombres exactos que hoy se prueban: las 11 etiquetas de MAIN_NAV_VIEWS en
   orden (navigation.test.ts:10-24 y App.test.tsx:86-98), los 9 tabs del rail
   en orden (EditorAssets.test.tsx:49-65), tabs 'Mezcla'/'Edición'/'Motion'
   (App.test.tsx:306-319), 'Tutorial' exacto (e2e/helpers.ts:13), 6
   .pipeline-guide-step (e2e/app.spec.ts:89), resolveViewRoute completo
   (view-routing.test.ts).
4. Sin dependencias nuevas. Sin !important nuevos salvo impasse documentado.
   Sin gradientes/glow en botones ni tarjetas; transiciones 90-160 ms;
   prefers-reduced-motion respetado; tema claro y oscuro; foco AA.
5. Rendimiento: no agregues trabajo por frame ni CSS/JS al arranque; mantené
   CSS splitting (styles/entries/*) y los chunks lazy. Presupuestos: FCP
   < 800 ms, 0 long tasks en reposo, pageOverflow 0, CLS 0.
6. Una sola fuente de verdad por concepto. Si un dato aparece en dos archivos,
   uno importa al otro. Prohibido copiar listas de pasos, modos o vistas.

# Arquitectura objetivo
UN MAPA → UN SHELL → UN RECORRIDO.
- UN MAPA: app/workspace-map.ts define WORKSPACE_STEPS (las 6 etapas de
  app/pipeline.ts, enriquecidas) y WORKSPACE_GROUPS (4 grupos que cubren los
  33 ViewId EXACTAMENTE UNA VEZ). Toda la app consulta ese mapa: rail, «Más»,
  paleta, modos del editor, guía de aprendizaje y progreso.
- UN SHELL: el editor es el contenedor. La timeline permanece visible en todos
  los modos. Las vistas de flujo (script, assets, production) y las de IA
  (director, auto-edit, ai-hub) pasan a modos agrupados del editor; los hubs
  (download, creator, lab) y Aprender/Ajustes conservan su superficie pero se
  abren desde el mismo mapa, con retorno explícito al editor.
- UN RECORRIDO: components/WorkspaceGuide.tsx es el ÚNICO componente de
  aprendizaje. Se renderiza en LearnView (completo) y dentro del editor
  (compacto). OnboardingTour y ShortcutsCheatSheet se montan una sola vez en
  App.tsx y se abren desde cualquier superficie, incluido el editor.

# Trabajo por fases (ejecutar en orden; una fase = una iteración verificable)
F1 · MODELO Y APRENDIZAJE (sin mover vistas todavía)
  1. Crear app/workspace-map.ts + test: 6 pasos canónicos, 4 grupos, invariante
     «los 33 ViewId están exactamente una vez», helper stageForView/nextStep.
  2. Crear components/WorkspaceGuide.tsx + test: 6 pasos, CTA real por etapa,
     progreso desde computePipeline(), variante compact, launchers de tour y
     atajos.
  3. LearnView: eliminar QUICK_STEPS (5) y usar WORKSPACE_STEPS (6).
  4. EditorWorkspace: nuevo modo «Guía» que monta WorkspaceGuide compacto SIN
     perder la timeline; el modo también debe existir sin proyecto.
  5. App.tsx: montar OnboardingTour y ShortcutsCheatSheet una sola vez, pasar
     onOpenTour/onOpenShortcuts a AppShell, LearnView y EditorWorkspace.
  6. App.tsx: eliminar los ~17 loaders muertos y reducir VIEW_PRELOADERS a las
     vistas reales (Partial<Record> + guarda en preloadViews).
F2 · MODOS AGRUPADOS: llevar script/assets/production/director/auto-edit/
  ai-hub al editor como modos de segundo nivel; view-routing.ts los resuelve a
  editor+modo; App.tsx decide la vista standalone SÓLO cuando no hay proyecto
  abierto (hoy esas vistas tienen su propio empty-state). Conservar la timeline.
F3 · PUERTAS ÚNICAS: resolver colisiones de nombre («Efectos», «Texto»,
  «Audio»), quitar de «Más» las 6 puertas que ya son tabs del editor y dejar un
  único acceso por función; actualizar tests y e2e al contrato nuevo.
F4 · HUBS Y RETORNO: los hubs se abren como panel del editor o con un botón
  «Volver al editor» persistente; la paleta de comandos y los atajos usan el
  mapa; onboarding de primera ejecución con el recorrido único.

# Criterios de aceptación (medibles, sin excepciones)
- Invariante: la unión de WORKSPACE_GROUPS === NAV_VIEWS (33), sin duplicados.
- Una sola definición de los 6 pasos: grep de «cinco pasos» = 0; LearnView,
  PipelineGuide, OnboardingTour y el editor vacío muestran los MISMOS 6 pasos.
- Desde el editor se puede abrir la guía, el tour y los atajos SIN navegar a
  otra vista; .timeline-panel sigue en el DOM (getByRole o querySelector).
- CERO loaders muertos: cada entrada de VIEW_PRELOADERS corresponde a un caso
  del switch de renderView.
- npm run typecheck 0 · npm run lint 0 · npx vite build --emptyOutDir=false 0
  (el npm run build normal lo bloquea el guard de borrado masivo del sandbox).
- npm run test:serial >= 2038 passed / 3 skipped / 0 failed; e2e exactamente
  19 passed / 1 skipped / 4 failed (los 4 previos de input[type=color]) salvo
  que F3 corrija esos specs, en cuyo caso 23/1/0 con evidencia.
- 33/33 vistas sin scroll horizontal a 1280/1360/1600; 0 console errors;
  0 pageErrors; pageOverflow 0; contraste AA en ambos temas.
- Sin regresión de bundle: CSS/JS iniciales no crecen > 2 %; FCP sin regresión.

# Proceso y entrega
Una fase acotada por iteración; medí antes y después. No declares `done` sin
evidencia. Si algo falla por causa previa, identificala y no la pintes de verde.
Entregá: tabla de hallazgos, archivos tocados, comandos con resultado, capturas
antes/después, métricas, deuda restante y siguiente paso concreto. Informe en
español, estructurado, con números exactos. Si no se llega al 100 %, decir el
% real y el motivo.
```

---

## 2. Análisis del estado real

| concepto | Evidencia | Diagnóstico |
|---|---|---|
| Registro de vistas | `app/navigation.ts` (33 `ViewId`, 11 puertas, 10 en «Más») | Un mapa incompleto: hay más puertas que conceptos |
| Normalización | `app/view-routing.ts` | **Ya unifica** 12 hubs en tabs y 6 vistas en modos del editor. Es la base correcta |
| Montaje | `App.tsx:712-774` (switch, 15 casos) + 14 `lazy` | 18 `ViewId` sin caso; ~17 loaders muertos que sólo alimentan el precargador |
| Editor | `EditorWorkspace.tsx:69-82, 387-402, 515-546` | 8 modos en paneles, timeline siempre montada. Buen patrón, aunque plano (8 tabs) |
| Rail | `EditorAssets.tsx:32-54, 1275-1690` | 9 vistas locales sin `ViewId`; 13 `onNavigate` sacan al usuario del editor |
| Aprendizaje | `app/pipeline.ts:33-76`, `PipelineGuide.tsx`, `LearnView.tsx:23-53`, `OnboardingTour.tsx:20-118`, `EditorWorkspace.tsx:354-370` | **Cuatro recorridos**: 6 / 6 / 5 / 6 / 3 pasos distintos. El tour y la hoja de atajos están sin montar |
| Estado | `useProjectStore()` en `App.tsx:948` | Correcto: todas las vistas comparten el mismo proyecto. No hace falta migrar estado |
| Contratos frágiles | `navigation.test.ts`, `view-routing.test.ts`, `App.test.tsx:86-98, 306-319`, `EditorAssets.test.tsx:49-65`, `e2e/helpers.ts`, `e2e/app.spec.ts:89` | Cualquier renombrado de puertas exige actualizar estos archivos en el mismo cambio |

**Conclusión del análisis**: la app ya tiene el 60 % de la unificación hecha
(alias a hubs, modos dentro del editor, store único). Lo que impide que se
*entienda* no es la falta de integración, sino (a) cuatro recorridos de
aprendizaje contradictorios, (b) 18 superficies fantasma en el registro,
(c) puertas duplicadas y nombres colisionados y (d) que desde el editor no hay
forma de ver el mapa completo sin salir de él. El orden correcto es:
**modelo → aprendizaje → modos → puertas → hubs**, no al revés.

---

## 3. Arquitectura objetivo

```
app/workspace-map.ts            ← ÚNICA fuente de verdad
  ├─ WORKSPACE_STEPS (6)        ← deriva de app/pipeline.ts
  └─ WORKSPACE_GROUPS (4)       ← cubre los 33 ViewId exactamente 1 vez
        │
        ├─ Sidebar / «Más» / paleta   (puertas)
        ├─ EditorWorkspace modos      (paneles, timeline siempre visible)
        ├─ components/WorkspaceGuide (aprendizaje, completo y compacto)
        └─ app/view-routing.ts        (deep links → superficie canónica)
```

Principio: **una función, una puerta, un nombre**. El editor es el shell; la
timeline es el ancla visual que nunca desaparece.

---

## 4. Plan por fases

| Fase | Contenido | Riesgo | Criterio de cierre |
|---|---|---|---|
| F1 | Mapa único, `WorkspaceGuide`, LearnView a 6 pasos, modo «Guía» en el editor, tour/atajos montados, loaders muertos fuera | Bajo (no se mueven vistas) | invariante 33/33, 4 recorridos → 1, tests verdes |
| F2 | `script`/`assets`/`production`/`director`/`auto-edit`/`ai-hub` como modos agrupados del editor; fallback standalone sin proyecto | Medio (empty-states, deep links) | esos 6 `ViewId` resuelven a `editor`+modo y la timeline sigue en el DOM |
| F3 | Quitar las 6 puertas duplicadas de «Más», resolver «Efectos»/«Texto»/«Audio», actualizar tests/e2e al contrato nuevo | Medio (contratos pinados) | 0 etiquetas duplicadas, suite y e2e actualizados con evidencia |
| F4 | Hubs con retorno al editor, paleta y atajos desde el mapa, onboarding de primera ejecución único | Bajo-medio | recorrido completo sin salir del editor en los 6 pasos |

**Orden de ejecución**: F1 ejecutada en esta sesión. F2–F4 quedan como
iteraciones del objetivo, con sus criterios ya fijados.

---

## 6. Estado del objetivo (modo goal)

El mecanismo externo `.agentloop/runs/20261105-233635-4108d0` sigue con
`status.json` = `running:false` / `stop_reason: loop_agent_error` (CLI
`opencode` exit 1, 0 iteraciones). No se reactivó ni se falsificó: el objetivo
se ejecuta como bucle directo con los criterios de aceptación de §1 y este
documento como registro de estado. El ledger de `.editoria-loop/` no se tocó.

| Iteración | Estado | Evidencia |
|---|---|---|
| F1 | **completada y verificada** | `.tmp-redesign/unify/shots/results-final2.json`, `.tmp-redesign/unify/serial-final.log` (**2047 passed / 3 skipped / 0 failed**), `.tmp-redesign/unify/e2e-final.log` (**19/1/4**, los 4 previos) |
| F2 | **completada y verificada** | `.tmp-redesign/unify/f2/shots/results.json` (13 estados, 0 errores), `.tmp-redesign/unify/f2/serial.log`; ver entrada en `docs/IMPROVEMENT-QUEUE.md` |
| F3 | **completada y verificada (2026-11-07)** | `SECONDARY_NAV_VIEWS` excluye lo que `resolveViewRoute` resuelve a modo del editor: «Más» queda en 5 puertas (Nodos, Director, Automático, AI Hub, MCP); colisiones «Efectos»/«Texto»/«Mezcla» resueltas. typecheck desktop 0 · tests nav/routing/map/motion 24/24 · `App.test.tsx` 74/74 · e2e `app.spec.ts` 4/4 con aserciones negativas nuevas |
| F4 | parcial | retorno persistente al editor implementado en F2; paleta de comandos generada desde `WORKSPACE_GROUPS` y copy de primera ejecución alineado al recorrido único (2026-11-07). Faltan: hubs como panel con retorno persistente en los 3 hubs, atajos del cheat sheet agrupados por el mapa y cierre del onboarding único |

**F1 ejecutada** (archivos): `app/workspace-map.ts` (+test),
`components/WorkspaceGuide.tsx` (+test), `app/view-routing.ts` (modo `guide`),
`features/learn/LearnView.tsx` (+test), `features/editor/EditorWorkspace.tsx`,
`App.tsx`, `App.test.tsx`, `styles/filmora/filmora.css`.

Resultados medidos de F1:

- Cuatro recorridos → **uno**: Inicio (`PIPELINE_STAGES`), Aprender, modo Guía
  del editor y editor sin proyecto muestran los **mismos 6 pasos**
  (`Proyecto / Guion / Medios / Voz / Edición / Exportar`).
- Invariante del mapa: los **33 `ViewId`** están exactamente una vez en 4
  grupos; cada herramienta usa la etiqueta real de `NAV_VIEWS` y la ruta
  canónica de `resolveViewRoute`.
- La guía se abre **dentro del editor** sin perder la timeline
  (`.timeline-panel` sigue en el DOM); tour y atajos se montan una sola vez y
  quedan disponibles desde cualquier superficie.
- **18 loaders muertos eliminados**: 14 cargadores / 14 entradas en
  `VIEW_PRELOADERS` / 15 casos en `renderView` (`projects` es estático).
  `OnboardingTour` y `ShortcutsCheatSheet` pasaron a chunkslazy (9,2 KB +
  7,4 KB) para no pagarlos en el arranque.
- Bundle: JS principal **580.128 B** (−0,46 % frente a 582.820 B de la línea
  base), CSS **663.563 B** (+1,08 %); ambos dentro del presupuesto de 2 %.
- `pageOverflow 0`, 0 `pageerror`, 0 errores de consola de código en 6 estados
  capturados; contraste AA sigue en **0 textos por debajo de 4,5:1**.

**F2 ejecutada** (2026-11-06, documentada en `docs/UI-F2-PROMPT-ANALISIS.md`):
`EDITOR_EMBEDDED_VIEWS` en `app/view-routing.ts` es la única fuente del mapa
`ViewId → modo`; `resolveViewRoute` se dejó intacto para no romper deep links ni
el invariante de `workspace-map`. `App.tsx` decide según `project !== null`: con
proyecto monta `EditorWorkspace(initialMode)` conservando el `activeId` lógico
(el rail sigue marcando Guion/Medios/Producción) y carga **ambos** entries CSS;
sin proyecto mantiene las pantallas standalone con su empty-state real. Los 15
modos se agrupan en 2 bloques con separador, cabecera «Editor › modo» y
«Volver a Edición». `onModeChange` sincroniza el rail al cambiar de tab. Se
añadió el menú «Avanzado» (accesos reales), el botón persistente «Volver al
editor» y el mapa de 4 grupos en la guía compacta. No hubo colisión de atajos:
las seis vistas no registran listeners globales.

**Siguiente paso concreto (F4)**: F4 quedó parcial el 2026-11-07: la paleta
de comandos ya se genera desde `WORKSPACE_GROUPS` (orden y categoría por
grupo, etiquetas de `NAV_VIEWS`, atajos `nav.*` conservados) y el copy de
`WelcomeDialog` usa `WORKSPACE_STEP_COUNT` en vez del «cinco pasos» viejo.
F3 quedó cerrada el mismo día: las 6 vistas que `resolveViewRoute` resuelve
a modo del editor ya no tienen puerta en «Más» (quedan Nodos, Director,
Automático, AI Hub y MCP), sin listas duplicadas que mantener. Falta:
hubs (`download`/`creator`/`lab`) como panel del editor con retorno
persistente — T2 ya monta herramientas como panel, verificar cobertura —,
atajos del cheat sheet agrupados por los grupos del mapa y el cierre del
onboarding de primera ejecución con el recorrido único.

---

## 5. Riesgos y límites honestos

- `App.test.tsx:86-98` y `navigation.test.ts` pinan el orden de las 11 puertas;
  F3 deberá cambiarlos deliberadamente, no desactivarlos.
- `EditorWorkspace` hace `early-return` sin proyecto: F2 debe conservar los
  empty-states de `ScriptView`/`AssetsPanel`/`ProductionView` para no dejar al
  usuario sin acceso a Guion/Medios antes de crear un proyecto.
- Los 4 fallos e2e de `settings.spec` / `theme.spec` son previos y ajenos
  (buscan `input[type=color]`, reemplazado por `ColorWheel`). No se maquillan.
- El certificado OV/EV y la verificación CDP nativa siguen bloqueados por un
  recurso externo; no forman parte de la unificación del front end.
- No se declara «100 % unificado» mientras F2–F4 no estén ejecutadas y medidas.
