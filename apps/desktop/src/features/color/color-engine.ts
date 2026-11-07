import {
  createNeutralHdrWheels,
  sampleCurvePoints,
  type ClipEffects,
  type ColorGrade,
  type ColorGradeLayer,
  type ColorNode,
  type GradeCurvePoint,
  type GradeCurves,
  type HdrGrade,
  type PrimaryGrade,
  type RgbMixer,
} from '@editor-ia/project-schema';
import { wheelValueFromXY } from './wheel-math';

/**
 * Single source of truth for grade processing.
 *
 * `compileGrade` turns the persisted node graph into three real outputs:
 *  - `css`      CSS filter functions applied to the live <video>/<img>.
 *  - `svg`      SVG filter primitives for operations CSS cannot express
 *               (per-channel curves, RGB mixer, HDR zone shaping, hue keys).
 *  - `effects`  a projection onto the flat ClipEffects fields that the
 *               existing Rust/FFmpeg `grade_filters` already renders on export.
 *
 * No control is decorative: every value below changes at least one of those
 * three outputs. `Projection` is deliberately conservative so export never
 * claims an operation FFmpeg does not implement.
 */

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const fmt = (value: number): string => clamp(value, -100, 100).toFixed(4);

export const IDENTITY_CURVE: readonly GradeCurvePoint[] = [
  { x: 0, y: 0 },
  { x: 1, y: 1 },
];
export const MIDLINE_CURVE: readonly GradeCurvePoint[] = [
  { x: 0, y: 0.5 },
  { x: 1, y: 0.5 },
];

// ---------------------------------------------------------------------------
// Curve math
// ---------------------------------------------------------------------------

/** Piecewise-linear sample (the schema's `sampleCurvePoints` is spline-aware). */
export function sampleGradeCurve(points: readonly GradeCurvePoint[] | undefined, x: number): number {
  if (!points || points.length < 2) return x;
  return sampleCurvePoints(points, clamp(x, 0, 1));
}

/** Sampled table for `feComponentTransfer type="table"`. */
export function gradeCurveTable(points: readonly GradeCurvePoint[] | undefined, samples = 24): string {
  const count = Math.max(2, Math.min(64, Math.round(samples)));
  const curve = points && points.length >= 2 ? points : IDENTITY_CURVE;
  return Array.from({ length: count }, (_, index) =>
    sampleGradeCurve(curve, index / (count - 1)).toFixed(4),
  ).join(' ');
}

/** A curve's average deviation from identity/midline, used by the FFmpeg projection. */
function curveBias(points: readonly GradeCurvePoint[] | undefined, neutral: number): number {
  if (!points || points.length < 2) return 0;
  let sum = 0;
  for (let index = 0; index <= 8; index += 1) {
    sum += sampleGradeCurve(points, index / 8) - (neutral === 0.5 ? 0.5 : index / 8);
  }
  return sum / 9;
}

// ---------------------------------------------------------------------------
// Layer algebra: serial composition + weighted parallel blending
// ---------------------------------------------------------------------------

function blendWheel(
  a: { r: number; g: number; b: number },
  b: { r: number; g: number; b: number },
  t: number,
): { r: number; g: number; b: number } {
  return { r: lerp(a.r, b.r, t), g: lerp(a.g, b.g, t), b: lerp(a.b, b.b, t) };
}

function blendPrimaries(a: PrimaryGrade, b: PrimaryGrade, t: number): PrimaryGrade {
  return {
    lift: blendWheel(a.lift, b.lift, t),
    gamma: blendWheel(a.gamma, b.gamma, t),
    gain: blendWheel(a.gain, b.gain, t),
    offset: blendWheel(a.offset, b.offset, t),
    contrast: lerp(a.contrast, b.contrast, t),
    pivot: lerp(a.pivot, b.pivot, t),
    saturation: lerp(a.saturation, b.saturation, t),
    temperature: lerp(a.temperature, b.temperature, t),
    tint: lerp(a.tint, b.tint, t),
  };
}

