import { describe, expect, it } from 'vitest';
import { createEmptyProject, type ProjectDocument } from '@editor-ia/project-schema';
import type { AudioPeaks, FileLoudness, MediaProbe, VariantRendered } from '../services/project-service';
import { readyAsset } from '../test/fake-service';
import { addAsset, addClipFromAsset, ensureDelivery } from './project-actions';
import { autoPilotSummary, runAutoPilot } from './auto-pilot';

const NOW = '2026-11-02T00:00:00.000Z';

function peaks(pattern: readonly ('voz' | 'silencio')[]): AudioPeaks {
  return {
    assetId: 'asset',
    durationSeconds: pattern.length * 0.1,
    buckets: pattern.length,
    peaks: pattern.map((kind) =>
      kind === 'voz' ? { min: -0.5, max: 0.5 } : { min: -0.002, max: 0.002 },
    ),
  };
}

const WITH_SILENCE = peaks([
  ...Array.from({ length: 30 }, () => 'voz' as const),
  ...Array.from({ length: 20 }, () => 'silencio' as const),
]);

function projectWithClip(): ProjectDocument {
  const asset = readyAsset({
    kind: 'audio',
    label: 'Voz',
    source: { type: 'local', path: 'media/voz.wav' },
    media: { sampleRate: 48_000, channels: 1, durationFrames: 300 },
  });
  let project = addAsset(ensureDelivery(createEmptyProject('Piloto', NOW)), asset);
  const added = addClipFromAsset(project, asset, { atFrame: 0, durationFrames: 150 });
  project = added.project;
  return project;
}

function fakeService(options?: { durationOffset?: number; withAudio?: boolean; measuredLufs?: number; vmaf?: number | readonly number[] }) {
  let vmafCall = 0;
  let written: ProjectDocument | null = null;
  const expected = () => {
    if (!written) return 0;
    const fps = written.video.frameRate.num / Math.max(1, written.video.frameRate.den);
    const end = written.timeline.clips.reduce(
      (max, clip) => Math.max(max, clip.startFrame + clip.durationFrames),
      0,
    );
    return fps > 0 ? end / fps : 0;
  };
  return {
    calls: { written: 0, rendered: 0, probed: 0 },
    async audioPeaks(): Promise<AudioPeaks> {
      return WITH_SILENCE;
    },
    async writeProjectVariant(input: { directory: string; fileName: string; project: unknown }) {
      written = input.project as ProjectDocument;
      this.calls.written += 1;
      return { path: `${input.directory}\\${input.fileName}`, bytes: 512, copiedAssets: 0 };
    },
    async renderProjectVariant(input: {
      outputPath: string;
    }): Promise<VariantRendered> {
      this.calls.rendered += 1;
      return {
        path: input.outputPath,
        bytes: 4096,
        durationSeconds: expected() + (options?.durationOffset ?? 0),
        width: 1080,
        height: 1920,
      };
    },
    async measureVmaf(): Promise<number | null> {
      const sequence = options?.vmaf;
      if (Array.isArray(sequence)) {
        const value = sequence[Math.min(sequence.length - 1, vmafCall)] ?? null;
        vmafCall += 1;
        return value;
      }
      return (sequence as number | undefined) ?? 96;
    },
    async measureFileLoudness(): Promise<FileLoudness> {
      return {
        integratedLufs: options?.measuredLufs ?? -14,
        truePeakDb: -1,
        lraLu: 5,
      };
    },
    async probeMediaFile(path: string): Promise<MediaProbe> {
      this.calls.probed += 1;
      return {
        path,
        bytes: 4096,
        durationSeconds: expected() + (options?.durationOffset ?? 0),
        formatName: 'mp4',
        width: 1080,
        height: 1920,
        videoCodec: 'h264',
        audioCodec: options?.withAudio === false ? null : 'aac',
        timecode: null,
      };
    },
  };
}

