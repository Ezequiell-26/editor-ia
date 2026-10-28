# Menubar operable con teclado — 2026-10-28

## Qué se hizo

`MenuBar.tsx` cumple el contrato de teclado del patrón menubar (auditoría
H13 / fase 3b de `docs/research/ACCESIBILIDAD-2026-10-24.md`):

- Roving tabindex: sólo un título del menú queda en el orden de Tab.
- ←/→ mueven el foco entre Archivo/Editar/Ver/…; si hay un menú abierto, abren
  el hermano con el foco en su primer ítem habilitado.
- ↓/↑ abren con el primer/último ítem; Home/End van al primer/último menú;
  Enter/Espacio abren el menú enfocado.
- Escape cierra el desplegable, devuelve el foco al disparador y corta la
  propagación para que el Escape global no deseleccione el clip. Tab cierra el
  menú y deja el foco en el disparador. Al activar un ítem con Enter/Espacio,
  el foco también vuelve al disparador.
- Si el menú abierto no tiene ítems habilitados (Editar sin proyecto), el foco
  vuelve al disparador en vez de caer en `<body>`.
- Los ítems con tilde usan `role="menuitemcheckbox"` + `aria-checked`.

## Evidencia medida

- `MenuBar.test.tsx` **8/8** (6 nuevas: roving tabindex, ↓/↑, ←/→ con
  fallback sin proyecto, Escape con foco y sin propagación, Tab con foco en
  el disparador, `aria-checked`).
- App + App.teclado + paleta **63/63**.
- Suite completa **1321/1321 en 160 archivos** en 53,89 s.
- `npm run typecheck` verde; `npm run build` verde en 8,33 s (main 368,60 kB,
  gzip 103,16; los chunks del split de EditorWorkspace no cambian).
- Sin cambios en Rust, sin commit/push ni rebuild del instalador.

## Trampa registrada

El `ref` compartido del desplegable queda en `null` al cambiar de menú: React
desmonta el menú anterior después de montar el siguiente y la asignación `null`
pisa el nodo nuevo. La búsqueda de ítems se hace con un query acotado a la raíz
(`.menubar-dropdown [role^="menuitem"]:not(:disabled)`) en vez de un ref
compartido.

## Límites

- `ProfileMenu` (H14/3c) y la paleta (H12/3a) no se tocaron: pendientes propios.
- Contraste de guías de `KeyframeCurveEditor`: centro `#3a3f46` **1,80:1** y
  punteadas `#565d66` **2,87:1** sobre `#0a0f1e`, por debajo de 3:1; candidatos
  `#6b7480` (4,03:1) y `#7b8591` (5,10:1). Queda como ítem 10b de la cola.
- Etiquetas de paneo ya completas (mesa con `aria-label` + `aria-valuetext`,
  automatización por clave, paneo de clip dentro de `<label>`).
