# Automatización de mejora continua — Olyvia en Devin

Estado al 2026-11-07. Tres capas; dos funcionan hoy, una queda lista para cuando el plan de Devin habilite CLI.

## Capa 1 — Loop dentro de la sesión (ACTIVA)

- Centinela shell en background que emite `AGENT_LOOP_TICK_olyvia24` cada 5 s.
- Cada tick despierta al agente, que ejecuta una pasada del protocolo
  `.devin/skills/editor-ia-dev-loop` (un ítem por vuelta, tests, docs,
  commit local sin push).
- **Vive mientras la sesión de Devin esté abierta.** Si la sesión muere,
  se rearranca con:

  ```powershell
  while ($true) { Write-Output "AGENT_LOOP_TICK_olyvia24 $(Get-Date -Format HH:mm:ss)"; Start-Sleep 5 }
  ```

  o en bash: `while true; do echo "AGENT_LOOP_TICK_olyvia24 $(date +%H:%M:%S)"; sleep 5; done`

## Capa 2 — Tarea programada de Windows (CONFIGURADA, BLOQUEADA POR PLAN)

- Tarea `OlyviaDevinLoop` en Task Scheduler: cada 5 min, modo interactivo,
  arranca al iniciar sesión de Windows.
- Corre `scripts/devin-loop.ps1` → `devin.exe --print` con
  `scripts/devin-loop-prompt.md` (1 mejora acotada, sin push, respeta WIP).
- Lock anti-solape + timeout 45 min + logs en `logs/devin-loop-*.log`.
- **Bloqueo**: `devin.exe auth status` = "Not logged in" → `can_use_cli`
  no está habilitado en el plan actual de Devin (verificado 2026-11-07:
  credenciales válidas escritas por browser y por API key, ambas
  rechazadas por el servidor).
- **Se activa solo** cuando el plan incluya CLI: las credenciales ya
  están en `%APPDATA%\devin\credentials.toml` y el script ya chequea auth.
- Workaround de permisos ya aplicado: `%APPDATA%\devin` es junction a
  `D:\DevData\...` con ACL RX; se otorgó Full a `ofici` vía
  `fix-devin-acl.bat` (temporal, en %TEMP%).

## Capa 3 — Guardia y configuración del equipo (.devin/)

- `agents/`: architect, frontend-engineer, rust-media-engineer,
  security-engineer, qa-engineer, ux-designer (modelos pineados).
- `skills/`: `editor-ia-architecture`, `editor-ia-dev-loop` — se invocan
  solas cuando la tarea aplica.
- `hooks.v1.json` + `scripts/devin-hooks-guard.mjs`: PreToolUse bloquea
  `git reset --hard`, `git clean`, force-push, `rm -rf` amplio,
  `--no-verify`, escritura a secretos.
- `config.json`: permissions allow/deny (verificación auto-aprobada,
  deny a `.env*`, `*.pem`, `*.key`, Cargo.lock).
- `mcp_config.json`: context7 + playwright (scope proyecto, commiteado).

## Reglas duras del loop (recordatorio)

- Un ítem por pasada desde `docs/CAPABILITY-MATRIX.md` §7 o
  `docs/IMPROVEMENT-QUEUE.md`.
- Tests primero; typecheck + tests del módulo antes de commitear.
- Commits locales OK; **nunca push** sin pedido explícito del usuario.
- Nunca `reset --hard`/`clean` ni tocar WIP ajeno (regla one-writer).
- Rust siempre vía `node scripts/rust-env.mjs -- cargo ...` con
  `CARGO_HOME=D:\Users\ofici\cargo-home` (el cache original es read-only).
- App en uso: no instalar el exe hasta que el usuario la cierre.

## Verificación del estado

```powershell
# ¿la tarea programada está viva?
schtasks /query /tn OlyviaDevinLoop
# ¿el CLI tiene auth?
& "D:\Devin\resources\app\extensions\windsurf\devin\bin\devin.exe" auth status
# ¿últimas pasadas?
Get-Content logs\devin-loop-*.log -Tail 10
```
