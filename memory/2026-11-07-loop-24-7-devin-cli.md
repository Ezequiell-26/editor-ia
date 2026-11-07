# 2026-11-07 — Automatización 24/7 del loop Olyvia (Devin CLI + Task Scheduler)

## Hallazgo

Devin CLI existe dentro del IDE: `D:\Devin\resources\app\extensions\windsurf\devin\bin\devin.exe`
(v3000.12.17). Soporta `--print` no interactivo, `--permission-mode`,
`--respect-workspace-trust false`, `--export` (ATIF) y `auth login/status`.

## Implementado

- `scripts/devin-loop-prompt.md`: prompt permanente de la pasada (una
  mejora acotada por ejecución, reglas duras: sin push, sin reset --hard,
  commits locales OK, Rust vía rust-env + CARGO_HOME overlay).
- `scripts/devin-loop.ps1`: runner de UNA pasada — lock file anti-solape,
  auth check, timeout 45 min, logs en `logs/devin-loop-YYYYMMDD.log`,
  export ATIF por sesión.
- Tarea programada `OlyviaDevinLoop`: cada 5 min, sesión interactiva.
- `.gitignore`: `logs/`.
- El centinela de sesión (5 min) sigue activo en paralelo para cuando
  haya sesión abierta; la tarea sobrevive reinicios (arranca al iniciar
  sesión de Windows).

## Pendiente manual (único paso)

`devin.exe auth login` — el CLI reporta "Not logged in". Es interactivo
(browser OAuth o token manual). Ejecutar una vez en terminal:

```
"D:\Devin\resources\app\extensions\windsurf\devin\bin\devin.exe" auth login
```

Hasta entonces cada disparo de la tarea loguea SKIP en
`logs/devin-loop-*.log`.

## Riesgo asumido

`--permission-mode dangerous` (yolo) para ejecución sin supervisión.
El prompt file contiene las guardas (sin push, sin destructivo), pero un
agente con bypass puede ejecutar cualquier comando. Si se prefiere más
caution, cambiar el default del script a `smart` (auto-aprueba edits,
modelo decide el resto) — puede no estar disponible en la cuenta.
