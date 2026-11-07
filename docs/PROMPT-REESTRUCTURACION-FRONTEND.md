# PROMPT MAESTRO · Reestructuración del front end de Olyvia (sin duplicados)

Fecha: 2026-11-06. Ámbito: **sólo el front end** de `apps/desktop`.
Estado: prompt ejecutable, autocontenido. No modifica código por sí mismo.

> Cómo usarlo: pegá este documento **completo** en un agente con acceso de
> lectura/escritura al workspace `D:\Users\ofici\QODER-WORK\editor-ia`.
> El agente debe **ejecutar y verificar**, no describir ni entregar un plan.
> Si el agente tiene un modo objetivo/bucle, activalo: el trabajo se cierra
> por criterios medidos, no por "compila".

---

# 1. Objetivo

Reestructurá el front end de Olyvia para que:

1. **No haya duplicados**: cada concepto (un color, un control, una vista, una
   regla de negocio) tenga **una sola fuente de verdad**.
2. **Sea fácil de usar**, en los dos sentidos:
   - Para el **usuario final**: un único mapa mental, una sola puerta por
     función, nombres sin colisiones, una sola guía de aprendizaje.
   - Para el **desarrollador**: encontrar dónde vive algo en < 30 s, archivos
     de tamaño razonable, una sola capa de estilos, sin guerras de
     especificidad.
3. **No se pierda ni una funcionalidad**: lógica, estados, navegación, atajos,
   IPC/Tauri, MCP, IA, importación/exportación y persistencia quedan intactos.

No agregues pantallas, no cambies la identidad del producto (Olyvia), no
reescribas el backend. Esto es **cirugía estructural**, no rediseño visual.

---

# 2. Repo y stack (verificado)

- Workspace: `D:\Users\ofici\QODER-WORK\editor-ia`, branch `main`.
- App: `apps/desktop` · Tauri 2 + React 19 + TypeScript + Vite 5.
- Store único: `useProjectStore()` (`state/project-store.tsx`) montado en
  `App.tsx`; **todas las vistas ya comparten ese store**. No crees otro.
- Rust/FFmpeg: `apps/desktop/src-tauri/`. **No se toca** salvo necesidad
  técnica demostrable y documentada.
- Comandos de verificación: ver §9. Respetá el workaround del build.

---

# 3. Estado de partida MEDIDO (2026-11-06, no inferido)

| Métrica | Valor |
| --- | --- |
| Hojas CSS en `apps/desktop/src` | **35** · **47.337 líneas** |
| `!important` en CSS | **4.666** (`filmora/filmora.css` 2.590, `filmora-states.css` 369, `premium/components.css` 198, `commercial.css` 190) |
| Design systems simultáneos en `main.tsx` | **9** (resolve, flat, olyvia, commercial, linear-inspired, dopamine-ux, chrome, premium, filmora) |
| Archivos `.ts/.tsx` | **486** · **142.137 líneas** · **13 archivos > 1.500 líneas** |
| Mayores | `Inspector.tsx` 6.756 · `project-actions.ts` 4.622 · `project-service.ts` 4.437 · `DownloadView.tsx` 4.356 · `Timeline.tsx` 3.104 |
| `app.css` | **13.637 líneas** (28,8 % de todo el CSS) |
| Implementaciones de tabs / empty-state / slider | **19 / 54 / 23**; un único `HubTabs.tsx` compartido |
| Componentes demo con **0** referencias | **8** |
| Registros de navegación | **3**: `app/navigation.ts` (33 `ViewId`), `app/workspace-map.ts` (los mismos 33 reagrupados), `app/workspaces.ts` (muerto, 0 imports) |
| Dominio `auto-edit` | **2 implementaciones distintas**: `state/auto-edit.ts` 586 + `features/autoedit/auto-edit.ts` 645, con 2 tests homónimos |
| Fuentes de verdad de color | **5**: `state/theme-palette.ts`, `state/appearance.ts`, `styles/tokens.css` (126 props), `styles/premium/tokens.css` (265), `styles/filmora/filmora.css` (213) |
| Pares de tests duplicados | `auto-edit.test.ts`, `markers.test.ts`, `motion.test.ts`, `perspective.test.ts` |
| `any` en producción | 3 (buen punto de partida: no lo degradés) |
| `memo(` en todo el front end | **6** usos; `Inspector.tsx` y `DownloadView.tsx` tienen 0 `useMemo`/`useCallback` |
| Trabajo no confirmado en el árbol | **59 archivos** (`git status --short`) |

