import { z } from 'zod';

export const MOTION_ANIMATIONS = [
  'none',
  'fade',
  'slide-up',
  'slide-left',
  'pop',
  'write',
  'wipe',
  'back',
] as const;
export type MotionAnimationKind = (typeof MOTION_ANIMATIONS)[number];

export interface MotionAnimation {
  readonly kind: MotionAnimationKind;
  readonly inFrames?: number;
  readonly outFrames?: number;
  /** Distancia normalizada 0..1 para slide-up/slide-left. */
  readonly distance?: number;
}

export interface MotionTextLayer {
  readonly kind: 'text';
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly text: string;
  readonly fontFamily: string;
  readonly fontSizePx: number;
  readonly weight: number;
  readonly color: string;
  readonly align: 'left' | 'center' | 'right';
  readonly animation: MotionAnimation;
  /** Sombra paralela (paridad `sombra` de faixas.js): offset en px del plano
   * de 1080 de alto; el ASS la emite como `\4c`+`\shad`, el preview como
   * `text-shadow`. `angleDeg` gira el desplazamiento (90 = abajo) y
   * `opacity` fija el alfa (0–1). `blurPx` suaviza los bordes de la
   * sombra (`\be` en ASS / radio de blur en el preview). */
  readonly shadow?: {
    readonly color: string;
    readonly offsetPx: number;
    readonly angleDeg?: number;
    readonly opacity?: number;
    readonly blurPx?: number;
  };
  /** Oblicuidad (paridad del skew .25 de `faixas.js`): `skewXDeg` emite
   * `\fax` en ASS y `skewX()` en el preview; `skewYDeg` el `\fay`/`skewY`.
   * Grados, típicamente −30..30. */
  readonly skewXDeg?: number;
  readonly skewYDeg?: number;
}

/** Punto normalizado 0..1 dentro de la caja de la capa (origen arriba-izquierda). */
export interface MotionPoint {
  readonly x: number;
  readonly y: number;
}

export interface MotionRectLayer {
  readonly kind: 'rect';
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly color: string;
  readonly opacity: number;
  /** Formas no rectangulares del titler (polígono ASS / clip-path CSS).
   * `custom` usa `points` (3..16 vértices libres dentro de la caja). */
  readonly shape?:
    | 'rect'
    | 'ellipse'
    | 'triangle'
    | 'diamond'
    | 'star'
    | 'pentagon'
    | 'hexagon'
    | 'arrow'
    | 'line'
    | 'parallelogram'
    | 'trapezoid'
    | 'heart'
    | 'hand'
    | 'custom';
  /** Vértices del polígono para `shape: 'custom'`; ignorados con otras formas. */
  readonly points?: readonly MotionPoint[];
  /** Trazo del borde (paridad `traco` de `formas.js` de AlaukCut): color y
   * grosor como fracción del lado menor de la capa. Sin `strokeWidth` o con
   * 0 no hay trazo. */
  readonly strokeColor?: string;
  readonly strokeWidth?: number;
  readonly strokeOpacity?: number;
  /** Sombra paralela (`sombra` de `formas.js`): offset en px del plano de
   * 1080; `angleDeg` gira el desplazamiento (0 = hacia abajo, como el
   * default), `opacity` fija el alfa de la sombra (0–1) y `blurPx`
   * suaviza los bordes (`\be` en ASS). */
  readonly shadow?: {
    readonly color: string;
    readonly offsetPx: number;
    readonly angleDeg?: number;
    readonly opacity?: number;
    readonly blurPx?: number;
  };
  readonly animation: MotionAnimation;
}

/**
 * Trazo animado alrededor de la caja de la capa (paridad `contorno.js` de
 * AlaukCut): rectángulo redondeado con borde que se dibuja solo durante
 * `drawSeconds` con easing coseno. `thickness` es fracción del lado menor
 * de la capa; `radius` fracción 0..0.5 del lado menor.
 */
export interface MotionStrokeLayer {
  readonly kind: 'stroke';
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly color: string;
  readonly opacity: number;
  readonly thickness: number;
  readonly radius: number;
  readonly drawSeconds: number;
  readonly animation: MotionAnimation;
}

export type MotionLayer = MotionTextLayer | MotionRectLayer | MotionStrokeLayer;

export interface MotionPlan {
  readonly version: 1;
  readonly width: number;
  readonly height: number;
  readonly fps: { readonly num: number; readonly den: number };
  readonly durationFrames: number;
  readonly layers: readonly MotionLayer[];
}

export interface MotionContext {
  readonly width: number;
  readonly height: number;
  readonly fpsNum: number;
  readonly fpsDen: number;
  readonly durationFrames: number;
}

export interface MotionField {
  readonly id: string;
  readonly label: string;
  readonly kind: 'text' | 'textarea' | 'color' | 'select' | 'number' | 'polygon';
  readonly options?: readonly { readonly value: string; readonly label: string }[];
  readonly min?: number;
  readonly max?: number;
  /** Si está, el campo queda deshabilitado salvo que `props[key] === value`. */
  readonly requires?: { readonly key: string; readonly value: string };
}

export interface MotionTemplate {
  readonly id: string;
  readonly version: string;
  readonly label: string;
  readonly description: string;
  readonly category: 'título' | 'identidad' | 'cierre' | 'dato' | 'fondo';
  readonly defaults: Readonly<Record<string, unknown>>;
  readonly fields: readonly MotionField[];
  readonly propsSchema: z.ZodTypeAny;
  buildLayers(props: Record<string, unknown>, context: MotionContext): MotionLayer[];
}

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'usá un color #rrggbb');
const animationSchema = z.enum(MOTION_ANIMATIONS);
const line = (max: number) => z.string().trim().max(max);
const fontFamily = 'Segoe UI';

const ANIMATION_OPTIONS = [
  { value: 'none', label: 'Sin animación' },
  { value: 'fade', label: 'Aparecer' },
  { value: 'slide-up', label: 'Subir' },
  { value: 'slide-left', label: 'Deslizar' },
  { value: 'pop', label: 'Pop' },
  { value: 'write', label: 'Escribir' },
  { value: 'wipe', label: 'Barrido' },
  { value: 'back', label: 'Con rebote' },
] as const;

const ALIGN_OPTIONS = [
  { value: 'left', label: 'Izquierda' },
  { value: 'center', label: 'Centro' },
] as const;

const SIDE_OPTIONS = [
  { value: 'left', label: 'Izquierda' },
  { value: 'right', label: 'Derecha' },
] as const;

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

function wrapText(value: string, maxChars: number, maxLines = 6): string[] {
  const normalized = value.replace(/\r\n?/g, '\n').trim().slice(0, 500);
  if (!normalized) return [];
  const lines: string[] = [];
  for (const paragraph of normalized.split('\n')) {
    let current = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      let candidate = current ? `${current} ${word}` : word;
      while (candidate.length > maxChars) {
        if (current) {
          lines.push(current);
          current = '';
          candidate = word;
        } else {
          lines.push(candidate.slice(0, maxChars));
          candidate = candidate.slice(maxChars);
        }
        if (lines.length >= maxLines) break;
      }
      if (lines.length >= maxLines) break;
      current = candidate;
    }
    if (lines.length >= maxLines) break;
    if (current) lines.push(current);
  }
  const limited = lines.slice(0, maxLines);
  if (limited.length === maxLines && lines.length > maxLines) {
    limited[maxLines - 1] = `${limited[maxLines - 1]!.slice(0, Math.max(1, maxChars - 1))}…`;
  }
  return limited;
}

function animation(
  kind: MotionAnimationKind,
  fps: number,
  distance = 0.05,
): MotionAnimation {
  if (kind === 'none') return { kind };
  // «Escribir» necesita más aire que una entrada normal: el texto se
  // revela a lo largo de ~1.5 s en vez de aparecer en 0.4 s.
  const base =
    kind === 'write'
      ? Math.max(8, Math.round(fps * 1.5))
      : Math.max(4, Math.round(fps * 0.4));
  return {
    kind,
    inFrames: base,
    outFrames: Math.max(3, Math.round(fps * 0.3)),
    ...(kind === 'slide-up' || kind === 'slide-left' ? { distance } : {}),
  };
}

function textBlock(
  context: MotionContext,
  input: {
    readonly lines: readonly string[];
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly fontSizePx: number;
    readonly weight?: number;
    readonly color: string;
    readonly align: MotionTextLayer['align'];
    readonly anim: MotionAnimation;
    readonly lineHeight?: number;
  },
): MotionTextLayer[] {
  const lineHeight = (input.fontSizePx * (input.lineHeight ?? 1.25)) / context.height;
  return input.lines.map((text, index) => ({
    kind: 'text',
    x: clamp(input.x),
    y: clamp(input.y + index * lineHeight),
    width: clamp(input.width),
    height: clamp(lineHeight),
    text,
    fontFamily,
    fontSizePx: input.fontSizePx,
    weight: input.weight ?? 500,
    color: input.color,
    align: input.align,
    animation: input.anim,
  }));
}

function rect(
  x: number,
  y: number,
  width: number,
  height: number,
  color: string,
  opacity: number,
  anim: MotionAnimation,
  shape?: MotionRectLayer['shape'],
  points?: readonly MotionPoint[],
  stroke?: { color: string; width: number },
  shadow?: {
    color: string;
    offsetPx: number;
    angleDeg?: number;
    opacity?: number;
  },
): MotionRectLayer {
  return {
    kind: 'rect',
    x: clamp(x),
    y: clamp(y),
    width: clamp(width),
    height: clamp(height),
    color,
    opacity: clamp(opacity),
    ...(shape ? { shape } : {}),
    ...(points && points.length >= 2 ? { points } : {}),
    ...(stroke && stroke.width > 0
      ? { strokeColor: stroke.color, strokeWidth: clamp(stroke.width) }
      : {}),
    ...(shadow && shadow.offsetPx > 0 ? { shadow } : {}),
    animation: anim,
  };
}

function charsFor(widthPx: number, fontSizePx: number): number {
  return Math.max(8, Math.floor(widthPx / Math.max(1, fontSizePx * 0.55)));
}

const titleSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    subtitle: line(100).default(''),
    background: hexColor,
    accent: hexColor,
    align: z.enum(['left', 'center']).default('left'),
    animation: animationSchema.default('slide-up'),
  })
  .strict();
type TitleProps = z.infer<typeof titleSchema>;

export const titleCardTemplate: MotionTemplate = {
  id: 'title-card',
  version: '1.0.0',
  label: 'Título de apertura',
  description: 'Cartela principal con fondo, acento y subtítulo.',
  category: 'título',
  defaults: {
    title: 'Tu próxima historia',
    subtitle: 'Olyvia',
    background: '#0f172a',
    accent: '#7dd3c0',
    align: 'left',
    animation: 'slide-up',
  },
  fields: [
    { id: 'title', label: 'Título', kind: 'text' },
    { id: 'subtitle', label: 'Subtítulo', kind: 'text' },
    { id: 'background', label: 'Fondo', kind: 'color' },
    { id: 'accent', label: 'Acento', kind: 'color' },
    { id: 'align', label: 'Alineación', kind: 'select', options: ALIGN_OPTIONS },
    { id: 'animation', label: 'Animación', kind: 'select', options: ANIMATION_OPTIONS },
  ],
  propsSchema: titleSchema,
  buildLayers(raw, context) {
    const props = raw as TitleProps;
    const unit = context.height / 1080;
    const fps = context.fpsNum / Math.max(1, context.fpsDen);
    const titleSize = 92 * unit;
    const titleLines = wrapText(props.title, charsFor(context.width * 0.84, titleSize));
    const subtitleLines = wrapText(props.subtitle, charsFor(context.width * 0.84, 38 * unit), 2);
    const anim = animation(props.animation, fps, 0.05);
    const x = 0.08;
    const width = 0.84;
    const titleY = 0.44;
    const titleLayers = textBlock(context, {
      lines: titleLines,
      x,
      y: titleY,
      width,
      fontSizePx: titleSize,
      weight: 700,
      color: '#ffffff',
      align: props.align,
      anim,
    });
    const subtitleY = titleY + titleLines.length * ((titleSize * 1.25) / context.height) + 0.015;
    return [
      rect(0, 0, 1, 1, props.background, 0.94, anim),
      rect(0.08, 0.4, 0.12, 0.008, props.accent, 1, anim),
      ...titleLayers,
      ...textBlock(context, {
        lines: subtitleLines,
        x,
        y: subtitleY,
        width,
        fontSizePx: 38 * unit,
        weight: 500,
        color: '#cbd5e1',
        align: props.align,
        anim,
      }),
    ].slice(0, 16);
  },
};

const lowerThirdSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    role: line(80).default(''),
    accent: hexColor,
    side: z.enum(['left', 'right']).default('left'),
    animation: animationSchema.default('slide-left'),
  })
  .strict();
type LowerThirdProps = z.infer<typeof lowerThirdSchema>;

export const lowerThirdTemplate: MotionTemplate = {
  id: 'lower-third',
  version: '1.0.0',
  label: 'Lower third',
  description: 'Placa de nombre y rol sobre el video.',
  category: 'identidad',
  defaults: {
    name: 'Nombre Apellido',
    role: 'Rol o especialidad',
    accent: '#7dd3c0',
    side: 'left',
    animation: 'slide-left',
  },
  fields: [
    { id: 'name', label: 'Nombre', kind: 'text' },
    { id: 'role', label: 'Rol', kind: 'text' },
    { id: 'accent', label: 'Acento', kind: 'color' },
    { id: 'side', label: 'Lado', kind: 'select', options: SIDE_OPTIONS },
    { id: 'animation', label: 'Animación', kind: 'select', options: ANIMATION_OPTIONS },
  ],
  propsSchema: lowerThirdSchema,
  buildLayers(raw, context) {
    const props = raw as LowerThirdProps;
    const unit = context.height / 1080;
    const fps = context.fpsNum / Math.max(1, context.fpsDen);
    const anim = animation(props.animation, fps, 0.045);
    const place = (x: number, width: number): number =>
      props.side === 'right' ? 1 - x - width : x;
    const nameSize = 56 * unit;
    const nameWidth = 0.52;
    const nameLines = wrapText(
      props.name,
      charsFor(context.width * nameWidth, nameSize),
      2,
    );
    const roleLines = props.role
      ? wrapText(props.role, charsFor(context.width * nameWidth, 28 * unit), 1)
      : [];
    const nameLayers = textBlock(context, {
      lines: nameLines,
      x: place(0.1, nameWidth),
      y: 0.69,
      width: nameWidth,
      fontSizePx: nameSize,
      weight: 700,
      color: '#ffffff',
      align: 'left',
      anim,
    });
    const roleY = 0.69 + nameLines.length * ((nameSize * 1.25) / context.height) + 0.012;
    const roleLayers = textBlock(context, {
      lines: roleLines,
      x: place(0.1, nameWidth),
      y: roleY,
      width: nameWidth,
      fontSizePx: 28 * unit,
      weight: 500,
      color: '#cbd5e1',
      align: 'left',
      anim,
    });
    return [
      rect(place(0.06, 0.6), 0.66, 0.6, 0.2, '#0f172a', 0.9, anim),
      rect(place(0.06, 0.012), 0.66, 0.012, 0.2, props.accent, 1, anim),
      ...nameLayers,
      ...roleLayers,
    ].slice(0, 16);
  },
};

