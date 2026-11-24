import { describe, expect, it } from 'vitest';
import { createEmptyProject, parseProject } from '@editor-ia/project-schema';
import { addTrack } from './project-actions';
import {
  addVoxHighlighter,
  addVoxCounter,
  addVoxCallout,
  detectVoxMoments,
  autoPlaceVoxGraphics,
} from './vox-motion';
import { templateById } from './motion-templates';
import type { TranscriptionResult } from '../services/contracts';

describe('vox-motion templates', () => {
  it('registers all 3 vox templates in MOTION_TEMPLATES', () => {
    const highlighter = templateById('vox-highlighter');
    expect(highlighter).toBeDefined();
    expect(highlighter!.id).toBe('vox-highlighter');
    expect(highlighter!.category).toBe('destaque');

    const counter = templateById('vox-counter');
    expect(counter).toBeDefined();
    expect(counter!.id).toBe('vox-counter');
    expect(counter!.category).toBe('dato');

    const callout = templateById('vox-callout');
    expect(callout).toBeDefined();
    expect(callout!.id).toBe('vox-callout');
    expect(callout!.category).toBe('llamada');
  });

  it('builds layers for vox-highlighter template', () => {
    const template = templateById('vox-highlighter')!;
    const context = { width: 1920, height: 1080, fpsNum: 30, fpsDen: 1, durationFrames: 90 };
    const layers = template.buildLayers(
      {
        text: 'La retención aumenta un 40% al añadir subrayados.',
        highlight: 'aumenta un 40%',
        highlighterColor: '#fde047',
        textColor: '#0f172a',
        cardColor: '#fefce8',
        animation: 'wipe',
      },
      context,
    );
    expect(layers.length).toBeGreaterThanOrEqual(3);
    const rects = layers.filter((l) => l.kind === 'rect');
    const texts = layers.filter((l) => l.kind === 'text');
    expect(rects.length).toBeGreaterThanOrEqual(2); // Card + highlighter bar
    expect(texts.length).toBeGreaterThanOrEqual(1);
  });

  it('builds layers for vox-counter template', () => {
    const template = templateById('vox-counter')!;
    const context = { width: 1920, height: 1080, fpsNum: 30, fpsDen: 1, durationFrames: 90 };
    const layers = template.buildLayers(
      {
        value: '1.5M',
        label: 'Suscriptores ganados',
        prefix: '+',
        suffix: '',
        accent: '#38bdf8',
        cardColor: '#090d16',
        animation: 'pop',
      },
      context,
    );
    expect(layers.length).toBeGreaterThanOrEqual(3);
    const texts = layers.filter((l) => l.kind === 'text');
    expect(texts.some((t) => t.kind === 'text' && t.text.includes('1.5M'))).toBe(true);
  });

  it('builds layers for vox-callout template', () => {
    const template = templateById('vox-callout')!;
    const context = { width: 1920, height: 1080, fpsNum: 30, fpsDen: 1, durationFrames: 90 };
    const layers = template.buildLayers(
      {
        emoji: '🚀',
        headline: 'REVELACIÓN',
        text: 'El hook en los primeros 3 segundos triplica el CTR.',
        accent: '#f59e0b',
        textColor: '#ffffff',
        cardColor: '#1e293b',
        animation: 'back',
      },
      context,
    );
    expect(layers.length).toBeGreaterThanOrEqual(4);
    const texts = layers.filter((l) => l.kind === 'text');
    expect(texts.some((t) => t.kind === 'text' && t.text.includes('🚀'))).toBe(true);
    expect(texts.some((t) => t.kind === 'text' && t.text.includes('REVELACIÓN'))).toBe(true);
  });
});