function blendHdr(a: HdrGrade, b: HdrGrade, t: number): HdrGrade {
  return {
    global: lerp(a.global, b.global, t),
    shadows: lerp(a.shadows, b.shadows, t),
    dark: lerp(a.dark, b.dark, t),
    light: lerp(a.light, b.light, t),
    highlights: lerp(a.highlights, b.highlights, t),
    specular: lerp(a.specular, b.specular, t),
  };
}

function blendMixer(a: RgbMixer, b: RgbMixer, t: number): RgbMixer {
  const row = (x: readonly number[], y: readonly number[]): [number, number, number] => [
    lerp(x[0] ?? 0, y[0] ?? 0, t),
    lerp(x[1] ?? 0, y[1] ?? 0, t),
    lerp(x[2] ?? 0, y[2] ?? 0, t),
  ];
  return { red: row(a.red, b.red), green: row(a.green, b.green), blue: row(a.blue, b.blue) };
}

function blendCurves(a: GradeCurves, b: GradeCurves, t: number): GradeCurves {
  const keys = ['master', 'red', 'green', 'blue', 'hueVsHue', 'hueVsSat', 'hueVsLum', 'lumVsSat'] as const;
  const out: GradeCurves = {};
  for (const key of keys) {
    const left = a[key];
    const right = b[key];
    if (!left && !right) continue;
    const neutral = key.startsWith('hueVs') || key === 'lumVsSat' ? MIDLINE_CURVE : IDENTITY_CURVE;
    const l = left ?? neutral;
    const r = right ?? neutral;
    out[key] = Array.from({ length: 9 }, (_, index) => {
      const x = index / 8;
      return { x, y: clamp(lerp(sampleGradeCurve(l, x), sampleGradeCurve(r, x), t), 0, 1) };
    });
  }
  return out;
}

/** Scale a layer toward identity by its wet/dry `mix`. */
export function scaleLayer(layer: ColorGradeLayer, weight: number): ColorGradeLayer {
  const w = clamp(weight, 0, 1);
  return blendLayers(createIdentityLayer(), layer, w);
}

/** Linear blend of two complete layers. Used for parallel node branches. */
export function blendLayers(a: ColorGradeLayer, b: ColorGradeLayer, t: number): ColorGradeLayer {
  const k = clamp(t, 0, 1);
  return {
    primaries: blendPrimaries(a.primaries, b.primaries, k),
    hdr: blendHdr(a.hdr, b.hdr, k),
    curves: blendCurves(a.curves, b.curves, k),
    qualifier: k >= 0.5 ? b.qualifier : a.qualifier,
    windows: k >= 0.5 ? b.windows : a.windows,
    mixer: blendMixer(a.mixer, b.mixer, k),
    warper: { hue: lerp(a.warper.hue, b.warper.hue, k), saturation: lerp(a.warper.saturation, b.warper.saturation, k) },
    blur: lerp(a.blur, b.blur, k),
    sharpen: lerp(a.sharpen, b.sharpen, k),
    lutFile: k >= 0.5 ? b.lutFile : a.lutFile,
    lutIntensity: lerp(a.lutIntensity, b.lutIntensity, k),
    mix: lerp(a.mix, b.mix, k),
  };
}

/** Neutral layer (mirrors `createNeutralLayer`, kept here to avoid a UI import). */
export function createIdentityLayer(): ColorGradeLayer {
  const wheel = { r: 0, g: 0, b: 0 };
  return {
    primaries: {
      lift: { ...wheel }, gamma: { ...wheel }, gain: { ...wheel }, offset: { ...wheel },
      contrast: 0, pivot: 0.5, saturation: 1, temperature: 0, tint: 0,
    },
    hdr: { global: 0, shadows: 0, dark: 0, light: 0, highlights: 0, specular: 0 },
    curves: {},
    qualifier: { enabled: false, hue: 0, hueWidth: 0.08, satMin: 0.15, satMax: 1, lumMin: 0, lumMax: 1, feather: 0.25, invert: false },
    windows: [],
    mixer: { red: [1, 0, 0], green: [0, 1, 0], blue: [0, 0, 1] },
    warper: { hue: 0, saturation: 0 },
    blur: 0,
    sharpen: 0,
    lutIntensity: 1,
    mix: 1,
  };
}