/**
 * Letreiro de banda oblicua (paridad del letreiro de `faixas.js` de
 * AlaukCut): paralelogramo que atraviesa la zona inferior con nombre y
 * rol dentro. El texto toma #101318 sobre bandas claras y #ffffff sobre
 * oscuras, igual que `luz()`/`sobre()` del original.
 */
const FAIXA_ICONS = ['none', 'check', 'person', 'thumb', 'star'] as const;

/** Polígono de «persona» (silueta de busto) en coords 0..1 de la caja —
 * paridad del ícono `pessoa` de `faixas.js` de AlaukCut. */
const PERSON_ICON_POINTS: readonly MotionPoint[] = [
  { x: 0.5, y: 0.06 },
  { x: 0.63, y: 0.06 },
  { x: 0.7, y: 0.2 },
  { x: 0.75, y: 0.2 },
  { x: 0.75, y: 0.32 },
  { x: 0.82, y: 0.4 },
  { x: 0.96, y: 0.45 },
  { x: 0.96, y: 0.95 },
  { x: 0.04, y: 0.95 },
  { x: 0.04, y: 0.45 },
  { x: 0.18, y: 0.4 },
  { x: 0.25, y: 0.32 },
  { x: 0.25, y: 0.2 },
  { x: 0.3, y: 0.2 },
  { x: 0.37, y: 0.06 },
];

/** Polígono de «pulgar arriba» (joinha) en coords 0..1 — paridad del
 * ícono `joinha` de `faixas.js`. */
const THUMB_ICON_POINTS: readonly MotionPoint[] = [
  { x: 0.3, y: 0.12 },
  { x: 0.45, y: 0.05 },
  { x: 0.58, y: 0.14 },
  { x: 0.6, y: 0.3 },
  { x: 0.78, y: 0.34 },
  { x: 0.85, y: 0.52 },
  { x: 0.74, y: 0.7 },
  { x: 0.58, y: 0.75 },
  { x: 0.46, y: 0.66 },
  { x: 0.4, y: 0.5 },
  { x: 0.33, y: 0.35 },
  { x: 0.28, y: 0.22 },
];

/** Check de «certo»: polilínea abierta con trazo (shape `line`). */
const CHECK_ICON_POINTS: readonly MotionPoint[] = [
  { x: 0.15, y: 0.52 },
  { x: 0.4, y: 0.78 },
  { x: 0.85, y: 0.22 },
];

const faixaLetreiroSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    role: line(80).default(''),
    bandColor: hexColor,
    slant: z.number().min(0).max(0.25).default(0.1),
    side: z.enum(['left', 'right']).default('left'),
    icon: z.enum(FAIXA_ICONS).default('none'),
    animation: animationSchema.default('slide-left'),
  })
  .strict();
type FaixaLetreiroProps = z.infer<typeof faixaLetreiroSchema>;

function bandLuminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return (
    (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255
  );
}

function hexToRgb(hex: string): readonly [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Mezcla lineal de dos #rrggbb; t=0 → a, t=1 → b. */
function mixHex(a: string, b: string, t: number): string {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  const k = clamp(t);
  const c = ca.map((v, i) => Math.round(v + (cb[i]! - v) * k));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

export const faixaLetreiroTemplate: MotionTemplate = {
  id: 'faixa-letreiro',
  version: '1.0.0',
  label: 'Letreiro (banda oblicua)',
  description: 'Banda inferior inclinada con nombre y rol, estilo letreiro.',
  category: 'identidad',
  defaults: {
    name: 'Nombre Apellido',
    role: 'Rol o especialidad',
    bandColor: '#1f2937',
    slant: 0.1,
    side: 'left',
    icon: 'none',
    animation: 'slide-left',
  },
  fields: [
    { id: 'name', label: 'Nombre', kind: 'text' },
    { id: 'role', label: 'Rol', kind: 'text' },
    { id: 'bandColor', label: 'Color de banda', kind: 'color' },
    { id: 'slant', label: 'Inclinación', kind: 'number', min: 0, max: 0.25 },
    { id: 'side', label: 'Lado', kind: 'select', options: SIDE_OPTIONS },
    {
      id: 'icon',
      label: 'Ícono',
      kind: 'select',
      options: [
        { value: 'none', label: 'Ninguno' },
        { value: 'check', label: 'Cierto ✓' },
        { value: 'person', label: 'Persona' },
        { value: 'thumb', label: 'Pulgar' },
        { value: 'star', label: 'Estrella' },
      ],
    },
    { id: 'animation', label: 'Animación', kind: 'select', options: ANIMATION_OPTIONS },
  ],
  propsSchema: faixaLetreiroSchema,
  buildLayers(raw, context) {
    const props = raw as FaixaLetreiroProps;
    const unit = context.height / 1080;
    const anim = animation(props.animation, context.fpsNum / Math.max(1, context.fpsDen), 0.06);
    const bandW = 0.62;
    const bandH = 0.17;
    const bandX = props.side === 'right' ? 1 - 0.06 - bandW : 0.06;
    const bandY = 0.7;
    const slant = clamp(props.slant, 0, 0.25);
    // Paralelogramo inscripto en la caja de la banda: el borde superior
    // va corrido `slant` hacia la derecha (mismo shear que `incl()` de
    // faixas.js, que desplaza el borde de arriba `inc` px).
    const band = rect(
      bandX,
      bandY,
      bandW,
      bandH,
      props.bandColor,
      0.96,
      anim,
      'custom',
      [
        { x: slant, y: 0 },
        { x: 1, y: 0 },
        { x: 1 - slant, y: 1 },
        { x: 0, y: 1 },
      ],
    );
    const ink = bandLuminance(props.bandColor) > 0.6 ? '#101318' : '#ffffff';
    // Ícono junto al nombre (paridad de los íconos joinha/pessoa/certo de
    // `faixas.js`): caja cuadrada centrada en la banda, a la izquierda del
    // texto en `side:'left'` y a la derecha en `side:'right'`. El inset
    // lateral descuenta la mitad del slant para no salirse del paralelogramo.
    const hasIcon = props.icon !== 'none';
    const iconH = 0.085;
    const iconW = (iconH * context.height) / Math.max(1, context.width);
    const iconGap = 0.03;
    const sideInset = slant * bandW * 0.5 + 0.028;
    const iconX =
      props.side === 'right'
        ? bandX + bandW - sideInset - iconW
        : bandX + sideInset;
    const iconY = bandY + (bandH - iconH) / 2;
    const textShift = hasIcon ? iconW + iconGap : 0;
    const iconLayers: MotionLayer[] = hasIcon
      ? [
          props.icon === 'check'
            ? rect(iconX, iconY, iconW, iconH, ink, 1, anim, 'line', CHECK_ICON_POINTS, {
                color: ink,
                width: 0.16,
              })
            : props.icon === 'person'
              ? rect(iconX, iconY, iconW, iconH, ink, 1, anim, 'custom', PERSON_ICON_POINTS)
              : props.icon === 'thumb'
                ? rect(iconX, iconY, iconW, iconH, ink, 1, anim, 'custom', THUMB_ICON_POINTS)
                : rect(iconX, iconY, iconW, iconH, ink, 1, anim, 'star'),
        ]
      : [];
    const nameSize = 58 * unit;
    const roleSize = 30 * unit;
    const nameWidth = bandW - 0.07 - textShift;
    const placeX =
      props.side === 'right'
        ? bandX + bandW - nameWidth - 0.035 - textShift
        : bandX + 0.035 + slant * bandW * 0.5 + textShift;
    const nameLines = wrapText(props.name, charsFor(context.width * nameWidth, nameSize), 1);
    const roleLines = props.role
      ? wrapText(props.role, charsFor(context.width * nameWidth, roleSize), 1)
      : [];
    const blockH =
      nameLines.length * (nameSize * 1.22) / context.height +
      roleLines.length * (roleSize * 1.22) / context.height +
      0.008;
    const topY = bandY + (bandH - blockH) / 2;
    const nameLayers = textBlock(context, {
      lines: nameLines,
      x: placeX,
      y: topY,
      width: nameWidth,
      fontSizePx: nameSize,
      weight: 800,
      color: ink,
      align: 'left',
      anim,
    });
    const roleY =
      topY +
      nameLines.length * ((nameSize * 1.22) / context.height) +
      0.006;
    const roleLayers = textBlock(context, {
      lines: roleLines,
      x: placeX,
      y: roleY,
      width: nameWidth,
      fontSizePx: roleSize,
      weight: 500,
      color: ink,
      align: 'left',
      anim,
    });
    return [band, ...iconLayers, ...nameLayers, ...roleLayers].slice(0, 16);
  },
};

const endCardSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    cta: line(100).default(''),
    background: hexColor,
    accent: hexColor,
    animation: animationSchema.default('fade'),
  })
  .strict();
type EndCardProps = z.infer<typeof endCardSchema>;

export const endCardTemplate: MotionTemplate = {
  id: 'end-card',
  version: '1.0.0',
  label: 'Cierre / end card',
  description: 'Cierre a pantalla completa con llamado a la acción.',
  category: 'cierre',
  defaults: {
    title: 'Gracias por ver',
    cta: 'Suscribite para más',
    background: '#0f172a',
    accent: '#7dd3c0',
    animation: 'fade',
  },
  fields: [
    { id: 'title', label: 'Título', kind: 'text' },
    { id: 'cta', label: 'Llamado a la acción', kind: 'text' },
    { id: 'background', label: 'Fondo', kind: 'color' },
    { id: 'accent', label: 'Acento', kind: 'color' },
    { id: 'animation', label: 'Animación', kind: 'select', options: ANIMATION_OPTIONS },
  ],
  propsSchema: endCardSchema,
  buildLayers(raw, context) {
    const props = raw as EndCardProps;
    const unit = context.height / 1080;
    const fps = context.fpsNum / Math.max(1, context.fpsDen);
    const anim = animation(props.animation, fps, 0.04);
    const titleSize = 84 * unit;
    const titleLines = wrapText(props.title, charsFor(context.width * 0.76, titleSize), 3);
    const ctaLines = wrapText(props.cta, charsFor(context.width * 0.76, 36 * unit), 2);
    return [
      rect(0, 0, 1, 1, props.background, 0.96, anim),
      rect(0.12, 0.33, 0.12, 0.008, props.accent, 1, anim),
      ...textBlock(context, {
        lines: titleLines,
        x: 0.12,
        y: 0.38,
        width: 0.76,
        fontSizePx: titleSize,
        weight: 700,
        color: '#ffffff',
        align: 'center',
        anim,
      }),
      ...textBlock(context, {
        lines: ctaLines,
        x: 0.12,
        y: 0.64,
        width: 0.76,
        fontSizePx: 36 * unit,
        weight: 500,
        color: props.accent,
        align: 'center',
        anim,
      }),
    ].slice(0, 16);
  },
};

const statSchema = z
  .object({
    value: z.string().trim().min(1).max(20),
    label: z.string().trim().min(1).max(60),
    accent: hexColor,
    animation: animationSchema.default('pop'),
  })
  .strict();
type StatProps = z.infer<typeof statSchema>;

export const statCalloutTemplate: MotionTemplate = {
  id: 'stat-callout',
  version: '1.0.0',
  label: 'Dato destacado',
  description: 'Número o métrica con etiqueta y acento.',
  category: 'dato',
  defaults: {
    value: '+120%',
    label: 'más retención',
    accent: '#7dd3c0',
    animation: 'pop',
  },
  fields: [
    { id: 'value', label: 'Valor', kind: 'text' },
    { id: 'label', label: 'Etiqueta', kind: 'text' },
    { id: 'accent', label: 'Acento', kind: 'color' },
    { id: 'animation', label: 'Animación', kind: 'select', options: ANIMATION_OPTIONS },
  ],
  propsSchema: statSchema,
  buildLayers(raw, context) {
    const props = raw as StatProps;
    const unit = context.height / 1080;
    const fps = context.fpsNum / Math.max(1, context.fpsDen);
    const anim = animation(props.animation, fps, 0.04);
    const valueSize = 110 * unit;
    const labelSize = 30 * unit;
    return [
      rect(0.08, 0.28, 0.44, 0.4, '#0f172a', 0.88, anim),
      rect(0.08, 0.28, 0.008, 0.4, props.accent, 1, anim),
      ...textBlock(context, {
        lines: wrapText(props.value, 12, 1),
        x: 0.12,
        y: 0.33,
        width: 0.36,
        fontSizePx: valueSize,
        weight: 700,
        color: props.accent,
        align: 'left',
        anim,
      }),
      ...textBlock(context, {
        lines: wrapText(props.label, 28, 2),
        x: 0.12,
        y: 0.62,
        width: 0.36,
        fontSizePx: labelSize,
        weight: 500,
        color: '#e2e8f0',
        align: 'left',
        anim,
      }),
    ].slice(0, 16);
  },
};

const freeTextSchema = z
  .object({
    text: z.string().trim().min(1).max(500),
    x: z.number().gte(0).lte(1),
    y: z.number().gte(0).lte(1),
    width: z.number().gte(0.1).lte(1),
    size: z.number().gte(12).lte(200),
    color: hexColor,
    weight: z.enum(['400', '600', '700']),
    align: z.enum(['left', 'center', 'right']),
    animation: animationSchema,
  })
  .strict();
type FreeTextProps = z.infer<typeof freeTextSchema>;

export const freeTextTemplate: MotionTemplate = {
  id: 'free-text',
  version: '1.0.0',
  label: 'Texto libre',
  description: 'Texto suelto en cualquier posición, con tamaño, color y animación.',
  category: 'título',
  defaults: {
    text: 'Texto libre',
    x: 0.1,
    y: 0.44,
    width: 0.8,
    size: 72,
    color: '#ffffff',
    weight: '700',
    align: 'center',
    animation: 'pop',
  },
  fields: [
    { id: 'text', label: 'Texto', kind: 'textarea' },
    { id: 'x', label: 'X (0–1)', kind: 'number', min: 0, max: 1 },
    { id: 'y', label: 'Y (0–1)', kind: 'number', min: 0, max: 1 },
    { id: 'width', label: 'Ancho (0–1)', kind: 'number', min: 0.1, max: 1 },
    { id: 'size', label: 'Tamaño (px)', kind: 'number', min: 12, max: 200 },
    { id: 'color', label: 'Color', kind: 'color' },
    {
      id: 'weight',
      label: 'Grosor',
      kind: 'select',
      options: [
        { value: '400', label: 'Regular' },
        { value: '600', label: 'Semibold' },
        { value: '700', label: 'Bold' },
      ],
    },
    {
      id: 'align',
      label: 'Alineación',
      kind: 'select',
      options: [
        { value: 'left', label: 'Izquierda' },
        { value: 'center', label: 'Centro' },
        { value: 'right', label: 'Derecha' },
      ],
    },
    { id: 'animation', label: 'Animación', kind: 'select', options: ANIMATION_OPTIONS },
  ],
  propsSchema: freeTextSchema,
  buildLayers(raw, context) {
    const props = raw as FreeTextProps;
    const unit = context.height / 1080;
    const fps = context.fpsNum / Math.max(1, context.fpsDen);
    // El validador ASS acepta 4..400 px; en 4K/vertical el tamaño escala
    // mucho, así que se acota para no abortar el export.
    const size = Math.max(4, Math.min(400, props.size * unit));
    const anim = animation(props.animation, fps, 0.04);
    const lineHeight = (size * 1.25) / context.height;
    const maxLines = Math.max(
      1,
      Math.min(6, Math.floor((1 - props.y) / Math.max(lineHeight, 0.001))),
    );
    const lines = wrapText(
      props.text,
      charsFor(context.width * props.width, size),
      maxLines,
    );
    return textBlock(context, {
      lines,
      x: props.x,
      y: props.y,
      width: props.width,
      fontSizePx: size,
      weight: Number(props.weight),
      color: props.color,
      align: props.align,
      anim,
    }).slice(0, 16);
  },
};

