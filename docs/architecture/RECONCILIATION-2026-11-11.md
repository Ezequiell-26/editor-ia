# Fase 1 — Matriz de reconciliación `main` ↔ `architecture/refactor-foundation`

Fecha: 2026-11-11. Base: `a7cff32`. Universo: **147 commits en `main` no presentes
en la rama** (la rama tiene 79 propios). Verificación: existencia de archivos y
marcadores de funcionalidad en el árbol actual (no `git cherry`, los patch-ids
difieren por port manual).

## Verdict general

La rama **absorbió la gran mayoría** del trabajo de `main` por desarrollo
paralelo (mismo autor, mismos nombres de archivo, tests equivalentes). Los
commits `chore(loop)` y `docs(queue)` de `main` son Ledger/cola del repo
`editor-ia`, no aplican. Quedan **brechas reales concentradas en 6 features**.

## Brechas confirmadas (main tiene, rama NO)

| # | Feature (commits main) | Estado en rama | Esfuerzo |
|---|---|---|---|
| G1 | Localización 17 idiomas (`616744a`, `44ccb9a`) | `localization.ts` tiene **12** (faltan ko,tr,pl,nl,cs) | Bajo — datos + tests |
| G2 | Doblaje SAPI 17 idiomas (`616744a`) | `dubbing/validation.rs` acepta **11** (sin ja,ko,tr,pl,nl,cs) | Bajo — `normalize_language` + labels + test espejo TS |
| G3 | `media_search` MCP (`c3bb141`) | Sólo `media_folder_list` (sin búsqueda por nombre) | Medio — comando Rust + tool MCP |
| G4 | Paleta medida del clip (`9a28af2`) | `ai-palette` sigue `pending:true`; `analyze_media_frames` existe backend-only (FOLLOW-UPS) | Medio — subpestaña Color |
| G5 | «Rampas de IA» por pulsos (`a667fec`) | `{ id:'ia', pending:true }` en Inspector; `beat-sync.ts`+`speed-ramp-presets.ts` ya existen | Medio — `speed-ramp-suggest.ts` + wiring |
| G6 | «Seguimiento de cámara» honesto (`3d28f5d`) | MenuBar/Novedades lo declaran placeholder aunque `analyze_face_track`+subpestaña Seguimiento existen | **Trivial** — relabel |

## Brechas de preview/render (main tiene, rama NO — verificadas por archivo)

| # | Feature | Archivos main | Estado rama |
|---|---|---|---|
| G7 | Ventanas de clips precomputadas (`c3defe3`) | `preview-clip-windows.test.ts` | Preview.tsx sin `clipWindows` |
| G8 | Transiciones `transitionIn` en preview (`5382835`, test 207 líneas) | `preview-transition.test.ts` | Sin equivalente |
| G9 | SpeedCurve/reverse en preview (`7c80096`, `1ea5a48` `useReversedClipAudio.ts`) | — | Preview sin speedCurve ni buffer invertido |
| G10 | Filtros de voz Web Audio (`9ca7962`) | — | Preview sin HP/LP/EQ/de-esser/puerta/comp |
| G11 | Aprox. afftdn espectral (`820a379`) | — | No existe |
| G12 | Luma-wipe mask en preview (`e318a10`, `ea94355`) | — | Preview sin máscara del mate |
| G13 | CSS split fase 2 (`6a630e6`) | `styles/entries/scopes.css`, `compliance.css` | Sólo `content.css`+`editor.css` (estado distinto, no necesariamente peor) |

## Verificado presente en rama (muestra de los 147)

clock-wipe (render+preview+catálogo), voiceIsolation (MCP+Inspector+export),
shuttle L/J/K + `loopPlayback` + `stateRef` eager, SFX rail (`SfxLibrary`,
`sfx-actions`, previews), render-queue pause (`pauseRender`, capabilities),
bidi FSI/PDI en SRT/VTT, pixel formats yuva420p/yuv420p10le, stickman bodies,
keyframes/bezier templates, luma-mate UI, color-looks, subtitles magnet,
facetas Recortar/Duración/Editar/HSL/Curvas/Ruedas/HDR del rail, TTS/traducción
surfaces, detección silencio/ritmo, color/WB automático parcial (controles
existen; medición real = G-relacionado con analyze_media_frames), autoedit
simulación de montaje parcial.

