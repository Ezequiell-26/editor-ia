import { describe, expect, it } from 'vitest';
import {
  exportSubtitleCues,
  serializeAss,
  serializeVtt,
} from './subtitle-export';
import { parseSubtitles, serializeSrt } from './subtitles';

const CUES = [
  { startFrame: 0, endFrame: 45, text: 'Uno' },
  { startFrame: 60, endFrame: 105, text: 'Dos' },
];

describe('exportación de subtítulos', () => {
  it('exporta SRT con el mismo serializador del pipeline existente', () => {
    const file = exportSubtitleCues(CUES, 30, 'srt');
    expect(file.extension).toBe('srt');
    expect(file.mimeType).toBe('application/x-subrip;charset=utf-8');
    expect(file.content).toBe(serializeSrt(CUES, 30));
    expect(file.content).toContain('00:00:00,000 --> 00:00:01,500');
    expect(parseSubtitles(file.content).cues.map((cue) => cue.text)).toEqual([
      'Uno',
      'Dos',
    ]);
  });

  it('exporta VTT con cabecera y tiempos en punto decimal', () => {
    const file = exportSubtitleCues(CUES, 30, 'vtt');
    expect(file.extension).toBe('vtt');
    expect(file.mimeType).toBe('text/vtt;charset=utf-8');
    expect(file.content.startsWith('WEBVTT\n\n')).toBe(true);
    expect(file.content).toContain('00:00:00.000 --> 00:00:01.500');
    expect(file.content).toContain('00:00:02.000 --> 00:00:03.500');
    const parsed = parseSubtitles(file.content);
    expect(parsed.format).toBe('vtt');
    expect(parsed.cues).toEqual([
      { startSeconds: 0, endSeconds: 1.5, text: 'Uno' },
      { startSeconds: 2, endSeconds: 3.5, text: 'Dos' },
    ]);
  });

  it('exporta ASS con header v4.00+, estilo Default y dialogues', () => {
    const file = exportSubtitleCues(CUES, 30, 'ass');
    expect(file.extension).toBe('ass');
    expect(file.mimeType).toBe('text/x-ssa;charset=utf-8');
    expect(file.content).toContain('[Script Info]');
    expect(file.content).toContain('ScriptType: v4.00+');
    expect(file.content).toContain('PlayResX: 1920');
    expect(file.content).toContain('PlayResY: 1080');
    expect(file.content).toContain(
      'Dialogue: 0,0:00:00.00,0:00:01.50,Default,,0,0,0,,Uno',
    );
    expect(file.content).toContain(
      'Dialogue: 0,0:00:02.00,0:00:03.50,Default,,0,0,0,,Dos',
    );
    const parsed = parseSubtitles(file.content);
    expect(parsed.format).toBe('ass');
    expect(parsed.warnings).toEqual([]);
    expect(parsed.cues).toEqual([
      { startSeconds: 0, endSeconds: 1.5, text: 'Uno' },
      { startSeconds: 2, endSeconds: 3.5, text: 'Dos' },
    ]);
  });

  it('respeta PlayResX y PlayResY si se piden', () => {
    const ass = serializeAss(CUES, 30, { playResX: 3840, playResY: 2160 });
    expect(ass).toContain('PlayResX: 3840');
    expect(ass).toContain('PlayResY: 2160');
  });

  it('convierte saltos de línea en \\N y quita etiquetas de override en ASS', () => {
    const ass = serializeAss(
      [{ startFrame: 0, endFrame: 30, text: 'Hola\nmundo {\\pos(1,2)}ahora' }],
      30,
    );
    expect(ass).toContain('Dialogue: 0,0:00:00.00,0:00:01.00,Default,,0,0,0,,Hola\\Nmundo ahora');
    expect(parseSubtitles(ass).cues[0]?.text).toBe('Hola mundo ahora');
  });

  it('ordena los cues y descarta los que no sirven', () => {
    const file = exportSubtitleCues(
      [
        { startFrame: 60, endFrame: 105, text: 'Dos' },
        { startFrame: 0, endFrame: 45, text: 'Uno' },
        { startFrame: 200, endFrame: 100, text: 'Al revés' },
        { startFrame: 300, endFrame: 330, text: '   ' },
      ],
      30,
      'vtt',
    );
    expect(file.content).not.toContain('Al revés');
    expect(parseSubtitles(file.content).cues.map((cue) => cue.text)).toEqual([
      'Uno',
      'Dos',
    ]);
  });

  it('devuelve documentos válidos aunque no haya cues', () => {
    expect(exportSubtitleCues([], 30, 'srt').content).toBe('');
    expect(exportSubtitleCues([], 30, 'vtt').content).toBe('WEBVTT\n\n');
    const ass = exportSubtitleCues([], 30, 'ass').content;
    expect(ass).toContain('[Events]');
    expect(ass).not.toContain('Dialogue:');
  });

  it('cae a 30 fps cuando el proyecto no tiene una tasa válida', () => {
    const file = exportSubtitleCues([{ startFrame: 0, endFrame: 45, text: 'Uno' }], 0, 'vtt');
    expect(file.content).toContain('00:00:00.000 --> 00:00:01.500');
  });
});
