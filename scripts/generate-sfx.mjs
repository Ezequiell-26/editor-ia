#!/usr/bin/env node
/**
 * Genera los efectos de sonido de la biblioteca SFX (paridad `sons.js` de
 * AlaukCut) como WAV PCM 16-bit mono 44.1 kHz en
 * `apps/desktop/src-tauri/resources/sfx/`. Síntesis procedural propia:
 * no hay samples de terceros, las licencias no aplican.
 *
 * Uso: node scripts/generate-sfx.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'apps', 'desktop', 'src-tauri', 'resources', 'sfx');
const SAMPLE_RATE = 44_100;

const TWO_PI = Math.PI * 2;

function makeRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/** Oscilador con fase continua; `freq(t)` en Hz. */
function osc(freqFn, phase0 = 0) {
  let phase = phase0;
  return (t) => {
    const dt = 1 / SAMPLE_RATE;
    const value = Math.sin(phase);
    phase += TWO_PI * freqFn(t) * dt;
    return value;
  };
}

/** Ruido blanco determinista en [-1,1]. */
function noise(rng) {
  return () => rng() * 2 - 1;
}

/** Pasa-bajas de un polo: `alpha` más bajo = más suave. */
function lowpass(alpha) {
  let y = 0;
  return (x) => {
    y += alpha * (x - y);
    return y;
  };
}

/** Pasa-altas de un polo (derivador suavizado). */
function highpass(alpha) {
  let y = 0;
  let prevX = 0;
  return (x) => {
    y = alpha * (y + x - prevX);
    prevX = x;
    return y;
  };
}

/** Envolvente ADSR mínima: ataque, decaimiento exponencial hasta el final. */
function decayEnv(attack, decay) {
  return (t) => {
    if (t < attack) return t / attack;
    const u = Math.min(1, (t - attack) / Math.max(1e-6, decay));
    return Math.exp(-4.5 * u);
  };
}

/** Curva suave 0→1→0 (para barridos). */
function swellEnv(attack, release) {
  return (t, duration) => {
    if (t < attack) return t / attack;
    const remaining = duration - t;
    if (remaining < release) return Math.max(0, remaining / release);
    return 1;
  };
}

function render(durationSeconds, fn) {
  const frames = Math.round(durationSeconds * SAMPLE_RATE);
  const samples = new Float32Array(frames);
  for (let i = 0; i < frames; i += 1) {
    samples[i] = Math.max(-1, Math.min(1, fn(i / SAMPLE_RATE, i, durationSeconds)));
  }
  // Fade in/out de 3 ms para evitar clicks en los bordes.
  const edge = Math.round(0.003 * SAMPLE_RATE);
  for (let i = 0; i < edge && i < frames; i += 1) {
    const g = i / edge;
    samples[i] *= g;
    samples[frames - 1 - i] *= g;
  }
  return samples;
}

function writeWav(path, samples) {
  const dataSize = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < samples.length; i += 1) {
    buffer.writeInt16LE(Math.round(samples[i] * 32767), 44 + i * 2);
  }
  writeFileSync(path, buffer);
}

/* ── Los 8 presets del catálogo (ids = SFX_PRESETS de EditorAssets) ─────── */

