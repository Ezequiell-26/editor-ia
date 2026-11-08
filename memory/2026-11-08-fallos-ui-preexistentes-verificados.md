# 2026-11-08 — Fallos de UI preexistentes verificados como cerrados

Pasada del protocolo del loop (Devin CLI). Sin cambios de código: se
verificó contra la suite real el `[next]` del lote de rendimiento del
2026-11-04 («corregir esos 4 archivos de UI — roles ARIA, `<main>` único,
filtro por carpeta — y repetir la suite»).

## Medición

La suite serial de esa fecha reportaba 13 fallos **previos y ajenos** al
cambio de rendimiento (trabajo no confirmado del usuario en ese momento):

| Archivo | Fallos entonces | Hoy |
|---|---|---|
| `EffectStudio.test.tsx` | 5 | **6/6** |
| `AudioEffectStack.test.tsx` | 4 | **6/6** |
| `App.test.tsx` | 1 | **77/77** |
| `AssetsPanel.test.tsx` | 3 | **7/7** |
| `LottiePanel.test.tsx` | 1 | **3/3** |

Total: **99 tests, 0 fallos** en los 5 archivos, corridos con
`npx vitest run <archivos>` en `apps/desktop` durante esta pasada.

Los lotes posteriores los cerraron: `278be53` (thumbnails SVG del
catálogo, que restauró el rol `button` de `ThumbnailBrowser`),
`d308f50`/`ba1a0fe` (tokens `--color-*` y capa Filmora), y la entrada del
2026-11-08 que actualizó los specs e2e de `input[type=color]` a
`ColorSwatch`/`ColorWheel` (playwright `theme.spec`/`settings.spec` 4/4).

`<main>` único confirmado: sólo `AppShell.tsx:378` lo monta dentro del
shell; el de `StartScreen.tsx:780` es la pantalla de arranque.

## Lo que sigue vivo de ese `[next]`

- Segunda fase de CSS splitting (sin spec propia; la fase 1 ya midió
  −19,7 % de CSS crítico).
- Microbenchmark de un comando Rust CPU-bound para cuantificar el LTO del
  perfil release (el arranque no mejoró de forma medible en CDP).

## Verificación

Sólo tests de los archivos citados (arriba). No hubo cambios de código,
así que no corrió `tsc` ni la suite serial completa. Árbol limpio salvo
`vibe_videos/` (untracked del usuario, no se tocó).
