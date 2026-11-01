# Mejoras de Frontend - Olyvia (Editor IA)
## Fecha: 2026-10-31 (ola 1) + 2026-11-01 (ola 2)
## Objetivo: UI profesional, fácil de usar, optimizada para 1360×768 px

---

## Ola 2 (2026-11-01) — verificada en pantalla

### 1. Franja única del editor (fusiona dos barras)
**Archivos:** `EditorWorkspace.tsx`, `studio.css`

Los modos de edición y el control del layout vivían en DOS filas de 32 px. Ahora
comparten una sola franja de ~34 px (`.editor-top-strip`), devolviéndole 32 px de
alto al visor.

### 2. Columnas compactas reales (migración de preferencias v1 → v2)
**Archivos:** `editor-preferences.ts`, `studio.css`, `resolve-theme.css`

Los cambios de grid de la ola 1 en `app.css` quedaban pisados por:
- `resolve-theme.css` con `320px / 340px !important`
- `studio.css` con `var(--studio-left, 320px)` y `var(--studio-right, 340px)`
- El estilo inline de React, que usa las preferencias guardadas del usuario.

Corrección aplicada en las tres capas:
- Defaults nuevos: **270 / 290 / 268** (medios / inspector / timeline).
- Fallbacks CSS de `studio.css` y `resolve-theme.css` actualizados (incluye los
  breakpoints de 1280, 1080, 900 y 999 px).
- **Migración v1→v2**: si el layout guardado es exactamente el default anterior
  (320/340/285) se migra al compacto; si el usuario lo personalizó, se respeta.
  Test: `editor-preferences.test.ts` (migra + respeta).

### 3. Fondo del timeline hasta el borde
**Archivo:** `app.css` (`.timeline-surface`)

El área más allá del final del proyecto caía en negro puro. Ahora conserva el
tono de pista y la grilla de 120 px, como en CapCut/Resolve.

### 4. Topbar responsive (sin superposiciones)
**Archivo:** `commercial.css`

En ≤1150 px se ocultan el nombre/estado del proyecto (ya viven en la barra de
estado) y los rótulos del buscador; en ≤980 px se ocultan Tutorial/Ajustes del
topbar y el texto de Exportar. Antes los menús se encimaban sobre el proyecto.

### 5. Inicio: ruta de producción en 3×2
**Archivo:** `home.css`

Los seis pasos de `PipelineGuide` pasan de una columna (≈600 px de alto, con
scroll) a un grid de 3 columnas × 2 filas en ≥1080 px. Ahora los seis pasos se
ven de un vistazo, con el paso actual destacado.

### 6. Inicio: hero equilibrado
**Archivo:** `home.css`

- El contador "n/4 herramientas listas" se movió a la columna de acciones
  (antes flotaba en el centro con un hueco a la izquierda).
- Padding 20/22 → 16/20 y gap 12 → 10: hero más compacto.

### 7. Rail de medios a 270 px
**Archivo:** `resolve-theme.css`

Tabs de 9,5 px con padding 6/6 y degradado de scroll a la derecha: con el rail
compacto se ven cinco categorías y queda claro que hay más.

### 8. Selector de formato sin duplicado
**Archivo:** `Preview.tsx`

Mostraba "16:9 (16:9)"; ahora el `<select>` lista "16:9 horizontal",
"9:16 vertical", "1:1 cuadrado", etc. (`preset.label`).

---

## Ola 1 (2026-10-31)

1. **Navegación unificada** — se eliminó `topbar-workspaces` (Ingesta/Crear/Studio)
   duplicado del topbar; el MenBar queda como único origen de navegación.
2. **Aspect-fit del canvas** — el video escala al espacio disponible sin deformar.
3. **Sticky headers** — `.rail-head` e `.inspector-head` quedan fijos al hacer
   scroll en paneles largos.
4. **Timeline full-width** — `.timeline-panel`/`.ruler-row` con `flex: 1`.
5. **HUD debajo del video** — los chips de metadata ya no tapan la escena.
6. **Grid 890 px** — 270/290 columnas, gap y padding de 5 px.

---

## Verificación

- `tsc --noEmit`: limpio.
- `vitest run src/features/editor`: **195/195**.
- `vitest run src/State` + `studio-layout`: **14/14** (incluye migración v1→v2).
- Suite completa: **1351/1352**; el único fallo (`App.test.tsx`) fue un timeout
  por correr 204 archivos en paralelo con el build de Rust activo; aislado pasa
  **71/71**.
- Capturas verificadas en navegador (1360×720, `?view=home`, `settings`,
  `download`, `creator`) y en la app Tauri (editor).

## Cómo validar en la app instalada

1. Abrir Olyvia; el editor debe mostrar **una sola franja** superior.
2. Medios ≈270 px, Inspector ≈290 px, timeline ≈268 px; el visor gana ~32 px.
3. En Inicio, los seis pasos de la ruta se ven sin scroll.
4. Con la ventana en 900 px, el topbar ya no superpone texto.

## Pendiente / próximos frentes

- Botón Inicio: al volver a la StartScreen la ventana queda 900×580 y no
  redimensionable hasta entrar de nuevo (bug de estado a corregir).
- `DownloadView.tsx` (4.438 líneas): dividir en subcomponentes.
- Tests E2E de resize/focus del Studio.
