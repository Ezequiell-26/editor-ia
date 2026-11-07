import { describe, expect, it } from 'vitest';
import { createEmptyProject, type ProjectDocument } from '@editor-ia/project-schema';
import { addAsset, addCaptionCue, addClipFromAsset, ensureDelivery, updateTrack } from '../project-actions.ts';
import { readyAsset } from '../../test/fake-service.ts';
import { analyzeTimeline } from './analyze.ts';
import { applyProposal, applyProposals, applySafeProposals } from './apply.ts';
import { planEdits } from './plan.ts';
import { brainBrief } from './report.ts';
import { cleanCaptionText } from './script-policies.ts';

const NOW = '2026-11-01T00:00:00.000Z';

function baseProject(): ProjectDocument {
  return ensureDelivery(createEmptyProject('Cerebro', NOW));
}

interface Built {
  readonly project: ProjectDocument;
  readonly firstClipId: string;
  readonly secondClipId: string;
}

/**
 * Timeline de prueba: un plano de 8 s, un hueco de 2 s y un plano de 2 s.
 * 12 s en total, 2 planos, plano medio 5 s.
 */
function timelineWithGap(): Built {
  const asset = readyAsset({ label: 'Toma larga' });
  let project = addAsset(baseProject(), asset);
  const first = addClipFromAsset(project, asset, { atFrame: 0, durationFrames: 240 });
  project = first.project;
  const second = addClipFromAsset(project, asset, { atFrame: 300, durationFrames: 60 });
  project = second.project;
  return { project: second.project, firstClipId: first.clipId, secondClipId: second.clipId };
}

describe('análisis de timeline', () => {
  it('mide duración, planos, huecos y plano medio', () => {
    const { project } = timelineWithGap();
    const signals = analyzeTimeline(project);
    expect(signals.durationSeconds).toBe(12);
    expect(signals.visualShots).toHaveLength(2);
    expect(signals.averageShotSeconds).toBe(5);
    expect(signals.gapSeconds).toBe(2);
    expect(signals.gaps).toHaveLength(1);
    expect(signals.cutCount).toBe(0);
  });

  it('detecta repetición de material en tres planos seguidos', () => {
    const asset = readyAsset({ label: 'Mismo asset' });
    let project = addAsset(baseProject(), asset);
    for (const atFrame of [0, 60, 120]) {
      project = addClipFromAsset(project, asset, { atFrame, durationFrames: 60 }).project;
    }
    const signals = analyzeTimeline(project);
    expect(signals.repeatedRuns).toHaveLength(1);
    expect(signals.repeatedRuns[0]).toHaveLength(3);
  });

  it('una timeline vacía no reporta problemas', () => {
    const plan = planEdits(baseProject(), { intent: 'short' });
    expect(plan.proposals).toHaveLength(0);
    expect(plan.score.now).toBe(100);
    expect(plan.findings).toHaveLength(0);
  });
});

describe('plan de edición', () => {
  it('propone cerrar el hueco, partir el plano largo y fijar loudness', () => {
    const { project } = timelineWithGap();
    const plan = planEdits(project, { intent: 'short' });
    const kinds = plan.proposals.map((proposal) => proposal.kind);
    expect(kinds).toContain('close-gaps');
    expect(kinds).toContain('split-long');
    expect(kinds).toContain('loudness');
    expect(kinds).toContain('captions');

    const split = plan.proposals.find((proposal) => proposal.kind === 'split-long');
    expect(split?.payload?.kind).toBe('split');
    expect(plan.proposals.find((proposal) => proposal.kind === 'captions')?.payload).toBeUndefined();
  });

  it('ordena por impacto y confianza, no por tipo', () => {
    const { project } = timelineWithGap();
    const plan = planEdits(project, { intent: 'short' });
    const scores = plan.proposals.map((proposal) => proposal.impact * proposal.confidence);
    const sorted = [...scores].sort((a, b) => b - a);
    expect(scores[0]).toBeCloseTo(sorted[0] ?? 0, 5);
  });

  it('el potencial nunca baja del estado actual ni pasa de 100', () => {
    const { project } = timelineWithGap();
    const plan = planEdits(project, { intent: 'reel' });
    expect(plan.score.potential).toBeGreaterThanOrEqual(plan.score.now);
    expect(plan.score.potential).toBeLessThanOrEqual(100);
  });

  it('un formato de tutorial no propone transiciones ni cortes de gancho', () => {
    const { project } = timelineWithGap();
    const plan = planEdits(project, { intent: 'tutorial' });
    const kinds = plan.proposals.map((proposal) => proposal.kind);
    expect(kinds).not.toContain('transition');
    expect(kinds).not.toContain('hook-cut');
  });
});

