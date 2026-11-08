import {
  createInstance,
  effectRegistry,
  type EffectInstance,
  type EffectStack,
} from '@editor-ia/effect-kit';
import type { EffectTemplate, EffectTemplateKind } from './effect-templates';

/**
 * Plantillas de fábrica del stack de efectos.
 *
 * Cierra la brecha declarada en `docs/DRIFT-PARITY.md` §5: Drift trae ~23
 * presets de fábrica y Olyvia sólo tenía plantillas del usuario. Estas
 * entradas son datos, no instancias persistidas: se resuelven contra el
 * registro en cada llamada y `stackFromTemplate` las trata igual que a las
 * del usuario (ids nuevos, params normalizados, desconocidos fuera).
 *
 * Si un `effectId` deja de existir en el catálogo, la plantilla entera se
 * omite en vez de aplicarse a medias: una receta a medias no es la receta.
 */

interface BuiltinEffectSpec {
  readonly effectId: string;
  readonly params?: Readonly<Record<string, unknown>>;
}

interface BuiltinTemplateDef {
  readonly id: string;
  readonly name: string;
  readonly kind: EffectTemplateKind;
  readonly effects: readonly BuiltinEffectSpec[];
}

const VIDEO_TEMPLATES: readonly BuiltinTemplateDef[] = [
  {
    id: 'look-cine',
    name: 'Look cine',
    kind: 'video',
    effects: [
      { effectId: 'color.saturation', params: { saturation: 0.85 } },
      { effectId: 'color.contrast', params: { contrast: 1.08 } },
      { effectId: 'color.temperature', params: { kelvin: 5600, tint: -0.04 } },
      { effectId: 'light.vignette', params: { angle: 0.55 } },
    ],
  },
  {
    id: 'blanco-y-negro',
    name: 'Blanco y negro',
    kind: 'video',
    effects: [
      { effectId: 'retro.grayscale', params: { amount: 1, tint: '#dfe6ee' } },
      { effectId: 'retro.grain', params: { amount: 14 } },
    ],
  },
  {
    id: 'super-8',
    name: 'Súper 8',
    kind: 'video',
    effects: [{ effectId: 'retro.super8' }],
  },
  {
    id: 'vhs',
    name: 'VHS',
    kind: 'video',
    effects: [
      { effectId: 'retro.vhs', params: { amount: 0.55, noise: 0.25, tracking: 0.3 } },
    ],
  },
  {
    id: 'vintage-sepia',
    name: 'Vintage sepia',
    kind: 'video',
    effects: [
      { effectId: 'retro.sepia', params: { amount: 0.8 } },
      { effectId: 'retro.grain', params: { amount: 18 } },
    ],
  },
  {
    id: 'enfoque-dulce',
    name: 'Enfoque suave',
    kind: 'video',
    effects: [
      { effectId: 'blur.tilt_shift', params: { focus: 0.45, band: 0.3, radius: 10 } },
      { effectId: 'stylize.sharpen', params: { amount: 0.8 } },
    ],
  },
  {
    id: 'destello-dorado',
    name: 'Destello dorado',
    kind: 'video',
    effects: [
      {
        effectId: 'light.flare',
        params: { position: [0.72, 0.28], size: 0.16, intensity: 0.45, tint: '#ffd9a0' },
      },
    ],
  },
  {
    id: 'fuga-calida',
    name: 'Fuga de luz cálida',
    kind: 'video',
    effects: [
      { effectId: 'light.leak', params: { amount: 0.5, tint: '#ff9a4d', speed: 0.25 } },
    ],
  },
  {
    id: 'bloom-cine',
    name: 'Bloom cine',
    kind: 'video',
    effects: [
      { effectId: 'light.bloom', params: { threshold: 0.7, radius: 14, intensity: 0.5 } },
    ],
  },
  {
    id: 'zoom-punch',
    name: 'Zoom punch',
    kind: 'video',
    effects: [{ effectId: 'impact.zoom_pulse', params: { amount: 0.1, rate: 2 } }],
  },
  {
    id: 'found-footage',
    name: 'Found footage',
    kind: 'video',
    effects: [
      { effectId: 'retro.vhs', params: { amount: 0.4, noise: 0.2 } },
      { effectId: 'impact.shake', params: { amount: 5, speed: 6 } },
      { effectId: 'retro.grain', params: { amount: 12 } },
    ],
  },
  {
    id: 'pixel-art',
    name: 'Pixel art',
    kind: 'video',
    effects: [
      { effectId: 'stylize.pixelate', params: { size: 14 } },
      { effectId: 'retro.super8', params: { amount: 0.4 } },
    ],
  },
];

