import { useEffect, useRef, useState } from 'react';
import type {
  ExportCapabilities,
  ExportVerification,
  HardwareEncoders,
  RenderFinishedEvent,
  RenderProgressEvent,
} from '../../services/project-service';
import { basename } from '../../lib/format';
import {
  COMPRESSION_PRESETS,
  applyCompression,
  applyProfileFit,
  compressionPresetOf,
  ensureDelivery,
  fpsOf,
  updateAudioMix,
  updateProjectSettings,
} from '../../state/project-actions';
import {
  clearSettled,
  enqueueProfiles,
  loadRenderQueue,
  markDone,
  markFailed,
  markRunning,
  movePending,
  nextPending,
  queueFileName,
  removeEntry,
  retryEntry,
  saveRenderQueue,
  summarizeQueue,
  type RenderQueue,
} from '../../state/render-queue';
import { useProjectStore } from '../../state/project-store';
import { useDialogFocus } from '../../hooks/useDialogFocus';
import { recordDirectorOutcome } from '../../state/editor-memory';
import { evaluateProjectQuality } from '../../state/quality';
import { buildProjectMotionPlans } from '../motion/plan';
import { chooseExportProfile } from '../../state/render-profile';
import { hasEmoji } from '../emoji/emoji';
import { gpuRecommendation } from './gpu-policy';
import { RenderSuccessCard } from './FilmoraStates';
import {
  deleteExportPreset,
  loadExportPresets,
  saveExportPreset,
  type SavedExportPreset,
} from './export-presets';
import {
  validateExportFile,
  validateExportVerification,
  type ExportValidationFinding,
  type ExportValidationReport,
} from './export-validation';
import { detectQueueCapabilities, queueCapabilityTitle } from './queue-capabilities';

interface ExportDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

function formatBytes(bytes: number | null): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function safeFilePart(value: string): string {
  const cleaned = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return cleaned || 'export';
}

function joinOutputPath(folder: string, file: string): string {
  const separator = folder.includes('\\') ? '\\' : '/';
  return `${folder.replace(/[\\/]+$/, '')}${separator}${file}`;
}

interface BatchResult {
  readonly name: string;
  readonly status: string;
  readonly path: string | null;
  readonly message: string | null;
}

const EXPORT_DESTINATIONS: readonly { readonly id: string; readonly label: string; readonly pending?: boolean }[] = [
  { id: 'local', label: 'Local' },
  { id: 'social', label: 'Redes sociales', pending: true },
  { id: 'youtube', label: 'YouTube', pending: true },
  { id: 'tiktok', label: 'TikTok', pending: true },
  { id: 'vimeo', label: 'Vimeo', pending: true },
  { id: 'device', label: 'Dispositivo', pending: true },
  { id: 'dvd', label: 'DVD', pending: true },
];

const EXPORT_FORMATS = ['MP4', 'MOV', 'MKV', 'WebM'];
const EXPORT_RESOLUTIONS = [
  '1920*1080 Full HD 1080p',
  '1280*720 HD 720p',
  '3840*2160 UHD 4K',
  '1080*1920 Vertical 1080p',
];
const EXPORT_CODECS = ['H.264', 'H.265/HEVC', 'VP9', 'AV1'];
const EXPORT_QUALITIES = ['Baja', 'Media', 'Alta', 'Máxima'];
const EXPORT_MEDIA_TYPES = ['Video', 'Audio', 'Imagen', 'Live Photo'];