describe('aplicación', () => {
  it('aplica cortes, loudness y huecos en ese orden', () => {
    const { project } = timelineWithGap();
    const plan = planEdits(project, { intent: 'short' });
    const accepted = plan.proposals
      .filter((proposal) => ['close-gaps', 'split-long', 'loudness'].includes(proposal.kind))
      .map((proposal) => proposal.id);
    const outcome = applyProposals(project, plan.proposals, { accepted });
    expect(outcome.applied.length).toBe(3);
    expect(outcome.project.timeline.clips.length).toBeGreaterThan(
      project.timeline.clips.length,
    );
    expect(outcome.project.audio.loudnessTarget?.platform).toBe('shorts');
  });

  it('aplicar todo lo seguro deja la timeline sin huecos', () => {
    const { project } = timelineWithGap();
    const plan = planEdits(project, { intent: 'short' });
    const outcome = applySafeProposals(project, plan);
    const after = analyzeTimeline(outcome.project);
    expect(after.gapSeconds).toBe(0);
    expect(outcome.applied.length).toBeGreaterThan(0);
  });

  it('no aplica una recomendación sin payload', () => {
    const { project } = timelineWithGap();
    const plan = planEdits(project, { intent: 'short' });
    const manual = plan.proposals.find((proposal) => !proposal.payload);
    expect(manual).toBeTruthy();
    if (!manual) return;
    const result = applyProposal(project, manual);
    expect(result.applied).toBe(false);
    expect(result.project).toBe(project);
  });

  it('omite con motivo una propuesta que ya no aplica', () => {
    const { project } = timelineWithGap();
    const plan = planEdits(project, { intent: 'short' });
    const split = plan.proposals.find((proposal) => proposal.payload?.kind === 'split');
    expect(split).toBeTruthy();
    if (!split) return;
    // Se aplica dos veces: la segunda ya no encuentra el corte.
    const first = applyProposal(project, split);
    expect(first.applied).toBe(true);
    const second = applyProposal(first.project, split);
    expect(second.applied).toBe(false);
    expect(second.message.length).toBeGreaterThan(0);
  });
});

