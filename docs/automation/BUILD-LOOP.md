# Editor IA — loop de construcción

Automatización recurrente que avanza la app, una tarea por pasada, con evidencia
obligatoria. El estado vive en el repo, no en la conversación: si el loop se
corta, se reanuda leyendo el ledger.

## Piezas

| Archivo | Para qué |
| --- | --- |
| `.editoria-loop/LEDGER.json` | Única fuente de estado: tareas, dependencias, bloqueos medidos, contador de fallos, últimas 40 pasadas. |
| `scripts/loop-preflight.mjs` | Decide la próxima tarea y si la máquina permite hacerla. Imprime JSON y sale con código. |
| `scripts/loop-record.mjs` | Cierra la pasada. Con `--status done` exige `--files` y comprueba que cada archivo exista, y **corre `npm run verify` él solo**: si falta un archivo o la suite no da verde, rechaza el cierre y suma un fallo consecutivo. |
| `scripts/rust-env.mjs` | Descubre un MSVC que linkeé de verdad y exporta `LIB`/`INCLUDE`/`PATH`. Prefijo obligatorio para todo `cargo`/`rustc`. |
| `loop.activePass` dentro de `.editoria-loop/LEDGER.json` | Marca de pasada en curso, escrita por el preflight y borrada por el recorder. Caduca a los 25 minutos, así que un corte no deja el loop trabado. Está en el ledger y no en un archivo aparte: no se puede perder borrando un lock. |

## Código de salida del preflight

| Código | Significado | Qué hace la pasada |
| --- | --- | --- |
| 0 | Hay tarea accionable | Ejecuta exactamente `task.id` |
| 10 | Sin trabajo accionable, todo cerrado | Reporta idle y no toca nada |
| 20 | Lo único pendiente depende de un bloqueador | Reporta el blocker con su remedio y no inventa trabajo |
| 30 | Guard: lock vigente, RAM bajo el piso, `node_modules` ausente o fallos consecutivos | Se detiene y avisa |

## Contrato de cada pasada

1. `npm run loop:preflight` → leer el JSON.
2. Si `action` no es `task`, registrar `--status noop` y terminar.
3. Escribir el test primero y **verlo fallar** por la razón esperada.
4. Implementar lo mínimo para pasar.
5. `npm run verify` (typecheck + 228 tests del esquema + lo nuevo).
6. `npm run loop:record -- --task <id> --status done --files "src/x.ts,src/x.test.ts" --note "qué se hizo"`.
7. Rust, solo así: `node scripts/rust-env.mjs -- cargo test` — nunca `cargo` pelado.

## Guardas duras

- Prohibido `git push`, crear PR, publicar o enviar algo afuera. El loop commitea localmente si hace falta y nada más.
- Prohibido borrar fuera de `D:\Users\ofici\QODER-WORK\editor-ia`. Toda operación de archivos usa ruta literal, no derivada de `dirname` encadenado.
- Prohibido instalar toolchains, workloads de Visual Studio, o cualquier cosa que descargue gigas: se registra `blocked` con el remedio y lo decide el usuario.
- Prohibido escribir credenciales en el repo o en fixtures; el formato ya las rechaza y el loop no pelea contra eso.
- Una sola tarea por pasada. Cero cambios de código no pedidos.
- RAM libre por debajo de 700 MB: la pasada no arranca.

## Condiciones de parada

- 2 fallos consecutivos sin dejar la suite verde → el loop se frena y espera humano.
- Tareas terminadas o sin trabajo accionable → idle notificado.
- Expiración programada en la automatización (14 días desde su creación).

## Estado del entorno, medido 2026-10-18

- `node` 24.14.0 (`.nvmrc` fija 24; CI del Task 7 debe usar el mismo).
- Rust host `x86_64-pc-windows-msvc`, cargo 198.
- **Linker disponible**: BuildTools MSVC 14.44.35207 (también Community 14.43.34808). Verificado con un `rustc` real que compiló, linkeó y ejecutó. Con `LIB` vacío falla `LNK1104: no se puede abrir el archivo 'msvcrt.lib'` — por eso existe el prefijo.
- **Hueco medido**: `rc.exe` no está en ninguno de los tres toolchains. `cargo check` y `cargo test` funcionan igual; lo que puede necesitar el compilador de recursos es embeber manifiesto/íconos al empaquetar Tauri. Si una tarea choca con eso, se registra `blocked` con este texto como remedio y no se instala nada.
- 14.51.36231 tiene `link.exe` pero le falta `lib/x64/msvcrt.lib`: el descubrimiento lo descarta solo, no hay que recordarlo.
- SDK usado por el prefijo: 10.0.28000.0 (el más nuevo que trae `Lib/ucrt/x64` e `Include/ucrt`).
- RAM: 13,9 GB total, rondando 1,3–1,6 GB libres con el escritorio abierto.
- 109→33 plugins de Qoder activos tras el tuneo; no vuelve a tocar `settings.json`.

## Controlar la automatización

Tarea local creada en Qoder: **Editor IA · build loop**, `jobId`
`6eefd0fd-8415-4ee1-90cf-39f1545511f9`. Cadencia 20 minutos, ancla
19:45 (America/Argentina/Buenos_Aires), expira el 2026-11-01 20:00, ejecuta en
`D:\Users\ofici\QODER-WORK\editor-ia` con Full Access y una conversación por
pasada (`independent`).

Para pausarla, frenarla, cambiar la cadencia o forzar una pasada, pedirlo en el
chat; se opera con `disable`, `remove`, `update` o `run` sobre ese `jobId`.
Detener no revierte los archivos ya escritos: eso se revisa con `git diff` y se
deshace con `git checkout -- <ruta literal>`.

## Cómo agregar trabajo

Editar `LEDGER.json` → `tasks[]` con `id`, `title`, `status: pending`, y
`acceptance` escribible como test. El orden de ejecución es el del array,filtrado
por `dependsOn`. Un `blocked` exige `note` y `remedy` medidos, no opinión.
