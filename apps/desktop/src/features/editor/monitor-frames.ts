import type { MonitorFrame, MonitorFramePreset } from '@editor-ia/project-schema';
import type { ContentBox } from './perspective';

/**
 * Marcos decorativos del monitor (paridad funcional con las «molduras» de
 * AlaukCut): 19 presets en 5 familias, 6 estilos de trazo y overrides de
 * color. La geometría replica su modelo: caja centrada de aspecto `prop`
 * dentro del content-box `object-fit`, radios por esquina, margen y
 * espesor como fracción del lado menor de la caja.
 */

export type Rgb = readonly [number, number, number];

export interface FramePreset {
  readonly id: MonitorFramePreset;
  readonly prop: number;
  readonly radii: readonly [number, number, number, number];
  readonly thickness: number;
  readonly color: Rgb;
  readonly color2?: Rgb;
  readonly style: 1 | 2 | 3 | 4 | 5 | 6;
  readonly hexagon?: boolean;
  readonly margin?: number;
}

const W: Rgb = [1, 1, 1];
const TEAL: Rgb = [0.27, 0.88, 0.83];
const GLASS: Rgb = [0.82, 0.86, 0.95];
const GOLD: Rgb = [0.98, 0.82, 0.35];
const AURORA1: Rgb = [0x8b / 255, 0x5c / 255, 0xf6 / 255];
const AURORA2: Rgb = [0x22 / 255, 0xd3 / 255, 0xee / 255];
const SUN1: Rgb = [1, 0xa6 / 255, 0x3d / 255];
const SUN2: Rgb = [1, 0x4d / 255, 0x8d / 255];
const ORBIT1: Rgb = [0x45 / 255, 0xe0 / 255, 0xd4 / 255];
const ORBIT2: Rgb = [0x3b / 255, 0x82 / 255, 0xf6 / 255];
const NEON: Rgb = [0x45 / 255, 0xe0 / 255, 0xd4 / 255];
const PINK: Rgb = [0xf4 / 255, 0x72 / 255, 0xb6 / 255];
const VIOLET: Rgb = [0x8b / 255, 0x5c / 255, 0xf6 / 255];
const SKY: Rgb = [0x35 / 255, 0xe0 / 255, 0xff / 255];
const SKY2: Rgb = [0x8b / 255, 0x5c / 255, 0xf6 / 255];
const POLAROID: Rgb = [0.98, 0.98, 0.96];
const GREEN: Rgb = [0x34 / 255, 0xd3 / 255, 0x99 / 255];
const GREEN2: Rgb = [0x22 / 255, 0xd3 / 255, 0xee / 255];
const ARCH1: Rgb = [0xf6 / 255, 0xd3 / 255, 0x65 / 255];
const ARCH2: Rgb = [0xfd / 255, 0xa0 / 255, 0x85 / 255];

function r(v: number): readonly [number, number, number, number] {
  return [v, v, v, v];
}

export const MONITOR_FRAME_PRESETS: readonly FramePreset[] = [
  { id: 'circle-thin', prop: 1, radii: r(0.5), thickness: 0.014, color: W, style: 1 },
  { id: 'circle-halo', prop: 1, radii: r(0.5), thickness: 0.022, color: TEAL, style: 2 },
  { id: 'rounded-soft', prop: 1, radii: r(0.16), thickness: 0.013, color: W, style: 1 },
  { id: 'rounded-glass', prop: 1, radii: r(0.22), thickness: 0.018, color: GLASS, style: 2 },
  { id: 'portrait-tall', prop: 0.75, radii: r(0.12), thickness: 0.013, color: W, style: 1 },
  { id: 'portrait-ribbon', prop: 0.5625, radii: r(0.14), thickness: 0.021, color: GOLD, style: 2 },
  { id: 'landscape-soft', prop: 16 / 9, radii: r(0.1), thickness: 0.013, color: W, style: 1 },
  {
    id: 'landscape-neon',
    prop: 16 / 9,
    radii: r(0.12),
    thickness: 0.014,
    color: SKY,
    color2: SKY2,
    style: 4,
    margin: 0.045,
  },
  {
    id: 'circle-aurora',
    prop: 1,
    radii: r(0.5),
    thickness: 0.03,
    color: VIOLET,
    color2: AURORA2,
    style: 1,
  },
  {
    id: 'circle-sunset',
    prop: 1,
    radii: r(0.5),
    thickness: 0.026,
    color: SUN1,
    color2: SUN2,
    style: 2,
  },
  {
    id: 'circle-orbit',
    prop: 1,
    radii: r(0.5),
    thickness: 0.018,
    color: ORBIT1,
    color2: ORBIT2,
    style: 3,
  },
  { id: 'circle-neon', prop: 1, radii: r(0.5), thickness: 0.012, color: NEON, style: 4, margin: 0.05 },
  {
    id: 'rounded-floating',
    prop: 1,
    radii: r(0.18),
    thickness: 0.006,
    color: W,
    style: 5,
    margin: 0.06,
  },
  {
    id: 'hexagon',
    prop: 1.1547005,
    radii: r(0.09),
    thickness: 0.016,
    color: W,
    style: 2,
    hexagon: true,
  },
  {
    id: 'arch',
    prop: 0.75,
    radii: [0.5, 0.5, 0.08, 0.08],
    thickness: 0.016,
    color: ARCH1,
    color2: ARCH2,
    style: 1,
  },
  {
    id: 'leaf',
    prop: 1,
    radii: [0.5, 0.12, 0.5, 0.12],
    thickness: 0.02,
    color: GREEN,
    color2: GREEN2,
    style: 1,
  },
  {
    id: 'balloon',
    prop: 1,
    radii: [0.5, 0.5, 0.5, 0.07],
    thickness: 0.016,
    color: W,
    style: 2,
  },
  {
    id: 'polaroid',
    prop: 0.86,
    radii: r(0.025),
    thickness: 0.035,
    color: POLAROID,
    style: 6,
    margin: 0.05,
  },
  {
    id: 'capsule',
    prop: 0.5625,
    radii: r(0.5),
    thickness: 0.02,
    color: PINK,
    color2: VIOLET,
    style: 1,
  },
];

