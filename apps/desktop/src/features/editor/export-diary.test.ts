import { describe, expect, it } from 'vitest';
import type { RenderDiaryEntry } from '../../services/contracts/render';
import { classifyDiaryEntry } from './export-diary';

function entry(overrides: Partial<RenderDiaryEntry>): RenderDiaryEntry {
  return {
    ts: 1_700_000_000_000,
    jobId: 'job-1',
    project: 'demo',
    profile: '1080p',
    codec: 'h264',
    encoder: 'software',
    status: 'failed',
    elapsedMs: 12_000,
    ...overrides,
  };
}

describe('classifyDiaryEntry', () => {
  it('ignora entradas que no fallaron', () => {
    expect(classifyDiaryEntry(entry({ status: 'completed' })).label).toBe('');
    expect(classifyDiaryEntry(entry({ status: 'cancelled' })).label).toBe('');
  });

  it('clasifica fallos de GPU por el hint del encoder', () => {
    const gpu = classifyDiaryEntry(
      entry({
        message:
          'ffmpeg no pudo completar el render: el encoder de hardware falló (device removed). Probá exportar con el encoder de software.',
      }),
    );
    expect(gpu.kind).toBe('gpu');
    expect(gpu.label).toBe('GPU/encoder');
  });

  it('clasifica NVENC/QSV/D3D11 como GPU', () => {
    for (const message of [
      'Error NVENC: out of memory',
      'qsv init failed',
      'D3D11 device lost',
    ]) {
      expect(classifyDiaryEntry(entry({ message })).kind).toBe('gpu');
    }
  });

  it('clasifica errores de verificación/publicación antes que de medio', () => {
    const verify = classifyDiaryEntry(
      entry({
        code: 'RENDER_FAILED',
        message: 'ffprobe reportó una duración distinta a la esperada',
      }),
    );
    expect(verify.kind).toBe('verify');
  });

  it('clasifica errores de medio/codec', () => {
    const media = classifyDiaryEntry(
      entry({ message: 'codec h264 no encontrado en el stream de entrada' }),
    );
    expect(media.kind).toBe('media');
  });

  it('clasifica problemas de disco por palabra clave', () => {
    const disk = classifyDiaryEntry(
      entry({ message: 'no space left on device al escribir la salida' }),
    );
    expect(disk.kind).toBe('disk');
  });

  it('cae en «Error» cuando no hay palabra clave', () => {
    const other = classifyDiaryEntry(entry({ message: 'algo inesperado' }));
    expect(other.kind).toBe('other');
    expect(other.label).toBe('Error');
  });
});
