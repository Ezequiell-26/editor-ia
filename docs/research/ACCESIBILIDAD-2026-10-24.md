# Auditoría de accesibilidad · Olyvia (2026-10-24)

**Tarea de origen:** `docs/AUDIT.md` §P4 ítem 14 — «Auditoría de foco/teclado/contraste y
navegación completa sin mouse».
**Alcance:** sólo lectura de código de `apps/desktop/src` (rama `feat/motion-graphics`, el
pedido declara árbol limpio en `ad08a95`; no se ejecutó `git` para verificarlo porque está
prohibido en esta tarea). **Cero cambios de código**: este documento es el único artefacto.
**Método:** revisión manual de los componentes listados abajo + `grep` de conteos +
cálculo de ratios WCAG 2.x de los tokens (script `node -e` de cálculo puro, sin instalar
nada). No se lanzó la app ni se corrió la suite (prohibido), así que todos los hallazgos
son de código, no de comportamiento observado en pantalla.

## Datos de partida verificados hoy

| Métrica | Valor pedido | Medido hoy | Comando |
| --- | --- | --- | --- |
| `aria-label` | 226 | **240** en `*.tsx` | `grep -rc "aria-label" apps/desktop/src --include="*.tsx"` (suma) |
| `role="dialog"` | «diálogos» | **9** archivos | `grep -rn 'role="dialog"' apps/desktop/src --include="*.tsx"` |
| Trampa de foco / `inert` | — | **0** apariciones | `grep -rn "focus-trap\|focusTrap\|inert" apps/desktop/src` |

Los 9 `role="dialog"`: `CommandPalette.tsx:172`, `MenuBar.tsx:531` (Atajos/Acerca de),
`WelcomeDialog.tsx:72`, `SettingsWindow.tsx:89`, `AssistantDock.tsx:338`,
`ExportDialog.tsx:538`, `EmojiPicker.tsx:111`, `StartScreen.tsx:784`,
`AppUpdaterModal.tsx:126`.

---

## Resumen ejecutivo

La app tiene una base ARIA genuina (240 `aria-label`, sliders de playhead/fades con
teclado, paleta de comandos casi ejemplar, menubar con `role="menubar"`), pero falla en
los tres invariantes de una app de escritorio usada sin mouse:

1. **Ningún diálogo modal captura el foco** (`aria-modal="true"` sin trampa) y sólo
   `SettingsWindow` lo devuelve al disparador.
2. **Mover y recortar clips no tiene equivalente de teclado**; las asas de recorte ni
   siquiera son enfocables (`role="separator"` sin `tabIndex`).
3. **La barra espaciadora global roba la activación de todo botón enfocado** mientras hay
   proyecto abierto: el control enfocado no hace su función con Space (sólo con Enter).

En contraste, los tokens base son excelentes (texto 16,6:1 sobre panel) y el problema está
concentrado en `--color-empty`, que queda por debajo de AA en el tema oscuro (4,08:1) y
por debajo incluso del umbral de 3:1 en el tema Resolve (2,95:1), usado además a 6–9 px.

---

## 1 · Diálogos

### H1 — Los modales no capturan el foco y `aria-modal="true"` es falso · **bloqueante**
9 diálogos declaran `aria-modal="true"` (o son modales de facto: `.modal-backdrop`
cubre la pantalla, app.css:5109) pero **ninguno** implementa trampa de foco ni `inert`
en el fondo (grep sin resultados). Con Tab, el foco sale del diálogo y recorre la
interfaz tapada; para un usuario de teclado el orden de tabulación queda roto
(falla WCAG 2.4.3) y el lector de pantalla sigue leyendo el fondo (viola la semántica
prometida por `aria-modal`).
Casos concretos:

- `ExportDialog.tsx:536-546`: sin `autoFocus`, sin foco inicial, sin trampa.
- `AppUpdaterModal.tsx:123-134`: ídem.
- `WelcomeDialog.tsx:70-131`: ídem.
- `StartScreen.tsx:783-796`: ídem.
- `EmojiPicker.tsx:105-119`: ídem (sí mueve el foco a la búsqueda a los 30 ms, líneas
  74-82, pero Tab puede salir del popover).
