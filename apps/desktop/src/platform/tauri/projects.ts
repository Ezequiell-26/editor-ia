import type { DesktopService } from "../../services/contracts";
import type { NativeCall } from './shared';
import * as shared from './shared';
import { convertFileSrc } from "@tauri-apps/api/core";
import type { AssetFileInfo, CopiedMedia, DuplicateAssetGroup, MissingAssetInfo, ProjectVersionInfo, QualityGateReport, RelinkFolderResult, RelinkResult, RestoreProjectVersionResult, VariantWritten } from "../../services/contracts";

export function createProjectsService(call: NativeCall): Pick<DesktopService, 'createProject' | 'openProject' | 'openProjectAt' | 'adoptProject' | 'saveProject' | 'saveProjectAs' | 'saveDeliveryPackage' | 'closeProject' | 'importAssets' | 'importMediaPaths' | 'matchMediaPlan' | 'listMediaFolder' | 'listDirectory' | 'readTextFile' | 'writeTextFile' | 'makeDirectory' | 'movePath' | 'deletePath' | 'absoluteFileUrl' | 'recentProjectThumbnail' | 'qualityGateReview' | 'checkAssetFiles' | 'chooseMediaFolder' | 'findMissingAssets' | 'relinkAsset' | 'relinkAssetsFromFolder' | 'listProjectVersions' | 'restoreProjectVersion' | 'findDuplicateAssets' | 'writeProjectVariant' | 'writeProjectFile' | 'copyMediaInto' | 'loadDirectorMemory' | 'saveDirectorMemory' | 'savePublicationManifest' | 'mediaUrl' | 'joinPath'> {
  return {
    async createProject(input) {
      return shared.requireOpened(
        await call(shared.PROJECT_COMMANDS.create, {
          name: input.name,
          video: {
            width: input.width,
            height: input.height,
            frameRate: { num: input.fpsNum, den: input.fpsDen },
            backgroundColor: '#0b0e13',
          },
        }),
      );
    },
    async openProject() {
      return shared.requireOpened(await call(shared.PROJECT_COMMANDS.open));
    },
    async openProjectAt(path) {
      const opened = shared.requireOpened(await call(shared.PROJECT_COMMANDS.openAt, { path }));
      if (!opened) {
        throw new Error('el proyecto no se pudo abrir');
      }
      return opened;
    },
    async adoptProject(path) {
      const opened = shared.requireOpened(await call(shared.PROJECT_COMMANDS.adopt, { path }));
      if (!opened) {
        throw new Error('el proyecto no se pudo adoptar en la sesión nativa');
      }
      return opened;
    },
    async saveProject(project) {
      const opened = shared.requireOpened(await call(shared.PROJECT_COMMANDS.save, { project }));
      if (!opened) {
        throw new Error('el guardado no devolvió el proyecto');
      }
      return opened;
    },
    async saveProjectAs(project) {
      return shared.requireOpened(await call(shared.PROJECT_COMMANDS.saveAs, { project }));
    },
    async saveDeliveryPackage(bytes, fileName) {
      const raw = await call(shared.PROJECT_COMMANDS.saveDeliveryPackage, {
        bytesBase64: shared.bytesToBase64(bytes),
        fileName,
      });
      return typeof raw === 'string' ? raw : null;
    },
    async closeProject() {
      await call(shared.PROJECT_COMMANDS.close);
    },
    async importAssets(fpsNum, fpsDen) {
      const raw = await call(shared.PROJECT_COMMANDS.importAssets, { fpsNum, fpsDen });
      if (raw === null || raw === undefined) {
        return null;
      }
      const record = raw as { assets?: unknown; warnings?: unknown };
      return {
        assets: shared.parseAssets(record.assets),
        warnings: Array.isArray(record.warnings)
          ? record.warnings.filter((warning): warning is string => typeof warning === 'string')
          : [],
      };
    },
    async importMediaPaths(input) {
      const raw = await call(shared.PROJECT_COMMANDS.importMediaPaths, {
        paths: [...input.paths],
        fpsNum: input.fpsNum,
        fpsDen: input.fpsDen,
        confirmRights: input.confirmRights ?? false,
        provider: input.provider ?? null,
      });
      const record = (raw ?? {}) as { assets?: unknown; warnings?: unknown };
      return {
        assets: shared.parseAssets(record.assets),
        warnings: Array.isArray(record.warnings)
          ? record.warnings.filter((warning): warning is string => typeof warning === 'string')
          : [],
      };
    },
    async matchMediaPlan(input) {
      const raw = (await call(shared.PROJECT_COMMANDS.matchMediaPlan, {
        sentences: [...input.sentences],
        images: [...input.images],
        imageDescriptions: input.imageDescriptions ? [...input.imageDescriptions] : [],
        approvedCost: input.approvedCost ?? false,
      })) as { assignments?: unknown; model?: unknown };
      return {
        assignments: Array.isArray(raw.assignments)
          ? raw.assignments.filter(
              (value): value is number =>
                typeof value === 'number' && Number.isInteger(value) && value >= 0,
            )
          : [],
        model: typeof raw.model === 'string' ? raw.model : '',
      };
    },
    async listMediaFolder(input) {
      const raw = (await call(shared.PROJECT_COMMANDS.listMediaFolder, {
        folder: input.folder,
        root: input.root ?? null,
      })) as { directory?: unknown; files?: unknown };
      return {
        directory: typeof raw.directory === 'string' ? raw.directory : '',
        files: Array.isArray(raw.files)
          ? raw.files
              .filter((file): file is Record<string, unknown> => typeof file === 'object' && file !== null)
              .map((file) => ({
                path: String(file.path ?? ''),
                name: String(file.name ?? ''),
                kind: String(file.kind ?? ''),
                bytes: Number(file.bytes ?? 0),
              }))
              .filter((file) => file.path !== '' && file.name !== '')
          : [],
      };
    },
    async listDirectory(path) {
      const raw = (await call(shared.PROJECT_COMMANDS.fsList, { path })) as {
        directory?: unknown;
        entries?: unknown;
        truncated?: unknown;
      };
      return {
        directory: typeof raw.directory === 'string' ? raw.directory : '',
        truncated: raw.truncated === true,
        entries: Array.isArray(raw.entries)
          ? raw.entries
              .filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null)
              .map((entry) => ({
                name: String(entry.name ?? ''),
                path: String(entry.path ?? ''),
                kind: String(entry.kind ?? 'other'),
                bytes: Number(entry.bytes ?? 0),
              }))
              .filter((entry) => entry.name !== '' && entry.path !== '')
          : [],
      };
    },
    async readTextFile(path) {
      const raw = (await call(shared.PROJECT_COMMANDS.fsRead, { path })) as {
        path?: unknown;
        bytes?: unknown;
        truncated?: unknown;
        content?: unknown;
      };
      return {
        path: typeof raw.path === 'string' ? raw.path : path,
        bytes: Number(raw.bytes ?? 0),
        truncated: raw.truncated === true,
        content: typeof raw.content === 'string' ? raw.content : '',
      };
    },
    async writeTextFile(path, content) {
      const raw = (await call(shared.PROJECT_COMMANDS.fsWrite, { path, content })) as {
        path?: unknown;
        bytes?: unknown;
      };
      return {
        path: typeof raw.path === 'string' ? raw.path : path,
        bytes: Number(raw.bytes ?? 0),
      };
    },
    async makeDirectory(path, recursive) {
      const raw = (await call(shared.PROJECT_COMMANDS.fsMkdir, {
        path,
        recursive: recursive ?? null,
      })) as { path?: unknown };
      return {
        path: typeof raw.path === 'string' ? raw.path : path,
        bytes: 0,
      };
    },
    async movePath(from, to) {
      const raw = (await call(shared.PROJECT_COMMANDS.fsMove, { from, to })) as {
        path?: unknown;
        bytes?: unknown;
      };
      return {
        path: typeof raw.path === 'string' ? raw.path : to,
        bytes: Number(raw.bytes ?? 0),
      };
    },
    async deletePath(path, recursive) {
      const raw = (await call(shared.PROJECT_COMMANDS.fsDelete, {
        path,
        recursive: recursive ?? null,
      })) as { path?: unknown; recursive?: unknown };
      return {
        path: typeof raw.path === 'string' ? raw.path : path,
        recursive: raw.recursive === true,
      };
    },
    absoluteFileUrl(path) {
      if (!path) return '';
      if (!shared.detectNativeRuntime()) return '';
      try {
        return convertFileSrc(path);
      } catch {
        return '';
      }
    },
    async recentProjectThumbnail(path) {
      const raw = await call(shared.PROJECT_COMMANDS.recentProjectThumbnail, { path });
      return typeof raw === 'string' ? raw : null;
    },
    async qualityGateReview() {
      const raw = await call(shared.PROJECT_COMMANDS.qualityGateReview);
      return raw as QualityGateReport;
    },
    async checkAssetFiles(paths) {
      const raw = await call(shared.PROJECT_COMMANDS.checkAssets, { paths });
      return Array.isArray(raw) ? (raw as AssetFileInfo[]) : [];
    },
    async chooseMediaFolder(title) {
      const raw = await call(shared.PROJECT_COMMANDS.chooseMediaFolder, {
        title: title ?? null,
      });
      return typeof raw === 'string' && raw.trim() ? raw : null;
    },
    async findMissingAssets(projectPath) {
      const raw = await call(shared.PROJECT_COMMANDS.findMissingAssets, {
        projectPath: projectPath ?? null,
      });
      return Array.isArray(raw) ? (raw as MissingAssetInfo[]) : [];
    },
    async relinkAsset(assetId, newPath) {
      return (await call(shared.PROJECT_COMMANDS.relinkAsset, {
        assetId,
        newPath,
      })) as RelinkResult;
    },
    async relinkAssetsFromFolder(projectPath, folder) {
      return (await call(shared.PROJECT_COMMANDS.relinkAssetsFromFolder, {
        projectPath: projectPath ?? null,
        folder,
      })) as RelinkFolderResult;
    },
    async listProjectVersions(projectPath) {
      const raw = await call(shared.PROJECT_COMMANDS.listProjectVersions, {
        projectPath: projectPath ?? null,
      });
      return Array.isArray(raw) ? (raw as ProjectVersionInfo[]) : [];
    },
    async restoreProjectVersion(projectPath, versionId, mode) {
      return (await call(shared.PROJECT_COMMANDS.restoreProjectVersion, {
        projectPath,
        versionId,
        mode: mode ?? null,
      })) as RestoreProjectVersionResult;
    },
    async findDuplicateAssets(projectPath) {
      const raw = await call(shared.PROJECT_COMMANDS.findDuplicateAssets, {
        projectPath: projectPath ?? null,
      });
      return Array.isArray(raw) ? (raw as DuplicateAssetGroup[]) : [];
    },
    async writeProjectVariant(input) {
      return (await call(shared.PROJECT_COMMANDS.writeProjectVariant, {
        directory: input.directory,
        fileName: input.fileName,
        project: input.project,
      })) as VariantWritten;
    },
    async writeProjectFile(input) {
      return (await call(shared.PROJECT_COMMANDS.writeProjectFile, {
        directory: input.directory,
        fileName: input.fileName,
        project: input.project,
      })) as VariantWritten;
    },
    async copyMediaInto(input) {
      return (await call(shared.PROJECT_COMMANDS.copyMediaInto, {
        directory: input.directory,
        paths: input.paths,
      })) as CopiedMedia[];
    },
    async loadDirectorMemory() {
      return await call(shared.PROJECT_COMMANDS.loadDirectorMemory);
    },
    async saveDirectorMemory(memory) {
      await call(shared.PROJECT_COMMANDS.saveDirectorMemory, { memory });
    },
    async savePublicationManifest(manifest) {
      const raw = await call(shared.PROJECT_COMMANDS.savePublicationManifest, { manifest });
      return typeof raw === 'string' ? raw : null;
    },
    mediaUrl(root, relativePath) {
      const absolute = shared.joinProjectPath(root, relativePath);
      if (!shared.detectNativeRuntime()) {
        return '';
      }
      try {
        return convertFileSrc(absolute);
      } catch {
        return '';
      }
    },
    joinPath: shared.joinProjectPath,
  };
}
