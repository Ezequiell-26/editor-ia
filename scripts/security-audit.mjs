#!/usr/bin/env node
/**
 * Auditoría de seguridad del repo.
 *
 * 1. `npm audit --omit=dev --json`: resume vulnerabilidades por severidad y
 *    FALLA si hay `critical` o `high` no exceptuadas.
 * 2. `cargo audit --json` si está instalado (`cargo install cargo-audit`):
 *    mismo criterio. Si no está, se reporta SKIPPED — es una herramienta
 *    opcional que requiere instalación previa.
 *
 * Reglas del gate:
 * - Un escáner que no puede ejecutarse (error de red, JSON inválido, db de
 *  advisories caída) NO equivale a "sin vulnerabilidades": se reporta ERROR
 *  y el gate falla. Un escaneo no ejecutado nunca puede confundirse con una
 *  auditoría limpia.
 * - `cargo-audit` ausente es SKIPPED honesto (herramienta opcional), no OK.
 * - Las excepciones viven en `scripts/security-audit-allowlist.json` con
 *  paquete, severidad, advisory, motivo, owner y vencimiento. Una excepción
 *  vencida o incompleta no cuenta. `critical` también puede exceptuarse sólo
 *  por este mecanismo auditable.
 * - `--omit=dev` es la pasada que bloquea: las dependencias de desarrollo
 *  no se empaquetan en la app. Encima corre un segundo `npm audit` sobre
 *  el árbol completo (SEC-GATE-003) que reporta los paquetes sólo-dev con
 *  sus severidades como INFO — visibles para revisión, sin bloquear el
 *  gate de runtime.
 *
 * Uso: `npm run audit:security`.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const IS_WIN = process.platform === 'win32';
const HERE = dirname(fileURLToPath(import.meta.url));
// En Windows npm/cargo son .cmd/.exe: hace falta shell para resolver npm.cmd
// (Node >=18.20 bloquea spawn de .cmd sin shell). Los args son literales, sin
// entrada del usuario, así que no hay superficie de inyección.
const NPM = IS_WIN ? 'npm.cmd' : 'npm';
const CARGO = IS_WIN ? 'cargo.exe' : 'cargo';
const SHELL = IS_WIN;

function run(cmd, args) {
  try {
    return execFileSync(cmd, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: SHELL,
    });
  } catch (error) {
    // npm audit / cargo audit devuelven exit != 0 cuando encuentran
    // vulnerabilidades: el JSON igual viene en stdout.
    if (error.stdout) return error.stdout;
    throw error;
  }
}

// --- excepciones auditables (owner + vencimiento obligatorios) ---
function loadExceptions() {
  const path = join(HERE, 'security-audit-allowlist.json');
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return { list: [], problems: [] };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { list: [], problems: [`${path}: JSON inválido — ninguna excepción cuenta`] };
  }
  const today = new Date().toISOString().slice(0, 10);
  const list = [];
  const problems = [];
  for (const e of parsed.exceptions ?? []) {
    const missing = ['package', 'severity', 'advisory', 'reason', 'owner', 'expires'].filter((k) => !e?.[k]);
    if (missing.length) {
      problems.push(`excepción incompleta (${missing.join(', ')}): ${JSON.stringify(e)}`);
      continue;
    }
    if (e.expires < today) {
      problems.push(`excepción vencida ${e.expires}: ${e.package} (${e.severity})`);
      continue;
    }
    list.push(e);
  }
  return { list, problems };
}

// SEC-GATE-006: una excepción sólo cubre el advisory que nombra —
// package+severity ya no alcanzan para silenciar OTRO advisory del
// mismo paquete. `advisory` es obligatorio (ver loadExceptions).
const GHSA_RE = /GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}/i;

/// ID de advisory de una entrada `via` de npm audit: el GHSA de la URL
/// o, en su defecto, el `source` numérico de la base de datos de npm.
function npmAdvisoryId(via) {
  if (!via || typeof via === 'string') return null;
  const match = String(via.url ?? '').match(GHSA_RE);
  if (match) return match[0];
  if (via.source != null) return `npm:${via.source}`;
  return null;
}

const isExcepted = (exceptions, pkg, severity, advisoryId) =>
  exceptions.some(
    (e) =>
      e.package === pkg &&
      e.severity === severity &&
      advisoryId != null &&
      e.advisory === advisoryId,
  );

/// Un paquete de `npm audit` puede agrupar varios advisories en `via`:
/// sólo se considera exceptuado si TODOS ellos están cubiertos; si queda
/// alguno sin excepción, el paquete bloquea y se listan los sueltos.
function uncoveredAdvisories(exceptions, name, vuln) {
  const vias = (vuln.via ?? []).filter((x) => x && typeof x !== 'string');
  const units = vias.length
    ? vias.map((via) => ({
        severity: via.severity ?? vuln.severity ?? 'info',
        advisoryId: npmAdvisoryId(via),
        title: via.title ?? via.url ?? 'ver detalle',
      }))
    : [{ severity: vuln.severity ?? 'info', advisoryId: null, title: 'ver detalle' }];
  return units.filter((u) => !isExcepted(exceptions, name, u.severity, u.advisoryId));
}

let failed = false;
const statuses = [];

function status(name, state, detail) {
  statuses.push(`${name}: ${state}`);
  console.log(`SECURITY-AUDIT[${name}]: ${state}${detail ? ` — ${detail}` : ''}`);
  if (state === 'FAIL' || state === 'ERROR') failed = true;
}

const { list: exceptions, problems: exceptionProblems } = loadExceptions();
for (const p of exceptionProblems) console.warn(`SECURITY-AUDIT[allowlist]: ${p}`);

// --- npm audit (solo dependencias de producción) ---
const prodVulnNames = new Set();
console.log('SECURITY-AUDIT: npm audit --omit=dev');
try {
  const out = run(NPM, ['audit', '--omit=dev', '--json']);
  let report;
  try {
    report = JSON.parse(out);
  } catch {
    throw new Error('salida no-JSON de npm audit');
  }
  const vulns = report.vulnerabilities ?? {};
  for (const name of Object.keys(vulns)) prodVulnNames.add(name);
  const meta = report.metadata?.vulnerabilities ?? {};
  const counts = { critical: 0, high: 0, moderate: 0, low: 0, info: 0 };
  const blocking = { critical: [], high: [] };
  let exceptedCount = 0;
  for (const [name, v] of Object.entries(vulns)) {
    const sev = v.severity ?? 'info';
    const uncovered = uncoveredAdvisories(exceptions, name, v);
    if (uncovered.length === 0) {
      exceptedCount += 1;
      console.log(`  [exceptuado] ${name} (${sev})`);
      continue;
    }
    if (sev in counts) counts[sev] += 1;
    if (sev === 'critical' || sev === 'high') {
      const titles = uncovered.map((u) => u.title).join('; ');
      blocking[sev].push(`${name} — ${titles || 'ver detalle'}`);
      console.log(`  [${sev}] ${name} — ${titles || 'ver detalle'}`);
    }
  }
  console.log(
    `  paquetes: critical=${counts.critical} high=${counts.high} ` +
      `moderate=${counts.moderate} low=${counts.low} info=${counts.info}` +
      (exceptedCount ? ` (exceptuados=${exceptedCount})` : '') +
      ` — meta npm: ${JSON.stringify(meta)}`,
  );
  if (blocking.critical.length || blocking.high.length) {
    status('npm', 'FAIL', `${blocking.critical.length} critical + ${blocking.high.length} high sin excepción`);
  } else {
    status('npm', 'PASS', 'sin critical/high bloqueantes');
  }
} catch (error) {
  status('npm', 'ERROR', `npm audit no pudo ejecutarse: ${String(error.message).split('\n')[0]}`);
}

// --- npm audit árbol completo (SEC-GATE-003): dev-deps visibles, no bloquean ---
// Las dev-dependencies no viajan en el instalador, pero un advisory
// crítico en tooling que corre en cada `npm install`/CI también es riesgo.
// Se reportan con severidad real como INFO para que la deuda sea visible;
// bloquearlas exigiría excepciones auditables propias y es una decisión de
// política aparte (quedan listadas para revisión).
console.log('SECURITY-AUDIT: npm audit (árbol completo, informativo)');
try {
  const out = run(NPM, ['audit', '--json']);
  let report;
  try {
    report = JSON.parse(out);
  } catch {
    throw new Error('salida no-JSON de npm audit');
  }
  const vulns = report.vulnerabilities ?? {};
  const devOnly = Object.entries(vulns).filter(([name]) => !prodVulnNames.has(name));
  const counts = { critical: 0, high: 0, moderate: 0, low: 0, info: 0 };
  for (const [, v] of devOnly) {
    const sev = v.severity ?? 'info';
    if (sev in counts) counts[sev] += 1;
  }
  console.log(
    `  sólo-dev: critical=${counts.critical} high=${counts.high} ` +
      `moderate=${counts.moderate} low=${counts.low} info=${counts.info} ` +
      `(${devOnly.length} paquetes; no se empaquetan — informativo)`,
  );
  for (const [name, v] of devOnly) {
    if (!['critical', 'high'].includes(v.severity)) continue;
    const titles = (v.via ?? [])
      .map((x) => (typeof x === 'string' ? x : x.title ?? x.url))
      .filter(Boolean)
      .join('; ');
    console.log(`  [dev ${v.severity}] ${name} — ${titles || 'ver detalle'}`);
  }
  status('npm-dev', 'INFO', `${devOnly.length} paquetes sólo-dev reportados sin bloqueo`);
} catch (error) {
  status('npm-dev', 'ERROR', `npm audit completo no pudo ejecutarse: ${String(error.message).split('\n')[0]}`);
}

// --- cargo audit (opcional: requiere `cargo install cargo-audit`) ---
console.log('SECURITY-AUDIT: cargo audit');
let cargoAuditInstalled = true;
try {
  run(CARGO, ['audit', '--version']);
} catch {
  cargoAuditInstalled = false;
}
if (!cargoAuditInstalled) {
  // SEC-GATE-002: sin cargo-audit se usa OSV (api.osv.dev) sobre Cargo.lock.
  // Misma vara: bloquea critical/high/unrated; las excepciones del allowlist
  // aplican igual (advisory = id RUSTSEC/GHSA de OSV).
  try {
    // execFileSync sin shell: process.execPath tiene espacios y el
    // wrapper run() con shell:true rompe el quoting en Windows.
    let out;
    try {
      out = execFileSync(
        process.execPath,
        [join(HERE, 'cargo-osv-audit.mjs'), '--json'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      );
    } catch (error) {
      if (error.stdout) out = error.stdout;
      else throw error;
    }
    const report = JSON.parse(out);
    let critical = 0;
    let high = 0;
    let unrated = 0;
    const lines = [];
    for (const f of report.findings ?? []) {
      const sev = String(f.severity ?? '').toLowerCase();
      if (sev === 'info') continue;
      if (isExcepted(exceptions, f.package, sev, f.id)) continue;
      if (sev === 'critical') critical += 1;
      else if (sev === 'high') high += 1;
      else if (sev === 'unrated') unrated += 1;
      if (['critical', 'high', 'unrated'].includes(sev)) {
        lines.push(
          `  [${sev}] ${f.package}@${f.version} ${f.id} — ${f.summary ?? ''}`,
        );
      }
    }
    console.log(
      `  OSV: ${report.packages ?? '?'} crates · critical=${critical} high=${high} unrated=${unrated}`,
    );
    for (const line of lines) console.log(line);
    if (critical > 0 || high > 0 || unrated > 0) {
      status(
        'cargo-audit',
        'FAIL',
        `${critical} critical + ${high} high + ${unrated} unrated sin excepción (vía OSV)`,
      );
    } else {
      status('cargo-audit', 'PASS', 'sin critical/high/unrated bloqueantes (vía OSV)');
    }
  } catch (error) {
    status(
      'cargo-audit',
      'ERROR',
      `cargo audit ausente y OSV no disponible: ${String(error.message).split('\n')[0]}`,
    );
  }
} else try {
  const out = run(CARGO, ['audit', '--json']);
  let report;
  try {
    report = JSON.parse(out);
  } catch {
    throw new Error('salida no-JSON de cargo audit');
  }
  const warnings = report.warnings ?? {};
  let critical = 0;
  let high = 0;
  const lines = [];
  for (const [crate, list] of Object.entries(warnings)) {
    for (const w of list ?? []) {
      const sev = (w?.advisory?.cvss?.severity ?? '').toLowerCase();
      const id = w?.advisory?.id ?? '';
      const pkgKey = `${crate}@${w?.advisory?.package ?? ''}`;
      if (isExcepted(exceptions, crate, sev, id)) {
        continue;
      }
      if (sev === 'critical') critical += 1;
      else if (sev === 'high') high += 1;
      if (sev === 'critical' || sev === 'high') {
        lines.push(`  [${sev}] ${pkgKey} ${id} — ${w?.advisory?.title ?? ''}`);
      }
    }
  }
  console.log(`  avisos: critical=${critical} high=${high}`);
  for (const line of lines) console.log(line);
  if (critical > 0 || high > 0) {
    status('cargo-audit', 'FAIL', `${critical} critical + ${high} high sin excepción`);
  } else {
    status('cargo-audit', 'PASS', 'sin critical/high bloqueantes');
  }
} catch (error) {
  status('cargo-audit', 'ERROR', `cargo audit falló: ${String(error.message).split('\n')[0]}`);
}

console.log(`SECURITY-AUDIT resumen: ${statuses.join(' | ')}`);
if (failed) {
  console.error('SECURITY-AUDIT: FALLÓ (ver estados arriba).');
  process.exit(1);
}
console.log('SECURITY-AUDIT: OK');