// --- Plantillas pro (paridad CapCut) ---------------------------------------
// Todas usan solo mecanismos ya soportados por el plan y por el validador ASS
// de src-tauri/src/render/motion.rs: capas text/rect, animaciones
// none|fade|slide-up|slide-left|pop, fontSizePx 4..400, weight 100..900,
// unidades 0..1, distance 0..0.5 y hasta 16 capas. Los efectos "pro" se
// logran escalonando inFrames/outFrames por capa y combinando pop (escala)
// con slide (posición); la rotación no existe en el plan y no se inventa un
// tipo nuevo.

/** El validador ASS acepta 4..400 px: se acota para no abortar el export. */
function proFontSize(px: number, unit: number): number {
  return Math.max(4, Math.min(400, px * unit));
}

/** Escala agresiva: entrada de ~0,1 s en vez del 0,4 s estándar. */
function punchAnimation(fps: number): MotionAnimation {
  return {
    kind: 'pop',
    inFrames: Math.max(2, Math.round(fps * 0.1)),
    outFrames: Math.max(2, Math.round(fps * 0.2)),
  };
}

const lowerThirdMinimalSchema = z
  .object({
    title: z.string().trim().min(1).max(80),
    subtitle: line(80).default(''),
    accent: hexColor,
    side: z.enum(['left', 'right']).default('left'),
    animation: animationSchema.default('slide-left'),
  })
  .strict();
type LowerThirdMinimalProps = z.infer<typeof lowerThirdMinimalSchema>;

export const lowerThirdMinimalTemplate: MotionTemplate = {
  id: 'lower-third-minimal',
  version: '1.0.0',
  // La etiqueta evita la frase "lower third": MotionView.test.tsx busca el
  // botón de la placa original por /Lower third/i y una segunda coincidencia
  // en la galería rompería ese test.
  label: 'Placa minimalista',
  description: 'Título y subtítulo con línea de acento y entrada deslizante.',
  category: 'identidad',
  defaults: {
    title: 'Nombre Apellido',
    subtitle: 'Rol o especialidad',
    accent: '#7dd3c0',
    side: 'left',
    animation: 'slide-left',
  },
  fields: [
    { id: 'title', label: 'Título', kind: 'text' },
    { id: 'subtitle', label: 'Subtítulo', kind: 'text' },
    { id: 'accent', label: 'Acento', kind: 'color' },
    { id: 'side', label: 'Lado', kind: 'select', options: SIDE_OPTIONS },
    { id: 'animation', label: 'Animación', kind: 'select', options: ANIMATION_OPTIONS },
  ],
  propsSchema: lowerThirdMinimalSchema,
  buildLayers(raw, context) {
    const props = raw as LowerThirdMinimalProps;
    const unit = context.height / 1080;
    const fps = context.fpsNum / Math.max(1, context.fpsDen);
    const textAnim = animation(props.animation, fps, 0.05);
    // La línea se desliza más que el texto: es el trazo que "dibuja" la placa.
    const lineAnim = animation(props.animation, fps, 0.16);
    const place = (x: number, width: number): number =>
      props.side === 'right' ? 1 - x - width : x;
    const width = 0.55;
    const titleSize = proFontSize(52, unit);
    const titleLines = wrapText(props.title, charsFor(context.width * width, titleSize), 2);
    const subtitleLines = props.subtitle
      ? wrapText(props.subtitle, charsFor(context.width * width, proFontSize(26, unit)), 1)
      : [];
    const titleY = 0.69;
    const subtitleY = titleY + titleLines.length * ((titleSize * 1.25) / context.height) + 0.012;
    return [
      rect(place(0.1, 0.22), 0.664, 0.22, 0.006, props.accent, 1, lineAnim),
      ...textBlock(context, {
        lines: titleLines,
        x: place(0.1, width),
        y: titleY,
        width,
        fontSizePx: titleSize,
        weight: 700,
        color: '#ffffff',
        align: 'left',
        anim: textAnim,
      }),
      ...textBlock(context, {
        lines: subtitleLines,
        x: place(0.1, width),
        y: subtitleY,
        width,
        fontSizePx: proFontSize(26, unit),
        weight: 500,
        color: '#cbd5e1',
        align: 'left',
        anim: textAnim,
      }),
    ].slice(0, 16);
  },
};

const cinemaBarsSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    subtitle: line(100).default(''),
    barHeight: z.number().gte(0.04).lte(0.25).default(0.12),
    accent: hexColor,
    animation: animationSchema.default('fade'),
  })
  .strict();
type CinemaBarsProps = z.infer<typeof cinemaBarsSchema>;

export const cinemaBarsTemplate: MotionTemplate = {
  id: 'cinema-bars',
  version: '1.0.0',
  label: 'Barras de cine',
  description: 'Letterbox con revelado y título centrado entre las barras.',
  category: 'título',
  defaults: {
    title: 'Escena final',
    subtitle: 'Montaje y color',
    barHeight: 0.12,
    accent: '#7dd3c0',
    animation: 'fade',
  },
  fields: [
    { id: 'title', label: 'Título', kind: 'text' },
    { id: 'subtitle', label: 'Subtítulo', kind: 'text' },
    { id: 'barHeight', label: 'Altura de barra (0–1)', kind: 'number', min: 0.04, max: 0.25 },
    { id: 'accent', label: 'Acento', kind: 'color' },
    { id: 'animation', label: 'Animación', kind: 'select', options: ANIMATION_OPTIONS },
  ],
  propsSchema: cinemaBarsSchema,
  buildLayers(raw, context) {
    const props = raw as CinemaBarsProps;
    const unit = context.height / 1080;
    const fps = context.fpsNum / Math.max(1, context.fpsDen);
    const anim = animation(props.animation, fps, 0.05);
    // Las barras siempre se revelan deslizando: es la esencia de la plantilla.
    const barAnim = animation('slide-up', fps, 0.3);
    const barHeight = Math.min(0.22, Math.max(0.06, props.barHeight));
    const titleSize = proFontSize(64, unit);
    const titleLines = wrapText(props.title, charsFor(context.width * 0.8, titleSize), 3);
    const subtitleLines = props.subtitle
      ? wrapText(props.subtitle, charsFor(context.width * 0.8, proFontSize(28, unit)), 2)
      : [];
    const titleY = 0.4;
    const lineY = titleY + titleLines.length * ((titleSize * 1.25) / context.height) + 0.018;
    const subtitleY = lineY + 0.022;
    return [
      rect(0, 0, 1, barHeight, '#000000', 1, barAnim),
      rect(0, 1 - barHeight, 1, barHeight, '#000000', 1, barAnim),
      ...textBlock(context, {
        lines: titleLines,
        x: 0.1,
        y: titleY,
        width: 0.8,
        fontSizePx: titleSize,
        weight: 700,
        color: '#ffffff',
        align: 'center',
        anim,
      }),
      rect(0.44, lineY, 0.12, 0.005, props.accent, 1, anim),
      ...textBlock(context, {
        lines: subtitleLines,
        x: 0.1,
        y: subtitleY,
        width: 0.8,
        fontSizePx: proFontSize(28, unit),
        weight: 500,
        color: props.accent,
        align: 'center',
        anim,
      }),
    ].slice(0, 16);
  },
};

const zoomPunchSchema = z
  .object({
    text: z.string().trim().min(1).max(20),
    accent: hexColor,
    background: hexColor,
    animation: animationSchema.default('pop'),
  })
  .strict();
type ZoomPunchProps = z.infer<typeof zoomPunchSchema>;

export const zoomPunchTemplate: MotionTemplate = {
  id: 'zoom-punch',
  version: '1.0.0',
  label: 'Zoom punch',
  description: 'Palabra gigante con entrada de escala agresiva, estilo redes.',
  category: 'título',
  defaults: {
    text: '¡PUM!',
    accent: '#f97362',
    background: '#0f172a',
    animation: 'pop',
  },
  fields: [
    { id: 'text', label: 'Texto', kind: 'text' },
    { id: 'accent', label: 'Acento', kind: 'color' },
    { id: 'background', label: 'Fondo', kind: 'color' },
    { id: 'animation', label: 'Animación', kind: 'select', options: ANIMATION_OPTIONS },
  ],
  propsSchema: zoomPunchSchema,
  buildLayers(raw, context) {
    const props = raw as ZoomPunchProps;
    const unit = context.height / 1080;
    const fps = context.fpsNum / Math.max(1, context.fpsDen);
    const anim =
      props.animation === 'pop' ? punchAnimation(fps) : animation(props.animation, fps, 0.05);
    const size = proFontSize(150, unit);
    const lines = wrapText(props.text, charsFor(context.width * 0.9, size), 3);
    const lineHeight = (size * 1.25) / context.height;
    const y = Math.max(0.05, 0.5 - (lines.length * lineHeight) / 2);
    const underlineY = Math.min(0.94, y + lines.length * lineHeight + 0.025);
    return [
      rect(0, 0, 1, 1, props.background, 0.94, anim),
      ...textBlock(context, {
        lines,
        x: 0.05,
        y,
        width: 0.9,
        fontSizePx: size,
        weight: 800,
        color: '#ffffff',
        align: 'center',
        anim,
      }),
      rect(0.36, underlineY, 0.28, 0.008, props.accent, 1, anim),
    ].slice(0, 16);
  },
};

const glitchTextSchema = z
  .object({
    text: z.string().trim().min(1).max(40),
    color: hexColor.default('#ffffff'),
    glitchA: hexColor.default('#ff3b5c'),
    glitchB: hexColor.default('#35e0ff'),
  })
  .strict();
type GlitchTextProps = z.infer<typeof glitchTextSchema>;

export const glitchTextTemplate: MotionTemplate = {
  id: 'glitch-text',
  version: '1.0.0',
  label: 'Glitch de texto',
  description: 'Texto con duplicados desplazados que parpadean en secuencia.',
  category: 'título',
  defaults: {
    text: 'SEÑAL PERDIDA',
    color: '#ffffff',
    glitchA: '#ff3b5c',
    glitchB: '#35e0ff',
  },
  fields: [
    { id: 'text', label: 'Texto', kind: 'text' },
    { id: 'color', label: 'Color', kind: 'color' },
    { id: 'glitchA', label: 'Glitch A', kind: 'color' },
    { id: 'glitchB', label: 'Glitch B', kind: 'color' },
  ],
  propsSchema: glitchTextSchema,
  buildLayers(raw, context) {
    const props = raw as GlitchTextProps;
    const unit = context.height / 1080;
    const fps = context.fpsNum / Math.max(1, context.fpsDen);
    const size = proFontSize(88, unit);
    const width = 0.76;
    const x = 0.12;
    const y = 0.44;
    const lines = wrapText(props.text, charsFor(context.width * width, size), 2);
    // Parpadeo alternado: cada copia aparece unos fotogramas más tarde que la
    // anterior, así la opacidad de cada capa entra en momentos distintos.
    const inA = Math.max(2, Math.round(fps * 0.08));
    const inB = inA + Math.max(2, Math.round(fps * 0.12));
    const inMain = inB + Math.max(2, Math.round(fps * 0.12));
    const out = Math.max(3, Math.round(fps * 0.25));
    const copy = (color: string, copyX: number, inFrames: number): MotionTextLayer[] =>
      textBlock(context, {
        lines,
        x: copyX,
        y,
        width,
        fontSizePx: size,
        weight: 700,
        color,
        align: 'center',
        anim: { kind: 'fade', inFrames, outFrames: out },
      });
    // El texto principal va al final para quedar pintado encima de las copias.
    return [
      ...copy(props.glitchA, Math.max(0, x - 0.01), inA),
      ...copy(props.glitchB, Math.min(1 - width, x + 0.01), inB),
      ...copy(props.color, x, inMain),
    ].slice(0, 16);
  },
};

const cinematicTitleSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    subtitle: line(100).default(''),
    background: hexColor.default('#000000'),
    accent: hexColor.default('#d4b483'),
  })
  .strict();
type CinematicTitleProps = z.infer<typeof cinematicTitleSchema>;

export const cinematicTitleTemplate: MotionTemplate = {
  id: 'cinematic-title',
  version: '1.0.0',
  label: 'Título cinematográfico',
  description: 'Título central con fundido lento, escala suave y subtítulo demorado.',
  category: 'título',
  defaults: {
    title: 'CAPÍTULO UNO',
    subtitle: 'La historia empieza',
    background: '#000000',
    accent: '#d4b483',
  },
  fields: [
    { id: 'title', label: 'Título', kind: 'text' },
    { id: 'subtitle', label: 'Subtítulo', kind: 'text' },
    { id: 'background', label: 'Fondo', kind: 'color' },
    { id: 'accent', label: 'Acento', kind: 'color' },
  ],
  propsSchema: cinematicTitleSchema,
  buildLayers(raw, context) {
    const props = raw as CinematicTitleProps;
    const unit = context.height / 1080;
    const fps = context.fpsNum / Math.max(1, context.fpsDen);
    // Coreografía lenta: fondo, línea, título (escala con pop) y subtítulo
    // (posición con slide-up) entran escalonados, cada uno con su propio
    // ritmo de entrada.
    const slow = (seconds: number): number => Math.max(4, Math.round(fps * seconds));
    const bgAnim: MotionAnimation = {
      kind: 'fade',
      inFrames: slow(0.9),
      outFrames: slow(0.4),
    };
    const lineAnim: MotionAnimation = {
      kind: 'slide-left',
      inFrames: slow(0.6),
      outFrames: slow(0.4),
      distance: 0.12,
    };
    const titleAnim: MotionAnimation = {
      kind: 'pop',
      inFrames: slow(1.1),
      outFrames: slow(0.5),
    };
    const subtitleAnim: MotionAnimation = {
      kind: 'slide-up',
      inFrames: slow(1.4),
      outFrames: slow(0.4),
      distance: 0.06,
    };
    const titleSize = proFontSize(76, unit);
    const titleLines = wrapText(props.title, charsFor(context.width * 0.84, titleSize), 4);
    const subtitleLines = props.subtitle
      ? wrapText(props.subtitle, charsFor(context.width * 0.84, proFontSize(30, unit)), 2)
      : [];
    const titleY = 0.41;
    const lineY = titleY + titleLines.length * ((titleSize * 1.25) / context.height) + 0.02;
    const subtitleY = lineY + 0.03;
    return [
      rect(0, 0, 1, 1, props.background, 0.72, bgAnim),
      rect(0.43, lineY, 0.14, 0.006, props.accent, 1, lineAnim),
      ...textBlock(context, {
        lines: titleLines,
        x: 0.08,
        y: titleY,
        width: 0.84,
        fontSizePx: titleSize,
        weight: 700,
        color: '#f8fafc',
        align: 'center',
        anim: titleAnim,
      }),
      ...textBlock(context, {
        lines: subtitleLines,
        x: 0.08,
        y: subtitleY,
        width: 0.84,
        fontSizePx: proFontSize(30, unit),
        weight: 500,
        color: '#cbd5e1',
        align: 'center',
        anim: subtitleAnim,
      }),
    ].slice(0, 16);
  },
};

