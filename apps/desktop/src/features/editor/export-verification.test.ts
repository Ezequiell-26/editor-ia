import { describe, expect, it } from 'vitest';
import { validateExportVerification } from './export-validation';

const expected = {
  videoCodec: 'h264',
  audioCodec: 'aac',
  width: 1920,
  height: 1080,
  durationSeconds: 10,
  expectedBytes: 1_000_000,
};

function verification(overrides: Record<string, unknown> = {}) {
  return {
    container: 'mp4',
    videoCodec: 'h264',
    audioCodec: 'aac',
    width: 1920,
    height: 1080,
    fpsNum: 30,
    fpsDen: 1,
    pixelFormat: 'yuv420p',
    videoBitrate: 8_000_000,
    audioBitrate: 192_000,
    colorSpace: 'bt709',
    colorTransfer: 'bt709',
    colorPrimaries: 'bt709',
    hdr: false,
    durationSeconds: 10,
    bytes: 1_000_000,
    warnings: [] as string[],
    ...overrides,
  };
}

describe('validación con verifyExport (contrato nuevo)', () => {
  it('pasa con un archivo SDR correcto e incluye fps/pixel format', () => {
    const report = validateExportVerification(verification(), expected);
    expect(report.status).toBe('pass');
    expect(report.findings.map((finding) => finding.label)).toEqual(
      expect.arrayContaining(['FPS', 'Pixel format', 'Rango dinámico']),
    );
    expect(report.findings.find((finding) => finding.label === 'Rango dinámico')?.detail).toBe('SDR');
  });

  it('advierte HDR inesperado y warnings del backend', () => {
    const report = validateExportVerification(
      verification({ hdr: true, warnings: ['pico de audio cerca de 0 dBFS'] }),
      expected,
    );
    expect(report.status).toBe('warn');
    expect(report.findings.some((finding) => finding.label === 'HDR')).toBe(true);
    expect(report.findings.some((finding) => /pico de audio/.test(finding.detail))).toBe(true);
  });

  it('falla con archivo vacío', () => {
    const report = validateExportVerification(verification({ bytes: 0 }), expected);
    expect(report.status).toBe('fail');
  });
});