describe('vox-motion clip creation', () => {
  it('adds a vox highlighter graphic clip to the timeline', () => {
    const project = createEmptyProject('VoxTest');
    const result = addVoxHighlighter(project, {
      text: 'La clave de este experimento es la siguiente frase.',
      highlight: 'la siguiente frase',
      atFrame: 60,
      durationFrames: 90,
    });

    expect(result.clipId).toBeDefined();
    expect(result.motionId).toBeDefined();
    expect(result.trackId).toBeDefined();

    const parsed = parseProject(JSON.parse(JSON.stringify(result.project)));
    expect(parsed.ok).toBe(true);

    const clip = result.project.timeline.clips.find((c) => c.id === result.clipId);
    expect(clip).toBeDefined();
    expect(clip!.kind).toBe('graphic');
    expect(clip!.startFrame).toBe(60);
    expect(clip!.durationFrames).toBe(90);

    const motion = result.project.motion.find((m) => m.id === result.motionId);
    expect(motion).toBeDefined();
    expect(motion!.template.id).toBe('vox-highlighter');
    expect(motion!.props.highlight).toBe('la siguiente frase');
  });

  it('adds a vox counter graphic clip to the timeline', () => {
    const project = createEmptyProject('VoxTest');
    const result = addVoxCounter(project, {
      value: '250K',
      label: 'Visitas en el primer día',
      prefix: '$',
      accent: '#22c55e',
      atFrame: 120,
    });

    const parsed = parseProject(JSON.parse(JSON.stringify(result.project)));
    expect(parsed.ok).toBe(true);

    const clip = result.project.timeline.clips.find((c) => c.id === result.clipId);
    expect(clip).toBeDefined();
    expect(clip!.kind).toBe('graphic');

    const motion = result.project.motion.find((m) => m.id === result.motionId);
    expect(motion!.template.id).toBe('vox-counter');
    expect(motion!.props.value).toBe('250K');
    expect(motion!.props.prefix).toBe('$');
  });

  it('adds a vox callout graphic clip to the timeline', () => {
    const project = createEmptyProject('VoxTest');
    const result = addVoxCallout(project, {
      emoji: '⚠️',
      headline: 'CUIDADO',
      text: 'No cometas este error común al renderizar.',
      atFrame: 200,
    });

    const parsed = parseProject(JSON.parse(JSON.stringify(result.project)));
    expect(parsed.ok).toBe(true);

    const clip = result.project.timeline.clips.find((c) => c.id === result.clipId);
    expect(clip).toBeDefined();
    expect(clip!.kind).toBe('graphic');

    const motion = result.project.motion.find((m) => m.id === result.motionId);
    expect(motion!.template.id).toBe('vox-callout');
    expect(motion!.props.emoji).toBe('⚠️');
  });
});

describe('detectVoxMoments & autoPlaceVoxGraphics', () => {
  const sampleTranscript: TranscriptionResult = {
    language: 'es',
    languageProbability: 0.99,
    durationSeconds: 60,
    model: 'whisper',
    segments: [
      {
        start: 2,
        end: 5,
        text: 'Crecimos más del 150% en tan solo tres semanas.',
        words: [],
      },
      {
        start: 10,
        end: 14,
        text: '¡Ojo con este peligro que muchos creadores ignoran!',
        words: [],
      },
      {
        start: 20,
        end: 25,
        text: '¿Por qué la mayoría de los canales fracasan en YouTube?',
        words: [],
      },
    ],
  };

  it('detects metrics, alerts, and question moments from transcript', () => {
    const project = createEmptyProject('VoxTest');
    const moments = detectVoxMoments(project, sampleTranscript);

    expect(moments.length).toBe(3);

    const counterMoment = moments.find((m) => m.kind === 'counter');
    expect(counterMoment).toBeDefined();
    expect(counterMoment!.suggestedProps.value).toBe('150');
    expect(counterMoment!.suggestedProps.suffix).toBe('%');

    const calloutMoment = moments.find((m) => m.kind === 'callout');
    expect(calloutMoment).toBeDefined();
    expect(calloutMoment!.suggestedProps.emoji).toBe('⚠️');

    const highlighterMoment = moments.find((m) => m.kind === 'highlighter');
    expect(highlighterMoment).toBeDefined();
    expect(highlighterMoment!.text).toContain('¿Por qué');
  });

  it('auto-places vox graphics with anti-clustering spacing', () => {
    let project = createEmptyProject('VoxTest');
    const capTrack = addTrack(project, 'caption', 'Subtítulos');
    project = capTrack.project;
    const captionTrackId = capTrack.trackId;
    // Set up captions in project
    project.captions.cues = [
      {
        id: '11111111-1111-4111-8111-111111111111',
        trackId: captionTrackId,
        startFrame: 60, // 2s
        endFrame: 150, // 5s
        text: 'Ganamos más de $500 en la primera hora.',
        language: 'es',
      },
      {
        id: '22222222-2222-4222-8222-222222222222',
        trackId: captionTrackId,
        startFrame: 300, // 10s
        endFrame: 420, // 14s
        text: '¡Atención a este detalle crucial!',
        language: 'es',
      },
      {
        id: '33333333-3333-4333-8333-333333333333',
        trackId: captionTrackId,
        startFrame: 600, // 20s
        endFrame: 750, // 25s
        text: 'La clave es mantener la curiosidad abierta.',
        language: 'es',
      },
    ];

    const result = autoPlaceVoxGraphics(project, { minIntervalFrames: 120 });
    expect(result.placedCount).toBe(3);

    const parsed = parseProject(JSON.parse(JSON.stringify(result.project)));
    expect(parsed.ok).toBe(true);

    const graphicClips = result.project.timeline.clips.filter((c) => c.kind === 'graphic');
    expect(graphicClips.length).toBe(3);

    // Verify clips don't overlap
    for (let i = 1; i < graphicClips.length; i++) {
      expect(graphicClips[i]!.startFrame).toBeGreaterThanOrEqual(
        graphicClips[i - 1]!.startFrame + 120,
      );
    }
  });
});