- `CommandPalette.tsx:169-191`: enfoca el input (78-80) pero sin trampa.
- `MenuBar.tsx:522-547`: los modales Atajos/Acerca de sí tienen `autoFocus` en el botón
  cerrar (543) — el mejor caso junto con Settings — pero sin trampa.

### H2 — Sólo `SettingsWindow` devuelve el foco al cerrar · **medio**
`SettingsWindow.tsx:27-48` es el ejemplo a imitar: guarda `document.activeElement`,
enfoca el botón cerrar (28-29) y lo restaura al desmontar (46). Los demás diálogos
no restauran: al cerrar `ExportDialog`/paleta/menús, el foco cae en `<body>` y el
usuario de teclado pierde su lugar (debe re-tabular desde el principio).

### H3 — `WelcomeDialog` sin Escape ni foco inicial · **medio**
`WelcomeDialog.tsx:70-131`: es el primer modal que ve un usuario nuevo, es modal
(`aria-modal="true"`, línea 72) y no responde a Escape, no mueve el foco al abrir ni
lo restaura al cerrar. Un usuario de teclado aterriza con el foco donde estaba.

### H4 — `AppUpdaterModal` durante descarga: sin salida de teclado visible · **menor**
`AppUpdaterModal.tsx:50-59` bloquea Escape y el click en el fondo mientras
`status === 'downloading'` (correcto semánticamente), pero no hay forma de cancelar
ni escape alternativo; aceptable si la descarga es corta, pero conviene un
`aria-busy`/`role="status"` en el panel de progreso (hoy es texto plano, 250-271).

### H5 — Escape global en conflicto · **medio**
`App.tsx:544-546` trata Escape como «quitar selección» (`edit.deselect`,
`shortcuts.ts:99`) y **no** verifica `event.defaultPrevented` ni si hay un modal
abierto. Resultado: al pulsar Escape dentro de `ExportDialog` se cierra el diálogo
(ExportDialog.tsx:365-374) **y además** se limpia la selección, y en la paleta de
comandos ocurre lo mismo (CommandPalette.tsx:98-101 hace `preventDefault`, pero el
listener de App ya corrió). Hoy no rompe nada visible porque limpiar selección es
inofensivo, pero es una carrera esperando a pasar: cualquier handler futuro de Escape
convivirá mal con el despacho global.

### H6 — Menú contextual de la timeline (positivo con un hueco)
`Timeline.tsx:1699-1856`: `role="menu"`, foco al primer ítem al abrir (671-675),
navegación con ↑/↓/Inicio/Fin con ciclo (1710-1735), Escape cierra (662-666). Hueco:
al cerrar (Escape o click) no se devuelve el foco al clip que lo abrió
(`setContextMenu(null)` en 615, 637, 650…), el foco cae en `body`. **medio**.

### H7 — `AssistantDock` es `role="dialog"` sin `aria-modal` ni Escape · **menor**
`AssistantDock.tsx:338-341`: como panel lateral no modal está bien sin `aria-modal`,
pero no reacciona a Escape (no está en el grep de keydown) y no hay cierre por teclado
más allá de Tab hasta el botón cerrar (349-354, que sí tiene `aria-label`).

---

## 2 · Timeline (`features/editor/Timeline.tsx`)

### Lo que ya funciona (positivos, para no romperlos)
- Cada clip es `role="button"`, `tabIndex={0}`, con `aria-label` con nombre de clip,
  pista y timecode (Timeline.tsx:242-247); Enter/Espacio seleccionan (255-260).
- Cabezal: `role="slider"` enfocable con ←/→ (paso 1, Shift = 10), Home/End y
  `aria-valuemin/max/now` (1670-1695). Hay test que lo cubre
  (`Timeline.test.tsx:143` «permite mover el cabezal con el mouse y el teclado»).
- Fades: asas `role="slider"` con `tabIndex={0}`, ↑/↓ (Shift = ±10) y valores ARIA
  (327-364). Ejemplo local de «drag + teclado» bien resuelto.