**Línea base medida el 2026-11-06** (no uses los logs de 2026-11-05 ni las
cifras de la memoria de sesiones anteriores: el árbol cambió):

| Verificación | Resultado real |
| --- | --- |
| `npm run typecheck` | **0** |
| `npm run test:serial` | 236 archivos · **1 fallo real** (`ProjectHome.test.tsx`); 8 fallos adicionales de la primera corrida fueron un error de sintaxis transitorio en `state/mcp-catalog.ts:615` (backticks dentro de una template literal), **corregido por edición concurrente** a las 12:30 y verificado con re-ejecución 8/9 |
| Fallo persistente | `ProjectHome.test.tsx` → `Unable to find ... button ... /Mi obra/i`: test desfasado tras F1/F2, que ahora entran directo al editor con el modo «Todo» activo |
| `npx vite build --emptyOutDir=false` | **0** (14,28 s; único aviso: chunks > 300 kB). Log `goal-build-baseline.log` |
| `npm run test:e2e` | **19 passed / 1 skipped / 4 failed**. Los 4 son los previos y ya documentados: `settings.spec.ts:27` (`.hue-slider`) y `theme.spec.ts:695/732/806` (`input[type=color]`), reemplazados por `ColorWheel`/`ColorSwatch`. **0 regresiones nuevas.** Log `goal-e2e-baseline.log` |

> Lección metodológica: hubo **edición concurrente del usuario** durante la
> medición. Antes de declarar una regresión, comprobá el `mtime` del archivo y
> re-ejecutá las suites afectadas. `typecheck` dio 0 mientras `esbuild`
> fallaba: no son equivalentes, medí ambos.

---

# 4. Diagnóstico: qué está mal

1. **Nueve capas de diseño conviviendo.** `main.tsx:5-42` importa 23 hojas;
   todas se autodeclaran "final" o "reemplaza a". `resolve-theme.css:20-31`
   documenta cuatro "olas" de neutralización parcial en lugar de eliminar lo
   viejo. Resultado: para cambiar un color hay que adivinar cuál de las 9 gana.
2. **Guerra de especificidad.** 4.666 `!important` y 67 marcadores `!impasse:`.
   `filmora/filmora.css` vence a las capas legacy con `!important` de igual
   especificidad, y los `entries/*.css` se cargan **después** por
   `import()` dinámico, así que el orden real de la cascada es el inverso del
   que sugieren los comentarios. Es frágil e imposible de razonar.
3. **Tres vocabularios de tokens.** `--shadow-pop` aparece en 4 archivos;
   `--tl-ruler-h` en 4; `premium/tokens.css` mantiene `--premium-*` y sus
   propios alias de compatibilidad. `tokens.css` cede la verdad a
   `theme-palette.ts`, pero `commercial.css` y `olyvia.css` vuelven a
   declarar los alias como "fallback".
4. **Dos registros de vistas.** `app/workspace-map.ts` reagrupa los mismos 33
   `ViewId` de `app/navigation.ts` y se autoproclama "única fuente de verdad",
   cuando la fuente real de rutas es `app/view-routing.ts`. `app/workspaces.ts`
   está muerto pero sigue con su test. Tres sitios que hay que sincronizar a
   mano para agregar una vista.
5. **Dos motores de auto-edición** con nombres y tests homónimos, lógica
   distinta y consumidores distintos (ProductionView/orchestrator por un lado,
   AI Director/AutoEditView por el otro): 1.231 líneas de lógica + 1.038 de
   tests para un solo dominio.
6. **Primitivas de UI reimplementadas 19/54/23 veces.** `OptionField` es
   **idéntico** (`diff` sin diferencias) en `SilenceCutsSection.tsx:46` y
   `SpeechCutsSection.tsx:45`. `EmptyStateEnhanced` está compartido pero
   huérfano. Hay 17 `*Card`, 10 `*Dialog/*Modal`, 3 editores de curva.
7. **8 demos con 0 imports** y un import roto: `ButtonDemo.tsx:1` importa
   `./styles.css`, que no existe. ~149 estilos inline en esos demos.
8. **Archivos monumentales que mezclan lógica y presentación.**
   `Inspector.tsx` (6.756) sin memoización; `App.tsx` (1.098) concentra
   navegación, atajos, búsqueda, carga de CSS, IPC y maximizado;
   `EditorWorkspace.tsx` recibe **10 props** desde `App.tsx:216-236`.
