# ADR — Alcance de `vendor/concat` en la app y scope de ContentGenerator video/SFX

Fecha: 2026-11-13. Estado: decisión tomada; la ejecución (recorte de deps +
mover tests de seam) queda como siguiente paso de código.

Complementa a `2026-11-13-concat-export-vision.md` (qué crates upstream
integrar). Este ADR decide qué crates **ya vendorados** pesan en el build
de la app y qué kinds de `StudioResourceKind` quedan soportados para
generación.

## Contexto verificado

### Deps declaradas en `apps/desktop/src-tauri/Cargo.toml` (líneas 76-99)

`concat-core`, `concat-project`, `concat-effects`, `concat-speech-min`,
`concat-text`, `concat-log`, `concat-render` — todas por `path` a
`vendor/concat/crates/`.

`apps/concat-worker/Cargo.toml` sólo usa `concat-core` + `concat-media`
(líneas 19-22); su `render_export` es pipeline propio y no toca los crates
de composición.

### Uso real en `apps/desktop/src-tauri/src`

| Crate | Consumidor productivo | Sólo tests |
|---|---|---|
| `concat-effects` | `render/ffmpeg/visual/effects.rs:140-142` (`Catalogue::ffmpeg_fragment` para audio) | — |
| `concat-speech-min` | `commands/domains/audio/transcribe.rs:45`, `application/transcribe.rs:201,303,330`, `subtitles_pipeline.rs:109` | — |
| `concat-core` / `concat-project` | ninguno directo (entran igual por transitividad: effects→project→core) | `vendor_concat.rs:31-82` |
| `concat-text` | ninguno | `vendor_concat.rs:110-143` (`render_frame` título→RGBA) |
| `concat-log` | ninguno | `vendor_concat.rs:160-173` (`bytes()`) |
| `concat-render` | ninguno (ni `plan_frame` ni `WgpuCompositor`) | `vendor_concat.rs:146-157` (`plan_frame` timeline vacío) |

`vendor_concat.rs` es sólo un seam de re-export + tests; ningún módulo de
producción llama `concat_render`, `concat_text` ni `concat_log`.

### Costo de build

- `concat-render` arrastra `wgpu` 30 + `pollster` + `half`. En
  `Cargo.lock` el subárbol wgpu suma **~147 crates** (wgpu, wgpu-core,
  wgpu-hal, wgpu-types, naga, wgpu-naga-bridge + backends). Es el costo
  de compilación más grande de todo `vendor/concat` y hoy produce **cero
  binario útil**: el compositor GPU no se instancia en ningún camino.
- `concat-text` suma fontdb + rustybuzz + ttf-parser + tiny-skia + png +
  unicode-* (~30-40 crates), también sólo para tests.
- `concat-log` es trivial (`log` + `windows-sys`); quitarlo no mueve la
  aguja pero tampoco aporta.
- `concat-core`/`concat-project`/`concat-effects` quedan igual en el
  grafo por transitividad de `concat-effects` (que sí tiene consumidor
  productivo). Sacarlos del `Cargo.toml` de la app no los saca del build.
- `concat-media` ya está fuera del árbol de la app por el conflicto
  `links = "ffmpeg"` (NOTICE.md:77-83); vive sólo en el worker.

### Licencia

AGPL-3.0-or-later (`vendor/concat/LICENSE`, `NOTICE.md:6-8`). Vendorizar
no es el problema — el problema es pagar wgpu en cada build sin uso. La
licencia no cambia con la decisión de scope.

## Opciones evaluadas

**a) Integrar `concat-render`/`plan_frame` al pipeline de render.**
El render de la app es un grafo de filtros FFmpeg
(`render/ffmpeg/**`), no un modelo timeline→frame-plan. Adoptar
`plan_frame` implicaría reescribir la composición sobre `concat-core`'s
`Timeline` o mantener dos modelos. `WgpuCompositor` además exige GPU en
el camino de export (o fallback software ya contemplado, pero igual es
superficie nueva). Costo: semanas + ~147 crates permanentes + driver GPU
en CI/usuarios. Beneficio hoy: ninguno — `render_export` del worker ya
cubre transiciones/speed/crossfade nativamente. **Rechazada por ahora**;
reabrir sólo si el worker adopta composición GPU (ver ADR
concat-export-vision, que ya decidió worker-first por el conflicto
`links="ffmpeg"`).

**b) Usar `concat-text`/`concat-log` donde aporten.**
- `concat-text`: rasteriza `TitleStyle` a RGBA con fuentes bundled. La app
  ya resuelve títulos/subtítulos por la vía FFmpeg
  (`commands/domains/creator/subtitles_pipeline.rs`) y tiene
  `local_titlecard` para el studio. Un consumidor real de `concat-text`
  sería un overlay de preview en GPU — que no existe (ver a). Sin
  consumidor, integrar es mantener una segunda pipeline de texto.
- `concat-log`: log por run de Concat. La app tiene su propio logging;
  `concat-log` no resuelve nada que falte. **Rechazada** como integración;
  queda vendorada por si un futuro port de export la necesita.

**c) Sacar del árbol de deps de la app los que no se usan.**
Quitar `concat-render`, `concat-text` y `concat-log` de
`apps/desktop/src-tauri/Cargo.toml` y mover los tests de seam de Fase D
(`vendor_concat.rs:107-173`) al workspace de `vendor/concat` (que ya tiene
suite propia y corre en CI — tracker F8). Ahorro estimado: ~150-190
crates fuera del build de la app (wgpu + texto), menos tiempo de
`cargo build`/`cargo test` y menos superficie de `cargo audit`.
`concat-core`/`concat-project`/`concat-effects`/`concat-speech-min` se
quedan: los dos últimos tienen consumidor productivo y los dos primeros
entran por transitividad de `concat-effects` de todas formas.
**Adoptada.**

