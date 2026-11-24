import { describe, expect, it } from 'vitest';
import {
  applySemanticBroll,
  assetKeywords,
  extractKeywords,
  normalizeText,
  planSemanticBroll,
  scoreBrollMatch,
} from './broll-matcher';
import {
  addAsset,
  addClipFromAsset,
  addTrack,
} from './project-actions';
import { createEmptyProject, type Asset } from '@editor-ia/project-schema';
import type { TranscriptionResult } from '../services/contracts';

const NOW = '2026-11-23T18:00:00.000Z';

function sampleBrollAsset(id: string, label: string, tags: string[] = []): Asset {
  return {
    id,
    label,
    kind: 'video',
    status: 'ready',
    source: { type: 'local', path: `broll/${label.toLowerCase().replace(/\s+/g, '_')}.mp4` },
    integrity: { sha256: 'b'.repeat(64), bytes: 25_000 },
    rights: {
      license: { id: 'owned', commercialUse: 'allowed' },
      provenance: { origin: 'user-imported', acquiredAt: NOW },
    },
    tags,
    media: {
      durationFrames: 300,
      width: 1920,
      height: 1080,
      frameRate: { num: 30, den: 1 },
      channels: 0,
    },
  } as Asset;
}

describe('normalizeText y extractKeywords', () => {
  it('remueve tildes, signos ortográficos y convierte a minúsculas', () => {
    const clean = normalizeText('¡Hola! ¿Cómo estás hoy? ¡Qué increíble!');
    expect(clean).toBe('hola como estas hoy que increible');
  });

  it('filtra palabras vacías (stopwords) y preserva sustantivos y conceptos clave', () => {
    const keywords = extractKeywords(
      'En este video vamos a hablar sobre la economía global y el precio del café por la mañana.',
    );
    expect(keywords).toContain('video');
    expect(keywords).toContain('hablar');
    expect(keywords).toContain('economia');
    expect(keywords).toContain('global');
    expect(keywords).toContain('precio');
    expect(keywords).toContain('cafe');
    expect(keywords).toContain('manana');
    // Stopwords excluidas
    expect(keywords).not.toContain('este');
    expect(keywords).not.toContain('vamos');
    expect(keywords).not.toContain('sobre');
    expect(keywords).not.toContain('del');
    expect(keywords).not.toContain('por');
  });
});

describe('assetKeywords y scoreBrollMatch', () => {
  it('extrae descriptores de la etiqueta, tags, bin y nombre de archivo', () => {
    const asset = sampleBrollAsset('broll-1', 'Taza de Café Caliente', ['desayuno', 'mañana']);
    const tokens = assetKeywords(asset);
    expect(tokens.has('taza')).toBe(true);
    expect(tokens.has('cafe')).toBe(true);
    expect(tokens.has('caliente')).toBe(true);
    expect(tokens.has('desayuno')).toBe(true);
    expect(tokens.has('manana')).toBe(true);
  });

  it('asigna puntaje alto ante coincidencias conceptuales y 0 sin relación', () => {
    const cafeTokens = new Set(['cafe', 'taza', 'desayuno', 'caliente']);
    const match = scoreBrollMatch(['tomando', 'una', 'taza', 'de', 'rico', 'cafe'], cafeTokens);
    expect(match.score).toBeGreaterThan(20);
    expect(match.matchedKeywords).toContain('taza');
    expect(match.matchedKeywords).toContain('cafe');

    const unrelated = scoreBrollMatch(['aeropuerto', 'avion', 'vuelo'], cafeTokens);
    expect(unrelated.score).toBe(0);
    expect(unrelated.matchedKeywords).toHaveLength(0);
  });
});