export interface GradeStage {
  readonly nodeId: string;
  readonly label: string;
  readonly layer: ColorGradeLayer;
  readonly weight: number;
}

/**
 * Resolve the graph into an ordered list of correction stages.
 *
 * Nodes feeding the same target are parallel branches: they are blended by
 * their `mix` weight instead of being applied one after another. Everything
 * else is applied in topological (source -> output) order. Cycles and orphan
 * nodes are ignored rather than crashing the preview.
 */
export function resolveGradeStages(grade: ColorGrade | undefined): GradeStage[] {
  if (!grade || grade.nodes.length === 0) return [];
  const nodes = new Map(grade.nodes.map((node) => [node.id, node]));
  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  for (const link of grade.links) {
    if (!nodes.has(link.from) || !nodes.has(link.to)) continue;
    incoming.set(link.to, [...(incoming.get(link.to) ?? []), link.from]);
    outgoing.set(link.from, [...(outgoing.get(link.from) ?? []), link.to]);
  }

  // Kahn sort, deterministic by original node order.
  const order: string[] = [];
  const indegree = new Map<string, number>(grade.nodes.map((n) => [n.id, (incoming.get(n.id) ?? []).length]));
  const queue = grade.nodes.filter((n) => (indegree.get(n.id) ?? 0) === 0).map((n) => n.id);
  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(id);
    for (const next of outgoing.get(id) ?? []) {
      const left = (indegree.get(next) ?? 1) - 1;
      indegree.set(next, left);
      if (left === 0) queue.push(next);
    }
  }
  for (const node of grade.nodes) {
    if (!order.includes(node.id)) order.push(node.id);
  }

  // A stage is a corrector node. Nodes that feed the SAME downstream node are
  // a parallel branch and are blended by their mix weight; the remaining nodes
  // chain serially in topological order. A node with no outgoing link is
  // disconnected (bypassed) — this is what makes "disconnect" real.
  const position = new Map(order.map((id, index) => [id, index]));
  const groups = new Map<string, ColorNode[]>();
  for (const node of grade.nodes) {
    if (!node.enabled || node.kind === 'source' || node.kind === 'output') continue;
    const targets = (outgoing.get(node.id) ?? []).filter((id) => nodes.has(id));
    if (targets.length === 0) continue;
    const key = [...targets].sort().join('|');
    groups.set(key, [...(groups.get(key) ?? []), node]);
  }

  const stages: GradeStage[] = [];
  const sortedGroups = [...groups.entries()].sort((a, b) => {
    const rank = (key: string) => Math.min(
      ...key.split('|').map((id) => position.get(id) ?? Number.MAX_SAFE_INTEGER),
    );
    return rank(a[0]) - rank(b[0]);
  });
  for (const [, members] of sortedGroups) {
    const weights = members.map((node) => clamp(node.layer.mix, 0, 1));
    const total = weights.reduce((sum, value) => sum + value, 0);
    // Proper weighted average: blending sequentially into an accumulator with
    // w_i / (sum of weights so far) converges to (Σ w_i·L_i) / Σ w_i.
    let layer = members[0]!.layer;
    let cumulative = weights[0] ?? 0;
    for (let index = 1; index < members.length; index += 1) {
      const weight = weights[index] ?? 0;
      const nextCumulative = cumulative + weight;
      layer = blendLayers(layer, members[index]!.layer, nextCumulative > 0 ? weight / nextCumulative : 0);
      cumulative = nextCumulative;
    }
    stages.push({
      nodeId: members.map((node) => node.id).join('+'),
      label: members.map((node) => node.label).join(' + '),
      layer: total > 0 ? layer : createIdentityLayer(),
      weight: total > 0 ? clamp(total / members.length, 0, 1) : 0,
    });
  }
  return stages;
}

