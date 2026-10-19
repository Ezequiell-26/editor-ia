#!/usr/bin/env node
/**
 * loop-preflight — deterministic gate for the Editor IA build loop.
 *
 * It answers one question for the next pass: what is the single item worth
 * doing right now, and is the machine in a state where doing it is honest?
 * Exit 0 proceed, 10 nothing actionable, 20 a blocker needs the user, 30 guard.
 */

import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverRustEnv } from './rust-env.mjs';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const loopDir = join(packageRoot, '.editoria-loop');
const ledgerPath = join(loopDir, 'LEDGER.json');
const lockPath = join(loopDir, 'LOCK');

const MIN_FREE_RAM_MB = 700;
const LOCK_STALE_MINUTES = 25;

function readLedger() {
  return JSON.parse(readFileSync(ledgerPath, 'utf8'));
}

function status(task) {
  return task.status;
}

function isReady(task, byId) {
  const deps = task.dependsOn ?? [];
  return deps.every((id) => status(byId.get(id) ?? { status: 'pending' }) === 'done');
}

function lockState(ledger) {
  const active = ledger.loop?.activePass;
  if (!active?.startedAt) {
    return { held: false };
  }
  const ageMinutes = (Date.now() - Date.parse(active.startedAt)) / 60000;
  if (ageMinutes < LOCK_STALE_MINUTES) {
    return { held: true, ageMinutes: Math.round(ageMinutes), taskId: active.taskId };
  }
  return { held: false, staleReleased: true, abandonedTask: active.taskId };
}

function emit(payload, code) {
  console.log(JSON.stringify(payload, null, 2));
  process.exit(code);
}

const ledger = readLedger();
const byId = new Map(ledger.tasks.map((task) => [task.id, task]));

const freeRamMb = Math.round(os.freemem() / 1048576);
const lock = lockState(ledger);

if (lock.held) {
  emit(
    {
      action: 'stop',
      reason: `Hay una pasada en curso sobre la tarea ${lock.taskId}, con ${lock.ageMinutes} minutos. No se duplica el trabajo.`,
      code: 30,
    },
    30,
  );
}

if (freeRamMb < MIN_FREE_RAM_MB) {
  emit(
    {
      action: 'stop',
      reason: `Quedan ${freeRamMb} MB libres por debajo del piso de ${MIN_FREE_RAM_MB} MB. La pasada se saltea para no dejar compilaciones a medias.`,
      code: 30,
    },
    30,
  );
}

if (!existsSync(join(packageRoot, 'node_modules'))) {
  emit(
    {
      action: 'stop',
      reason: 'Falta node_modules. Ejecuta npm install una vez antes de reanudar el loop.',
      code: 30,
    },
    30,
  );
}

if (ledger.loop.consecutiveFailures >= ledger.loop.maxConsecutiveFailures) {
  emit(
    {
      action: 'stop',
      reason: `${ledger.loop.consecutiveFailures} pasadas seguidas sin dejar la suite verde. El loop se detiene hasta intervención humana.`,
      code: 30,
    },
    30,
  );
}

const blocked = ledger.tasks.filter((task) => status(task) === 'blocked');
const done = ledger.tasks.filter((task) => status(task) === 'done').map((task) => task.id);
const actionable = ledger.tasks.filter(
  (task) => status(task) === 'pending' && isReady(task, byId),
);

const rust = discoverRustEnv();

if (actionable.length === 0) {
  if (blocked.length > 0) {
    emit(
      {
        action: 'need-human',
        reason: 'No queda trabajo accionable: lo único pendiente depende de un bloqueador que resuelve el usuario.',
        blockers: blocked.map((task) => ({ id: task.id, title: task.title, remedy: task.remedy })),
        code: 20,
      },
      20,
    );
  }
  emit({ action: 'idle', reason: 'Todas las tareas del ledger están cerradas.', done, code: 10 }, 10);
}

const next = actionable[0];

const token = randomUUID();
ledger.loop.activePass = { token, taskId: next.id, startedAt: new Date().toISOString() };
writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);

emit(
  {
    action: 'task',
    lockToken: token,
    task: {
      id: next.id,
      plan: next.plan,
      title: next.title,
      acceptance: next.acceptance ?? null,
      dependsOn: next.dependsOn ?? [],
    },
    skippedBlocked: blocked.map((task) => task.id),
    rust: {
      ready: rust.ready === true,
      whenReady: rust.ready
        ? {
            msvc: rust.msvcVersion,
            sdk: rust.sdkVersion,
            rcAvailable: rust.rcAvailable,
            alternatives: rust.alternatives,
          }
        : null,
      whenNotReady: rust.ready ? null : { reason: rust.reason, candidates: rust.candidates },
      commandPrefix: 'node scripts/rust-env.mjs --',
      note: rust.ready
        ? 'Todo cargo o rustc se corre a traves del prefijo, nunca con LIB vacio: sin esas variables el link falla con LNK1104 sobre msvcrt.lib.'
        : 'Las tareas Rust no se intentan en esta pasada; se registra blocked con el remedio medido.',
    },
    freeRamMb,
    rules: [
      'Una sola tarea por pasada.',
      'Test primero: la prueba falla antes de escribir la implementación.',
      'El cierre exige: node scripts/loop-record.mjs --task <id> --status done --files "ruta,otra" --note "qué"; loop-record corre npm run verify y rechaza si no da verde o si falta un archivo declarado.',
      'Prohibido: git push, borrar fuera del repo, instalar toolchains, tocar credenciales.',
      'Rutas literales en cualquier operación de archivos; nada derivado de dirname encadenado.',
    ],
    code: 0,
  },
  0,
);
