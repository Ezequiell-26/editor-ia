import type { ProjectDocument } from '@editor-ia/project-schema';
import type { AudioPeaks, DesktopService } from '../services/project-service';
import { runAutoCleanup, type AutoCleanupReport } from './auto-cleanup';
import { ensureDelivery, newId, updateAudioMix } from './project-actions';
import { chooseExportProfile } from './render-profile';
import { measureAdaptiveProfile, type AdaptiveProfile } from './adaptive';

/**
 * Piloto automático.
 *
 * De un proyecto crudo a un MP4 entregable sin que nadie elija parámetros:
 * mide el material, limpia con esos valores, escribe el proyecto, renderiza y
 * **verifica el archivo final**. Si la duración no coincide con la timeline o
 * falta una pista, lo declara en `warnings` en vez de decir «listo».
 *
 * No usa el store: recibe el proyecto y el servicio. Eso permite probarlo con
 * un servicio falso y, más adelante, correrlo desde una cola sin tocar la
 * sesión abierta.
 */

export interface AutoPilotOptions {
  /** Carpeta donde se escriben el proyecto y el MP4. */
  readonly outputDir: string;
  readonly includeCaptions?: boolean | undefined;
  readonly adaptive?: boolean | undefined;
  /** Corrige el master y vuelve a renderizar si el MP4 no llega al objetivo. */
  readonly closedLoop?: boolean | undefined;
  /** Verifica la calidad visual contra un render de referencia (cuesta 1 render más). */
  readonly qualityCheck?: boolean | undefined;
  /** VMAF mínimo aceptable (93). */
  readonly targetVmaf?: number | undefined;
  readonly profileId?: string | undefined;
  /** Nombre base de los archivos; por defecto, el del proyecto. */
  readonly fileStem?: string | undefined;
}

export interface AutoPilotReport {
  readonly project: ProjectDocument;
  readonly cleanup: AutoCleanupReport;
  readonly profile: AdaptiveProfile;
  readonly profileId: string;
  readonly projectPath: string;
  readonly videoPath: string;
  readonly bytes: number;
  readonly durationSeconds: number;
  readonly expectedSeconds: number;
  readonly verified: boolean;
  readonly warnings: readonly string[];
  /** Medición del archivo final y corrección aplicada, si hubo. */
  readonly loudness: {
    readonly measuredLufs: number | null;
    readonly targetLufs: number;
    readonly correctionDb: number;
  };
  /** Calidad visual medida contra un render de referencia, si se pidió. */
  readonly quality: {
    readonly vmaf: number | null;
    readonly targetVmaf: number;
    readonly referenceProfileId: string | null;
    readonly adjustedProfileId: string | null;
  };
}

type PilotService = Pick<
  DesktopService,
  | 'audioPeaks'
  | 'writeProjectVariant'
  | 'renderProjectVariant'
  | 'probeMediaFile'
  | 'measureFileLoudness'
  | 'measureVmaf'
>;

export interface AutoPilotInput {
  readonly project: ProjectDocument;
  readonly service: PilotService;
  readonly options: AutoPilotOptions;
  /** Permite inyectar picos ya medidos (pruebas o caché). */
  readonly fetchPeaks?: ((assetId: string) => Promise<AudioPeaks>) | undefined;
}

function joinPath(directory: string, file: string): string {
  const trimmed = directory.replace(/[\\/]+$/, '');
  return `${trimmed}\\${file}`;
}

function slug(name: string): string {
  const clean = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9-_ ]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .toLowerCase();
  return clean.length > 0 ? clean.slice(0, 60) : 'entrega';
}

/** Duración de la timeline en segundos. */
function timelineSeconds(project: ProjectDocument): number {
  const fps = project.video.frameRate.num / Math.max(1, project.video.frameRate.den);
  const end = project.timeline.clips.reduce(
    (max, clip) => Math.max(max, clip.startFrame + clip.durationFrames),
    0,
  );
  return fps > 0 ? end / fps : 0;
}

/** Primer asset con audio montado: el que define el perfil medido. */
function firstAudioAssetId(project: ProjectDocument): string | null {
  for (const clip of project.timeline.clips) {
    if (clip.kind !== 'video' && clip.kind !== 'audio') continue;
    if (clip.source.type !== 'asset') continue;
    return clip.source.assetId;
  }
  return null;
}

