import { describe, expect, it } from 'vitest';
import { validateExportFile, type ExportProbe } from './export-validation';

const expected = {
  videoCodec: 'h264',
  audioCodec: 'aac',
  width: 1920,
  height: 1080,
  durationSeconds: 10,
  expectedBytes: 1_000_000,
};

function probe(overrides: Partial<ExportProbe> = {}): ExportProbe {
  return {
    bytes: 1_000_000,
    durationSeconds: 10,
    width: 1920,
    height: 1080,
    videoCodec: 'h264',
    audioCodec: 'aac',
    formatName: 'mov,mp4,m4a,3gp,3g2,mj2',
    ...overrides,
  };
}

describe('validación FFprobe del export', () => {
  it('pasa cuando el archivo coincide con el perfil', () => {
    const report = validateExportFile(probe(), expected);
    expect(report.status).toBe('pass');
    expect(report.findings.every((finding) => finding.level === 'ok')).toBe(true);
    expect(report.findings.map((finding) => finding.label)).toContain('Códec de video');
  });

  it('advierte resolución, códec y duración distintas sin romper', () => {
    const report = validateExportFile(
      probe({ width: 1280, height: 720, videoCodec: 'hevc', durationSeconds: 12.5 }),
      expected,
    );
    expect(report.status).toBe('warn');
    expect(report.findings.some((finding) => /Resolución distinta/.test(finding.label))).toBe(true);
    expect(report.findings.some((finding) => /Códec distinto/.test(finding.label))).toBe(true);
    expect(report.findings.some((finding) => /Duración distinta/.test(finding.label))).toBe(true);
  });

  it('falla si el archivo está vacío', () => {
    const report = validateExportFile(probe({ bytes: 0 }), expected);
    expect(report.status).toBe('fail');
    expect(report.findings.some((finding) => finding.label === 'Archivo vacío')).toBe(true);
  });

  it('advierte audio ausente y acepta alias de códec', () => {
    const missingAudio = validateExportFile(probe({ audioCodec: null }), expected);
    expect(missingAudio.findings.some((finding) => /no hay pista de audio/.test(finding.detail))).toBe(true);
    const aliases = validateExportFile(
      probe({ videoCodec: 'avc1', audioCodec: 'mp4a' }),
      expected,
    );
    expect(aliases.status).toBe('pass');
  });
});
