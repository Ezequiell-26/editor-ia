// Neutral motion catalog shared by the MCP server. The editor remains the
// authority for rendering; this module only creates and validates plans.

export const VERSION = '1.0.0';
export const ANIMATIONS = ['none', 'fade', 'slide-up', 'slide-left', 'pop'];
const ANIMATION_OPTIONS = [
  { value: 'none', label: 'Sin animación' },
  { value: 'fade', label: 'Aparecer' },
  { value: 'slide-up', label: 'Subir' },
  { value: 'slide-left', label: 'Deslizar' },
  { value: 'pop', label: 'Pop' },
];

const TEMPLATES = {
  'title-card': {
    label: 'Título de apertura',
    description: 'Cartela principal con fondo, acento y subtítulo.',
    category: 'título',
    defaults: {
      title: 'Tu próxima historia',
      subtitle: 'Editor IA',
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
      { id: 'align', label: 'Alineación', kind: 'select', options: [
        { value: 'left', label: 'Izquierda' },
        { value: 'center', label: 'Centro' },
      ] },
      { id: 'animation', label: 'Animación', kind: 'select', options: ANIMATION_OPTIONS },
    ],
  },
  'lower-third': {
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
      { id: 'side', label: 'Lado', kind: 'select', options: [
        { value: 'left', label: 'Izquierda' },
        { value: 'right', label: 'Derecha' },
      ] },
      { id: 'animation', label: 'Animación', kind: 'select', options: ANIMATION_OPTIONS },
    ],
  },
  'end-card': {
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
  },
  'stat-callout': {
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
  },
};

const COLOR = /^#[0-9a-fA-F]{6}$/;
const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));

function text(value, max, fallback = '') {
  const cleaned = String(value ?? fallback).trim().slice(0, max);
  return cleaned || fallback;
}

function color(value, fallback) {
  return COLOR.test(String(value ?? '')) ? String(value) : fallback;
}

