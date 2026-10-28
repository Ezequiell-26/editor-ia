import { describe, expect, it } from 'vitest';
import {
  createEmptyProject,
  parseProject,
  type CaptionCue,
} from '@editor-ia/project-schema';
import { ensureDelivery } from './project-actions';
import { importSubtitleCues } from './project-actions';
import {
  cueWordsAt,
  parseSubtitles,
  serializeSrt,
  serializeSrtSeconds,
  serializeVttSeconds,
} from './subtitles';

const NOW = '2026-10-20T00:00:00.000Z';

describe('revelado por palabra', () => {
  const cue = {
    id: '11111111-1111-4111-8111-111111111111',
    trackId: '22222222-2222-4222-8222-222222222222',
    text: 'Hola mundo',
    language: 'es',
    startFrame: 0,
    endFrame: 30,
    wordReveal: true,
    words: [
      { text: 'Hola', startFrame: 0, endFrame: 10 },
      { text: 'mundo', startFrame: 15, endFrame: 30 },
    ],
  } as CaptionCue;

  it('crece con el playhead y devuelve todas sin reveal', () => {
    expect(cueWordsAt(cue, 0).map((word) => word.text)).toEqual(['Hola']);
    expect(cueWordsAt(cue, 12).map((word) => word.text)).toEqual(['Hola']);
    expect(cueWordsAt(cue, 15).map((word) => word.text)).toEqual(['Hola', 'mundo']);
    expect(cueWordsAt({ ...cue, wordReveal: false }, 0)).toHaveLength(2);
  });
});

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

  it('parsea SRT sin línea en blanco entre cues', () => {
    const parsed = parseSubtitles(
      '1\n00:00:00,500 --> 00:00:02,000\nHola\n2\n00:00:03,000 --> 00:00:04,000\nChau\n',
    );
    expect(parsed.cues).toEqual([
      { startSeconds: 0.5, endSeconds: 2, text: 'Hola' },
      { startSeconds: 3, endSeconds: 4, text: 'Chau' },
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

  it('importa ASS con estilos y saltos de línea sin perder el texto', () => {
    const ass = [
      '[Script Info]',
      'ScriptType: v4.00+',
      '',
      '[V4+ Styles]',
      'Format: Name, Fontname',
      'Style: Default,Arial',
      '',
      '[Events]',
      'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
      'Dialogue: 0,0:00:00.50,0:00:02.00,Default,,0,0,0,,{\\pos(960,540)}Hola y bienvenidos\\Nal canal',
      'Dialogue: 0,0:00:03.00,0:00:04.25,Default,,0,0,0,,Adiós',
      '',
    ].join('\n');
    const parsed = parseSubtitles(ass);

    expect(parsed.format).toBe('ass');
    expect(parsed.warnings).toEqual([]);
    expect(parsed.cues).toEqual([
      { startSeconds: 0.5, endSeconds: 2, text: 'Hola y bienvenidos al canal' },
      { startSeconds: 3, endSeconds: 4.25, text: 'Adiós' },
    ]);
  });

  it('distingue SSA de ASS por la cabecera', () => {
    const ssa = [
      '[Script Info]',
      'ScriptType: v4.00',
      '',
      '[V4 Styles]',
      'Format: Name, Fontname',
      'Style: Default,Arial',
      '',
      '[Events]',
      'Format: Marked, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
      'Dialogue: Marked=0,0:00:01.00,0:00:02.00,Default,,0,0,0,,Hola',
      '',
    ].join('\n');
    const parsed = parseSubtitles(ssa);
    expect(parsed.format).toBe('ssa');
    expect(parsed.cues).toEqual([{ startSeconds: 1, endSeconds: 2, text: 'Hola' }]);
  });

  it('avisa cuando un ASS no tiene diálogos utilizables', () => {
    const parsed = parseSubtitles(
      '[Script Info]\nScriptType: v4.00+\n\n[Events]\nDialogue: 0,0:00:05.00,0:00:04.00,Default,,0,0,0,,Al revés\n',
    );
    expect(parsed.format).toBe('ass');
    expect(parsed.cues).toHaveLength(0);
    expect(parsed.warnings.length).toBeGreaterThan(0);
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

describe('serialización para localización', () => {
  const cues = [
    { startSeconds: 2.5, endSeconds: 4, text: ' Dos ' },
    { startSeconds: 0, endSeconds: 1.25, text: 'Uno' },
    { startSeconds: 4, endSeconds: 4, text: 'Inválido' },
  ];

  it('ordena y serializa SRT desde segundos', () => {
    const srt = serializeSrtSeconds(cues);
    expect(srt).toContain('1\n00:00:00,000 --> 00:00:01,250\nUno');
    expect(srt).toContain('2\n00:00:02,500 --> 00:00:04,000\nDos');
    expect(srt).not.toContain('Inválido');
    expect(parseSubtitles(srt).cues).toHaveLength(2);
  });

  it('serializa VTT con cabecera y punto decimal', () => {
    const vtt = serializeVttSeconds(cues);
    expect(vtt.startsWith('WEBVTT\n\n')).toBe(true);
    expect(vtt).toContain('00:00:02.500 --> 00:00:04.000');
    expect(parseSubtitles(vtt).cues.map((cue) => cue.text)).toEqual(['Uno', 'Dos']);
  });

  it('devuelve un documento válido aunque no haya cues', () => {
    expect(serializeSrtSeconds([])).toBe('');
    expect(serializeVttSeconds([])).toBe('WEBVTT\n\n');
  });
});