- Menú contextual accesible (ver H6).
- Atajos globales: Ctrl+C/Ctrl+V (690-698), Shift+Supr ripple (696-698), M marcador
  (699-701), H mano (702-704); Supr/Borrar y S dividir en `EditorWorkspace.tsx:42-68`;
  ←/→ mueven el playhead con paso configurable (69-77).

### H8 — Mover un clip no tiene equivalente de teclado · **bloqueante**
El movimiento es 100 % puntero: `beginClipDrag` sólo desde `onPointerDown`
(Timeline.tsx:1055-1075) y las asas no exponen alternativa. El `onKeyDown` del clip
(255-260) sólo selecciona. Con el clip seleccionado, ←/→ mueven el **playhead**
(EditorWorkspace.tsx:69-77), no el clip: no hay ninguna secuencia de teclas que
desplace un clip o lo cambie de pista. Operación esencial del editor inaccesible
(WCAG 2.1.1). Las piezas de dominio ya existen (`moveClip`, `magneticMoveClip`,
Timeline.tsx:37-38) — falta el binding.

### H9 — Recortar (trim) no tiene equivalente de teclado · **bloqueante**
Las asas de recorte son `role="separator"` con `aria-label` pero **sin `tabIndex` ni
`onKeyDown`** (Timeline.tsx:303-326): no son enfocables ni operables por teclado.
`trimClip` existe en el dominio (importada en 40) y el drag la usa (993-1008).
Contraste cruel: el fade — menos esencial — sí es un slider de teclado; el trim, no.

### H10 — Los clips no se navegan con flechas · **medio**
No hay roving tabindex ni handler de flechas sobre clips: para pasar del clip 1 al 2
hay que Tab-ular a través de todos los botones intermedios (marcadores, flags de
pista, botones de la barra). El patrón esperable (flechas ←/→ entre clips de una
pista, ↑/↓ entre pistas, con el foco dentro del carril) no existe.

### H11 — Select y búsqueda de la barra funcionan; faltan detalles de etiqueta · **menor**
El filtro de color y tipo de pista están en `<select>` nativos con `aria-label`
(1234-1251, 1277-1289) — accesibles. La búsqueda de clips salta al primer match con
Enter (1261-1274) y anuncia por `setNotice` — correcto.

---

## 3 · Paleta de comandos y menús

### H12 — Paleta de comandos: casi ejemplar, sin anuncio de selección a SR · **medio**
`CommandPalette.tsx`: foco inicial en el input (78-80), Escape (98-101), ↑/↓ cambian
la selección (103-111), Enter ejecuta (113-117), `role="listbox"`/`role="option"`
con `aria-selected` (194, 133-137) y `scrollIntoView` (123-126). Faltan dos cosas:
1. El input no declara `aria-activedescendant`, así que un lector de pantalla no
   anuncia la opción resaltada (la clase `.selected` es visual).
2. Al cerrar, el foco cae en `body` (no vuelve al disparador) — ver H2.

### H13 — MenuBar: ARIA correcto, sin ←/→ entre menús y sin devolución de foco · **medio**
`MenuBar.tsx`: `role="menubar"` (461), disparadores con `aria-haspopup`/`aria-expanded`
(467-468), ↓ abre y enfoca el primer ítem (473-479 → 111-117), ↑/↓/Inicio/Fin con
ciclo dentro del menú (434-457), Escape cierra (435-438 y global 89-92). Faltan:
- ←/→ para saltar entre Archivo/Editar/Ver/… (patrón ARIA menubar); hay que
  Shift+Tab de nuevo al menubar.
- Al cerrar con Escape el foco no vuelve al botón del menú que estaba abierto.
- Los ítems con check no exponen `aria-checked` — el tilde es un `Icon` visual
  (506-508); un lector de pantalla no sabe que «Ver → Barra de estado» está activa.
  **menor**.

### H14 — `ProfileMenu`: `role="menu"` sin navegación de flechas · **medio**
`ProfileMenu.tsx:108` declara `role="menu"` con `role="menuitem"` (186-201) pero el
único manejo de teclado es Escape (31-36); sin ↑/↓, sin foco al primer ítem al abrir.
Declara el rol de menú sin su contrato de teclado.