9. **285 `style={{}}`** inline, con `MarkersPanel.tsx:31-149` y
   `CurveEditor.tsx:32-52` definiendo reglas de componente en JS.
10. **IPC bien centralizado pero con nombres duplicados TS↔Rust.**
    Sólo 2 `invoke()` directos (uno suelto en `App.tsx:996` que esquiva el
    servicio). `PROJECT_COMMANDS` mantiene **194** strings a mano frente a
    **200** registros `commands::` en `src-tauri/src/lib.rs`.
11. **Build y tests redundantes.** `test` y `test:serial` hacen lo mismo; el
    `typecheck` raíz (4 `tsc`) duplica el de `apps/desktop`; hay 4 `dist/`
    con significados distintos; `playwright.config.ts` corre contra Vite dev,
    no contra el bundle de producción.
12. **Deuda de tests honesta, no oculta.** Los 4 specs e2e desfasados buscan
    `input[type=color]` y `.hue-slider`, reemplazados por `ColorWheel`/
    `ColorSwatch`. Hay aserciones de UI vieja en `App.test.tsx`, 3 tests para
    un solo `ProjectHome`, y `ProjectHome.test.tsx` hoy **falla** buscando el
    botón «Mi obra» que la unificación F1/F2 eliminó. Actualizar el contrato
    en el mismo cambio, nunca con `skip`.
13. **Contrato dudoso heredado sin decisión de producto.** `OptionField`
    confirma `0` al vaciar el campo (`Number('') === 0`) en lugar de restaurar
    el valor vigente. Estaba duplicado en dos secciones; al extraerlo a
    `components/ui/OptionField.tsx` se conservó tal cual y se fijó con un test
    de regresión. Corregirlo es una decisión de UX separada, no una limpieza
    estructural.

**Lo que NO está roto** (no lo refactorices): el store único, el despachador
IPC tipado `DesktopService` (~200 métodos, 0 strings sueltos en los call
sites), la normalización de rutas `resolveViewRoute`, y la baja presencia de
`any`.

---

# 5. Arquitectura objetivo

```
apps/desktop/src/
  app/            navigation.ts  ← ÚNICO registro de ViewId
                  view-routing.ts ← ÚNICA resolución de rutas/modos
                  workspace-map.ts ← DERIVA de los dos anteriores, sin copias
  components/ui/  Button · Field · Slider · Tabs · Card · Dialog ·
                  EmptyState · ColorPicker · Icon   ← primitivas compartidas
  features/       una carpeta por dominio; presentación separada de lógica
  state/          un módulo por dominio (project/, appearance/, auto-edit/)
  services/       DesktopService: ÚNICA frontera IPC
  styles/
    tokens.css    ← ÚNICO conjunto de custom properties (emitido por TS)
    base.css      ← reset + tipografía
    components/   ← una hoja por primitiva
    features/     ← una hoja por dominio
    filmora.css   ← ÚNICA piel activa (renombrar a theme.css al estabilizar)
```

**Tabla de fuente única** (cada fila debe terminar con un solo archivo):

| Concepto | Fuente única | Deben desaparecer |
| --- | --- | --- |
| Paleta y tokens | `state/theme-palette.ts` → `styles/tokens.css` | espejos en `appearance.ts`, `premium/tokens.css`, `commercial.css`, `olyvia.css`, `filmora.css` |
| Piel visual | `styles/filmora/filmora.css` (+ `filmora-states.css` fusionado) | 8 capas legacy de `main.tsx` |
| `ViewId` y orden del rail | `app/navigation.ts` | `app/workspaces.ts`, copias en `workspace-map.ts` |
| Resolución de rutas | `app/view-routing.ts` | cualquier `switch` paralelo |
| Guía/aprendizaje | `components/WorkspaceGuide.tsx` | `PipelineGuide`, hints del editor, tour paralelo |
| Auto-edición | un solo `state/auto-edit/` | el otro `auto-edit.ts` y su test homónimo |
| Controles | `components/ui/` | 19 tabs / 54 empty-states / 23 sliders locales |
| Comandos IPC | registro Rust → generar `PROJECT_COMMANDS` | strings mantenidos a mano y `App.tsx:996` |

