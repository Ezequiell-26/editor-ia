# 2026-11-08 — Microbenchmark LTO vs sin-LTO en `analyze_pcm` (Editor IA)

Pasada del loop de mejora (Devin CLI). Cierra el pendiente «microbenchmark de
un comando Rust CPU-bound para cuantificar el LTO del perfil release»
(`docs/IMPROVEMENT-QUEUE.md`, cierre de la ola de rendimiento 2026-11-03/04).

## Qué ya existía (WIP de pasada anterior, sin commitear)

- `Cargo.toml`: perfil `[profile.release-nolto]` (hereda `release`, `lto=false`).
- `commands/audio_scopes.rs`: test `bench_analyze_pcm_throughput` con
  `#[ignore]` — 30 s de PCM sintético (2 senos + ruido LCG), 3 iteraciones
  tras warmup, reporta wall time y × tiempo real.

## Medición ejecutada (esta sesión)

Binarios del lib-test compilados en cada perfil
(`cargo test --release` y `--profile release-nolto`, ambos ~6–7 min de
compilación) y 4 corridas por perfil alternadas para reducir ruido:

| Perfil | Corridas (× realtime) | Media aprox. |
|---|---|---|
| `release` (lto thin, cgu=4) | 443,4 · 455,2 · 440,4 · 457,8 | ~449× |
| `release-nolto` | 451,3 · 455,8 · 453,0 · 457,7 | ~454× |

## Resultado honesto

**LTO no muestra ganancia medible** en este camino CPU-bound: las
distribuciones se solapan por completo (la media de release-nolto es ~1 %
*mayor*, dentro del ruido). La ganancia del perfil release con LTO thin es
nula para DSP como `analyze_pcm` (FFT radix-2 + ventanas), coherente con la
medición CDP previa de que el arranque tampoco mejoró. El coste conocido
sigue siendo +0,57 % de tamaño del exe y +~3 min de build limpio.

Conclusión para futuras pasadas: no esperar ganancia de rendimiento por
activar LTO «fat»; si se busca CPU-bound, mirar codegen-units=1 o el
algoritmo mismo (SIMD ya viene de filmcraft-audio-dsp).

## Verificación

- `cargo test --release -p editor-ia-desktop --lib audio_scopes -- --ignored --nocapture` → bench ok (443,4×).
- `cargo test --profile release-nolto -p editor-ia-desktop --lib audio_scopes -- --ignored --nocapture` → bench ok (451,3×).
- Binarios re-ejecutados directo 3 veces por perfil (PATH con los dll de
  ffmpeg del profile correspondiente): resultados de la tabla.
- Tests no-ignorados del módulo en ambos perfiles: **8 passed / 0 failed /
  1 ignored** cada uno.

## Archivos

- `Cargo.toml` (perfil release-nolto), `apps/desktop/src-tauri/src/commands/audio_scopes.rs`
  (bench), esta entrada de cola y esta memoria.
