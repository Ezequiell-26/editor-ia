import { describe, expect, it } from 'vitest';
import { createEmptyProject, parseProject } from '@editor-ia/project-schema';
import { ensureDelivery } from './project-actions';
import { importSubtitleCues } from './project-actions';
import { parseSubtitles, serializeSrt } from './subtitles';

const NOW = '2026-10-20T00:00:00.000Z';

describe('SRT/VTT', () => {
  it('parsea SRT con BOM, CRLF, varias líneas y etiquetas', () => {
    const content =
      '\uFEFF1\r\n00:00:00,500 --> 00:00:02,000\r\nHola <i>mundo</i>\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,250\r\nSegunda línea\r\ncon salto\r\n';
    const parsed = parseSubtitles(content);

    expect(parsed.format).toBe('srt');
    expect(parsed.warnings).toEqual([]);
    expect(parsed.cues).toEqual([
      { startSeconds: 0.5, endSeconds: 2, text: 'Hola mundo' },
      { startSeconds: 3, endSeconds: 4.25, text: 'Segunda línea con salto' },
    ]);
  });

  it('parsea VTT con tiempos sin horas', () => {
    const parsed = parseSubtitles(
      'WEBVTT\n\n00:01.000 --> 00:03.500\nHola\n\n00:04.000 --> 00:05.000\nChau\n',
    );
    expect(parsed.format).toBe('vtt');
    expect(parsed.cues).toEqual([
      { startSeconds: 1, endSeconds: 3.5, text: 'Hola' },
      { startSeconds: 4, endSeconds: 5, text: 'Chau' },
    ]);
  });

  it('omite bloques inválidos y avisa sin romper', () => {
    const parsed = parseSubtitles(
      'sin tiempos\n\n1\n00:00:05,000 --> 00:00:04,000\nAl revés\n\n2\n00:00:06,000 --> 00:00:07,000\nBien\n',
    );
    expect(parsed.cues).toHaveLength(1);
    expect(parsed.cues[0]?.text).toBe('Bien');
    expect(parsed.warnings.length).toBeGreaterThanOrEqual(2);
  });

  it('serializa frames a SRT y vuelve a parsearlos', () => {
    const srt = serializeSrt(
      [
        { startFrame: 0, endFrame: 45, text: 'Uno' },
        { startFrame: 60, endFrame: 90, text: 'Dos' },
      ],
      30,
    );
    expect(srt).toContain('00:00:00,000 --> 00:00:01,500');
    expect(srt).toContain('00:00:02,000 --> 00:00:03,000');
    const parsed = parseSubtitles(srt);
    expect(parsed.cues.map((cue) => cue.text)).toEqual(['Uno', 'Dos']);
  });

  it('importa subtítulos a la pista principal y reemplaza sin tocar títulos', () => {
    const project = ensureDelivery(createEmptyProject('Subs', NOW));
    const first = importSubtitleCues(project, [
      { startSeconds: 0, endSeconds: 1.5, text: 'Uno' },
      { startSeconds: 2, endSeconds: 4, text: 'Dos' },
    ]);
    expect(first.added).toBe(2);
    const cues = first.project.captions.cues.filter((cue) => cue.trackId === first.trackId);
    expect(cues.map((cue) => [cue.startFrame, cue.endFrame])).toEqual([
      [0, 45],
      [60, 120],
    ]);
    expect(parseProject(first.project).ok).toBe(true);

    const second = importSubtitleCues(first.project, [
      { startSeconds: 1, endSeconds: 2, text: 'Solo' },
    ]);
    const remaining = second.project.captions.cues.filter(
      (cue) => cue.trackId === second.trackId,
    );
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.text).toBe('Solo');
  });
});
