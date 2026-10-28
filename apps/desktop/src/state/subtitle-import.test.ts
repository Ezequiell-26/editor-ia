import { describe, expect, it } from 'vitest';
import {
  CaptionCueSchema,
  createEmptyProject,
  parseProject,
} from '@editor-ia/project-schema';
import { ensureDelivery } from './project-actions';
import { importSubtitleFile } from './subtitle-import';
import { exportSubtitleCues } from './subtitle-export';
import { parseSubtitles } from './subtitles';

const NOW = '2026-10-20T00:00:00.000Z';

describe('importación de subtítulos validada contra el schema', () => {
  it('importa un SRT a la pista principal y todos los cues pasan CaptionCueSchema', () => {
    const project = ensureDelivery(createEmptyProject('Importar', NOW));
    const result = importSubtitleFile(project, {
      name: 'dialogo.srt',
      text:
        '1\n00:00:00,000 --> 00:00:01,500\nUno\n\n2\n00:00:02,000 --> 00:00:04,000\nDos\n',
    });

    expect(result.added).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.warnings).toEqual([]);
    const cues = result.project.captions.cues.filter(
      (cue) => cue.trackId === result.trackId,
    );
    expect(cues.map((cue) => [cue.startFrame, cue.endFrame])).toEqual([
      [0, 45],
      [60, 120],
    ]);
    for (const cue of cues) {
      expect(CaptionCueSchema.safeParse(cue).success).toBe(true);
    }
    expect(parseProject(result.project).ok).toBe(true);
  });

  it('importa VTT con tiempos fraccionarios', () => {
    const project = ensureDelivery(createEmptyProject('Importar', NOW));
    const result = importSubtitleFile(project, {
      name: 'dialogo.vtt',
      text: 'WEBVTT\n\n00:01.000 --> 00:03.500\nHola\n',
    });

    expect(result.added).toBe(1);
    const cues = result.project.captions.cues.filter(
      (cue) => cue.trackId === result.trackId,
    );
    expect(cues.map((cue) => [cue.startFrame, cue.endFrame])).toEqual([[30, 105]]);
    expect(cues[0]?.text).toBe('Hola');
    expect(CaptionCueSchema.safeParse(cues[0]).success).toBe(true);
  });

  it('omite el cue cuyo texto supera el límite del schema en vez de truncarlo', () => {
    const project = ensureDelivery(createEmptyProject('Importar', NOW));
    const largo = 'palabra '.repeat(70).trim(); // 560 caracteres
    const result = importSubtitleFile(project, {
      name: 'largo.srt',
      text: `1\n00:00:00,000 --> 00:00:01,000\n${largo}\n\n2\n00:00:02,000 --> 00:00:03,000\nBien\n`,
    });

    expect(result.added).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.warnings.some((warning) => warning.includes('largo.srt'))).toBe(
      true,
    );
    const texts = result.project.captions.cues.map((cue) => cue.text);
    expect(texts).toEqual(['Bien']);
    expect(parseProject(result.project).ok).toBe(true);
  });

  it('omite cues con tiempos fuera del rango de frames del proyecto', () => {
    const project = ensureDelivery(createEmptyProject('Importar', NOW));
    const result = importSubtitleFile(project, {
      name: 'lejos.srt',
      text:
        '1\n100:00:00,000 --> 100:00:01,000\nImposible\n\n2\n00:00:00,500 --> 00:00:01,000\nCerquita\n',
    });

    expect(result.added).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.warnings.length).toBe(1);
    const cues = result.project.captions.cues.filter(
      (cue) => cue.trackId === result.trackId,
    );
    expect(cues.map((cue) => cue.text)).toEqual(['Cerquita']);
    expect(parseProject(result.project).ok).toBe(true);
  });

  it('reemplaza la pista principal por defecto y conserva los avisos del parser', () => {
    const project = ensureDelivery(createEmptyProject('Importar', NOW));
    const first = importSubtitleFile(project, {
      name: 'uno.srt',
      text: '1\n00:00:00,000 --> 00:00:02,000\nViejo\n',
    });
    expect(first.added).toBe(1);

    const second = importSubtitleFile(first.project, {
      name: 'dos.srt',
      text: 'sin tiempos\n\n1\n00:00:01,000 --> 00:00:02,000\nNuevo\n',
    });

    expect(second.added).toBe(1);
    const cues = second.project.captions.cues.filter(
      (cue) => cue.trackId === second.trackId,
    );
    expect(cues.map((cue) => cue.text)).toEqual(['Nuevo']);
    expect(second.warnings).toContain('Bloque 1: no tiene una línea de tiempos.');
    expect(parseProject(second.project).ok).toBe(true);
  });

  it('un archivo sin cues válidos no cambia el proyecto y devuelve avisos', () => {
    const project = ensureDelivery(createEmptyProject('Importar', NOW));
    const result = importSubtitleFile(project, { text: '' });

    expect(result.added).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.project.captions.cues).toHaveLength(0);
  });

  it('cierra el ciclo: lo importado se reexporta a VTT con los mismos textos', () => {
    const project = ensureDelivery(createEmptyProject('Ciclo', NOW));
    const imported = importSubtitleFile(project, {
      name: 'dialogo.srt',
      text:
        '1\n00:00:00,000 --> 00:00:01,500\nUno\n\n2\n00:00:02,000 --> 00:00:03,500\nDos\n',
    });
    const cues = imported.project.captions.cues.filter(
      (cue) => cue.trackId === imported.trackId,
    );
    const file = exportSubtitleCues(cues, 30, 'vtt');
    const parsed = parseSubtitles(file.content);
    expect(parsed.format).toBe('vtt');
    expect(parsed.cues.map((cue) => cue.text)).toEqual(['Uno', 'Dos']);
    expect(parsed.cues.map((cue) => cue.startSeconds)).toEqual([0, 2]);
  });
});
