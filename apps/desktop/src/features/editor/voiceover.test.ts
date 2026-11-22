import { describe, expect, it } from 'vitest';
import {
  blobToWavPcm,
  bytesToBase64,
  encodeWavPcm16,
  formatVoiceoverElapsed,
  pickVoiceoverMimeType,
  VOICEOVER_MIME_CANDIDATES,
  voiceoverExtensionForMime,
  voiceoverFileName,
  type PcmAudioSource,
} from './voiceover';

describe('pickVoiceoverMimeType', () => {
  it('devuelve el primer candidato soportado', () => {
    const mime = pickVoiceoverMimeType((candidate) =>
      candidate === 'audio/mp4' ? true : false,
    );
    expect(mime).toBe('audio/mp4');
  });

  it('cae al primer candidato cuando no hay probe', () => {
    expect(pickVoiceoverMimeType()).toBe(VOICEOVER_MIME_CANDIDATES[0]);
  });

  it('devuelve null si ningún formato está soportado', () => {
    expect(pickVoiceoverMimeType(() => false)).toBeNull();
  });

  it('ignora un probe que explota y sigue con el resto', () => {
    const mime = pickVoiceoverMimeType((candidate) => {
      if (candidate.includes('webm')) throw new Error('probe roto');
      return candidate === 'audio/mp4';
    });
    expect(mime).toBe('audio/mp4');
  });
});

describe('voiceoverExtensionForMime', () => {
  it('mapea webm/opus a webm (opus no confunde el nombre)', () => {
    expect(voiceoverExtensionForMime('audio/webm;codecs=opus')).toBe('webm');
    expect(voiceoverExtensionForMime('audio/webm')).toBe('webm');
  });

  it('mapea ogg y mp4', () => {
    expect(voiceoverExtensionForMime('audio/ogg;codecs=opus')).toBe('ogg');
    expect(voiceoverExtensionForMime('audio/mp4')).toBe('m4a');
    expect(voiceoverExtensionForMime('')).toBe('webm');
  });
});

describe('voiceoverFileName', () => {
  it('genera voz-AAAAMMDD-HHMMSS.ext en hora local', () => {
    const date = new Date(2026, 10, 20, 14, 30, 5);
    expect(voiceoverFileName(date, 'wav')).toBe('voz-20261120-143005.wav');
    expect(voiceoverFileName(date, 'WEBM')).toBe('voz-20261120-143005.webm');
  });

  it('sanitiza extensiones raras a webm', () => {
    expect(voiceoverFileName(new Date(2026, 0, 2, 3, 4, 5), '../../exe')).toBe(
      'voz-20260102-030405.webm',
    );
  });
});

function pcmSource(
  channels: Float32Array[],
  sampleRate = 48_000,
): PcmAudioSource {
  return {
    numberOfChannels: channels.length,
    length: channels[0]?.length ?? 0,
    sampleRate,
    getChannelData: (channel: number) => channels[channel] ?? new Float32Array(0),
  };
}

describe('encodeWavPcm16', () => {
  it('escribe una cabecera RIFF/WAVE PCM16 válida', () => {
    const mono = new Float32Array([0, 0.5, -0.5, 1]);
    const wav = encodeWavPcm16(pcmSource([mono], 8_000));
    const view = new DataView(wav);
    const ascii = (offset: number, length: number) =>
      String.fromCharCode(...new Uint8Array(wav, offset, length));
    expect(ascii(0, 4)).toBe('RIFF');
    expect(ascii(8, 4)).toBe('WAVE');
    expect(ascii(12, 4)).toBe('fmt ');
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(8_000);
    expect(view.getUint16(34, true)).toBe(16); // bits
    expect(view.getUint32(40, true)).toBe(4 * 2); // data size
    expect(wav.byteLength).toBe(44 + 8);
    // Muestras: 0 → 0, 0.5 → ~16383, -0.5 → ~-16384, 1 → 32767.
    expect(view.getInt16(44, true)).toBe(0);
    expect(view.getInt16(46, true)).toBe(16384);
    expect(view.getInt16(48, true)).toBe(-16384);
    expect(view.getInt16(50, true)).toBe(32767);
  });

  it('intercala canales estéreo y clampea fuera de rango', () => {
    const left = new Float32Array([1, -2]);
    const right = new Float32Array([0.25, 0]);
    const wav = encodeWavPcm16(pcmSource([left, right], 48_000));
    const view = new DataView(wav);
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(40, true)).toBe(2 * 2 * 2);
    // frame0: L=1→32767, R=0.25→8192; frame1: L=-2→-32768, R=0→0.
    expect(view.getInt16(44, true)).toBe(32767);
    expect(view.getInt16(46, true)).toBe(8192);
    expect(view.getInt16(48, true)).toBe(-32768);
    expect(view.getInt16(50, true)).toBe(0);
  });
});

describe('blobToWavPcm', () => {
  it('devuelve null sin Web Audio (jsdom)', async () => {
    const blob = new Blob(['audio'], { type: 'audio/webm' });
    await expect(blobToWavPcm(blob)).resolves.toBeNull();
  });
});

describe('bytesToBase64 / formatVoiceoverElapsed', () => {
  it('codifica bytes en base64', () => {
    expect(bytesToBase64(new Uint8Array([104, 101, 108, 108, 111]))).toBe('aGVsbG8=');
  });

  it('formatea m:ss', () => {
    expect(formatVoiceoverElapsed(0)).toBe('0:00');
    expect(formatVoiceoverElapsed(7.9)).toBe('0:07');
    expect(formatVoiceoverElapsed(65)).toBe('1:05');
    expect(formatVoiceoverElapsed(-3)).toBe('0:00');
  });
});
