# 2026-11-09 — Re-adquisición de assets generados locales en el repair loop

## Qué

`application/studio_reacquire.rs::reacquire_generated_local` restaura
assets `generated-locally` re-ejecutando su generador con el request
original. Puerto `LocalRegenerator` + dispatcher
`infrastructure/studio/local_regenerator.rs` (provider_id → generador).

## Por qué funciona sin adivinar

- Los generadores derivan el nombre del archivo de `request.request_id`
  (`narracion-{id}.wav`, etc.). Reusar el `externalId` que acquire grabó
  en `resources[]` reproduce el path exacto.
- El mapeo asset→requisito sale de datos persistidos: `source.path` del
  asset = `path` de la entrada acquire; `requirementId` →
  `run.plan.requirements` da kind/query/voice.

## Límites honestos

- Sólo providers locales: `windows-sapi`, `local-ffmpeg-ambient`,
  `local-ffmpeg-titlecard`, `local-ffmpeg-pattern`. `generated-remote`
  excluido (re-gastaría BYOK). `user-imported` y sin provenance también.
- Si el generador falla o el archivo no reaparece → `failed`, el gate
  decide. Nunca se muta el documento en esta vía.
- Consum el mismo tope de repair (MAX_REPAIR_ATTEMPTS = 2) compartido
  con la reparación documental y la vía archive.org.

## Verificación

- `cargo check --tests` 0 errores · `cargo fmt --check` limpio
- `application::production` 13/13 · `studio_*` 22/22 (3 tests nuevos)
- verify-studio 12/12 live + E2E verde pre-cambio; re-corrida completa
  pendiente (se liberó el lock de build).