const badgePointSchema = z
  .object({
    x: z.number().gte(0).lte(1),
    y: z.number().gte(0).lte(1),
  })
  .strict();

/** Vértices por defecto de la forma «Personalizada»: cheurón abierto abajo. */
export const DEFAULT_CUSTOM_POINTS: MotionPoint[] = [
  { x: 0.12, y: 0.2 },
  { x: 0.5, y: 0.8 },
  { x: 0.88, y: 0.2 },
];

const badgeSchema = z
  .object({
    text: z.string().trim().min(1).max(60),
    color: hexColor.default('#7c3aed'),
    textColor: hexColor.default('#ffffff'),
    shape: z
      .enum(['ellipse', 'triangle', 'diamond', 'star', 'pentagon', 'hexagon', 'arrow', 'parallelogram', 'trapezoid', 'heart', 'hand', 'custom'])
      .default('ellipse'),
    /** Vértices 0..1 dentro de la caja de la insignia; sólo se usan con
     * shape 'custom' (se conserva si se vuelve a una forma con nombre). */
    points: z.array(badgePointSchema).min(3).max(16).default(DEFAULT_CUSTOM_POINTS),
    animation: animationSchema.default('pop'),
  })
  .strict();
type BadgeProps = z.infer<typeof badgeSchema>;

export const badgeTemplate: MotionTemplate = {
  id: 'badge',
  version: '1.0.0',
  label: 'Insignia elíptica',
  description: 'Etiqueta ovalada con texto centrado (primera forma no rectangular del titler).',
  category: 'dato',
  defaults: {
    text: 'NUEVO',
    color: '#7c3aed',
    textColor: '#ffffff',
    shape: 'ellipse',
    animation: 'pop',
  },
  fields: [
    { id: 'text', label: 'Texto', kind: 'text' },
    { id: 'color', label: 'Fondo', kind: 'color' },
    { id: 'textColor', label: 'Color del texto', kind: 'color' },
    {
      id: 'shape',
      label: 'Forma',
      kind: 'select',
      options: [
        { value: 'ellipse', label: 'Elipse' },
        { value: 'triangle', label: 'Triángulo' },
        { value: 'diamond', label: 'Rombo' },
        { value: 'star', label: 'Estrella' },
        { value: 'pentagon', label: 'Pentágono' },
        { value: 'hexagon', label: 'Hexágono' },
        { value: 'arrow', label: 'Flecha' },
        { value: 'parallelogram', label: 'Paralelogramo' },
        { value: 'trapezoid', label: 'Trapecio' },
        { value: 'heart', label: 'Corazón' },
        { value: 'hand', label: 'Mano' },
        { value: 'custom', label: 'Personalizada' },
      ],
    },
    {
      id: 'points',
      label: 'Puntos de la forma',
      kind: 'polygon',
      requires: { key: 'shape', value: 'custom' },
    },
    { id: 'animation', label: 'Animación', kind: 'select', options: ANIMATION_OPTIONS },
  ],
  propsSchema: badgeSchema,
  buildLayers(raw, context) {
    const props = raw as BadgeProps;
    const unit = context.height / 1080;
    const fps = context.fpsNum / Math.max(1, context.fpsDen);
    const anim = animation(props.animation, fps, 0.04);
    const badgeWidth = 0.44;
    const badgeHeight = 0.13;
    const badgeX = (1 - badgeWidth) / 2;
    const badgeY = 0.44;
    const fontSize = proFontSize(44, unit);
    const lineHeight = (fontSize * 1.3) / context.height;
    return [
      rect(
        badgeX,
        badgeY,
        badgeWidth,
        badgeHeight,
        props.color,
        0.94,
        anim,
        props.shape,
        props.shape === 'custom' ? props.points : undefined,
      ),
      {
        kind: 'text',
        x: badgeX,
        y: badgeY + badgeHeight / 2 - lineHeight / 2,
        width: badgeWidth,
        height: lineHeight,
        text: props.text,
        fontFamily,
        fontSizePx: fontSize,
        weight: 700,
        color: props.textColor,
        align: 'center',
        animation: anim,
      } satisfies MotionTextLayer,
    ].slice(0, 16);
  },
};

const SHAPE_OPTIONS = [
  { value: 'rect', label: 'Rectángulo' },
  { value: 'ellipse', label: 'Elipse' },
  { value: 'triangle', label: 'Triángulo' },
  { value: 'diamond', label: 'Rombo' },
  { value: 'star', label: 'Estrella' },
  { value: 'pentagon', label: 'Pentágono' },
  { value: 'hexagon', label: 'Hexágono' },
  { value: 'arrow', label: 'Flecha' },
  { value: 'line', label: 'Línea' },
  { value: 'parallelogram', label: 'Paralelogramo' },
  { value: 'trapezoid', label: 'Trapecio' },
  { value: 'heart', label: 'Corazón' },
  { value: 'hand', label: 'Mano' },
  { value: 'custom', label: 'Personalizada' },
] as const;

const shapeSchema = z
  .object({
    shape: z
      .enum(['rect', 'ellipse', 'triangle', 'diamond', 'star', 'pentagon', 'hexagon', 'arrow', 'line', 'parallelogram', 'trapezoid', 'heart', 'hand', 'custom'])
      .default('rect'),
    color: hexColor.default('#7c3aed'),
    /** Lado de la caja de la forma como fracción del lado menor del frame. */
    size: z.number().min(0.05).max(1).default(0.35),
    // `line` admite 2 vértices; `custom` exige ≥3 (validado en render).
    points: z.array(badgePointSchema).min(2).max(16).default(DEFAULT_CUSTOM_POINTS),
    /** Trazo del borde (`traco` de `formas.js`): 0 = sin trazo. */
    strokeColor: hexColor.default('#ffffff'),
    strokeWidth: z.number().min(0).max(0.2).default(0),
    /** Sombra (`sombra` de `formas.js`): distancia en px de PlayRes aprox.
     * (fracción del lado menor del frame); 0 = sin sombra. */
    shadowColor: hexColor.default('#000000'),
    shadowDistance: z.number().min(0).max(0.2).default(0),
    shadowAngle: z.number().min(-180).max(180).default(90),
    shadowOpacity: z.number().min(0).max(1).default(0.6),
    /** Caja libre en fracciones del frame (0–1). Cuando los cuatro campos
     * están presentes, la forma se dibuja en esa caja en vez de la
     * caja cuadrada centrada de `size` — la usa el modo «dibujar» para
     * trazos manuscritos (`maozinha` de AlaukCut). */
    boxX: z.number().min(0).max(1).optional(),
    boxY: z.number().min(0).max(1).optional(),
    boxWidth: z.number().min(0.001).max(1).optional(),
    boxHeight: z.number().min(0.001).max(1).optional(),
    animation: animationSchema.default('none'),
  })
  .strict();
type ShapeProps = z.infer<typeof shapeSchema>;

/**
 * Forma suelta centrada (paridad con `formas.js` de AlaukCut: cuadrado,
 * círculo, triángulo, rombo, estrella, flecha, etc.). El tamaño es una
 * fracción del lado menor del frame; el usuario la reubica y escala con el
 * transform normal del clip gráfico.
 */
export const shapeTemplate: MotionTemplate = {
  id: 'shape',
  version: '1.0.0',
  label: 'Forma',
  description: 'Figura geométrica de color centrada en el frame.',
  category: 'dato',
  defaults: {
    shape: 'rect',
    color: '#7c3aed',
    size: 0.35,
    strokeColor: '#ffffff',
    strokeWidth: 0,
    animation: 'none',
  },
  fields: [
    { id: 'shape', label: 'Forma', kind: 'select', options: SHAPE_OPTIONS },
    {
      id: 'points',
      label: 'Puntos de la forma',
      kind: 'polygon',
      // Sin `requires`: lo usan `custom` (≥3 vértices) y `line` (≥2).
    },
    { id: 'color', label: 'Color', kind: 'color' },
    { id: 'size', label: 'Tamaño (0–1)', kind: 'number', min: 0.05, max: 1 },
    { id: 'strokeColor', label: 'Color de trazo', kind: 'color' },
    {
      id: 'strokeWidth',
      label: 'Grosor del trazo (0 = sin trazo)',
      kind: 'number',
      min: 0,
      max: 0.2,
    },
    { id: 'shadowColor', label: 'Color de sombra', kind: 'color' },
    {
      id: 'shadowDistance',
      label: 'Distancia de sombra (0 = sin sombra)',
      kind: 'number',
      min: 0,
      max: 0.2,
    },
    { id: 'shadowAngle', label: 'Ángulo de sombra (°)', kind: 'number', min: -180, max: 180 },
    { id: 'shadowOpacity', label: 'Opacidad de sombra (0–1)', kind: 'number', min: 0, max: 1 },
    { id: 'animation', label: 'Animación', kind: 'select', options: ANIMATION_OPTIONS },
  ],
  propsSchema: shapeSchema,
  buildLayers(raw, context) {
    const props = raw as ShapeProps;
    const fps = context.fpsNum / Math.max(1, context.fpsDen);
    const anim = animation(props.animation, fps, 0.05);
    const side = Math.min(context.width, context.height) * props.size;
    // Caja libre (trazos manuscritos) o caja cuadrada centrada de `size`.
    const hasBox =
      props.boxX !== undefined &&
      props.boxY !== undefined &&
      props.boxWidth !== undefined &&
      props.boxHeight !== undefined;
    const rawX = hasBox ? props.boxX! : (context.width - side) / context.width / 2;
    const rawY = hasBox ? props.boxY! : (context.height - side) / context.height / 2;
    const w = hasBox ? props.boxWidth! : side / context.width;
    const h = hasBox ? props.boxHeight! : side / context.height;
    // La caja nunca se sale del frame (schema acota cada campo a 0–1 pero
    // no la suma).
    const x = Math.min(Math.max(0, rawX), Math.max(0, 1 - w));
    const y = Math.min(Math.max(0, rawY), Math.max(0, 1 - h));
    return [
      rect(
        x,
        y,
        w,
        h,
        props.color,
        0.96,
        anim,
        props.shape,
        props.shape === 'custom' || props.shape === 'line' ? props.points : undefined,
        // `line` es una polilínea abierta: el trazo ES la forma, así que sin
        // strokeWidth se dibuja con un grosor mínimo visible.
        props.shape === 'line'
          ? {
              color: props.strokeColor,
              width: Math.max(props.strokeWidth, 0.015),
            }
          : { color: props.strokeColor, width: props.strokeWidth },
        // shadowDistance es fracción del lado menor del frame → px de
        // proyecto (el render los escala por `scale` como el texto).
        props.shadowDistance > 0
          ? {
              color: props.shadowColor,
              offsetPx: props.shadowDistance * Math.min(context.width, context.height),
              angleDeg: props.shadowAngle,
              opacity: props.shadowOpacity,
            }
          : undefined,
      ),
    ];
  },
};

const contornoSchema = z
  .object({
    color: hexColor.default('#ff2233'),
    /** Grosor del trazo como fracción del lado menor del frame (≈0.5–15 %). */
    thickness: z.number().min(0.005).max(0.2).default(0.02),
    /** Radio de esquina como fracción del lado menor de la capa (0–0.5). */
    radius: z.number().min(0).max(0.5).default(0.12),
    /** Segundos que tarda el trazo en dibujarse; 0 = trazo completo. */
    drawSeconds: z.number().min(0).max(10).default(0.8),
    animation: animationSchema.default('none'),
  })
  .strict();
type ContornoProps = z.infer<typeof contornoSchema>;

/**
 * Contorno ajustable (paridad `contorno.js` de AlaukCut): marco redondeado
 * que se dibuja solo alrededor del frame. La capa ocupa todo el canvas; el
 * trazo queda insetado medio grosor como en el original (margen = esp/2).
 */
export const contornoTemplate: MotionTemplate = {
  id: 'contorno',
  version: '1.0.0',
  label: 'Contorno',
  description: 'Marco redondeado que se dibuja solo alrededor del video.',
  category: 'identidad',
  defaults: {
    color: '#ff2233',
    thickness: 0.02,
    radius: 0.12,
    drawSeconds: 0.8,
    animation: 'none',
  },
  fields: [
    { id: 'color', label: 'Color', kind: 'color' },
    {
      id: 'thickness',
      label: 'Grosor (0–1)',
      kind: 'number',
      min: 0.005,
      max: 0.2,
    },
    {
      id: 'radius',
      label: 'Radio de esquina (0–0.5)',
      kind: 'number',
      min: 0,
      max: 0.5,
    },
    {
      id: 'drawSeconds',
      label: 'Tiempo de trazo (s)',
      kind: 'number',
      min: 0,
      max: 10,
    },
    { id: 'animation', label: 'Animación', kind: 'select', options: ANIMATION_OPTIONS },
  ],
  propsSchema: contornoSchema,
  buildLayers(raw, context) {
    const props = raw as ContornoProps;
    const fps = context.fpsNum / Math.max(1, context.fpsDen);
    const anim = animation(props.animation, fps, 0.05);
    const minSide = Math.min(context.width, context.height);
    // La caja del trazo deja un margen de medio grosor dentro del frame,
    // igual que `desenhar` de AlaukCut (m = esp/2 + 0.5 ≈ esp/2).
    const thicknessPx = props.thickness * minSide;
    const marginX = thicknessPx / 2 / context.width;
    const marginY = thicknessPx / 2 / context.height;
    const layer: MotionStrokeLayer = {
      kind: 'stroke',
      x: marginX,
      y: marginY,
      width: 1 - 2 * marginX,
      height: 1 - 2 * marginY,
      color: props.color,
      opacity: 0.96,
      thickness: props.thickness,
      radius: props.radius,
      drawSeconds: props.drawSeconds,
      animation: anim,
    };
    return [layer];
  },
};

const solidFrameSchema = z
  .object({
    color: hexColor.default('#ffffff'),
    animation: animationSchema.default('none'),
  })
  .strict();
type SolidFrameProps = z.infer<typeof solidFrameSchema>;

/**
 * Cuadro sólido a pantalla completa (paridad `Telas.inserir('branco')` +
 * `quadroBranco` de `atalhos.js` de AlaukCut): una sola capa rect que cubre
 * todo el canvas. Se inserta con la tecla B y también aparece en la galería
 * Motion para elegir otro color.
 */
const faixaNomeSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    role: line(80).default(''),
    nameCardColor: hexColor.default('#ffffff'),
    roleCardColor: hexColor.default('#16181d'),
    accentColor: hexColor.default('#e2001a'),
    animation: animationSchema.default('slide-left'),
  })
  .strict();
type FaixaNomeProps = z.infer<typeof faixaNomeSchema>;

/** Ancho estimado del texto en px (sin medición real del canvas). */
function estimateTextWidth(text: string, fontSizePx: number, weight: number): number {
  const factor = weight >= 700 ? 0.58 : 0.52;
  return text.length * fontSizePx * factor;
}

