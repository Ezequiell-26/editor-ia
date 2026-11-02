/**
 * Colocación inteligente de imágenes sobre una narración.
 *
 * El problema real del montaje automático no es cortar: es decidir **qué foto
 * va en cada frase**. Emparejar por nombre de archivo o por orden de carpeta
 * produce videos donde la imagen contradice lo que se dice.
 *
 * Este módulo combina dos cosas:
 *
 * 1. Un perfil visual por imagen (`ImageContent`), medido localmente en Rust.
 * 2. Un léxico español que traduce lo que dice la frase a atributos visuales
 *    ("atardecer" → cálido y luminoso; "multitud" → mucha gente y textura).
 *
 * El planificador aplica además reglas de montaje: no repetir la misma imagen
 * seguida, evitar dos fotos casi idénticas consecutivas, repartir el material
 * y abrir con un plano amplio. Todo es determinista y explicable: cada decisión
 * devuelve su motivo.
 */

import type { ImageContent } from '../services/project-service';

export type { ImageContent } from '../services/project-service';
export type ImageOrientation = ImageContent['orientation'];
export type ImageTemperature = ImageContent['temperature'];

/**
 * Atributos normalizados 0–1. Son la moneda común entre el texto y la imagen:
 * el léxico produce un perfil deseado y la imagen aporta el suyo.
 */
export interface VisualTraits {
  readonly bright: number;
  readonly dark: number;
  readonly vivid: number;
  readonly detailed: number;
  readonly wide: number;
  readonly tall: number;
  readonly people: number;
  readonly exterior: number;
  readonly warm: number;
  readonly cool: number;
}

export const TRAIT_KEYS = [
  'bright',
  'dark',
  'vivid',
  'detailed',
  'wide',
  'tall',
  'people',
  'exterior',
  'warm',
  'cool',
] as const;

