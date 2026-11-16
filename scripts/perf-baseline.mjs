#!/usr/bin/env node
/**
 * perf-baseline — baseline de performance del render E2E real (auditoría F9).
 *
 * Qué mide: ejecuta UN test de render real con FFmpeg de verdad
 * (`render_live_5s_pan_astats_and_bezier_opacity_match_preview` por
 * defecto: render de 5 s a 24 fps con paneo por clip y opacidad Bézier,
 * verificado con astats/FFprobe) y registra:
 *
 *   - wallTimeMs: tiempo total del proceso `cargo test` (incluye el arranque
 *     del binario de test, la generación de fixtures con ffmpeg/ffprobe y el
 *     render + verificación). Es un número de "extremo a extremo del test",
 *     no del ffmpeg aislado.
 *   - peakRssBytes: pico del RSS SUMADO del árbol de procesos durante la
 *     corrida (cargo + binario de test `editor_ia_desktop_lib-*` + ffmpeg +
 *     ffprobe), muestreado cada ~400 ms desde PowerShell. Es una cota
 *     superior razonable de memoria del render, no una medición exacta del
 *     working set de una sola fase.
 *   - idleRssBytes: RSS PROMEDIO del binario de test de la lib
 *     (`editor_ia_desktop_lib-*`) durante un test trivial sin render
 *     (`--idle-test`, default `merge_olyvia_entry_preserves_other_servers_
 *     and_settings`). Es un proxy honesto del footprint "código cargado"
 *     del escritorio: NO es la app Tauri (webview2, runtime, GPU) porque la
 *     app no puede abrirse headless en CI. Se compara con el umbral de RSS.
 *   - mcp (sólo con --with-mcp): latencia JSON-RPC del servidor MCP
 *     embebido (`POST /mcp` en 127.0.0.1:31417): `initialize` y promedio
 *     de N `ping`. `initialize`/`ping` los responde el backend Rust sin
 *     bridge al frontend, pero el listener sólo existe con la app viva:
 *     requiere EDITOR_IA_MCP_TOKEN (env, nunca se loguea) y
 *     EDITOR_IA_MCP_URL opcional. Sin app corriendo o sin token queda
 *     `{ measured: false, reason }` y NO entra en el gate.
 *
 * NO es un gate de CI: un solo render E2E tarda minutos y el ruido de una
 * sola corrida en una sola máquina es alto. Uso previsto:
 *   - `node scripts/perf-baseline.mjs --update`  → regenera
 *     docs/performance/baseline.json (una vez por máquina de referencia).
 *   - `node scripts/perf-baseline.mjs --check`   → compara contra el
 *     baseline y falla si la regresión supera los umbrales
 *     (default: +20 % tiempo, +25 % RSS; flags --time-threshold /
 *     --rss-threshold aceptan fracciones, p.ej. 0.3).
 *   - sin flags → mide e imprime el JSON sin tocar el baseline.
 *
 * Opciones:
 *   --test <nombre>     filtro cargo test (default: render de 5 s)
 *   --idle-test <nombre>  test trivial para el RSS idle del binario lib
 *                       (default: merge_olyvia_entry_preserves_other_servers_and_settings)
 *   --with-mcp          mide latencia MCP; requiere EDITOR_IA_MCP_TOKEN
 *                       (y EDITOR_IA_MCP_URL opcional, default
 *                       http://127.0.0.1:31417/mcp) con la app viva
 *   --runs <n>          corridas a promediar (default: 1)
 *   --time-threshold    fracción de regresión de tiempo permitida (0.20)
 *   --rss-threshold     fracción de regresión de RSS permitida (0.25)
 *   --out <ruta>        ruta del baseline (default docs/performance/baseline.json)
 *   --no-build          salta el `cargo test --no-run` previo (build ya hecho)
 *
 * Requisitos: Windows con PowerShell (muestreo de RSS), ffmpeg/ffprobe en
 * PATH, toolchain Rust vía scripts/rust-env.mjs, y
 * EDITOR_IA_RUN_RENDER_TESTS=1 (lo setea el script).
 * En plataformas no-Windows el RSS queda en null y sólo se mide wall time.
 *
 * Integración CI futura (NO conectado todavía): como job nocturno aparte
 * porque el render E2E es pesado. Propuesta en docs/performance/README.md.
 *
 * NOTA sobre el fixture: `render_live_pipeline_produces_a_verified_mp4`
 * (el "pipeline completo" de la auditoría) fallaba por un bug en
 * `eq_compat.rs` (expresión `lutyuv` mal formada, EINVAL en FFmpeg 9);
 * corregido el 2026-11-12 y verificado en verde. El default sigue siendo
 * el render de 5 s por ser más liviano y menos ruidoso para el baseline.
 * El test default NO es `#[ignore]` (sólo está gateado por
 * EDITOR_IA_RUN_RENDER_TESTS): el script corre con `--include-ignored`,
 * que ejecuta el test filtrado en ambos casos. `--test
 * render_live_pipeline_produces_a_verified_mp4` mide el pipeline completo.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const IS_WINDOWS = process.platform === 'win32';

const DEFAULT_TEST = 'render_live_5s_pan_astats_and_bezier_opacity_match_preview';
const DEFAULT_IDLE_TEST = 'merge_olyvia_entry_preserves_other_servers_and_settings';
const DEFAULT_MCP_URL = 'http://127.0.0.1:31417/mcp';
const DEFAULT_OUT = path.join(root, 'docs', 'performance', 'baseline.json');
const MCP_PINGS = 5;

function parseArgs(argv) {
  const args = {
    mode: 'measure', // measure | check | update
    test: DEFAULT_TEST,
    idleTest: DEFAULT_IDLE_TEST,
    withMcp: false,
    runs: 1,
    timeThreshold: 0.2,
    rssThreshold: 0.25,
    out: DEFAULT_OUT,
    noBuild: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const next = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`falta valor para ${flag}`);
      return argv[i];
    };
    switch (flag) {
      case '--check': args.mode = 'check'; break;
      case '--update': args.mode = 'update'; break;
      case '--test': args.test = next(); break;
      case '--idle-test': args.idleTest = next(); break;
      case '--with-mcp': args.withMcp = true; break;
      case '--runs': args.runs = Number.parseInt(next(), 10); break;
      case '--time-threshold': args.timeThreshold = Number(next()); break;
      case '--rss-threshold': args.rssThreshold = Number(next()); break;
      case '--out': args.out = path.resolve(next()); break;
      case '--no-build': args.noBuild = true; break;
      case '--help':
      case '-h':
        console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]);
        process.exit(0);
        break;
      default:
        throw new Error(`flag desconocido: ${flag}`);
    }
  }
  if (!Number.isFinite(args.runs) || args.runs < 1) {
    throw new Error('--runs debe ser un entero >= 1');
  }
  return args;
}

function git(args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

function buildArgs(testName) {
  return [
    'cargo',
    'test',
    '-p',
    'editor-ia-desktop',
    '--lib',
    testName,
    // `--` separa args del test harness. `--include-ignored` corre el test
    // filtrado tanto si es #[ignore] como si sólo está gateado por
    // EDITOR_IA_RUN_RENDER_TESTS: como el filtro es un nombre exacto, no
    // arrastra tests extra.
    '--',
    '--include-ignored',
  ];
}

function rustEnvArgs(cargoArgs) {
  return [process.execPath, path.join(here, 'rust-env.mjs'), '--', ...cargoArgs];
}

/** Compila los tests sin medirlos: el tiempo de build no es la métrica. */
function ensureBuild(testName) {
  // `cargo test --no-run` con el mismo filtro: compila el binario de test.
  // `--ignored` no aplica a --no-run pero no molesta; se omite por claridad.
  const cargoArgs = [
    'cargo', 'test', '-p', 'editor-ia-desktop', '--lib', testName, '--no-run',
  ];
  const result = spawnSync(rustEnvArgs(cargoArgs)[0], rustEnvArgs(cargoArgs).slice(1), {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, EDITOR_IA_RUN_RENDER_TESTS: '1' },
  });
  if (result.status !== 0) {
    throw new Error(`cargo test --no-run falló (status ${result.status})`);
  }
}

