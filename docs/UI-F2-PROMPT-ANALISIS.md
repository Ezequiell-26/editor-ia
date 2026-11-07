# Front end completo · prompt, análisis y mejora (iteración F2)

Fecha: 2026-11-06. Alcance: `apps/desktop` (Tauri 2 + React 19 + TypeScript + Vite).
Documento de trabajo: contiene el prompt ejecutable, el análisis realizado y el
plan de la iteración. No es un informe de cierre; los resultados medidos se
registran en `docs/IMPROVEMENT-QUEUE.md` y en la memoria del proyecto.

---

## 1. Prompt maestro (copiar y pegar)

```
# Objetivo
Seguí mejorando TODA la UI del front end de Olyvia y unificá la app en UN SOLO
editor: cualquier tarea debe poder hacerse sin perder el contexto del proyecto,
la timeline debe seguir visible y la app debe entenderse con un único mapa
mental. No agregues pantallas nuevas: reducí superficies, eliminá puertas
duplicadas y mejorá la coherencia visual con las referencias.

# Entradas visuales (obligatorias)
D:\Users\ofici\Pictures\Screenshots\Captura de pantalla (93…137).png
- 93–128: 36 capturas ya inventariadas e implementadas en
  docs/RECONSTRUCCION-FILMORA-93-128.md. NO repetir ese trabajo.
- 129–137: 9 capturas NUEVAS (1360×768, 9 SHA-256 distintos) que muestran la
  barra de menús, sus desplegables y los diálogos de atajos / renombrar /
  Acerca de. Usarlas como patrón de densidad, agrupación y jerarquía.
- Las capturas son de Wondershare Filmora: son REFERENCIA de patrón visual,
  no marca ni texto a copiar. Olyvia mantiene identidad propia.

# Repo y estado real verificado (leer antes de tocar)
- F1 de unificación YA ejecutada y verificada: app/workspace-map.ts (6 pasos
  canónicos + 4 grupos que cubren 33 ViewId exactamente una vez),
  components/WorkspaceGuide.tsx (único recorrido), tour y atajos montados,
  18 loaders muertos eliminados. Ver docs/UNIFICATION-PLAN.md.
- app/view-routing.ts: resolveViewRoute normaliza 12 hubs a tabs y 6 vistas a
  modos del editor. NO reemplazar: ampliar sin romper sus contratos.
- features/editor/EditorWorkspace.tsx: 9 modos en paneles, .timeline-panel
  SIEMPRE montado; sin proyecto hace early-return con la guía de 6 pasos.
- App.tsx: una sola vista activa, switch con 15 casos, CSS partido en
  entries/{editor,content}.css, precarga en ocioso.
- 6 vistas de flujo siguen siendo pantallas separadas CON proyecto abierto:
  script, assets, production, director, auto-edit, ai-hub. Cada una tiene
  empty-state propio sin proyecto y NINGÚN listener de teclado global.
- Menubar: 6 menús (Archivo, Editar, Ver, Reproducción, Herramientas, Ayuda)
  con separadores, atajos alineados a la derecha, checks y disabled.

# Reglas inviolables
1. Preservar TODO el trabajo no confirmado (git status al inicio). Sin commit,
   push, reset --hard, clean, instalación de la app en uso ni cambios de
   firma/licencia sin autorización explícita.
2. Conservar TODA la funcionalidad real. Nada de botones decorativos, backend
   simulado ni éxitos falsos. Lo que no existe va disabled + motivo.
3. Conservar los contratos de tests/e2e o actualizarlos HONESTAMENTE en el
   mismo cambio. Nunca desactivar ni maquillar una prueba. Contratos pinados:
   las 11 etiquetas del rail en orden, los 9 tabs del rail de medios, los tabs
   'Mezcla'/'Edición'/'Motion'/'Guía' del editor, 'Tutorial' exacto en e2e,
   resolveViewRoute completo y el invariante 33/33 de WORKSPACE_GROUPS.
4. Sin dependencias nuevas. Sin gradientes/glow en botones ni tarjetas;
   transiciones 90–160 ms; prefers-reduced-motion; tema claro y oscuro;
   contraste AA >= 4,5:1; foco visible. Usar tokens --fm-* / --fm2-*.
5. Rendimiento: no agregar trabajo por frame ni CSS/JS al arranque; mantener
   CSS splitting y chunks lazy. Presupuesto: CSS/JS iniciales <= +2 %,
   pageOverflow 0, 0 console errors, 0 pageerror, CLS 0.
6. Una sola fuente de verdad por concepto. Prohibido copiar listas de pasos,
   modos o vistas entre archivos.

# Proceso (3 etapas, en orden)
A) PROMPT: escribir este documento con el objetivo, criterios y análisis.
B) ANALIZAR: inventariar las 45 capturas, comparar patrón visual con el estado
   real del código, medir antes de cambiar y priorizar por impacto/riesgo.
C) MEJORAR: implementar una iteración acotada y verificable; medir después.

# Trabajo de esta iteración (F2 + pulido)
1. Ampliar EditorModeId con 6 modos de flujo y publicar el mapa ViewId <-> modo
   en app/view-routing.ts (funciones editorModeForView / viewForEditorMode).
   resolveViewRoute queda INTACTO para no romper deep links ni workspace-map.
2. App.tsx: con proyecto abierto, esas 6 vistas se montan DENTRO del editor
   (mismo EditorWorkspace, timeline presente). Sin proyecto conservan su
   pantalla standalone con su empty-state real. El rail debe seguir marcando la
   herramienta activa y el shell debe tratarla como superficie de editor
   (immersive, flush, CSS de AMBOS entries).
3. EditorWorkspace: 15 modos agrupados en dos bloques (flujo / herramientas)
   con separador visual, cabecera de contexto "Editor › <modo>" y un acceso
   explícito "Volver a Edición". La timeline nunca se desmonta.
4. AppShell: botón persistente «Volver al editor» cuando hay proyecto y la
   superficie activa no es el editor (cierre del recorrido F4).
5. Menubar: nuevo menú «Avanzado» con acceso real a los modos del editor,
   siguiendo el patrón de agrupación de las capturas 132–137; mantener el orden
   Archivo/Editar/Ver para no romper la navegación por teclado ya probada.
6. WorkspaceGuide compacto: incluir el mapa de 4 grupos para ocupar el espacio
   vacío del modo Guía y reforzar «un mapa para toda la app».

# Criterios de aceptación (medibles)
- Las 6 vistas con proyecto abierto renderizan dentro de .editor-workspace y
  .timeline-panel sigue en el DOM; sin proyecto siguen mostrando su empty-state.
- El rail marca la herramienta activa al navegar Y al cambiar de modo dentro
  del editor; .editor-mode-tabs tiene 15 tabs en 2 grupos con separador.
- Desde cualquier superficie con proyecto hay un acceso visible al editor.
- typecheck 0 · build 0 · suite serial >= 2047 passed / 3 skipped / 0 failed ·
  e2e sin regresiones nuevas (línea base 19/1/4, los 4 previos de
  input[type=color]) · 0 console errors · pageOverflow 0 · contraste AA.
- Sin regresión de bundle > 2 % y sin loaders muertos nuevos.

# Entrega
Informe en español, estructurado, con tabla de hallazgos, archivos tocados,
comandos con resultado exacto, métricas antes/después, deuda honesta y el
siguiente paso concreto. No declarar «100 % unificado» mientras F3/F4 completas
no estén ejecutadas y medidas.
```