describe('planSemanticBroll', () => {
  it('empareja planos B-roll con los momentos exactos del guión hablado', () => {
    const assetCafe = sampleBrollAsset('broll-cafe', 'Preparando café expreso', ['cafe', 'taza']);
    const assetTech = sampleBrollAsset('broll-tech', 'Programador escribiendo código', ['codigo', 'computadora', 'teclado']);

    const transcript: TranscriptionResult = {
      language: 'es',
      languageProbability: 0.99,
      durationSeconds: 30,
      model: 'whisper-large',
      segments: [
        {
          start: 2.0,
          end: 6.0,
          text: 'Todas las mañanas me preparo una buena taza de café para arrancar.',
          words: [],
        },
        {
          start: 8.0,
          end: 12.0,
          text: 'Y luego me siento frente a la computadora a escribir código todo el día.',
          words: [],
        },
      ],
    };

    const planned = planSemanticBroll({
      transcript,
      brollAssets: [assetCafe, assetTech],
      minIntervalSeconds: 1.0,
    });

    expect(planned).toHaveLength(2);
    // Primer B-roll debe ser el café en el segundo 2
    expect(planned[0]!.brollAssetId).toBe('broll-cafe');
    expect(planned[0]!.startSeconds).toBe(2.0);
    expect(planned[0]!.matchedKeywords).toContain('cafe');

    // Segundo B-roll debe ser tech en el segundo 8
    expect(planned[1]!.brollAssetId).toBe('broll-tech');
    expect(planned[1]!.startSeconds).toBe(8.0);
    expect(planned[1]!.matchedKeywords.some((k) => k === 'codigo' || k === 'computadora')).toBe(true);
  });

  it('respeta minIntervalSeconds para no encimar planos de B-roll', () => {
    const assetA = sampleBrollAsset('broll-a', 'Coche veloz', ['coche', 'auto']);
    const transcript: TranscriptionResult = {
      language: 'es',
      languageProbability: 1,
      durationSeconds: 20,
      model: 'whisper',
      segments: [
        { start: 1.0, end: 3.0, text: 'Un coche muy rápido.', words: [] },
        { start: 2.0, end: 4.0, text: 'Otro coche veloz en la pista.', words: [] },
      ],
    };

    const planned = planSemanticBroll({
      transcript,
      brollAssets: [assetA],
      minIntervalSeconds: 5.0,
    });

    // Con separación mínima de 5 s, sólo planifica 1 inserción
    expect(planned).toHaveLength(1);
  });
});

describe('applySemanticBroll', () => {
  it('monta los planos B-roll en una pista de video superpuesta con audio silenciado', () => {
    const video = sampleBrollAsset('broll-city', 'Ciudad de noche', ['ciudad', 'edificios']);
    let project = addAsset(createEmptyProject('Semantic B-Roll', NOW), video);
    const mainTrack = addTrack(project, 'video', 'Main Video');
    project = mainTrack.project;
    const addedClip = addClipFromAsset(project, video, {
      trackId: mainTrack.trackId,
      atFrame: 0,
      durationFrames: 300,
    });
    project = addedClip.project;

    const result = applySemanticBroll(project, {
      placements: [
        {
          brollAssetId: video.id,
          startSeconds: 2.0, // Frame 60 a 30 fps
          endSeconds: 5.0,   // Frame 150 a 30 fps
          matchedKeywords: ['ciudad', 'noche'],
          score: 85,
          transcriptSnippet: 'Paseando por la ciudad de noche.',
        },
      ],
      overlayTrackName: 'B-Roll Overlay',
      transition: 'dissolve',
      muteAudio: true,
    });

    expect(result.placedCount).toBe(1);
    const brollTrack = result.project.timeline.tracks.find((t) => t.id === result.trackId)!;
    expect(brollTrack).toBeDefined();
    expect(brollTrack.label).toBe('B-Roll Overlay');

    const brollClip = result.project.timeline.clips.find((c) => c.trackId === result.trackId)!;
    expect(brollClip).toBeDefined();
    expect(brollClip.kind).toBe('video');
    expect(brollClip.startFrame).toBe(60);
    expect(brollClip.durationFrames).toBe(90); // 3 segundos a 30 fps
    expect(brollClip.audio?.muted).toBe(true);
    if (brollClip.kind === 'video') {
      expect(brollClip.transitionIn?.type).toBe('dissolve');
    }
  });
});