**d) Status quo.**
Sigue pagando wgpu+rustybuzz en cada build para tres re-exports usados
sólo por tests. **Rechazada.**

## Decisión 1 — vendor scope

Adoptar **(c)**: la app declara sólo `concat-effects` y
`concat-speech-min` (más `concat-core`/`concat-project` si se quiere el
seam explícito; son transitivos igual). `concat-render`, `concat-text` y
`concat-log` quedan **vendorados pero fuera del `Cargo.toml` de la app**,
con sus tests de seam reubicados en `vendor/concat`. Reapertura:
`concat-render` sólo vuelve a la app si aparece un consumidor real
(compositor GPU del worker o preview); `concat-text` sólo si se construye
ese overlay. Headers SPDX/AGPL intactos en todos los casos.

## Decisión 2 — ContentGenerator para `video`/`audio`/`sfx`/`animation`/`graphic`

Estado verificado: `studio_capabilities` (`infrastructure/mcp_studio.rs:242-308`)
reporta honestamente `unsupported_capability` para esos 5 kinds; los
soportados son `image` (local_pattern, local_titlecard, remote_image),
`music` (local_music) y `voice` (local_voice, remote_voice).

Evaluación por kind:

- **`sfx` — implementar (barato, base real).** `scripts/generate-sfx.mjs`
  sintetiza proceduralmente 8 WAV (boom, click, ding, glitch, pop, riser,
  subdrop, woosh) sin samples de terceros → sin problemas de licencia;
  ya se empaquetan en `resources/sfx/` y `sfx_library`
  (`commands/domains/audio/sfx.rs`) los sirve a la UI. Falta sólo el
  adaptador `ContentGenerator`: un `local_sfx` que mapee
  `prompt`/`params` al catálogo (o a una síntesis paramétrica futura en
  Rust). Cierra `unsupported_capability` con trabajo chico y honesto.
  Síntesis paramétrica por prompt queda como v2, no bloquea.
- **`graphic` — implementar vía providers existentes.**
  `local_titlecard` ya genera tarjetas/títulos como imagen; declarar la
  capability `Graphic` en ese provider (y eventualmente `local_pattern`
  para lower-thirds) es un cambio de declaración, no de motor. Honesto:
  un "graphic" de plan = imagen compuesta, que es exactamente lo que esos
  providers producen.
- **`animation` — permanently unsupported por ahora.** No hay generador
  de secuencias/animación; la adquisición (`project-assets`,
  `internet-archive` si `mediatype_for` mapea) sigue disponible. Reevaluar
  si aparece un caso de uso concreto (p.ej. image-to-video local, que hoy
  no existe en el repo).
- **`audio` (genérico) — permanently unsupported.** El kind `audio` es
  ambiguo: música→`local_music`, voz→`local_voice`, sfx→`local_sfx`. Un
  plan que pida `audio` debería pedir el subtipo concreto; declarar un
  provider "audio genérico" sería prometer de más. La matriz ya lo dice.
- **`video` — permanently unsupported (generación).** No hay provider
  local realista (no hay modelo de video-gen en el repo ni dependencia
  liviana que lo dé) y ningún provider remoto configurado (los remotos
  existentes son BYOK OpenAI-compatible para imagen/voz; no hay endpoint
  de video equivalente en uso). Un `remote_video` sólo tendría sentido
  cuando se elija un proveedor concreto (Veo/Kling/etc.) con su contrato
  de coste — mismo patrón que `remote_image`/`remote_voice`, pero hoy no
  hay nada que implementar sin inventar una API. La adquisición de video
  sigue cubierta por `project-assets` e `internet-archive`.

**Decisión:** implementar `local_sfx` (catálogo existente) y declarar
`Graphic` en los providers de imagen que ya lo producen; declarar
`video`, `audio` y `animation` como `unsupported_capability` **permanente
salvo nueva evidencia** (provider remoto elegido o modelo local). La
matriz actual ya reporta esto honestamente; la decisión evita trabajo
especulativo y deja el camino claro para `remote_video` si aparece un
proveedor.

## Consecuencias

- Build de la app más liviano (~150-190 crates menos tras el recorte) y
  menos superficie AGPL compilada en el binario principal — aunque el
  código siga en el repo bajo AGPL, no se compila ni se distribuye.
- `vendor/concat` conserva todo el código y su suite; el recorte es de
  `Cargo.toml`, no de vendor.
- `studio_capabilities` mejorará solo al registrar `local_sfx` y las
  capabilities `Graphic`: la matriz se deriva de lo declarado, no hay que
  tocarla.
- Riesgo bajo: los crates recortados no tienen consumidor productivo
  verificado por grep; sus tests se mueven al workspace vendor donde ya
  corren en CI.

## Verificación pendiente (ejecución)

- Quitar las 3 deps de `apps/desktop/src-tauri/Cargo.toml`, mover/ajustar
  los tests de seam de Fase D, `cargo build` + `cargo test` verdes.
- `cargo tree`/`Cargo.lock` para medir el ahorro real de crates.
- Implementar `local_sfx` y capabilities `Graphic` (tarea de código
  separada; este ADR sólo fija el scope).
