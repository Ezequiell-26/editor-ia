#!/usr/bin/env node
/**
 * bench-preview-effects — mide FPS real de la preview con la capa de efectos
 * (LUT, denoise, viñeta, motion blur y combinaciones) sobre un video 1080p60
 * generado con el FFmpeg empaquetado. Usa requestVideoFrameCallback: cuenta
 * frames presentados, no estimaciones.
 *
 * Uso: node scripts/bench-preview-effects.mjs
 * Requiere Chrome instalado (igual que los E2E) y Playwright.
 */

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { cpus, platform, release, totalmem } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const appRoot = join(root, 'apps', 'desktop');
const benchVideo = join(appRoot, 'e2e', 'lut-harness', 'bench.mp4');
const ffmpeg = join(
  appRoot,
  'src-tauri',
  'resources',
  'ffmpeg',
  'ffmpeg.exe',
);
const port = 5175;
const cases = [
  'none',
  'lut',
  'denoise',
  'denoise-spatial',
  'lut+denoise',
  'lut+denoise-spatial',
  'vignette',
  'motionblur',
  'lut+denoise+vignette+motionblur',
];

/**
 * Muestreador de CPU/RAM/GPU del árbol de Chrome que abre Playwright. Corre en
 * paralelo al caso y devuelve muestras con reloj de pared; el FPS del caso
 * sigue midiéndose en una pasada aparte para que el muestreo no lo altere.
 */
const USAGE_PS = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
$end = (Get-Date).AddSeconds(12)
$out = @()
while ((Get-Date) -lt $end) {
  $t = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  $all = Get-CimInstance Win32_Process -Filter "Name='chrome.exe'"
  $main = $all | Where-Object { $_.CommandLine -like '*remote-debugging-pipe*' } | Select-Object -First 1
  $udd = $null
  if ($main -and $main.CommandLine -match '--user-data-dir=("([^"]+)"|(\S+))') {
    $udd = $Matches[2]
    if (-not $udd) { $udd = $Matches[3] }
  }
  $set = @()
  if ($udd) { $set = $all | Where-Object { $_.CommandLine -like "*$udd*" } }
  if (-not $set -or $set.Count -eq 0) { $set = $all }
  $cpu = @{}
  $rss = 0
  $gpuPids = @()
  foreach ($p in $set) {
    $cpu[[string]$p.ProcessId] = [math]::Round(($p.UserModeTime + $p.KernelModeTime) / 10000000, 4)
    $rss += $p.WorkingSetSize
    if ($p.CommandLine -like '*--type=gpu-process*') { $gpuPids += [string]$p.ProcessId }
  }
  $gpu = $null
  $counter = Get-Counter '\GPU Engine(*)\Utilization Percentage'
  if ($counter) {
    $vals = @()
    foreach ($s in $counter.CounterSamples) {
      if ($s.InstanceName -match 'pid_(\d+)_' -and $s.InstanceName -like '*engtype_3d*') {
        $procId = $Matches[1]
        if ($gpuPids.Count -eq 0 -or ($gpuPids -contains $procId)) { $vals += $s.CookedValue }
      }
    }
    if ($vals.Count -gt 0) { $gpu = [math]::Round(($vals | Measure-Object -Sum).Sum, 1) }
  }
  $out += [pscustomobject]@{ t = $t; cpu = $cpu; rss = $rss; gpu = $gpu }
}
$out | ConvertTo-Json -Compress -Depth 5
`;

function startUsageSampler() {
  const child = spawn(
    'powershell',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', USAGE_PS],
    { stdio: ['ignore', 'pipe', 'ignore'] },
  );
  let stdout = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  return new Promise((resolve) => {
    child.on('error', () => resolve(null));
    child.on('close', () => {
      try {
        const parsed = JSON.parse(stdout.trim());
        resolve(Array.isArray(parsed) ? parsed : [parsed]);
      } catch {
        resolve(null);
      }
    });
  });
}

function mean(values) {
  return values.length === 0
    ? null
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function usageStats(samples, startedAt, endedAt, cores) {
  if (!Array.isArray(samples) || samples.length === 0) return null;
  const inside = samples.filter(
    (sample) =>
      typeof sample?.t === 'number' &&
      sample.t >= startedAt - 200 &&
      sample.t <= endedAt + 200,
  );
  if (inside.length < 2) return null;
  const first = inside[0];
  const last = inside[inside.length - 1];
  const pids = Object.keys(first.cpu ?? {}).filter((pid) => pid in (last.cpu ?? {}));
  let cpuSeconds = 0;
  for (const pid of pids) {
    const delta = last.cpu[pid] - first.cpu[pid];
    if (delta > 0) cpuSeconds += delta;
  }
  const windowSec = (last.t - first.t) / 1000;
  if (windowSec <= 0) return null;
  const rss = inside.map((sample) => sample.rss).filter(Number.isFinite);
  const gpu = inside.map((sample) => sample.gpu).filter(Number.isFinite);
  const round = (value, digits) =>
    value === null ? null : Math.round(value * 10 ** digits) / 10 ** digits;
  return {
    windowSec: round(windowSec, 2),
    samples: inside.length,
    processes: pids.length,
    cpuCores: round(cpuSeconds / windowSec, 2),
    cpuPercentOfMachine: round((cpuSeconds / windowSec / cores) * 100, 1),
    rssMb: round(mean(rss) / 1024 ** 2, 0),
    rssPeakMb: round(Math.max(...rss) / 1024 ** 2, 0),
    gpu3dPercent: gpu.length ? round(mean(gpu), 1) : null,
    gpu3dPeak: gpu.length ? round(Math.max(...gpu), 1) : null,
  };
}


function generateVideo() {
  if (!existsSync(ffmpeg)) throw new Error(`no se encontró FFmpeg en ${ffmpeg}`);
  mkdirSync(dirname(benchVideo), { recursive: true });
  console.log('generando bench.mp4 1920x1080@60 (8 s)…');
  execFileSync(
    ffmpeg,
    [
      '-hide_banner',
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=1920x1080:rate=60:duration=8',
      '-c:v',
      'libopenh264',
      '-b:v',
      '20000000',
      '-pix_fmt',
      'yuv420p',
      '-g',
      '60',
      '-y',
      benchVideo,
    ],
    { stdio: 'inherit' },
  );
}

function rendererProbe() {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (!gl) return 'sin WebGL2';
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    return info
      ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL))
      : String(gl.getParameter(gl.RENDERER));
  } catch {
    return 'desconocido';
  }
}

async function probeRenderer(browser) {
  const page = await browser.newPage();
  await page.goto('about:blank');
  const name = await page.evaluate(rendererProbe);
  await page.close();
  return name;
}

async function runCase(browser, name, sample = false) {
  const usage = sample ? startUsageSampler() : null;
  const page = await browser.newPage();
  try {
    await page.goto(`http://localhost:${port}/e2e/lut-harness/bench.html?case=${encodeURIComponent(name)}`, {
      waitUntil: 'domcontentloaded',
      timeout: 90_000,
    });
    await page.waitForFunction(
      () => document.getElementById('status')?.textContent?.includes('done'),
      null,
      { timeout: 60_000 },
    );
    const result = await page.evaluate(() => window.__bench ?? null);
    if (!result) throw new Error('el harness no publicó __bench');
    if (!usage) return result;
    return { ...result, samples: await usage };
  } finally {
    await page.close();
  }
}