const PRESETS = {
  'sfx-click': {
    seconds: 0.08,
    label: 'Click Táctil',
    build() {
      const tick = osc(() => 2400, 0);
      const rng = makeRng(11);
      const nz = noise(rng);
      const hp = highpass(0.08);
      const env = decayEnv(0.001, 0.05);
      return (t) => 0.5 * tick(t) * env(t) + 0.35 * hp(nz()) * env(t);
    },
  },
  'sfx-pop': {
    seconds: 0.22,
    label: 'Pop Burbuja',
    build() {
      // Chirp descendente 950→320 Hz con decaimiento rápido: "burbuja".
      const chirp = osc((t) => 950 - 630 * Math.min(1, t / 0.09), 0);
      const env = decayEnv(0.004, 0.16);
      return (t) => chirp(t) * env(t) * 0.9;
    },
  },
  'sfx-ding': {
    seconds: 0.7,
    label: 'Ding Campana',
    build() {
      // Campana: fundamental + parciales inarmónicos, decaimiento largo.
      const f1 = osc(() => 880, 0);
      const f2 = osc(() => 1318.5, 0);
      const f3 = osc(() => 1975.5, 0);
      const env = decayEnv(0.003, 0.6);
      return (t) =>
        (0.6 * f1(t) + 0.3 * f2(t) + 0.15 * f3(t)) * env(t) * (t < 0.5 ? 1 : 0.4);
    },
  },
  'sfx-woosh': {
    seconds: 0.45,
    label: 'Woosh Rápido',
    build() {
      // Ruido con pasa-bajas que se abre y cierra + barrido de fase.
      const rng = makeRng(23);
      const nz = noise(rng);
      const lp = lowpass(0.12);
      const hp = highpass(0.35);
      const env = swellEnv(0.08, 0.12);
      const duration = 0.45;
      return (t) => {
        const openness = 0.3 + 0.7 * env(t, duration);
        const swept = lp(nz()) * openness + hp(nz()) * 0.15 * env(t, duration);
        return swept * 1.6 * env(t, duration);
      };
    },
  },
  'sfx-boom': {
    seconds: 1.2,
    label: 'Impacto Boom',
    build() {
      // Subida de seno 95→42 Hz + golpe de ruido inicial.
      const body = osc((t) => 95 - 53 * Math.min(1, t / 0.5), 0);
      const sub = osc((t) => 48 - 14 * Math.min(1, t / 0.8), 0);
      const rng = makeRng(37);
      const nz = noise(rng);
      const lp = lowpass(0.2);
      const env = decayEnv(0.005, 1.05);
      const thump = decayEnv(0.001, 0.09);
      return (t) =>
        (0.85 * body(t) + 0.5 * sub(t)) * env(t) + 0.5 * lp(nz()) * thump(t);
    },
  },
  'sfx-riser': {
    seconds: 2.0,
    label: 'Riser Tensión',
    build() {
      // Barrido 180→1400 Hz + ruido creciente, crescendo hasta el final.
      const tone = osc((t) => 180 * Math.pow(1400 / 180, t / 2.0), 0);
      const rng = makeRng(41);
      const nz = noise(rng);
      const lp = lowpass(0.18);
      const env = (t) => Math.pow(Math.min(1, t / 1.9), 1.6);
      return (t) => (0.35 * tone(t) + 0.3 * lp(nz())) * env(t) * 1.4;
    },
  },
  'sfx-glitch': {
    seconds: 0.5,
    label: 'Glitch Digital',
    build() {
      // Ráfagas de square con sample&hold (crush) en intervalos irregulares.
      const rng = makeRng(53);
      let held = 0;
      let nextChange = 0;
      const bursts = [0.02, 0.09, 0.14, 0.26, 0.33, 0.41];
      const burstLen = 0.045;
      return (t) => {
        const inBurst = bursts.some((start) => t >= start && t < start + burstLen);
        if (!inBurst) return 0;
        if (t >= nextChange) {
          held = rng() > 0.5 ? 1 : -1;
          nextChange = t + 0.012 + rng() * 0.02;
        }
        const jitter = rng() > 0.85 ? 0.4 : 1;
        return held * jitter * 0.4;
      };
    },
  },
  'sfx-subdrop': {
    seconds: 1.8,
    label: 'Sub-Drop',
    build() {
      // Caída 130→36 Hz con segundo armónico que se desvanece antes.
      const drop = osc((t) => 130 - 94 * Math.min(1, t / 1.1), 0);
      const harm = osc((t) => 2 * (130 - 94 * Math.min(1, t / 1.1)), 0);
      const env = decayEnv(0.01, 1.6);
      const harmEnv = decayEnv(0.005, 0.35);
      return (t) =>
        (0.9 * drop(t) + 0.3 * harm(t) * (t < 0.5 ? 1 : 0)) * env(t) +
        0.25 * harm(t) * harmEnv(t);
    },
  },
};

mkdirSync(OUT_DIR, { recursive: true });
for (const [id, preset] of Object.entries(PRESETS)) {
  const samples = render(preset.seconds, preset.build());
  const file = `${id}.wav`;
  writeWav(join(OUT_DIR, file), samples);
  // Pico real para el reporte.
  const peak = samples.reduce((max, s) => Math.max(max, Math.abs(s)), 0);
  console.log(`${file.padEnd(18)} ${(preset.seconds * 1000).toFixed(0).padStart(5)} ms  peak ${(peak * 100).toFixed(0).padStart(3)} %  ${preset.label}`);
}
console.log(`\n${Object.keys(PRESETS).length} efectos escritos en ${OUT_DIR}`);
