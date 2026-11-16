import type { ProjectDocument } from '@editor-ia/project-schema';
import type { MotionContext, MotionLayer, MotionPlan, MotionTemplate } from './motion-templates';
import { templateById } from './motion-templates';

export {
  badgeTemplate,
  contornoTemplate,
  endCardTemplate,
  faixaCidadeTemplate,
  faixaDegradeTemplate,
  faixaEsporteTemplate,
  faixaAovivoTemplate,
  faixaPlantaoTemplate,
  faixaJornalTemplate,
  faixaLetreiroTemplate,
  faixaLimpoTemplate,
  faixaNomeTemplate,
  freeTextTemplate,
  lowerThirdTemplate,
  molduraTemplate,
  MOTION_TEMPLATES,
  shapeTemplate,
  solidFrameTemplate,
  statCalloutTemplate,
  subscribeBellTemplate,
  titleCardTemplate,
} from './motion-templates';
export type {
  MotionAnimation,
  MotionAnimationKind,
  MotionContext,
  MotionLayer,
  MotionPlan,
  MotionRectLayer,
  MotionStrokeLayer,
  MotionTemplate,
  MotionTextLayer,
} from './motion-templates';

export class MotionPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MotionPlanError';
  }
}

export function buildMotionPlan(
  template: MotionTemplate,
  props: Record<string, unknown>,
  context: MotionContext,
): MotionPlan {
  const parsed = template.propsSchema.safeParse(props);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new MotionPlanError(
      first ? `${first.path.join('.')}: ${first.message}` : 'props inválidas',
    );
  }
  const layers = template
    .buildLayers(parsed.data as Record<string, unknown>, context)
    .slice(0, 16);
  if (layers.length === 0) {
    throw new MotionPlanError('la plantilla no produjo capas visibles');
  }
  return {
    version: 1,
    width: context.width,
    height: context.height,
    fps: { num: context.fpsNum, den: context.fpsDen },
    durationFrames: Math.max(1, Math.round(context.durationFrames)),
    layers,
  };
}

export interface MotionPlanBundle {
  readonly plans: Record<string, MotionPlan>;
  readonly errors: string[];
}

export function buildProjectMotionPlans(project: ProjectDocument): MotionPlanBundle {
  const plans: Record<string, MotionPlan> = {};
  const errors: string[] = [];
  const clips = [
    ...project.timeline.clips,
    ...(project.compounds ?? []).flatMap((compound) => compound.clips),
  ];
  for (const clip of clips) {
    if (clip.kind !== 'graphic') continue;
    const motion = project.motion.find((item) => item.id === clip.source.motionId);
    if (!motion) {
      errors.push(`Clip ${clip.label ?? clip.id}: el motion item no existe`);
      continue;
    }
    const template = templateById(motion.template.id);
    if (!template) {
      errors.push(`Clip ${clip.label ?? clip.id}: plantilla ${motion.template.id} desconocida`);
      continue;
    }
    try {
      plans[clip.id] = buildMotionPlan(template, motion.props, {
        width: project.video.width,
        height: project.video.height,
        fpsNum: project.video.frameRate.num,
        fpsDen: project.video.frameRate.den,
        durationFrames: clip.durationFrames,
      });
    } catch (error) {
      errors.push(
        `Clip ${clip.label ?? clip.id}: ${
          error instanceof Error ? error.message : 'props inválidas'
        }`,
      );
    }
  }
  return { plans, errors };
}

export interface LayerVisual {
  readonly opacity: number;
  readonly transform: string;
  /** Revelado de escritura (`write`): `clip-path` que se abre de
   * izquierda a derecha durante la entrada. El export lo emite como
   * `\clip` animado con `\t`. */
  readonly clipPath?: string;
}

function easeOut(value: number): number {
  const clamped = Math.min(1, Math.max(0, value));
  return 1 - Math.pow(1 - clamped, 3);
}

/** easeOutBack (paridad de la entrada con sobreimpulso de `faixas.js`):
 * arranca en 0, termina en 1 y supera 1 (~1.08) antes de asentarse. */
function easeOutBack(value: number): number {
  const t = Math.min(1, Math.max(0, value));
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

export function layerVisual(
  layer: MotionLayer,
  progress: number,
  durationFrames: number,
): LayerVisual {
  const animation = layer.animation;
  if (animation.kind === 'none') {
    return { opacity: 1, transform: 'none' };
  }
  const total = Math.max(1, durationFrames);
  const position = Math.min(1, Math.max(0, progress));
  const introFrames = Math.max(1, animation.inFrames ?? Math.round(total * 0.12));
  const intro = Math.min(1, Math.max(0, (position * total) / introFrames));
  const outroFrames = Math.max(0, animation.outFrames ?? 0);
  const outro =
    outroFrames > 0
      ? Math.min(1, Math.max(0, ((1 - position) * total) / outroFrames))
      : 1;
  const opacity = Math.min(easeOut(intro), outro);
  const distance = Math.min(0.5, Math.max(0, animation.distance ?? 0.05));
  if (animation.kind === 'slide-up') {
    return {
      opacity,
      transform: `translateY(${(1 - easeOut(intro)) * distance * 100}%)`,
    };
  }
  if (animation.kind === 'slide-left') {
    return {
      opacity,
      transform: `translateX(${(1 - easeOut(intro)) * distance * 100}%)`,
    };
  }
  if (animation.kind === 'pop') {
    const scale = 0.7 + 0.3 * easeOut(intro);
    return { opacity, transform: `scale(${scale})` };
  }
  if (animation.kind === 'back') {
    // Escala 0.6 → ~1.03 (pico del easeOutBack) → 1.0: el sobreimpulso
    // se ve como un pequeño rebote al asentarse.
    const scale = 0.6 + 0.4 * easeOutBack(intro);
    return { opacity, transform: `scale(${scale.toFixed(4)})` };
  }
  if (animation.kind === 'write' || animation.kind === 'wipe') {
    // «Se escribe» (texto) y «barrido» (cualquier capa, paridad de los
    // clip-paths de entrada de `faixas.js`): el borde derecho del
    // clip-path avanza con el easing de la entrada; la opacidad sigue
    // con fade in/out. En el export ambos son `\clip` animado con `\t`.
    const reveal = easeOut(intro);
    return {
      opacity,
      transform: 'none',
      clipPath: `inset(0 ${((1 - reveal) * 100).toFixed(2)}% 0 0)`,
    };
  }
  return { opacity, transform: 'none' };
}