---

## 2. Análisis ejecutado

### 2.1 Inventario de las 9 capturas nuevas

| ID | KB | Tamaño | SHA-256 (20) | Contenido |
| --- | --- | --- | --- | --- |
| 129 | 104,5 | 1360×768 | `f7e5531dbcdcf41d5fc7` | Ventana «Atajos de teclado»: teclado visual, buscador de comandos, categorías a la izquierda, tabla Comando/Teclas y panel de detalle. |
| 130 | 135,7 | 1360×768 | `5fe94a83d902b74ebbf8` | Diálogo «Cambiar nombre» sobre el editor: campo con contador 10/50, «Guardar ubicación», Cancelar/Confirmar. |
| 131 | 122,9 | 1360×768 | `2aae1b398af2071c3ba7` | «Acerca de»: marca, versión, texto legal, enlaces y copyright. Modal blanco, botón de cierre arriba a la derecha. |
| 132 | 137,5 | 1360×768 | `9c6b3a2cfd0325fd826e` | Menú Ayuda: grupos separados por reglas, atajos a la derecha, submenús con flecha. |
| 133 | 130,0 | 1360×768 | `d04b2b3d9ef839140e40` | Menú Avanzado: dos entradas de gestores, desplegable angosto. |
| 134 | 140,0 | 1360×768 | `6cfa4d789282ded3ab50` | Menú Ver: reproducción, zoom, zonas seguras, regla/guías, check en «Activar alineación de medios», ítems desactivados en gris. |
| 135 | 131,5 | 1360×768 | `bd8c09a7ad2583241600` | Menú Herramientas: Vídeo/Audio/Color/Velocidad con submenús, División/Recorte, sincronización, edición avanzada de texto. |
| 136 | 111,2 | 1360×768 | `e7526efcb6c0164c11b3` | Menú Editar: Deshacer/Rehacer con atajo, ítems desactivados en gris, separadores, «Cerrar la Brecha». |
| 137 | 93,9 | 1360×768 | `415e3d35a5a61a59fe3d` | Menú Archivo: Nuevo/Abrir/Importar, Guardar/Archivar, Preferencias/Atajos/Salir; atajos alineados a la derecha. |

