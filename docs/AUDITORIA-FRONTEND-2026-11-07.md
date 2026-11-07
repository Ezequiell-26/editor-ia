# AUDITORÍA DEL FRONT END · editor-ia (Olyvia)

Fecha: 2026-11-07. Ámbito: **sólo `apps/desktop/src`** (front end).
Modo: objetivo (goal mode) — cada conclusión tiene métrica y cada fase tiene
criterio de aceptación medible. Estado del trabajo previo: el panel de
propiedades derecho (capturas 118/127) ya está reconstruido y validado; esto
es el análisis del resto de la app y el prompt para reestructurar sin
duplicados.

> Todas las cifras de abajo fueron medidas en este repo el 2026-11-07, no son
> estimaciones.

---

## 1. Resumen ejecutivo

El front end **funciona** pero está **inflado y duplicado**. Los problemas que
realmente lastiman la usabilidad y el mantenimiento son, por orden de impacto:

1. **13 hojas de tema alternativas importadas en `main.tsx`** que duplican o
   redefinen estilos sin usarse (premium/*, panda, olyvia, flat,
   linear-inspired, dopamine-ux, resolve-theme). ~15.000 líneas de CSS muerto
   o competitivo en el bundle.
2. **CSS monolítico y fragmentado a la vez**: `app.css` tiene 13.637 líneas y
   hay 32 archivos CSS (47.008 líneas totales). No hay una sola capa de
   estilos ni tokens compartidos coherentes.
3. **God-components**: `Inspector.tsx` tiene 6.757 líneas; `EditorAssets.tsx`,
   `ExportDialog.tsx`, `Preview.tsx` y `Timeline.tsx` superan con holgura las
   1.500. Un cambio pequeño arriesga regresiones grandes.
4. **Módulos de color con propósito duplicado**: `ColorStudio` (estilo DaVinci)
   y el nuevo `ColorPropertiesPanel` (estilo Filmora, fiel a las capturas)
   compiten. `ColorMaskSections.tsx` ya se **eliminó** (era código muerto con
   estado decorativo). `GradeControlsPanel` sólo lo usa `ColorStudio`.
5. **Navegación y "puertas" dispersas**: varias features se montan como
   diálogos sueltos (`CriticDialog`, `ReviewDialog`, `NewsDialog`,
   `LoginDialog`) sin un registro único; el menú `Ayuda` y la barra superior
   repiten entradas.

No hay **nombres de componentes duplicados exactos** (bueno), así que la
duplicación es de *capas y propósito*, no de archivos gemelos.

---

## 2. Métricas medidas

| Ítem | Valor | Fuente |
| --- | --- | --- |
| Líneas de CSS totales | 47.008 | `find styles -name '*.css' \| wc -l` sumado |
| Archivos CSS | 32 | `find styles -name '*.css'` |
| Temas alternativos importados y no usados | 12 | `main.tsx` + grep de imports |
| `app.css` | 13.637 líneas | `wc -l` |
| `chrome.css` | 4.814 | `wc -l` |
| `filmora.css` | 4.333 | `wc -l` |
| Clases `.app-shell` en todo el CSS | 2.103 | grep de selectores |
| Componentes `.tsx` | 188 | `find features -name '*.tsx'` |
| Carpetas de `features/` | 40 | `ls features` |
| `Inspector.tsx` (mayor) | 6.757 líneas | `wc -l` |
| Color: archivos en `features/color/` | 16 | `ls color` |

### 2.1 Temas alternativos en `main.tsx` — MEDICIÓN CORREGIDA

> **Corrección de la auditoría inicial (honestidad):** la primera lectura dijo
> "12 temas muertos". Eso era FALSO. Se midió solo el `import` en `main.tsx`.
> Al medir el **uso real de clases en el JSX** y leer los comentarios de
> `main.tsx` (líneas 22–45), la realidad es otra: es una **arquitectura de
> capas intencional**, no CSS muerto. La mayoría de esos archivos SÍ se usa.

`main.tsx` carga una capa base de estilos y deja `filmora.css` al final "para
que gane la cascada" (sus reglas usan `!important` para imponerse). Los
entries `premium/workspace` y `premium/views` ni siquiera están aquí: se
cargan por `import()` dinámico en `App.tsx` para que el launcher no pague
~145 KB. Es decir, **ya hay una estrategia de peso de bundle**, solo que los
temas de la capa base se siguen cargando siempre.

Uso real medido (clases definidas vs. usadas en `.tsx`):

| Tema | Clases | Usadas | % | Veredicto |
| --- | --- | --- | --- | --- |
| `panda.css` | 24 | 23 | 96% | **Vivo** (mascote de la vista premium) |
| `olyvia.css` | 96 | 92 | 96% | **Vivo** (tema Olyvia) |
| `premium/launcher.css` | 112 | 111 | 99% | **Vivo** |
| `premium/shell.css` | 34 | 34 | 100% | **Vivo** |
| `premium/components.css` | 83 | 67 | 81% | **Vivo** |
| `flat.css` | 1 | 1 | 100% | **Vivo** (mínimo) |
| `resolve-theme.css` | 11 | 7 | 64% | **Vivo** (parcial) |
| `dopamine-ux.css` | 42 | 21 | 50% | Parcial |
| `premium-animations.css` | 30 | 14 | 47% | Parcial |
| `premium/base.css` | 12 | 6 | 50% | Parcial |
| `linear-inspired.css` | 12 | 0* | 0% | **MUERTO → ya borrado** |
| `premium/tokens.css` | 0 clases | — | — | Tokens internos (usados por otros CSS) |

\* `linear-inspired.css` definía clases de **una letra** (`.a`, `.b`…) de un
experimento "inspirado en Linear"; el 4% que reportó el primer escaneo era un
falso positivo del regex (`.a` coincide con "cualquier char + a" en 240
archivos). Nadie usa `className="a"`. **Se borró** (`git rm`) y su `import` en
`main.tsx` se quitó; typecheck 0 y build 0 confirman que no rompió nada.

**Conclusión corregida:** el problema NO es CSS muerto masivo, sino:
1. **Peso de bundle crítico**: todos los temas de la capa base se cargan
   siempre aunque el usuario sólo use Filmora. `premium/workspace` y
   `premium/views` ya se difieren; los demás no.
2. **Guerras de especificidad**: `.app-shell` aparece 2.103 veces porque cada
   capa lo redefinen con `!important` para ganar. Eso hace el CSS frágil.
3. **La única poda segura ejecutada hoy es `linear-inspired`** (−610 líneas).

### 2.2 God-components (mantenibilidad)

| Archivo | Líneas | Riesgo |
| --- | --- | --- |
| `features/editor/Inspector.tsx` | 6.757 | Altísimo: todas las pestañas, sub-pestañas y secciones viven aquí |
| `features/editor/EditorAssets.tsx` | ~2.400 | Alto: árbol, facetas, grid, drag |
| `features/editor/ExportDialog.tsx` | ~1.900 | Alto: 7 destinos + tarjeta de ajustes |
| `features/editor/Preview.tsx` | ~1.600 | Medio |
| `features/editor/Timeline.tsx` | ~3.200 | Altísimo: cabeza, pistas, clips, zoom, ripple |

### 2.3 Duplicación de propósito en color

- `ColorStudio.tsx` (estudio DaVinci) monta `GradeControlsPanel`,
  `GradeCurves`, `GradeNodes`. No se parece a las capturas 118/127.
- `ColorPropertiesPanel.tsx` (nuevo, Filmora) es fiel a las capturas y es la
  fuente de verdad ahora. `ColorStudio` queda como "Estudio avanzado" dentro de
  él, pero sigue siendo un módulo paralelo que mantiene su propia UI.
- `color-engine.ts` es el **único** motor real (proyecta al visor y al
  export). `ColorMaskSections.tsx` (ya borrado) tenía estado local decorativo
  que **no** llegaba al proyecto: eso es el patrón a erradicar en toda la app.

---

## 3. Inventario de qué está MAL (priorizado)

### P0 — Bloquea la usabilidad o corrompe datos
- **Estado decorativo no persistente**: cualquier panel que guarde valores en
  `useState` local en vez de en `ClipEffects`/`project`. Ya se corrigió en
  color; queda auditar `EffectStudio`, `AudioEffectStack`, `InspectorSection`.
- **Pérdida de selección al interactuar** (bug que encontré y corregí en el
  panel): el inspector medía 697 px dentro de 405 px y la timeline tapaba los
  controles. Mismo patrón puede existir en otros paneles con grid compartido.

### P1 — Duplicación y peso
- Los 12 temas alternativos en `main.tsx`.
- `app.css` monolítico: dividir por dominio o migrar a CSS modules por componente.
- `ColorStudio` vs `ColorPropertiesPanel`: elegir uno como fuente de verdad.

### P2 — Mantenibilidad
- `Inspector.tsx` de 6.757 líneas: extraer cada pestaña a su propio archivo
  bajo `features/editor/properties/<Tab>.tsx` (ya existe esa carpeta para
  color).
- Registro único de diálogos/modales en vez de `setModal` con string union que
  crece en `MenuBar`.

### P3 — Consistencia de UX
- Tokens de color: `filmora.css` define `--fm2-*`, pero `app.css`/`chrome.css`
  usan otra nomenclatura. Unificar en `tokens.css`.
- Decimales: las capturas usan coma (`0,70`). El panel ya lo hace; revisar el
  resto de inputs numéricos.

---

## 4. Lo que ya está BIEN (no tocar)

- `color-engine.ts` + `ClipEffects.colorGrade`: única fuente de verdad de
  corrección de color, proyecta al visor (filtro SVG/`sepia`) y al export.
- `useClipGrade.ts`: hook único de lectura/escritura del grade del clip.
- El nuevo `ColorPropertiesPanel` y sus controles
  (`FilmoraWheel`, `PropertySlider`) ya pasan 7/7 tests y el build.
- La verificación visual (Playwright contra el preview build) ya funciona como
  gate de aceptación.

---

## 5. PROMPT MAESTRO · Reestructuración sin duplicados (ejecutable)

> Pegá **este bloque completo** en un agente con acceso de lectura/escritura al
> workspace `D:\Users\ofici\QODER-WORK\editor-ia`. El agente debe **ejecutar y
> verificar**, no entregar un plan. Si tiene modo objetivo, activalo: el
> trabajo se cierra por métricas, no por "compila".

---

### 5.1 Objetivo

Reestructurá el front end de `apps/desktop` para que:

1. **Una sola fuente de verdad** por concepto: un color → un token; un control
   → un componente; una vista → un archivo; una regla de negocio → un módulo.
2. **Una sola capa de estilos**: eliminar los temas alternativos siempre
   activos; si se quieren themes, que sean seleccionables por configuración,
   no CSS importado en `main.tsx`.
3. **Fácil de usar para el desarrollador**: encontrar dónde vive algo en < 30 s,
   archivos < 800 líneas, sin guerras de especificidad CSS.
4. **Cero pérdida de funcionalidad**: lógica, navegación, atajos, IPC/Tauri,
   MCP, IA, import/export y persistencia quedan intactos.

No agregues pantallas, no cambies la identidad (Olyvia/Filmora-like), no
toques Rust/servicios, no deshagas el trabajo no confirmado del usuario
(ver §5.6).

### 5.2 Descubrimiento (medir antes de tocar)

1. `grep -rn "import .*\.css" apps/desktop/src` → lista de CSS realmente
   importados. Cruzá con los 32 archivos de `styles/` para hallar los muertos.
2. `wc -l apps/desktop/src/features/**/*.tsx | sort -rn | head -20` →
   god-components.
3. `grep -rln "useState" apps/desktop/src/features/editor` + revisión manual de
   cada panel: ¿el estado llega al proyecto o se queda local decorativo?
4. Build de referencia: `npm run build` y `npm run typecheck` deben quedar en 0
   errores al final de cada fase.

### 5.3 Fases (cada una con su gate medible)

**Fase 1 — Podar temas muertos (P1)**
- Objetivo: `main.tsx` importa sólo `tokens.css`, `app.css` (o su reemplazo),
  `filmora.css` y los CSS de componentes que se usan.
- Acción: para cada uno de los 12 temas alternativos, confirmar que ningún
  selector se usa en el DOM renderizado (Playwright `getComputedStyle` sobre
  una sesión típica); si no se usa, eliminar el `import`. Si se usa parcialmente,
  migrar los selectores vivos a `filmora.css` y borrar el archivo.
- Gate: `grep -c "styles/premium\|panda\|olyvia\|flat\|linear-inspired\|dopamine\|resolve-theme" apps/desktop/src/**/*.ts*` == 0; build 0; bundle CSS reduce en > 10.000 líneas.

**Fase 2 — Una capa de estilos (P1/P3)**
- Objetivo: unificar tokens en `styles/tokens.css` (`--fm2-*`); que `app.css` y
  `chrome.css` dejen de definir colores a mano.
- Acción: mover selectores de `app.css` a CSS Modules por componente o a
  `filmora.css` segmentado por sección. Prohibir `!important` salvo excepción
  documentada.
- Gate: sin regresión visual (Playwright diff de 5 vistas clave); typecheck 0;
  `grep -c "!important" styles/**/*.css` no aumenta.

**Fase 3 — Desmembrar god-components (P2)**
- Objetivo: `Inspector.tsx` < 800 líneas; cada pestaña en
  `features/editor/properties/<Tab>.tsx`.
- Acción: ya existe `features/editor/properties/` para color. Mover
  `AudioEffectStack`, `EffectStudio`, `MarkersPanel`, `ScopesPanel`,
  `ProxyToolsPanel`, `ExportDialog` a su propia carpeta con CSS propio.
- Gate: `wc -l` de cada archivo movido < 800; los mismos tests pasan;
  `npm run test:serial` sin nuevas regresiones.

**Fase 4 — Registro único de diálogos (P2)**
- Objetivo: un `dialogRegistry` (mapa `id → componente`) en vez de la unión de
  strings de `MenuBar`.
- Acción: `CriticDialog`, `ReviewDialog`, `NewsDialog`, `LoginDialog`,
  `ExportDialog`, `SettingsWindow` se registran en un módulo; `MenuBar` sólo
  despacha `id`.
- Gate: `MenuBar.tsx` < 400 líneas; todos los diálogos abren igual; tests OK.

**Fase 5 — Eliminar estado decorativo (P0)**
- Objetivo: cero paneles con `useState` que no persiste en el proyecto.
- Acción: auditar `EffectStudio`, `AudioEffectStack`, `InspectorSection`;
  cualquier valor visible que deba sobrevivir se mueve a `ClipEffects` o
  `project` vía `store.update`.
- Gate: búsqueda manual + test que edita y recarga confirmando persistencia.

**Fase 6 — Consistencia numérica y de UX (P3)**
- Objetivo: inputs numéricos usan coma decimal (`0,70`) en todo el editor;
  misma familia de sliders (reusar `PropertySlider` de `properties/`).
- Gate: greps de patrones de punto decimal en labels visibles == 0; build 0.

### 5.4 Criterios de aceptación globales

- `npm run typecheck` == 0.
- `npm run build` == 0.
- `npm run test:serial` == resultados previos documentados, **0 regresiones
  nuevas** (los 13 fallos preexistentes de `EffectStudio`/`AudioEffectStack`/
  `AssetsPanel`/`App` siguen permitidos y marcados como *previos*).
- `npm run test:e2e` == 19 passed / 1 skipped / 4 failed (los 4 de siempre por
  `input[type=color]`/`.hue-slider`).
- Verificación visual Playwright: 0 errores de consola, `pageOverflow == 0`
  en las 5 vistas clave, selección de clip se mantiene al editar.
- Reducción de CSS total > 10.000 líneas y de god-components > 3.

### 5.5 Honestidad y límites

- No digas "sin duplicados" si queda un token, un control o una vista
  repetida: reportá el número exacto.
- No marques fase verde si sus tests fallan; distinguí *fallo previo* de
  *regresión nueva* con el nombre del test.
- No toques Rust, servicios ni identidad visual.
- Si una fase toca trabajo no confirmado del usuario (ver §5.6), **pará y
  preguntá**.

### 5.6 Trabajo no confirmado del usuario — NO tocar sin preguntar

El repo tiene cambios sin commit del usuario (Rust `render_queue.rs`,
`assistant/`, `mcp/`, `settings/PluginsCard`, `vfx/EffectStudio`,
`AudioEffectStack`, `FlowQueueProvider`, entre otros) y cambios de mis propias
sesiones previas (panel de propiedades, facetas de módulos). Antes de borrar o
mover cualquier archivo de esa lista, confirmá con el usuario. El objetivo es
reestructurar, no deshacer trabajo ajeno.

---

## 6. Siguiente paso sugerido (modo goal)

Meta inmediata medible: **Fase 1 (podar los 12 temas muertos)** reduciendo el
CSS en > 10.000 líneas sin regresión visual. Es la ganancia más grande con el
menor riesgo. Una vez verde, pasar a Fase 3 (desmembrar `Inspector.tsx`).
