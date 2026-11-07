# Atajos de teclado pro (paridad CapCut / DaVinci / Premiere)

Alcance de esta iteración: registro de atajos en
`apps/desktop/src/state/shortcuts.ts`, su validación en
`apps/desktop/src/state/shortcuts-pro.test.ts` y esta documentación.

Regla que se aplicó: **sólo se registran atajos para acciones que ya existen en
la app**. Si un atajo necesita una acción inexistente, o su tecla ya está tomada
por otro atajo, no se registra y queda anotado en «Pendientes».

Leyenda de estado:

- ✅ **Ya opera hoy**: la tecla ya responde por un handler propio del editor
  (hardcodeado en `Timeline.tsx` / `EditorWorkspace.tsx`). El registro la
  documenta y la hace visible en Ajustes → Atajos.
- 🟡 **Registrado, cableado pendiente**: la acción existe (botón, handler o
  función real), pero responder a la tecla globalmente exige agregar el caso en
  el switch de `App.tsx` (fuera del alcance de esta iteración). Mientras tanto,
  la acción sigue disponible por su vía actual.

## Reproducción

| Tecla | Acción (etiqueta en Ajustes) | Acción existente que ejecuta | Estado |
| --- | --- | --- | --- |
| `L` | Shuttle: reproducir hacia adelante | `setPlaying(true)`; cableado en el dispatcher global de `App.tsx` | ✅ |
| `K` | Shuttle: pausar | `setPlaying(false)`; cableado en `App.tsx` | ✅ |
| `,` | Frame anterior | `setPlayhead(frame − 1)` pausando la reproducción; cableado en `App.tsx` | ✅ |
| `.` | Frame siguiente | `setPlayhead(frame + 1)` pausando la reproducción; cableado en `App.tsx` | ✅ |
| `Home` | Ir al inicio de la timeline | `setPlayhead(0)`; cableado en `App.tsx` | ✅ |
| `End` | Ir al final de la timeline | `setPlayhead(totalFrames(project))`; cableado en `App.tsx` | ✅ |
| `Space` | Reproducir / Pausar (existente) | `playback.playPause` | (ya registrado antes) |

Desde la fase 2 de accesibilidad, `Space` **no roba la activación**: si el foco
está sobre un control activable (botón, ítem de menú, clip de la timeline con
`role="button"`…), el despacho global de `App.tsx` deja pasar el evento para que
el navegador active el control; el click de Space ocurre en keyup y se anula si
el keydown se previene (`isActivatableTarget` en `state/shortcuts.ts`).

## Timeline

| Tecla | Acción (etiqueta en Ajustes) | Acción existente que ejecuta | Estado |
| --- | --- | --- | --- |
| `S` | Dividir clip en el playhead | `splitClip` (`project-actions.ts:1576`); ya responde hoy vía `EditorWorkspace.tsx:66-77` | ✅ |
| `M` | Marcador en el playhead | `addMarker` / `deleteMarker` / `markerAtFrame` (`state/markers.ts:23,104,156`); ya responde hoy vía `Timeline.tsx:699-702` | ✅ |
| `[` | Recortar entrada del clip al playhead | `trimClip(…, 'start', playhead)` sobre el clip seleccionado; cableado en `Timeline.tsx` | ✅ |
| `]` | Recortar salida del clip al playhead | `trimClip(…, 'end', playhead)`; cableado en `Timeline.tsx` | ✅ |
| `+` | Acercar timeline | `setPxPerFrame(×1.4)` — mismo factor que el botón; cableado en `Timeline.tsx` | ✅ |
| `-` | Alejar timeline | `setPxPerFrame(÷1.4)` — mismo factor que el botón; cableado en `Timeline.tsx` | ✅ |
| `F` | Ajustar zoom a la duración | Misma fórmula que el botón «Ajustar»; cableado en `Timeline.tsx` | ✅ |
| `Alt+←` | Mover el clip seleccionado 1 frame a la izquierda | `moveClip` (`project-actions.ts:903`); responde vía `EditorWorkspace.tsx` (edición de clip por teclado) | ✅ |
| `Alt+→` | Mover el clip seleccionado 1 frame a la derecha | `moveClip` | ✅ |
| `Alt+↑` | Subir el clip a la pista compatible anterior | `moveClip` con pista de `nearestCompatibleTrack` (`features/editor/timeline-keyboard.ts`) | ✅ |
| `Alt+↓` | Bajar el clip a la pista compatible siguiente | `moveClip` con pista de `nearestCompatibleTrack` | ✅ |
| `Ctrl+Alt+←` | Recortar el borde de entrada del clip seleccionado | `trimClip(…, 'start', …)` (`project-actions.ts:1242`) | ✅ |
| `Ctrl+Alt+→` | Recortar el borde de salida del clip seleccionado | `trimClip(…, 'end', …)` | ✅ |

