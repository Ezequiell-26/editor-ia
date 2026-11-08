# 2026-11-08 — Localización Studio: idiomas unificados por backend (Editor IA)

## Qué se hizo

Pasada del loop de mejora (Devin CLI) cerrando el «pendiente honesto» de la
pasada anterior (traducción de subtítulos con fr/de/it/ja).

Mapa real de idiomas por backend (verificado en el código Rust):

- `translate_subtitles` (`commands/providers.rs::language_name`): **12** —
  es, en, zh, hi, ar, pt, bn, ru, fr, de, it, ja.
- `synthesize_dub` (`commands/dubbing.rs::normalize_language`): **11** — los
  12 menos `ja`.
- `clone_voice` (`commands/voice_clone.rs::CLONE_LANGUAGES`): 16 códigos; de
  los 12 de la lista de Localización, todos menos `bn`.

La UI ofrecía una lista curada de 8 para todo, así que `fr`/`de`/`it`/`ja`
no se podían traducir desde Localización y `bn` se podía elegir para clonar
voz aunque el backend lo rechaza.

## Cambios

- `features/localization/localization.ts`: `LOCALIZATION_LANGUAGES` pasa a
  los 12 del backend; sets `DUBBING_LANGUAGE_CODES` / `CLONE_LANGUAGE_CODES`
  (espejos documentados de las listas Rust) + arrays filtrados.
- `LocalizationView.tsx`: el select de doblaje sólo lista idiomas traducidos
  doblables y avisa «Sin doblaje SAPI por ahora: …»; el de clonación usa la
  lista filtrada (sin `bn`) con nota honesta y efecto que corrige la
  selección si el idioma no es clonable.
- Copy «ocho idiomas» → «doce» en encabezado, hint de `navigation.ts`,
  `APP-FEATURE-AUDIT.md`, `ROADMAP.md` y `TUTORIAL.md`.

## Verificación (ejecutada)

- `npx vitest run src/features/localization src/app/navigation.test.ts`
  → **18/18** (localization.test 6/6 con asserts nuevos de los sets).
- `npx vitest run src/App.test.tsx -t Localización` → **1/1**.
- `npx tsc --noEmit -p apps/desktop/tsconfig.json` → **0 errores**.
- Rust no se tocó: los backends ya aceptaban estos idiomas.

## Límites honestos

- Doblaje de `ja`: el backend no lo mapea (sin voz SAPI garantizada).
- Clonación de `bn`: el motor local no lo soporta; Rust admite además
  ko/tr/pl/nl/cs que la UI no ofrece porque la traducción no los cubre.
- Las listas TS son espejos manuales de las de Rust: si una cambia allá,
  hay que actualizarla acá (no hay test cruzado lenguaje-a-lenguaje).