### H15 — EmojiPicker: popover sin navegación de grilla · **menor**
`EmojiPicker.tsx`: Escape y foco inicial en búsqueda (74-82), pero la grilla de
emojis es Tab-lineal (sin ←/→/↑/↓ por grilla ni roving tabindex).

---

## 4 · Transport (`features/editor/Transport.tsx`)

### Lo que funciona
- `role="group"` con `aria-label="Controles de reproducción"` (68) y todos los
  controles son `<button>` con `aria-label` (70-132).
- Barra de posición: `role="slider"` enfocable, ←/→ mueven 1 frame, valores ARIA
  completos (136-156). El reloj usa `aria-live="off"` (158) — decisión correcta para
  evitar spam de anuncios.
- Espacio (play/pausa) y Escape (deseleccionar) existen como atajos globales
  reasignables (`shortcuts.ts:80-101`, despacho en `App.tsx:463-563`).

### H16 — Espacio global impide activar botones con Space · **bloqueante**
El handler global de `App.tsx:547-551` intercepta Espacio fuera de inputs
(`isTypingTarget`, 471, sólo excluye INPUT/TEXTAREA/SELECT/contenteditable) y hace
`preventDefault()` + toggle. Ese `preventDefault` en keydown **anula el click nativo
de activación por Space del botón enfocado** (el click de Space ocurre en keyup y no
se dispara si el keydown se previene). Consecuencia: con el foco en «Silenciar
pista» (Timeline.tsx:1550-1559), en «Bucle» (Transport.tsx:124-132) o en cualquier
botón de la app, pulsar Espacio **no activa ese control: reproduce/pausa**. Enter sí
funciona, pero Space es el estándar de activación y queda secuestrado. Corrección
mínima: si `event.target` es un botón u elemento interactivo propio, no interceptar.

### H17 — Títulos prometen atajos que no existen (Home/End) · **medio**
`Transport.tsx:74` «Ir al inicio (Home)» y `:110` «Ir al final (End)»: **no hay
handler global de Home/End** (grep: sólo el grip de la timeline los maneja cuando él
mismo tiene el foco, Timeline.tsx:1689-1690, y los acepta `shortcuts.ts:222-223`
como bindables sin usar). Los de ←/→ (83, 102) y S (119) sí existen
(`EditorWorkspace.tsx:69-77, 59-68`). O se implementan Home/End globales o se corrige
el título; documentar atajos falsos es una trampa para usuarios de teclado y para la
tarjeta de Atajos (MenuBar.tsx:548-572, que — bien — no los lista).

### H18 — Slider del transport sin pasos extendidos · **menor**
`Transport.tsx:145-148`: sólo ←/→ de a 1 frame; sin Shift (×10), Home/End. El grip de
la timeline sí los tiene (1684-1695): homogeneizar.

### H19 — Botón Bucle sin efecto real · **menor** (observación fuera de a11y estricta)
`Transport.tsx:9,124-132`: `loop` es estado local que sólo pinta la clase `active`;
no está conectado a `usePlayback`. El control es accesible pero no hace nada.

---

## 5 · Contraste (tokens y estilos)

Ratios calculados con luminancia WCAG (script `node -e`; comando y pares en la
sección «Verificación»). Tema oscuro (`tokens.css:3-26`) y tema Resolve
(`resolve-theme.css:11-28`):

