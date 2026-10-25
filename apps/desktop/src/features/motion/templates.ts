import { z } from 'zod';

export const MOTION_ANIMATIONS = ['none', 'fade', 'slide-up', 'slide-left', 'pop'] as const;
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
}

export interface MotionRectLayer {
  readonly kind: 'rect';
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly color: string;
  readonly opacity: number;
  readonly animation: MotionAnimation;
}

export type MotionLayer = MotionTextLayer | MotionRectLayer;

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
  readonly kind: 'text' | 'textarea' | 'color' | 'select' | 'number';
  readonly options?: readonly { readonly value: string; readonly label: string }[];
  readonly min?: number;
  readonly max?: number;
}

export interface MotionTemplate {
  readonly id: string;
  readonly version: string;
  readonly label: string;
  readonly description: string;
  readonly category: 'título' | 'identidad' | 'cierre' | 'dato';
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
  const base = Math.max(4, Math.round(fps * 0.4));
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
): MotionRectLayer {
  return {
    kind: 'rect',
    x: clamp(x),
    y: clamp(y),
    width: clamp(width),
    height: clamp(height),
    color,
    opacity: clamp(opacity),
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

export const MOTION_TEMPLATES: readonly MotionTemplate[] = [
  titleCardTemplate,
  freeTextTemplate,
  lowerThirdTemplate,
  endCardTemplate,
  statCalloutTemplate,
];

export function templateById(id: string): MotionTemplate | null {
  return MOTION_TEMPLATES.find((template) => template.id === id) ?? null;
}