/**
 * Muestreador RSS: PowerShell que suma WorkingSet64 de los procesos del
 * árbol de la corrida cada ~400 ms y vuelca `elapsedMs,totalBytes` a un CSV.
 * mode 'tree' (default): cargo + ffmpeg + ffprobe + conhost + el binario
 * de test de la lib — la cota del render. mode 'lib': sólo
 * `editor_ia_desktop_lib-*`, para el RSS idle del binario ya compilado.
 */
function startRssSampler(mode = 'tree') {
  if (!IS_WINDOWS) return null;
  const csv = path.join(tmpdir(), `perf-baseline-rss-${process.pid}-${Date.now()}.csv`);
  writeFileSync(csv, '');
  const filter = mode === 'lib'
    ? '$_.Name -like "editor_ia_desktop_lib*"'
    : '$_.Name -in $names -or $_.Name -like "editor_ia_desktop_lib*"';
  const ps = [
    '$names = @("cargo","ffmpeg","ffprobe","conhost")',
    `$out = '${csv.replace(/'/g, "''")}'`,
    '$sw = [System.Diagnostics.Stopwatch]::StartNew()',
    'while ($true) {',
    '  $sum = 0',
    `  Get-Process -ErrorAction SilentlyContinue | Where-Object { ${filter} } | ForEach-Object { $sum += $_.WorkingSet64 }`,
    '  "$($sw.ElapsedMilliseconds),$sum" | Out-File -FilePath $out -Append -Encoding ascii',
    // El test idle dura ~1 s: samplear más seguido que en el render (400 ms)
    // para no quedarse sin muestras.
    `  Start-Sleep -Milliseconds ${mode === 'lib' ? 150 : 400}`,
    '}',
  ].join('\n');
  const child = spawn(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', ps],
    { stdio: 'ignore' },
  );
  return { child, csv };
}