/**
 * Tarjetas de nombre y rol con barra de acento (paridad `nome` de
 * `faixas.js` de AlaukCut): dos tarjetas apiladas abajo a la izquierda que
 * entran deslizándose con retardo. El ancho de cada tarjeta se estima por
 * longitud de texto (AlaukCut lo mide con el canvas; acá se aproxima).
 */
export const faixaNomeTemplate: MotionTemplate = {
  id: 'faixa-nome',
  version: '1.0.0',
  label: 'Tarjetas nombre + rol',
  // La descripción evita la frase "lower third": MotionView.test.tsx busca el
  // botón de la placa original por /Lower third/i y una segunda coincidencia
  // en la galería rompería ese test (mismo criterio que lower-third-minimal).
  description: 'Dos tarjetas con barra de acento y entrada escalonada.',
  category: 'identidad',
  defaults: {
    name: 'Maria Fernanda Souza',
    role: 'Economista-chefe',
    nameCardColor: '#ffffff',
    roleCardColor: '#16181d',
    accentColor: '#e2001a',
    animation: 'slide-left',
  },
  fields: [
    { id: 'name', label: 'Nombre', kind: 'text' },
    { id: 'role', label: 'Rol', kind: 'text' },
    { id: 'nameCardColor', label: 'Color tarjeta nombre', kind: 'color' },
    { id: 'roleCardColor', label: 'Color tarjeta rol', kind: 'color' },
    { id: 'accentColor', label: 'Color acento', kind: 'color' },
    { id: 'animation', label: 'Animación', kind: 'select', options: ANIMATION_OPTIONS },
  ],
  propsSchema: faixaNomeSchema,
  buildLayers(raw, context) {
    const props = raw as FaixaNomeProps;
    const unit = context.height / 1080;
    const fps = context.fpsNum / Math.max(1, context.fpsDen);
    const base = Math.max(4, Math.round(fps * 0.4));
    // Entrada escalonada (pF/pN/pC de faixas.js): barra rápida, nombre
    // medio, rol último — se emula con inFrames crecientes.
    const barAnim: MotionAnimation =
      props.animation === 'none'
        ? { kind: 'none' }
        : { kind: props.animation, inFrames: Math.max(2, Math.round(base * 0.6)), outFrames: base };
    const nameAnim: MotionAnimation =
      props.animation === 'none'
        ? { kind: 'none' }
        : { kind: props.animation, inFrames: base, outFrames: base };
    const roleAnim: MotionAnimation =
      props.animation === 'none'
        ? { kind: 'none' }
        : { kind: props.animation, inFrames: Math.round(base * 1.4), outFrames: base };

    const x0 = 0.06;
    const fioW = clamp((8 * unit) / context.width);
    const hN = clamp((58 * unit) / context.height);
    const hC = clamp((36 * unit) / context.height);
    const yC = clamp(0.905 - hC);
    const yN = clamp(yC - hN);
    const padX = (22 * unit) / context.width;

    const namePx = 36 * unit;
    const rolePx = 21 * unit;
    const nameInk = bandLuminance(props.nameCardColor) > 0.6 ? '#101318' : '#ffffff';
    const roleInk = bandLuminance(props.roleCardColor) > 0.6 ? '#101318' : '#ffffff';

    const nameTextW = clamp(estimateTextWidth(props.name, namePx, 800) / context.width);
    const roleTextW = props.role
      ? clamp(estimateTextWidth(props.role, rolePx, 500) / context.width)
      : 0;
    const cardW = (textW: number) => clamp(textW + 2 * padX, 0.08, 0.72);
    const wN = cardW(nameTextW);
    const wC = props.role ? cardW(roleTextW) : 0;

    const layers: MotionLayer[] = [
      rect(x0, yN, fioW, hN + hC, props.accentColor, 1, barAnim),
      rect(x0 + fioW, yN, wN, hN, props.nameCardColor, 0.97, nameAnim),
    ];
    const nameLineH = clamp((namePx * 1.25) / context.height);
    layers.push({
      kind: 'text',
      x: clamp(x0 + fioW + padX),
      y: clamp(yN + (hN - nameLineH) / 2),
      width: clamp(wN - 2 * padX),
      height: nameLineH,
      text: props.name,
      fontFamily,
      fontSizePx: namePx,
      weight: 800,
      color: nameInk,
      align: 'left',
      animation: nameAnim,
    });
    if (props.role && wC > 0) {
      layers.push(rect(x0 + fioW, yC, wC, hC, props.roleCardColor, 0.97, roleAnim));
      const roleLineH = clamp((rolePx * 1.25) / context.height);
      layers.push({
        kind: 'text',
        x: clamp(x0 + fioW + padX),
        y: clamp(yC + (hC - roleLineH) / 2),
        width: clamp(wC - 2 * padX),
        height: roleLineH,
        text: props.role,
        fontFamily,
        fontSizePx: rolePx,
        weight: 500,
        color: roleInk,
        align: 'left',
        animation: roleAnim,
      });
    }
    return layers.slice(0, 16);
  },
};

const faixaLimpoSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    role: line(80).default(''),
    nameColor: hexColor.default('#ffffff'),
    roleColor: hexColor.default('#e9edf2'),
    accentColor: hexColor.default('#3fe4ff'),
    shadowAngle: z.number().min(-180).max(180).default(90),
    shadowOpacity: z.number().min(0).max(1).default(1),
    shadowBlur: z.number().min(0).max(0.05).default(0),
    skewDeg: z.number().min(-30).max(30).default(0),
    animation: animationSchema.default('fade'),
  })
  .strict();
type FaixaLimpoProps = z.infer<typeof faixaLimpoSchema>;

/**
 * Lower third limpio (paridad `limpo` de `faixas.js` de AlaukCut): nombre
 * 800 y rol 500 sobre el video con sombra paralela, más una línea de
 * acento que crece bajo el nombre. Sin banda ni tarjetas — la sombra es lo
 * que da legibilidad (primer template que usa `MotionTextLayer.shadow`).
 */
export const faixaLimpoTemplate: MotionTemplate = {
  id: 'faixa-limpo',
  version: '1.0.0',
  label: 'Limpio (texto + sombra)',
  description: 'Nombre y rol sobre el video con sombra y línea de acento.',
  category: 'identidad',
  defaults: {
    name: 'João Pedro Almeida',
    role: 'Creador del canal Viaje Barata',
    nameColor: '#ffffff',
    roleColor: '#e9edf2',
    accentColor: '#3fe4ff',
    animation: 'fade',
  },
  fields: [
    { id: 'name', label: 'Nombre', kind: 'text' },
    { id: 'role', label: 'Rol', kind: 'text' },
    { id: 'nameColor', label: 'Color nombre', kind: 'color' },
    { id: 'roleColor', label: 'Color rol', kind: 'color' },
    { id: 'accentColor', label: 'Color acento', kind: 'color' },
    { id: 'shadowAngle', label: 'Ángulo de sombra (°)', kind: 'number', min: -180, max: 180 },
    { id: 'shadowOpacity', label: 'Opacidad de sombra (0–1)', kind: 'number', min: 0, max: 1 },
    { id: 'shadowBlur', label: 'Desenfoque de sombra (0–0,05)', kind: 'number', min: 0, max: 0.05 },
    { id: 'skewDeg', label: 'Oblicuidad (°)', kind: 'number', min: -30, max: 30 },
    { id: 'animation', label: 'Animación', kind: 'select', options: ANIMATION_OPTIONS },
  ],
  propsSchema: faixaLimpoSchema,
  buildLayers(raw, context) {
    const props = raw as FaixaLimpoProps;
    const unit = context.height / 1080;
    const fps = context.fpsNum / Math.max(1, context.fpsDen);
    const base = Math.max(4, Math.round(fps * 0.4));
    const fade = (inFrames: number): MotionAnimation =>
      props.animation === 'none'
        ? { kind: 'none' }
        : { kind: props.animation, inFrames, outFrames: base };

    const x0 = 0.065;
    const namePx = 50 * unit;
    const rolePx = 23 * unit;
    const nameLineH = clamp((namePx * 1.22) / context.height);
    const roleLineH = clamp((rolePx * 1.3) / context.height);
    // yN = H*0.8 es la línea base del nombre en faixas.js; el texto arranca
    // ~0.75 del cuerpo hacia arriba.
    const nameY = clamp(0.8 - (namePx * 0.78) / context.height);
    const roleY = clamp(nameY + nameLineH + (8 * unit) / context.height);
    const accentY = clamp(0.8 + (36 * unit) / context.height);
    const accentH = clamp((5 * unit) / context.height);
    const accentW = clamp(
      Math.max(90 * unit, estimateTextWidth(props.name, namePx, 800) * 0.42) /
        context.width,
    );
    const textW = clamp(0.7);

    const layers: MotionLayer[] = [
      rect(x0, accentY, accentW, accentH, props.accentColor, 1, fade(Math.round(base * 0.5))),
      {
        kind: 'text',
        x: x0,
        y: nameY,
        width: textW,
        height: nameLineH,
        text: props.name,
        fontFamily,
        fontSizePx: namePx,
        weight: 800,
        color: props.nameColor,
        align: 'left',
        animation: fade(base),
        skewXDeg: props.skewDeg,
        shadow: {
          color: '#000000',
          offsetPx: 10 * unit,
          angleDeg: props.shadowAngle,
          opacity: props.shadowOpacity,
          blurPx: props.shadowBlur * Math.min(context.width, context.height),
        },
      },
    ];
    if (props.role) {
      layers.push({
        kind: 'text',
        x: x0,
        y: roleY,
        width: textW,
        height: roleLineH,
        text: props.role,
        fontFamily,
        fontSizePx: rolePx,
        weight: 500,
        color: props.roleColor,
        align: 'left',
        animation: fade(Math.round(base * 1.5)),
        skewXDeg: props.skewDeg,
        shadow: {
          color: '#000000',
          offsetPx: 6 * unit,
          angleDeg: props.shadowAngle,
          opacity: props.shadowOpacity,
          blurPx: props.shadowBlur * Math.min(context.width, context.height),
        },
      });
    }
    return layers.slice(0, 16);
  },
};

const faixaJornalSchema = z
  .object({
    tag: line(40).default(''),
    headline: z.string().trim().min(1).max(90),
    subtitle: line(110).default(''),
    bandColor: hexColor.default('#0d47a8'),
    subtitleColor: hexColor.default('#f4f6fa'),
    accentColor: hexColor.default('#ffd400'),
    animation: animationSchema.default('slide-up'),
  })
  .strict();
type FaixaJornalProps = z.infer<typeof faixaJornalSchema>;

/**
 * Banda de noticias (paridad `jornal` de `faixas.js` de AlaukCut): banda
 * ancha con barra de acento inferior, titular en mayúsculas, pastilla de
 * sección que se desliza desde la banda hacia arriba y banda clara de
 * bajada debajo. Aproximaciones honestas: la banda de AlaukCut es un
 * degradado con esquinas superiores redondeadas y la bajada se revela en
 * wipe — acá son rects sólidos y la entrada es slide/fade estándar.
 */
export const faixaJornalTemplate: MotionTemplate = {
  id: 'faixa-jornal',
  version: '1.0.0',
  label: 'Banda de noticias',
  description: 'Banda con acento, titular y bajada para noticias.',
  category: 'identidad',
  defaults: {
    tag: 'POLÍTICA',
    headline: 'CONGRESO VOTA LA REFORMA ESTE MIÉRCOLES',
    subtitle: 'La sesión empieza a las 14 h y puede extenderse',
    bandColor: '#0d47a8',
    subtitleColor: '#f4f6fa',
    accentColor: '#ffd400',
    animation: 'slide-up',
  },
  fields: [
    { id: 'tag', label: 'Sección (pastilla)', kind: 'text' },
    { id: 'headline', label: 'Titular', kind: 'text' },
    { id: 'subtitle', label: 'Bajada', kind: 'text' },
    { id: 'bandColor', label: 'Color banda', kind: 'color' },
    { id: 'subtitleColor', label: 'Color bajada', kind: 'color' },
    { id: 'accentColor', label: 'Color acento', kind: 'color' },
    { id: 'animation', label: 'Animación', kind: 'select', options: ANIMATION_OPTIONS },
  ],
  propsSchema: faixaJornalSchema,
  buildLayers(raw, context) {
    const props = raw as FaixaJornalProps;
    const unit = context.height / 1080;
    const fps = context.fpsNum / Math.max(1, context.fpsDen);
    const base = Math.max(4, Math.round(fps * 0.45));
    const anim = (inFrames: number): MotionAnimation =>
      props.animation === 'none'
        ? { kind: 'none' }
        : { kind: props.animation, inFrames, outFrames: Math.round(base * 0.8) };

    // Geometría de faixas.js: banda 66u + bajada 38u apoyadas con el pie en
    // 0.925 del alto; la pastilla de 34u queda encima de la banda.
    const hB = (66 * unit) / context.height;
    const hS = (38 * unit) / context.height;
    const hT = (34 * unit) / context.height;
    const bandBottom = 0.925 - hS;
    const bandTop = bandBottom - hB;
    const subTop = bandBottom;
    const x0 = 0.055;
    const wBand = 0.86;
    const pad = (24 * unit) / context.width;

    const bandInk = bandLuminance(props.bandColor) > 0.6 ? '#101318' : '#ffffff';
    const subInk = bandLuminance(props.subtitleColor) > 0.6 ? '#101318' : '#ffffff';
    const tagInk = bandLuminance(props.accentColor) > 0.6 ? '#101318' : '#ffffff';

    const headPx = 40 * unit;
    const headLineH = clamp((headPx * 1.2) / context.height);
    // El texto ocupa la banda menos la barra de acento de 5u, centrado.
    const headY = clamp(bandTop + ((61 * unit) / 2 - headPx * 0.6) / context.height);

    const layers: MotionLayer[] = [
      rect(x0, bandTop, wBand, hB, props.bandColor, 0.94, anim(Math.round(base * 0.4))),
      rect(
        x0,
        bandTop + hB - (5 * unit) / context.height,
        wBand,
        (5 * unit) / context.height,
        props.accentColor,
        1,
        anim(Math.round(base * 0.4)),
      ),
      {
        kind: 'text',
        x: clamp(x0 + pad),
        y: headY,
        width: clamp(wBand - 2 * pad),
        height: headLineH,
        text: props.headline.toUpperCase(),
        fontFamily,
        fontSizePx: headPx,
        weight: 600,
        color: bandInk,
        align: 'left',
        animation: anim(Math.round(base * 1.2)),
      },
    ];

    const tag = props.tag.trim().toUpperCase();
    if (tag) {
      const tagPx = 22 * unit;
      const tagW = clamp(
        (estimateTextWidth(tag, tagPx, 600) + 30 * unit) / context.width,
        0.06,
        0.5,
      );
      const tagX = clamp(x0 + (14 * unit) / context.width);
      const tagY = clamp(bandTop - hT - (4 * unit) / context.height);
      const tagLineH = clamp((tagPx * 1.25) / context.height);
      const tagAnim = anim(Math.round(base * 0.8));
      layers.push(rect(tagX, tagY, tagW, hT, props.accentColor, 1, tagAnim));
      layers.push({
        kind: 'text',
        x: clamp(tagX + (15 * unit) / context.width),
        y: clamp(tagY + (hT - tagLineH) / 2),
        width: clamp(tagW - (30 * unit) / context.width),
        height: tagLineH,
        text: tag,
        fontFamily,
        fontSizePx: tagPx,
        weight: 600,
        color: tagInk,
        align: 'left',
        animation: tagAnim,
      });
    }

    if (props.subtitle.trim()) {
      const subPx = 20 * unit;
      const subW = wBand * 0.78;
      const subLineH = clamp((subPx * 1.3) / context.height);
      const subY = clamp(subTop + (hS - subLineH) / 2);
      const subAnim = anim(Math.round(base * 1.6));
      layers.push(rect(x0, subTop, subW, hS, props.subtitleColor, 0.96, subAnim));
      layers.push({
        kind: 'text',
        x: clamp(x0 + pad),
        y: subY,
        width: clamp(subW - 2 * pad),
        height: subLineH,
        text: props.subtitle,
        fontFamily,
        fontSizePx: subPx,
        weight: 600,
        color: subInk,
        align: 'left',
        animation: subAnim,
      });
    }
    return layers.slice(0, 16);
  },
};