const EMPTY_TRAITS: VisualTraits = {
  bright: 0,
  dark: 0,
  vivid: 0,
  detailed: 0,
  wide: 0,
  tall: 0,
  people: 0,
  exterior: 0,
  warm: 0,
  cool: 0,
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Luminancia media 0–255 → 0–1. 128 se considera el punto medio. */
export function brightnessOf(lumaMean: number): number {
  return clamp01(lumaMean / 255);
}

export function deriveTraits(content: ImageContent): VisualTraits {
  const brightness = brightnessOf(content.lumaMean);
  const vivid = clamp01(content.colorfulness / 55);
  const detailed = clamp01(content.edgeDensity / 0.42);
  const wide = content.orientation === 'landscape' ? 1 : content.orientation === 'square' ? 0.4 : 0;
  const tall = content.orientation === 'portrait' ? 1 : content.orientation === 'square' ? 0.4 : 0;
  const people = content.faceCount > 0 ? clamp01(0.55 + (content.faceSize ?? 0.2)) : 0;
  const exterior = clamp01(Math.max(0, content.skyBias) * 1.6);
  const warm = content.temperature === 'warm' ? clamp01(0.55 + content.hueConcentration * 0.45) : 0;
  const cool = content.temperature === 'cool' ? clamp01(0.55 + content.hueConcentration * 0.45) : 0;
  return {
    bright: clamp01((brightness - 0.35) / 0.55),
    dark: clamp01((0.62 - brightness) / 0.5),
    vivid,
    detailed,
    wide,
    tall,
    people,
    exterior,
    warm,
    cool,
  };
}

/**
 * Léxico de intención visual. Cada término empuja el perfil deseado hacia
 * ciertos atributos. Los pesos son deliberadamente conservadores: una palabra
 * suelta no debería dominar el montaje.
 */
const LEXICON: Readonly<Record<string, Partial<VisualTraits>>> = {
  // Luz y momento del día
  noche: { dark: 1 },
  nocturno: { dark: 1 },
  oscuro: { dark: 0.9 },
  oscuridad: { dark: 1 },
  sombra: { dark: 0.6 },
  penumbra: { dark: 0.8 },
  madrugada: { dark: 0.8, cool: 0.4 },
  medianoche: { dark: 1 },
  amanecer: { bright: 0.6, warm: 0.8 },
  atardecer: { bright: 0.5, warm: 1 },
  ocaso: { bright: 0.4, warm: 1 },
  anochecer: { dark: 0.5, warm: 0.6 },
  sol: { bright: 0.9, warm: 0.4, exterior: 0.6 },
  soleado: { bright: 1, exterior: 0.7 },
  luz: { bright: 0.8 },
  luminoso: { bright: 1 },
  brillante: { bright: 0.9 },
  claro: { bright: 0.7 },
  mediodía: { bright: 0.9, exterior: 0.5 },
  día: { bright: 0.7, exterior: 0.5 },

  // Temperatura y estación
  cálido: { warm: 1 },
  caliente: { warm: 0.8 },
  fuego: { warm: 0.9, dark: 0.4 },
  verano: { warm: 0.7, bright: 0.6 },
  desierto: { warm: 0.8, bright: 0.7, wide: 0.6 },
  dorado: { warm: 0.8, bright: 0.4 },
  ámbar: { warm: 0.7 },
  naranja: { warm: 0.7, vivid: 0.5 },
  frío: { cool: 1 },
  fría: { cool: 1 },
  invierno: { cool: 0.8, bright: 0.5 },
  nieve: { cool: 0.7, bright: 0.9 },
  hielo: { cool: 0.8, bright: 0.7 },
  lluvia: { cool: 0.6, dark: 0.4 },
  azul: { cool: 0.8, vivid: 0.4 },

  // Color y energía
  color: { vivid: 0.7 },
  colorido: { vivid: 1 },
  colores: { vivid: 0.8 },
  vivo: { vivid: 0.7 },
  vibrante: { vivid: 0.9 },
  fiesta: { vivid: 0.9, people: 0.6 },
  carnaval: { vivid: 1, people: 0.7 },
  alegre: { vivid: 0.6, bright: 0.4 },
  celebración: { vivid: 0.7, people: 0.6 },

  // Textura y detalle
  ciudad: { detailed: 0.9, wide: 0.4 },
  edificio: { detailed: 0.7, tall: 0.4 },
  edificios: { detailed: 0.8, wide: 0.4 },
  calle: { detailed: 0.7, exterior: 0.6 },
  calles: { detailed: 0.7, exterior: 0.6 },
  bosque: { detailed: 0.9 },
  árbol: { detailed: 0.6 },
  árboles: { detailed: 0.8 },
  textura: { detailed: 0.8 },
  detalle: { detailed: 0.7 },
  detalles: { detailed: 0.7 },
  multitud: { detailed: 0.7, people: 1 },
  mercado: { detailed: 0.9, people: 0.6, vivid: 0.5 },
  fábrica: { detailed: 0.8 },
  máquina: { detailed: 0.6 },

  // Escala y paisaje
  paisaje: { wide: 1, exterior: 0.8 },
  panorama: { wide: 1, exterior: 0.8 },
  panorámica: { wide: 1, exterior: 0.8 },
  horizonte: { wide: 0.9, exterior: 0.7 },
  montaña: { wide: 0.8, exterior: 0.8 },
  montañas: { wide: 0.8, exterior: 0.8 },
  mar: { wide: 0.7, exterior: 0.7, cool: 0.5 },
  océano: { wide: 0.8, exterior: 0.8, cool: 0.5 },
  playa: { wide: 0.7, exterior: 0.8, bright: 0.6 },
  campo: { wide: 0.8, exterior: 0.9 },
  cielo: { exterior: 0.9, bright: 0.5 },
  vista: { wide: 0.7, exterior: 0.6 },
  amplio: { wide: 0.7 },
  vasto: { wide: 0.9 },
  inmensidad: { wide: 0.9 },

  // Personas
  persona: { people: 1, tall: 0.4 },
  personas: { people: 1 },
  gente: { people: 1 },
  hombre: { people: 1, tall: 0.6 },
  mujer: { people: 1, tall: 0.6 },
  niño: { people: 1, tall: 0.5 },
  niña: { people: 1, tall: 0.5 },
  niños: { people: 1 },
  familia: { people: 1, warm: 0.3 },
  amigos: { people: 1, vivid: 0.3 },
  equipo: { people: 0.8 },
  público: { people: 1, detailed: 0.5 },
  rostro: { people: 1, tall: 0.8 },
  cara: { people: 1, tall: 0.7 },
  retrato: { people: 1, tall: 0.9 },
  manos: { people: 0.8, detailed: 0.4 },
  alguien: { people: 1 },
  protagonista: { people: 1, tall: 0.7 },
  // Pronombres y verbos de acción humana: una narración dice "ella" o "habla"
  // mucho más seguido que "persona", y sin esto la frase queda sin pistas.
  ella: { people: 0.9 },
  ellas: { people: 0.9 },
  ellos: { people: 0.9 },
  nosotros: { people: 0.8 },
  nosotras: { people: 0.8 },
  mira: { people: 0.7, tall: 0.3 },
  habla: { people: 0.7 },
  sonríe: { people: 0.9, bright: 0.3 },
  sonrie: { people: 0.9, bright: 0.3 },
  camina: { people: 0.7, exterior: 0.4 },

  // Interior / exterior
  exterior: { exterior: 0.9, wide: 0.5 },
  afuera: { exterior: 0.9 },
  interior: { exterior: 0, dark: 0.2 },
  casa: { exterior: 0.2 },
  oficina: { detailed: 0.5, exterior: 0 },
};

const ACCENT_MARKS = /[\u0300-\u036f]/g;

/** Minúsculas, sin acentos y sin puntuación: la clave del léxico. */
export function normalizeToken(value: string): string {
  return value
    .normalize('NFD')
    .replace(ACCENT_MARKS, '')
    .toLowerCase()
    .replace(/[^a-z0-9ñü]+/g, ' ')
    .trim();
}

/** Perfil visual que pide el texto de una frase. */
export function desiredTraits(sentence: string): Partial<VisualTraits> {
  const normalized = normalizeToken(sentence);
  if (!normalized) return {};
  const tokens = normalized.split(' ').filter(Boolean);
  const desired: Record<string, number> = {};
  for (const token of tokens) {
    const entry = LEXICON[token];
    if (!entry) continue;
    for (const key of TRAIT_KEYS) {
      const weight = entry[key];
      if (!weight) continue;
      desired[key] = (desired[key] ?? 0) + weight;
    }
  }
  // Un atributo repetido en la frase no debería valer el doble que otro.
  const result: Record<string, number> = {};
  for (const [key, value] of Object.entries(desired)) {
    result[key] = Math.min(1, value);
  }
  return result as Partial<VisualTraits>;
}

export interface ImageScore {
  readonly score: number;
  readonly reasons: readonly string[];
}

const TRAIT_LABELS: Readonly<Record<(typeof TRAIT_KEYS)[number], string>> = {
  bright: 'luminosa',
  dark: 'oscura',
  vivid: 'colorida',
  detailed: 'detallada',
  wide: 'amplia',
  tall: 'vertical',
  people: 'con personas',
  exterior: 'de exterior',
  warm: 'cálida',
  cool: 'fría',
};

/**
 * Puntúa qué tan bien encaja una imagen con una frase. Devuelve 0 cuando el
 * texto no aporta ninguna pista visual: en ese caso decide la estructura del
 * montaje, no una coincidencia inventada.
 */
export function scoreImage(sentence: string, traits: VisualTraits): ImageScore {
  const desired = desiredTraits(sentence);
  const entries = TRAIT_KEYS.filter((key) => (desired[key] ?? 0) > 0);
  if (entries.length === 0) return { score: 0, reasons: [] };

  let desiredNorm = 0;
  for (const key of entries) desiredNorm += (desired[key] ?? 0) ** 2;
  desiredNorm = Math.sqrt(desiredNorm);
  if (desiredNorm <= 0) return { score: 0, reasons: [] };

  const reasons: string[] = [];
  let dot = 0;
  let imageNorm = 0;
  for (const key of TRAIT_KEYS) {
    imageNorm += traits[key] ** 2;
  }
  imageNorm = Math.sqrt(imageNorm) || 1;
  for (const key of entries) {
    const weight = desired[key] ?? 0;
    dot += weight * traits[key];
    if (traits[key] >= 0.5 && weight >= 0.5) {
      reasons.push(TRAIT_LABELS[key]);
    }
  }
  // Coseno entre el perfil pedido y el de la imagen, normalizado a 0–1.
  const score = clamp01(dot / (desiredNorm * imageNorm));
  return { score, reasons };
}

function traitSimilarity(a: VisualTraits, b: VisualTraits): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const key of TRAIT_KEYS) {
    dot += a[key] * b[key];
    na += a[key] ** 2;
    nb += b[key] ** 2;
  }
  const denominator = Math.sqrt(na) * Math.sqrt(nb);
  if (denominator <= 0) return 0;
  return dot / denominator;
}