**Orden de cascada**: reemplazá la fuerza por `@layer` explícito
(`tokens, base, components, features, theme`) declarado una sola vez en
`main.tsx`. Objetivo: **0 `!important` salvo excepciones documentadas y
contadas**, y que los `import()` dinámicos no alteren la precedencia.

---

# 6. Reglas inviolables

1. **`git status --short --branch` al inicio.** Hay 59 archivos con trabajo no
   confirmado del usuario (incluye `App.tsx`, `Timeline.tsx`,
   `EditorWorkspace.tsx`, `theme-palette.ts`, `filmora.css`, Rust y tests).
   **Preservalos todos.** Si una fase exige tocarlos, documentá el solapamiento
   y pedí confirmación antes de escribir.
2. **Prohibido**: `commit`, `push`, `reset --hard`, `git clean`, borrar archivos
   del usuario, sobrescribir trabajo previo, instalar la app en uso, cambiar
   firma/licencia, tocar `scripts/ai-voice-isolation/demucs-wrapper.py`.
3. **Cero funcionalidad perdida.** Nada de backend simulado, botones
   decorativos ni éxitos falsos. Lo que no existe va `disabled` + motivo.
4. **Cero tests maquillados.** No desactives, no `skip`, no relajes
   aserciones para que pasen. Si la UX cambió, actualizá el test **en el mismo
   cambio**, con evidencia y explicando el contrato nuevo.
5. **No cambies el aspecto visible** salvo que sea una corrección inducida
   por la deduplicación. Al final, las capturas clave deben ser comparables
   (SSIM o inspección) contra la línea base; cualquier delta visual se lista.
6. **Sin dependencias nuevas** sin proponerlas antes. Extendé `Icon.tsx` y el
   sistema de tokens existente en lugar de instalar librerías.
7. **Rust/FFmpeg/services**: intactos. La generación de `PROJECT_COMMANDS`
   es opcional (F6) y debe ser un script, no un cambio de backend.
8. **Un cambio por fase, con verificación completa entre fases.** Si algo
   falla, corregí y repetí; no avances con rojo.

---

# 7. Plan por fases (ordenadas por riesgo, no por importancia)

Cada fase termina con su criterio medido y su evidencia.

### F0 · Línea base e inventario (sin tocar código)
Medí typecheck, build, suite serial, e2e, tamaño de bundles y capturas de los
10 estados clave. Guardá los números. Generá `docs/INVENTARIO-DUPLICADOS.md`
con la lista exacta de archivos a eliminar/fusionar y su justificación.
**Criterio**: existe un número de partida para cada métrica de §8.

### F1 · Deduplicación segura (bajo riesgo, alto valor)
- **Ya ejecutado (ciclos 2 y 4 del goal)**: `OptionField` extraído a
  `components/ui/OptionField.tsx` + test de regresión; `speedFactorOf` y
  `clipLabel` (idénticos en las dos secciones de recorte) a
  `features/editor/clip-display.ts` como `clipSpeedFactor` /
  `clipDisplayName`. **−110 líneas** duplicadas, 3/3 tests dirigidos y
  typecheck 0. No lo repitas.
- **Excepción decidida**: las funciones homónimas de `visuals.ts` y
  `state/brain/policies.ts` tienen contratos distintos y NO se unificaron;
  resolver esa colisión de nombres corresponde a F5.
- Extraé el resto de las primitivas obvias a `components/ui/` buscando pares
  idénticos con `diff` antes de migrar.
- Mové `EmptyStateEnhanced` a `components/ui/` y usalo en al menos 3 vistas.
- Eliminá los **8 demos sin referencias** y el import roto de `ButtonDemo`.
- Borrá `app/workspaces.ts` + su test (0 imports de producción).
**Criterio**: 0 referencias rotas, typecheck 0, suite serial sin regresiones,
`diff --stat` acotado a los archivos listados.

### F2 · Un solo conjunto de tokens
- `theme-palette.ts` emite los custom properties; `styles/tokens.css` los
  declara una sola vez como fallback de primera pintura.
- Eliminá los espejos de `appearance.ts` (5 `BASE_FIELDS`),
  `migrateStoredAppearance` y los alias "compatibilidad" de
  `premium/tokens.css`, `commercial.css` y `olyvia.css`.
- Conservá `data-theme` / `data-density` / `data-sidebar` / `data-statusbar` /
  `data-reduce-motion` y el preset «Claro neutro».
