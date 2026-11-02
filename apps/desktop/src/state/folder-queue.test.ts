import { describe, expect, it } from 'vitest';
import type { AudioPeaks, CopiedMedia, MediaProbe, VariantRendered } from '../services/project-service';
import type { ProjectDocument } from '@editor-ia/project-schema';
import { folderQueueSummary, runFolderQueue } from './folder-queue';

function peaks(): AudioPeaks {
  return {
    assetId: 'x',
    durationSeconds: 10,
    buckets: 50,
    peaks: Array.from({ length: 50 }, (_, index) => ({
      min: index > 20 && index < 30 ? -0.002 : -0.5,
      max: index > 20 && index < 30 ? 0.002 : 0.5,
    })),
  };
}

function probe(path: string): MediaProbe {
  const video = path.endsWith('.mp4');
  return {
    path,
    bytes: 2048,
    durationSeconds: 10,
    formatName: 'mp4',
    width: video ? 1920 : null,
    height: video ? 1080 : null,
    videoCodec: video ? 'h264' : null,
    audioCodec: video ? 'aac' : null,
    timecode: null,
  };
}

function fakeService(options?: { failRenderFor?: string }) {
  let written: ProjectDocument | null = null;
  const duration = (): number => {
    if (!written) return 10;
    const fps = written.video.frameRate.num / Math.max(1, written.video.frameRate.den);
    const end = written.timeline.clips.reduce(
      (max, clip) => Math.max(max, clip.startFrame + clip.durationFrames),
      0,
    );
    return fps > 0 ? end / fps : 10;
  };
  return {
    calls: { copied: 0, written: 0, rendered: 0 },
    async scanWatchFolder() {
      return [
        { path: 'C:\\in\\a.mp4', name: 'a.mp4', modifiedSeconds: 3, urls: [] },
        { path: 'C:\\in\\notas.txt', name: 'notas.txt', modifiedSeconds: 2, urls: [] },
        { path: 'C:\\in\\b.mp4', name: 'b.mp4', modifiedSeconds: 1, urls: [] },
      ];
    },
    async probeMediaFile(path: string) {
      const base = probe(path);
      return base.videoCodec && written
        ? { ...base, durationSeconds: duration() }
        : base;
    },
    async copyMediaInto(input: { directory: string; paths: readonly string[] }) {
      this.calls.copied += 1;
      return input.paths.map((path): CopiedMedia => ({
        source: path,
        relativePath: `media/${path.split('\\').pop()}`,
        bytes: 2048,
      }));
    },
    async writeProjectFile(input: { directory: string; fileName: string; project: unknown }) {
      written = input.project as ProjectDocument;
      this.calls.written += 1;
      return { path: `C:\\out\\${input.fileName}`, bytes: 512, copiedAssets: 0 };
    },
    async renderProjectVariant(input: { outputPath: string }): Promise<VariantRendered> {
      if (options?.failRenderFor && input.outputPath.includes(options.failRenderFor)) {
        throw new Error('el render falló');
      }
      this.calls.rendered += 1;
      return {
        path: input.outputPath,
        bytes: 4096,
        durationSeconds: duration(),
        width: 1920,
        height: 1080,
      };
    },
    async audioPeaksPath() {
      return peaks();
    },
  };
}

describe('runFolderQueue', () => {
  it('procesa sólo videos y entrega uno por archivo', async () => {
    const service = fakeService();
    const report = await runFolderQueue(service, {
      folder: 'C:\\in',
      outputDir: 'C:\\out',
    });
    expect(report.items).toHaveLength(2);
    expect(report.done).toBe(2);
    expect(report.failed).toBe(0);
    expect(service.calls.copied).toBe(2);
    expect(service.calls.written).toBe(2);
    expect(service.calls.rendered).toBe(2);
    expect(report.items[0]!.videoPath).toBe('C:\\out\\a.mp4');
    expect(report.items[0]!.message).toContain('verificado');
  });

  it('saltea un archivo sin pista de video sin frenar la cola', async () => {
    const service = fakeService();
    service.probeMediaFile = async (path: string) => ({
      ...probe(path),
      videoCodec: null,
      width: null,
      height: null,
    });
    const report = await runFolderQueue(service, { folder: 'C:\\in', outputDir: 'C:\\out' });
    expect(report.skipped).toBe(2);
    expect(report.done).toBe(0);
  });

  it('un render fallido no cancela los siguientes', async () => {
    const service = fakeService({ failRenderFor: 'a.mp4' });
    const report = await runFolderQueue(service, { folder: 'C:\\in', outputDir: 'C:\\out' });
    expect(report.failed).toBe(1);
    expect(report.done).toBe(1);
    expect(report.items[0]!.message).toContain('render falló');
  });

  it('avisa cuando la carpeta no tiene videos', async () => {
    const service = fakeService();
    service.scanWatchFolder = async () => [];
    const report = await runFolderQueue(service, { folder: 'C:\\vacia', outputDir: 'C:\\out' });
    expect(folderQueueSummary(report)).toBe('No encontré videos en la carpeta.');
  });
});
