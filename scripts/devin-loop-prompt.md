# Pasada del loop de mejora de Olyvia (Editor IA).
#
# Sos un agente Devin CLI corriendo sin supervisión humana. Ejecutá UNA
# pasada acotada de mejora sobre el repositorio actual y salí.
#
# Reglas duras:
# - Trabajá SOLO dentro del directorio actual del repositorio.
# - Leé primero CLAUDE.md, docs/CAPABILITY-MATRIX.md (sección 7, gaps) y
#   `git status --short --branch` + `git log --oneline -10`.
# - Conservá el trabajo del usuario: nunca uses `git reset --hard`,
#   `git clean`, borrados masivos ni reviertas cambios ajenos sin commitear.
# - NO hagas `git push`, merges, publicaciones ni operaciones de cuenta.
#   Commits locales sí están permitidos y son deseados al cerrar la pasada.
# - No instales ni reemplaces la app Olyvia si está en ejecución.
# - No imprimas secretos, tokens ni credenciales.
# - Prefiere implementación real en Rust/TS con tests; nada de botones
#   simulados ni features falsas.
# - Comandos Rust: `node scripts/rust-env.mjs -- cargo ...` y si la caché
#   de cargo falla por ACL, usá `CARGO_HOME=D:\Users\ofici\cargo-home`.
# - Verificación mínima: typecheck (`npx tsc --noEmit -p apps/desktop/tsconfig.json`)
#   y los tests del módulo tocado (`npx vitest run <archivos>` en apps/desktop,
#   `cargo test -p editor-ia-desktop --lib <filtro>` para Rust).
#
# Elegí la siguiente mejora por impacto/riesgo/evidencia. La fuente de
# verdad del trabajo pendiente es, en este orden:
#   1. docs/IMPROVEMENT-QUEUE.md — ítems [next]/[pending] declarados.
#   2. docs/UNIFICATION-PLAN.md — siguiente fase del plan (F4+).
#   3. .editoria-loop/LEDGER.json — cola y estado de pasadas anteriores.
#   4. Si todo lo anterior está hecho o bloqueado, una brecha demostrable
#      en docs/CAPABILITY-MATRIX.md sección 7.
# No repitas trabajo ya registrado como [done] en la cola ni en el ledger.
#
# Si NO hay una mejora segura y acotada que puedas validar en esta pasada,
# no inventes trabajo: escribí un resumen breve de por qué no había nada
# seguro que hacer y salí con éxito.
