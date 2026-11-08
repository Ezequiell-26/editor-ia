# 2026-11-08 — Subtítulos RTL con isolate bidi en SRT/VTT

## Qué se hizo

Cierra el «Pendiente honesto» de la entrada de los 12 idiomas
(2026-11-08): «el árabe se guarda como SRT UTF-8 sin marca de dirección
(el formato no la tiene; los players aplican bidi)».

SRT/VTT no tienen dirección de párrafo. Para idiomas RTL (`ar` en
`LOCALIZATION_LANGUAGES`) los serializadores ahora envuelven el texto de
cada cue en un isolate Unicode **FSI…PDI** (U+2068/U+2069): el player
aplica bidi al texto sin heredar el contexto LTR del archivo ni mezclarlo
con los timestamps vecinos. FSI (first-strong-isolate) deja que el
contenido decida la dirección, así que texto mixto árabe+latino también
queda bien aislado.

## Cambios

- `state/subtitles.ts`: `serializeSrtSeconds`/`serializeVttSeconds` ganan
  un segundo parámetro opcional `direction?: 'ltr' | 'rtl'` (tipo nuevo
  `SubtitleDirection`). Sin dirección o con `'ltr'` la salida es
  byte-idéntica a antes.
- `features/localization/LocalizationView.tsx`: el export pasa
  `localizationLanguage(localized.language)?.direction` por archivo.
- `features/download/DownloadView.tsx`: `buildSrt`/`srtTime` locales
  (duplicaban el formato) se eliminaron; la traducción al descargar usa
  `serializeSrtSeconds(cues, direction)` — salida equivalente y una sola
  fuente de verdad para el formato SRT.

## Límites honestos

- Las marcas son invisibles (Cf); players viejos sin soporte bidi las
  ignoran y muestran el texto en orden lógico (mismo comportamiento que
  antes, no peor).
- El texto quemado (`creatorBurnSubtitles` → `subtitles=subs.srt` de
  FFmpeg/libass) recibe el mismo contenido con las marcas; FriBidi las
  interpreta como isolates, que es lo correcto, pero no se verificó un
  burn-in real de árabe.
- Sólo `ar` es RTL en `LOCALIZATION_LANGUAGES`; el mecanismo es genérico
  para cualquier idioma RTL futuro.

## Verificación

- `npx tsc --noEmit -p apps/desktop/tsconfig.json` → 0 errores.
- `npx vitest run src/state/subtitles.test.ts
  src/features/localization/localization.test.ts
  src/features/download/DownloadView.test.tsx` → **33/33**
  (subtitles 15/15 con 2 tests nuevos: isolate rtl en SRT y VTT, sin
  tocar ltr/sin dirección).
