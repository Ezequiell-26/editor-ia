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
  const deleted: string[] = [];
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
    deleted,
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
        sha256: 'a'.repeat(64),
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
    async deletePath(path: string) {
      deleted.push(path);
      return { path, recursive: false };
    },
  };
}

describe('runFolderQueue', () => {
  it('procesa sólo videos y entrega uno por archivo', async () => {
    const service = fakeService();
    const report = await runFolderQueue(service, {
      folder: 'C:\\in',
      outputDir: 'C:\\out',
      rightsConfirmed: true,
    });
    expect(report.items).toHaveLength(2);
    expect(report.done).toBe(2);
    expect(report.failed).toBe(0);
    expect(service.calls.copied).toBe(2);
    expect(service.calls.written).toBe(2);
    expect(service.calls.rendered).toBe(2);
    expect(report.items[0]!.videoPath).toBe('C:\\out\\a-mp4.mp4');
    expect(report.items[0]!.message).toContain('verificado');
  });

  it('declara en el proyecto el SHA-256 real del material copiado (AUD-135)', async () => {
    const service = fakeService();
    let written: ProjectDocument | null = null;
    const original = service.writeProjectFile.bind(service);
    service.writeProjectFile = async (input) => {
      written = input.project as ProjectDocument;
      return original(input);
    };
    const report = await runFolderQueue(service, {
      folder: 'C:\\in',
      outputDir: 'C:\\out',
      rightsConfirmed: true,
    });
    expect(report.done).toBe(2);
    const asset = (written as ProjectDocument | null)?.assets[0];
    expect(asset?.status).toBe('ready');
    expect(asset?.integrity?.sha256).toBe('a'.repeat(64));
    expect(asset?.integrity?.sha256).not.toBe('0'.repeat(64));
  });

  it('rechaza la corrida sin declaración explícita de derechos (QUEUE-140)', async () => {
    const service = fakeService();
    let written = false;
    service.writeProjectFile = async () => {
      written = true;
      throw new Error('no debería escribirse');
    };
    await expect(
      runFolderQueue(service, { folder: 'C:\\in', outputDir: 'C:\\out' }),
    ).rejects.toThrow('derechos de uso comercial');
    // Fail-fast: ni siquiera se escaneó la carpeta ni se copió material.
    expect(written).toBe(false);
    expect(service.calls.copied).toBe(0);
  });

  it('mismo nombre con distinta extensión no colisiona en la entrega (AUD-136)', async () => {
    const service = fakeService();
    service.scanWatchFolder = async () => [
      { path: 'C:\\in\\toma.mp4', name: 'toma.mp4', modifiedSeconds: 2, urls: [] },
      { path: 'C:\\in\\toma.mov', name: 'toma.mov', modifiedSeconds: 1, urls: [] },
    ];
    service.probeMediaFile = async (path: string) => ({
      ...probe(path),
      videoCodec: 'h264',
      width: 1920,
      height: 1080,
    });
    const names: string[] = [];
    const original = service.writeProjectFile.bind(service);
    service.writeProjectFile = async (input) => {
      names.push(input.fileName);
      return original(input);
    };
    const report = await runFolderQueue(service, {
      folder: 'C:\\in',
      outputDir: 'C:\\out',
      rightsConfirmed: true,
    });
    expect(report.done).toBe(2);
    expect(names).toContain('toma-mp4.editoria.json');
    expect(names).toContain('toma-mov.editoria.json');
    expect(new Set(names).size).toBe(2);
  });

  it('stems que sanean igual no comparten proyecto ni MP4 (AUD-136)', async () => {
    const service = fakeService();
    service.scanWatchFolder = async () => [
      { path: 'C:\\in\\toma final.mp4', name: 'toma final.mp4', modifiedSeconds: 2, urls: [] },
      { path: 'C:\\in\\toma-final.mp4', name: 'toma-final.mp4', modifiedSeconds: 1, urls: [] },
    ];
    service.probeMediaFile = async (path: string) => ({
      ...probe(path),
      videoCodec: 'h264',
      width: 1920,
      height: 1080,
    });
    const names: string[] = [];
    const original = service.writeProjectFile.bind(service);
    service.writeProjectFile = async (input) => {
      names.push(input.fileName);
      return original(input);
    };
    const report = await runFolderQueue(service, {
      folder: 'C:\\in',
      outputDir: 'C:\\out',
      rightsConfirmed: true,
    });
    expect(report.done).toBe(2);
    // `toma final` y `toma-final` sanearían al mismo stem: la cola asigna
    // `-2` al segundo para que ningún JSON/MP4 pise al otro.
    expect([...names].sort()).toEqual([
      'toma-final-mp4-2.editoria.json',
      'toma-final-mp4.editoria.json',
    ]);
    expect(new Set(report.items.map((item) => item.videoPath)).size).toBe(2);
    expect(report.items.map((item) => item.videoPath).sort()).toEqual([
      'C:\\out\\toma-final-mp4-2.mp4',
      'C:\\out\\toma-final-mp4.mp4',
    ]);
  });

  it('un destino de proyecto ocupado falla sin borrar el ajeno (AUD-136)', async () => {
    const service = fakeService();
    // Simula el fail-closed nuevo de write_project_file: el JSON ya existe.
    service.writeProjectFile = async () => {
      throw new Error('ya existe un proyecto con ese nombre; no se sobrescribió');
    };
    const report = await runFolderQueue(service, {
      folder: 'C:\\in',
      outputDir: 'C:\\out',
      rightsConfirmed: true,
    });
    expect(report.failed).toBe(2);
    expect(report.done).toBe(0);
    // La limpieza borra la copia de media/ que ESTA corrida creó, pero como
    // la escritura falló nunca se registró el .editoria.json como creado.
    expect(service.deleted).toContain('C:\\out\\media\\a.mp4');
    expect(service.deleted).not.toContain('C:\\out\\a-mp4.editoria.json');
  });

  it('falla el archivo si el material copiado no trae un hash válido', async () => {
    const service = fakeService();
    service.copyMediaInto = async (input) =>
      input.paths.map((path) => ({
        source: path,
        relativePath: `media/${path.split('\\').pop()}`,
        bytes: 2048,
        sha256: 'no-es-un-hash',
      }));
    const report = await runFolderQueue(service, {
      folder: 'C:\\in',
      outputDir: 'C:\\out',
      rightsConfirmed: true,
    });
    expect(report.failed).toBe(2);
    expect(report.done).toBe(0);
    expect(report.items[0]!.message).toContain('hash');
    expect(service.calls.written).toBe(0);
  });

  it('saltea un archivo sin pista de video sin frenar la cola', async () => {
    const service = fakeService();
    service.probeMediaFile = async (path: string) => ({
      ...probe(path),
      videoCodec: null,
      width: null,
      height: null,
    });
    const report = await runFolderQueue(service, {
      folder: 'C:\\in',
      outputDir: 'C:\\out',
      rightsConfirmed: true,
    });
    expect(report.skipped).toBe(2);
    expect(report.done).toBe(0);
  });

  it('un render fallido no cancela los siguientes', async () => {
    const service = fakeService({ failRenderFor: 'a-mp4' });
    const report = await runFolderQueue(service, {
      folder: 'C:\\in',
      outputDir: 'C:\\out',
      rightsConfirmed: true,
    });
    expect(report.failed).toBe(1);
    expect(report.done).toBe(1);
    expect(report.items[0]!.message).toContain('render falló');
  });

  it('un fallo posterior borra el material y el proyecto que creó (AUD-139)', async () => {
    const service = fakeService({ failRenderFor: 'a-mp4' });
    const report = await runFolderQueue(service, {
      folder: 'C:\\in',
      outputDir: 'C:\\out',
      rightsConfirmed: true,
    });
    expect(report.items[0]!.status).toBe('failed');
    // Se borró la copia en media/ y el .editoria.json del archivo fallido.
    expect(service.deleted).toContain('C:\\out\\media\\a.mp4');
    expect(service.deleted).toContain('C:\\out\\a-mp4.editoria.json');
    // El archivo que salió bien conserva sus artefactos.
    expect(service.deleted).not.toContain('C:\\out\\media\\b.mp4');
    expect(service.deleted).not.toContain('C:\\out\\b-mp4.editoria.json');
  });

  it('avisa cuando la carpeta no tiene videos', async () => {
    const service = fakeService();
    service.scanWatchFolder = async () => [];
    const report = await runFolderQueue(service, {
      folder: 'C:\\vacia',
      outputDir: 'C:\\out',
      rightsConfirmed: true,
    });
    expect(folderQueueSummary(report)).toBe('No encontré videos en la carpeta.');
  });
});