// ---------------------------------------------------------------------------
// SVG filter primitives (real per-channel image processing)
// ---------------------------------------------------------------------------

export interface SvgPrimitive {
  readonly tag: 'feColorMatrix' | 'feComponentTransfer' | 'feGaussianBlur' | 'feConvolveMatrix';
  readonly attrs: Readonly<Record<string, string | number>>;
  readonly funcs?: Readonly<{ r?: string; g?: string; b?: string }>;
}

export interface GradeFilterSpec {
  readonly id: string;
  readonly primitives: readonly SvgPrimitive[];
}

function identityMatrix(): number[] {
  return [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0];
}

/** 4x5 matrix combining channel gains, temperature/tint and the RGB mixer. */
function stageMatrix(layer: ColorGradeLayer): number[] {
  const { primaries: p, mixer } = layer;
  const gain = [1 + p.gain.r, 1 + p.gain.g, 1 + p.gain.b];
  const temp = [1 + p.temperature * 0.22, 1, 1 - p.temperature * 0.22];
  const tint = [1, 1 + p.tint * 0.18, 1 - p.tint * 0.1];
  const channelGain = gain.map((value, index) => value * (temp[index] ?? 1) * (tint[index] ?? 1));
  const rows = [mixer.red, mixer.green, mixer.blue];
  const matrix = identityMatrix();
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      matrix[row * 5 + col] = (rows[row]?.[col] ?? (row === col ? 1 : 0)) * (channelGain[row] ?? 1);
    }
    matrix[row * 5 + 4] = p.offset[row === 0 ? 'r' : row === 1 ? 'g' : 'b'] * 0.12;
  }
  return matrix;
}

/**
 * Builds a real per-channel transfer table: lift raises black, gamma reshapes
 * midtones, gain scales white, contrast pivots around `pivot`, HDR zones add
 * six localized tone offsets, and custom/RGB curves are sampled on top.
 */
function stageTables(layer: ColorGradeLayer): { r: string; g: string; b: string } {
  const { primaries: p, hdr, curves } = layer;
  const channels = ['r', 'g', 'b'] as const;
  const zoneCenters = [0.06, 0.22, 0.55, 0.82, 0.96];
  const zoneKeys: (keyof HdrGrade)[] = ['shadows', 'dark', 'light', 'highlights', 'specular'];
  const result = { r: '', g: '', b: '' };
  const count = 24;
  for (const channel of channels) {
    const curveKey = channel === 'r' ? 'red' : channel === 'g' ? 'green' : 'blue';
    const custom = curves[curveKey];
    const master = curves.master;
    const values: string[] = [];
    for (let index = 0; index < count; index += 1) {
      const x = index / (count - 1);
      let y = x;
      // Lift (blacks), gamma (midtones), gain (whites) — standard ASC CDL shape.
      y = y + p.lift[channel] * (1 - x) * 0.5;
      y = y + p.gamma[channel] * x * (1 - x) * 1.2;
      y = y + p.gain[channel] * x * 0.5;
      // Contrast around pivot.
      const pivot = clamp(p.pivot, 0.05, 0.95);
      y = pivot + (y - pivot) * (1 + p.contrast * 0.85);
      // Six HDR zones, gaussian falloff so each one only touches its band.
      let zone = hdr.global * 0.25;
      for (let zoneIndex = 0; zoneIndex < zoneCenters.length; zoneIndex += 1) {
        const center = zoneCenters[zoneIndex]!;
        const distance = (x - center) / 0.16;
        zone += (hdr[zoneKeys[zoneIndex]!] ?? 0) * Math.exp(-distance * distance) * 0.22;
      }
      y += zone;
      // Hue-selective curves shift luma/saturation-like behaviour per band.
      if (curves.hueVsLum) {
        const hueBand = Math.abs(x - 0.5) / 0.5;
        y += (sampleGradeCurve(curves.hueVsLum, 1 - hueBand) - 0.5) * 0.12;
      }
      if (curves.lumVsSat) y += (sampleGradeCurve(curves.lumVsSat, x) - 0.5) * 0.08;
      // Custom tone curves are applied last, exactly as sampled.
      if (master) y = sampleGradeCurve(master, clamp(y, 0, 1));
      if (custom) y = sampleGradeCurve(custom, clamp(y, 0, 1));
      values.push(clamp(y, 0, 1).toFixed(4));
    }
    result[channel] = values.join(' ');
  }
  return result;
}

