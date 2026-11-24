#!/usr/bin/env node
/**
 * Auditoría de vulnerabilidades de crates Rust vía OSV (api.osv.dev).
 *
 * Alternativa ejecutable cuando `cargo audit` no está instalado: parsea el
 * Cargo.lock del workspace y consulta la base OSV (ecosystem crates.io) en
 * un solo `querybatch`. NO equivale a cargo-audit (RustSec) — OSV agrega
 * advisories de varias fuentes — pero es evidencia real de vulnerabilidades
 * conocidas, no una omisión.
 *
 * Clasificación:
 * - `informational` (unmaintained/unsound-notice/etc.) → INFO, no bloquea.
 * - Con CVSS → severidad real (critical/high/medium/low).
 * - Sin CVSS ni informational → UNRATED: no se puede probar que sea menor,
 *   cuenta como bloqueante (un escaneo sin rating nunca es "limpio").
 *
 * Uso: `node scripts/cargo-osv-audit.mjs [--json]`
 * Exit 0 si no hay critical/high/unrated; exit 1 si los hay o si OSV no
 * responde (un escaneo no ejecutado nunca es "sin vulnerabilidades").
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const LOCK = join(HERE, '..', 'Cargo.lock');
const OSV_BATCH = 'https://api.osv.dev/v1/querybatch';

function parseLock(path) {
  const text = readFileSync(path, 'utf8');
  const packages = [];
  let name = null;
  let version = null;
  const flush = () => {
    if (name && version) packages.push({ name, version });
    name = null;
    version = null;
  };
  for (const line of text.split('\n')) {
    if (line === '[[package]]') {
      flush();
    } else if (line.startsWith('name = ')) {
      name = line.slice(7).trim().replace(/^"|"$/g, '');
    } else if (line.startsWith('version = ')) {
      version = line.slice(10).trim().replace(/^"|"$/g, '');
    }
  }
  flush();
  return packages;
}

/// Severidad desde el vector CVSS 3.x del advisory (ej. "CVSS:3.1/...").
function cvssSeverity(vector) {
  if (typeof vector !== 'string' || !vector.startsWith('CVSS:3')) return null;
  const metrics = Object.fromEntries(
    vector
      .split('/')
      .slice(1)
      .map((kv) => kv.split(':'))
      .filter((p) => p.length === 2),
  );
  const lookup = { N: 0.85, L: 0.55, P: 0.62 };
  const av = lookup[metrics.AV] ?? 0.85;
  const ac = metrics.AC === 'L' ? 0.77 : 0.44;
  const pr = metrics.PR === 'N' ? 0.85 : metrics.PR === 'L' ? (metrics.S === 'C' ? 0.68 : 0.62) : metrics.S === 'C' ? 0.5 : 0.27;
  const ui = metrics.UI === 'N' ? 0.85 : 0.62;
  const c = metrics.C === 'H' ? 0.56 : metrics.C === 'L' ? 0.22 : 0;
  const i = metrics.I === 'H' ? 0.56 : metrics.I === 'L' ? 0.22 : 0;
  const a = metrics.A === 'H' ? 0.56 : metrics.A === 'L' ? 0.22 : 0;
  const iss = 1 - (1 - c) * (1 - i) * (1 - a);
  const impact = metrics.S === 'C' ? 7.52 * (iss - 0.029) - 3.25 * (iss - 0.02) ** 15 : 6.42 * iss;
  const exploitability = 8.22 * av * ac * pr * ui;
  const score =
    metrics.S === 'C'
      ? Math.min(1.08 * (impact + exploitability), 10)
      : Math.min(impact + exploitability, 10);
  if (score >= 9) return 'critical';
  if (score >= 7) return 'high';
  if (score >= 4) return 'medium';
  return 'low';
}

const asJson = process.argv.includes('--json');
const packages = parseLock(LOCK);
if (packages.length === 0) {
  console.error('cargo-osv-audit: no se parseó ningún paquete de Cargo.lock');
  process.exit(2);
}

const queries = packages.map((p) => ({
  package: { name: p.name, ecosystem: 'crates.io' },
  version: p.version,
}));

let results;
try {
  const res = await fetch(OSV_BATCH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ queries }),
  });
  if (!res.ok) throw new Error(`OSV HTTP ${res.status}`);
  const body = await res.json();
  results = body.results;
  if (!Array.isArray(results) || results.length !== queries.length) {
    throw new Error('respuesta OSV incompleta');
  }
} catch (error) {
  console.error(`cargo-osv-audit: OSV no disponible — ${error.message}`);
  process.exit(2);
}

// querybatch devuelve stubs {id, modified}: el detalle de cada advisory
// (severidad, informational) hay que pedirlo por id. Se deduplica porque
// el mismo advisory puede afectar a varias versiones del lock.
const stubPairs = [];
for (let i = 0; i < packages.length; i++) {
  for (const v of results[i].vulns ?? []) {
    stubPairs.push({ pkg: packages[i], id: v.id });
  }
}
const uniqueIds = [...new Set(stubPairs.map((p) => p.id))];
const details = new Map();
await Promise.all(
  uniqueIds.map(async (id) => {
    try {
      const res = await fetch(`https://api.osv.dev/v1/vulns/${id}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      details.set(id, await res.json());
    } catch (error) {
      console.error(`cargo-osv-audit: no se pudo leer ${id} — ${error.message}`);
      process.exit(2);
    }
  }),
);

const findings = [];
for (const { pkg, id } of stubPairs) {
  const v = details.get(id);
  if (!v) continue;
  const dbspec = v.affected?.[0]?.database_specific ?? {};
  const informational = dbspec.informational ?? null;
  const vector =
    dbspec.cvss ??
    (v.severity ?? []).find((s) => s.type === 'CVSS_V3')?.score ??
    null;
  const severity = informational
    ? 'info'
    : (cvssSeverity(vector) ?? 'unrated').toUpperCase();
  findings.push({
    package: pkg.name,
    version: pkg.version,
    id: v.id,
    aliases: v.aliases ?? [],
    severity,
    informational,
    summary: v.summary ?? '',
    url: `https://osv.dev/vulnerability/${v.id}`,
  });
}

const bySeverity = {};
for (const f of findings) bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1;

if (asJson) {
  console.log(JSON.stringify({ packages: packages.length, findings }, null, 2));
} else {
  console.log(`cargo-osv-audit: ${packages.length} crates consultados en OSV`);
  for (const [sev, n] of Object.entries(bySeverity).sort()) {
    console.log(`  ${sev}: ${n}`);
  }
  for (const f of findings.filter((x) => x.severity !== 'INFO')) {
    console.log(
      `  [${f.severity}] ${f.package}@${f.version} — ${f.id} ${f.summary}`.slice(0, 200),
    );
  }
}

const blocking = findings.filter((f) => ['CRITICAL', 'HIGH', 'UNRATED'].includes(f.severity));
process.exit(blocking.length ? 1 : 0);
