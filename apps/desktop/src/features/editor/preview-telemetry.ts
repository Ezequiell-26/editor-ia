import { useSyncExternalStore } from 'react';

/**
 * Telemetría de la vista previa y calidad adaptativa.
 *
 * Port del patrón `TelemetryCollector`/`adaptive_quality_desired` de
 * Kloicut (`crates/engine/src/telemetry.rs`) al monitor del navegador:
 * allí se medían ms de decode por frame y ratio de frames salteados para
 * decidir Draft/Proxy/Thumbnail/Full; acá las señales equivalentes son el
 * cadence real de los rAF durante la reproducción (delta entre frames de
 * pantalla) y los eventos `waiting`/`stalled` de los `<video>`/`<audio>`
 * (el decode del navegador es lo que se "salta" cuando no llega).
 *
 * El nivel resultante sólo decide QUÉ fuente reproduce cada capa de video:
 * `full` = archivo original, `proxy`/`draft` = proxy listo (aplicado al
 * proyecto o sólo verificado por `proxyStatus`, sin mutar el documento).
 * La histéresis replica la del original: bajar de calidad exige evaluaciones
 * degradadas consecutivas; subirla exige una racha limpia (≥5, como
 * `consecutive_fast_decode`).
 */

export type PreviewQuality = 'full' | 'proxy' | 'draft';

export interface PreviewTelemetrySnapshot {
  /** FPS medidos por cadence de rAF durante la reproducción (0 = sin datos). */
  readonly fps: number;
  /** Fracción de muestras malas (frames lentos + esperas de medio) en la ventana. */
  readonly badRatio: number;
  /** Nivel de calidad que la telemetría pide ahora mismo. */
  readonly quality: PreviewQuality;
  /** true mientras el usuario eligió «Automática» en el selector de calidad. */
  readonly auto: boolean;
}

const WINDOW = 120;
const MIN_SAMPLES = 30;
const EVAL_INTERVAL_MS = 300;
/** Un frame es "lento" si supera 1.75× el presupuesto del fps del proyecto. */
const SLOW_FACTOR = 1.75;
/** Racha de muestras malas seguidas que equivale al `is_decode_slow` original. */
const SLOW_STREAK = 3;
/** Evaluaciones degradadas consecutivas para bajar de calidad. */
const DOWNGRADE_EVALS = 2;
/** Evaluaciones limpias consecutivas para subir de calidad (consecutive_fast ≥5). */
const UPGRADE_EVALS = 5;

interface Sample {
  /** Delta rAF en ms; null en eventos de espera de medio. */
  readonly deltaMs: number | null;
  readonly bad: boolean;
}

const QUALITY_RANK: Record<PreviewQuality, number> = { full: 0, proxy: 1, draft: 2 };

let samples: Sample[] = [];
let quality: PreviewQuality = 'full';
let auto = false;
let frameMs = 1000 / 30;
let lastEvalAt = 0;
let badEvals = 0;
let cleanEvals = 0;
let snapshot: PreviewTelemetrySnapshot = { fps: 0, badRatio: 0, quality, auto };
const listeners = new Set<() => void>();

function emit(): void {
  snapshot = { ...snapshot, fps: measuredFps(), badRatio: badRatio(), quality, auto };
  for (const listener of listeners) listener();
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

function measuredFps(): number {
  const deltas = samples
    .map((sample) => sample.deltaMs)
    .filter((delta): delta is number => delta !== null && delta > 0);
  if (deltas.length < 5) return 0;
  const med = median(deltas);
  return med > 0 ? Math.round(1000 / med) : 0;
}

function badRatio(): number {
  if (samples.length === 0) return 0;
  const bad = samples.reduce((count, sample) => count + (sample.bad ? 1 : 0), 0);
  return bad / samples.length;
}

function slowStreak(): number {
  let streak = 0;
  for (let index = samples.length - 1; index >= 0; index -= 1) {
    if (!samples[index]!.bad) break;
    streak += 1;
  }
  return streak;
}

/** Candidato de calidad con los umbrales del `adaptive_quality_desired` original. */
function candidateQuality(): PreviewQuality {
  const ratio = badRatio();
  if (ratio > 0.3 || slowStreak() >= SLOW_STREAK) return 'draft';
  if (ratio > 0.1) return 'proxy';
  return 'full';
}

function evaluate(now: number): void {
  if (samples.length < MIN_SAMPLES || now - lastEvalAt < EVAL_INTERVAL_MS) return;
  lastEvalAt = now;
  const candidate = candidateQuality();
  if (QUALITY_RANK[candidate] > QUALITY_RANK[quality]) {
    badEvals += 1;
    cleanEvals = 0;
    if (badEvals >= DOWNGRADE_EVALS) {
      quality = candidate;
      badEvals = 0;
    }
  } else if (QUALITY_RANK[candidate] < QUALITY_RANK[quality]) {
    cleanEvals += 1;
    badEvals = 0;
    if (cleanEvals >= UPGRADE_EVALS) {
      quality = candidate;
      cleanEvals = 0;
    }
  } else {
    badEvals = 0;
    cleanEvals = 0;
  }
  emit();
}

/**
 * Un frame de pantalla durante la reproducción. `deltaMs` es el tiempo real
 * entre rAF consecutivos; `frameMs` el presupuesto (1000/fps del proyecto).
 * Llamar sólo mientras `playing`.
 */
export function recordPlaybackFrame(deltaMs: number, frameMsValue: number, now = performance.now()): void {
  frameMs = frameMsValue > 0 ? frameMsValue : frameMs;
  samples.push({ deltaMs, bad: deltaMs > frameMs * SLOW_FACTOR });
  if (samples.length > WINDOW) samples = samples.slice(samples.length - WINDOW);
  evaluate(now);
}

/** Un `<video>`/`<audio>` quedó sin datos durante la reproducción (stall). */
export function recordPreviewWait(now = performance.now()): void {
  samples.push({ deltaMs: null, bad: true });
  if (samples.length > WINDOW) samples = samples.slice(samples.length - WINDOW);
  evaluate(now);
}

/** Activa/desactiva el modo «Automática» del selector de calidad del monitor. */
export function setPreviewAutoQuality(enabled: boolean): void {
  if (auto === enabled) return;
  auto = enabled;
  if (!enabled) {
    quality = 'full';
    badEvals = 0;
    cleanEvals = 0;
  }
  emit();
}

/** Presupuesto de frame del proyecto para calibrar qué es un frame lento. */
export function setPreviewFrameBudget(frameMsValue: number): void {
  if (frameMsValue > 0) frameMs = frameMsValue;
}

/** Limpia muestras y nivel (cambio de proyecto o de modo). */
export function resetPreviewTelemetry(): void {
  samples = [];
  quality = 'full';
  badEvals = 0;
  cleanEvals = 0;
  lastEvalAt = 0;
  emit();
}

export function getPreviewTelemetry(): PreviewTelemetrySnapshot {
  return snapshot;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Snapshot reactivo; sólo re-renderiza cuando la telemetría evalúa (~300 ms). */
export function usePreviewTelemetry(): PreviewTelemetrySnapshot {
  return useSyncExternalStore(subscribe, getPreviewTelemetry, getPreviewTelemetry);
}

/** Sólo para tests: estado cero sin tocar `auto`. */
export function resetPreviewTelemetryForTests(): void {
  resetPreviewTelemetry();
  auto = false;
  emit();
}