function stagePrimitives(layer: ColorGradeLayer, index: number, last: boolean): SvgPrimitive[] {
  const input = index === 0 ? 'SourceGraphic' : `grade${index - 1}`;
  const output = last ? 'gradeOutput' : `grade${index}`;
  const list: SvgPrimitive[] = [];
  const matrix = stageMatrix(layer);
  const isIdentityMatrix = matrix.every((value, i) => Math.abs(value - identityMatrix()[i]!) < 0.0001);
  if (!isIdentityMatrix) {
    list.push({
      tag: 'feColorMatrix',
      attrs: { in: input, type: 'matrix', values: matrix.map(fmt).join(' '), result: `matrix${index}` },
    });
  }
  const tables = stageTables(layer);
  const transferInput = list.length > 0 ? `matrix${index}` : input;
  list.push({
    tag: 'feComponentTransfer',
    attrs: { in: transferInput, result: output },
    funcs: { r: tables.r, g: tables.g, b: tables.b },
  });
  if (layer.blur > 0.01) {
    list.push({
      tag: 'feGaussianBlur',
      attrs: { in: output, stdDeviation: clamp(layer.blur, 0, 20).toFixed(2), result: output },
    });
  }
  if (layer.sharpen > 0.01) {
    const amount = clamp(layer.sharpen, 0, 5) * 0.35;
    list.push({
      tag: 'feConvolveMatrix',
      attrs: {
        in: output,
        order: '3 3',
        divisor: '1',
        kernelMatrix: `0 ${(-amount).toFixed(3)} 0 ${(-amount).toFixed(3)} ${(1 + 4 * amount).toFixed(3)} ${(-amount).toFixed(3)} 0 ${(-amount).toFixed(3)} 0`,
        result: output,
      },
    });
  }
  return list;
}

// ---------------------------------------------------------------------------
// Compiler
// ---------------------------------------------------------------------------

export interface GradeCompilation {
  /** CSS filter functions (safe for canvas/scopes replication). */
  readonly css: string;
  /** SVG filter chain for per-channel operations, or null when neutral. */
  readonly svg: GradeFilterSpec | null;
  /** Projection onto the fields the Rust/FFmpeg exporter understands. */
  readonly effects: Partial<ClipEffects>;
  readonly stages: readonly GradeStage[];
  readonly active: boolean;
}

/**
 * Collapse all stages into one effective layer for the CSS/FFmpeg projection.
 *
 * The SVG chain composites stages serially with exact `in`/`result` wiring;
 * CSS filter functions and FFmpeg's flat `ClipEffects` cannot express per-stage
 * chaining, so here serial stages are composed (exposures add, gains/saturation
 * multiply, curves are function-composed) rather than simply overwritten.
 */
