import type { EditProposal, ScriptSignal } from './types.ts';
import type { PolicyContext } from './policies.ts';

/**
 * Políticas sobre el guion.
 *
 * La timeline puede estar impecable y el guion no: escenas sin material, sin
 * narración, o narración que no entra en la duración estimada. Casi todas estas
 * reglas devuelven recomendaciones (sin payload); la excepción es la
 * normalización mecánica de subtítulos, que sí se aplica con
 * `updateCaptionCue`.
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

/**
 * Normalización mecánica del texto de un cue: espacios y puntuación.
 *
 * No toca palabras: sólo colapsa espacios horizontales repetidos, pone el
 * espacio que falta después de `,` `;` `:` (antes de letra, así «3,5» queda
 * igual) y después de `.` `!` `?` cuando sigue una mayúscula o signo de
 * apertura (así «www.ejemplo.com» queda igual), y quita el espacio antes de
 * la puntuación de cierre. Los saltos de línea se conservan.
 */
export function cleanCaptionText(text: string): string {
  return text
    .replace(/[^\S\n]+/g, ' ')
    .replace(/([,;:])(?=[A-Za-zÁÉÍÓÚáéíóúÑñÜü])/g, '$1 ')
    .replace(/([.!?])(?=[A-ZÁÉÍÓÚÑÜ¿¡])/g, '$1 ')
    .replace(/[^\S\n]+([,.;:!?%)\]}])/g, '$1')
    .replace(/\([^\S\n]+/g, '(')
    .replace(/[^\S\n]+\)/g, ')')
    .trim();
}

/** Tope de cues por propuesta: un plan de 300 correcciones no se audita. */
const CAPTION_FIX_LIMIT = 60;

export function captionTextPolicy({ project }: ScriptContext): EditProposal[] {
  const lockedTracks = new Set(
    project.timeline.tracks.filter((track) => track.locked).map((track) => track.id),
  );
  const fixes: { cueId: string; text: string }[] = [];
  let skippedTimed = 0;
  for (const cue of project.captions.cues) {
    if (lockedTracks.has(cue.trackId)) continue;
    // Los cues con tiempos por palabra no se tocan: reescribir el texto
    // desincronizaría el reveal palabra por palabra.
    if (cue.words?.length || cue.wordReveal) {
      skippedTimed += 1;
      continue;
    }
    const cleaned = cleanCaptionText(cue.text);
    if (cleaned && cleaned !== cue.text) {
      fixes.push({ cueId: cue.id, text: cleaned.slice(0, 500) });
    }
  }
  if (fixes.length === 0) return [];
  const shown = fixes.slice(0, CAPTION_FIX_LIMIT);
  return [
    {
      id: 'script:caption-text',
      kind: 'caption-text',
      title: `Limpiar ${fixes.length} subtítulo(s)`,
      reason:
        'Hay espacios dobles, espacios antes de puntuación o falta de espacio después de , ; : . ! ? en los textos. Es una normalización mecánica: no cambia palabras ni tiempos.',
      confidence: 0.9,
      impact: 0.25,
      risk: 'safe',
      clipIds: [],
      payload: { kind: 'caption-fixes', fixes: shown },
      preview:
        `Se reescriben ${shown.length} cue(s)` +
        (fixes.length > shown.length ? ` de ${fixes.length} detectados` : '') +
        (skippedTimed > 0 ? `; ${skippedTimed} con tiempos por palabra quedan afuera` : '') +
        '.',
    },
  ];
}

/**
 * El guion quedó viejo respecto al corte.
 *
 * Cuando el usuario mueve clips en la timeline, el `order` de las escenas no
 * se entera: el video muestra una escena antes que otra y el guion sigue
 * diciendo lo contrario. La política mide la posición del primer clip de cada
 * escena (el `clipIds` de la escena contra `timeline.clips`) y, si el orden
 * por timeline difiere del orden del guion, propone reordenar las escenas —
 * no los clips: el corte es lo que el espectador ya vio.
 *
 * Las escenas sin clips no se mueven: no aparecen en el video, así que su
 * lugar en el guion es una decisión de guion, no de edición. Conservan sus
 * posiciones relativas y las escenas montadas se permutan en los huecos que
 * dejaban.
 */
export function sceneOrderPolicy({ project, script }: ScriptContext): EditProposal[] {
  if (script.length < 2) return [];
  const clipStart = new Map(
    project.timeline.clips.map((clip) => [clip.id, clip.startFrame] as const),
  );
  const orderedScenes = [...project.scenes].sort((a, b) => a.order - b.order);

  const placed = orderedScenes
    .map((scene) => {
      const starts = scene.clipIds
        .map((clipId) => clipStart.get(clipId))
        .filter((frame): frame is number => frame !== undefined);
      return { scene, firstFrame: starts.length > 0 ? Math.min(...starts) : null };
    })
    .filter((entry): entry is { scene: (typeof orderedScenes)[number]; firstFrame: number } =>
      entry.firstFrame !== null,
    );
  if (placed.length < 2) return [];

  const byTimeline = [...placed].sort(
    (a, b) => a.firstFrame - b.firstFrame || a.scene.order - b.scene.order,
  );
  const aligned = placed.every((entry, index) => entry.scene.id === byTimeline[index]?.scene.id);
  if (aligned) return [];

  // Las escenas sin material conservan su posición en la lista; las montadas
  // ocupan sólo los lugares que ya tenían, en el orden que muestra el corte.
  const placedIdsByTimeline = byTimeline.map((entry) => entry.scene.id);
  const placedIdSet = new Set(placedIdsByTimeline);
  let cursor = 0;
  const sceneIds = orderedScenes.map((scene) =>
    placedIdSet.has(scene.id) ? (placedIdsByTimeline[cursor++] ?? scene.id) : scene.id,
  );
  if (sceneIds.every((id, index) => id === orderedScenes[index]?.id)) return [];

  const movedTitles = byTimeline
    .filter((entry, index) => entry.scene.id !== placed[index]?.scene.id)
    .slice(0, 3)
    .map((entry) => `«${entry.scene.title}»`);
  const clipIds = byTimeline.flatMap((entry) => entry.scene.clipIds).slice(0, 24);

  return [
    {
      id: 'script:scene-order',
      kind: 'script',
      title: 'El guion no sigue el orden del corte',
      reason:
        `En la timeline, ${movedTitles.join(', ')} aparece antes de lo que dice el guion. ` +
        'El orden de las escenas quedó viejo respecto a los clips montados.',
      confidence: 0.78,
      impact: 0.45,
      risk: 'moderate',
      clipIds,
      payload: { kind: 'scene-order', sceneIds },
      preview:
        'Se reordenan las escenas con material para que el guion coincida con la timeline; ' +
        'las escenas sin clips quedan donde están.',
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
  captionTextPolicy,
  sceneOrderPolicy,
  draftScenesPolicy,
] as const;