**Criterio**: un `grep` de `--color-accent` y `--radius-2` da **una sola
definición**; e2e de tema claro y oscuro en verde; 0 literales hex sueltos en
las capas activas (usar `var(--fm-*)`).

### F3 · Cascada: de fuerza a `@layer`
- Declará el orden de capas en `main.tsx`; migrá progresivamente las reglas
  de `filmora.css` / `filmora-states.css` fuera de `!important`.
- Retirá de `main.tsx` las 8 hojas legacy **sólo después** de verificar con
  capturas que no aportan reglas vivas. Si alguna sigue viva, trasladá esa
  regla a la capa correspondiente antes de borrar.
- Fusioná `filmora.css` + `filmora-states.css` en una sola piel.
**Criterio**: `!important` total < 200 (y cada resto justificado en un
comentario), SSIM ≥ 0,99 en 10 estados contra F0, 0 errores de consola,
`pageOverflow 0`, contraste AA ≥ 4,5:1.

### F4 · Registro único y navegación fácil de usar
- `app/workspace-map.ts` debe **derivar** de `navigation.ts` +
  `view-routing.ts` sin re-enumerar ni un `ViewId` (que su test lo verifique).
- Resolvé las colisiones de nombre («Efectos», «Texto», «Audio») con contexto
  de grupo, no con renombres que rompan contratos, salvo autorización.
- Una sola guía: `WorkspaceGuide`; `PipelineGuide`, los 3 hints del editor
  vacío y el tour paralelo se retiran o delegán en ella.
- Completá F3/F4 de `docs/UNIFICATION-PLAN.md` (puertas únicas en «Más»,
  hubs con retorno) sin repetir F1/F2 ya ejecutadas.
**Criterio**: agregar una vista nueva requiere tocar **1** archivo de
registro; los 33 `ViewId` aparecen exactamente una vez; los tests de
navegación y e2e de rail siguen en verde.

### F5 · Dividir los archivos monumentales
- `Inspector.tsx` (6.756), `DownloadView.tsx` (4.356), `Timeline.tsx` (3.104),
  `AssistantDock.tsx` (2.119), `EditorAssets.tsx` (1.700): extraé
  subcomponentes + hooks de dominio, **sin cambiar props públicas ni
  comportamiento**.
- `state/project-actions.ts` + `state/project-store.tsx` +
  `services/project-service.ts` (9.898 líneas): unificá `CreateProjectRequest`
  / `CreateProjectInput` y dejá `parseProject` en **una sola frontera**.
- Unificá los dos `auto-edit.ts` en un solo módulo; conservá ambos
  consumidores adaptando imports, y colapsá los tests homónimos.
- Reemplazá las 10 props de `EditorWorkspace` por un contexto de navegación.
- Agregá `memo`/`useMemo` donde la medición lo justifique, no por costumbre.
**Criterio**: ningún archivo de producción > 1.500 líneas salvo excepción
documentada; 0 cambios de comportamiento detectados por la suite.

### F6 · Higiene de build, tests e IPC
- Un solo script `test` y un solo `typecheck`; renombrá el `dist/` raíz a
  `artifacts/` si no rompe `scripts/package-extension.ps1`.
- Colapsá los 4 pares de tests duplicados y los 3 `ProjectHome.*`.
- Actualizá **honestamente** los 4 specs e2e desfasados
  (`settings.spec.ts:27`, `theme.spec.ts:695/732/806`) al contrato real de
  `ColorWheel`/`ColorSwatch`, y las aserciones de UI vieja de `App.test.tsx`.
- Opcional: generar `PROJECT_COMMANDS` desde el registro Rust y encaminar
  `App.tsx:996` por `DesktopService`.
**Criterio**: suite serial y e2e **sin fallos**, sin `skip` nuevos, y 0
comandos IPC con strings sueltos.

---

# 8. Criterios de aceptación globales (medibles)

