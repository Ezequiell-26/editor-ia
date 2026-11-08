# 2026-11-08 — Descargar: los 12 idiomas del backend al traducir subtítulos

Pasada del protocolo del loop (Devin CLI). La cola estaba toda `[done]`;
el ítem salió de una brecha medible entre el backend y la UI.

## Brecha medida

- `translate_subtitles` (`commands/providers.rs::language_name`) acepta 12
  idiomas: es, en, zh, hi, ar, pt, bn, ru, fr, de, it, ja.
- `DownloadView` (sección «Traducir los subtítulos al descargar») sólo
  ofrecía 8 en el `<select>` de destino y en la grilla «También …»:
  faltaban `hi`, `ar`, `bn`, `ru` — los mismos que la pasada de
  unificación de idiomas ya había sumado a Localización. Un job MCP con
  esos destinos funcionaba, pero la UI no los dejaba elegir.

## Qué se hizo

- `features/download/DownloadView.tsx`: el select y la grilla ahora se
  generan desde `LOCALIZATION_LANGUAGES` (`features/localization/
  localization.ts`) — la lista canónica de los 12 — eliminando la lista
  hardcodeada duplicada (estaba escrita dos veces en el archivo).
- Test nuevo en `DownloadView.test.tsx`: verifica las 12 opciones del
  select y los checks «También …» de los cuatro idiomas nuevos.

## Verificación (esta sesión)

- `npx tsc --noEmit -p apps/desktop/tsconfig.json` → 0 errores.
- `npx vitest run src/features/download/DownloadView.test.tsx
  src/features/download/queue.test.ts` → 21/21.
- `npx vitest run src/features/localization` → 11/11.

## Límites honestos

- Árabe se persiste como SRT UTF-8 sin flag de dirección (el formato no
  lo tiene); los players aplican bidi al renderizar.
- No se tocó Rust: el backend ya aceptaba los cuatro códigos.
- Jobs de cola viejos con `translateTo`/`translateExtras` de 8 idiomas
  siguen siendo válidos (son strings libres).

## Siguiente

La cola sigue sin ítems `[next]`/`[pending]` acotados y seguros: lo que
queda es grande (editor de capas del titler, transiciones OBS en vivo,
física 2D del stickman, CSS splitting fase 2 sin spec) o bloqueado por
recursos externos (firma OV/EV, updater, Lemon Squeezy) o gateado a
pedido del usuario (ola CapCut P1).
