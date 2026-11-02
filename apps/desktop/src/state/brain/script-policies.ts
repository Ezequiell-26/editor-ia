import type { EditProposal, ScriptSignal } from './types.ts';
import type { PolicyContext } from './policies.ts';

/**
 * Políticas sobre el guion.
 *
 * La timeline puede estar impecable y el guion no: escenas sin material, sin
 * narración, o narración que no entra en la duración estimada. Estas reglas
 * devuelven recomendaciones (sin payload) porque reescribir texto no es una
 * operación de timeline.
 */

export interface ScriptContext extends PolicyContext {
  readonly script: readonly ScriptSignal[];
}

function round(value: number, decimals = 1): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** Palabras por segundo cómodas para narración en español. */
const COMFORTABLE_WPS = 3.2;
const FAST_WPS = 4.2;
const SLOW_WPS = 1.1;

/** Caracteres por segundo legibles en subtítulos. */
const COMFORTABLE_CPS = 22;

export function scenesWithoutClipsPolicy({ script }: ScriptContext): EditProposal[] {
  const orphans = script.filter((scene) => scene.clipCount === 0);
  if (orphans.length === 0) return [];
  const names = orphans
    .slice(0, 4)
    .map((scene) => `«${scene.title}»`)
    .join(', ');
  return [
    {
      id: 'script:scenes-without-clips',
      kind: 'script',
      title: `${orphans.length} escena(s) del guion sin material`,
      reason: `${names} existen en el guion pero no tienen ningún clip montado.`,
      confidence: 0.9,
      impact: 0.6,
      risk: 'safe',
      clipIds: [],
      preview: 'Montá material para esas escenas o marcalas como fuera del corte.',
    },
  ];
}

export function scenesWithoutNarrationPolicy({
  script,
  profile,
}: ScriptContext): EditProposal[] {
  if (!profile.captionsRequired) return [];
  const silent = script.filter((scene) => scene.clipCount > 0 && !scene.hasNarration);
  if (silent.length === 0) return [];
  return [
    {
      id: 'script:scenes-without-narration',
      kind: 'script',
      title: `${silent.length} escena(s) sin narración`,
      reason: `${silent
        .slice(0, 3)
        .map((scene) => `«${scene.title}»`)
        .join(', ')} tienen material pero no texto ni voz: en este formato el video se mira sin sonido.`,
      confidence: 0.82,
      impact: 0.55,
      risk: 'safe',
      clipIds: [],
      preview: 'Escribí la narración en Guion o generá la voz en Producción.',
    },
  ];
}

export function narrationPacePolicy({ script }: ScriptContext): EditProposal[] {
  const measured = script.filter(
    (scene) => scene.narrationSeconds > 0 && scene.narrationWords > 0,
  );
  if (measured.length === 0) return [];

  const tooFast = measured
    .map((scene) => ({ scene, wps: scene.narrationWords / scene.narrationSeconds }))
    .filter((entry) => entry.wps > FAST_WPS)
    .sort((a, b) => b.wps - a.wps);

  if (tooFast.length > 0) {
    const worst = tooFast[0];
    return [
      {
        id: 'script:narration-fast',
        kind: 'script',
        title: 'La narración no entra en su duración',
        reason: worst
          ? `«${worst.scene.title}» tiene ${worst.scene.narrationWords} palabras para ${round(worst.scene.narrationSeconds)} s (${round(worst.wps)} palabras/s; cómodo es ${COMFORTABLE_WPS}).`
          : 'Hay escenas con más texto del que entra en su duración.',
        confidence: 0.85,
        impact: 0.6,
        risk: 'safe',
        clipIds: [],
        preview: 'Acortá el texto, alargá la escena o subí la velocidad de lectura con subtítulos.',
      },
    ];
  }

  const tooSlow = measured
    .map((scene) => ({ scene, wps: scene.narrationWords / scene.narrationSeconds }))
    .filter((entry) => entry.wps < SLOW_WPS && entry.scene.narrationSeconds > 8);
  if (tooSlow.length === 0) return [];
  return [
    {
      id: 'script:narration-slow',
      kind: 'script',
      title: 'Escenas con narración muy espaciada',
      reason: `${tooSlow.length} escena(s) dicen menos de ${SLOW_WPS} palabras por segundo: el video se arrastra.`,
      confidence: 0.7,
      impact: 0.35,
      risk: 'safe',
      clipIds: [],
      preview: 'Sumá contenido o acortá la escena.',
    },
  ];
}

export function captionSpeedPolicy({ project }: ScriptContext): EditProposal[] {
  const fps = project.video.frameRate.num / Math.max(1, project.video.frameRate.den);
  const fast = project.captions.cues.filter((cue) => {
    const seconds = (cue.endFrame - cue.startFrame) / fps;
    if (seconds <= 0) return false;
    return cue.text.length / seconds > COMFORTABLE_CPS;
  });
  if (fast.length === 0) return [];
  return [
    {
      id: 'script:captions-fast',
      kind: 'script',
      title: `${fast.length} subtítulo(s) demasiado rápidos`,
      reason: `Pasan de ${COMFORTABLE_CPS} caracteres por segundo: no se llegan a leer antes del corte.`,
      confidence: 0.8,
      impact: 0.45,
      risk: 'safe',
      clipIds: [],
      preview: 'Partí el subtítulo en dos o alargalo unos frames.',
    },
  ];
}

export function draftScenesPolicy({ script }: ScriptContext): EditProposal[] {
  const drafts = script.filter((scene) => scene.status === 'draft');
  if (drafts.length === 0) return [];
  return [
    {
      id: 'script:drafts',
      kind: 'script',
      title: `${drafts.length} escena(s) en borrador`,
      reason: 'El guion todavía tiene escenas sin revisar; el corte final puede cambiar.',
      confidence: 0.6,
      impact: 0.2,
      risk: 'safe',
      clipIds: [],
      preview: 'Revisá y aprobá las escenas en Guion.',
    },
  ];
}

export const SCRIPT_POLICIES = [
  scenesWithoutClipsPolicy,
  scenesWithoutNarrationPolicy,
  narrationPacePolicy,
  captionSpeedPolicy,
  draftScenesPolicy,
] as const;