function oneOf(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function wrap(value, maxChars, maxLines = 6) {
  const normalized = String(value ?? '').replace(/\r\n?/g, '\n').trim().slice(0, 500);
  if (!normalized) return [];
  const lines = [];
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
  if (lines.length > maxLines) {
    limited[maxLines - 1] = `${limited[maxLines - 1].slice(0, Math.max(1, maxChars - 1))}…`;
  }
  return limited;
}

function animation(kind, fps, distance = 0.05) {
  if (kind === 'none') return { kind };
  return {
    kind,
    inFrames: Math.max(4, Math.round(fps * 0.4)),
    outFrames: Math.max(3, Math.round(fps * 0.3)),
    ...(kind === 'slide-up' || kind === 'slide-left' ? { distance } : {}),
  };
}

function textLayers(context, input) {
  const lineHeight = (input.fontSizePx * 1.25) / context.height;
  return input.lines.map((lineText, index) => ({
    kind: 'text',
    x: clamp(input.x),
    y: clamp(input.y + index * lineHeight),
    width: clamp(input.width),
    height: clamp(lineHeight),
    text: lineText,
    fontFamily: 'Segoe UI',
    fontSizePx: input.fontSizePx,
    weight: input.weight ?? 500,
    color: input.color,
    align: input.align,
    animation: input.anim,
  }));
}

function rect(x, y, width, height, rectColor, opacity, anim) {
  return { kind: 'rect', x: clamp(x), y: clamp(y), width: clamp(width), height: clamp(height), color: rectColor, opacity: clamp(opacity), animation: anim };
}

function charsFor(widthPx, fontSizePx) {
  return Math.max(8, Math.floor(widthPx / Math.max(1, fontSizePx * 0.55)));
}

export function listTemplates() {
  return Object.entries(TEMPLATES).map(([id, template]) => ({
    id,
    version: VERSION,
    label: template.label,
    description: template.description,
    category: template.category,
    defaults: template.defaults,
    fields: template.fields,
  }));
}

export function buildPlan(templateId, rawProps, rawContext = {}) {
  const template = TEMPLATES[templateId];
  if (!template) throw new Error(`plantilla ${templateId} desconocida`);
  const context = {
    width: Number(rawContext.width) || 1920,
    height: Number(rawContext.height) || 1080,
    fps: Number(rawContext.fps) || 30,
    durationFrames: Math.max(1, Math.round(Number(rawContext.durationFrames) || 90)),
  };
  const props = rawProps && typeof rawProps === 'object' ? rawProps : {};
  const unit = context.height / 1080;
  let layers;

  if (templateId === 'title-card') {
    const title = text(props.title, 120);
    if (!title) throw new Error('title es obligatorio');
    const size = 92 * unit;
    const anim = animation(oneOf(props.animation, ANIMATIONS, 'slide-up'), context.fps, 0.05);
    const titleLines = wrap(title, charsFor(context.width * 0.84, size));
    const subtitle = text(props.subtitle, 100);
    const subtitleLines = wrap(subtitle, charsFor(context.width * 0.84, 38 * unit), 2);
    const titleY = 0.44;
    const subtitleY = titleY + titleLines.length * ((size * 1.25) / context.height) + 0.015;
    layers = [
      rect(0, 0, 1, 1, color(props.background, '#0f172a'), 0.94, anim),
      rect(0.08, 0.4, 0.12, 0.008, color(props.accent, '#7dd3c0'), 1, anim),
      ...textLayers(context, {
        lines: titleLines, x: 0.08, y: titleY, width: 0.84, fontSizePx: size,
        weight: 700, color: '#ffffff', align: oneOf(props.align, ['left', 'center'], 'left'), anim,
      }),
      ...textLayers(context, {
        lines: subtitleLines, x: 0.08, y: subtitleY, width: 0.84, fontSizePx: 38 * unit,
        weight: 500, color: '#cbd5e1', align: oneOf(props.align, ['left', 'center'], 'left'), anim,
      }),
    ];
  } else if (templateId === 'lower-third') {
    const name = text(props.name, 80);
    if (!name) throw new Error('name es obligatorio');
    const side = oneOf(props.side, ['left', 'right'], 'left');
    const place = (x, width) => (side === 'right' ? 1 - x - width : x);
    const size = 56 * unit;
    const anim = animation(oneOf(props.animation, ANIMATIONS, 'slide-left'), context.fps, 0.045);
    const nameLines = wrap(name, charsFor(context.width * 0.52, size), 2);
    const role = text(props.role, 80);
    const roleLines = role ? wrap(role, charsFor(context.width * 0.52, 28 * unit), 1) : [];
    const roleY = 0.69 + nameLines.length * ((size * 1.25) / context.height) + 0.012;
    layers = [
      rect(place(0.06, 0.6), 0.66, 0.6, 0.2, '#0f172a', 0.9, anim),
      rect(place(0.06, 0.012), 0.66, 0.012, 0.2, color(props.accent, '#7dd3c0'), 1, anim),
      ...textLayers(context, {
        lines: nameLines, x: place(0.1, 0.52), y: 0.69, width: 0.52, fontSizePx: size,
        weight: 700, color: '#ffffff', align: 'left', anim,
      }),
      ...textLayers(context, {
        lines: roleLines, x: place(0.1, 0.52), y: roleY, width: 0.52, fontSizePx: 28 * unit,
        weight: 500, color: '#cbd5e1', align: 'left', anim,
      }),
    ];
  } else if (templateId === 'end-card') {
    const title = text(props.title, 120);
    if (!title) throw new Error('title es obligatorio');
    const size = 84 * unit;
    const anim = animation(oneOf(props.animation, ANIMATIONS, 'fade'), context.fps, 0.04);
    const titleLines = wrap(title, charsFor(context.width * 0.76, size), 3);
    const cta = text(props.cta, 100);
    const ctaLines = wrap(cta, charsFor(context.width * 0.76, 36 * unit), 2);
    layers = [
      rect(0, 0, 1, 1, color(props.background, '#0f172a'), 0.96, anim),
      rect(0.12, 0.33, 0.12, 0.008, color(props.accent, '#7dd3c0'), 1, anim),
      ...textLayers(context, {
        lines: titleLines, x: 0.12, y: 0.38, width: 0.76, fontSizePx: size,
        weight: 700, color: '#ffffff', align: 'center', anim,
      }),
      ...textLayers(context, {
        lines: ctaLines, x: 0.12, y: 0.64, width: 0.76, fontSizePx: 36 * unit,
        weight: 500, color: color(props.accent, '#7dd3c0'), align: 'center', anim,
      }),
    ];
  } else {
    const value = text(props.value, 20);
    const label = text(props.label, 60);
    if (!value || !label) throw new Error('value y label son obligatorios');
    const anim = animation(oneOf(props.animation, ANIMATIONS, 'pop'), context.fps, 0.04);
    layers = [
      rect(0.08, 0.28, 0.44, 0.4, '#0f172a', 0.88, anim),
      rect(0.08, 0.28, 0.008, 0.4, color(props.accent, '#7dd3c0'), 1, anim),
      ...textLayers(context, {
        lines: wrap(value, 12, 1), x: 0.12, y: 0.33, width: 0.36, fontSizePx: 110 * unit,
        weight: 700, color: color(props.accent, '#7dd3c0'), align: 'left', anim,
      }),
      ...textLayers(context, {
        lines: wrap(label, 28, 2), x: 0.12, y: 0.62, width: 0.36, fontSizePx: 30 * unit,
        weight: 500, color: '#e2e8f0', align: 'left', anim,
      }),
    ];
  }

  return {
    version: 1,
    templateId,
    width: context.width,
    height: context.height,
    fps: { num: Math.round(context.fps * 1000), den: 1000 },
    durationFrames: context.durationFrames,
    layers: layers.slice(0, 16),
  };
}

export function validatePlan(plan) {
  const errors = [];
  if (!plan || typeof plan !== 'object') return ['plan debe ser un objeto'];
  if (plan.version !== 1) errors.push('version debe ser 1');
  if (!Array.isArray(plan.layers) || plan.layers.length < 1 || plan.layers.length > 16) {
    errors.push('layers debe tener entre 1 y 16 capas');
    return errors;
  }
  const unitKeys = ['x', 'y', 'width', 'height'];
  for (const [index, layer] of plan.layers.entries()) {
    if (!layer || typeof layer !== 'object') {
      errors.push(`layers[${index}] no es un objeto`);
      continue;
    }
    if (!['text', 'rect'].includes(layer.kind)) errors.push(`layers[${index}].kind inválido`);
    for (const key of unitKeys) {
      const value = layer[key];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
        errors.push(`layers[${index}].${key} debe estar entre 0 y 1`);
      }
    }
    if (typeof layer.color !== 'string' || !COLOR.test(layer.color)) {
      errors.push(`layers[${index}].color inválido`);
    }
    if (layer.kind === 'text') {
      if (typeof layer.text !== 'string' || layer.text.length > 500) {
        errors.push(`layers[${index}].text inválido`);
      }
      if (!Number.isFinite(layer.fontSizePx) || layer.fontSizePx < 4 || layer.fontSizePx > 400) {
        errors.push(`layers[${index}].fontSizePx inválido`);
      }
    }
    if (layer.kind === 'rect' && (!Number.isFinite(layer.opacity) || layer.opacity < 0 || layer.opacity > 1)) {
      errors.push(`layers[${index}].opacity inválido`);
    }
    if (layer.animation && !ANIMATIONS.includes(layer.animation.kind)) {
      errors.push(`layers[${index}].animation.kind inválido`);
    }
  }
  return errors;
}