async function main() {
  generateVideo();
  const cores = cpus().length;
  const server = await createServer({
    root: appRoot,
    logLevel: 'silent',
    server: { port, strictPort: true },
  });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({
      channel: 'chrome',
      headless: true,
      args: ['--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist'],
    });
    let renderer = await probeRenderer(browser);
    if (/swiftshader|llvmpipe|software/i.test(renderer)) {
      console.log(`WebGL headless es "${renderer}"; cambiando a Chrome visible para medir la GPU real…`);
      await browser.close();
      browser = await chromium.launch({
        channel: 'chrome',
        headless: false,
        args: ['--window-position=-2400,-200', '--window-size=960,540'],
      });
      renderer = await probeRenderer(browser);
    }
    console.log(`WebGL: ${renderer}`);
    // La primera página paga la descarga/caché del MP4: se descarta un
    // warm-up con el mismo caso base antes de medir.
    console.log('warm-up de descarga…');
    await runCase(browser, 'none');
    const results = [];
    for (const name of cases) {
      const result = await runCase(browser, name);
      results.push(result);
      console.log(
        `${name.padEnd(35)} ${String(result.fps).padStart(6)} fps  p95 ${String(result.p95Ms).padStart(6)} ms  frames ${result.frames}`,
      );
    }
    // Pasada aparte para uso de recursos: el muestreo cada ~1 s no contamina
    // los FPS ya medidos arriba.
    console.log('\nMidiendo CPU/RAM/GPU por caso (pasada aparte)…');
    const usage = [];
    for (const name of cases) {
      const measured = await runCase(browser, name, true);
      const stats = usageStats(measured.samples, measured.startedAt, measured.endedAt, cores);
      usage.push({ case: name, ...(stats ?? { error: 'sin muestras de uso' }) });
      console.log(
        `${name.padEnd(35)} CPU ${String(stats?.cpuPercentOfMachine ?? '—').padStart(5)} %  RAM ${String(stats?.rssMb ?? '—').padStart(5)} MB  GPU3D ${String(stats?.gpu3dPercent ?? '—').padStart(5)} %  (${stats?.samples ?? 0} muestras)`,
      );
    }
    const report = {
      generatedAt: new Date().toISOString(),
      hardware: {
        cpu: cpus()[0]?.model ?? 'desconocido',
        cores,
        ramGb: Math.round((totalmem() / 1024 ** 3) * 10) / 10,
        platform: `${platform()} ${release()}`,
        webglRenderer: renderer,
      },
      video: { width: 1920, height: 1080, fps: 60, seconds: 8 },
      results,
      usage: {
        note: 'Chrome de Playwright durante la misma ventana de 4 s; CPU normalizada a la máquina completa, RAM = working set del árbol, GPU 3D = proceso gpu de Chrome. Muestreo aproximado a 1 Hz en una pasada aparte.',
        cores,
        cases: usage,
      },
    };
    const out = join(root, 'docs', 'EFFECTS-PREVIEW-BENCH.json');
    writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`\nJSON: ${out}`);
    console.log('\n| Caso | FPS | p95 (ms) | Frames |');
    console.log('|---|---:|---:|---:|');
    for (const item of results) {
      console.log(`| ${item.case} | ${item.fps} | ${item.p95Ms} | ${item.frames} |`);
    }
    console.log('\n| Caso | CPU % máquina | RAM MB | GPU 3D % |');
    console.log('|---|---:|---:|---:|');
    for (const item of usage) {
      console.log(
        `| ${item.case} | ${item.cpuPercentOfMachine ?? '—'} | ${item.rssMb ?? '—'} | ${item.gpu3dPercent ?? '—'} |`,
      );
    }
  } finally {
    if (browser) await browser.close();
    await server.close();
    rmSync(benchVideo, { force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