| Par | Tema oscuro | Tema Resolve |
| --- | --- | --- |
| texto sobre panel | 16,63:1 ✅ | 13,28:1 ✅ |
| `--color-text-muted` sobre panel | 7,30:1 ✅ | 5,39:1 ✅ |
| **`--color-empty` sobre panel** | **4,08:1 ❌** | **2,95:1 ❌** |
| **`--color-empty` sobre panel-2** | **3,81:1 ❌** | **2,72:1 ❌** |
| `--color-accent` sobre panel | 10,68:1 ✅ | (azul #2563eb, ver nota) |
| `--color-danger-strong` texto sobre panel | 4,42:1 ⚠️ límite | — |

### H20 — `--color-empty` por debajo de AA (y por debajo de 3:1 en Resolve) · **medio**
`tokens.css:12` (`#66779a`) rinde 4,08:1 sobre `--color-panel` y 3,81:1 sobre
`--color-panel-2`: falla AA de texto normal (4,5:1). En `resolve-theme.css:21`
(`#63656b`) rinde 2,95:1 / 2,72:1: falla incluso el umbral de 3:1 de texto grande.
Y se usa **con fuentes diminutas**: `chrome.css:95` (8,5 px, subtítulo del chip de
proyecto), `chrome.css:770` (9 px, atajos del menubar), `chrome.css:692` (6 px).
Combinación de texto pequeño + contraste bajo = ilegible para baja visión. Corrección: subir ambos valores hasta
≥ 4,5:1 sobre panel (p. ej. `#8ea0c0` en oscuro, `#8a8c93` en Resolve, verificados
con el test de la Fase 0).

### H21 — Tipografías de 6 a 9 px en la interfaz · **medio**
Además del color, `chrome.css` usa 6 px (692), 8,5 px (95) y 9 px (770). Para una app
de escritorio dirigida a creadores, eso está por debajo de cualquier mínimo legible
(zoom del WebView ayuda, pero el tamaño base ya nace roto).

### H22 — Botón primario: texto fijo sobre gradiente variable · **menor**
`app.css:397-405`: `button.primary` pinta gradiente `accent → accent-strong` con
color de texto fijo `#0b1017`. En el extremo oscuro del gradiente (`#7c5cff`) el
contraste cae a ≈ 4,4:1 (medido con `--color-accent-ink #041018`: 4,42:1) — rozando
el límite para texto de 14 px. Usar `var(--color-accent-ink)` y validar el par con
el test de contraste.

### H23 — Foco desaparecido en el input de inicio · **menor**
`home.css:299-307`: input con `border: 0`, fondo transparente y
`.home-download input:focus { outline: 0; }` sin indicador alternativo → foco
invisible en ese campo (falla WCAG 2.4.7 en ese control).

### Positivos de foco/contraste a preservar
- `app.css:93-95`: `:focus-visible` global con outline 2 px acento — alcanza a clips,
  flags y playhead (no hay regla que lo apague en `.timeline-clip`).
- Los inputs del sistema quitan outline pero aportan anillo de box-shadow
  (app.css:796-804); el foco sigue visible.
- `flat.css:233-235` baja el foco a 1 px — visible pero fino (menor).
- `SettingsWindow.tsx`, paleta y menú contextual son patrones buenos ya presentes.

---

## Plan de corrección priorizado (fases pequeñas y verificables)

Cada fase es un cambio acotado, con su test Vitest plausible. La infraestructura ya
existe: `@testing-library/react` + jsdom + `fireEvent`/`user-event`, `fake-service`
(`test/fake-service.ts`), polyfill de PointerEvent (`Timeline.test.tsx:12-20`) y
proyecto vacío desde `@editor-ia/project-schema`. Verificación por fase:
`npx vitest run --no-cache <archivos>` (nunca la suite completa, según reglas de
esta tarea).

### Fase 0 — Contraste medido en CI (base para todo lo demás) · sin tocar UI
Extraer el cálculo de luminancia/ratio a una función pura y un test que lea
`tokens.css` y `resolve-theme.css`, exija ≥ 4,5:1 para pares texto/fondo declarados
y ≥ 3:1 para `--color-border-strong` sobre panel. Falla hoy: es el test que demuestra
H20 y valida las correcciones de la Fase 6.
- **Test:** `apps/desktop/src/styles/tokens-contrast.test.ts` —
  `it('los tokens de texto cumplen AA 4.5:1 sobre panel')`.

### Fase 1 — Un hook de diálogo y los 9 modales lo usan (H1, H2, H5)
1a. Crear `hooks/useDialogFocus.ts`: al abrir guarda el disparador, enfoca el primer
    elemento enfocable del diálogo, atrapa Tab (ciclo dentro del panel, consultando
    `panel.querySelectorAll` como ya hace el menú contextual en Timeline.tsx:1718-1722)
    y restaura el foco al desmontar (réplica del patrón de SettingsWindow.tsx:27-48).
1b. Adoptarlo en `SettingsWindow` (regresión: su lógica actual es equivalente) y en
    `MenuBar` (modales Atajos/Acerca de).
1c. Adoptarlo en `ExportDialog`, `WelcomeDialog`, `AppUpdaterModal`,
    `StartScreen`, `EmojiPicker`, `CommandPalette`.
1d. En `App.tsx:463+`, que el caso `edit.deselect` ignore el evento si
    `event.defaultPrevented` o si hay un `role="dialog"` visible (H5).
- **Test:** `ExportDialog.a11y.test.tsx` —
  `it('abre con el foco dentro del diálogo, cicla Tab y devuelve el foco al cerrar')` +
  `MenuBar.a11y.test.tsx` — `it('el modal de atajos restaura el foco al disparador')`.

### Fase 2 — Timeline operable sin mouse (H8, H9, H10, H6)
2a. **Trim por teclado:** con clip seleccionado, `,`/`.` (o Alt+←/→) recortan
    inicio/fin con `trimClip`; convertir las asas a `role="slider"` con `tabIndex={0}`
    y ↑/↓ como los fades (espejar Timeline.tsx:327-364). Test:
    `Timeline.trim-teclado.test.tsx` — `it('recorta el inicio con Alt+ArrowLeft y
    actualiza la ventana in/out')` (verificar via store: `clip.source.inFrame`).
2b. **Mover por teclado:** con clip seleccionado, Alt+↑/↓ cambia de pista compatible y
    Shift+←/→ desplaza (usando `moveClip`/`magneticMoveClip` ya importadas). Test:
    `Timeline.mover-teclado.test.tsx` — `it('mueve el clip seleccionado a la pista
    inferior con Alt+ArrowDown')`.
2c. **Navegación de clips:** ←/→ con el foco en un clip mueven la selección al clip
    anterior/siguiente ordenado por `startFrame` (roving tabindex o setSelection +
    `focus()`). Test: `Timeline.navegacion-clips.test.tsx` —
    `it('con el foco en un clip, ArrowRight selecciona el siguiente de la pista')`.
2d. **Menú contextual:** guardar el clip origen y devolverle el foco al cerrar
    (patrón de Fase 1). Test: incluir en el anterior —
    `it('tras cerrar el menú con Escape, el foco vuelve al clip')`.

### Fase 3 — Paleta y menús (H12, H13, H14)
3a. Paleta: `aria-activedescendant` en el input apuntando a la opción seleccionada +
    `id` en cada opción. Test: `CommandPalette.a11y.test.tsx` —
    `it('el input expone aria-activedescendant con la opción resaltada')`.
3b. MenuBar: ←/→ abren el menú hermano anterior/siguiente (foco en su primer ítem) y
    Escape devuelve el foco al disparador. Test: `MenuBar.a11y.test.tsx` —
    `it('ArrowRight pasa de Archivo a Editar con el foco en el primer ítem')`.
3c. ProfileMenu: ↑/↓ entre `menuitem`s con ciclo + foco al primero al abrir (espejar
    Timeline.tsx:1710-1734). Test: `ProfileMenu.a11y.test.tsx`.
3d. (menor) `aria-checked` en ítems de menú con estado, y grilla de flechas en
    EmojiPicker.

### Fase 4 — Transport y atajos honestos (H16, H17, H18)
4a. Espacio: en el despacho global (`App.tsx:547-551`), si `event.target` es
    `button/a/[role="button"]/input/…`, dejar pasar el evento nativo (no
    preventDefault, no toggle). Test: `App.atajos.test.tsx` —
    `it('Space sobre un botón enfocado activa el botón, no la reproducción')`.
4b. Implementar Home/End globales (o eliminarlos de los títulos de
    Transport.tsx:74,110) y añadirlos a `DEFAULT_SHORTCUTS` si se implementan. Test:
    `App.atajos.test.tsx` — `it('Home lleva el playhead a 0 y End al final')`.
4c. Transport slider: aceptar Shift (paso ×10) y Home/End como el grip de la timeline.
    Test: `Transport.test.tsx` — `it('Shift+ArrowRight avanza 10 frames')`.

### Fase 5 — Contraste y tipografía (H20, H21, H22, H23)
5a. Subir `--color-empty` a ≥ 4,5:1 en `tokens.css` y `resolve-theme.css` (candidatos
    `#8ea0c0` / `#8a8c93` — verificar con el test de Fase 0 antes de commitear).
5b. Reemplazar los 6–9 px de `chrome.css` por ≥ 11 px (`--text-xs`).
5c. `button.primary`: color `var(--color-accent-ink)` + revisar extremo
    `accent-strong`; `.home-download input:focus` con anillo visible
    (box-shadow como app.css:796-804).
- **Test:** la Fase 0 queda verde + test de snapshot mínimo de CSS si se desea.

### Orden recomendado
0 → 1 → 4a (los tres bloqueantes: trampa de foco, mover/trim, Space) son el núcleo.
2 depende de nada y es el mayor valor de uso; 3 y 5 son independientes y paralelizables.

---

## Verificación (qué se ejecutó en esta auditoría)

- `find apps/desktop/src -type f \( -name "*.tsx" -o -name "*.ts" -o -name "*.css" \)` — inventario completo.
- Lectura íntegra de: `ExportDialog.tsx`, `SettingsWindow.tsx`, `WelcomeDialog.tsx`,
  `AppUpdaterModal.tsx`, `Timeline.tsx`, `Transport.tsx`, `shortcuts.ts`,
  `CommandPalette.tsx`, `MenuBar.tsx`, `ProfileMenu.tsx`, `tokens.css`,
  `EditorWorkspace.tsx` (1-130), `App.tsx` (420-580), `AssistantDock.tsx` (320-400),
  `EmojiPicker.tsx` (60-130), `StartScreen.tsx` (270-300, 775-800),
  `ShortcutsCard.tsx` (50-90) y bloques de `app.css`/`chrome.css`/`flat.css`/
  `home.css`/`resolve-theme.css` citados.
- `grep -rc "aria-label" apps/desktop/src --include="*.tsx"` → **240**.
- `grep -rn 'role="dialog"' apps/desktop/src --include="*.tsx"` → 9 archivos.
- `grep -rn "focus-trap\|focusTrap\|inert" apps/desktop/src` → sin resultados.
- `grep -rn "addEventListener('keydown'" apps/desktop/src --include="*.tsx" --include="*.ts"` → 13 listeners listados en §2.
- `grep -rn "focus-visible\|:focus\b\|outline" apps/desktop/src/styles/*.css` → reglas citadas.
- Cálculo de ratios: `node -e` con luminancia WCAG sobre los pares de tokens
  (tablas de §5). Cálculo puro en memoria; no se instaló ni ejecutó nada del proyecto.
- **No ejecutado (prohibido por la tarea):** `git` (no se pudo confirmar el estado
  `ad08a95`/árbol limpio), `npm`/`npx vitest` (ningún test corrido: los tests de este
  plan son propuestos, no verificados), lanzamiento de la app.

## Pendientes / límites

- Los ratios de contraste consideran los pares token/fondo citados; hay colores
  hardcodeados en pantallas puntuales (p. ej. `start-screen.css`) que quedaron fuera
  del muestreo — Fase 0 los cubriría al extender la lista de pares.
- No se auditaron `packages/*` ni la vista web de `apps/web` (fuera del alcance
  pedido: `apps/desktop/src`).
- El ítem H19 (botón Bucle sin efecto) es un bug funcional detectado de paso; su
  arreglo corresponde a otra tarea porque exige tocar `usePlayback`.
- Verificar en pantalla (con lector + sólo teclado) los positivos aquí listados una
  vez aplicada la Fase 1, porque este informe es análisis estático de código.