| # | Criterio | Medición |
| --- | --- | --- |
| 1 | Un solo design system activo | 1 piel en `main.tsx`; 8 capas legacy fuera |
| 2 | Guerra de especificidad eliminada | `!important` < 200 (de 4.666) y 0 `!impasse:` |
| 3 | Un solo conjunto de tokens | cada custom property definida 1 vez |
| 4 | Un solo registro de vistas | 33 `ViewId` declarados 1 vez; agregar vista = 1 archivo |
| 5 | Un solo dominio por concepto | 1 `auto-edit`, 1 `CreateProject*`, 1 `parseProject` en la frontera |
| 6 | Primitivas compartidas | `components/ui/` con ≥ 6 primitivas usadas en ≥ 3 features cada una |
| 7 | Código muerto fuera | 0 demos sin referencias, 0 imports rotos, `app/workspaces.ts` eliminado |
| 8 | Archivos mantenibles | 0 archivos de producción > 1.500 líneas sin justificación |
| 9 | Sin regresiones visibles | SSIM ≥ 0,99 en 10 estados; contraste AA 0 fallos; `pageOverflow 0` |
| 10 | Sin regresiones funcionales | typecheck 0 · build 0 · suite serial ≥ línea base · e2e sin fallos nuevos |
| 11 | Trabajo del usuario intacto | `git status` final = inicial + sólo tus archivos; sin commits |
| 12 | Honestidad | toda métrica no alcanzada se reporta con su valor real y su causa |

---

# 9. Verificación obligatoria (ejecutar en cada fase)

```bash
cd D:/Users/ofici/QODER-WORK/editor-ia
git status --short --branch                 # al inicio y al final
npm run typecheck
npm run test:serial                        # dejar log completo
cd apps/desktop
npx vite build --emptyOutDir=false         # NO usar `npm run build`: el guard
                                          # de borrado masivo del sandbox
                                          # bloquea al vaciar dist/assets.
                                          # No es un error de código.
npm run test:e2e
npx vite preview --port 4173 --host 127.0.0.1
```

Capturas y comparación: reutilizá el arnés existente
`.tmp-redesign/filmora/capture-editor.mjs` y `capture.mjs` (inyectan un
proyecto demo válido generado desde `src/test/fake-service.ts` mediante un
puente Tauri simulado; **no es código de producto**). Para SSIM:

```bash
ffmpeg -hide_banner -i A.png -i B.png -lavfi ssim -frames:v 1 -f null - 2>&1 | grep -o "All:[0-9.]*"
```

Contraste y overflow: `.tmp-redesign/recon3/probe-contrast.mjs`,
`icons.mjs` y los `probe*.mjs` existentes.

**Regla**: cada fase registra su evidencia (log + capturas + números) antes de
pasar a la siguiente. No se marca una fase como hecha con rojo.

---

# 10. Entregables

1. Diagnóstico y este prompt, con la línea base medida adjunta.
2. `docs/INVENTARIO-DUPLICADOS.md`: qué se eliminó/fusionó y por qué.
3. Tabla antes/después de las 12 métricas de §8, con comandos reproducibles.
4. Lista de archivos creados, modificados y eliminados; `git status` final.
5. Capturas antes/después de los 10 estados clave + SSIM.
6. Resultado de typecheck / build / serial / e2e **sin omisiones**.
7. Diferencias restantes y trabajo del usuario que no se tocó por seguridad.

---

# 11. Límites y honestidad

- No declares "sin duplicados" si queda un `ViewId`, un token o un control
  repetido: reportá el número exacto de los que quedan.
- No presentes una fase como verde si sus tests fallan, aunque el fallo sea
  "previo": distinguí explícitamente *fallo previo documentado* de
  *regresión nueva*, con el nombre del test.
- No cambies la identidad Olyvia ni agregues marca de terceros.
- Si una fase requiere tocar trabajo no confirmado del usuario, **pará y
  preguntá** en esa fase, sin deshacer lo ya verificado.
- El objetivo es verificable, no retórico: si no se puede medir, no se
  cuenta como logro.

---

# 12. Relación con los planes anteriores (no repetir trabajo)

| Documento | Ya cubierto | No cubierto (objeto de este prompt) |
| --- | --- | --- |
| `docs/UNIFICATION-PLAN.md` | F1: registro `workspace-map`, guía única, loaders muertos, tour/atajos montados | Duplicación de código, CSS, tokens, build |
| `docs/UNIFICACION-TOTAL-PROMPT.md` | Estudio de superficies y contratos de props | Duplicación de código |
| `docs/UI-F2-PROMPT-ANALISIS.md` | F2: 6 vistas embebidas, 15 tabs, menú Avanzado, densidad y contraste | Duplicación de código |
| `docs/IMPROVEMENT-QUEUE.md` | Historial de mejoras y métricas por pasada | Plan estructural |

**F3/F4 de unificación siguen pendientes** y se integran en la F4 de este
prompt. No las reejecutes desde cero: leé esos documentos antes de empezar.