## Plan de port (orden sugerido)

1. **G6** trivial → hacer ya.
2. **G1+G2** juntos (mismo dominio localization/dubbing).
3. **G3** media_search (cierra límite declarado en memory/2026-11-05).
4. **G4** paleta medida (backend ya existe → UI honesta).
5. **G5** rampas por pulsos.
6. **G7–G12** preview parity — evaluar uno por uno; son los de mayor riesgo
   (Preview.tsx es archivo caliente con WIP).

## Estado de port (actualizado)

- **G6 ✅** `MenuBar.tsx` NEWS_AVAILABILITY → `view:'editor'` + detalle honesto (mismo texto que main).
- **G1+G2 ✅** 17 idiomas: `localization.ts` (union+5 entradas+DUBBING 17+CLONE 16), `ai/providers.rs::language_name` (+ko/tr/pl/nl/cs), `dubbing/validation.rs::normalize_language`+`language_label` (+ja/ko/tr/pl/nl/cs), tests espejo actualizados. Evidencia: vitest localization 11/11, cargo test dubbing 5/5.
- **G5 ✅** «Rampas de IA» portado (`a667fec`): `speed-ramp-suggest.ts` (determinista: `detectBeats`+`decodeAudioSamples`→SpeedCurve coseno, <2 pulsos=mensaje honesto), subpestaña `ramps` no-pending en speed, `suggestRampFromBeats`/`applySuggestedRamp` vía `applySpeedCurvePoints` (misma validación que export), CSS `data-subtab='ramps'` (+`'palette'` que faltaba de G4). Evidencia: speed-ramp-suggest 9/9, App.test e2e «Rampas de IA» verde, tsc limpio.
- **G3 ✅** `media_search` portado completo: `search_media_folder` (resolve_media_folder_dir extraído, profundidad 4, topes 20k/200 con `truncated`), tool MCP read-only con `kind`, wiring DesktopService (contracts+tauri+unavailable+fake), test MCP nuevo. Evidencia: cargo test media 6/6, mcp-tools 38/38, tsc limpio. Tools MCP ahora **114**.
- **G4 ✅ completo** Subpestaña «Paleta» en Color + `PalettePanel` (`analyzeMediaFrames`, estados honestos, «no es IA generativa») + CSS + 2 tests. **Además se portó la infra de deep-link** (`fd72b75`+`c995014`+`9a28af2`): `state/inspector-tab-command.ts` (+10 tests), prop `tabRequest` con nonce+subTab validada en Inspector, `onRequestInspectorTab` en Timeline→EditorWorkspace, `ToolbarToolRun`/`run:` en TOOLBAR_CATALOG y QuickToolsBar, entrada «Paleta de colores» en overflow. Efecto colateral: **Recortar/Duración/Editar de la barra rápida también quedaron funcionales** (abren trim/speed/all). Evidencia: ColorPropertiesPanel 11/11, Inspector.tab-request 6/6, inspector-tab-command 10/10, Timeline 33+7, EditorAssets 14/14, tsc limpio, architecture-rules 12/12. `c995014` quedó **completo**: las entradas «Ruedas cromáticas»/«HDR» del rail de Ajustes (EditorAssets) también abren color→wheels/hdr vía `onRequestInspectorTab`.
- **G7+G8 ✅** Ventanas precomputadas + transiciones `transitionIn` en preview (main `c3defe3`+`5382835`+`623962e`). La rama ya tenía `preview-index.ts` (con cache track/asset), `preview-transition.ts` completo y `VideoLayer` con mute de lead; faltaba el cableado final. Port adaptado (no copia): `PreviewClipEntry` ahora lleva `start`/`end` por ventana — visuales corren `previewTransitionLeadFrames` antes del `startFrame` (solape del render), audio/adjustments sin lead; orden por `comparePreviewClips` (track.order, startFrame) igual que `visual_clips`/`adjustment_clips` del export; `activeAt` filtra por comparación numérica por tick. `Preview.tsx` envuelve cada capa en `previewTransitionFrame` (`.preview-transition-layer` + underlay para dip-color/fade, CSS en app.css). Test `preview-clip-windows.test.ts` portado a la API de la rama. Evidencia: preview-clip-windows 5/5, preview-index 6/6, preview-transition 13/13, preview-clip-order 4/4, TransitionPreview 42/42, PreviewMask/TransformBox/Fit 16/16, tsc limpio, architecture-rules 12/12.
- **G9 ✅** speedCurve/reverse en preview (main `7c80096`+`1ea5a48`). Port adaptado: `state/clip-source-time.ts` (+test 12) mapeo salida→fuente compartido por VideoLayer/AudioLayer/playhead-scope (`curveSourceFraction`/`sampleSpeedCurve`/`meanSpeedCurve`, reverse, speed); modo `mean` cuando `clipTransitionLeadActive` — **verificado contra el renderer de la rama** (`range.rs` convierte speedCurve→media y `curve_setpts` devuelve `None` con lead → setpts constante a media; el `curve_knots_stretched` de main actual NO existe en la rama, queda como brecha de renderer documentada). Clips `reverse`: flipbook de seeks por frame (umbral deriva 0.001, audio del elemento en pause) + `useReversedClipAudio`/`reverse-window.ts` (buffer invertido Web Audio enrutado a la cadena de pista; topes honestos >96 MB/>180 s/speedCurve→silencio). `usePreviewAudio.ts` +357 líneas del bloque reversed (deps `chains`/`buildClipFxChain`/`buildClipPanChain` verificadas presentes). Evidencia: clip-source-time 12/12, reversed-clip-audio 17/17, playhead-audio-scope 7/7, preview-transition 13/13, mixer+preview 138/138, tsc limpio.
- **G10 ✅** Filtros de voz Web Audio (main `9ca7962`). `clipVoiceFxSpec(clip.audio)` traduce HP/LP/EQ3/de-esser/puerta/compresor/voiceEffect a `ClipFxSpec` en el orden de `audio_filter` (nuevos casos `clip.hpf`/`clip.lpf`/`clip.eq3` en `buildClipFxChain`); `denoise` queda honestamente export-only. VideoLayer+AudioLayer fusionan voice specs + audioStack; Inspector con textos honestos (preview aproxima, no sample-exacto). Evidencia: clip-audio-fx 14/14 (+8 nuevos), mixer 77/77, tsc limpio.
- **G11 ✅** Denoise espectral en preview (main `820a379`). `clipVoiceFxSpec` emite `clip.denoise` (`nr`=denoise·30 dB, escala `afftdn=nr=`); AudioWorklet inline `spectral-denoise` — STFT 2048/hop 1024, ventana raíz-Hann COLA, perfil de ruido por mínimo con deriva, oversubtraction+piso modulados por nr; fallback passthrough si `addModule` falla. Caso en `buildClipFxChain`, textos honestos en Inspector/Preview, tests actualizados (denoise ya no es export-only). Evidencia: clip-audio-fx 16/16, reversed-clip-audio 17/17, tsc limpio.
- **G12 ✅** Máscara luma-wipe en preview (main `e318a10`+`ea94355`). `preview-luma-mask.ts` (+test 7/7): canvas 160×90 sobre el frame actual del mate → luma→RGBA data URL como `mask-image` del wrapper (equivale al `alphamerge` del render); mate imagen/freeze = estática; sin máscara lista la capa queda `opacity:0` (degradación honesta, nunca inventada). `useLumaWipeMasks` por playhead en Preview.tsx. El fix Rust de `ea94355` (mates en pistas ocultas) **ya estaba** en `preview_frame/timeline.rs:479`. Evidencia: preview-luma-mask 7/7, preview-transition 13/13, TransitionPreview 42/42, tsc limpio.
- **Cola de reconciliación G1–G12: COMPLETA.** Pendiente sólo G13 (CSS split — estado distinto, no brecha funcional).