function readRssSamples(csv) {
  if (!csv || !existsSync(csv)) return [];
  const samples = [];
  for (const line of readFileSync(csv, 'utf8').split(/\r?\n/)) {
    const parts = line.split(',');
    if (parts.length !== 2) continue;
    const rss = Number(parts[1]);
    if (Number.isFinite(rss) && rss > 0) samples.push(rss);
  }
  return samples;
}

function readPeakRss(csv) {
  const samples = readRssSamples(csv);
  return samples.length > 0 ? Math.max(...samples) : null;
}

/** Promedio de los samples >0: base del RSS idle (proceso vivo y estable). */
function readAvgRss(csv) {
  const samples = readRssSamples(csv);
  if (samples.length === 0) return null;
  return Math.round(samples.reduce((a, b) => a + b, 0) / samples.length);
}

/**
 * Una corrida cronometrada de `cargo test <testName>`.
 * opts.sampler: 'tree' (pico RSS del árbol, render) | 'lib' (sólo el
 * binario de test de la lib, para el RSS idle). opts.stat: 'peak'|'avg'.
 */
function runOnce(testName, index, opts = {}) {
  const samplerMode = opts.sampler ?? 'tree';
  const stat = opts.stat ?? 'peak';
  return new Promise((resolve, reject) => {
    const sampler = startRssSampler(samplerMode);
    const cmd = rustEnvArgs(buildArgs(testName));
    const started = performance.now();
    const child = spawn(cmd[0], cmd.slice(1), {
      cwd: root,
      env: { ...process.env, EDITOR_IA_RUN_RENDER_TESTS: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    // Los tests escriben el resumen ("test result: ok/FAILED") en stdout y
    // los eprintln!/panics en stderr; se reenvían ambos y se guardan las
    // colas para el mensaje de error.
    let outTail = '';
    let errTail = '';
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      errTail = (errTail + text).slice(-32768);
      process.stderr.write(text);
    });
    child.stdout.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      outTail = (outTail + text).slice(-32768);
      process.stdout.write(text);
    });
    child.on('error', (error) => {
      if (sampler) sampler.child.kill();
      reject(error);
    });
    child.on('close', (code) => {
      const wallTimeMs = Math.round(performance.now() - started);
      const finish = () => {
        if (sampler) {
          sampler.child.kill();
          // Dar un respiro para que el último sample llegue al CSV.
          setTimeout(() => {
            const rssBytes = stat === 'avg' ? readAvgRss(sampler.csv) : readPeakRss(sampler.csv);
            rmSync(sampler.csv, { force: true });
            settle(rssBytes);
          }, 150);
        } else {
          settle(null);
        }
      };
      const settle = (rssBytes) => {
        if (code !== 0) {
          const tail = `${errTail}\n${outTail}`.slice(-8192);
          reject(new Error(`corrida ${index + 1}: cargo test salió con status ${code}\n${tail}`));
        } else {
          resolve({ run: index + 1, wallTimeMs, rssBytes });
        }
      };
      if (sampler) {
        // Dar un respiro para que el último sample llegue al CSV.
        setTimeout(finish, 300);
      } else {
        finish();
      }
    });
  });
}