export function ExportDialog({ open, onClose }: ExportDialogProps) {
  const store = useProjectStore();
  const project = store.state.project;
  const [profileId, setProfileId] = useState('');
  const [destination, setDestination] = useState('local');
  const [exportFolder, setExportFolder] = useState<string | null>(null);
  const [matchMode, setMatchMode] = useState('project');
  const [mediaType, setMediaType] = useState('Video');
  const [exportFormat, setExportFormat] = useState('MP4');
  const [exportResolution, setExportResolution] = useState(EXPORT_RESOLUTIONS[0]!);
  const [exportCodec, setExportCodec] = useState('H.264');
  const [exportQuality, setExportQuality] = useState('Media');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [includeCaptions, setIncludeCaptions] = useState(true);
  const [rangeStart, setRangeStart] = useState(0);
  const [rangeEnd, setRangeEnd] = useState(0);
  const [hardware, setHardware] = useState<HardwareEncoders | null>(null);
  const [useGpu, setUseGpu] = useState(false);
  const [starting, setStarting] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState<RenderProgressEvent | null>(null);
  const [finished, setFinished] = useState<RenderFinishedEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [batchProfiles, setBatchProfiles] = useState<Set<string>>(new Set());
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchResults, setBatchResults] = useState<BatchResult[]>([]);
  // Presets de exportación guardables por el usuario (por equipo) y validación
  // visible del archivo final con FFprobe. La validación nunca se inventa: si
  // el entorno no expone FFprobe se muestra "no disponible".
  const [presets, setPresets] = useState<SavedExportPreset[]>(() => loadExportPresets());
  const [presetId, setPresetId] = useState('');
  const [presetName, setPresetName] = useState('');
  const [validation, setValidation] = useState<
    | ExportValidationReport
    | { readonly status: 'unavailable'; readonly findings: readonly ExportValidationFinding[] }
    | null
  >(null);
  const [validating, setValidating] = useState(false);
  // Capacidades reales del FFmpeg empaquetado; null = comando todavía no
  // disponible (feature-detect) y la UI no ofrece opciones no soportadas.
  const [capabilities, setCapabilities] = useState<ExportCapabilities | null>(null);
  const [verification, setVerification] = useState<ExportVerification | null>(null);
  // La cola sobrevive al cierre del diálogo: se hidrata en el primer render
  // (no en un efecto) y se persiste en cada cambio. Hidratar en un efecto
  // dejaría un render con la cola vacía que pisaría lo guardado.
  const [queue, setQueue] = useState<RenderQueue>(() => {
    if (typeof window === 'undefined' || !window.localStorage) return [];
    return loadRenderQueue(window.localStorage);
  });
  const [queueBusy, setQueueBusy] = useState(false);
  const jobRef = useRef<string | null>(null);
  const batchResolverRef = useRef<((event: RenderFinishedEvent) => void) | null>(null);
  const folderRef = useRef<string | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  jobRef.current = jobId;

  // Trampa de foco (auditoría de accesibilidad, H1/H2): guarda el disparador,
  // enfoca el primer control, atrapa Tab y cierra con Escape. Mientras hay un
  // render en curso Escape no cierra (igual que antes): primero hay que
  // cancelar el trabajo. `active` cubre el cierre: el componente sigue montado
  // pero el diálogo no está en pantalla.
  useDialogFocus({
    containerRef: dialogRef,
    active: open && Boolean(project),
    onClose: () => {
      if (jobId === null) onClose();
    },
  });

  useEffect(() => {
    if (!open) return;
    const total = store.durationFrames;
    setRangeStart(0);
    setRangeEnd(total);
  }, [open, store.durationFrames]);

  function setExportRange(start: number, end: number): void {
    const total = Math.max(1, store.durationFrames);
    const nextStart = Math.max(0, Math.min(total - 1, Math.round(start)));
    const nextEnd = Math.max(nextStart + 1, Math.min(total, Math.round(end)));
    setRangeStart(nextStart);
    setRangeEnd(nextEnd);
  }

  const rangeFps = project ? fpsOf(project) : 30;
  const totalFrames = store.durationFrames;
  const safeRangeStart = Math.min(rangeStart, Math.max(0, totalFrames - 1));
  const safeRangeEnd = Math.max(
    safeRangeStart + 1,
    Math.min(rangeEnd || totalFrames, totalFrames),
  );
  const rangeActive = safeRangeStart > 0 || safeRangeEnd < totalFrames;
  const exportRange = rangeActive
    ? { startFrame: safeRangeStart, endFrame: safeRangeEnd }
    : undefined;
  const rangeSeconds =
    (rangeActive ? safeRangeEnd - safeRangeStart : totalFrames) / rangeFps;

  function availableHardware(
    profile:
      | { readonly videoCodec: string; readonly resolution: { readonly width: number; readonly height: number } }
      | undefined,
  ): string | null {
    if (!hardware || !profile) return null;
    const encoder = profile.videoCodec === 'h265' ? hardware.hevc : hardware.h264;
    if (!encoder) return null;
    const maxSide = profile.videoCodec === 'h265' ? 8192 : 4096;
    if (profile.resolution.width > maxSide || profile.resolution.height > maxSide) return null;
    return encoder;
  }

  function hardwareForProfile(
    profile:
      | {
          readonly videoCodec: string;
          readonly resolution: { readonly width: number; readonly height: number };
          readonly videoPreset: string;
        }
      | undefined,
    durationSeconds: number,
  ): string | null {
    if (!useGpu) return null;
    const encoder = availableHardware(profile);
    if (!encoder || !profile) return null;
    const decision = gpuRecommendation({
      width: profile.resolution.width,
      height: profile.resolution.height,
      durationSeconds,
      preset: profile.videoPreset,
    });
    return decision.recommended ? encoder : null;
  }

  useEffect(() => {
    if (!open) return;
    setError(null);
    setFinished(null);
    setProgress(null);
    setJobId(null);
    jobRef.current = null;
    setIncludeCaptions((project?.captions.cues.length ?? 0) > 0);
    setUseGpu(false);
    const profiles = project?.renderProfiles ?? [];
    const preferred = project ? chooseExportProfile(project) : profiles[0];
    setProfileId(preferred?.id ?? '');
    setBatchProfiles(new Set(profiles.map((profile) => profile.id)));
    setBatchResults([]);
    setBatchBusy(false);
    folderRef.current = null;
    setPresets(loadExportPresets());
    setPresetId('');
    setPresetName('');
    setValidation(null);
    setValidating(false);
    // Only reset when the dialog opens, not on every project render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    void store.service
      .hardwareEncoders()
      .then((result) => {
        if (active) setHardware(result);
      })
      .catch(() => {
        if (active) setHardware({ h264: null, hevc: null, checked: false });
      });
    return () => {
      active = false;
    };
  }, [open, store.service]);

  useEffect(() => {
    if (!open || !project || !useGpu) return;
    const profiles = project.renderProfiles;
    const selected = profiles.find((profile) => profile.id === profileId) ?? profiles[0];
    if (!selected) {
      setUseGpu(false);
      return;
    }
    const durationSeconds = store.durationFrames / fpsOf(project);
    const decision = gpuRecommendation({
      width: selected.resolution.width,
      height: selected.resolution.height,
      durationSeconds,
      preset: selected.videoPreset,
    });
    if (!availableHardware(selected) || !decision.recommended) setUseGpu(false);
    // Al cambiar de perfil o de duración, la GPU se apaga si ya no conviene.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, project, profileId, useGpu, hardware, store.durationFrames]);

  // La cola se persiste en cada cambio para que un cierre abrupto no pierda
  // los pendientes; la hidratación ya ocurrió en el estado inicial.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.localStorage) return;
    saveRenderQueue(window.localStorage, queue);
  }, [queue]);

  // Runner de la cola: toma el primer pendiente y lo drena de a uno. El guardia
  // de `queueBusy` evita arrancar dos renders si el efecto se reejecuta por un
  // cambio de estado mientras el render sigue en curso.
  useEffect(() => {
    if (!open || !store.service.available || queueBusy) return;
    const entry = nextPending(queue);
    if (!entry) return;
    const currentProject = store.state.project;
    if (!currentProject) return;
    const motionBundle = buildProjectMotionPlans(currentProject);
    if (motionBundle.errors.length > 0) {
      setQueue((current) => markFailed(current, entry.id, motionBundle.errors[0]!));
      return;
    }
    setQueueBusy(true);
    void (async () => {
      try {
        const saved = await store.saveNow();
        if (!saved) {
          setQueue((current) => markFailed(current, entry.id, 'no se pudo guardar el proyecto'));
          return;
        }
        let folder = folderRef.current;
        if (!folder) {
          folder = await store.service.chooseExportDirectory();
          if (!folder) {
            // Sin carpeta no se puede continuar: se saca la entrada para no
            // dejar la cola colgada pidiendo un diálogo en cada reapertura.
            setQueue((current) => removeEntry(current, entry.id));
            return;
          }
          folderRef.current = folder;
        }
        setQueue((current) => markRunning(current, entry.id));
        const outputPath = joinOutputPath(folder, queueFileName(currentProject.name, entry.profileName));
        const queueProfile = currentProject.renderProfiles.find(
          (profile) => profile.id === entry.profileId,
        );
        const started = await store.service.startRenderTo(
          entry.profileId,
          outputPath,
          entry.includeCaptions,
          motionBundle.plans,
          hardwareForProfile(queueProfile, rangeSeconds),
          exportRange,
        );
        if (!started) {
          setQueue((current) => markFailed(current, entry.id, 'el render no se inició'));
          return;
        }
        jobRef.current = started.jobId;
        setJobId(started.jobId);
        setProgress({
          jobId: started.jobId,
          percent: 0,
          processedSeconds: 0,
          totalSeconds: store.durationFrames / fpsOf(currentProject),
          phase: `cola · ${entry.profileName}`,
        });
        const event = await waitForJob(started.jobId);
        setQueue((current) =>
          event.status === 'completed'
            ? markDone(current, entry.id, event.outputPath ?? outputPath)
            : markFailed(current, entry.id, event.message ?? event.status),
        );
        jobRef.current = null;
        setJobId(null);
        setProgress(null);
      } catch (cause) {
        setQueue((current) =>
          markFailed(current, entry.id, cause instanceof Error ? cause.message : 'el render falló'),
        );
        jobRef.current = null;
        setJobId(null);
        setProgress(null);
      } finally {
        setQueueBusy(false);
      }
    })();
    // `waitForJob` y `fpsOf` son estables durante la vida del componente.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, queue, queueBusy, store, hardware, useGpu]);

  useEffect(() => {
    if (!open || !store.service.available) return;
    let mounted = true;
    let offProgress: (() => void) | null = null;
    let offFinished: (() => void) | null = null;
    void store.service.onRenderProgress((event) => {
      if (!mounted) return;
      if (jobRef.current !== null && event.jobId !== jobRef.current) return;
      setProgress(event);
    }).then((off) => {
      offProgress = off;
    });
    void store.service.onRenderFinished((event) => {
      if (!mounted) return;
      if (jobRef.current !== null && event.jobId !== jobRef.current) return;
      setFinished(event);
      setJobId(null);
      setStarting(false);
      const resolver = batchResolverRef.current;
      if (resolver) {
        batchResolverRef.current = null;
        resolver(event);
      }
      if (event.status === 'completed') {
        setProgress((current) => ({
          jobId: event.jobId,
          percent: 100,
          processedSeconds: event.durationSeconds ?? current?.totalSeconds ?? 0,
          totalSeconds: event.durationSeconds ?? current?.totalSeconds ?? 0,
          phase: 'completado',
        }));
      }
    }).then((off) => {
      offFinished = off;
    });
    void store.service
      .activeRender()
      .then((active) => {
        if (!mounted || !active) return;
        jobRef.current = active;
        setJobId(active);
      })
      .catch(() => {});
    return () => {
      mounted = false;
      offProgress?.();
      offFinished?.();
    };
  }, [open, store.service]);

  // Capacidades del build (contenedores/codecs/HDR). Si el comando aún no
  // responde, queda null y la UI simplemente no muestra la sección.
  useEffect(() => {
    if (!open || !store.service.available) {
      setCapabilities(null);
      return;
    }
    let active = true;
    void store.service
      .exportCapabilities()
      .then((result) => {
        if (active) setCapabilities(result);
      })
      .catch(() => {
        if (active) setCapabilities(null);
      });
    return () => {
      active = false;
    };
  }, [open, store.service]);

  // Validación post-export: `verifyExport` con FFprobe (contrato nuevo). Si el
  // comando Rust todavía no responde, cae a `probeMediaFile`; si tampoco hay
  // probe se declara no disponible. En navegador (service.available=false) se
  // declara no disponible en vez de simular un "verificado".
  useEffect(() => {
    if (!open || !finished || finished.status !== 'completed' || !finished.outputPath) {
      setValidation(null);
      setValidating(false);
      return;
    }
    if (!store.service.available) {
      setValidation({ status: 'unavailable', findings: [] });
      return;
    }
    let active = true;
    setValidating(true);
    setVerification(null);
    const profile =
      project?.renderProfiles.find((entry) => entry.id === profileId) ??
      project?.renderProfiles[0];
    const expectation = {
      videoCodec: profile?.videoCodec ?? 'h264',
      audioCodec: profile?.audioCodec ?? 'aac',
      width: finished.width ?? profile?.resolution.width ?? 0,
      height: finished.height ?? profile?.resolution.height ?? 0,
      durationSeconds: finished.durationSeconds ?? rangeSeconds,
      expectedBytes: finished.outputBytes,
    };
    void (async () => {
      // Si `render-finished` ya trae el reporte FFprobe, se usa directo (evita
      // un segundo proceso). Si viene null, se pide `verifyExport`.
      if (finished.verification) {
        if (active) {
          setVerification(finished.verification);
          setValidation(validateExportVerification(finished.verification, expectation));
          setValidating(false);
        }
        return;
      }
      try {
        const verified = await store.service.verifyExport(finished.outputPath!);
        if (!active) return;
        setVerification(verified);
        setValidation(validateExportVerification(verified, expectation));
      } catch {
        try {
          const probe = await store.service.probeMediaFile(finished.outputPath!);
          if (!active) return;
          setValidation(validateExportFile(probe, expectation));
        } catch {
          if (active) setValidation({ status: 'unavailable', findings: [] });
        }
      } finally {
        if (active) setValidating(false);
      }
    })();
    return () => {
      active = false;
    };
    // Depende del archivo terminado; no revalidar en cada render del diálogo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, finished?.outputPath, finished?.status, store.service]);

  // Captura 97: la tarjeta de éxito y el botón «Abrir carpeta» comparten el
  // mismo comando real del servicio (revealOutput); no se simula ningún éxito.
  const revealFinishedOutput = (): void => {
    if (!finished?.outputPath) return;
    void store.service.revealOutput(finished.outputPath).catch((cause) => {
      setError(cause instanceof Error ? cause.message : 'no se pudo abrir la carpeta');
    });
  };

  if (!open || !project) return null;
  const currentProject = project;
  const quality = evaluateProjectQuality(currentProject);
  const emojiWarning = currentProject.captions.cues.some((cue) => hasEmoji(cue.text));
  const hasQualityError = quality.some((finding) => finding.severity === 'error');
  const missingLoudness = quality.some((finding) => /loudness/i.test(finding.message));

  const profiles = project.renderProfiles;
  const selected = profiles.find((profile) => profile.id === profileId) ?? profiles[0];
  const running = Boolean(jobId) || starting || batchBusy || queueBusy;
  const fps = fpsOf(project);
  const selectedBatchProfiles = profiles.filter((profile) => batchProfiles.has(profile.id));
  const compression = selected ? compressionPresetOf(selected) : 'custom';
  const selectedHardware = availableHardware(selected);
  const durationSeconds = store.durationFrames / fps;
  const gpuDecision = selected
    ? gpuRecommendation({
        width: selected.resolution.width,
        height: selected.resolution.height,
        durationSeconds,
        preset: selected.videoPreset,
      })
    : null;
  const canUseGpu = Boolean(selectedHardware && gpuDecision?.recommended);
  // Pausa/reanudar/reordenar sólo se muestran activos si el backend expone esos
  // métodos; si no, quedan deshabilitados con el motivo (no se simulan).
  const queueCapabilities = detectQueueCapabilities(store.service);
  const optionalQueueService = store.service as unknown as {
    pauseRender?: (jobId: string) => Promise<unknown>;
    resumeRender?: (jobId: string) => Promise<unknown>;
    moveRenderQueueEntry?: (jobId: string, direction: 'up' | 'down') => Promise<unknown>;
  };

  function applyPreset(preset: SavedExportPreset): void {
    setPresetId(preset.id);
    const target = profiles.find((entry) => entry.id === preset.profileId);
    if (target) {
      setProfileId(target.id);
      setUseGpu(preset.useGpu && Boolean(availableHardware(target)));
    }
    if (preset.compression !== 'custom') {
      const targetCompression = preset.compression;
      store.update((current) =>
        applyCompression(
          current,
          targetCompression,
          target?.videoCodec === 'h265' ? 'h265' : 'h264',
        ),
      );
    }
  }

  async function learnBeforeExport(): Promise<void> {
    const opened = store.state.opened;
    const current = store.state.project;
    if (!opened || !current) return;
    await recordDirectorOutcome(store.service, opened.path, current, true).catch(() => null);
  }

  async function start(): Promise<void> {
    setError(null);
    setFinished(null);
    setProgress(null);
    setStarting(true);
    try {
      const saved = await store.saveNow();
      if (!saved) {
        setError('No se pudo guardar el proyecto; el render no se inició.');
        setStarting(false);
        return;
      }
      await learnBeforeExport();
      const motionBundle = buildProjectMotionPlans(currentProject);
      if (motionBundle.errors.length > 0) throw new Error(motionBundle.errors[0]);
      const started = await store.service.startRender(
        selected?.id ?? null,
        includeCaptions,
        motionBundle.plans,
        hardwareForProfile(selected, rangeSeconds),
        exportRange,
      );
      if (!started) {
        setStarting(false);
        return;
      }
      jobRef.current = started.jobId;
      setJobId(started.jobId);
      setProgress({
        jobId: started.jobId,
        percent: 0,
        processedSeconds: 0,
        totalSeconds: rangeSeconds,
        phase: 'preparando',
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'el render no se pudo iniciar');
      setStarting(false);
    }
  }

  function waitForJob(jobId: string): Promise<RenderFinishedEvent> {
    return new Promise((resolve) => {
      batchResolverRef.current = (event) => {
        if (event.jobId === jobId) resolve(event);
      };
    });
  }

  async function startBatch(): Promise<void> {
    if (selectedBatchProfiles.length === 0) {
      setError('Elegí al menos un perfil para el lote.');
      return;
    }
    setError(null);
    setFinished(null);
    setProgress(null);
    setBatchResults([]);
    setStarting(true);
    setBatchBusy(true);
    try {
      const saved = await store.saveNow();
      if (!saved) {
        setError('No se pudo guardar el proyecto; el lote no se inició.');
        return;
      }
      await learnBeforeExport();
      const motionBundle = buildProjectMotionPlans(currentProject);
      if (motionBundle.errors.length > 0) throw new Error(motionBundle.errors[0]);
      const folder = await store.service.chooseExportDirectory();
      if (!folder) return;
      const results: BatchResult[] = [];
      for (const profile of selectedBatchProfiles) {
        const fileName = `${safeFilePart(currentProject.name)}-${safeFilePart(profile.name)}.mp4`;
        const outputPath = joinOutputPath(folder, fileName);
        const started = await store.service.startRenderTo(
          profile.id,
          outputPath,
          includeCaptions,
          motionBundle.plans,
          hardwareForProfile(profile, rangeSeconds),
          exportRange,
        );
        if (!started) {
          results.push({
            name: profile.name,
            status: 'failed',
            path: outputPath,
            message: 'no se inició',
          });
          setBatchResults([...results]);
          break;
        }
        jobRef.current = started.jobId;
        setJobId(started.jobId);
        setProgress({
          jobId: started.jobId,
          percent: 0,
          processedSeconds: 0,
          totalSeconds: store.durationFrames / fps,
          phase: `preparando ${profile.name}`,
        });
        const event = await waitForJob(started.jobId);
        results.push({
          name: profile.name,
          status: event.status,
          path: event.outputPath ?? outputPath,
          message: event.message,
        });
        setBatchResults([...results]);
        if (event.status !== 'completed') {
          setError(`El lote se detuvo en ${profile.name}: ${event.message ?? event.status}`);
          break;
        }
      }
      jobRef.current = null;
      setJobId(null);
      if (results.length > 0 && results.every((result) => result.status === 'completed')) {
        store.setNotice(`Lote completado: ${results.length} archivo(s) exportados.`);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'el lote no se pudo iniciar');
    } finally {
      setStarting(false);
      setBatchBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <div
        ref={dialogRef}
        className="modal export-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-title"
      >
        <header className="modal-head">
          <div>
            <p className="eyebrow">Exportar</p>
            <h3 id="export-title">Render MP4 verificado</h3>
          </div>
          <button type="button" className="icon-button" aria-label="Cerrar" onClick={onClose} disabled={running}>
            ×
          </button>
        </header>
        {/* Destinos de la captura 96. Sólo «Local» está implementado; el
            resto se muestra deshabilitado en vez de simular una subida. */}
        <div className="export-destinations" role="group" aria-label="Destino de exportación">
          {EXPORT_DESTINATIONS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={destination === item.id ? 'active' : ''}
              aria-pressed={destination === item.id}
              disabled={item.pending}
              title={
                item.pending
                  ? 'Estructura preparada · requiere integración de cuenta (pendiente)'
                  : item.label
              }
              onClick={() => setDestination(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>

        {profiles.length === 0 ? (
          <div className="modal-body">
            <p className="notice notice-warning">
              El proyecto no tiene perfiles de exportación. Agregá los perfiles 16:9 y 9:16 para
              continuar.
            </p>
            <button
              type="button"
              className="primary"
              onClick={() => store.update((current) => ensureDelivery(current))}
            >
              Agregar perfiles por defecto
            </button>
          </div>
        ) : (
          <>
            <div className="modal-body">
              {/* Panel de la captura 96: título, destino, coincidencia con el
                  proyecto, tipo de medio, formato, resolución, codificador,
                  calidad y avanzado. Todo con estado real. */}
              <div className="export-settings-card">
                <div className="export-settings-head">
                  <span>Títulos</span>
                  <span className="export-settings-hint">Nombre del proyecto y del archivo</span>
                </div>
                <label className="field">
                  <span>Nombre</span>
                  <input
                    type="text"
                    value={project?.name ?? ''}
                    maxLength={120}
                    disabled={running}
                    onChange={(event) =>
                      store.update((current) =>
                        updateProjectSettings(current, { name: event.target.value }),
                      )
                    }
                  />
                </label>
                <label className="field">
                  <span>Guardar en</span>
                  <div className="export-path-row">
                    <span className="export-path-value">
                      {exportFolder ?? store.state.opened?.root ?? 'Elegí una carpeta de salida'}
                    </span>
                    <button
                      type="button"
                      className="small ghost"
                      disabled={running}
                      onClick={async () => {
                        const folder = await store.service.chooseExportDirectory();
                        if (!folder) return;
                        folderRef.current = folder;
                        setExportFolder(folder);
                      }}
                    >
                      Examinar
                    </button>
                  </div>
                </label>
                <label className="field">
                  <span>Hacer coincidir con la configuración del proyecto</span>
                  <select value={matchMode} onChange={(event) => setMatchMode(event.target.value)}>
                    <option value="project">Proyecto · {project ? fpsOf(project) : 30} fps</option>
                    <option value="custom">Personalizado</option>
                  </select>
                </label>
                <div className="export-media-types" role="radiogroup" aria-label="Tipo de medio">
                  {EXPORT_MEDIA_TYPES.map((item) => (
                    <label key={item} className="export-radio">
                      <input
                        type="radio"
                        name="export-media-type"
                        checked={mediaType === item}
                        onChange={() => setMediaType(item)}
                      />
                      <span>{item}</span>
                    </label>
                  ))}
                </div>
                {mediaType !== 'Video' ? (
                  <p className="export-settings-note">
                    Sólo la exportación de video está implementada en este build.
                    Las otras opciones están preparadas, no simuladas.
                  </p>
                ) : null}
                <div className="export-settings-grid">
                  <label className="field">
                    <span>Formato</span>
                    <select
                      value={exportFormat}
                      disabled={matchMode === 'project'}
                      onChange={(event) => setExportFormat(event.target.value)}
                    >
                      {EXPORT_FORMATS.map((item) => <option key={item} value={item}>{item}</option>)}
                    </select>
                  </label>
                  <label className="field">
                    <span>Resolución</span>
                    <select
                      value={exportResolution}
                      disabled={matchMode === 'project'}
                      onChange={(event) => setExportResolution(event.target.value)}
                    >
                      {EXPORT_RESOLUTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
                    </select>
                  </label>
                  <label className="field">
                    <span>Codificador</span>
                    <select
                      value={exportCodec}
                      disabled={matchMode === 'project'}
                      onChange={(event) => setExportCodec(event.target.value)}
                    >
                      {EXPORT_CODECS.map((item) => <option key={item} value={item}>{item}</option>)}
                    </select>
                  </label>
                  <label className="field">
                    <span>Calidad</span>
                    <select value={exportQuality} onChange={(event) => setExportQuality(event.target.value)}>
                      {EXPORT_QUALITIES.map((item) => <option key={item} value={item}>{item}</option>)}
                    </select>
                  </label>
                </div>
                <div className="export-settings-foot">
                  <span>
                    {project ? fpsOf(project) : 30} fps · {selected?.container?.toUpperCase() ?? 'MP4'} ·{' '}
                    {selected?.videoCodec?.toUpperCase() ?? 'H264'} · SDR · Rec.709
                  </span>
                  <button type="button" className="small ghost" onClick={() => setAdvancedOpen((v) => !v)}>
                    Avanzado {advancedOpen ? '‹' : '›'}
                  </button>
                </div>
                {advancedOpen ? (
                  <div className="export-advanced">
                    <p>Fotogramas: {project ? fpsOf(project) : 30} fps</p>
                    <p>Velocidad: {compression}</p>
                    <p>Perfil activo: {selected?.name ?? '—'}</p>
                    <p>Duración estimada: {store.durationFrames} frames</p>
                    <p>Tamaño estimado: {exportQuality} · {exportResolution}</p>
                  </div>
                ) : null}
              </div>
              <label className="field">
                <span>Perfil</span>
                <select
                  value={selected?.id ?? ''}
                  onChange={(event) => setProfileId(event.target.value)}
                  disabled={running}
                >
                  {profiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.name} · {profile.resolution.width}×{profile.resolution.height} ·{' '}
                      {profile.aspectRatio} · {profile.videoCodec.toUpperCase()}
                    </option>
                  ))}
                </select>
              </label>
              <div className="export-presets">
                <label className="field">
                  <span>Presets guardados</span>
                  <select
                    value={presetId}
                    onChange={(event) => {
                      const preset = presets.find((entry) => entry.id === event.target.value);
                      if (preset) applyPreset(preset);
                      else setPresetId('');
                    }}
                    disabled={running || presets.length === 0}
                  >
                    <option value="">
                      {presets.length === 0 ? 'Todavía no guardaste presets' : '— Elegir preset —'}
                    </option>
                    {presets.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="export-preset-save">
                  <input
                    type="text"
                    value={presetName}
                    placeholder="Nombre del preset"
                    aria-label="Nombre del preset de exportación"
                    maxLength={48}
                    disabled={running || !selected}
                    onChange={(event) => setPresetName(event.target.value)}
                  />
                  <button
                    type="button"
                    className="small"
                    disabled={running || !selected || !presetName.trim()}
                    onClick={() => {
                      if (!selected) return;
                      setPresets(
                        saveExportPreset({
                          name: presetName,
                          profileId: selected.id,
                          compression,
                          useGpu,
                        }),
                      );
                      setPresetName('');
                    }}
                  >
                    Guardar preset
                  </button>
                  <button
                    type="button"
                    className="small ghost"
                    disabled={running || !presetId}
                    onClick={() => {
                      setPresets(deleteExportPreset(presetId));
                      setPresetId('');
                    }}
                  >
                    Eliminar
                  </button>
                </div>
                <p className="fine-print">
                  Guarda el perfil, la compresión y la GPU elegida. Son por equipo y no
                  modifican los perfiles del proyecto.
                </p>
              </div>
              {hardware?.checked ? (
                <div className="export-gpu">
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={useGpu}
                      disabled={running || !canUseGpu}
                      onChange={(event) => setUseGpu(event.target.checked)}
                    />
                    <span>
                      Acelerar con GPU{' '}
                      {selectedHardware && gpuDecision?.recommended
                        ? `· ${selectedHardware}`
                        : selectedHardware
                          ? '· no recomendada para este render'
                          : '· no disponible para este perfil'}
                    </span>
                  </label>
                  <p className="export-gpu-hint">
                    {gpuDecision?.reason}{' '}
                    {gpuDecision?.recommended
                      ? 'La calidad y el tamaño pueden diferir del encoder por software; no se usa en 32K ni si el perfil supera el límite del hardware.'
                      : 'La app mantiene el encoder por software.'}
                  </p>
                </div>
              ) : null}
              {capabilities ? (
                <div className="export-capabilities">
                  <p className="eyebrow">Compatibilidad del build</p>
                  <p className="fine-print">
                    Contenedores:{' '}
                    {capabilities.containers.map((entry) => entry.container.toUpperCase()).join(' · ')} ·
                    Video:{' '}
                    {Object.entries(capabilities.videoCodecs)
                      .map(([codec, encoders]) =>
                        `${codec}${encoders.hardware.length > 0 ? ' (GPU)' : ''}`,
                      )
                      .join(' · ')} ·
                    Audio: {capabilities.audioCodecs.join(' · ')} · Máx {capabilities.maxWidth}×
                    {capabilities.maxHeight} · HDR:{' '}
                    {capabilities.hdr ? 'soportado' : 'no soportado (SDR)'}
                  </p>
                  {selected && !(capabilities.containers.some(
                    (entry) =>
                      entry.container === selected.container &&
                      entry.videoCodecs.includes(selected.videoCodec === 'h265' ? 'hevc' : selected.videoCodec),
                  )) ? (
                    <p className="notice notice-warning">
                      El perfil «{selected.name}» usa {selected.container.toUpperCase()}/
                      {selected.videoCodec.toUpperCase()} y el build no lo reporta como soportado.
                      Elegí otro perfil o regenerá el proyecto con el formato disponible.
                    </p>
                  ) : null}
                </div>
              ) : null}
              {selected ? (
                <div className="export-compression">
                  <div className="export-compression-head">
                    <p className="eyebrow">Tamaño y velocidad</p>
                    <span>Se aplica a los {profiles.length} perfiles</span>
                  </div>
                  <div className="compression-presets" role="group" aria-label="Preset de compresión">
                    {COMPRESSION_PRESETS.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        className={compression === preset.id ? 'active' : ''}
                        aria-pressed={compression === preset.id}
                        disabled={running}
                        onClick={() =>
                          store.update((current) =>
                            applyCompression(
                              current,
                              preset.id,
                              selected.videoCodec === 'h265' ? 'h265' : 'h264',
                            ),
                          )
                        }
                      >
                        <strong>{preset.label}</strong>
                        <span>{preset.note}</span>
                        <em>CRF {preset.crf} · AAC {Math.round(preset.audioBitsPerSecond / 1000)}k</em>
                      </button>
                    ))}
                  </div>
                  <div className="export-compression-row">
                    <label className="field">
                      <span>Códec de video</span>
                      <select
                        value={selected.videoCodec === 'h265' ? 'h265' : 'h264'}
                        disabled={running}
                        onChange={(event) =>
                          store.update((current) =>
                            applyCompression(
                              current,
                              compression === 'custom' ? 'equilibrado' : compression,
                              event.target.value === 'h265' ? 'h265' : 'h264',
                            ),
                          )
                        }
                      >
                        <option value="h264">H.264 · máxima compatibilidad</option>
                        <option value="h265">H.265/HEVC · archivos más chicos</option>
                      </select>
                    </label>
                    <label className="field">
                      <span>Encuadre</span>
                      <select
                        value={selected.fit}
                        disabled={running}
                        onChange={(event) =>
                          store.update((current) =>
                            applyProfileFit(
                              current,
                              event.target.value === 'cover' ? 'cover' : 'contain',
                            ),
                          )
                        }
                      >
                        <option value="contain">Contener · mostrar todo</option>
                        <option value="cover">Recortar para llenar · sin barras</option>
                      </select>
                    </label>
                    <div className="compression-readout">
                      <span>Encoder</span>
                      <code>{selected.videoPreset}</code>
                      <span>Audio</span>
                      <code>{Math.round(selected.audioBitsPerSecond / 1000)} kbps</code>
                    </div>
                  </div>
                  <p className="fine-print">
                    {selected.videoCodec === 'h265'
                      ? 'H.265 reduce el tamaño, pero algunos reproductores y plataformas lo recomprimen o no lo aceptan. Para publicar sin sorpresas, H.264 es la opción segura. '
                      : 'Los tamaños reales dependen del contenido. “Compacto” usa CRF 27 y audio de 96 kbps; “Rápido” usa ultrafast para terminar antes. '}
                    “Recortar para llenar” hace un recorte centrado en el render; no es smart reframe por IA.
                  </p>
                </div>
              ) : null}
              {selected ? (
                <dl className="data-list compact">
                  <div>
                    <dt>Códec</dt>
                    <dd>
                      {selected.videoCodec} · {selected.audioCodec}
                    </dd>
                  </div>
                  <div>
                    <dt>FPS</dt>
                    <dd>
                      {selected.frameRate.num}/{selected.frameRate.den}
                    </dd>
                  </div>
                  <div>
                    <dt>Calidad</dt>
                    <dd>
                      {selected.bitrate.mode === 'crf'
                        ? `CRF ${selected.bitrate.crf}`
                        : `${Math.round(selected.bitrate.videoBitsPerSecond / 1_000_000)} Mbps`}{' '}
                      · {selected.videoPreset}
                    </dd>
                  </div>
                  <div>
                    <dt>Audio</dt>
                    <dd>
                      {selected.audioCodec.toUpperCase()} ·{' '}
                      {Math.round(selected.audioBitsPerSecond / 1000)} kbps
                    </dd>
                  </div>
                  <div>
                    <dt>Encuadre</dt>
                    <dd>{selected.fit === 'cover' ? 'Recortar para llenar' : 'Contener'}</dd>
                  </div>
                  <div>
                    <dt>Verificación</dt>
                    <dd>
                      mínimo {formatBytes(selected.qualityGate.minOutputBytes)} · tolerancia{' '}
                      {selected.qualityGate.durationToleranceFrames} frames
                    </dd>
                  </div>
                </dl>
              ) : null}
              {emojiWarning ? (
                <p className="notice notice-warning">
                  La preview muestra los emojis en color; el MP4 los quema en monocromo
                  (limitación del motor de subtítulos).
                </p>
              ) : null}
              {quality.length > 0 ? (
                <div className="export-quality">
                  <p className="eyebrow">Calidad de entrega</p>
                  <ul>
                    {quality.map((finding, index) => (
                      <li key={`${finding.severity}-${index}`} className={`quality-${finding.severity}`}>
                        {finding.message}
                      </li>
                    ))}
                  </ul>
                  {missingLoudness ? (
                    <button
                      type="button"
                      className="small accent-outline"
                      onClick={() =>
                        store.update((current) =>
                          updateAudioMix(current, {
                            loudnessTarget:
                              current.video.height > current.video.width
                                ? { platform: 'shorts', integratedLufs: -14, truePeakDb: -1, toleranceDb: 1 }
                                : { platform: 'youtube', integratedLufs: -14, truePeakDb: -1, toleranceDb: 1 },
                          }),
                        )
                      }
                    >
                      Corregir loudness (-14 LUFS)
                    </button>
                  ) : null}
                </div>
              ) : null}
              <label className="check">
                <input
                  type="checkbox"
                  checked={includeCaptions}
                  onChange={(event) => setIncludeCaptions(event.target.checked)}
                  disabled={running}
                />
                <span>
                  Quemar los subtítulos del proyecto en el video (libass). Actualmente hay{' '}
                  {project.captions.cues.length} subtítulo(s).
                </span>
              </label>
              <div className="export-range">
                <div className="export-compression-head">
                  <p className="eyebrow">Rango de exportación</p>
                  <span>
                    {rangeActive
                      ? `${((safeRangeEnd - safeRangeStart) / fps).toFixed(2)} s · frames ${safeRangeStart}–${safeRangeEnd}`
                      : `todo el proyecto · ${(totalFrames / fps).toFixed(2)} s`}
                  </span>
                </div>
                <div className="export-compression-row">
                  <label className="field">
                    <span>Desde (frame)</span>
                    <input
                      type="number"
                      min={0}
                      max={Math.max(0, totalFrames - 1)}
                      value={safeRangeStart}
                      disabled={running}
                      onChange={(event) =>
                        setExportRange(Number(event.target.value), safeRangeEnd)
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Hasta (frame)</span>
                    <input
                      type="number"
                      min={safeRangeStart + 1}
                      max={totalFrames}
                      value={safeRangeEnd}
                      disabled={running}
                      onChange={(event) =>
                        setExportRange(safeRangeStart, Number(event.target.value))
                      }
                    />
                  </label>
                  <button
                    type="button"
                    className="small"
                    disabled={running || !rangeActive}
                    onClick={() => {
                      setRangeStart(0);
                      setRangeEnd(totalFrames);
                    }}
                  >
                    Todo
                  </button>
                </div>
                <p className="fine-print">
                  El MP4 dura sólo este tramo; el resto del proyecto no se exporta. El final es
                  exclusivo.
                </p>
              </div>
              <p className="fine-print">
                El render usa el archivo guardado en disco. Antes de iniciar se guarda el proyecto;
                si falla el guardado, no se renderiza. Elegís la ubicación del MP4 en el diálogo de
                Windows.
              </p>

              <div className="batch-export">
                <p className="eyebrow">Lote de variantes</p>
                <p className="fine-print">
                  Elegí una carpeta una sola vez y renderizá todos los perfiles seleccionados en
                  secuencia. Si un archivo ya existe o un render falla, el lote se detiene.
                </p>
                <div className="batch-profile-list">
                  {profiles.map((profile) => (
                    <label className="check" key={profile.id}>
                      <input
                        type="checkbox"
                        checked={batchProfiles.has(profile.id)}
                        onChange={(event) => {
                          const next = new Set(batchProfiles);
                          if (event.target.checked) next.add(profile.id);
                          else next.delete(profile.id);
                          setBatchProfiles(next);
                        }}
                        disabled={running}
                      />
                      <span>
                        {profile.name} · {profile.aspectRatio}
                      </span>
                    </label>
                  ))}
                </div>
                <button
                  type="button"
                  className="accent-outline"
                  onClick={() => void startBatch()}
                  disabled={running || selectedBatchProfiles.length === 0 || hasQualityError}
                  title={hasQualityError ? 'Corregí los errores de calidad antes de exportar' : undefined}
                >
                  {batchBusy
                    ? 'Exportando lote…'
                    : `Elegir carpeta y exportar lote (${selectedBatchProfiles.length})`}
                </button>
                {batchResults.length > 0 ? (
                  <ul className="batch-results">
                    {batchResults.map((result) => (
                      <li key={`${result.name}-${result.path ?? ''}`} className={result.status}>
                        <strong>{result.name}</strong>
                        <span>
                          {result.status === 'completed'
                            ? `OK · ${basename(result.path ?? '')}`
                            : `Falló · ${result.message ?? result.status}`}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>

              <div className="batch-export">
                <p className="eyebrow">Cola de entregas</p>
                <div className="queue-capabilities">
                  <p className="fine-print">
                    {queueCapabilities.reason ?? 'Control de pausa y orden disponible.'}
                  </p>
                  <div className="actions compact">
                    <button
                      type="button"
                      className="small"
                      disabled={!queueCapabilities.pause || !jobId}
                      title={queueCapabilityTitle(queueCapabilities, 'pause')}
                      onClick={() => {
                        if (jobId) {
                          void optionalQueueService.pauseRender?.(jobId).catch((cause) => {
                            setError(cause instanceof Error ? cause.message : 'no se pudo pausar');
                          });
                        }
                      }}
                    >
                      Pausar
                    </button>
                    <button
                      type="button"
                      className="small"
                      disabled={!queueCapabilities.resume || !jobId}
                      title={queueCapabilityTitle(queueCapabilities, 'resume')}
                      onClick={() => {
                        if (jobId) {
                          void optionalQueueService.resumeRender?.(jobId).catch((cause) => {
                            setError(cause instanceof Error ? cause.message : 'no se pudo reanudar');
                          });
                        }
                      }}
                    >
                      Reanudar
                    </button>
                    <button
                      type="button"
                      className="small"
                      disabled={queue.filter((entry) => entry.status === 'pending').length < 2}
                      title={
                        queueCapabilities.reorder
                          ? 'Reordenar la cola'
                          : 'Intercambia las dos primeras entregas pendientes (el render activo no se toca)'
                      }
                      onClick={() => {
                        const target = queue.find((entry) => entry.status === 'pending');
                        const second = queue.find(
                          (entry, index) =>
                            entry.status === 'pending' &&
                            queue.findIndex((item) => item.status === 'pending') !== index,
                        );
                        if (queueCapabilities.reorder && target && optionalQueueService?.moveRenderQueueEntry) {
                          void optionalQueueService
                            .moveRenderQueueEntry(target.id, 'up')
                            .catch((cause) => {
                              setError(
                                cause instanceof Error ? cause.message : 'no se pudo reordenar',
                              );
                            });
                        } else if (second) {
                          // Sin soporte del backend, permutar pendientes sigue
                          // siendo real: el runner drena nextPending en orden.
                          setQueue((current) => movePending(current, second.id, 'up'));
                        }
                      }}
                    >
                      Reordenar
                    </button>
                  </div>
                </div>
                <p className="fine-print">
                  Encolá perfiles y se renderizan en orden con el diálogo abierto. La cola queda
                  guardada en este equipo: si cerrás la app, lo pendiente se reanuda al volver.
                </p>
                <div className="actions compact">
                  <button
                    type="button"
                    className="small"
                    onClick={() =>
                      setQueue((current) =>
                        enqueueProfiles(current, selected ? [selected] : [], includeCaptions),
                      )
                    }
                    disabled={running || !selected}
                  >
                    Encolar perfil seleccionado
                  </button>
                  <button
                    type="button"
                    className="small"
                    onClick={() =>
                      setQueue((current) =>
                        enqueueProfiles(current, selectedBatchProfiles, includeCaptions),
                      )
                    }
                    disabled={running || selectedBatchProfiles.length === 0}
                  >
                    Encolar variantes del lote ({selectedBatchProfiles.length})
                  </button>
                  <button
                    type="button"
                    className="small ghost"
                    onClick={() => setQueue(clearSettled)}
                    disabled={
                      running ||
                      !queue.some((entry) => entry.status === 'done' || entry.status === 'error')
                    }
                  >
                    Limpiar terminadas
                  </button>
                </div>
                {queue.length > 0 ? (
                  <ul className="batch-results">
                    {queue.map((entry) => (
                      <li key={entry.id} className={entry.status}>
                        <strong>{entry.profileName}</strong>
                        <span>
                          {entry.status === 'pending'
                            ? 'En cola'
                            : entry.status === 'running'
                              ? 'Renderizando…'
                              : entry.status === 'done'
                                ? `OK · ${basename(entry.outputPath ?? '')}`
                                : `Falló · ${entry.message ?? 'error'}`}
                        </span>
                        {entry.status === 'error' || entry.status === 'done' ? (
                          <button
                            type="button"
                            className="small"
                            onClick={() => setQueue((current) => retryEntry(current, entry.id))}
                            disabled={running}
                          >
                            Reintentar
                          </button>
                        ) : null}
                        {entry.status !== 'running' ? (
                          <button
                            type="button"
                            className="small"
                            onClick={() => setQueue((current) => removeEntry(current, entry.id))}
                            disabled={running}
                          >
                            Quitar
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {(() => {
                  const summary = summarizeQueue(queue);
                  if (summary.pending + summary.running === 0) return null;
                  return (
                    <p className="fine-print">
                      {summary.pending} en cola · {summary.running} en curso · {summary.done} listos ·{' '}
                      {summary.error} con error
                    </p>
                  );
                })()}
              </div>

              {progress ? (
                <div className="progress-block" role="status" aria-live="polite">
                  <div className="progress-head">
                    <strong>{progress.phase}</strong>
                    <span>{Math.round(progress.percent)}%</span>
                  </div>
                  <div className="progress-track">
                    <span style={{ width: `${Math.min(100, Math.max(0, progress.percent))}%` }} />
                  </div>
                  <p className="fine-print">
                    {progress.processedSeconds.toFixed(1)} s de {progress.totalSeconds.toFixed(1)} s
                  </p>
                </div>
              ) : null}

              {error ? <p className="notice notice-error">{error}</p> : null}

              {finished ? (
                <div className={finished.status === 'completed' ? 'render-result success' : 'render-result'}>
                  {finished.status === 'completed' ? (
                    <>
                      <RenderSuccessCard
                        name={basename(finished.outputPath ?? '')}
                        onOpenFolder={revealFinishedOutput}
                      />
                      <strong>Render completado y verificado.</strong>
                      <p className="render-file">{basename(finished.outputPath ?? '')}</p>
                      <p>
                        {formatBytes(finished.outputBytes)} ·{' '}
                        {finished.durationSeconds?.toFixed(2)} s ·{' '}
                        {finished.width}×{finished.height} ·{' '}
                        {(finished.elapsedMs / 1000).toFixed(1)} s de proceso
                      </p>
                      {validating ? (
                        <p className="fine-print">Verificando el archivo con FFprobe…</p>
                      ) : null}
                      {validation?.status === 'unavailable' ? (
                        <p className="fine-print">
                          Validación FFprobe no disponible en este entorno; el archivo se verificó
                          en el render, no se simula un segundo chequeo.
                        </p>
                      ) : null}
                      {validation && validation.status !== 'unavailable' ? (
                        <div className={`export-validation ${validation.status}`}>
                          <strong>
                            {validation.status === 'pass'
                              ? 'FFprobe: el archivo coincide con el perfil'
                              : validation.status === 'warn'
                                ? 'FFprobe: advertencias (revisá antes de publicar)'
                                : 'FFprobe: el archivo no pasó la validación'}
                          </strong>
                          <ul>
                            {validation.findings.map((finding) => (
                              <li key={`${finding.label}-${finding.detail}`} className={finding.level}>
                                <b>{finding.label}</b> · {finding.detail}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      <div className="actions compact">
                        <button
                          type="button"
                          className="small"
                          onClick={revealFinishedOutput}
                        >
                          Abrir carpeta
                        </button>
                      </div>
                    </>
                  ) : finished.status === 'cancelled' ? (
                    <strong>Render cancelado. No se reporta ningún archivo.</strong>
                  ) : (
                    <>
                      <strong>El render falló.</strong>
                      <p>{finished.message ?? 'sin detalle'}</p>
                      {finished.detail ? <pre className="log-detail">{finished.detail}</pre> : null}
                    </>
                  )}
                </div>
              ) : null}
            </div>
            <footer className="modal-foot">
              {running ? (
                <>
                  <span className="fine-print">El proceso corre en FFmpeg nativo; podés cancelarlo.</span>
                  <button
                    type="button"
                    className="danger-ghost"
                    onClick={() => {
                      if (jobId) {
                        void store.service.cancelRender(jobId).catch((cause) => {
                          const message =
                            cause instanceof Error ? cause.message : 'no se pudo cancelar';
                          if (message.includes('NOT_FOUND') || message.includes('no está en curso')) {
                            jobRef.current = null;
                            setJobId(null);
                            setStarting(false);
                            setError('El render ya terminó; revisá la carpeta de salida.');
                          } else {
                            setError(message);
                          }
                        });
                      }
                    }}
                    disabled={!jobId}
                  >
                    Cancelar render
                  </button>
                </>
              ) : (
                <>
                  <button type="button" className="ghost" onClick={onClose}>
                    Cerrar
                  </button>
                  <button
                    type="button"
                    className="primary"
                    onClick={() => void start()}
                    disabled={hasQualityError}
                    title={hasQualityError ? 'Corregí los errores de calidad antes de exportar' : undefined}
                  >
                    Elegir destino y exportar
                  </button>
                </>
              )}
            </footer>
          </>
        )}
      </div>
    </div>
  );
}