### Edición de clip por teclado (fase 2 de accesibilidad)

Con un clip seleccionado, las flechas con modificadores editan el clip; sin
selección siguen moviendo el playhead. La decisión vive en el módulo puro
`features/editor/timeline-keyboard.ts` y la ejecución en el keydown del
contenedor de la timeline (`EditorWorkspace.tsx`), junto a Supr y S:

- `Alt+←/→` mueve el clip ±1 frame; `Alt+Shift+←/→` lo mueve ±1 segundo
  (fps frames, fuera del registro: es la misma acción con paso mayor).
- `Alt+↑/↓` lleva el clip a la pista compatible más cercana hacia arriba/abajo
  en el orden de la interfaz (salta pistas de otro tipo).
- `Ctrl+Alt+←/→` recorta el **borde activo de entrada** y `Ctrl+Alt+Shift+←/→`
  el de salida: la flecha apunta hacia dónde se mueve el borde agarrado (con el
  borde de entrada, `←` estira y `→` acorta; con el de salida, al revés).
- Flechas sin Alt (y con Shift) siguen moviendo el playhead como siempre; los
  eventos ya prevenidos por otros controles (grip del playhead, asas de fade,
  menú contextual) se ignoran.

## Atajos locales del timeline (reasignables desde Ajustes)

Los atajos que viven en el listener propio de `Timeline.tsx` ahora **leen el
registro** (`bindingMatches` + `shortcutsRef`): aparecen en Ajustes → Atajos y
se pueden cambiar. Sólo actúan en la vista del editor, con guard de
`input/textarea/select/contenteditable`; los que operan sobre la selección
múltiple además se saltan si hay un diálogo, modal o la ventana de Ajustes
abierta.

| Binding por defecto | Id del registro | Acción | Notas |
| --- | --- | --- | --- |
| `Shift+R` | `timeline.rippleToggle` | Activar/desactivar **Ripple editing** | El botón del toolbar expone `aria-keyshortcuts="Shift+R"`. |
| `Alt+Shift+←` / `Alt+Shift+→` | `timeline.moveGroupLeft` / `timeline.moveGroupRight` | Mover el grupo multi-seleccionado 1 frame | Sólo con más de un clip seleccionado. No pisa `Alt+←/→` (`timeline.clipMove*`). |
| `Ctrl+C` / `Ctrl+V` | `timeline.copyClip` / `timeline.pasteClip` | Copiar / pegar clip | Copia interna del portapapeles del timeline. |
| `Shift+Delete` | `timeline.deleteWithRipple` | Borrar selección cerrando huecos | Distinto de `edit.rippleDelete` (`Ctrl+Shift+Delete`, global). |
| `H` | `timeline.panMode` | Alternar herramienta mano | — |
| `M` | `timeline.toggleMarker` | Marcador en el playhead | Ya estaba en el registro; ahora el handler lo consulta. |
| `V` / `C` / `A` / `Shift+A` / `Z` | `tools.select` / `tools.split` / `tools.selectForward` / `tools.selectBackward` / `tools.zoom` | Selector de herramienta de la timeline | Antes hardcodeados en `Timeline.tsx`. |
| `Shift+clic` / `Ctrl+clic` (`Cmd` en mac) | — | Sumar/quitar clips a la multi-selección | Es mouse, no teclado; el set se sincroniza con el store. |

**`Esc` y multi-selección**: no hay handler local de `Esc`. La selección múltiple
se limpia cuando el atajo global `edit.deselect` (`Escape`) deja
`selection.kind === 'none'` y el timeline sincroniza su set local con el store.
Es una dependencia explícita: si ese atajo global cambiara de semántica, el set
múltiple quedaría hasta el próximo clic. La vía robusta para otra ola es exponer
`selection: { kind: 'clips', ids }` en `state/project-store` y migrar ambos
lados juntos.

Sin cambios en la semántica global de `Espacio`/flechas.

## Pendientes

1. **`J` (shuttle hacia atrás)**: no se registró. El motor de reproducción
   (`usePlayback.ts`) sólo avanza (`frame += deltaSeconds * fps`) y `playing`
   es booleano: no existe reproducción inversa. Requiere dirección en el motor.