/**
 * Aclara un hex #rrggbb mezclándolo con blanco (paridad `mistura(cor, '#fff', .35)`
 * de faixas.js, usada para el filo claro de la banda de `cidade`). */
function mixWithWhite(hex: string, amount: number): string {
  const value = hex.replace('#', '');
  const channel = (offset: number): number => {
    const base = parseInt(value.slice(offset, offset + 2), 16);
    return Math.round(base + (255 - base) * amount);
  };
  const toHex = (n: number): string => n.toString(16).padStart(2, '0');
  return `#${toHex(channel(0))}${toHex(channel(2))}${toHex(channel(4))}`;
}

/**
 * Paralelogramo inclinado como el `incl()` de faixas.js: la arista superior
 * está corrida `slant` (fracción normalizada del ancho) a la derecha
 * respecto de la inferior. La caja de la capa se amplía `slant` para que
 * los puntos normalizados queden en 0..1 (validación de
 * `custom_shape_vertices` en Rust y del preview).
 */
function slantedRect(
  x: number,
  y: number,
  w: number,
  h: number,
  slant: number,
  color: string,
  opacity: number,
  anim: MotionAnimation,
): MotionRectLayer {
  const boxW = w + slant;
  const t = slant / boxW;
  return rect(x, y, boxW, h, color, opacity, anim, 'custom', [
    { x: t, y: 0 },
    { x: 1, y: 0 },
    { x: w / boxW, y: 1 },
    { x: 0, y: 1 },
  ]);
}

const faixaCidadeSchema = z
  .object({
    tag: line(40).default(''),
    headline: z.string().trim().min(1).max(90),
    subtitle: line(110).default(''),
    bandColor: hexColor.default('#0c1a3a'),
    tagColor: hexColor.default('#e30613'),
    subtitleColor: hexColor.default('#d9dde4'),
    animation: animationSchema.default('slide-left'),
  })
  .strict();
type FaixaCidadeProps = z.infer<typeof faixaCidadeSchema>;

/**
 * Bandas inclinadas de ciudad (paridad `cidade` de `faixas.js` de AlaukCut):
 * pastilla roja y banda principal en paralelogramas (el primer template que
 * usa `shape:'custom'` con 4 puntos), filo claro superior y bajada clara.
 * Aproximaciones honestas: sin itálica (el modelo de capas no la tiene), la
 * entrada es slide/fade estándar en vez del wipe de `recorte`, y el texto de
 * la pastilla se estima por longitud (AlaukCut lo mide con canvas).
 */
export const faixaCidadeTemplate: MotionTemplate = {
  id: 'faixa-cidade',
  version: '1.0.0',
  label: 'Bandas inclinadas',
  description: 'Pastilla y banda en diagonal con bajada clara.',
  category: 'identidad',
  defaults: {
    tag: 'CIUDAD',
    headline: 'TRÁNSITO CORTADO EN LA ZONA SUR',
    subtitle: 'Un accidente intercepta dos carriles de la avenida',
    bandColor: '#0c1a3a',
    tagColor: '#e30613',
    subtitleColor: '#d9dde4',
    animation: 'slide-left',
  },
  fields: [
    { id: 'tag', label: 'Pastilla', kind: 'text' },
    { id: 'headline', label: 'Titular', kind: 'text' },
    { id: 'subtitle', label: 'Bajada', kind: 'text' },
    { id: 'bandColor', label: 'Color banda', kind: 'color' },
    { id: 'tagColor', label: 'Color pastilla', kind: 'color' },
    { id: 'subtitleColor', label: 'Color bajada', kind: 'color' },
    { id: 'animation', label: 'Animación', kind: 'select', options: ANIMATION_OPTIONS },
  ],
  propsSchema: faixaCidadeSchema,
  buildLayers(raw, context) {
    const props = raw as FaixaCidadeProps;
    const unit = context.height / 1080;
    const fps = context.fpsNum / Math.max(1, context.fpsDen);
    const base = Math.max(4, Math.round(fps * 0.45));
    const anim = (inFrames: number): MotionAnimation =>
      props.animation === 'none'
        ? { kind: 'none' }
        : { kind: props.animation, inFrames, outFrames: Math.round(base * 0.8) };

    // Geometría de faixas.js: banda 64u + bajada 36u con pie en 0.925;
    // inclinación inc = 22u; la pastilla tiene la MISMA altura que la banda.
    const hB = (64 * unit) / context.height;
    const hS = (36 * unit) / context.height;
    const incX = (22 * unit) / context.width;
    const bandBottom = 0.925 - hS;
    const bandTop = bandBottom - hB;
    const x0 = 0.05;

    const bandInk = bandLuminance(props.bandColor) > 0.6 ? '#101318' : '#ffffff';
    const subInk = bandLuminance(props.subtitleColor) > 0.6 ? '#101318' : '#ffffff';
    const tagInk = bandLuminance(props.tagColor) > 0.6 ? '#101318' : '#ffffff';

    const tag = props.tag.trim().toUpperCase();
    const tagPx = 27 * unit;
    const tagW = tag
      ? clamp(
          (estimateTextWidth(tag, tagPx, 400) + 44 * unit) / context.width,
          0.05,
          0.4,
        )
      : 0;
    // wB = W*0.87 - wE - 8u - inc  (todo en px de 1080 → normalizado).
    const bandW = clamp(0.87 - tagW - (8 * unit) / context.width - incX, 0.2, 0.8);
    const bandX = tagW > 0 ? x0 + tagW + (8 * unit) / context.width : x0;
    // wS = W*0.70 exacto en faixas.js; la caja del paralelogramo crece el
    // slant dentro de slantedRect (w + inc*0.55).
    const subW = 0.7;
    const subX = clamp(x0 - incX * 0.55);

    const layers: MotionLayer[] = [];

    if (tag && tagW > 0) {
      const tagAnim = anim(Math.round(base * 0.6));
      layers.push(slantedRect(x0, bandTop, tagW, hB, incX, props.tagColor, 1, tagAnim));
      const tagLineH = clamp((tagPx * 1.25) / context.height);
      layers.push({
        kind: 'text',
        // El original centra el texto en la pastilla inclinada.
        x: clamp(x0 + incX / 2 + tagW / 2 - 0.18),
        y: clamp(bandTop + (hB - tagLineH) / 2),
        width: clamp(0.36),
        height: tagLineH,
        text: tag,
        fontFamily,
        fontSizePx: tagPx,
        weight: 400,
        color: tagInk,
        align: 'center',
        animation: tagAnim,
      });
    }

    const bandAnim = anim(Math.round(base * 1.1));
    // Filo claro de 5u sobre la banda (mistura(cor1, blanco, .35)).
    layers.push(
      slantedRect(
        bandX,
        bandTop,
        bandW,
        (5 * unit) / context.height,
        incX,
        mixWithWhite(props.bandColor, 0.35),
        0.9,
        bandAnim,
      ),
    );
    layers.push(slantedRect(bandX, bandTop, bandW, hB, incX, props.bandColor, 0.95, bandAnim));

    const headPx = 34 * unit;
    const headLineH = clamp((headPx * 1.25) / context.height);
    layers.push({
      kind: 'text',
      x: clamp(bandX + incX + (18 * unit) / context.width),
      y: clamp(bandTop + (hB - headLineH) / 2),
      width: clamp(bandW - incX - (40 * unit) / context.width),
      height: headLineH,
      text: props.headline.toUpperCase(),
      fontFamily,
      fontSizePx: headPx,
      weight: 700,
      color: bandInk,
      align: 'left',
      animation: anim(Math.round(base * 1.8)),
    });

    if (props.subtitle.trim()) {
      const subAnim = anim(Math.round(base * 2.2));
      layers.push(
        slantedRect(
          subX,
          bandBottom,
          subW,
          hS,
          incX * 0.55,
          props.subtitleColor,
          0.96,
          subAnim,
        ),
      );
      const subPx = 20 * unit;
      const subLineH = clamp((subPx * 1.3) / context.height);
      layers.push({
        kind: 'text',
        x: clamp(x0 + (18 * unit) / context.width),
        y: clamp(bandBottom + (hS - subLineH) / 2),
        width: clamp(subW - incX * 0.55 - (36 * unit) / context.width),
        height: subLineH,
        text: props.subtitle,
        fontFamily,
        fontSizePx: subPx,
        weight: 700,
        color: subInk,
        align: 'left',
        animation: subAnim,
      });
    }
    return layers.slice(0, 16);
  },
};

const faixaEsporteSchema = z
  .object({
    tag: line(40).default(''),
    headline: z.string().trim().min(1).max(90),
    subtitle: line(110).default(''),
    bandColor: hexColor.default('#11151c'),
    tagColor: hexColor.default('#ffd000'),
    subtitleColor: hexColor.default('#e8002d'),
    animation: animationSchema.default('slide-left'),
  })
  .strict();
type FaixaEsporteProps = z.infer<typeof faixaEsporteSchema>;

/**
 * Banda deportiva (paridad `esporte` de `faixas.js` de AlaukCut): pastilla
 * amarilla que cae desde arriba + banda oscura y bajada roja en
 * paralelogramo, todas de ANCHO COMPACTO alrededor del texto (a diferencia
 * de `cidade`/`jornal` que ocupan casi todo el ancho). Reutiliza
 * `slantedRect`/`estimateTextWidth`. Aproximaciones: sin itálica ni
 * letter-spacing (el modelo de capas no los tiene) y la pastilla entra con
 * pop en vez de caer desde arriba (no hay slide-down).
 */
export const faixaEsporteTemplate: MotionTemplate = {
  id: 'faixa-esporte',
  version: '1.0.0',
  label: 'Banda deportiva',
  description: 'Pastilla y bandas compactas en diagonal para deportes.',
  category: 'identidad',
  defaults: {
    tag: 'FÚTBOL',
    headline: 'FINAL DEL CAMPEONATO',
    subtitle: 'Decisión el domingo a las 16 h',
    bandColor: '#11151c',
    tagColor: '#ffd000',
    subtitleColor: '#e8002d',
    animation: 'slide-left',
  },
  fields: [
    { id: 'tag', label: 'Pastilla', kind: 'text' },
    { id: 'headline', label: 'Titular', kind: 'text' },
    { id: 'subtitle', label: 'Bajada', kind: 'text' },
    { id: 'bandColor', label: 'Color banda', kind: 'color' },
    { id: 'tagColor', label: 'Color pastilla', kind: 'color' },
    { id: 'subtitleColor', label: 'Color bajada', kind: 'color' },
    { id: 'animation', label: 'Animación', kind: 'select', options: ANIMATION_OPTIONS },
  ],
  propsSchema: faixaEsporteSchema,
  buildLayers(raw, context) {
    const props = raw as FaixaEsporteProps;
    const unit = context.height / 1080;
    const fps = context.fpsNum / Math.max(1, context.fpsDen);
    const base = Math.max(4, Math.round(fps * 0.4));
    const anim = (inFrames: number): MotionAnimation =>
      props.animation === 'none'
        ? { kind: 'none' }
        : { kind: props.animation, inFrames, outFrames: Math.round(base * 0.7) };

    // Geometría de faixas.js: banda 74u, gap 5u, bajada 34u, pie en 0.92;
    // inclinación inc = 26u. Los anchos son POR TEXTO (+márgenes), no full.
    const hB = (74 * unit) / context.height;
    const hS = (34 * unit) / context.height;
    const gapY = (5 * unit) / context.height;
    const incX = (26 * unit) / context.width;
    const x0 = 0.06;
    const subTop = 0.92 - hS;
    const bandTop = subTop - gapY - hB;

    const bandInk = bandLuminance(props.bandColor) > 0.6 ? '#101318' : '#ffffff';
    const subInk = bandLuminance(props.subtitleColor) > 0.6 ? '#101318' : '#ffffff';
    const tagInk = bandLuminance(props.tagColor) > 0.6 ? '#101318' : '#ffffff';

    const tag = props.tag.trim().toUpperCase();
    const tagPx = 34 * unit;
    const tagW = tag
      ? clamp(
          (estimateTextWidth(tag, tagPx, 700) + 46 * unit) / context.width,
          0.05,
          0.4,
        )
      : 0;

    const headPx = 58 * unit;
    const headTextW = estimateTextWidth(props.headline.toUpperCase(), headPx, 700);
    // El original limita el texto a W*0.6; acá el tope real es que la banda
    // (más su slant) no se salga del borde derecho del cuadro.
    const bandX0 = tagW > 0 ? x0 + tagW + (6 * unit) / context.width : x0;
    const bandW = clamp(
      Math.min(
        (headTextW + 70 * unit) / context.width,
        0.94 - bandX0 - incX,
      ),
      0.2,
      0.85,
    );
    const bandX = bandX0;

    const subPx = 27 * unit;
    const subTextW = props.subtitle.trim()
      ? estimateTextWidth(props.subtitle.toUpperCase(), subPx, 500)
      : 0;
    const subW = props.subtitle.trim()
      ? clamp((subTextW + 56 * unit) / context.width, 0.15, 0.8)
      : 0;

    const layers: MotionLayer[] = [];

    if (tag && tagW > 0) {
      // La pastilla entra con pop (el original la deja caer desde arriba y no
      // hay slide-down en el modelo de animaciones).
      const tagAnim: MotionAnimation =
        props.animation === 'none' ? { kind: 'none' } : { kind: 'pop', inFrames: Math.round(base * 0.6), outFrames: base };
      layers.push(slantedRect(x0, bandTop, tagW, hB, incX, props.tagColor, 1, tagAnim));
      const tagLineH = clamp((tagPx * 1.25) / context.height);
      layers.push({
        kind: 'text',
        // El original centra el texto en la pastilla inclinada.
        x: clamp(x0 + incX / 2 + tagW / 2 - 0.2),
        y: clamp(bandTop + (hB - tagLineH) / 2),
        width: clamp(0.4),
        height: tagLineH,
        text: tag,
        fontFamily,
        fontSizePx: tagPx,
        weight: 700,
        color: tagInk,
        align: 'center',
        animation: tagAnim,
      });
    }

    const bandAnim = anim(Math.round(base * 0.8));
    layers.push(slantedRect(bandX, bandTop, bandW, hB, incX, props.bandColor, 0.96, bandAnim));
    const headLineH = clamp((headPx * 1.3) / context.height);
    layers.push({
      kind: 'text',
      x: clamp(bandX + incX + (22 * unit) / context.width),
      y: clamp(bandTop + (hB - headLineH) / 2),
      width: clamp(bandW - incX - (44 * unit) / context.width),
      height: headLineH,
      text: props.headline.toUpperCase(),
      fontFamily,
      fontSizePx: headPx,
      weight: 700,
      color: bandInk,
      align: 'left',
      animation: anim(Math.round(base * 1.5)),
    });

    if (props.subtitle.trim() && subW > 0) {
      // Bajada: paralelogramo con slant inc*0.46 corrido +inc*0.1 a la
      // derecha, ancho compacto por texto.
      const subSlant = incX * 0.46;
      const subX = clamp(x0 + incX * 0.1);
      const subAnim = anim(Math.round(base * 2));
      layers.push(slantedRect(subX, subTop, subW, hS, subSlant, props.subtitleColor, 0.96, subAnim));
      const subLineH = clamp((subPx * 1.35) / context.height);
      layers.push({
        kind: 'text',
        // El original ubica el texto en x0 + inc + 14u (inc completa).
        x: clamp(x0 + incX + (14 * unit) / context.width),
        y: clamp(subTop + (hS - subLineH) / 2),
        width: clamp(subW - (incX * 0.46) - (30 * unit) / context.width),
        height: subLineH,
        text: props.subtitle.toUpperCase(),
        fontFamily,
        fontSizePx: subPx,
        weight: 500,
        color: subInk,
        align: 'left',
        animation: subAnim,
      });
    }
    return layers.slice(0, 16);
  },
};