function average(values) {
  const present = values.filter((value) => value !== null);
  if (present.length === 0) return null;
  return Math.round(present.reduce((a, b) => a + b, 0) / present.length);
}

function loadBaseline(outPath) {
  if (!existsSync(outPath)) return null;
  try {
    return JSON.parse(readFileSync(outPath, 'utf8'));
  } catch (error) {
    throw new Error(`baseline ilegible en ${outPath}: ${error.message}`);
  }
}

/**
 * Latencia del servidor MCP embebido (POST /mcp, Bearer token). Sólo
 * `initialize` y `ping`: los responde el backend Rust sin bridge al
 * frontend, así que no dependen de la ventana. Requiere la app viva y el
 * token en EDITOR_IA_MCP_TOKEN (nunca se imprime). Sin requisitos devuelve
 * { measured:false, reason } — el caller decide si es error o skip.
 */
async function measureMcpLatency(url, token, pings = MCP_PINGS) {
  const skip = (reason) => ({ measured: false, reason, url });
  const headers = {
    'content-type': 'application/json',
    authorization: `Bearer ${token}`,
  };
  const post = async (payload) => {
    const started = performance.now();
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });
    const ms = Math.round(performance.now() - started);
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
    }
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      // respuesta no-JSON (p.ej. 202 de notificaciones): no es error
    }
    return { ms, body };
  };
  try {
    const init = await post({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'perf-baseline', version: '0' },
      },
    });
    const serverName = init.body?.result?.serverInfo?.name ?? null;
    // Notificación de handshake: el server responde 202 sin body JSON-RPC.
    await post({ jsonrpc: '2.0', method: 'notifications/initialized' });
    const pingMs = [];
    for (let i = 0; i < pings; i += 1) {
      const pong = await post({ jsonrpc: '2.0', id: 100 + i, method: 'ping' });
      pingMs.push(pong.ms);
    }
    return {
      measured: true,
      url,
      serverName,
      initializeMs: init.ms,
      pingMsAvg: Math.round(pingMs.reduce((a, b) => a + b, 0) / pingMs.length),
      pingMs,
      pings: pingMs.length,
    };
  } catch (error) {
    return skip(`falló la medición MCP: ${error.message}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.error(
    `perf-baseline: modo=${args.mode} test=${args.test} idleTest=${args.idleTest} ` +
    `runs=${args.runs} mcp=${args.withMcp ? 'on' : 'off'}`,
  );

  if (args.mode === 'check' && !existsSync(args.out)) {
    console.error(`perf-baseline: no hay baseline en ${args.out}; corré --update primero.`);
    process.exit(2);
  }

  if (!args.noBuild) ensureBuild(args.test);

  // RSS idle: un test trivial ya compilado; sólo interesa el RSS promedio
  // del binario de la lib, no el wall time. El test puede terminar antes
  // del primer sample: reintentar hasta tener datos (máx. 3 corridas).
  let idleRssBytes = null;
  for (let attempt = 0; attempt < 3 && idleRssBytes === null; attempt += 1) {
    const idleRun = await runOnce(args.idleTest, attempt, { sampler: 'lib', stat: 'avg' });
    idleRssBytes = idleRun.rssBytes;
  }

  const runs = [];
  for (let i = 0; i < args.runs; i += 1) {
    runs.push(await runOnce(args.test, i));
  }

  // Latencia MCP: opt-in porque requiere la app viva + token por env.
  let mcp = { measured: false, reason: 'no solicitado (--with-mcp)' };
  if (args.withMcp) {
    const token = process.env.EDITOR_IA_MCP_TOKEN;
    if (!token) {
      mcp = { measured: false, reason: 'falta EDITOR_IA_MCP_TOKEN (token Bearer del servidor MCP)' };
      console.error('perf-baseline: --with-mcp sin EDITOR_IA_MCP_TOKEN; se omite la métrica MCP.');
    } else {
      const url = process.env.EDITOR_IA_MCP_URL || DEFAULT_MCP_URL;
      mcp = await measureMcpLatency(url, token);
      if (!mcp.measured) console.error(`perf-baseline: ${mcp.reason}`);
    }
  }

  const result = {
    wallTimeMs: average(runs.map((run) => run.wallTimeMs)),
    peakRssBytes: average(runs.map((run) => run.rssBytes)),
    idleRssBytes,
    mcp,
    runs,
  };

  if (args.mode === 'measure') {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const baseline = {
    version: 1,
    fixture: args.test,
    idleTest: args.idleTest,
    command: `node scripts/perf-baseline.mjs --test ${args.test} --runs ${args.runs}`,
    env: { EDITOR_IA_RUN_RENDER_TESTS: '1' },
    machine: hostname(),
    createdAt: new Date().toISOString(),
    commit: git(['rev-parse', 'HEAD']),
    dirty: (git(['status', '--porcelain']) ?? '') !== '',
    thresholds: {
      timeRegression: args.timeThreshold,
      rssRegression: args.rssThreshold,
    },
    ...result,
  };

  if (args.mode === 'update') {
    mkdirSync(path.dirname(args.out), { recursive: true });
    writeFileSync(args.out, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
    console.error(`perf-baseline: baseline escrito en ${args.out}`);
    console.log(JSON.stringify(baseline, null, 2));
    return;
  }

  // check
  const previous = loadBaseline(args.out);
  const failures = [];
  const compare = (label, current, base, threshold) => {
    if (current === null || base === null || base === undefined) return null;
    const delta = (current - base) / base;
    const ok = delta <= threshold;
    if (!ok) failures.push(`${label}: ${(delta * 100).toFixed(1)}% > umbral ${(threshold * 100).toFixed(0)}%`);
    return { label, baseline: base, current, deltaPct: Math.round(delta * 1000) / 10, ok };
  };
  const prevMcp = previous.mcp && previous.mcp.measured ? previous.mcp : null;
  const currMcp = result.mcp && result.mcp.measured ? result.mcp : null;
  const comparisons = [
    compare('wallTimeMs', result.wallTimeMs, previous.wallTimeMs, args.timeThreshold),
    compare('peakRssBytes', result.peakRssBytes, previous.peakRssBytes, args.rssThreshold),
    compare('idleRssBytes', result.idleRssBytes, previous.idleRssBytes, args.rssThreshold),
    // MCP sólo entra al gate si AMBAS corridas lo midieron (requiere app viva).
    compare('mcpInitializeMs', currMcp?.initializeMs ?? null, prevMcp?.initializeMs ?? null, args.timeThreshold),
    compare('mcpPingMsAvg', currMcp?.pingMsAvg ?? null, prevMcp?.pingMsAvg ?? null, args.timeThreshold),
  ].filter(Boolean);
  const report = {
    baseline: {
      commit: previous.commit,
      createdAt: previous.createdAt,
      fixture: previous.fixture,
      idleTest: previous.idleTest,
    },
    current: {
      commit: baseline.commit,
      wallTimeMs: result.wallTimeMs,
      peakRssBytes: result.peakRssBytes,
      idleRssBytes: result.idleRssBytes,
      mcp: result.mcp.measured
        ? { initializeMs: result.mcp.initializeMs, pingMsAvg: result.mcp.pingMsAvg }
        : { measured: false, reason: result.mcp.reason },
    },
    comparisons,
    ok: failures.length === 0,
  };
  console.log(JSON.stringify(report, null, 2));
  if (failures.length > 0) {
    for (const failure of failures) console.error(`perf-baseline: REGRESIÓN ${failure}`);
    process.exit(1);
  }
  console.error('perf-baseline: dentro de umbrales.');
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  try {
    await main();
  } catch (error) {
    console.error(`perf-baseline: ${error.message}`);
    process.exit(1);
  }
}
