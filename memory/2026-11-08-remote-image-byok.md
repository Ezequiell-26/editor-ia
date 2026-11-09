# 2026-11-08 — Generación remota de imágenes BYOK (`gen:`)

## Qué se hizo

- `infrastructure/studio/remote_image.rs` (nuevo): `RemoteImageGenerator`
  implementa `ContentGenerator` para `StudioResourceKind::Image` contra
  `{base}/images/generations` OpenAI-compatible. Reutiliza el BYOK del
  provider de chat: `ProviderConfig` (kind/base_url/model) + clave del
  Credential Manager (`KeyringProviderSecrets`). Cero settings nuevas.
- Convención: requisito `image` con `query = "gen:<prompt>"` → generación
  remota en la etapa `acquire`. Sin generador configurado o sin presupuesto
  (endpoint no-local) ⇒ insatisfecho con razón, nunca cae a stock en silencio.
- Política de coste: remoto exige `remaining_budget_cents > 0` (plan con
  `maxCostCents`); loopback no. La API no devuelve coste → `costCents: null`,
  capability `estimated_cost_cents: null`.
- Derechos honestos: asset con `license.id="provider-terms"`,
  `commercialUse="unknown"`, `origin="generated-remote"` → quality gate lo
  marca para revisión.
- `register_asset_with_rights` refactoriza `register_generated_asset_typed`
  (los 4 providers locales conservan `generated-locally`/`user-generated`/`allowed`).
- `AppState::remote_image_generator()` + `studio_capabilities` reporta
  `remoteImage` {configured, requiresNetwork, capabilities} sin exponer clave.

## Detalles de implementación

- `response_format:"b64_json"` con UN reintento sin él en 400/415/422.
- Respuesta: `data[0].b64_json` (decode+magic) o `data[0].url` (GET con auth,
  https obligatorio salvo loopback, sin userinfo, ≤32 MB, magic validado).
- Formatos aceptados por magic: png/jpg/gif/webp. `params.size` ∈ whitelist.
- Salida: `<project>/generated/<request_id>.<ext>`.
- Tests con servidor HTTP síncrono propio (std::net) — NO reutiliza el
  test_server de `ai` porque ése es tokio y `reqwest::blocking` no puede
  correr dentro de un runtime.

## Verificación

- `remote_image`: 6/6 · `project_executor`: 8/8 (+2 gen:) · `studio::` 70/70.
- `cargo check --tests` exit 0 · `cargo fmt` limpio.

## Pendiente

- E2E real con provider de imagen y clave del usuario (los tests cubren el
  protocolo HTTP contra servidor local; falta una corrida con credencial real).
- Vídeo/voz/música remotos; planner que emita `gen:` solo.

## CAUSA RAÍZ del problema recurrente de junctions (2026-11-09)

`editor-ia-architecture/node_modules` es un **symlink al node_modules del repo
hermano** (`editor-ia/node_modules`): los dos worktrees COMPARTEN un solo
node_modules y cualquier `npm install` en cualquiera reescribe los links
`@editor-ia/*` ("revirtiéndolos").

Reglas para builds de este worktree:
- Los 4 links `@editor-ia/{desktop,effect-kit,project-schema,render-worker}`
  deben ser **junctions NTFS** a las rutas de ESTE worktree
  (`New-Item -ItemType Junction` en PowerShell). NO usar `ln -s` de MSYS:
  copia el directorio entero (un intento copió ~330 MB de apps/desktop).
- `mklink /J` desde bash falla por escape; usar PowerShell.
- `tauri build` usa `CARGO_HOME` default `D:\DevCache\Rust\cargo` que da
  "Acceso denegado" al escribir el registry; usar
  `CARGO_HOME=D:\Users\ofici\cargo-home` (el de rust-env.mjs).