export interface ImageAssignment {
  /** Índice dentro del arreglo de imágenes recibido. */
  readonly imageIndex: number;
  readonly score: number;
  readonly reasons: readonly string[];
}

export interface PlanOptions {
  /** Si es true, la primera frase prefiere un plano amplio de exterior. */
  readonly openWithWide?: boolean;
  /** Penalización por reutilizar una imagen, por uso previo. */
  readonly reusePenalty?: number;
  /** Similitud por encima de la cual dos fotos se consideran casi iguales. */
  readonly duplicateThreshold?: number;
}

const DEFAULTS = {
  openWithWide: true,
  reusePenalty: 0.85,
  duplicateThreshold: 0.93,
} as const;

/**
 * Asigna una imagen a cada frase.
 *
 * Reglas, en orden de prioridad:
 * 1. Con dos o más imágenes, nunca se repite la anterior de forma inmediata.
 * 2. Dos fotos casi idénticas seguidas reciben penalización: se lee como un
 *    salto accidental.
 * 3. Cada uso previo encarece la imagen, así el material se reparte en vez de
 *    agotarse en los primeros planos.
 * 4. La primera frase, si hay material amplio, abre con un plano general.
 */
export function planImageAssignments(
  sentences: readonly string[],
  contents: readonly ImageContent[],
  options: PlanOptions = {},
): ImageAssignment[] {
  if (sentences.length === 0 || contents.length === 0) return [];
  const openWithWide = options.openWithWide ?? DEFAULTS.openWithWide;
  const reusePenalty = options.reusePenalty ?? DEFAULTS.reusePenalty;
  const duplicateThreshold = options.duplicateThreshold ?? DEFAULTS.duplicateThreshold;

  const traits = contents.map(deriveTraits);
  const usage = new Array<number>(contents.length).fill(0);
  const assignments: ImageAssignment[] = [];
  let previous = -1;

  for (let index = 0; index < sentences.length; index += 1) {
    const sentence = sentences[index] ?? '';
    let bestIndex = 0;
    let bestScore = -Infinity;
    let bestReasons: readonly string[] = [];

    for (let candidate = 0; candidate < contents.length; candidate += 1) {
      // Regla 1: con alternativa disponible no se repite la anterior.
      if (contents.length > 1 && candidate === previous) continue;
      const trait = traits[candidate]!;
      const scored = scoreImage(sentence, trait);
      let score = scored.score;
      const reasons: string[] = [...scored.reasons];

      // Regla 2: dos fotos casi iguales seguidas.
      if (previous >= 0 && traitSimilarity(traits[previous]!, trait) > duplicateThreshold) {
        score -= 0.35;
        reasons.push('parecida a la anterior');
      }

      // Regla 3: reparto del material.
      score -= usage[candidate]! * reusePenalty;

      // Regla 4: apertura con plano general.
      if (index === 0 && openWithWide) {
        score += trait.wide * 0.45 + trait.exterior * 0.3;
      }

      if (score > bestScore + 1e-9) {
        bestScore = score;
        bestIndex = candidate;
        bestReasons = reasons;
      }
    }

    usage[bestIndex] = (usage[bestIndex] ?? 0) + 1;
    previous = bestIndex;
    assignments.push({
      imageIndex: bestIndex,
      score: Math.round(bestScore * 1000) / 1000,
      reasons: bestReasons,
    });
  }

  return assignments;
}

