import type { DesktopService } from "../../services/contracts";
import type { NativeCall } from './shared';
import * as shared from './shared';
import type { ExportCapabilities, ExportVerification, HardwareEncoders, LosslessResult, RenderFinishedEvent, RenderProgressEvent, RenderStarted, VariantRendered } from "../../services/contracts";
import { listen } from "@tauri-apps/api/event";
import type { RenderQueueEntry } from "../../state/render-queue";

export function createRenderService(call: NativeCall): Pick<DesktopService, 'exportLossless' | 'hardwareEncoders' | 'exportCapabilities' | 'verifyExport' | 'renderProjectVariant' | 'startRender' | 'startRenderTo' | 'chooseExportDirectory' | 'cancelRender' | 'activeRender' | 'pruneRenderCache' | 'renderQueueLoad' | 'renderQueueSave' | 'renderQueueClearFinished' | 'onRenderProgress' | 'onRenderFinished'> {
  return {
    async exportLossless(input) {
      return (await call(shared.PROJECT_COMMANDS.exportLossless, { ...input })) as LosslessResult;
    },
    async hardwareEncoders() {
      return (await call(shared.PROJECT_COMMANDS.hardwareEncoders)) as HardwareEncoders;
    },
    async exportCapabilities() {
      return (await call(shared.PROJECT_COMMANDS.exportCapabilities)) as ExportCapabilities;
    },
    async verifyExport(path) {
      return (await call(shared.PROJECT_COMMANDS.verifyExport, { path })) as ExportVerification;
    },
    async renderProjectVariant(input) {
      return (await call(shared.PROJECT_COMMANDS.renderProjectVariant, {
        projectPath: input.projectPath,
        profileId: input.profileId,
        outputPath: input.outputPath,
        includeCaptions: input.includeCaptions,
        ...(input.motionPlans ? { motionPlans: input.motionPlans } : {}),
      })) as VariantRendered;
    },
    async startRender(profileId, includeCaptions, motionPlans, hardwareEncoder, range) {
      return (await call(shared.PROJECT_COMMANDS.startRender, {
        profileId,
        includeCaptions,
        ...(motionPlans ? { motionPlans } : {}),
        ...(hardwareEncoder ? { hardwareEncoder } : {}),
        ...(range
          ? { startFrame: range.startFrame, endFrame: range.endFrame }
          : {}),
      })) as RenderStarted | null;
    },
    async startRenderTo(
      profileId,
      outputPath,
      includeCaptions,
      motionPlans,
      hardwareEncoder,
      range,
    ) {
      return (await call(shared.PROJECT_COMMANDS.startRenderTo, {
        profileId,
        outputPath,
        includeCaptions,
        ...(motionPlans ? { motionPlans } : {}),
        ...(hardwareEncoder ? { hardwareEncoder } : {}),
        ...(range
          ? { startFrame: range.startFrame, endFrame: range.endFrame }
          : {}),
      })) as RenderStarted | null;
    },
    async chooseExportDirectory() {
      const raw = await call(shared.PROJECT_COMMANDS.chooseExportDirectory);
      return typeof raw === 'string' ? raw : null;
    },
    async cancelRender(jobId) {
      await call(shared.PROJECT_COMMANDS.cancelRender, { jobId });
    },
    async activeRender() {
      const raw = await call(shared.PROJECT_COMMANDS.activeRender);
      return typeof raw === 'string' ? raw : null;
    },
    async pruneRenderCache() {
      const raw = await call(shared.PROJECT_COMMANDS.pruneRenderCache);
      return typeof raw === 'number' ? raw : 0;
    },
    async renderQueueLoad() {
      const raw = await call(shared.PROJECT_COMMANDS.renderQueueLoad);
      return Array.isArray(raw) ? (raw as RenderQueueEntry[]) : null;
    },
    async renderQueueSave(queue) {
      await call(shared.PROJECT_COMMANDS.renderQueueSave, { queue });
    },
    async renderQueueClearFinished() {
      const raw = await call(shared.PROJECT_COMMANDS.renderQueueClearFinished);
      return Array.isArray(raw) ? (raw as RenderQueueEntry[]) : null;
    },
    async onRenderProgress(handler) {
      return listen<RenderProgressEvent>('render-progress', (event) => handler(event.payload));
    },
    async onRenderFinished(handler) {
      return listen<RenderFinishedEvent>('render-finished', (event) => handler(event.payload));
    },
  };
}