Las 45 capturas (93–137) son 1360×768. Las 9 nuevas son un **corte transversal
de la barra de menús y los diálogos**, no nuevas pantallas del editor: corrigen
jerarquía y densidad, no la arquitectura de paneles ya reconstruida en 93–128.

### 2.2 Patrones extraídos (y estado en Olyvia)

| Patrón de referencia | Estado actual | Decisión |
| --- | --- | --- |
| Menús nativos: separadores por grupo, atajo a la derecha, disabled en gris, check a la izquierda | Ya implementado en `MenuBar.tsx` (6 menús, `MenuEntry` con separator/shortcut/checked/disabled) | No rehacer. Aumentar densidad mínima del desplegable y sumar el menú «Avanzado» con accesos reales. |
| Orden Archivo · Editar · Herramientas · Ver · Avanzado · Ayuda · Versión | Archivo · Editar · Ver · Reproducción · Herramientas · Ayuda | **No reordenar**: `MenuBar.test.tsx:69-75` prueba que ArrowRight desde Editar abre Ver. Se agrega «Avanzado» antes de Ayuda. |
| Un menú «Avanzado» como puerta de herramientas especializadas | No existe; los modos avanzados están repartidos entre «Más», Herramientas y tabs del editor | Agregar «Avanzado» con los 6 modos del editor + 4 superficies de IA. Acciones reales vía `onSelect`. |
| Diálogo de atajos con buscador, categorías y tabla Comando/Teclas | `ShortcutsCheatSheet.tsx` ya tiene buscador, categorías y tarjetas; se monta una sola vez desde F1 | Mantener. Verificar opacidad/contraste con captura nueva; no reescribir sin evidencia. |
| Modal «Acerca de» con versión y enlaces | Ya existe (`MenuBar.tsx` modal `about`) | Mantener. |
| Editor con UNA barra de módulos y paneles fijos | 9 tabs de modo + rail de 9 módulos + 11 puertas en el sidebar | Unificar: 6 vistas de flujo pasan a modos y el rail marca el modo activo. |

### 2.3 Estado real del código (medido, no inferido)