/** Descripción breve y legible del contenido, para la interfaz y para la IA. */
export function describeImage(content: ImageContent): string {
  const parts: string[] = [];
  if (content.lumaMean < 70) parts.push('muy oscura');
  else if (content.lumaMean < 110) parts.push('oscura');
  else if (content.lumaMean > 205) parts.push('muy luminosa');
  else if (content.lumaMean > 165) parts.push('luminosa');

  if (content.temperature === 'warm') parts.push('cálida');
  else if (content.temperature === 'cool') parts.push('fría');

  if (content.colorfulness > 45) parts.push('colores vivos');
  else if (content.colorfulness < 12) parts.push('casi monocroma');

  if (content.edgeDensity > 0.35) parts.push('muy detallada');
  else if (content.edgeDensity < 0.08) parts.push('fondo simple');

  if (content.orientation === 'portrait') parts.push('vertical');
  else if (content.orientation === 'landscape') parts.push('horizontal');

  if (content.faceCount > 0) parts.push('con una persona');
  if (content.skyBias > 0.25) parts.push('con cielo amplio');

  if (parts.length === 0) return 'sin rasgos marcados';
  return parts.join(', ');
}

/**
 * Convierte el contenido medido en texto para el modelo de lenguaje. Así el
 * emparejamiento deja de depender del nombre del archivo.
 */
export function describeForPrompt(content: ImageContent): string {
  const bits = [describeImage(content)];
  if (content.palette.length > 0) bits.push(`paleta ${content.palette.slice(0, 2).join(' ')}`);
  if (content.sharpness < 0.12) bits.push('poco nítida');
  return bits.join('; ');
}