export function monitorFramePreset(id: MonitorFramePreset): FramePreset {
  const preset = MONITOR_FRAME_PRESETS.find((item) => item.id === id);
  if (!preset) throw new Error(`preset de marco desconocido: ${id}`);
  return preset;
}

export function hexToRgb(hex: string): Rgb | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const value = match[1]!;
  return [
    parseInt(value.slice(0, 2), 16) / 255,
    parseInt(value.slice(2, 4), 16) / 255,
    parseInt(value.slice(4, 6), 16) / 255,
  ];
}

export function rgbToHex(color: Rgb): string {
  return (
    '#' +
    color
      .map((value) =>
        Math.max(0, Math.min(255, Math.round(value * 255)))
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}

export interface FrameColors {
  readonly color: string;
  readonly color2: string;
  readonly gradient: boolean;
}

export function frameColors(preset: FramePreset, frame?: MonitorFrame): FrameColors {
  const color = (frame?.color ? hexToRgb(frame.color) : null) ?? preset.color;
  const color2 = preset.color2
    ? ((frame?.color2 ? hexToRgb(frame.color2) : null) ?? preset.color2)
    : color;
  return {
    color: rgbToHex(color),
    color2: rgbToHex(color2),
    gradient: rgbToHex(color) !== rgbToHex(color2),
  };
}

export interface FrameBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Caja del marco en px dentro del content-box (origen relativa al content
 * box). Réplica del `caixaCheia`/`numerosDe` de AlaukCut: la caja tiene el
 * aspecto `prop` del preset, centrada, con `margin` descontado de la
 * extensión.
 */
export function frameBox(preset: FramePreset, content: ContentBox): FrameBox {
  const clipAspect = content.width / Math.max(1e-6, content.height);
  let halfU = 0.5;
  let halfV = 0.5;
  if (preset.prop <= clipAspect) {
    halfU = 0.5 * (preset.prop / clipAspect);
  } else {
    halfV = 0.5 * (clipAspect / preset.prop);
  }
  const minor = Math.min(content.width, content.height);
  const bx0 = halfU * (content.width / minor);
  const by0 = halfV * (content.height / minor);
  const reach = (preset.margin ?? 0) * 2 * Math.min(bx0, by0);
  const bx = Math.max(0.01, bx0 - reach);
  const by = Math.max(0.01, by0 - reach);
  const halfW = bx * minor;
  const halfH = by * minor;
  return {
    x: content.x + content.width / 2 - halfW,
    y: content.y + content.height / 2 - halfH,
    width: halfW * 2,
    height: halfH * 2,
  };
}

export interface FrameShape {
  /** Path SVG en coords del content-box (px). */
  readonly path: string;
  /** Ancho del trazo en px. */
  readonly strokeWidth: number;
}

const n = (value: number): number => Math.round(value * 100) / 100;

/** Path del marco: rect con radios por esquina o hexágono regular. */
export function frameShape(preset: FramePreset, box: FrameBox): FrameShape {
  const side = 2 * Math.min(box.width, box.height) / 2; // lado menor de la caja
  const radii = preset.hexagon
    ? [0, 0, 0, 0]
    : preset.radii.map((value) => Math.min(0.5, Math.max(0, value)) * side);
  const [tl, tr, br, bl] = radii as [number, number, number, number];
  const x0 = n(box.x);
  const y0 = n(box.y);
  const x1 = n(box.x + box.width);
  const y1 = n(box.y + box.height);

  let path: string;
  if (preset.hexagon) {
    const q = (x1 - x0) / 4;
    const cy = (y0 + y1) / 2;
    path =
      `M${n(x0 + q)} ${y0}L${n(x1 - q)} ${y0}L${x1} ${n(cy)}` +
      `L${n(x1 - q)} ${y1}L${n(x0 + q)} ${y1}L${x0} ${n(cy)}Z`;
  } else {
    path =
      `M${n(x0 + tl)} ${y0}H${n(x1 - tr)}A${n(tr)} ${n(tr)} 0 0 1 ${x1} ${n(y0 + tr)}` +
      `V${n(y1 - br)}A${n(br)} ${n(br)} 0 0 1 ${n(x1 - br)} ${y1}` +
      `H${n(x0 + bl)}A${n(bl)} ${n(bl)} 0 0 1 ${x0} ${n(y1 - bl)}` +
      `V${n(y0 + tl)}A${n(tl)} ${n(tl)} 0 0 1 ${n(x0 + tl)} ${y0}Z`;
  }
  const strokeWidth = Math.max(0.5, preset.thickness * side);
  return { path, strokeWidth };
}