const faixaPlantaoSchema = z
  .object({
    tag: line(40).default(''),
    headline: z.string().trim().min(1).max(90),
    subtitle: line(110).default(''),
    bandColor: hexColor.default('#ffffff'),
    subtitleColor: hexColor.default('#0b1f3f'),
    accentColor: hexColor.default('#d8101a'),
    animation: animationSchema.default('slide-left'),
  })
  .strict();
type FaixaPlantaoProps = z.infer<typeof faixaPlantaoSchema>;

/**
 * Banda de urgencia/planton (paridad `plantao` de `faixas.js` de
 * AlaukCut): tres barras apiladas de ancho casi completo — pastilla de
 * etiqueta arriba (ancho compacto, sube desde abajo), banda clara con
 * franja de acento de 4u en el borde superior, y banda oscura de bajada.
 * Geometría 1:1: hE=38u, hB=64u, hS=36u, pie en 0.925, x0=0.055,
 * wT=0.89. Aproximaciones: los `recorte` (wipe de ancho) y la subida de
 * la pastilla se emulan con slide-left/slide-up y el desliz lateral del
 * titular no se porta (queda en posición final).
 */
export const faixaPlantaoTemplate: MotionTemplate = {
  id: 'faixa-plantao',
  version: '1.0.0',
  label: 'Banda urgencia',
  description: 'Tres barras apiladas para noticias urgentes y alertas.',
  category: 'identidad',
  defaults: {
    tag: 'URGENTE',
    headline: 'Lluvia fuerte: evacuen la zona baja',
    subtitle: 'Defensa Civil pide evitar la región central',
    bandColor: '#ffffff',
    subtitleColor: '#0b1f3f',
    accentColor: '#d8101a',
    animation: 'slide-left',
  },
  fields: [
    { id: 'tag', label: 'Pastilla', kind: 'text' },
    { id: 'headline', label: 'Titular', kind: 'text' },
    { id: 'subtitle', label: 'Bajada', kind: 'text' },
    { id: 'bandColor', label: 'Color banda', kind: 'color' },
    { id: 'subtitleColor', label: 'Color bajada', kind: 'color' },
    { id: 'accentColor', label: 'Color acento', kind: 'color' },
    { id: 'animation', label: 'Animación', kind: 'select', options: ANIMATION_OPTIONS },
  ],
  propsSchema: faixaPlantaoSchema,
  buildLayers(raw, context) {
    const props = raw as FaixaPlantaoProps;
    const unit = context.height / 1080;
    const fps = context.fpsNum / Math.max(1, context.fpsDen);
    const base = Math.max(4, Math.round(fps * 0.4));
    const anim = (inFrames: number): MotionAnimation =>
      props.animation === 'none'
        ? { kind: 'none' }
        : { kind: props.animation, inFrames, outFrames: Math.round(base * 0.7) };

    // Geometría de faixas.js: barras de 38u/64u/36u apiladas con pie en
    // 0.925; la pastilla (38u) va ENCIMA de la banda.
    const hE = (38 * unit) / context.height;
    const hB = (64 * unit) / context.height;
    const hS = (36 * unit) / context.height;
    const x0 = 0.055;
    const wT = 0.89;
    const subTop = 0.925 - hS;
    const bandTop = subTop - hB;
    const tagTop = bandTop - hE;

    const bandInk = bandLuminance(props.bandColor) > 0.6 ? '#101318' : '#ffffff';
    const subInk = bandLuminance(props.subtitleColor) > 0.6 ? '#101318' : '#ffffff';
    const tagInk = bandLuminance(props.accentColor) > 0.6 ? '#101318' : '#ffffff';

    const layers: MotionLayer[] = [];
    const padX = (20 * unit) / context.width;

    const tag = props.tag.trim().toUpperCase();
    if (tag) {
      const tagPx = 25 * unit;
      const tagW = clamp(
        (estimateTextWidth(tag, tagPx, 800) + 34 * unit) / context.width,
        0.05,
        wT,
      );
      // La pastilla sube desde abajo en el original → slide-up.
      const tagAnim: MotionAnimation =
        props.animation === 'none'
          ? { kind: 'none' }
          : { kind: 'slide-up', inFrames: Math.round(base * 0.6), outFrames: base };
      layers.push(rect(x0, tagTop, tagW, hE, props.accentColor, 1, tagAnim));
      const tagLineH = clamp((tagPx * 1.25) / context.height);
      layers.push({
        kind: 'text',
        x: clamp(x0 + (17 * unit) / context.width),
        y: clamp(tagTop + (hE - tagLineH) / 2),
        width: clamp(tagW - (30 * unit) / context.width),
        height: tagLineH,
        text: tag,
        fontFamily,
        fontSizePx: tagPx,
        weight: 800,
        color: tagInk,
        align: 'left',
        animation: tagAnim,
      });
    }

    // Banda clara + franja de acento de 4u en su borde superior.
    const bandAnim = anim(Math.round(base * 0.5));
    layers.push(rect(x0, bandTop, wT, (4 * unit) / context.height, props.accentColor, 1, bandAnim));
    layers.push(rect(x0, bandTop, wT, hB, props.bandColor, 1, bandAnim));

    const headPx = 47 * unit;
    const headLineH = clamp((headPx * 1.25) / context.height);
    layers.push({
      kind: 'text',
      x: clamp(x0 + padX),
      y: clamp(bandTop + (hB - headLineH) / 2),
      width: clamp(wT - padX * 2),
      height: headLineH,
      text: props.headline.toUpperCase(),
      fontFamily,
      fontSizePx: headPx,
      weight: 800,
      color: bandInk,
      align: 'left',
      animation: anim(Math.round(base * 1.1)),
    });

    if (props.subtitle.trim()) {
      const subAnim = anim(Math.round(base * 1.6));
      layers.push(rect(x0, subTop, wT, hS, props.subtitleColor, 1, subAnim));
      const subPx = 20 * unit;
      const subLineH = clamp((subPx * 1.3) / context.height);
      layers.push({
        kind: 'text',
        x: clamp(x0 + padX),
        y: clamp(subTop + (hS - subLineH) / 2),
        width: clamp(wT - padX * 2),
        height: subLineH,
        text: props.subtitle,
        fontFamily,
        fontSizePx: subPx,
        weight: 600,
        color: subInk,
        align: 'left',
        animation: subAnim,
      });
    }
    return layers.slice(0, 16);
  },
};

/**
 * Cápsula/stadio (rectángulo con semicírculos en los extremos, radio =
 * h/2) como polígono `custom` de 16 puntos: arista superior con punto
 * medio, arco derecho de 7 puntos, arista inferior con punto medio y arco
 * izquierdo de 7 puntos (el vértice de cierre coincide con el inicial y
 * se descarta). Coordenadas en píxeles de la caja → normalizadas 0..1.
 */
function capsulePoints(boxW: number, boxH: number): MotionPoint[] {
  const r = boxH / 2;
  const raw: { x: number; y: number }[] = [];
  raw.push({ x: r, y: 0 });
  raw.push({ x: boxW / 2, y: 0 });
  for (let i = 0; i <= 6; i += 1) {
    const a = (-90 + i * 30) * (Math.PI / 180);
    raw.push({ x: boxW - r + r * Math.cos(a), y: r + r * Math.sin(a) });
  }
  raw.push({ x: boxW / 2, y: boxH });
  for (let i = 0; i <= 6; i += 1) {
    const a = (90 + i * 30) * (Math.PI / 180);
    raw.push({ x: r + r * Math.cos(a), y: r + r * Math.sin(a) });
  }
  // 17 puntos con el primero duplicado al final → se descarta.
  return raw.slice(0, 16).map((p) => ({
    x: clamp(p.x / boxW),
    y: clamp(p.y / boxH),
  }));
}

const faixaAovivoSchema = z
  .object({
    tag: line(40).default(''),
    headline: line(90).default(''),
    subtitle: line(110).default(''),
    bandColor: hexColor.default('#10141b'),
    textColor: hexColor.default('#ffffff'),
    accentColor: hexColor.default('#e2001a'),
    animation: animationSchema.default('slide-left'),
  })
  .strict();
type FaixaAovivoProps = z.infer<typeof faixaAovivoSchema>;

/**
 * Bug "AO VIVO" (paridad `aovivo` de `faixas.js` de AlaukCut): banda
 * cápsula oscura al 86 % con píldora roja interior (también cápsula)
 * que contiene punto + etiqueta, y dos líneas de texto a su derecha.
 * Usa `capsulePoints` (polígono custom de 16 puntos) porque el modelo
 * no tiene forma stadium. Geometría 1:1: hB=62u, pie en 0.915,
 * x0=0.055, pastilla inset 6u. Aproximaciones honestas: el punto
 * pulsante `sin(t)` queda ESTÁTICO (el modelo no tiene animación
 * continua), la entrada con escala de la pastilla se emula con `pop`
 * y los `recorte` de ancho con slide-left.
 */
export const faixaAovivoTemplate: MotionTemplate = {
  id: 'faixa-aovivo',
  version: '1.0.0',
  label: 'En vivo',
  description: 'Banda cápsula con píldora de transmisión en directo.',
  category: 'identidad',
  defaults: {
    tag: 'AO VIVO',
    headline: 'São Paulo',
    subtitle: 'Avenida Paulista · 19h42',
    bandColor: '#10141b',
    textColor: '#ffffff',
    accentColor: '#e2001a',
    animation: 'slide-left',
  },
  fields: [
    { id: 'tag', label: 'Píldora', kind: 'text' },
    { id: 'headline', label: 'Línea 1', kind: 'text' },
    { id: 'subtitle', label: 'Línea 2', kind: 'text' },
    { id: 'bandColor', label: 'Color banda', kind: 'color' },
    { id: 'textColor', label: 'Color texto', kind: 'color' },
    { id: 'accentColor', label: 'Color píldora', kind: 'color' },
    { id: 'animation', label: 'Animación', kind: 'select', options: ANIMATION_OPTIONS },
  ],
  propsSchema: faixaAovivoSchema,
  buildLayers(raw, context) {
    const props = raw as FaixaAovivoProps;
    const unit = context.height / 1080;
    const fps = context.fpsNum / Math.max(1, context.fpsDen);
    const base = Math.max(4, Math.round(fps * 0.4));
    const anim = (inFrames: number): MotionAnimation =>
      props.animation === 'none'
        ? { kind: 'none' }
        : { kind: props.animation, inFrames, outFrames: Math.round(base * 0.7) };

    // Geometría de faixas.js: banda cápsula 62u, pie en 0.915; la
    // píldora queda inset 6u dentro de la banda.
    const hB = (62 * unit) / context.height;
    const x0 = 0.055;
    const bandBottom = 0.915;
    const bandTop = bandBottom - hB;

    const tag = props.tag.trim().toUpperCase();
    const tagPx = 21 * unit;
    const tagW = tag
      ? clamp(
          (estimateTextWidth(tag, tagPx, 800) + 58 * unit) / context.width,
          0.05,
          0.45,
        )
      : 0;

    const l1Px = 26 * unit;
    const l2Px = 19 * unit;
    const l1W = props.headline.trim()
      ? estimateTextWidth(props.headline, l1Px, 800)
      : 0;
    const l2W = props.subtitle.trim()
      ? estimateTextWidth(props.subtitle, l2Px, 500)
      : 0;
    const textW = Math.max(l1W, l2W);
    // wB = wE + wTx + 62u; guarda de borde derecho.
    const bandW = clamp(
      Math.min(
        tagW + textW / context.width + (62 * unit) / context.width,
        0.94 - x0,
      ),
      0.15,
      0.9,
    );

    const layers: MotionLayer[] = [];
    const pillInset = (6 * unit) / context.height; // inset vertical en fracción
    const pillH = hB - pillInset * 2;
    const pillY = bandTop + pillInset;
    const pillAnim: MotionAnimation =
      props.animation === 'none'
        ? { kind: 'none' }
        : { kind: 'pop', inFrames: Math.round(base * 0.8), outFrames: base };

    // Banda cápsula oscura (alpha .86 como el original).
    const bandAnim = anim(Math.round(base * 0.6));
    layers.push(capsuleRect(x0, bandTop, bandW, hB, props.bandColor, 0.86, bandAnim, context));

    const textX = clamp(x0 + tagW + (26 * unit) / context.width);
    if (props.headline.trim()) {
      const l1LineH = clamp((l1Px * 1.25) / context.height);
      // El original ubica la línea 1 al 34 % de la banda si hay línea 2,
      // si no al 50 %.
      const centerFrac = props.subtitle.trim() ? 0.34 : 0.5;
      layers.push({
        kind: 'text',
        x: textX,
        y: clamp(bandTop + hB * centerFrac - l1LineH / 2),
        width: clamp(Math.min(textW / context.width + 0.05, bandW - tagW - (40 * unit) / context.width)),
        height: l1LineH,
        text: props.headline,
        fontFamily,
        fontSizePx: l1Px,
        weight: 800,
        color: props.textColor,
        align: 'left',
        animation: anim(Math.round(base * 1.2)),
      });
    }
    if (props.subtitle.trim()) {
      const l2LineH = clamp((l2Px * 1.3) / context.height);
      layers.push({
        kind: 'text',
        x: textX,
        y: clamp(bandTop + hB * 0.7 - l2LineH / 2),
        width: clamp(Math.min(textW / context.width + 0.05, bandW - tagW - (40 * unit) / context.width)),
        height: l2LineH,
        text: props.subtitle,
        fontFamily,
        fontSizePx: l2Px,
        weight: 500,
        color: props.textColor,
        align: 'left',
        animation: anim(Math.round(base * 1.5)),
      });
    }

    if (tag && tagW > 0) {
      // Píldora roja cápsula: punto + etiqueta. El punto pulsante queda
      // estático (alpha .7) — no hay animación continua en el modelo.
      layers.push(capsuleRect(x0, pillY, tagW, pillH, props.accentColor, 1, pillAnim, context));
      const dotD = (14 * unit) / context.height;
      const dotInk = bandLuminance(props.accentColor) > 0.6 ? '#101318' : '#ffffff';
      // El diámetro en fracción horizontal: dotD está en fracción del alto.
      layers.push(
        rect(
          x0 + (23 * unit) / context.width,
          pillY + (pillH - dotD) / 2,
          clamp((dotD * context.height) / context.width),
          dotD,
          dotInk,
          0.7,
          pillAnim,
          'ellipse',
        ),
      );
      const tagLineH = clamp((tagPx * 1.3) / context.height);
      layers.push({
        kind: 'text',
        x: clamp(x0 + (46 * unit) / context.width),
        y: clamp(pillY + (pillH - tagLineH) / 2),
        width: clamp(tagW - (52 * unit) / context.width),
        height: tagLineH,
        text: tag,
        fontFamily,
        fontSizePx: tagPx,
        weight: 800,
        color: dotInk,
        align: 'left',
        animation: pillAnim,
      });
    }
    return layers.slice(0, 16);
  },
};

