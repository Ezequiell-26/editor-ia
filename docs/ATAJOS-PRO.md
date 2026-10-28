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
| `L` | Shuttle: reproducir hacia adelante | `setPlaying(true)` (`project-store.tsx:498`); el motor avanza hacia adelante (`features/editor/usePlayback.ts:28-46`) | 🟡 |
| `K` | Shuttle: pausar | `setPlaying(false)` (`project-store.tsx:498`) | 🟡 |
| `,` | Frame anterior | Paso del playhead: `store.setPlayhead(playhead − 1)`; el paso a frame ya existe con las flechas (`EditorWorkspace.tsx:82-92`) | 🟡 |
| `.` | Frame siguiente | `store.setPlayhead(playhead + 1)` | 🟡 |
| `Home` | Ir al inicio de la timeline | `setPlayhead(0)`; mismo movimiento que el grip del playhead (`Timeline.tsx:1689`) | 🟡 |
| `End` | Ir al final de la timeline | `setPlayhead(totalFrames(project))` (`project-actions.ts:4280`; grip en `Timeline.tsx:1690`) | 🟡 |
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
| `[` | Recortar entrada del clip al playhead | `trimClip(project, clipId, 'start', playhead)` (`project-actions.ts:1242`) | 🟡 |
| `]` | Recortar salida del clip al playhead | `trimClip(project, clipId, 'end', playhead)` | 🟡 |
| `+` | Acercar timeline | Botón «Acercar»: `setPxPerFrame(×1.4)` (`Timeline.tsx:1193`) | 🟡 |
| `-` | Alejar timeline | Botón «Alejar»: `setPxPerFrame(÷1.4)` (`Timeline.tsx:1184`) | 🟡 |
| `F` | Ajustar zoom a la duración | Botón «Ajustar»: zoom a la duración del proyecto (`Timeline.tsx:1199-1206`) | 🟡 |
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
4. **`Shift+Supr` (Shift+Delete) ripple delete**: ya opera hoy vía handler de
   `Timeline.tsx:696-699` (`rippleDeleteSelected`). El registro mantiene
   `edit.rippleDelete` en `Ctrl+Shift+Delete`; cambiar ese default por
   `Shift+Delete` sería reasignar un atajo existente → quedó pendiente de
   decisión, no se tocó.
5. **Cableado global de los atajos 🟡** (`L`, `K`, `,`, `.`, `Home`, `End`,
   `[`, `]`, `+`, `-`, `F`): agregar los casos al switch de `App.tsx` (o
   handlers equivalentes) para que respondan desde cualquier vista.
6. **Categoría «Timeline» en Ajustes**: `ShortcutsCard.tsx` ordena los grupos
   con `CATEGORY_ORDER` fijo; la categoría nueva aparece primera por no estar
   en esa lista. Agregarla al orden queda pendiente (archivo fuera del alcance).
7. **Reasignación de `S`/`M` y de las combinaciones de clip con Alt**: los
   handlers propios del editor no leen el registro (`getShortcut`); si el
   usuario reasigna esas teclas en Ajustes, el handler hardcodeado seguirá
   respondiendo a las teclas de fábrica. Unificar exige que `Timeline.tsx` /
   `EditorWorkspace.tsx` consulten el registro.

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