describe('runAutoPilot', () => {
  it('mide, limpia, exporta y verifica el MP4', async () => {
    const project = projectWithClip();
    const service = fakeService();
    const report = await runAutoPilot({
      project,
      service,
      options: { outputDir: 'C:\\entregas' },
    });
    expect(service.calls.written).toBe(1);
    expect(service.calls.rendered).toBe(1);
    expect(service.calls.probed).toBe(1);
    expect(report.projectPath).toBe('C:\\entregas\\piloto.editoria.json');
    expect(report.videoPath).toBe('C:\\entregas\\piloto.mp4');
    expect(report.profileId.length).toBeGreaterThan(0);
    expect(report.project.renderProfiles.length).toBeGreaterThanOrEqual(3);
    expect(report.verified).toBe(true);
    expect(report.warnings).toEqual([]);
    expect(report.loudness.correctionDb).toBe(0);
    expect(report.loudness.measuredLufs).toBe(-14);
    expect(service.calls.rendered).toBe(1);
    expect(report.cleanup.silenceCuts).toBeGreaterThan(0);
    expect(report.profile.silenceThresholdDb).toBeLessThan(-20);
  });

  it('declara la diferencia de duración en vez de darla por buena', async () => {
    const project = projectWithClip();
    const service = fakeService({ durationOffset: 10 });
    const report = await runAutoPilot({
      project,
      service,
      options: { outputDir: 'C:\\entregas' },
    });
    expect(report.verified).toBe(false);
    expect(report.warnings.join(' ')).toContain('no coincide con la timeline');
    expect(autoPilotSummary(report)).toContain('revisar avisos');
  });

  it('avisa si el MP4 quedó sin audio', async () => {
    const project = projectWithClip();
    const service = fakeService({ withAudio: false });
    const report = await runAutoPilot({
      project,
      service,
      options: { outputDir: 'C:\\entregas' },
    });
    expect(report.verified).toBe(false);
    expect(report.warnings).toContain('el MP4 no tiene pista de audio');
  });

  it('agrega los perfiles de entrega cuando el proyecto no tiene', async () => {
    const project = projectWithClip();
    project.renderProfiles = [];
    const report = await runAutoPilot({
      project,
      service: fakeService(),
      options: { outputDir: 'C:\\entregas' },
    });
    expect(report.project.renderProfiles.length).toBeGreaterThanOrEqual(3);
    expect(report.profileId.length).toBeGreaterThan(0);
  });

  it('sin picos medibles usa el perfil conservador y sigue', async () => {
    const project = projectWithClip();
    const service = fakeService();
    service.audioPeaks = async () => {
      throw new Error('sin audio');
    };
    const report = await runAutoPilot({
      project,
      service,
      options: { outputDir: 'C:\\entregas' },
    });
    expect(report.profile.denoise).toBe('medium');
    expect(report.verified).toBe(true);
  });

  it('corrige el master y reexporta si el MP4 quedó lejos del objetivo', async () => {
    const project = projectWithClip();
    const service = fakeService({ measuredLufs: -20 });
    const report = await runAutoPilot({
      project,
      service,
      options: { outputDir: 'C:////entregas' },
    });
    expect(report.loudness.correctionDb).toBe(6);
    expect(report.loudness.targetLufs).toBe(-14);
    expect(service.calls.rendered).toBe(2);
    expect(report.project.audio.master.gainDb).toBe(6);
  });

  it('sin medición del archivo entrega igual y lo declara', async () => {
    const project = projectWithClip();
    const service = fakeService();
    service.measureFileLoudness = async () => {
      throw new Error('sin ffmpeg');
    };
    const report = await runAutoPilot({
      project,
      service,
      options: { outputDir: 'C:////entregas' },
    });
    expect(report.loudness.measuredLufs).toBeNull();
    expect(report.loudness.correctionDb).toBe(0);
    expect(service.calls.rendered).toBe(1);
  });

  it('verifica la calidad contra un render de referencia cuando se pide', async () => {
    const project = projectWithClip();
    const service = fakeService({ vmaf: 96 });
    const report = await runAutoPilot({
      project,
      service,
      options: { outputDir: 'C:////entregas', qualityCheck: true },
    });
    expect(report.quality.vmaf).toBe(96);
    expect(report.quality.referenceProfileId).not.toBeNull();
    expect(report.quality.adjustedProfileId).toBeNull();
    expect(service.calls.rendered).toBe(2);
  });

  it('baja el CRF y reexporta si el VMAF no llega al objetivo', async () => {
    const project = projectWithClip();
    const service = fakeService({ vmaf: [88, 95] });
    const report = await runAutoPilot({
      project,
      service,
      options: { outputDir: 'C:////entregas', qualityCheck: true, targetVmaf: 93 },
    });
    expect(report.quality.vmaf).toBe(95);
    expect(report.quality.adjustedProfileId).not.toBeNull();
    expect(report.project.renderProfiles.length).toBeGreaterThan(project.renderProfiles.length);
    expect(service.calls.rendered).toBe(3);
  });

  it('sin pedir calidad no gasta renders extra', async () => {
    const project = projectWithClip();
    const service = fakeService({ vmaf: 80 });
    const report = await runAutoPilot({
      project,
      service,
      options: { outputDir: 'C:////entregas' },
    });
    expect(report.quality.vmaf).toBeNull();
    expect(service.calls.rendered).toBe(1);
  });

  it('resume la entrega verificada', async () => {
    const project = projectWithClip();
    const report = await runAutoPilot({
      project,
      service: fakeService(),
      options: { outputDir: 'C:\\entregas' },
    });
    expect(autoPilotSummary(report)).toContain('MP4 verificado');
  });
});