export async function runAutoPilot(input: AutoPilotInput): Promise<AutoPilotReport> {
  const { project, service, options } = input;
  const fetchPeaks = input.fetchPeaks ?? ((assetId: string) => service.audioPeaks(assetId));

  // 1. Medir antes de decidir: piso de ruido, voz, SNR, plano mediano.
  let profile = measureAdaptiveProfile(project, null);
  const assetId = firstAudioAssetId(project);
  if (assetId && options.adaptive !== false) {
    try {
      profile = measureAdaptiveProfile(project, await fetchPeaks(assetId));
    } catch {
      // Sin picos se usan los valores conservadores; no se aborta la entrega.
    }
  }

  // 2. Limpiar con el perfil medido.
  const cleanup = await runAutoCleanup(project, fetchPeaks, {
    cutSilences: true,
    cutPauses: true,
    denoise: profile.denoise,
    levelAudio: true,
    targetLufs: profile.targetLufs,
    zoomCuts: true,
    zoomIntensity: profile.zoomIntensity,
    silence: { thresholdDb: profile.silenceThresholdDb },
  });

  // Un proyecto recién creado no trae perfiles: `ensureDelivery` agrega los tres
  // formatos de entrega y deja el piloto usable sin configuración previa.
  const delivered = ensureDelivery(cleanup.project);
  const profileId = options.profileId ?? chooseExportProfile(delivered)?.id;
  if (!profileId) {
    throw new Error('el proyecto no tiene un perfil de render: agregá uno antes del piloto');
  }

  // 3. Escribir el proyecto limpio y renderizar desde disco.
  const stem = options.fileStem ?? slug(delivered.name);
  const written = await service.writeProjectVariant({
    directory: options.outputDir,
    fileName: `${stem}.editoria.json`,
    project: delivered,
  });
  const outputPath = joinPath(options.outputDir, `${stem}.mp4`);
  let rendered = await service.renderProjectVariant({
    projectPath: written.path,
    profileId,
    outputPath,
    includeCaptions: options.includeCaptions ?? true,
  });

  // Lazo cerrado: si el archivo quedó lejos del objetivo, se corrige el master
  // y se vuelve a renderizar UNA vez. Medir sin corregir sería decorativo.
  let measuredLufs: number | null = null;
  let correctionDb = 0;
  let finalProject = delivered;
  try {
    const first = await service.measureFileLoudness(rendered.path);
    measuredLufs = first.integratedLufs;
    const delta = profile.targetLufs - first.integratedLufs;
    if (options.closedLoop !== false && Math.abs(delta) > 1) {
      correctionDb = Math.round(delta * 10) / 10;
      const currentGain = finalProject.audio.master.gainDb ?? 0;
      finalProject = updateAudioMix(finalProject, {
        masterGainDb: Math.max(-60, Math.min(12, currentGain + correctionDb)),
      });
      await service.writeProjectVariant({
        directory: options.outputDir,
        fileName: `${stem}.editoria.json`,
        project: finalProject,
      });
      rendered = await service.renderProjectVariant({
        projectPath: written.path,
        profileId,
        outputPath,
        includeCaptions: options.includeCaptions ?? true,
      });
      try {
        measuredLufs = (await service.measureFileLoudness(rendered.path)).integratedLufs;
      } catch {
        // Se conserva la primera medición; la corrección ya está aplicada.
      }
    }
  } catch {
    // Sin medición no hay lazo cerrado: se entrega y se declara en el reporte.
  }

  // 3.b Calidad visual: se compara la entrega contra un render de referencia de
  // más calidad. Si el VMAF no llega, se baja el CRF y se reexporta una vez.
  let vmaf: number | null = null;
  let referenceProfileId: string | null = null;
  let adjustedProfileId: string | null = null;
  const targetVmaf = Math.max(50, Math.min(100, options.targetVmaf ?? 93));
  if (options.qualityCheck) {
    const chosen = finalProject.renderProfiles.find((profile) => profile.id === profileId);
    const chosenCrf = chosen?.bitrate.mode === 'crf' ? chosen.bitrate.crf : null;
    const reference = [...finalProject.renderProfiles]
      .filter((profile) => profile.id !== profileId && profile.bitrate.mode === 'crf')
      .sort(
        (a, b) =>
          (a.bitrate.mode === 'crf' ? a.bitrate.crf : 99) -
          (b.bitrate.mode === 'crf' ? b.bitrate.crf : 99),
      )[0];
    if (chosen && chosenCrf !== null && reference) {
      referenceProfileId = reference.id;
      const referencePath = joinPath(options.outputDir, `${stem}.ref.mp4`);
      try {
        await service.renderProjectVariant({
          projectPath: written.path,
          profileId: reference.id,
          outputPath: referencePath,
          includeCaptions: options.includeCaptions ?? true,
        });
        vmaf = await service.measureVmaf(referencePath, rendered.path);
        if (vmaf !== null && vmaf < targetVmaf) {
          const lowered = Math.max(14, chosenCrf - 4);
          const improved = {
            ...chosen,
            id: newId(),
            name: `${chosen.name} · calidad`,
            bitrate: { mode: 'crf' as const, crf: lowered },
          } as ProjectDocument['renderProfiles'][number];
          finalProject = {
            ...finalProject,
            renderProfiles: [...finalProject.renderProfiles, improved],
          };
          await service.writeProjectVariant({
            directory: options.outputDir,
            fileName: `${stem}.editoria.json`,
            project: finalProject,
          });
          rendered = await service.renderProjectVariant({
            projectPath: written.path,
            profileId: improved.id,
            outputPath,
            includeCaptions: options.includeCaptions ?? true,
          });
          adjustedProfileId = improved.id;
          try {
            vmaf = await service.measureVmaf(referencePath, rendered.path);
          } catch {
            // Se conserva la primera medición; el reencode ya está hecho.
          }
        }
      } catch {
        // Sin VMAF disponible (build sin libvmaf) se entrega y se declara null.
      }
    }
  }

  // 4. Verificar el archivo: duración contra la timeline y pistas presentes.
  const expectedSeconds = timelineSeconds(finalProject);
  const warnings: string[] = [];
  let probe: Awaited<ReturnType<PilotService['probeMediaFile']>> | null = null;
  try {
    probe = await service.probeMediaFile(rendered.path);
  } catch {
    warnings.push('no pude sondear el MP4 para verificar el resultado');
  }
  if (probe) {
    if (probe.videoCodec === null) warnings.push('el MP4 no tiene pista de video');
    const hasAudio = finalProject.timeline.clips.some(
      (clip) => clip.kind === 'video' || clip.kind === 'audio',
    );
    if (hasAudio && probe.audioCodec === null) warnings.push('el MP4 no tiene pista de audio');
  }
  const duration = probe?.durationSeconds ?? rendered.durationSeconds;
  const tolerance = Math.max(1, expectedSeconds * 0.05);
  if (Math.abs(duration - expectedSeconds) > tolerance) {
    warnings.push(
      `la duración del MP4 (${duration.toFixed(2)} s) no coincide con la timeline (${expectedSeconds.toFixed(2)} s)`,
    );
  }

  return {
    project: finalProject,
    cleanup,
    profile,
    profileId,
    projectPath: written.path,
    videoPath: rendered.path,
    bytes: rendered.bytes,
    durationSeconds: duration,
    expectedSeconds,
    verified: warnings.length === 0,
    warnings,
    loudness: { measuredLufs, targetLufs: profile.targetLufs, correctionDb },
    quality: { vmaf, targetVmaf, referenceProfileId, adjustedProfileId },
  };
}

/** Resumen para el aviso de la UI. */
export function autoPilotSummary(report: AutoPilotReport): string {
  const seconds = report.cleanup.removedSeconds;
  const cuts =
    report.cleanup.silenceCuts +
    report.cleanup.pauseCuts +
    report.cleanup.zoomed +
    report.cleanup.denoised;
  const base = `${cuts} ajuste(s)${seconds > 0 ? ` · ${seconds.toFixed(2)} s menos` : ''} · ${report.durationSeconds.toFixed(1)} s`;
  const loudness =
    report.loudness.correctionDb !== 0
      ? ` · master ${report.loudness.correctionDb > 0 ? '+' : ''}${report.loudness.correctionDb} dB`
      : '';
  const quality =
    report.quality.vmaf !== null ? ` · VMAF ${Math.round(report.quality.vmaf)}` : '';
  return report.verified
    ? `${base}${loudness}${quality} · MP4 verificado`
    : `${base}${loudness}${quality} · revisar avisos`;
}