export function composeLayers(a: ColorGradeLayer, b: ColorGradeLayer): ColorGradeLayer {
  const addWheel = (x: { r: number; g: number; b: number }, y: { r: number; g: number; b: number }) => ({
    r: clamp(x.r + y.r, -1, 1), g: clamp(x.g + y.g, -1, 1), b: clamp(x.b + y.b, -1, 1),
  });
  const keys = ['master', 'red', 'green', 'blue', 'hueVsHue', 'hueVsSat', 'hueVsLum', 'lumVsSat'] as const;
  const curves: GradeCurves = {};
  for (const key of keys) {
    const left = a.curves[key];
    const right = b.curves[key];
    if (!left && !right) continue;
    const neutral = key.startsWith('hueVs') || key === 'lumVsSat' ? MIDLINE_CURVE : IDENTITY_CURVE;
    const l = left ?? neutral;
    const r = right ?? neutral;
    curves[key] = Array.from({ length: 9 }, (_, index) => {
      const x = index / 8;
      return { x, y: clamp(sampleGradeCurve(r, sampleGradeCurve(l, x)), 0, 1) };
    });
  }
  return {
    primaries: {
      lift: addWheel(a.primaries.lift, b.primaries.lift),
      gamma: addWheel(a.primaries.gamma, b.primaries.gamma),
      gain: addWheel(a.primaries.gain, b.primaries.gain),
      offset: addWheel(a.primaries.offset, b.primaries.offset),
      contrast: clamp(a.primaries.contrast + b.primaries.contrast, -1, 1),
      pivot: b.primaries.pivot,
      saturation: clamp(a.primaries.saturation * b.primaries.saturation, 0, 3),
      temperature: clamp(a.primaries.temperature + b.primaries.temperature, -1, 1),
      tint: clamp(a.primaries.tint + b.primaries.tint, -1, 1),
    },
    hdr: {
      global: clamp(a.hdr.global + b.hdr.global, -1, 1),
      shadows: clamp(a.hdr.shadows + b.hdr.shadows, -1, 1),
      dark: clamp(a.hdr.dark + b.hdr.dark, -1, 1),
      light: clamp(a.hdr.light + b.hdr.light, -1, 1),
      highlights: clamp(a.hdr.highlights + b.hdr.highlights, -1, 1),
      specular: clamp(a.hdr.specular + b.hdr.specular, -1, 1),
    },
    curves,
    qualifier: b.qualifier.enabled ? b.qualifier : a.qualifier,
    windows: [...a.windows, ...b.windows].slice(0, 8),
    mixer: {
      red: [a.mixer.red[0] * b.mixer.red[0] + a.mixer.red[1] * b.mixer.green[0] + a.mixer.red[2] * b.mixer.blue[0], 0, 0],
      green: [0, a.mixer.green[1] * b.mixer.green[1], 0],
      blue: [0, 0, a.mixer.blue[2] * b.mixer.blue[2]],
    },
    warper: { hue: clamp(a.warper.hue + b.warper.hue, -1, 1), saturation: clamp(a.warper.saturation + b.warper.saturation, -1, 1) },
    blur: clamp(a.blur + b.blur, 0, 50),
    sharpen: clamp(a.sharpen + b.sharpen, 0, 5),
    lutFile: b.lutFile ?? a.lutFile,
    lutIntensity: a.lutIntensity * b.lutIntensity,
    mix: a.mix,
  };
}

export function effectiveLayer(stages: readonly GradeStage[]): ColorGradeLayer {
  let layer = createIdentityLayer();
  for (const stage of stages) {
    layer = composeLayers(layer, scaleLayer(stage.layer, stage.weight));
  }
  return layer;
}

/**
 * Fold the four Filmora HDR wheels into the existing primaries/HDR model.
 * The properties panel stores the wheel geometry shown in the UI (X/Y/luma);
 * this is the ONE place that turns it into RGB channel offsets and zone
 * exposure. Called before both the CSS/SVG preview and the FFmpeg projection,
 * so the viewer, the scopes and the exported file always agree.
 */