| Concepto | Evidencia | Diagnóstico |
| --- | --- | --- |
| Registro | `navigation.ts`: 33 `ViewId`, 11 puertas principales, 10 en «Más» | F1 ya eliminó 18 superficies fantasma; quedan puertas duplicadas (F3). |
| Rutas | `view-routing.ts`: 12 alias a hubs + 6 alias a modos | Base correcta. Ampliar con 6 modos de flujo sin alterar `resolveViewRoute`. |
| Editor | `EditorWorkspace.tsx:71-85, 416-558` | 9 modos planos; `.timeline-panel` siempre montado. Con 15 modos la fila se satura → agrupar. |
| Vistas de flujo | `ScriptView`, `AssetsPanel`, `ProductionView`, `DirectorView`, `AutoEditView`, `AiHubView` | Todas reciben sólo `onNavigate`; 5 tienen empty-state sin proyecto; **ninguna registra atajos globales** → no colisionan con `EditorWorkspace.tsx:268-319`. |
| CSS | `premium/workspace.css:239` ya prevé `.editor-mode-panel .view` | La infraestructura visual para embeber vistas existe; falta el cableado. |
| Aprendizaje | `WorkspaceGuide.tsx` | Compacto omite el mapa de 4 grupos → el modo Guía deja ~40 % del panel vacío (captura `01-editor-guia.png`). |
| Retorno | `AppShell.tsx` | Existe «Volver a la pantalla de inicio», pero **no** hay retorno persistente al editor desde hubs. |

### 2.4 Brechas priorizadas

| # | Brecha | Impacto | Riesgo | Acción en esta iteración |
| --- | --- | --- | --- | --- |
| 1 | 6 vistas sacan al usuario del editor con proyecto abierto | Alto: rompe «un solo editor» | Medio: CSS de dos entries, estado del rail | **F2**: embeber como modos, conservar standalone sin proyecto |
| 2 | 15 tabs planos sin jerarquía | Medio: cuesta encontrar herramientas | Bajo | Agrupar flujo/herramientas + cabecera de contexto |
| 3 | Sin retorno persistente al editor | Medio: el usuario queda en un hub | Bajo | Botón en `AppShell` |
| 4 | Modos avanzados sin puerta única desde la barra | Medio | Bajo | Menú «Avanzado» |
| 5 | Guía compacta con espacio muerto | Bajo | Bajo | Mostrar el mapa de 4 grupos también en compacto |
| 6 | Puertas duplicadas y nombres colisionados («Efectos», «Texto», «Audio») | Medio | Alto: `navigation.test.ts` y `App.test.tsx` pinan etiquetas | **F3, diferida** con criterio ya definido en `UNIFICATION-PLAN.md` |

### 2.5 Riesgos y contratos que condicionan el diseño

- `App.test.tsx:617-668` abre un proyecto y navega a Guion / Producción / Medios
  para afirmar contenido real. Embeberlas debe conservar ESE contenido en el DOM.
- `App.test.tsx:356-364` entra por `?view=mixer` **sin** proyecto y espera el
  empty-state del editor: el comportamiento debe seguir dependiendo de si hay
  proyecto abierto.
- `app.spec.ts:21-38` (e2e) cliquea las 11 puertas del rail y exige
  `aria-current="page"`: el rail debe seguir marcando Guion/Medios/Producción
  aunque la superficie sea el editor. Por eso el `activeId` lógico se conserva y
  se añade un indicador `editorSurface` para el shell, en vez de reescribir
  `activeId` a `editor`.
- `MenuBar.test.tsx` fija el orden de los tres primeros menús; `workspace-map.test.ts`
  exige que `WORKSPACE_TOOLS` derive de `resolveViewRoute`. Ambos quedan intactos.

---

## 3. Diseño de la solución

```
app/view-routing.ts
  ├─ resolveViewRoute()          (INTACTO: deep links, workspace-map, contratos)
  ├─ EDITOR_EMBEDDED_VIEWS      (6 ViewId → EditorModeId)  ← única fuente
  ├─ editorModeForView()
  └─ viewForEditorMode()
        │
        ├─ App.tsx              decide: con proyecto → EditorWorkspace(mode)
        │                      sin proyecto → vista standalone (empty-state real)
        │                      activeId lógico + editorSurface para el shell
        ├─ EditorWorkspace      15 modos en 2 grupos, timeline siempre montada,
        │                      onModeChange sincroniza el rail
        ├─ AppShell            immersive por editorSurface + «Volver al editor»
        └─ MenuBar             «Avanzado» usa onSelect → alias ya existentes
```

Decisiones de UX:

1. **El editor es el contenedor, la timeline es el ancla.** Los 6 modos nuevos no
   reemplazan la vista previa ni el inspector: aparecen en `.editor-mode-panel`
   con la timeline debajo, igual que los 9 modos anteriores.
