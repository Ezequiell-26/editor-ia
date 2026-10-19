#!/usr/bin/env node
/**
 * loop-record — cierra la pasada del loop contra evidencia, no contra intención.
 *
 * `--status done` corre `npm run verify` antes de tocar el ledger: si la suite
 * no está verde, la tarea no se marca como hecha y el contador de fallos
 * aumenta. Así el loop no puede reportar progreso fantasma.
 *
 * Uso:
 *   node scripts/loop-record.mjs --task 3 --status done --note "shell React con 4 vistas"
 *   node scripts/loop-record.mjs --task 4 --status blocked --note "sin linker MSVC" --remedy "instalar workload C++"
 *   node scripts/loop-record.mjs --status failed --note "typecheck roto en delivery.ts"
 */

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const ledgerPath = join(packageRoot, '.editoria-loop', 'LEDGER.json');
const lockPath = join(packageRoot, '.editoria-loop', 'LOCK');
const MAX_PASSES_KEPT = 40;

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      out[key] = true;
      continue;
    }
    out[key] = next;
    i += 1;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const status = args.status;
const taskId = args.task;

if (!['done', 'blocked', 'failed', 'noop'].includes(status)) {
  console.error('Falta --status done|blocked|failed|noop');
  process.exit(2);
}

const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
const now = new Date().toISOString();
const task = taskId ? ledger.tasks.find((item) => item.id === taskId) : undefined;

if (taskId && !task) {
  console.error(`La tarea ${taskId} no existe en el ledger.`);
  process.exit(2);
}

let verifyOutput = null;

if (status === 'done') {
  if (!task) {
    console.error('Para marcar done hace falta --task <id>.');
    process.exit(2);
  }
  if (!args.files) {
    console.error('Para marcar done hace falta --files "a.ts,b.ts": sin archivos no hay cierre.');
    process.exit(2);
  }
  const declared = String(args.files)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  const missing = declared.filter((relative) => !existsSync(join(packageRoot, relative)));
  if (missing.length > 0) {
    ledger.loop.consecutiveFailures += 1;
    ledger.passes.unshift({
      at: now,
      taskId,
      status: 'rejected',
      reason: `Se declaró done con archivos que no existen: ${missing.join(', ')}`,
    });
    ledger.passes = ledger.passes.slice(0, MAX_PASSES_KEPT);
    ledger.loop.lastPassAt = now;
    delete ledger.loop.activePass;
    writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
    if (existsSync(lockPath)) {
      rmSync(lockPath);
    }
    console.error(`Se rechazó el cierre de ${taskId}: faltan ${missing.length} archivo(s) declarados.`);
    process.exit(1);
  }
  const verify = spawnSync('npm', ['run', 'verify'], {
    cwd: packageRoot,
    encoding: 'utf8',
    shell: true,
    timeout: 600000,
  });
  verifyOutput = (verify.stdout ?? '') + (verify.stderr ?? '');
  if (verify.status !== 0) {
    ledger.loop.consecutiveFailures += 1;
    ledger.passes.unshift({
      at: now,
      taskId,
      status: 'rejected',
      reason: 'npm run verify no terminó en verde; la tarea sigue pendiente.',
      evidenceTail: verifyOutput.slice(-1200),
    });
    ledger.passes = ledger.passes.slice(0, MAX_PASSES_KEPT);
    ledger.loop.lastPassAt = now;
    delete ledger.loop.activePass;
    writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
    if (existsSync(lockPath)) {
      rmSync(lockPath);
    }
    console.error(`Se rechazó el cierre de ${taskId}: verify falló. Fallos seguidos: ${ledger.loop.consecutiveFailures}.`);
    process.exit(1);
  }
  task.status = 'done';
  task.doneAt = now;
  task.evidence = `verify en verde sobre: ${declared.join(', ')}`;
  task.files = declared;
  ledger.loop.consecutiveFailures = 0;
} else if (status === 'blocked') {
  if (!task) {
    console.error('Para marcar blocked hace falta --task <id>.');
    process.exit(2);
  }
  if (!args.note || !args.remedy) {
    console.error('blocked exige --note (qué bloquea, medido) y --remedy (cómo se resuelve).');
    process.exit(2);
  }
  task.status = 'blocked';
  task.blockedSince = task.blockedSince ?? now;
  task.blockedReason = args.note;
  task.remedy = args.remedy;
} else if (status === 'failed') {
  ledger.loop.consecutiveFailures += 1;
} else {
  ledger.loop.consecutiveFailures = 0;
}

ledger.passes.unshift({
  at: now,
  taskId: taskId ?? null,
  status,
  note: args.note ?? null,
  remedy: args.remedy ?? null,
  verifyRan: status === 'done',
});
ledger.passes = ledger.passes.slice(0, MAX_PASSES_KEPT);
ledger.loop.lastPassAt = now;
delete ledger.loop.activePass;

writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
if (existsSync(lockPath)) {
  rmSync(lockPath);
}

console.log(
  JSON.stringify(
    {
      recorded: status,
      taskId: taskId ?? null,
      consecutiveFailures: ledger.loop.consecutiveFailures,
      tasksDone: ledger.tasks.filter((item) => item.status === 'done').length,
      tasksBlocked: ledger.tasks.filter((item) => item.status === 'blocked').length,
      tasksPending: ledger.tasks.filter((item) => item.status === 'pending').length,
      lockReleased: existsSync(lockPath) === false,
    },
    null,
    2,
  ),
);
