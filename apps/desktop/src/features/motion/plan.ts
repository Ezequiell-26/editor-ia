import type { ProjectDocument } from '@editor-ia/project-schema';
import type { MotionContext, MotionLayer, MotionPlan, MotionTemplate } from './templates';
import { templateById } from './templates';

export {
  endCardTemplate,
  lowerThirdTemplate,
  MOTION_TEMPLATES,
  statCalloutTemplate,
  titleCardTemplate,
} from './templates';
export type {
  MotionAnimation,
  MotionAnimationKind,
  MotionContext,
  MotionLayer,
  MotionPlan,
  MotionRectLayer,
  MotionTemplate,
  MotionTextLayer,
} from './templates';

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
  for (const clip of project.timeline.clips) {
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
}

function easeOut(value: number): number {
  const clamped = Math.min(1, Math.max(0, value));
  return 1 - Math.pow(1 - clamped, 3);
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
  return { opacity, transform: 'none' };
}