2. **Rampa de velocidad de shuttle** (repetir `L`/`J` acelera, como CapCut): no
   existe control de velocidad de reproducción.
3. **`Ctrl+D` eliminación con ripple**: no se registró. `Ctrl+D` ya es
   «Duplicar clip» (`edit.duplicateClip`) y reasignar atajos existentes estaba
   prohibido. La acción ripple existe y ya está registrada como
   `edit.rippleDelete` con `Ctrl+Shift+Delete`.
4. **`Shift+Supr` (Shift+Delete) ripple delete**: ✅ resuelto. Tiene id propio
   `timeline.deleteWithRipple` con default `Shift+Delete`, distinto del global
   `edit.rippleDelete` (`Ctrl+Shift+Delete`); ambos coexisten y son
   reasignables por separado.
5. ~~**Cableado global de los atajos 🟡**~~ ✅ resuelto: `L`/`K` (shuttle), `,`/`.`
   (frame a frame), `Home`/`End` (inicio/fin) los despacha `App.tsx` desde
   cualquier vista con proyecto; `[`, `]`, `+`, `-`, `F` los atiende
   `Timeline.tsx` con las mismas fórmulas que sus botones (zoom 1.4× y ajuste a
   duración). Los ids de timeline que ya tenían handler local (`S`, `M`, `H`,
   ripple, copiar/pegar, multi-selección, herramientas) no se duplican: el
   dispatcher global cae en `default` sin `preventDefault` y el handler local
   responde. Divisores de panel con `stopPropagation` para no robar Home/End
   ni las flechas.
6. **Categoría «Timeline» en Ajustes**: ✅ resuelto (ola 4c). `ShortcutsCard.tsx`
   ordena los grupos con `CATEGORY_ORDER`, que ya incluye «Timeline» al final;
   ningún grupo queda con índice -1.
7. ~~**Reasignación de las combinaciones de clip con Alt**~~ ✅ resuelto:
   `clipKeyboardAction` (`timeline-keyboard.ts`) recibe el mapa vigente de
   Ajustes → Atajos y compara el binding del evento **sin Shift** contra el
   binding configurado **sin Shift** — Shift queda reservado como modificador
   de la acción (±1 segundo al mover, borde de salida al recortar), no como
   parte del atajo. Los 6 ids (`timeline.clipMove*`/`clipTrim*`) son
   reasignables como cualquier otro. Límite honesto: dos bindings que sólo
   difieran en Shift colisionarían al hacer match (la validación de
   `assignShortcut` no los distingue).

## Notas técnicas

- La tecla `+` es además el separador del formato canónico de bindings
  (`Ctrl+Shift+K`); `normalizeBinding` la trata como caso especial para que el
  binding `+` no se pierda al normalizar (`shortcuts.ts`).
- Los defaults con tecla simple (`S`, `M`, `L`, `K`, `,`, `.`, `[`, `]`, `+`,
  `-`, `F`) no pasan `isBindable`: esa política valida sólo la entrada nueva del
  usuario en Ajustes (evita secuestrar la escritura). Los defaults se cargan tal
  cual y se pueden reasignar; para volver a una tecla simple existe el botón ↺.
- Agregar ids al registro no cambia el comportamiento en runtime por sí solo:
  `App.tsx` despacha con un `switch` sobre el id y los ids nuevos sin caso caen
  en el `default` (no hacen nada, ni `preventDefault`). Por eso `S` y `M`
  siguen operando igual y los 🟡 no rompen nada mientras se cablean.
- Test de validación: `npx vitest run --no-cache apps/desktop/src/state/shortcuts-pro.test.ts`
  (estructura del registro, teclas sin duplicar, acción real por atajo).
- Persistencia (ola 4c): `saveShortcuts` guarda **sólo los overrides** que
  difieren del default y `loadShortcuts` los combina con `DEFAULT_SHORTCUTS`, así
  un default nuevo llega a quien nunca personalizó ese atajo. El formato legado
  que guardaba el mapa completo se sigue leyendo. La validación de una
  reasignación (normalización, `isBindable`, sin duplicados) vive en helpers
  puros `assignShortcut`/`findShortcutConflict` y se prueba en
  `apps/desktop/src/state/shortcuts-config.test.ts`; `ShortcutsCard.tsx` usa esos
  helpers en lugar de duplicar la lógica.