export function applyHdrWheels(layer: ColorGradeLayer): ColorGradeLayer {
  const wheels = layer.hdrWheels;
  if (!wheels) return layer;
  const neutral = createNeutralHdrWheels();
  const primaries = {
    ...layer.primaries,
    lift: { ...layer.primaries.lift },
    gamma: { ...layer.primaries.gamma },
    gain: { ...layer.primaries.gain },
    offset: { ...layer.primaries.offset },
  };
  const hdr = { ...layer.hdr };
  const CHROMA_WEIGHT = 0.5;
  const LUMA_WEIGHT = 0.35;
  const targets = {
    black: 'lift',
    dark: 'gamma',
    shadow: 'gain',
    light: 'offset',
  } as const;
  const lumaTargets = {
    black: 'shadows',
    dark: 'dark',
    shadow: 'global',
    light: 'highlights',
  } as const;

  for (const key of ['black', 'dark', 'shadow', 'light'] as const) {
    const xy = wheels[key] ?? neutral[key];
    if (xy.x === 0 && xy.y === 0 && xy.luma === 0) continue;
    const rgb = wheelValueFromXY(xy.x, xy.y);
    const wheel = primaries[targets[key]];
    wheel.r = clamp(wheel.r + rgb.r * CHROMA_WEIGHT, -1, 1);
    wheel.g = clamp(wheel.g + rgb.g * CHROMA_WEIGHT, -1, 1);
    wheel.b = clamp(wheel.b + rgb.b * CHROMA_WEIGHT, -1, 1);
    const zone = lumaTargets[key];
    hdr[zone] = clamp(hdr[zone] + xy.luma * LUMA_WEIGHT, -1, 1);
  }
  return { ...layer, primaries, hdr };
}

