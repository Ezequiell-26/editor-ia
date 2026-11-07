---
name: editor-ia-dev-loop
description: Protocolo del loop de mejora de Editor IA / Olyvia — preflight, ledger, cola de mejora, memoria y cómo cerrar una pasada con evidencia. Usar en pasadas autónomas (devin-loop) o cuando el usuario diga "seguí"/"mejorá la app".
triggers:
  - user
  - model
---

# Loop de desarrollo de Editor IA

## Al iniciar una pasada

1. Leé `CLAUDE.md` (raíz), `docs/IMPROVEMENT-QUEUE.md` (ítems pendientes), `memory/` (últimas 2-3 entradas) y `.editoria-loop/LEDGER.json`.
2. `git status --short --branch` + `git log --oneline -10`. El árbol tiene trabajo del usuario sin commitear: es sagrado.
3. Corré `npm run loop:preflight` si la pasada viene del loop automatizado; respetá sus bloqueos (RAM, fallos consecutivos, lock). NO falsifiques el ledger ni dupliques una pasada activa.

## Elegir trabajo

- Un ítem por pasada. Prioridad: bugs reproducibles > regresiones > features incompletas > calidad/rendimiento.
- Si la cola está cerrada, buscá una brecha demostrable en CAPABILITY-MATRIX (filas ❌/🟡) o en código; definí criterio de aceptación ANTES de implementar.
- Nada de repetir features ya implementadas (verificá en CAPABILITY-MATRIX y en el código).

## Ejecutar

- Tests primero cuando sea práctico. Cambios chicos y verificables.
- Rust: solo `node scripts/rust-env.mjs -- cargo ...` (+ `CARGO_HOME=D:\Users\ofici\cargo-home` si hay ACL).
- Verificación mínima al cerrar: typecheck del área tocada + tests del módulo. `npm run verify` completo solo si el costo lo permite.
- Si la suite falla por causa preexistente/ajena, documentá la evidencia; no la etiquetes verde.

## Cerrar la pasada

1. Registrar en el mecanismo existente (`loop:record` y/o `docs/IMPROVEMENT-QUEUE.md`): qué se hizo, archivos tocados, comandos y resultados reales, próximo paso.
2. Entrada en `memory/AAAA-MM-DD-<tema>.md` si el cambio es significativo.
3. Informe corto: cambio, pruebas ejecutadas, bloqueo real si lo hay.
4. Commits locales: solo si el protocolo de la pasada los permite (devin-loop-prompt los autoriza; el CLAUDE.md general NO — ante la duda, no commitear).

## Prohibido siempre

`git reset --hard`, `git clean`, borrados masivos, revertir cambios ajenos, push/merge/publicación/deploy, instalar/reemplazar la app en uso, imprimir secretos, declarar tests que no corriste.