2. **Sin proyecto no se unifica a la fuerza.** Las vistas conservan su
   empty-state («No hay un proyecto abierto») porque antes de crear un proyecto
   no hay timeline que preservar.
3. **Una función, una puerta, un nombre (progresivo).** F2 no renombra etiquetas:
   eso es F3 y requiere actualizar tests y e2e deliberadamente.
4. **Densidad antes que cantidad.** Los 15 tabs se agrupan con un separador y
   padding más corto, en lugar de mostrar etiquetas más largas o varias filas
   (lección medida en la iteración visual anterior: `scrollWidth` 1360 → 1682 px).

---

## 4. Verificación planificada

| Verificación | Criterio |
| --- | --- |
| `npm run typecheck` | 0 errores |
| `npx vite build --emptyOutDir=false` | 0 errores; comparar JS/CSS iniciales con la base 580.128 B / 663.563 B |
| `npm run test:serial` | >= 2047 passed / 3 skipped / 0 failed |
| Tests dirigidos | `view-routing`, `workspace-map`, `App`, `MenuBar`, `WorkspaceGuide` |
| e2e | Sin regresiones nuevas sobre 19/1/4 (4 previos de `input[type=color]`) |
| Arnés visual Playwright | Capturas de los 6 modos embebidos + menú Avanzado + retorno; `pageOverflow 0`, 0 `pageerror`, 0 errores de consola, `.timeline-panel` presente |
| Contraste | 0 textos por debajo de 4,5:1 con `probe-contrast.mjs` |

---

## 5. Resultados medidos de la iteración

| Criterio | Resultado |
| --- | --- |
| 6 vistas embebidas con proyecto | **6/6** en `.editor-workspace`, `.timeline-panel` presente en todas; sin proyecto las 6 conservan su empty-state (verificado en Guion) |
| Modos y agrupación | **15 tabs**, **1 separador**, `tabsOverflow 0` a 1360 px; cabecera de contexto y «Volver a Edición» en todos los modos |
| Rail sincronizado | Guion/Medios/Producción marcan `aria-current="page"`; al cambiar de tab el `activeId` lógico se actualiza |
| Retorno | Botón «Volver al editor» visible en el hub Descargar; al pulsarlo vuelve a Edición con la timeline |
| Guía compacta | 4 grupos visibles; `scrollHeight 489 → 392 px` = `clientHeight` (sin scroll) |
| Contraste AA | **0** textos < 4,5:1 en los 13 estados medidos (antes 2 en Automático y 13 en AI Hub) |
| Errores / desbordes | **0** console errors, **0** pageerror, `pageOverflow 0`, `tabsOverflow 0` |
| typecheck / build | **0 / 0** |
| Suite serial | **2051 passed / 3 skipped / 0 failed** (234 archivos + 1 skip; base 2047, +4 tests nuevos), exit 0 |
| e2e | **19 passed / 1 skipped / 4 failed** (los 4 previos de `input[type=color]`, sin regresiones nuevas) |
| Bundle inicial | JS **581.824 B (+0,29 %)** · CSS **666.960 B (+0,51 %)**, dentro del límite de 2 % |

Evidencia: `.tmp-redesign/unify/f2/` (`shots/results.json`, 13 PNG +
`14-dialogo-aislado.png`, `serial.log`, `e2e.log`, `typecheck.log`,
`build.log`, `f2-capture-final3.log`).

Hallazgo metodológico: las capturas que mostraban «transparencia» en el
diálogo de atajos se tomaron a 350 ms, durante el `fadeIn` de 180 ms de un
chunk lazy (opacidad del backdrop 0,83 medida). El modal es 100 % opaco
(`rgb(27,32,38)`, `opacity 1`); se ajustó el arnés a 900 ms y se quitó el blur
del backdrop por coherencia con el patrón plano, no como falso arreglo.

---

## 6. Deuda honesta (no se declara 100 %)

F3 (puertas únicas y colisiones de nombre), F4 completa (hubs como panel del
editor, paleta y atajos desde el mapa, onboarding único), cotejo 45/45 a
1100/1360/1600, miniaturas reales de biblioteca, nombres de pista visibles,
4 specs e2e desfasados, firma OV/EV y verificación CDP nativa.