/** Capa rect cápsula: misma firma que `rect` pero con `shape:'custom'`. */
function capsuleRect(
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  opacity: number,
  anim: MotionAnimation,
  context: { width: number; height: number },
): MotionRectLayer {
  const boxW = Math.max(1, Math.round(w * context.width));
  const boxH = Math.max(1, Math.round(h * context.height));
  return rect(x, y, w, h, color, opacity, anim, 'custom', capsulePoints(boxW, boxH));
}

export const solidFrameTemplate: MotionTemplate = {
  id: 'solid-frame',
  version: '1.0.0',
  label: 'Cuadro sólido',
  description: 'Fondo de color uniforme a pantalla completa (tela).',
  category: 'fondo',
  defaults: {
    color: '#ffffff',
    animation: 'none',
  },
  fields: [
    { id: 'color', label: 'Color', kind: 'color' },
    { id: 'animation', label: 'Animación', kind: 'select', options: ANIMATION_OPTIONS },
  ],
  propsSchema: solidFrameSchema,
  buildLayers(raw, context) {
    const props = raw as SolidFrameProps;
    const fps = context.fpsNum / Math.max(1, context.fpsDen);
    const anim = animation(props.animation, fps, 0.2);
    return [rect(0, 0, 1, 1, props.color, 1, anim)];
  },
};

const MOLDURA_STYLES = [
  { value: 'borde', label: 'Borde' },
  { value: 'esquinas', label: 'Esquinas' },
  { value: 'doble', label: 'Doble borde' },
] as const;

const molduraSchema = z
  .object({
    style: z.enum(['borde', 'esquinas', 'doble']).default('borde'),
    color: hexColor.default('#ffffff'),
    /** Grosor del marco como fracción del lado menor del frame. */
    thickness: z.number().min(0.002).max(0.08).default(0.008),
    /** Distancia del marco al borde del frame, misma unidad que thickness. */
    margin: z.number().min(0).max(0.2).default(0.02),
    opacity: z.number().min(0).max(1).default(0.9),
    animation: animationSchema.default('none'),
  })
  .strict();
type MolduraProps = z.infer<typeof molduraSchema>;

/**
 * Moldura decorativa alrededor del frame (equivalente funcional de
 * `molduras.js` de AlaukCut, que usa PNGs propietarios — acá son capas
 * `rect` procedurales: borde completo, corchetes de esquina o doble
 * línea). `thickness`/`margin` son fracciones del lado menor del frame.
 */
export const molduraTemplate: MotionTemplate = {
  id: 'moldura',
  version: '1.0.0',
  label: 'Moldura',
  description: 'Marco decorativo alrededor del frame (borde, esquinas o doble).',
  category: 'fondo',
  defaults: {
    style: 'borde',
    color: '#ffffff',
    thickness: 0.008,
    margin: 0.02,
    opacity: 0.9,
    animation: 'none',
  },
  fields: [
    { id: 'style', label: 'Estilo', kind: 'select', options: MOLDURA_STYLES },
    { id: 'color', label: 'Color', kind: 'color' },
    { id: 'thickness', label: 'Grosor (0–1)', kind: 'number', min: 0.002, max: 0.08 },
    { id: 'margin', label: 'Margen (0–1)', kind: 'number', min: 0, max: 0.2 },
    { id: 'opacity', label: 'Opacidad (0–1)', kind: 'number', min: 0, max: 1 },
    { id: 'animation', label: 'Animación', kind: 'select', options: ANIMATION_OPTIONS },
  ],
  propsSchema: molduraSchema,
  buildLayers(raw, context) {
    const props = raw as MolduraProps;
    const fps = context.fpsNum / Math.max(1, context.fpsDen);
    const anim = animation(props.animation, fps, 0.1);
    const minSide = Math.min(context.width, context.height);
    // Unidades de marco → fracciones del frame (x/y en fracción de w/h).
    const tPx = props.thickness * minSide;
    const tX = tPx / context.width;
    const tY = tPx / context.height;
    const bar = (fx: number, fy: number, fw: number, fh: number) =>
      rect(fx, fy, fw, fh, props.color, props.opacity, anim);
    /** Borde completo en un inset dado (unidades de lado menor). */
    const borderAt = (insetUnits: number): MotionRectLayer[] => {
      const m = (insetUnits * minSide) / context.width;
      const my = (insetUnits * minSide) / context.height;
      const iw = 1 - 2 * m;
      const ih = 1 - 2 * my;
      return [
        bar(m, my, iw, tY), // superior
        bar(m, 1 - my - tY, iw, tY), // inferior
        bar(m, my + tY, tX, ih - 2 * tY), // izquierdo
        bar(1 - m - tX, my + tY, tX, ih - 2 * tY), // derecho
      ];
    };
    if (props.style === 'esquinas') {
      // Corchetes en las 4 esquinas: tramos horizontal + vertical.
      const armPx = 0.12 * minSide;
      const armX = armPx / context.width;
      const armY = armPx / context.height;
      const m = (props.margin * minSide) / context.width;
      const my = (props.margin * minSide) / context.height;
      const right = 1 - m;
      const bottom = 1 - my;
      return [
        // sup-izquierda
        bar(m, my, armX, tY),
        bar(m, my, tX, armY),
        // sup-derecha
        bar(right - armX, my, armX, tY),
        bar(right - tX, my, tX, armY),
        // inf-izquierda
        bar(m, bottom - tY, armX, tY),
        bar(m, bottom - armY, tX, armY),
        // inf-derecha
        bar(right - armX, bottom - tY, armX, tY),
        bar(right - tX, bottom - armY, tX, armY),
      ];
    }
    if (props.style === 'doble') {
      // Borde exterior + interior separado por un grosor de aire.
      const gap = props.thickness * 3;
      return [...borderAt(props.margin), ...borderAt(props.margin + gap)];
    }
    return borderAt(props.margin);
  },
};

const faixaDegradeSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    role: line(80).default(''),
    colorFrom: hexColor.default('#101828'),
    colorTo: hexColor.default('#3b82f6'),
    animation: animationSchema.default('slide-up'),
  })
  .strict();
type FaixaDegradeProps = z.infer<typeof faixaDegradeSchema>;

/**
 * Banda de ancho completo con degradado vertical (paridad de las «bandas
 * con degradado» de `faixas.js` de AlaukCut): ASS no tiene gradientes, así
 * que la banda se apila en SLICES rects finos con color interpolado
 * `mixHex` — en preview y en export se ve el mismo degradado por pasos.
 */
export const faixaDegradeTemplate: MotionTemplate = {
  id: 'faixa-degrade',
  version: '1.0.0',
  label: 'Banda degradado',
  description: 'Banda inferior a todo lo ancho con degradado de color.',
  category: 'identidad',
  defaults: {
    name: 'Maria Fernanda Souza',
    role: 'Economista-chefe',
    colorFrom: '#101828',
    colorTo: '#3b82f6',
    animation: 'slide-up',
  },
  fields: [
    { id: 'name', label: 'Nombre', kind: 'text' },
    { id: 'role', label: 'Rol', kind: 'text' },
    { id: 'colorFrom', label: 'Color superior', kind: 'color' },
    { id: 'colorTo', label: 'Color inferior', kind: 'color' },
    { id: 'animation', label: 'Animación', kind: 'select', options: ANIMATION_OPTIONS },
  ],
  propsSchema: faixaDegradeSchema,
  buildLayers(raw, context) {
    const props = raw as FaixaDegradeProps;
    const unit = context.height / 1080;
    const fps = context.fpsNum / Math.max(1, context.fpsDen);
    const anim = animation(props.animation, fps, 0.04);
    const SLICES = 6;
    const bandX = 0;
    const bandW = 1;
    const bandH = clamp((150 * unit) / context.height, 0.06, 0.22);
    const bandY = clamp(0.86 - bandH);

    const layers: MotionLayer[] = [];
    for (let i = 0; i < SLICES; i += 1) {
      const t = i / (SLICES - 1);
      layers.push(
        rect(
          bandX,
          bandY + (bandH * i) / SLICES,
          bandW,
          bandH / SLICES + 0.0005,
          mixHex(props.colorFrom, props.colorTo, t),
          0.96,
          anim,
        ),
      );
    }

    const ink = bandLuminance(mixHex(props.colorFrom, props.colorTo, 0.5)) > 0.6
      ? '#101318'
      : '#ffffff';
    const namePx = 50 * unit;
    const rolePx = 27 * unit;
    const nameWidth = 0.9;
    const padX = 0.05;
    const nameLineH = clamp((namePx * 1.22) / context.height);
    const roleLineH = props.role ? clamp((rolePx * 1.3) / context.height) : 0;
    const blockH = nameLineH + (props.role ? roleLineH + 0.004 : 0);
    const topY = clamp(bandY + (bandH - blockH) / 2);

    layers.push(
      ...textBlock(context, {
        lines: wrapText(props.name, charsFor(context.width * nameWidth, namePx), 1),
        x: padX,
        y: topY,
        width: nameWidth,
        fontSizePx: namePx,
        weight: 800,
        color: ink,
        align: 'left',
        anim,
      }),
    );
    if (props.role) {
      layers.push(
        ...textBlock(context, {
          lines: wrapText(props.role, charsFor(context.width * nameWidth, rolePx), 1),
          x: padX,
          y: clamp(topY + nameLineH + 0.004),
          width: nameWidth,
          fontSizePx: rolePx,
          weight: 500,
          color: ink,
          align: 'left',
          anim,
        }),
      );
    }
    return layers.slice(0, 16);
  },
};


const subscribeBellSchema = z
  .object({
    label: line(24).default('SUSCRÍBETE'),
    sublabel: line(48).default('Activa la campana'),
    buttonColor: hexColor.default('#dc2626'),
    bellColor: hexColor.default('#facc15'),
    animation: animationSchema.default('pop'),
  })
  .strict();
type SubscribeBellProps = z.infer<typeof subscribeBellSchema>;

export const subscribeBellTemplate: MotionTemplate = {
  id: 'subscribe-bell',
  version: '1.0.0',
  label: 'Suscríbete + campana',
  description: 'CTA de suscripción con botón, triángulo de reproducción y campana animada.',
  category: 'identidad',
  defaults: {
    label: 'SUSCRÍBETE',
    sublabel: 'Activa la campana',
    buttonColor: '#dc2626',
    bellColor: '#facc15',
    animation: 'pop',
  },
  fields: [
    { id: 'label', label: 'Texto del botón', kind: 'text' },
    { id: 'sublabel', label: 'Texto secundario', kind: 'text' },
    { id: 'buttonColor', label: 'Color del botón', kind: 'color' },
    { id: 'bellColor', label: 'Color de campana', kind: 'color' },
    { id: 'animation', label: 'Entrada', kind: 'select', options: ANIMATION_OPTIONS },
  ],
  propsSchema: subscribeBellSchema,
  buildLayers(raw, context) {
    const props = raw as SubscribeBellProps;
    const unit = context.height / 1080;
    const fps = context.fpsNum / Math.max(1, context.fpsDen);
    const anim = animation(props.animation, fps, 0.035);
    const bellAnim = animation('back', fps, 0.02);
    const titleSize = 42 * unit;
    const subSize = 20 * unit;
    const titleLines = wrapText(
      props.label,
      charsFor(context.width * 0.34, titleSize),
      1,
    );
    const subLines = wrapText(
      props.sublabel,
      charsFor(context.width * 0.62, subSize),
      1,
    );
    const bellPoints: readonly MotionPoint[] = [
      { x: 0.5, y: 0.02 },
      { x: 0.68, y: 0.12 },
      { x: 0.73, y: 0.34 },
      { x: 0.76, y: 0.72 },
      { x: 0.9, y: 0.82 },
      { x: 0.1, y: 0.82 },
      { x: 0.24, y: 0.72 },
      { x: 0.27, y: 0.34 },
      { x: 0.32, y: 0.12 },
    ];
    return [
      rect(
        0.12, 0.39, 0.76, 0.22,
        '#101722', 0.96, anim, 'rect', undefined,
        { color: '#ffffff', width: 0.003 },
        { color: '#000000', offsetPx: 16, opacity: 0.24 },
      ),
      rect(0.16, 0.45, 0.47, 0.1, props.buttonColor, 1, anim, 'rect'),
      rect(0.19, 0.477, 0.028, 0.046, '#ffffff', 1, anim, 'triangle'),
      ...textBlock(context, {
        lines: titleLines,
        x: 0.235,
        y: 0.474,
        width: 0.37,
        fontSizePx: titleSize,
        weight: 800,
        color: '#ffffff',
        align: 'center',
        anim,
      }),
      rect(
        0.685, 0.445, 0.13, 0.13,
        props.bellColor, 0.06, bellAnim, 'ellipse',
        undefined, { color: props.bellColor, width: 0.012 },
      ),
      rect(
        0.72, 0.455, 0.06, 0.09,
        props.bellColor, 1, bellAnim, 'custom', bellPoints,
      ),
      rect(0.742, 0.54, 0.016, 0.016, props.bellColor, 1, bellAnim, 'ellipse'),
      ...textBlock(context, {
        lines: subLines,
        x: 0.18,
        y: 0.565,
        width: 0.64,
        fontSizePx: subSize,
        weight: 600,
        color: props.bellColor,
        align: 'center',
        anim: animation('fade', fps),
      }),
    ].slice(0, 16);
  },
};

export const MOTION_TEMPLATES: readonly MotionTemplate[] = [
  titleCardTemplate,
  freeTextTemplate,
  lowerThirdTemplate,
  endCardTemplate,
  statCalloutTemplate,
  lowerThirdMinimalTemplate,
  cinemaBarsTemplate,
  zoomPunchTemplate,
  glitchTextTemplate,
  cinematicTitleTemplate,
  badgeTemplate,
  shapeTemplate,
  contornoTemplate,
  faixaLetreiroTemplate,
  faixaLimpoTemplate,
  faixaJornalTemplate,
  faixaCidadeTemplate,
  faixaEsporteTemplate,
  faixaAovivoTemplate,
  faixaPlantaoTemplate,
  faixaDegradeTemplate,
  faixaNomeTemplate,
  solidFrameTemplate,
  molduraTemplate,
  subscribeBellTemplate,
];

export function templateById(id: string): MotionTemplate | null {
  return MOTION_TEMPLATES.find((template) => template.id === id) ?? null;
}