const AUDIO_TEMPLATES: readonly BuiltinTemplateDef[] = [
  {
    id: 'voz-limpia',
    name: 'Voz limpia',
    kind: 'audio',
    effects: [
      {
        effectId: 'audio.compressor',
        params: { threshold: -20, ratio: 4, attack: 8, release: 150, makeup: 2 },
      },
      { effectId: 'audio.eq', params: { low: 1.5, high: 1 } },
      { effectId: 'audio.deesser', params: { intensity: 0.5 } },
    ],
  },
  {
    id: 'podcast',
    name: 'Podcast',
    kind: 'audio',
    effects: [
      {
        effectId: 'audio.compressor',
        params: { threshold: -18, ratio: 3.5, attack: 10, release: 180, makeup: 1 },
      },
      { effectId: 'audio.eq', params: { low: 0.5, high: 1.5, highFreq: 9000 } },
      { effectId: 'audio.gate', params: { threshold: 0.04 } },
    ],
  },
  {
    id: 'nivel-maestro',
    name: 'Nivel maestro',
    kind: 'audio',
    effects: [
      { effectId: 'audio.leveler' },
      {
        effectId: 'audio.compressor',
        params: { threshold: -16, ratio: 2.5, attack: 15, release: 200 },
      },
      { effectId: 'audio.limiter', params: { limit: 0.89 } },
    ],
  },
  {
    id: 'radio-antigua',
    name: 'Radio antigua',
    kind: 'audio',
    effects: [{ effectId: 'audio.telephone' }],
  },
  {
    id: 'walkie',
    name: 'Walkie-talkie',
    kind: 'audio',
    effects: [{ effectId: 'audio.walkie', params: { bits: 9, grit: 0.4 } }],
  },
  {
    id: 'bajo-el-agua',
    name: 'Bajo el agua',
    kind: 'audio',
    effects: [{ effectId: 'audio.underwater', params: { cutoff: 500, wobble: 1.2 } }],
  },
  {
    id: 'megafono',
    name: 'Megáfono',
    kind: 'audio',
    effects: [{ effectId: 'audio.megaphone', params: { drive: 6 } }],
  },
  {
    id: 'cinta',
    name: 'Cinta',
    kind: 'audio',
    effects: [
      { effectId: 'audio.tape', params: { cutoff: 9000, wow: 0.6, flutter: 0.12 } },
    ],
  },
  {
    id: 'vinilo',
    name: 'Vinilo',
    kind: 'audio',
    effects: [
      {
        effectId: 'audio.vinyl',
        params: { cutoff: 7000, bits: 10, crackle: 0.2, presence: 1.5 },
      },
    ],
  },
  {
    id: 'ocho-bits',
    name: '8 bits',
    kind: 'audio',
    effects: [{ effectId: 'audio.eightbit', params: { bits: 5 } }],
  },
  {
    id: 'coro-vocal',
    name: 'Coro vocal',
    kind: 'audio',
    effects: [{ effectId: 'audio.chorus', params: { delay: 55, speed: 0.4, depth: 2.5 } }],
  },
  {
    id: 'eco-club',
    name: 'Eco de club',
    kind: 'audio',
    effects: [
      { effectId: 'audio.echo', params: { delay: 280, decay: 0.35 } },
      { effectId: 'audio.widen', params: { width: 1.4 } },
    ],
  },
  {
    id: 'slapback-rock',
    name: 'Slapback rock',
    kind: 'audio',
    effects: [{ effectId: 'audio.slapback', params: { delay: 120, decay: 0.35 } }],
  },
  {
    id: 'narrador-grave',
    name: 'Narrador grave',
    kind: 'audio',
    effects: [
      { effectId: 'audio.voice_deep', params: { pitch: 0.78 } },
      {
        effectId: 'audio.compressor',
        params: { threshold: -18, ratio: 3, attack: 10, release: 150 },
      },
    ],
  },
  {
    id: 'voz-robot',
    name: 'Voz robot',
    kind: 'audio',
    effects: [{ effectId: 'audio.voice_robot' }],
  },
];

const ALL_BUILTINS: readonly BuiltinTemplateDef[] = [
  ...VIDEO_TEMPLATES,
  ...AUDIO_TEMPLATES,
];

function buildTemplate(def: BuiltinTemplateDef): EffectTemplate | null {
  const stack: EffectInstance[] = [];
  for (const spec of def.effects) {
    const manifest = effectRegistry.get(spec.effectId);
    if (!manifest) return null;
    stack.push(
      createInstance(
        manifest,
        spec.params ? { params: spec.params } : undefined,
      ),
    );
  }
  const result: EffectStack = stack;
  return {
    id: `builtin-${def.id}`,
    name: def.name,
    kind: def.kind,
    stack: result,
    createdAt: '2026-11-08T00:00:00.000Z',
  };
}

/**
 * Plantillas de fábrica del tipo pedido, ya resueltas contra el catálogo
 * actual. Se recalculan en cada llamada: los ids de instancia son nuevos
 * (nunca colisionan) y `stackFromTemplate` las vuelve a normalizar al
 * aplicarlas, igual que a las del usuario.
 */
export function builtinEffectTemplates(kind: EffectTemplateKind): EffectTemplate[] {
  return ALL_BUILTINS.filter((def) => def.kind === kind)
    .map(buildTemplate)
    .filter((template): template is EffectTemplate => template !== null);
}