describe('brief para la IA', () => {
  it('incluye métricas, hallazgos y propuestas numeradas', () => {
    const { project } = timelineWithGap();
    const plan = planEdits(project, { intent: 'short' });
    const brief = brainBrief(plan);
    expect(brief).toContain('CEREBRO DE EDICIÓN');
    expect(brief).toContain('salud');
    expect(brief).toContain('Propuestas:');
    expect(brief).toMatch(/1\. \[/);
    expect(brief.length).toBeLessThan(1400);
  });

  it('sin propuestas lo dice explícitamente', () => {
    const plan = planEdits(baseProject(), { intent: 'short' });
    expect(brainBrief(plan)).toContain('ninguna');
  });
});

describe('cortes en el pulso', () => {
  const grid = {
    bpm: 120,
    confidence: 0.82,
    beatsFrames: Array.from({ length: 24 }, (_, index) => index * 15),
  };

  it('parte el plano largo sobre los beats en vez de en el tiempo justo', () => {
    const { project } = timelineWithGap();
    const plan = planEdits(project, { intent: 'short', beats: grid, limit: 20 });
    const beat = plan.proposals.find((proposal) => proposal.kind === 'beat-cut');
    expect(beat).toBeTruthy();
    expect(beat?.payload?.kind).toBe('split');
    if (beat?.payload?.kind === 'split') {
      expect(beat.payload.atFrames.length).toBeGreaterThan(0);
      for (const frame of beat.payload.atFrames) {
        expect(frame % 15).toBe(0);
      }
    }
    expect(plan.proposals.some((proposal) => proposal.kind === 'split-long')).toBe(false);
  });

  it('reporta el porcentaje de cortes alineados y el BPM', () => {
    const { project } = timelineWithGap();
    const plan = planEdits(project, { intent: 'short', beats: grid, limit: 20 });
    const metric = plan.metrics.find((entry) => entry.id === 'beat');
    expect(metric?.target).toBe('120 BPM');
    expect(metric?.value).toMatch(/%/);
    expect(brainBrief(plan)).toContain('120 BPM');
  });

  it('ignora una grilla con poca confianza', () => {
    const { project } = timelineWithGap();
    const plan = planEdits(project, {
      intent: 'short',
      beats: { ...grid, confidence: 0.2 },
      limit: 20,
    });
    expect(plan.proposals.some((proposal) => proposal.kind === 'beat-cut')).toBe(false);
    expect(plan.proposals.some((proposal) => proposal.kind === 'split-long')).toBe(true);
  });
});

describe('alinear cortes existentes al pulso', () => {
  const grid = {
    bpm: 120,
    confidence: 0.82,
    beatsFrames: Array.from({ length: 30 }, (_, index) => index * 15),
  };

  interface Pair {
    readonly project: ProjectDocument;
    readonly leftClipId: string;
    readonly rightClipId: string;
  }

  /** Dos planos contiguos de 100 frames con margen de fuente para el roll. */
  function contiguousPair(rightInFrame = 150): Pair {
    const first = readyAsset({ label: 'Izquierda' });
    const second = readyAsset({ label: 'Derecha' });
    let project = addAsset(baseProject(), first);
    project = addAsset(project, second);
    const left = addClipFromAsset(project, first, {
      atFrame: 0,
      inFrame: 20,
      outFrame: 120,
    });
    project = left.project;
    const right = addClipFromAsset(project, second, {
      atFrame: 100,
      inFrame: rightInFrame,
      outFrame: rightInFrame + 100,
    });
    return {
      project: right.project,
      leftClipId: left.clipId,
      rightClipId: right.clipId,
    };
  }

  it('propone un roll que lleva el corte existente al beat más cercano', () => {
    const { project, leftClipId, rightClipId } = contiguousPair();
    // Corte en el frame 100; el beat más cercano es 105 (delta +5).
    const plan = planEdits(project, { intent: 'tighten', beats: grid, limit: 20 });
    const align = plan.proposals.find((proposal) => proposal.kind === 'beat-align');
    expect(align).toBeTruthy();
    expect(align?.payload?.kind).toBe('roll');
    if (align?.payload?.kind === 'roll') {
      expect(align.payload.clipId).toBe(leftClipId);
      expect(align.payload.edge).toBe('out');
      expect(align.payload.deltaFrames).toBe(5);
    }
    expect(align?.clipIds).toContain(leftClipId);
    expect(align?.clipIds).toContain(rightClipId);
    if (!align) return;

    const applied = applyProposal(project, align);
    expect(applied.applied).toBe(true);
    const left = applied.project.timeline.clips.find((clip) => clip.id === leftClipId);
    const right = applied.project.timeline.clips.find((clip) => clip.id === rightClipId);
    expect(left?.durationFrames).toBe(105);
    expect(right?.startFrame).toBe(105);
    expect(right?.durationFrames).toBe(95);
  });

  it('no propone nada cuando el corte ya cae sobre un beat', () => {
    const { project } = contiguousPair();
    const aligned = {
      ...grid,
      beatsFrames: Array.from({ length: 30 }, (_, index) => 100 + index * 15 - 15),
    };
    const plan = planEdits(project, { intent: 'tighten', beats: aligned, limit: 20 });
    expect(plan.proposals.some((proposal) => proposal.kind === 'beat-align')).toBe(false);
  });

  it('no propone un roll que se sale de la ventana de fuente', () => {
    const { project } = contiguousPair(2);
    // Grilla desplazada: el beat más cercano al corte (100) es 95, lo que pide
    // delta -5 y el clip derecho sólo tiene 2 frames de margen de entrada.
    const shifted = {
      ...grid,
      beatsFrames: Array.from({ length: 30 }, (_, index) => 5 + index * 15),
    };
    const plan = planEdits(project, { intent: 'tighten', beats: shifted, limit: 20 });
    expect(plan.proposals.some((proposal) => proposal.kind === 'beat-align')).toBe(false);
  });

  it('ignora la grilla cuando la confianza es baja', () => {
    const { project } = contiguousPair();
    const plan = planEdits(project, {
      intent: 'tighten',
      beats: { ...grid, confidence: 0.2 },
      limit: 20,
    });
    expect(plan.proposals.some((proposal) => proposal.kind === 'beat-align')).toBe(false);
  });
});

describe('propuestas sobre el guion', () => {
  function projectWithScenes(): ProjectDocument {
    const base = timelineWithGap().project;
    return {
      ...base,
      scenes: [
        {
          id: 's1',
          order: 0,
          title: 'Gancho',
          intent: 'hook',
          status: 'draft',
          narration: {
            text: Array.from({ length: 60 }, () => 'palabra').join(' '),
            estimatedDurationFrames: 90,
          },
          clipIds: [],
        },
        {
          id: 's2',
          order: 1,
          title: 'Demo',
          intent: 'demo',
          status: 'reviewed',
          narration: {},
          clipIds: ['clip-x'],
        },
        {
          id: 's3',
          order: 2,
          title: 'Cierre',
          intent: 'outro',
          status: 'approved',
          narration: { text: 'Gracias por ver', estimatedDurationFrames: 60 },
          clipIds: ['clip-y'],
        },
      ],
    } as ProjectDocument;
  }

  it('detecta escenas sin material, sin narración y texto que no entra', () => {
    const plan = planEdits(projectWithScenes(), { intent: 'short', limit: 20 });
    const ids = plan.proposals.map((proposal) => proposal.id);
    expect(ids).toContain('script:scenes-without-clips');
    expect(ids).toContain('script:scenes-without-narration');
    expect(ids).toContain('script:narration-fast');
    expect(ids).toContain('script:drafts');
  });

  it('las propuestas de guion son recomendaciones, no se aplican solas', () => {
    const project = projectWithScenes();
    const plan = planEdits(project, { intent: 'short', limit: 20 });
    const scriptProposals = plan.proposals.filter((proposal) => proposal.kind === 'script');
    expect(scriptProposals.length).toBeGreaterThan(0);
    for (const proposal of scriptProposals) {
      expect(proposal.payload).toBeUndefined();
      expect(applyProposal(project, proposal).applied).toBe(false);
    }
  });

  it('expone las señales del guion en el plan', () => {
    const plan = planEdits(projectWithScenes(), { intent: 'short', limit: 20 });
    expect(plan.script).toHaveLength(3);
    expect(plan.script[0]?.narrationWords).toBe(60);
    expect(plan.script[0]?.clipCount).toBe(0);
    expect(plan.script[1]?.hasNarration).toBe(false);
  });
});

describe('silencios dentro del clip', () => {
  /**
   * El cerebro no mide picos: recibe el plan que `planSilenceCuts` ya calculó.
   * Acá se arma a mano: el primer clip (240 frames a 30 fps = 8 s) tiene un
   * silencio medido entre los frames 60 y 120 de timeline (2 s).
   */
  function silenceFor(clipId: string) {
    return {
      clipId,
      spans: [{ startFrame: 60, endFrame: 120 }],
      cutFrames: [60, 120],
      removedSeconds: 2,
    };
  }

  it('sin señal de silencios no propone nada', () => {
    const { project } = timelineWithGap();
    const plan = planEdits(project, { intent: 'tighten', limit: 20 });
    expect(plan.proposals.some((proposal) => proposal.kind === 'cut-silences')).toBe(false);
  });

  it('propone el recorte y lo aplica con el motor de silencios', () => {
    const { project, firstClipId } = timelineWithGap();
    const plan = planEdits(project, {
      intent: 'tighten',
      silences: [silenceFor(firstClipId)],
      limit: 20,
    });
    const proposal = plan.proposals.find((entry) => entry.kind === 'cut-silences');
    expect(proposal).toBeTruthy();
    expect(proposal?.payload?.kind).toBe('cut-spans');
    expect(proposal?.risk).toBe('moderate');
    if (!proposal) return;

    const result = applyProposal(project, proposal);
    expect(result.applied).toBe(true);
    // 12 s − 2 s de silencio = 10 s; el clip queda en dos pedazos y el segundo
    // clip de la pista corre 60 frames a la izquierda.
    expect(analyzeTimeline(result.project).durationSeconds).toBe(10);
    expect(result.project.timeline.clips).toHaveLength(3);
  });

  it('una señal de clip que ya no existe se ignora', () => {
    const { project } = timelineWithGap();
    const plan = planEdits(project, {
      intent: 'tighten',
      silences: [silenceFor('clip-que-no-existe')],
      limit: 20,
    });
    expect(plan.proposals.some((proposal) => proposal.kind === 'cut-silences')).toBe(false);
  });

  it('una señal vacía o diminuta no genera propuesta', () => {
    const { project, firstClipId } = timelineWithGap();
    const plan = planEdits(project, {
      intent: 'tighten',
      silences: [
        { clipId: firstClipId, spans: [], cutFrames: [], removedSeconds: 0 },
        { ...silenceFor(firstClipId), removedSeconds: 0.1, spans: [{ startFrame: 60, endFrame: 63 }], cutFrames: [60, 63] },
      ],
      limit: 20,
    });
    expect(plan.proposals.some((proposal) => proposal.kind === 'cut-silences')).toBe(false);
  });

  it('el recorte de silencios no entra en «Aplicar lo seguro»', () => {
    const { project, firstClipId } = timelineWithGap();
    const plan = planEdits(project, {
      intent: 'tighten',
      silences: [silenceFor(firstClipId)],
      limit: 20,
    });
    const outcome = applySafeProposals(project, plan);
    expect(outcome.applied.some((id) => id.startsWith('cut-silences:'))).toBe(false);
  });
});

describe('texto de subtítulos', () => {
  /**
   * `addCaptionCue` recorta el texto al escribirlo, así que el texto sucio se
   * inyecta directo en el documento (igual que haría una importación SRT).
   */
  function projectWithCue(text: string, options: { timed?: boolean } = {}) {
    const added = addCaptionCue(baseProject(), {
      text: 'ok',
      startFrame: 0,
      durationFrames: 30,
    });
    const project = {
      ...added.project,
      captions: {
        ...added.project.captions,
        cues: added.project.captions.cues.map((cue) =>
          cue.id === added.cueId
            ? {
                ...cue,
                text,
                ...(options.timed
                  ? { words: [{ text: 'hola', startFrame: 0, endFrame: 10 }] }
                  : {}),
              }
            : cue,
        ),
      },
    } as ProjectDocument;
    return { project, cueId: added.cueId, trackId: added.trackId };
  }

  it('normaliza espacios y puntuación sin tocar palabras ni números', () => {
    expect(cleanCaptionText('  hola  ,mundo .Mundo  ')).toBe('hola, mundo. Mundo');
    expect(cleanCaptionText('esto es  una\tprueba')).toBe('esto es una prueba');
    expect(cleanCaptionText('cuesta 3,5 euros')).toBe('cuesta 3,5 euros');
    expect(cleanCaptionText('mirá www.ejemplo.com hoy')).toBe('mirá www.ejemplo.com hoy');
    expect(cleanCaptionText('genial!Genial')).toBe('genial! Genial');
    expect(cleanCaptionText('hola ( mundo )')).toBe('hola (mundo)');
    expect(cleanCaptionText('línea1\nlínea2')).toBe('línea1\nlínea2');
    expect(cleanCaptionText('ya está bien.')).toBe('ya está bien.');
  });

  it('propone la limpieza y la aplica con updateCaptionCue', () => {
    const { project, cueId } = projectWithCue('hola  ,mundo .Mundo');
    const plan = planEdits(project, { intent: 'tighten', limit: 20 });
    const proposal = plan.proposals.find((entry) => entry.kind === 'caption-text');
    expect(proposal).toBeTruthy();
    expect(proposal?.risk).toBe('safe');
    expect(proposal?.payload?.kind).toBe('caption-fixes');
    if (!proposal) return;

    const result = applyProposal(project, proposal);
    expect(result.applied).toBe(true);
    const cue = result.project.captions.cues.find((item) => item.id === cueId);
    expect(cue?.text).toBe('hola, mundo. Mundo');
  });

  it('no propone nada cuando los textos ya están limpios', () => {
    const { project } = projectWithCue('hola, mundo. Todo bien.');
    const plan = planEdits(project, { intent: 'tighten', limit: 20 });
    expect(plan.proposals.some((entry) => entry.kind === 'caption-text')).toBe(false);
  });

  it('salta cues con tiempos por palabra y pistas bloqueadas', () => {
    const timed = projectWithCue('hola  ,mundo', { timed: true });
    const planTimed = planEdits(timed.project, { intent: 'tighten', limit: 20 });
    expect(planTimed.proposals.some((entry) => entry.kind === 'caption-text')).toBe(false);

    const { project, trackId } = projectWithCue('hola  ,mundo');
    const locked = updateTrack(project, trackId, { locked: true });
    const planLocked = planEdits(locked, { intent: 'tighten', limit: 20 });
    expect(planLocked.proposals.some((entry) => entry.kind === 'caption-text')).toBe(false);
  });

  it('la limpieza entra en «Aplicar lo seguro»', () => {
    const { project } = projectWithCue('hola  ,mundo');
    const plan = planEdits(project, { intent: 'tighten', limit: 20 });
    const outcome = applySafeProposals(project, plan);
    const proposal = plan.proposals.find((entry) => entry.kind === 'caption-text');
    expect(proposal).toBeTruthy();
    expect(outcome.applied).toContain(proposal?.id);
  });
});