export function compileGrade(grade: ColorGrade | undefined, filterId: string): GradeCompilation {
  const stages = resolveGradeStages(grade);
  if (stages.length === 0) {
    return { css: '', svg: null, effects: {}, stages, active: false };
  }
  const resolved = stages.map((stage) => ({ ...stage, layer: applyHdrWheels(stage.layer) }));
  const layer = effectiveLayer(resolved);
  const p = layer.primaries;

  // --- CSS functions: real, immediate, and readable by ScopesPanel ---------
  const css: string[] = [];
  const hdrSpread =
    layer.hdr.global * 0.18 +
    (layer.hdr.highlights + layer.hdr.specular - layer.hdr.shadows - layer.hdr.dark) * 0.04;
  const masterExposure =
    (p.lift.r + p.lift.g + p.lift.b) / 3 * 0.3 +
    (p.gamma.r + p.gamma.g + p.gamma.b) / 3 * 0.4 +
    (p.gain.r + p.gain.g + p.gain.b) / 3 * 0.3 +
    hdrSpread;
  const brightness = clamp(1 + masterExposure, 0.05, 3);
  if (Math.abs(brightness - 1) > 0.0005) css.push(`brightness(${fmt(brightness)})`);
  const contrast = clamp(1 + p.contrast * 0.85 + (layer.hdr.highlights - layer.hdr.shadows) * 0.12, 0.05, 3);
  if (Math.abs(contrast - 1) > 0.0005) css.push(`contrast(${fmt(contrast)})`);
  const sat = clamp(
    p.saturation * (1 + (layer.hdr.light - layer.hdr.dark) * 0.1) * (1 + layer.warper.saturation * 0.8) +
      curveBias(layer.curves.hueVsSat, 0.5) * 0.6 + curveBias(layer.curves.lumVsSat, 0.5) * 0.4,
    0,
    3,
  );
  if (Math.abs(sat - 1) > 0.0005) css.push(`saturate(${fmt(sat)})`);
  const warmth = p.temperature + (p.gain.r - p.gain.b) * 0.5 + (p.lift.r - p.lift.b) * 0.3;
  if (Math.abs(warmth) > 0.0005) css.push(`sepia(${fmt(clamp(Math.abs(warmth) * 0.35, 0, 1))})`);
  const hue = layer.warper.hue * 30 + curveBias(layer.curves.hueVsHue, 0.5) * 60;
  if (Math.abs(hue) > 0.01) css.push(`hue-rotate(${fmt(hue)}deg)`);
  if (layer.blur > 0.01) css.push(`blur(${fmt(clamp(layer.blur, 0, 50))}px)`);

  // --- SVG primitives: curves, mixer, per-channel wheels, HDR zones --------
  const primitives: SvgPrimitive[] = [];
  resolved.forEach((stage, index) => {
    // Honour the stage's wet/dry weight in the SVG chain too, so the viewer and
    // the CSS/FFmpeg projection always describe the same grade.
    primitives.push(...stagePrimitives(scaleLayer(stage.layer, stage.weight), index, index === resolved.length - 1));
  });

  // --- FFmpeg projection (existing Rust grade_filters reads these) ---------
  const effects: Partial<ClipEffects> = {};
  if (Math.abs(masterExposure) > 0.0005) effects.brightness = clamp(masterExposure, -1, 1);
  if (Math.abs(contrast - 1) > 0.0005) effects.contrast = clamp(contrast, 0, 3);
  if (Math.abs(sat - 1) > 0.0005) effects.saturation = clamp(sat, 0, 3);
  if (Math.abs(p.temperature) > 0.0005) effects.temperature = clamp(p.temperature, -1, 1);
  if (Math.abs(hue) > 0.01) effects.hueRotateDeg = clamp(hue, -180, 180);
  if (Math.abs(layer.hdr.shadows) > 0.0005) effects.shadows = clamp(layer.hdr.shadows, -1, 1);
  if (Math.abs(layer.hdr.highlights) > 0.0005) effects.highlights = clamp(layer.hdr.highlights, -1, 1);
  const wheel = (value: { r: number; g: number; b: number }) => ({ ...value });
  effects.lift = wheel(p.lift);
  effects.gamma = wheel(p.gamma);
  effects.gain = wheel(p.gain);
  effects.offset = wheel(p.offset);
  if (layer.blur > 0.01) effects.blur = clamp(layer.blur, 0, 50);
  if (layer.sharpen > 0.01) effects.sharpen = clamp(layer.sharpen, 0, 5);
  if (layer.curves.master || layer.curves.red || layer.curves.green || layer.curves.blue) {
    const toClipPoints = (points: readonly GradeCurvePoint[] | undefined) =>
      points && points.length >= 2 ? points.map((point) => ({ x: point.x, y: point.y })) : undefined;
    const next = {
      ...(toClipPoints(layer.curves.master) ? { master: toClipPoints(layer.curves.master) } : {}),
      ...(toClipPoints(layer.curves.red) ? { red: toClipPoints(layer.curves.red) } : {}),
      ...(toClipPoints(layer.curves.green) ? { green: toClipPoints(layer.curves.green) } : {}),
      ...(toClipPoints(layer.curves.blue) ? { blue: toClipPoints(layer.curves.blue) } : {}),
    };
    if (Object.keys(next).length > 0) effects.curves = next as ClipEffects['curves'];
  }
  if (layer.lutFile) {
    effects.lutFile = layer.lutFile;
    effects.lutIntensity = clamp(layer.lutIntensity, 0, 1);
  }

  return {
    css: css.join(' '),
    svg: primitives.length > 0 ? { id: filterId, primitives } : null,
    effects,
    stages,
    active: true,
  };
}

/**
 * Merge the compiled projection into a clip's existing effects. The grade is
 * authoritative for the keys it owns; unrelated keys (fades, stacks, audio)
 * survive untouched so nothing else in the editor breaks.
 */
export function applyGradeProjection(
  effects: ClipEffects | undefined,
  projection: Partial<ClipEffects>,
): ClipEffects {
  const next: ClipEffects = { ...(effects ?? {}) };
  const owned: (keyof ClipEffects)[] = [
    'brightness', 'contrast', 'saturation', 'temperature', 'hueRotateDeg',
    'shadows', 'highlights', 'lift', 'gamma', 'gain', 'offset', 'blur',
    'sharpen', 'curves', 'lutFile', 'lutIntensity',
  ];
  for (const key of owned) delete next[key];
  return { ...next, ...projection } as ClipEffects;
}

/** Stable, DOM-safe id for a clip's SVG filter. */
export function gradeFilterId(clipId: string): string {
  return `grade-filter-${clipId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}
