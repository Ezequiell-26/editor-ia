import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { Asset } from '@editor-ia/project-schema';
import type { ViewId } from '../../app/navigation';
import { Icon } from '../../components/Icon';
import { ViewToolbar } from '../../components/ViewToolbar';
import { InfoTip } from '../../components/InfoTip';
import type {
  DownloaderBridgeInfo,
  DownloaderStatus,
  DownloadOutcome,
  DownloadProbe,
  DownloadProgressEvent,
  DownloadQuality,
  DownloadRequest,
  DownloadedFile,
  AudioTrack,
  PlaylistEntry,
  ProxyHealth,
  RssItem,
  WatchdogStatus,
  SponsorSegment,
} from '../../services/project-service';
import {
  addAsset,
  addClipFromAsset,
  importSubtitleCues,
} from '../../state/project-actions';
import { addMarker } from '../../state/markers';
import { parseSubtitles } from '../../state/subtitles';
import { useProjectStore } from '../../state/project-store';
import { useLicense } from '../../state/LicenseProvider';
import { takePendingDownloadUrl } from './pending';
import {
  clampParallel,
  historyFromJob,
  loadEngineAuto,
  loadEngineCheck,
  loadFeeds,
  loadHistory,
  loadMaxParallel,
  loadQueue,
  loadRssFilter,
  loadWatchFolder,
  loadWatchSeen,
  makeJob,
  MAX_PARALLEL,
  MIN_PARALLEL,
  RECOMMENDED_PARALLEL_MAX,
  newJobId,
  nextRepeatTime,
  nextWindowOpen,
  parseProxyPool,
  pickProxy,
  saveEngineAuto,
  saveEngineCheck,
  saveFeeds,
  saveHistory,
  saveMaxParallel,
  saveQueue,
  saveRssFilter,
  saveWatchFolder,
  saveWatchSeen,
  windowAllows,
  type DownloadHistoryEntry,
  type DownloadJob,
  type FeedConfig,
} from './queue';
import { normalizeDownloadUrl } from './url';

type Stage = 'idle' | 'installing' | 'probing' | 'downloading' | 'importing';

const COMPRESSION_OPTIONS = [
  { value: 'none', label: 'Original · sin recomprimir' },
  { value: 'high', label: 'Alta calidad · CRF 20' },
  { value: 'balanced', label: 'Equilibrada · CRF 24 (recomendada)' },
  { value: 'compact', label: 'Compacta · CRF 27' },
] as const;

const DOWNLOAD_DIR_KEY = 'editor-ia.download-dir.v1';

function loadDownloadDir(): string | null {
  try {
    const value = window.localStorage.getItem(DOWNLOAD_DIR_KEY);
    return value && value.trim() ? value : null;
  } catch {
    return null;
  }
}

const KIND_LABELS: Record<DownloadProbe['kind'], string> = {
  video: 'Video',
  image: 'Imagen',
  audio: 'Audio',
  gallery: 'Carrusel / lista corta',
};

const STAGE_LABELS: Record<DownloadProgressEvent['stage'], string> = {
  engine: 'Motor',
  probing: 'Analizando',
  downloading: 'Descargando',
  compressing: 'Procesando',
  importing: 'Importando',
  done: 'Listo',
};

const WEEKDAYS = [
  [1, 'Lun'],
  [2, 'Mar'],
  [3, 'Mié'],
  [4, 'Jue'],
  [5, 'Vie'],
  [6, 'Sáb'],
  [0, 'Dom'],
] as const;

const REPEAT_LABELS: Record<'hourly' | 'daily' | 'weekly', string> = {
  hourly: 'cada hora',
  daily: 'cada día',
  weekly: 'cada semana',
};

function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || bytes <= 0) return 'tamaño desconocido';
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)} kB`;
  return `${bytes} B`;
}

function rateToBytesPerSecond(value: string): number | null {
  const match = value.trim().match(/^(\d+(?:\.\d+)?)([KMGkmg]?)$/);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const unit = match[2]?.toUpperCase();
  const multiplier = unit === 'K' ? 1024 : unit === 'M' ? 1024 ** 2 : unit === 'G' ? 1024 ** 3 : 1;
  return amount * multiplier;
}

function formatDuration(seconds: number | null): string {
  if (seconds == null || seconds <= 0) return 'duración desconocida';
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

/** Igual que `formatDuration`, pero 0:00 es un instante válido. */
function formatTimestamp(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
    : `${minutes}:${String(rest).padStart(2, '0')}`;
}

function srtTime(seconds: number): string {
  const total = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(total / 3_600_000);
  const minutes = Math.floor((total % 3_600_000) / 60_000);
  const secs = Math.floor((total % 60_000) / 1000);
  const millis = total % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(millis).padStart(3, '0')}`;
}

function buildSrt(
  cues: readonly { startSeconds: number; endSeconds: number; text: string }[],
): string {
  return cues
    .map(
      (cue, index) =>
        `${index + 1}\n${srtTime(cue.startSeconds)} --> ${srtTime(cue.endSeconds)}\n${cue.text.trim()}\n`,
    )
    .join('\n');
}

function qualitySummary(quality: DownloadQuality): string {
  const parts = [quality.label];
  if (quality.fps) parts.push(`${Math.round(quality.fps)} fps`);
  if (quality.ext) parts.push(quality.ext.toUpperCase());
  if (quality.filesize) parts.push(`≈ ${formatBytes(quality.filesize)}`);
  return parts.join(' · ');
}

/** Misma lista que el enrutador de Rust: título musical = audio original. */
const MUSIC_TITLE_HINTS = ['music', 'song', 'lyrics', 'cover', 'música', 'musica', 'canción', 'cancion'];

export function titleLooksLikeMusic(title: string | null | undefined): boolean {
  const lower = (title ?? '').toLowerCase();
  return MUSIC_TITLE_HINTS.some((word) => lower.includes(word));
}

export function defaultDelogoRect(
  corner: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left',
): { x: number; y: number; w: number; h: number } {
  const w = 140 / 1920;
  const h = 50 / 1080;
  const marginX = 20 / 1920;
  const marginY = 20 / 1080;
  const x = corner === 'top-left' || corner === 'bottom-left' ? marginX : 1 - w - marginX;
  const y = corner === 'top-right' || corner === 'top-left' ? marginY : 1 - h - marginY;
  return { x, y, w, h };
}

function sanitizeCaptionCues(
  cues: readonly { startSeconds: number; endSeconds: number; text: string }[],
): { startSeconds: number; endSeconds: number; text: string }[] {
  const sorted = [...cues]
    .filter((cue) => Number.isFinite(cue.startSeconds) && cue.endSeconds > cue.startSeconds)
    .sort((a, b) => a.startSeconds - b.startSeconds);
  const result: { startSeconds: number; endSeconds: number; text: string }[] = [];
  let lastEnd = -1;
  for (const cue of sorted) {
    const start = Math.max(0, cue.startSeconds);
    if (start < lastEnd) continue;
    const end = Math.max(start + 0.05, cue.endSeconds);
    result.push({ ...cue, startSeconds: start, endSeconds: end });
    lastEnd = end;
  }
  return result;
}

export function routeLabel(duration: number | null, title: string | null): string {
  const music = titleLooksLikeMusic(title);
  const long = duration != null && duration > 60;
  if (music) {
    return long
      ? 'Ruta música larga: espejo y zoom 4 % a 60 fps sin flujo óptico; el audio original queda intacto.'
      : 'Ruta música: look completo de 60 fps y audio original intacto.';
  }
  if (duration == null) {
    return 'Duración desconocida: el enrutador la decide al inspeccionar el archivo descargado.';
  }
  return long
    ? 'Ruta video largo (>60 s): espejo y zoom 4 % a 60 fps sin flujo óptico; audio 1,02× con ruido rosa a −50 dB.'
    : 'Ruta video corto (≤60 s): look completo con flujo óptico, grano y audio original masterizado.';
}

export function DownloadView({ onNavigate }: { readonly onNavigate: (id: ViewId) => void }) {
  const store = useProjectStore();
  const { status: license, loading: licenseLoading } = useLicense();
  const isPro = license.isPro;
  const freeQueueLimit = 25;
  const project = store.state.project;
  const service = store.service;
  const [pendingUrl] = useState(takePendingDownloadUrl);
  const [url, setUrl] = useState(pendingUrl);
  const autoAnalyzed = useRef(false);
  const [cookiesPath, setCookiesPath] = useState<string | null>(null);
  const [cookiesBrowser, setCookiesBrowser] = useState('');
  const [diskFree, setDiskFree] = useState<number | null>(null);
  const [probe, setProbe] = useState<DownloadProbe | null>(null);
  const [engine, setEngine] = useState<DownloaderStatus | null>(null);
  const [bridge, setBridge] = useState<DownloaderBridgeInfo | null>(null);
  const [bridgeError, setBridgeError] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>('idle');
  const [progress, setProgress] = useState<DownloadProgressEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [rights, setRights] = useState(false);
  const [quality, setQuality] = useState<'best' | 'worst' | number>('best');
  const [destinationRoot, setDestinationRoot] = useState<string | null>(loadDownloadDir);
  const [compression, setCompression] = useState<(typeof COMPRESSION_OPTIONS)[number]['value']>(
    'none',
  );
  const [denoiseDownloads, setDenoiseDownloads] = useState(false);
  const [targetSizeMb, setTargetSizeMb] = useState('');
  const [keepOriginal, setKeepOriginal] = useState(false);
  const [cinematic, setCinematic] = useState(false);
  const [cinematicFocus, setCinematicFocus] = useState<
    'center' | 'left' | 'right' | 'top' | 'bottom'
  >('center');
  const [cinematicAudio, setCinematicAudio] = useState<string | null>(null);
  const [cinematicAudioBusy, setCinematicAudioBusy] = useState(false);
  const [autoPipeline, setAutoPipeline] = useState(false);
  const [audioSpeedNoise, setAudioSpeedNoise] = useState(false);
  const [voicePipeline, setVoicePipeline] = useState(false);
  const [voiceScript, setVoiceScript] = useState('Narración generada localmente por Olyvia.');
  const [watermark, setWatermark] = useState(true);
  const [autoRoute, setAutoRoute] = useState(false);
  const [delogo, setDelogo] = useState(false);
  const [delogoCorner, setDelogoCorner] = useState<
    'top-right' | 'top-left' | 'bottom-right' | 'bottom-left'
  >('top-right');
  const [delogoManualRect, setDelogoManualRect] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);
  const delogoPreviewRef = useRef<HTMLDivElement>(null);
  const [upscale, setUpscale] = useState(true);
  const [upscaleTarget, setUpscaleTarget] = useState<'auto' | '1080' | '2160'>('auto');
  const [proxy, setProxy] = useState('');
  const [limitRate, setLimitRate] = useState('');
  const [downloadSubtitles, setDownloadSubtitles] = useState(false);
  const [subtitleLangs, setSubtitleLangs] = useState('es.*,en.*');
  const [translateDownloadSubtitles, setTranslateDownloadSubtitles] = useState(false);
  const [translateTo, setTranslateTo] = useState('es');
  const [translateApproveCost, setTranslateApproveCost] = useState(false);
  const [translateExtras, setTranslateExtras] = useState<string[]>([]);
  const [burnDownloadSubtitles, setBurnDownloadSubtitles] = useState(false);
  const [downloadThumbnail, setDownloadThumbnail] = useState(false);
  const [downloadChapters, setDownloadChapters] = useState(false);
  const [sponsorblock, setSponsorblock] = useState(false);
  const [sponsorSegments, setSponsorSegments] = useState<SponsorSegment[]>([]);
  const [sponsorLoading, setSponsorLoading] = useState(false);
  const [sponsorCategories, setSponsorCategories] = useState<string[]>([
    'sponsor',
    'selfpromo',
    'interaction',
  ]);
  const [sponsorMarkCategories, setSponsorMarkCategories] = useState<string[]>([]);
  const [sponsorMuteCategories, setSponsorMuteCategories] = useState<string[]>([]);
  const [hashFiles, setHashFiles] = useState(false);
  const [expectedSha256, setExpectedSha256] = useState('');
  const [filenameTemplate, setFilenameTemplate] = useState('');
  const [playlistItems, setPlaylistItems] = useState('');
  const [audioLanguage, setAudioLanguage] = useState('');
  const [audioFormatId, setAudioFormatId] = useState<string | null>(null);
  const [audioTracks, setAudioTracks] = useState<AudioTrack[]>([]);
  const [audioTracksLoading, setAudioTracksLoading] = useState(false);
  const [metadataTitle, setMetadataTitle] = useState('');
  const [metadataArtist, setMetadataArtist] = useState('');
  const [metadataComment, setMetadataComment] = useState('');
  const [coverPath, setCoverPath] = useState<string | null>(null);
  const [playlistEntries, setPlaylistEntries] = useState<PlaylistEntry[]>([]);
  const [playlistSelected, setPlaylistSelected] = useState<Set<number>>(new Set());
  const [playlistLoading, setPlaylistLoading] = useState(false);
  const [trimStart, setTrimStart] = useState('');
  const [trimEnd, setTrimEnd] = useState('');
  const [batchUrls, setBatchUrls] = useState('');
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [notifyOnFinish, setNotifyOnFinish] = useState(true);
  const [watchDir, setWatchDir] = useState(() => loadWatchFolder().dir);
  const [watchEnabled, setWatchEnabled] = useState(() => loadWatchFolder().enabled);
  const [watchSeen, setWatchSeen] = useState<Record<string, number>>(loadWatchSeen);
  const [feeds, setFeeds] = useState<FeedConfig[]>(loadFeeds);
  const [rssUrl, setRssUrl] = useState('');
  const [rssFilter, setRssFilter] = useState(loadRssFilter);
  const [feedBusy, setFeedBusy] = useState(false);
  const [automationNotice, setAutomationNotice] = useState<string | null>(null);
  const [proxyHealth, setProxyHealth] = useState<ProxyHealth[]>([]);
  const [proxyTesting, setProxyTesting] = useState(false);
  const [watchdog, setWatchdog] = useState<WatchdogStatus | null>(null);
  const [insertTimeline, setInsertTimeline] = useState(true);
  const [attachSubtitles, setAttachSubtitles] = useState(true);
  const [addChapters, setAddChapters] = useState(true);
  const [queue, setQueue] = useState<DownloadJob[]>(() => loadQueue());
  const [queueExpanded, setQueueExpanded] = useState(false);
  const [history, setHistory] = useState<DownloadHistoryEntry[]>(() => loadHistory());
  const [activeJobIds, setActiveJobIds] = useState<string[]>([]);
  const [primaryJobId, setPrimaryJobId] = useState<string | null>(null);
  const [jobProgress, setJobProgress] = useState<Record<string, DownloadProgressEvent>>({});
  const [maxParallel, setMaxParallel] = useState(loadMaxParallel);
  const [advancedParallel, setAdvancedParallel] = useState(
    () => loadMaxParallel() > RECOMMENDED_PARALLEL_MAX,
  );
  const parallelMax = isPro
    ? advancedParallel
      ? MAX_PARALLEL
      : RECOMMENDED_PARALLEL_MAX
    : 2;

  useEffect(() => {
    if (licenseLoading || isPro) return;
    if (maxParallel > 2) {
      setMaxParallel(2);
      saveMaxParallel(2);
    }
  }, [licenseLoading, isPro, maxParallel]);
  const [scheduledFor, setScheduledFor] = useState('');
  const [repeat, setRepeat] = useState<'none' | 'hourly' | 'daily' | 'weekly'>('none');
  const [windowStart, setWindowStart] = useState('');
  const [windowEnd, setWindowEnd] = useState('');
  const [windowDays, setWindowDays] = useState<number[]>([]);
  const [schedulerTick, setSchedulerTick] = useState(0);
  const [engineUpdating, setEngineUpdating] = useState(false);
  const [engineAuto, setEngineAuto] = useState(loadEngineAuto);
  const activeJobIdsRef = useRef<string[]>([]);
  const primaryJobIdRef = useRef<string | null>(null);
  const startingJobsRef = useRef<Set<string>>(new Set());
  const cancelledJobsRef = useRef<Set<string>>(new Set());
  const importChainRef = useRef<Promise<void>>(Promise.resolve());
  const refreshWatchRef = useRef<() => Promise<void>>(async () => {});
  const refreshFeedsRef = useRef<() => Promise<void>>(async () => {});
  const proxyCursorRef = useRef(0);
  const [format, setFormat] = useState<'mp4' | 'mkv' | 'webm' | 'mp3' | 'm4a'>('mp4');
  const [codec, setCodec] = useState<'h265' | 'h264' | 'av1'>('h265');
  const [hdrMode, setHdrMode] = useState<'tonemap' | 'preserve'>('tonemap');
  const [outcome, setOutcome] = useState<DownloadOutcome | null>(null);
  const [importedCount, setImportedCount] = useState(0);

  const busy = stage !== 'idle';
  const activeJobId = activeJobIds[0] ?? null;
  const primaryJob = queue.find((job) => job.id === primaryJobId) ?? null;
  const displayProgress = primaryJob
    ? jobProgress[primaryJob.runId] ?? progress
    : progress;
  const queueRunning = activeJobIds.length;
  const pendingJobs = queue.filter((job) => job.status === 'pending').length;
  const failedJobs = queue.filter((job) => job.status === 'error').length;
  const activePercents = activeJobIds
    .map((id) => queue.find((job) => job.id === id))
    .map((job) => (job ? jobProgress[job.runId]?.percent : null))
    .filter((value): value is number => value != null && Number.isFinite(value));
  const consolidatedPercent =
    activePercents.length > 0
      ? activePercents.reduce((total, value) => total + value, 0) / activePercents.length
      : 0;
  const showQueueDetails = queueExpanded || queue.length <= 3;
  const occupiedQueueSlots = queue.filter(
    (job) => job.status !== 'done' && job.status !== 'cancelled',
  ).length;

  useEffect(() => {
    let cancelled = false;
    void service
      .downloadDiskSpace(destinationRoot)
      .then((free) => {
        if (!cancelled) setDiskFree(free);
      })
      .catch(() => {
        if (!cancelled) setDiskFree(null);
      });
    return () => {
      cancelled = true;
    };
  }, [service, destinationRoot]);

  useEffect(() => {
    saveQueue(queue);
  }, [queue]);

  useEffect(() => {
    saveHistory(history);
  }, [history]);

  useEffect(() => {
    let cancelled = false;
    void service
      .watchdogStatus()
      .then((status) => {
        if (!cancelled) setWatchdog(status);
      })
      .catch(() => {
        if (!cancelled) setWatchdog(null);
      });
    return () => {
      cancelled = true;
    };
  }, [service]);

  useEffect(() => {
    let cancelled = false;
    void service
      .downloaderStatus()
      .then((status) => {
        if (!cancelled) setEngine(status);
      })
      .catch((reason) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : 'no se pudo consultar el motor');
        }
      });
    void service
      .downloaderBridgeInfo()
      .then((info) => {
        if (!cancelled) setBridge(info);
      })
      .catch((reason) => {
        if (!cancelled) {
          setBridgeError(
            reason instanceof Error ? reason.message : 'el puente para la extensión no está disponible',
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [service]);

  useEffect(() => {
    if (!engine?.available || !engineAuto) return;
    const last = loadEngineCheck();
    if (Date.now() - last < 7 * 86_400_000) return;
    void service
      .updateDownloader()
      .then((status) => {
        setEngine(status);
        saveEngineCheck(Date.now());
        if (status.available) store.setNotice('Motor yt-dlp actualizado automáticamente.');
      })
      .catch(() => {
        // Sin red o sin permisos: se reintenta en el próximo arranque.
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine?.available, engineAuto, service]);

  async function copyBridge(): Promise<void> {
    if (!bridge) return;
    try {
      await navigator.clipboard.writeText(`${bridge.port}:${bridge.token}`);
      store.setNotice('Conexión copiada. Pegala en la extensión una vez.');
    } catch {
      store.setNotice('No se pudo copiar; seleccioná el token a mano.');
    }
  }

  useEffect(() => {
    if (autoAnalyzed.current || !pendingUrl.trim()) return;
    autoAnalyzed.current = true;
    void analyze();
    // Sólo se autoanaliza la URL que llegó desde otra vista.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingUrl]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    void service
      .onDownloadProgress((event) => {
        if (!event.runId) {
          setProgress(event);
          return;
        }
        setJobProgress((current) => ({ ...current, [event.runId]: event }));
      })
      .then((stop) => {
        if (cancelled) stop();
        else unlisten = stop;
      })
      .catch(() => {
        // Los eventos son una mejora de la UI; la descarga sigue funcionando sin ellos.
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [service]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    void service
      .onDenoiseProgress((event) => {
        setProgress((current) =>
          current && current.stage === 'compressing'
            ? { ...current, percent: event.percent }
            : current,
        );
      })
      .then((stop) => {
        if (cancelled) stop();
        else unlisten = stop;
      })
      .catch(() => {
        // El denoise igual funciona sin eventos de progreso.
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [service]);

  async function installEngine(): Promise<void> {
    setStage('installing');
    setError(null);
    try {
      const status = await service.installDownloader();
      setEngine(status);
      store.setNotice(`Motor de descargas instalado (${status.version ?? 'yt-dlp'}).`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'no se pudo instalar el motor');
    } finally {
      setStage('idle');
      setProgress(null);
    }
  }

  const activeDelogoRect = delogoManualRect ?? defaultDelogoRect(delogoCorner);

  function beginDelogoDrag(
    mode: 'move' | 'resize',
    event: ReactPointerEvent<HTMLElement>,
  ): void {
    const stage = delogoPreviewRef.current;
    if (!stage) return;
    event.preventDefault();
    event.stopPropagation();
    const bounds = stage.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    const startX = event.clientX;
    const startY = event.clientY;
    const start = activeDelogoRect;
    const move = (moveEvent: PointerEvent) => {
      const dx = (moveEvent.clientX - startX) / bounds.width;
      const dy = (moveEvent.clientY - startY) / bounds.height;
      if (mode === 'move') {
        setDelogoManualRect({
          ...start,
          x: Math.min(Math.max(0, start.x + dx), 1 - start.w),
          y: Math.min(Math.max(0, start.y + dy), 1 - start.h),
        });
      } else {
        setDelogoManualRect({
          ...start,
          w: Math.min(Math.max(0.02, start.w + dx), 1 - start.x),
          h: Math.min(Math.max(0.02, start.h + dy), 1 - start.y),
        });
      }
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  async function updateEngine(): Promise<void> {
    setEngineUpdating(true);
    setError(null);
    try {
      const status = await service.updateDownloader();
      setEngine(status);
      store.setNotice(`Motor actualizado (${status.version ?? 'yt-dlp'}).`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'no se pudo actualizar el motor');
    } finally {
      setEngineUpdating(false);
    }
  }

  async function chooseDestination(): Promise<void> {
    setError(null);
    try {
      const picked = await service.chooseDownloadDirectory();
      if (!picked) return;
      setDestinationRoot(picked);
      try {
        window.localStorage.setItem(DOWNLOAD_DIR_KEY, picked);
      } catch {
        // The choice still applies to this session.
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'no se pudo elegir la carpeta');
    }
  }

  function useDefaultDestination(): void {
    setDestinationRoot(null);
    try {
      window.localStorage.removeItem(DOWNLOAD_DIR_KEY);
    } catch {
      // Ignore unavailable storage.
    }
  }

  async function chooseCookies(): Promise<void> {
    setError(null);
    try {
      const picked = await service.chooseCookiesFile();
      if (!picked) return;
      setCookiesPath(picked);
      setProbe(null);
      setOutcome(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'no se pudo abrir el archivo de cookies');
    }
  }

  async function chooseCinematicAudio(): Promise<void> {
    setCinematicAudioBusy(true);
    setError(null);
    try {
      const picked = await service.chooseAudioFile('Elegir banda sonora para el look cinematográfico');
      if (picked) {
        setCinematicAudio(picked);
        setAudioSpeedNoise(false);
      }
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'no se pudo elegir la banda sonora',
      );
    } finally {
      setCinematicAudioBusy(false);
    }
  }

  async function analyze(): Promise<void> {
    const trimmed = normalizeDownloadUrl(url);
    if (!trimmed) {
      setError(
        'Pegá un enlace http(s) válido, por ejemplo https://youtu.be/… o youtube.com/watch?v=…',
      );
      return;
    }
    setUrl(trimmed);
    setStage('probing');
    setError(null);
    setWarnings([]);
    setProbe(null);
    setOutcome(null);
    setImportedCount(0);
    setProgress(null);
    setSponsorSegments([]);
    try {
      const result = await service.probeDownload(
        trimmed,
        cookiesPath,
        cookiesBrowser || null,
      );
      setProbe(result);
      setQuality('best');
      setFormat(result.kind === 'audio' ? 'm4a' : 'mp4');
      setCompression('none');
      setCinematic(false);
      setAutoPipeline(false);
      setAudioSpeedNoise(false);
      setVoicePipeline(false);
      setAutoRoute(false);
      setDelogo(false);
      setDelogoManualRect(null);
      setDownloadSubtitles(false);
      setTranslateDownloadSubtitles(false);
      setTranslateApproveCost(false);
      setTranslateExtras([]);
      setBurnDownloadSubtitles(false);
      setDownloadThumbnail(false);
      setDownloadChapters(false);
      setSponsorblock(false);
      setSponsorMarkCategories([]);
      setSponsorMuteCategories([]);
      setHashFiles(false);
      setExpectedSha256('');
      setPlaylistItems('');
      setPlaylistEntries([]);
      setPlaylistSelected(new Set());
      setAudioLanguage('');
      setAudioFormatId(null);
      setAudioTracks([]);
      setMetadataTitle('');
      setMetadataArtist('');
      setMetadataComment('');
      setCoverPath(null);
      setWatermark(true);
      setCinematicAudio(null);
      setRights(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'no se pudo analizar la URL');
    } finally {
      setStage('idle');
      setProgress(null);
    }
  }

  function patchJob(id: string, patch: Partial<DownloadJob>): void {
    setQueue((current) =>
      current.map((job) => (job.id === id ? { ...job, ...patch } : job)),
    );
  }

  function setLive(
    job: DownloadJob,
    stage: DownloadProgressEvent['stage'],
    percent: number | null,
    message: string,
  ): void {
    setJobProgress((current) => ({
      ...current,
      [job.runId]: { runId: job.runId, stage, percent, message },
    }));
  }

  function beginActive(jobId: string): void {
    if (!activeJobIdsRef.current.includes(jobId)) {
      activeJobIdsRef.current = [...activeJobIdsRef.current, jobId];
      setActiveJobIds(activeJobIdsRef.current);
    }
    if (!primaryJobIdRef.current) {
      primaryJobIdRef.current = jobId;
      setPrimaryJobId(jobId);
    }
  }

  function endActive(job: DownloadJob): void {
    activeJobIdsRef.current = activeJobIdsRef.current.filter((id) => id !== job.id);
    setActiveJobIds(activeJobIdsRef.current);
    startingJobsRef.current.delete(job.id);
    cancelledJobsRef.current.delete(job.id);
    setJobProgress((current) => {
      const next = { ...current };
      delete next[job.runId];
      return next;
    });
    if (primaryJobIdRef.current === job.id) {
      const next = activeJobIdsRef.current[0] ?? null;
      primaryJobIdRef.current = next;
      setPrimaryJobId(next);
      if (!next) {
        setStage('idle');
        setProgress(null);
      }
    }
  }

  function finalizeJob(
    job: DownloadJob,
    status: 'done' | 'error' | 'cancelled',
    error: string | null,
    outcome: DownloadOutcome | null,
  ): void {
    const attempts = (job.attempts ?? 0) + 1;
    const permanent =
      status !== 'error' ||
      /cancelada|inválid|espacio insuficiente|no existe|no se pudo medir/i.test(error ?? '');
    const willRetry = status === 'error' && !permanent && attempts <= 2;
    const effectiveError = willRetry
      ? `${error} · reintento ${attempts}/2 en ${attempts * 2} s`
      : error;
    const bytes = outcome?.files.reduce((total, file) => total + file.bytes, 0) ?? 0;
    const started = job.startedAt ? Date.parse(job.startedAt) : Number.NaN;
    const elapsedSeconds = Number.isFinite(started)
      ? Math.max(0, (Date.now() - started) / 1000)
      : null;
    const averageBytesPerSecond =
      elapsedSeconds && elapsedSeconds > 0 && bytes > 0
        ? bytes / elapsedSeconds
        : null;
    const finished = {
      ...job,
      status,
      error: effectiveError,
      outcome,
      attempts,
    };
    setQueue((current) =>
      status === 'error'
        ? current.map((item) => (item.id === job.id ? finished : item))
        : current.filter((item) => item.id !== job.id),
    );
    if (!willRetry) {
      setHistory((current) => [
        historyFromJob(finished, status, error, { elapsedSeconds, averageBytesPerSecond }),
        ...current,
      ].slice(0, 12));
    }
    if (status === 'done' && job.repeat && job.repeat !== 'none') {
      const base = job.scheduledFor ? Date.parse(job.scheduledFor) : Date.now();
      const at = nextRepeatTime(job.repeat, base) ?? Date.now();
      const probe: DownloadProbe = {
        url: job.url,
        title: job.title,
        uploader: null,
        durationSeconds: job.durationSeconds,
        thumbnail: job.thumbnail,
        kind: job.kind,
        entryCount: 1,
        maxHeight: null,
        estimatedBytes: job.request.estimatedBytes ?? null,
        qualities: [],
      };
      const next = makeJob({
        probe,
        request: { ...job.request, runId: null },
        denoise: job.denoise,
        scheduledFor: new Date(at).toISOString(),
        repeat: job.repeat,
        windowStart: job.windowStart ?? null,
        windowEnd: job.windowEnd ?? null,
        windowDays: job.windowDays ?? [],
        translateSubtitles: job.translateSubtitles ?? false,
        translateTo: job.translateTo ?? null,
        translateExtras: job.translateExtras ?? [],
        translateApproveCost: job.translateApproveCost ?? false,
        burnSubtitles: job.burnSubtitles ?? false,
      });
      setQueue((current) => [...current, next]);
    }
    if (notifyOnFinish && !willRetry && status !== 'cancelled') {
      void service
        .notifyUser(
          status === 'done' ? 'Descarga completada' : 'Descarga con error',
          `${job.title || job.url}${error ? ` · ${error}` : ''}`,
        )
        .catch(() => {
          // La notificación es opcional; el trabajo ya terminó.
        });
    } else {
      window.setTimeout(() => {
        const pool = parseProxyPool(proxy);
        setQueue((current) =>
          current.map((item) => {
            if (item.id !== job.id) return item;
            const used = item.request.proxy ?? '';
            const index = pool.indexOf(used);
            const nextProxy =
              pool.length > 1
                ? pool[(index + 1 + pool.length) % pool.length] ?? used
                : used;
            return {
              ...item,
              status: 'pending',
              error: null,
              request: nextProxy
                ? { ...item.request, proxy: nextProxy }
                : item.request,
            };
          }),
        );
      }, attempts * 2_000);
    }
    endActive(job);
  }

  async function withImportLock<T>(work: () => Promise<T>): Promise<T> {
    const previous = importChainRef.current;
    let release: () => void = () => {};
    importChainRef.current = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous.catch(() => {});
    try {
      return await work();
    } finally {
      release();
    }
  }

  function currentRequest(
    activeProbe: {
      url: string;
      title: string;
      kind: DownloadProbe['kind'];
      durationSeconds: number | null;
      estimatedBytes?: number | null;
    },
    proxyOverride?: string | null,
  ): DownloadRequest {
    const parseTrim = (value: string): number | null => {
      const parsed = Number(value);
      return value.trim() && Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
    };
    return {
      url: activeProbe.url,
      maxHeight: typeof quality === 'number' ? quality : null,
      quality: typeof quality === 'number' ? 'height' : quality,
      compression: cinematic ? 'none' : compression,
      codec: hdrMode === 'preserve' && codec === 'h264' ? 'h265' : codec,
      hdrMode: cinematic || format !== 'mp4' ? null : hdrMode,
      targetSizeMb:
        !cinematic &&
        format === 'mp4' &&
        /^\d+$/.test(targetSizeMb.trim()) &&
        Number(targetSizeMb) >= 5
          ? Number(targetSizeMb)
          : null,
      keepOriginal,
      kind: activeProbe.kind,
      playlist: activeProbe.kind === 'gallery',
      cookiesFile: cookiesPath,
      cookiesFromBrowser: cookiesBrowser || null,
      format,
      saveToDownloads: true,
      destinationRoot,
      cinematic,
      cinematicFocus,
      replacementAudio: cinematic ? cinematicAudio : null,
      autoPipeline: cinematic ? autoPipeline : false,
      audioSpeedNoise: cinematic ? audioSpeedNoise && !cinematicAudio && !voicePipeline : false,
      voicePipeline: cinematic ? voicePipeline : false,
      voiceScript: cinematic ? voiceScript : null,
      watermark: cinematic ? watermark : false,
      delogo: cinematic ? delogo : false,
      delogoCorner: cinematic ? delogoCorner : null,
      delogoRect: cinematic && delogo ? delogoManualRect : null,
      upscale: cinematic ? upscale : false,
      upscaleTarget: cinematic ? upscaleTarget : null,
      autoRoute: cinematic ? autoRoute : false,
      sourceTitle: activeProbe.title,
      sourceDuration: activeProbe.durationSeconds,
      proxy:
        proxyOverride === undefined
          ? proxy.trim() || null
          : proxyOverride ?? null,
      limitRate: limitRate.trim() || null,
      downloadSubtitles,
      subtitleLangs: downloadSubtitles ? subtitleLangs.trim() || null : null,
      downloadThumbnail,
      downloadChapters,
      sponsorblock:
        sponsorblock || sponsorMarkCategories.length > 0 || sponsorMuteCategories.length > 0,
      sponsorblockCategories:
        sponsorblock && sponsorCategories.length > 0 ? sponsorCategories.join(',') : null,
      sponsorblockMark:
        sponsorMarkCategories.length > 0 ? sponsorMarkCategories.join(',') : null,
      sponsorblockMute:
        sponsorMuteCategories.length > 0 ? sponsorMuteCategories.join(',') : null,
      filenameTemplate: filenameTemplate.trim() || null,
      playlistItems: playlistItems.trim() || null,
      audioLanguage: audioLanguage.trim() || null,
      audioFormatId,
      metadataTitle: metadataTitle.trim() || null,
      metadataArtist: metadataArtist.trim() || null,
      metadataComment: metadataComment.trim() || null,
      coverPath,
      hashFiles,
      expectedSha256: expectedSha256.trim() || null,
      trimStart: parseTrim(trimStart),
      trimEnd: parseTrim(trimEnd),
      estimatedBytes: activeProbe.estimatedBytes ?? null,
    };
  }

  async function download(job: DownloadJob): Promise<void> {
    beginActive(job.id);
    cancelledJobsRef.current.delete(job.id);
    patchJob(job.id, {
      status: 'running',
      error: null,
      startedAt: new Date().toISOString(),
    });
    setLive(job, 'downloading', null, 'Iniciando descarga…');
    let downloaded: DownloadOutcome | null = null;
    let finalStatus: 'done' | 'error' | 'cancelled' = 'error';
    let finalError: string | null = null;
    try {
      downloaded = await service.downloadMedia(job.request);
      finalStatus = 'done';
      setOutcome(downloaded);
      setWarnings([...downloaded.warnings]);
      const postWarnings: string[] = [];
      let subtitleContent = downloaded.subtitles?.[0]?.text ?? '';
      if (job.translateSubtitles && (downloaded.subtitles?.length ?? 0) > 0) {
        setLive(job, 'compressing', null, 'Traduciendo subtítulos…');
        const primary = job.translateTo || 'es';
        const languages = [
          primary,
          ...(job.translateExtras ?? []).filter((language) => language !== primary),
        ];
        const stem =
          downloaded.files.find((file) => file.kind === 'video')?.name.replace(/\.[^.]+$/, '') ??
          'video';
        const translatedSubtitles = [...(downloaded.subtitles ?? [])];
        let translatedCount = 0;
        let primaryContent = '';
        for (const language of languages) {
          for (const [index, subtitle] of (downloaded.subtitles ?? []).entries()) {
            try {
              const cues = parseSubtitles(subtitle.text).cues;
              if (cues.length === 0) continue;
              const translatedTexts: string[] = [];
              let simulated = false;
              for (let start = 0; start < cues.length; start += 80) {
                const chunk = cues.slice(start, start + 80);
                const translated = await service.translateSubtitles({
                  texts: chunk.map((cue) => cue.text),
                  sourceLanguage: 'auto',
                  targetLanguage: language,
                  approvedCost: job.translateApproveCost ?? false,
                });
                if (translated.simulated) {
                  simulated = true;
                  break;
                }
                translatedTexts.push(...translated.texts);
              }
              if (simulated) {
                postWarnings.push(
                  'La traducción quedó simulada porque no hay un proveedor configurado; se conservó el SRT original.',
                );
                break;
              }
              if (translatedTexts.length !== cues.length) continue;
              const content = buildSrt(
                cues.map((cue, cueIndex) => ({
                  startSeconds: cue.startSeconds,
                  endSeconds: cue.endSeconds,
                  text: translatedTexts[cueIndex] ?? cue.text,
                })),
              );
              const base = subtitle.name.replace(/\.[^.]+$/, '') || `${stem}-${index + 1}`;
              const saved = await service.saveLocalizedSubtitle({
                content,
                outputDir: downloaded.directory,
                baseName: `${base}.${language}`,
                language,
                format: 'srt',
              });
              translatedSubtitles.push({
                path: saved.path,
                name: saved.path.split(/[\\/]/).pop() ?? `${base}.${language}.srt`,
                text: content,
              });
              translatedCount += 1;
              if (language === primary && !primaryContent) primaryContent = content;
            } catch (reason) {
              postWarnings.push(
                `No se pudo traducir ${subtitle.name} a ${language}: ${
                  reason instanceof Error ? reason.message : 'error desconocido'
                }`,
              );
            }
          }
        }
        downloaded = { ...downloaded, subtitles: translatedSubtitles };
        if (primaryContent) subtitleContent = primaryContent;
        if (translatedCount > 0) {
          postWarnings.push(
            `${translatedCount} subtítulo(s) traducidos a ${languages.join(', ')}.`,
          );
        }
      }
      if (job.burnSubtitles && subtitleContent.trim()) {
        setLive(job, 'compressing', null, 'Quemando subtítulos en el video…');
        const burned: DownloadedFile[] = [];
        for (const file of downloaded.files) {
          if (file.kind !== 'video') {
            burned.push(file);
            continue;
          }
          const output = file.path.replace(/\.[^.]+$/, ' - subtitulado.mp4');
          try {
            const result = await service.creatorBurnSubtitles({
              inputPath: file.path,
              outputPath: output,
              subtitleText: subtitleContent,
            });
            burned.push({
              ...file,
              path: result.path,
              name: result.path.split(/[\\/]/).pop() ?? file.name,
              bytes: result.bytes,
            });
            postWarnings.push(`Subtítulos quemados en ${result.path.split(/[\\/]/).pop()}.`);
          } catch (reason) {
            burned.push(file);
            postWarnings.push(
              `No se pudieron quemar los subtítulos de ${file.name}: ${
                reason instanceof Error ? reason.message : 'error desconocido'
              }`,
            );
          }
        }
        downloaded = { ...downloaded, files: burned };
      }
      setWarnings([...downloaded.warnings, ...postWarnings]);
      if (!project) {
        store.setNotice(`Descarga terminada en ${destinationPath}.`);
        return;
      }
      setLive(job, 'importing', null, 'Importando al proyecto…');
      let importPaths = downloaded.files
        .filter((file) => !/\.(srt|vtt|ass|ssa)$/i.test(file.name))
        .map((file) => file.path);
      const denoiseWarnings: string[] = [];
      if (job.denoise) {
        const cleaned: string[] = [];
        for (const file of downloaded.files) {
          if (file.kind !== 'video') {
            cleaned.push(file.path);
            continue;
          }
          setLive(job, 'compressing', 0, `Reduciendo ruido de ${file.name}…`);
          try {
            const result = await service.denoiseMedia({
              inputPath: file.path,
              mode: 'video',
              preset: 'fast',
              strength: 45,
              temporal: true,
              preserveDetail: true,
            });
            cleaned.push(result.path);
          } catch {
            denoiseWarnings.push(
              `No se pudo reducir el ruido de ${file.name}; se importó el original.`,
            );
            cleaned.push(file.path);
          }
        }
        importPaths = cleaned;
      }
      const imported = await service.importMediaPaths({
        paths: importPaths,
        fpsNum: project.video.frameRate.num,
        fpsDen: project.video.frameRate.den,
        confirmRights: true,
        provider: 'social-download',
      });
      if (imported.assets.length === 0) {
        finalStatus = 'error';
        finalError = imported.warnings.length
          ? imported.warnings.join(' ')
          : 'La descarga terminó pero no se pudo importar al proyecto.';
        setError(finalError);
        setWarnings([...downloaded.warnings, ...denoiseWarnings, ...imported.warnings]);
        return;
      }
      const integrationWarnings: string[] = [];
      const assets = imported.assets as Asset[];
      const rawSubtitleCues = attachSubtitles
        ? sanitizeCaptionCues(
            (downloaded.subtitles ?? []).flatMap((subtitle) =>
              parseSubtitles(subtitle.text).cues.map((cue) => ({
                text: cue.text,
                startSeconds: cue.startSeconds,
                endSeconds: cue.endSeconds,
              })),
            ),
          )
        : [];
      const chapters = addChapters
        ? downloaded.files.flatMap((file) => file.chapters ?? [])
        : [];
      // Una sola mutación: store.mutate usa el snapshot del último render y
      // dos llamadas seguidas en el mismo tick se pisan entre sí.
      await withImportLock(async () => {
        // Deja correr un tick para que el store vea la mutación anterior.
        await new Promise((resolve) => setTimeout(resolve, 0));
        store.mutate(
        (current) => {
          let next = current;
          for (const asset of assets) {
            next = addAsset(next, asset);
          }
          const cover = assets.find(
            (asset) => asset.kind === 'image' && asset.status === 'ready',
          );
          if (cover && !('x-coverAssetId' in next)) {
            Object.assign(next, { 'x-coverAssetId': cover.id });
          }
          let placedStartFrame = 0;
          let clipsAdded = 0;
          if (insertTimeline) {
            for (const asset of assets.filter((item) => item.kind === 'video')) {
              try {
                const placed = addClipFromAsset(
                  next,
                  asset,
                  clipsAdded === 0 ? { atFrame: 0 } : {},
                );
                if (clipsAdded === 0) placedStartFrame = placed.startFrame;
                next = placed.project;
                clipsAdded += 1;
              } catch (reason) {
                integrationWarnings.push(
                  `No se pudo insertar el clip en el timeline: ${
                    reason instanceof Error ? reason.message : 'error desconocido'
                  }`,
                );
                break;
              }
            }
          }
          const fps = current.video.frameRate.num / current.video.frameRate.den;
          const offsetSeconds = placedStartFrame / fps;
          const timelinePlaced = insertTimeline && clipsAdded > 0;
          if (timelinePlaced && rawSubtitleCues.length > 0) {
            try {
              next = importSubtitleCues(
                next,
                rawSubtitleCues.map((cue) => ({
                  text: cue.text,
                  startSeconds: cue.startSeconds + offsetSeconds,
                  endSeconds: cue.endSeconds + offsetSeconds,
                })),
                { replace: false },
              ).project;
            } catch (reason) {
              integrationWarnings.push(
                `No se pudieron adjuntar los subtítulos: ${
                  reason instanceof Error ? reason.message : 'error desconocido'
                }`,
              );
            }
          }
          if (timelinePlaced && chapters.length > 0) {
            for (const chapter of chapters) {
              const frame = Math.max(
                0,
                Math.round((chapter.startSeconds + offsetSeconds) * fps),
              );
              if (next.markers.some((marker) => marker.frame === frame)) continue;
              try {
                next = addMarker(next, frame, {
                  label: chapter.title,
                  color: 'blue',
                }).project;
              } catch {
                // Marcador duplicado o límite alcanzado: se omite.
              }
            }
          }
          if (
            !timelinePlaced &&
            (rawSubtitleCues.length > 0 || chapters.length > 0)
          ) {
            integrationWarnings.push(
              'Subtítulos y capítulos no se ubicaron porque el clip no se insertó en el timeline.',
            );
          }
          return { project: next };
        },
        { notice: `${imported.assets.length} archivo(s) procesados en el proyecto.` },
        );
      });
      if (assets.some((asset) => asset.kind === 'image')) {
        integrationWarnings.push('Miniatura descargada e importada a Medios.');
      }
      setImportedCount(imported.assets.length);
      setWarnings([
        ...downloaded.warnings,
        ...denoiseWarnings,
        ...imported.warnings,
        ...integrationWarnings,
      ]);
      if (imported.warnings.length === 0) {
        await service.cleanupDownload(downloaded.runId).catch(() => {});
      }
      store.setNotice(
        `${imported.assets.length} archivo(s) listos en Medios. Revisá los derechos antes de exportar.`,
      );
      setLive(job, 'done', 100, 'Importado al proyecto.');
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'la descarga falló';
      finalStatus =
        cancelledJobsRef.current.has(job.id) || /cancelada/i.test(message)
          ? 'cancelled'
          : 'error';
      finalError = finalStatus === 'cancelled' ? 'Descarga cancelada.' : message;
      setError(finalError);
      if (downloaded && downloaded.files.length > 0) {
        setWarnings([
          ...downloaded.warnings,
          `Los archivos quedaron en ${downloaded.directory} por si querés importarlos a mano.`,
        ]);
      }
    } finally {
      finalizeJob(job, finalStatus, finalError, downloaded);
    }
  }

  function nextProxy(): string | null {
    const pool = parseProxyPool(proxy);
    const picked = pickProxy(pool, proxyCursorRef.current);
    if (picked) proxyCursorRef.current += 1;
    return picked;
  }

  async function loadSponsorSegments(): Promise<void> {
    if (!probe) return;
    const categories = [...new Set([...sponsorCategories, ...sponsorMarkCategories])];
    if (categories.length === 0) return;
    setSponsorLoading(true);
    setError(null);
    try {
      const segments = await service.sponsorblockPreview(probe.url, categories.join(','));
      setSponsorSegments(segments);
      store.setNotice(
        segments.length > 0
          ? `${segments.length} segmento(s) de SponsorBlock detectados.`
          : 'SponsorBlock no encontró segmentos para este video.',
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'No se pudieron consultar los segmentos de SponsorBlock.',
      );
    } finally {
      setSponsorLoading(false);
    }
  }

  function scheduledIso(): string | null {
    const raw = scheduledFor.trim();
    if (!raw) return null;
    const time = Date.parse(raw);
    if (!Number.isFinite(time) || time <= Date.now() + 1_000) {
      throw new Error('Elegí una fecha y hora futuras para programar la descarga.');
    }
    return new Date(time).toISOString();
  }

  function applyQuickPreset(preset: 'original' | 'compact' | 'cine'): void {
    if (preset === 'original') {
      setCompression('none');
      setCinematic(false);
      setAutoPipeline(false);
      setTargetSizeMb('');
      setCodec('h265');
      setHdrMode('tonemap');
    } else if (preset === 'compact') {
      setCompression('compact');
      setCinematic(false);
      setAutoPipeline(false);
      setTargetSizeMb('');
      setFormat('mp4');
    } else {
      setFormat('mp4');
      setCompression('none');
      setCinematic(true);
      setAutoPipeline(false);
      setUpscale(true);
      setUpscaleTarget('auto');
    }
    setError(null);
  }

  function planQueueMessage(): string {
    return `El plan Free permite ${freeQueueLimit} descargas en cola. Activá Pro para ampliarla.`;
  }

  function enqueueCurrent(): void {
    if (!isPro && occupiedQueueSlots >= freeQueueLimit) {
      setError(planQueueMessage());
      return;
    }
    if (!probe || !rights) {
      setError('Confirmá que tenés derechos para descargar y usar este contenido.');
      return;
    }
    if (
      skipDuplicates &&
      history.some((entry) => entry.status === 'done' && entry.url === probe.url)
    ) {
      setError('Ese video ya se descargó correctamente. Desactivá “omitir duplicados” para repetirlo.');
      return;
    }
    let schedule: string | null;
    try {
      schedule = scheduledIso();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'La programación no es válida.');
      return;
    }
    const job = makeJob({
      probe,
      request: currentRequest(probe, nextProxy()),
      denoise: denoiseDownloads,
      scheduledFor: schedule,
      repeat,
      windowStart: windowStart.trim() || null,
      windowEnd: windowEnd.trim() || null,
      windowDays,
      translateSubtitles: downloadSubtitles && translateDownloadSubtitles,
      translateTo,
      translateExtras,
      translateApproveCost,
      burnSubtitles: downloadSubtitles && burnDownloadSubtitles,
    });
    setQueue((current) => [...current, job]);
    setScheduledFor('');
    setError(null);
    store.setNotice(
      schedule
        ? `Trabajo programado para ${new Date(schedule).toLocaleString('es-AR')}.`
        : 'Trabajo agregado a la cola. Se procesa en orden.',
    );
  }

  function enqueueBatch(): void {
    if (!rights) {
      setError('Confirmá que tenés derechos para descargar y usar este contenido.');
      return;
    }
    const lines = batchUrls
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const parsedUrls = lines.map(normalizeDownloadUrl);
    if (parsedUrls.length === 0 || parsedUrls.some((url) => url === null)) {
      setError('Cada línea del lote debe ser una URL http(s) válida.');
      return;
    }
    const urls = skipDuplicates
      ? parsedUrls.filter(
          (url) =>
            url !== null &&
            !history.some((entry) => entry.status === 'done' && entry.url === url),
        )
      : parsedUrls;
    if (urls.length === 0) {
      store.setNotice('Todas las URLs del lote ya estaban completadas.');
      return;
    }
    const capacity = isPro
      ? urls.length
      : Math.max(0, freeQueueLimit - occupiedQueueSlots);
    if (capacity === 0) {
      setError(planQueueMessage());
      return;
    }
    const acceptedUrls = urls.slice(0, capacity);
    let schedule: string | null;
    try {
      schedule = scheduledIso();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'La programación no es válida.');
      return;
    }
    const jobs = acceptedUrls.map((url) => {
      const stub: DownloadProbe = {
        url: url!,
        title: url!,
        uploader: null,
        durationSeconds: null,
        thumbnail: null,
        kind: 'video',
        entryCount: 1,
        maxHeight: null,
        estimatedBytes: null,
        qualities: [],
      };
      return makeJob({
        probe: stub,
        request: currentRequest(stub, nextProxy()),
        denoise: denoiseDownloads,
        scheduledFor: schedule,
        repeat,
        windowStart: windowStart.trim() || null,
        windowEnd: windowEnd.trim() || null,
        windowDays,
        translateSubtitles: downloadSubtitles && translateDownloadSubtitles,
        translateTo,
        translateExtras,
        translateApproveCost,
        burnSubtitles: downloadSubtitles && burnDownloadSubtitles,
      });
    });
    setQueue((current) => [...current, ...jobs]);
    setBatchUrls('');
    setScheduledFor('');
    setError(null);
    store.setNotice(
      acceptedUrls.length < urls.length
        ? `Se agregaron ${jobs.length} de ${urls.length} URL(s): ${planQueueMessage()}`
        : schedule
          ? `${jobs.length} URL(s) programadas para ${new Date(schedule).toLocaleString('es-AR')}.`
          : `${jobs.length} URL(s) agregadas a la cola.`,
    );
  }

  function enqueueUrls(rawUrls: readonly string[], label: string): number {
    const seen = new Set<string>();
    const urls: string[] = [];
    for (const raw of rawUrls) {
      const normalized = normalizeDownloadUrl(raw);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      if (
        skipDuplicates &&
        history.some((entry) => entry.status === 'done' && entry.url === normalized)
      ) {
        continue;
      }
      urls.push(normalized);
    }
    if (urls.length === 0) return 0;
    const capacity = isPro
      ? urls.length
      : Math.max(0, freeQueueLimit - occupiedQueueSlots);
    if (capacity === 0) {
      setAutomationNotice(planQueueMessage());
      return 0;
    }
    const acceptedUrls = urls.slice(0, capacity);
    if (acceptedUrls.length < urls.length) {
      setAutomationNotice(
        `Se agregaron ${acceptedUrls.length} de ${urls.length} URL(s). ${planQueueMessage()}`,
      );
    }
    const jobs = acceptedUrls.map((url) => {
      const stub: DownloadProbe = {
        url,
        title: url,
        uploader: null,
        durationSeconds: null,
        thumbnail: null,
        kind: 'video',
        entryCount: 1,
        maxHeight: null,
        estimatedBytes: null,
        qualities: [],
      };
      return makeJob({
        probe: stub,
        request: currentRequest(stub, nextProxy()),
        denoise: denoiseDownloads,
        scheduledFor: null,
        repeat: 'none',
      });
    });
    setQueue((current) => [...current, ...jobs]);
    setAutomationNotice(`${jobs.length} URL(s) agregadas desde ${label}.`);
    return jobs.length;
  }

  function syncPlaylistSelection(selected: Set<number>): void {
    setPlaylistSelected(selected);
    setPlaylistItems([...selected].sort((a, b) => a - b).join(','));
  }

  async function loadPlaylist(): Promise<void> {
    if (!probe) return;
    setPlaylistLoading(true);
    try {
      const entries = await service.listPlaylistEntries(probe.url, 500);
      setPlaylistEntries(entries);
      syncPlaylistSelection(new Set(entries.map((entry) => entry.index)));
      setAutomationNotice(`${entries.length} elemento(s) de playlist leídos.`);
    } catch (reason) {
      setAutomationNotice(
        reason instanceof Error ? reason.message : 'No se pudo leer la playlist.',
      );
    } finally {
      setPlaylistLoading(false);
    }
  }

  async function chooseWatchFolder(): Promise<void> {
    const picked = await service.chooseDownloadDirectory();
    if (!picked) return;
    setWatchDir(picked);
    saveWatchFolder(picked, watchEnabled);
  }

  async function refreshWatch(): Promise<void> {
    if (!watchDir) return;
    try {
      const files = await service.scanWatchFolder(watchDir);
      let added = 0;
      let processed = 0;
      const nextSeen = { ...watchSeen };
      for (const file of files) {
        const key = `${file.path}:${file.modifiedSeconds}`;
        if (nextSeen[key] !== undefined) continue;
        added += enqueueUrls(file.urls, `la carpeta ${file.name}`);
        nextSeen[key] = file.modifiedSeconds;
        processed += 1;
      }
      if (processed > 0) {
        setWatchSeen(nextSeen);
        saveWatchSeen(nextSeen);
      }
      if (processed === 0) setAutomationNotice('La carpeta no tiene listas .txt nuevas.');
      else setAutomationNotice(`${processed} lista(s) leídas, ${added} URL(s) nuevas.`);
    } catch (reason) {
      setAutomationNotice(
        reason instanceof Error ? reason.message : 'No se pudo leer la carpeta vigilada.',
      );
    }
  }

  async function testProxies(): Promise<void> {
    const pool = parseProxyPool(proxy);
    if (pool.length === 0) {
      setAutomationNotice('Pegá al menos un proxy para probarlo.');
      return;
    }
    setProxyTesting(true);
    setAutomationNotice(null);
    try {
      const results = await Promise.all(pool.map((item) => service.testProxy(item)));
      setProxyHealth(results);
      const alive = results.filter((item) => item.ok).length;
      setAutomationNotice(`${alive}/${results.length} proxy(s) responden.`);
    } catch (reason) {
      setAutomationNotice(
        reason instanceof Error ? reason.message : 'No se pudieron probar los proxies.',
      );
    } finally {
      setProxyTesting(false);
    }
  }

  function keepAliveProxies(): void {
    const alive = proxyHealth.filter((item) => item.ok).map((item) => item.proxy);
    if (alive.length === 0) {
      setAutomationNotice('Ningún proxy respondió; se conserva la lista original.');
      return;
    }
    setProxy((current) => {
      const original = parseProxyPool(current);
      const ordered = original.filter((item) => alive.includes(item));
      return ordered.join('\n');
    });
    setAutomationNotice(`Se conservaron ${alive.length} proxy(s) vivos.`);
  }

  async function loadAudioTracks(): Promise<void> {
    if (!probe) return;
    setAudioTracksLoading(true);
    try {
      const tracks = await service.listAudioTracks(probe.url);
      setAudioTracks(tracks);
      setAutomationNotice(`${tracks.length} pista(s) de audio encontradas.`);
    } catch (reason) {
      setAutomationNotice(
        reason instanceof Error ? reason.message : 'No se pudieron leer las pistas de audio.',
      );
    } finally {
      setAudioTracksLoading(false);
    }
  }

  async function readSourceChecksum(): Promise<void> {
    if (!probe) return;
    try {
      const checksum = await service.probeSourceChecksum(probe.url);
      if (checksum.sha256) {
        setExpectedSha256(checksum.sha256);
        setAutomationNotice(`SHA-256 leído de ${checksum.source}.`);
      } else if (checksum.md5) {
        setAutomationNotice(
          `La fuente publica MD5 (${checksum.md5}) pero no SHA-256; el campo esperado usa SHA-256.`,
        );
      } else {
        setAutomationNotice('La fuente no publica un checksum en sus cabeceras.');
      }
    } catch (reason) {
      setAutomationNotice(
        reason instanceof Error ? reason.message : 'No se pudo leer el checksum de la fuente.',
      );
    }
  }

  async function addFeed(): Promise<void> {
    const url = normalizeDownloadUrl(rssUrl);
    if (!url) {
      setAutomationNotice('Pegá una URL http(s) válida para el feed RSS.');
      return;
    }
    if (feeds.some((feed) => feed.url === url)) {
      setAutomationNotice('Ese feed ya está en la lista.');
      return;
    }
    setFeedBusy(true);
    try {
      const items = await service.fetchRssFeed(url, 30);
      const title = new URL(url).hostname;
      const next: FeedConfig[] = [
        ...feeds,
        { url, title, seen: items.map((item) => item.link).slice(-200) },
      ];
      setFeeds(next);
      saveFeeds(next);
      setRssUrl('');
      setAutomationNotice(
        `Feed agregado con ${items.length} entrada(s). Las próximas se descargan al aparecer.`,
      );
    } catch (reason) {
      setAutomationNotice(
        reason instanceof Error ? reason.message : 'No se pudo leer el feed RSS.',
      );
    } finally {
      setFeedBusy(false);
    }
  }

  async function refreshFeeds(): Promise<void> {
    if (feeds.length === 0) return;
    setFeedBusy(true);
    const nextFeeds: FeedConfig[] = [];
    let added = 0;
    let errors = 0;
    for (const feed of feeds) {
      try {
        const items = await service.fetchRssFeed(feed.url, 30);
        const seen = new Set(feed.seen);
        const includeTerms = rssFilter.include
          .split(',')
          .map((term) => term.trim().toLowerCase())
          .filter(Boolean);
        const excludeTerms = rssFilter.exclude
          .split(',')
          .map((term) => term.trim().toLowerCase())
          .filter(Boolean);
        const fresh: RssItem[] = [];
        for (const item of items) {
          if (seen.has(item.link)) continue;
          const haystack = `${item.title} ${item.link}`.toLowerCase();
          if (
            (includeTerms.length > 0 &&
              !includeTerms.some((term) => haystack.includes(term))) ||
            excludeTerms.some((term) => haystack.includes(term))
          ) {
            seen.add(item.link);
            continue;
          }
          fresh.push(item);
          seen.add(item.link);
        }
        added += enqueueUrls(
          fresh.map((item) => item.link),
          `el feed ${feed.title}`,
        );
        nextFeeds.push({
          ...feed,
          seen: [...seen].slice(-200),
        });
      } catch {
        errors += 1;
        nextFeeds.push(feed);
      }
    }
    setFeeds(nextFeeds);
    saveFeeds(nextFeeds);
    setFeedBusy(false);
    setAutomationNotice(
      errors > 0
        ? `${added} entrada(s) nuevas; ${errors} feed(s) fallaron.`
        : added > 0
          ? `${added} entrada(s) nuevas agregadas a la cola.`
          : 'Los feeds no tienen entradas nuevas.',
    );
  }

  function removeFeed(url: string): void {
    const next = feeds.filter((feed) => feed.url !== url);
    setFeeds(next);
    saveFeeds(next);
  }

  refreshWatchRef.current = refreshWatch;
  refreshFeedsRef.current = refreshFeeds;

  useEffect(() => {
    if (!isPro || !watchEnabled || !watchDir) return;
    void refreshWatchRef.current();
    const timer = window.setInterval(() => {
      void refreshWatchRef.current();
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [isPro, watchEnabled, watchDir]);

  useEffect(() => {
    if (!isPro || feeds.length === 0) return;
    const timer = window.setInterval(() => {
      void refreshFeedsRef.current();
    }, 300_000);
    return () => window.clearInterval(timer);
  }, [isPro, feeds.length]);

  useEffect(() => {
    if (proxyPool.length < 2) return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      void Promise.all(
        proxyPool.map((item) =>
          service.testProxy(item).catch(() => ({
            proxy: item,
            ok: false,
            latencyMs: null,
            error: 'sin respuesta',
          })),
        ),
      ).then((results) => {
        if (!cancelled) setProxyHealth(results);
      });
    }, 600_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [proxy, service]);

  async function pauseJob(job: DownloadJob): Promise<void> {
    if (!activeJobIdsRef.current.includes(job.id)) return;
    try {
      await service.pauseDownload(job.runId);
      patchJob(job.id, { status: 'paused' });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo pausar.');
    }
  }

  async function pauseActive(): Promise<void> {
    const active = queue.find((job) => job.id === primaryJobId);
    if (active) await pauseJob(active);
  }

  async function resumeQueued(job: DownloadJob): Promise<void> {
    if (activeJobIdsRef.current.includes(job.id)) {
      try {
        await service.resumeDownload(job.runId);
        patchJob(job.id, { status: 'running' });
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'No se pudo reanudar.');
      }
      return;
    }
    patchJob(job.id, { status: 'pending', error: null });
  }

  async function cancelQueued(job: DownloadJob): Promise<void> {
    if (activeJobIdsRef.current.includes(job.id)) {
      cancelledJobsRef.current.add(job.id);
      try {
        await service.cancelDownload(job.runId);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'No se pudo cancelar.');
      }
      return;
    }
    setQueue((current) => current.filter((item) => item.id !== job.id));
    setHistory((current) => [
      historyFromJob({ ...job, status: 'cancelled' }, 'cancelled', 'Cancelada en cola'),
      ...current,
    ].slice(0, 12));
  }

  function moveJob(id: string, direction: -1 | 1): void {
    setQueue((current) => {
      const index = current.findIndex((job) => job.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= current.length) return current;
      const next = [...current];
      const [job] = next.splice(index, 1);
      if (!job) return current;
      next.splice(target, 0, job);
      return next;
    });
  }

  async function pauseAll(): Promise<void> {
    for (const job of queue) {
      if (job.status === 'running' && activeJobIdsRef.current.includes(job.id)) {
        await pauseJob(job);
      }
    }
    setQueue((current) =>
      current.map((job) =>
        job.status === 'pending' ? { ...job, status: 'paused' } : job,
      ),
    );
  }

  async function resumeAll(): Promise<void> {
    for (const job of queue) {
      if (job.status !== 'paused') continue;
      if (activeJobIdsRef.current.includes(job.id)) {
        try {
          await service.resumeDownload(job.runId);
          patchJob(job.id, { status: 'running' });
        } catch (reason) {
          setError(reason instanceof Error ? reason.message : 'No se pudo reanudar.');
        }
      } else {
        patchJob(job.id, { status: 'pending', error: null });
      }
    }
  }

  async function cancelAll(): Promise<void> {
    for (const job of queue) {
      if (activeJobIdsRef.current.includes(job.id)) {
        cancelledJobsRef.current.add(job.id);
        await service.cancelDownload(job.runId).catch(() => {});
      }
    }
    setQueue([]);
  }

  function retryQueued(job: DownloadJob): void {
    patchJob(job.id, { status: 'pending', error: null });
  }

  function exportHistory(): void {
    const blob = new Blob([JSON.stringify(history, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'olyvia-descargas.json';
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function retryHistory(entry: DownloadHistoryEntry): void {
    if (!isPro && occupiedQueueSlots >= freeQueueLimit) {
      store.setNotice(planQueueMessage());
      return;
    }
    const runId = entry.runId;
    const retry: DownloadJob = {
      id: newJobId(),
      runId,
      url: entry.url,
      title: entry.title,
      thumbnail: entry.thumbnail,
      kind: entry.kind,
      durationSeconds: entry.durationSeconds,
      request: { ...entry.request, runId },
      denoise: entry.denoise,
      createdAt: new Date().toISOString(),
      scheduledFor: null,
      status: 'pending',
      error: null,
      outcome: null,
    };
    setQueue((current) => [...current, retry]);
  }

  useEffect(() => {
    if (busy) return;
    const now = Date.now();
    const due = queue.filter(
      (job) =>
        job.status === 'pending' &&
        !startingJobsRef.current.has(job.id) &&
        (!job.scheduledFor || Date.parse(job.scheduledFor) <= now),
    );
    const freeSlots = Math.max(0, maxParallel - activeJobIdsRef.current.length);
    if (freeSlots > 0) {
      const next = due
        .filter((job) => windowAllows(job.windowStart, job.windowEnd, now, job.windowDays))
        .slice(0, freeSlots);
      if (next.length > 0) {
        for (const job of next) {
          startingJobsRef.current.add(job.id);
          void download(job);
        }
        return;
      }
    }
    const waitTimes = queue
      .filter((job) => job.status === 'pending')
      .flatMap((job) => {
        const times: number[] = [];
        if (job.scheduledFor) {
          const scheduled = Date.parse(job.scheduledFor);
          if (Number.isFinite(scheduled) && scheduled > now) times.push(scheduled);
        }
        if (!windowAllows(job.windowStart, job.windowEnd, now, job.windowDays)) {
          const opened = nextWindowOpen(job.windowStart, job.windowEnd, now);
          if (opened !== null) times.push(opened);
        }
        return times;
      })
      .filter((time) => Number.isFinite(time) && time > now)
      .sort((a, b) => a - b);
    const upcoming = waitTimes[0];
    if (upcoming === undefined) return;
    const timer = window.setTimeout(
      () => setSchedulerTick((tick) => tick + 1),
      Math.min(Math.max(upcoming - now + 100, 250), 2_147_000_000),
    );
    return () => window.clearTimeout(timer);
    // download se define en cada render y se apoya en el snapshot actual.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue, busy, maxParallel, activeJobIds, schedulerTick]);

  const qualityOptions = probe?.qualities ?? [];
  const bestQuality = qualityOptions[0];
  const minQuality = qualityOptions[qualityOptions.length - 1];
  const destinationPath =
    destinationRoot ?? bridge?.downloadsDir ?? 'Descargas\\Videos descargados';
  const destinationDrive = destinationPath.match(/^[A-Za-z]:/)?.[0] ?? null;
  const targetReady =
    !targetSizeMb.trim() ||
    (/^\d+$/.test(targetSizeMb.trim()) &&
      Number(targetSizeMb) >= 5 &&
      Number(targetSizeMb) <= 100_000);
  const targetMbValid = targetReady && targetSizeMb.trim().length > 0;
  const estimateBytes = targetMbValid
    ? Number(targetSizeMb) * 1_000_000
    : probe?.estimatedBytes
      ? probe.estimatedBytes *
        (cinematic ? (upscale ? 3 : 1.5) : compression === 'none' ? 1 : 0.7)
      : null;
  const effectiveRate = rateToBytesPerSecond(limitRate) ?? 8 * 1024 * 1024;
  const estimateSeconds = estimateBytes
    ? estimateBytes / effectiveRate + (cinematic ? Math.min(probe?.durationSeconds ?? 0, 120) * 1.5 : 0)
    : null;
  const historyBytes = history.reduce(
    (total, entry) => total + entry.files.reduce((sum, file) => sum + file.bytes, 0),
    0,
  );
  const historyDone = history.filter((entry) => entry.status === 'done').length;
  const voiceReady =
    !(cinematic && voicePipeline && !autoRoute) || voiceScript.trim().length > 0;
  const proxyPool = parseProxyPool(proxy);
  const proxyReady = proxyPool.every((entry) =>
    /^(https?|socks[45]):\/\//i.test(entry),
  );
  const limitReady = limitRate.trim().length === 0 || /^\d+[KMGkmg]?$/.test(limitRate.trim());
  const trimStartValue = trimStart.trim() ? Number(trimStart) : 0;
  const trimEndValue = trimEnd.trim() ? Number(trimEnd) : null;
  const trimReady =
    (trimStart.trim() === '' ||
      (Number.isFinite(trimStartValue) && trimStartValue >= 0)) &&
    (!trimEnd.trim() ||
      (trimEndValue !== null &&
        Number.isFinite(trimEndValue) &&
        trimEndValue > trimStartValue));
  const subtitleReady =
    !downloadSubtitles ||
    (/^[A-Za-z0-9.,_*-]+$/.test(subtitleLangs.trim()) &&
      subtitleLangs.trim().length > 0);
  const sponsorReady = !sponsorblock || sponsorCategories.length > 0;
  const formatReady = !cinematic || format === 'mp4';
  const urlValid = Boolean(normalizeDownloadUrl(url));
  const canDownload =
    Boolean(probe) &&
    rights &&
    !busy &&
    voiceReady &&
    proxyReady &&
    limitReady &&
    trimReady &&
    subtitleReady &&
    sponsorReady &&
    targetReady &&
    formatReady &&
    (probe?.kind !== 'gallery' || probe.entryCount > 0);

  return (
    <section className="view download-view">
      <ViewToolbar
        label="Descargar"
        actions={
          <button type="button" className="ghost icon-text" onClick={() => onNavigate('assets')}>
            <Icon name="assets" size={14} />
            <span>Ir a Medios</span>
          </button>
        }
      />

      {!project ? (
        <div className="notice download-no-project" role="status">
          <strong>No necesitás un proyecto para descargar.</strong>
          <span>Se guarda en la biblioteca.</span>
          <InfoTip
            label="Descarga sin proyecto"
            text="El archivo queda en Descargas/Videos descargados/<Plataforma>/<Nombre del video>. Si después querés editarlo, abrí un proyecto e importalo desde Medios."
          />
        </div>
      ) : null}

      {!licenseLoading && !isPro ? (
        <div className="notice download-plan-free" role="status">
          <strong>Plan Free</strong>
          <span>2 simultáneas · 1080p MP4/H.264 · 25 en cola. El editor y tus proyectos siguen abiertos.</span>
          <button type="button" className="link" onClick={() => onNavigate('settings')}>
            Ver Pro
          </button>
        </div>
      ) : null}

      <div className="download-layout">
        <div className="download-main">
          <div className="card quick-presets">
            <div className="production-card-head">
              <div>
                <p className="eyebrow">Presets rápidos</p>
                <h3>Empezá en un clic</h3>
              </div>
              <InfoTip
                label="Presets rápidos"
                text="Original no recomprime. Compacto baja el peso con CRF 27. Cine aplica el look 35 mm y escalado. Hook vertical abre Creador para armar el gancho de 3 segundos."
              />
            </div>
            <div className="quick-preset-row">
              <button
                type="button"
                className={`preset-chip${!cinematic && compression === 'none' ? ' active' : ''}`}
                onClick={() => applyQuickPreset('original')}
              >
                Original
              </button>
              <button
                type="button"
                className={`preset-chip${!cinematic && compression === 'compact' ? ' active' : ''}`}
                onClick={() => applyQuickPreset('compact')}
              >
                Compacto
              </button>
              <button
                type="button"
                className={`preset-chip${cinematic ? ' active' : ''}`}
                onClick={() => applyQuickPreset('cine')}
              >
                Cine 35 mm
              </button>
              <button
                type="button"
                className="preset-chip preset-chip-cta"
                onClick={() => onNavigate('creator')}
              >
                Hook vertical
              </button>
            </div>
          </div>

          <div className="card download-engine">
            <div className="production-card-head">
              <div>
                <p className="eyebrow">Motor de descargas</p>
                <h3>
                  {engine == null
                    ? 'Verificando…'
                    : engine.available
                      ? `yt-dlp ${engine.version ?? ''}`
                      : 'Sin instalar'}
                </h3>
              </div>
              {engine?.available ? (
                <div className="actions compact">
                  <span className="download-engine-badge">Listo</span>
                  <button
                    type="button"
                    className="small ghost"
                    disabled={busy || engineUpdating}
                    onClick={() => void updateEngine()}
                  >
                    {engineUpdating ? 'Actualizando…' : 'Actualizar motor'}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="small"
                  disabled={busy || engine?.canInstall === false}
                  onClick={() => void installEngine()}
                >
                  {stage === 'installing' ? 'Instalando…' : 'Instalar motor'}
                </button>
              )}
            </div>
            <p className="fine-print">
              {engine?.available
                ? 'El motor es un ejecutable oficial de yt-dlp. Olyvia no incluye ni redistribuye yt-dlp.'
                : engine?.hint ??
                  'Instalá el motor para descargar. Sólo se acepta contenido público o con permiso.'}
            </p>
            <div className="download-bridge">
              <div>
                <p className="eyebrow">
                  Extensión de Chrome / Edge
                  <InfoTip
                    label="Instalar la extensión"
                    text="Abrí chrome://extensions, activá Modo desarrollador, elegí Cargar descomprimida y apuntá a extensions/editor-ia-downloader. Pegá la conexión una vez."
                  />
                </p>
                <p className="fine-print">
                  {bridge
                    ? `Puente local en 127.0.0.1:${bridge.port} · token ${bridge.token.slice(0, 8)}…`
                    : bridgeError ?? 'Conectando el puente local…'}
                </p>
              </div>
              {bridge ? (
                <button type="button" className="small" onClick={() => void copyBridge()}>
                  Copiar conexión
                </button>
              ) : null}
            </div>
          </div>

          <div className="card download-source">
            <div className="production-card-head">
              <div>
                <p className="eyebrow">Enlace</p>
                <h3>Video, foto, carrusel o audio</h3>
              </div>
            </div>
            <form
              className={`download-url${urlValid ? ' is-valid' : ''}`}
              onSubmit={(event) => {
                event.preventDefault();
                void analyze();
              }}
            >
              <input
                type="text"
                inputMode="url"
                autoCapitalize="none"
                spellCheck={false}
                value={url}
                placeholder="Pegá un enlace de YouTube, Instagram, TikTok o cualquier sitio público…"
                aria-label="URL para descargar"
                disabled={busy}
                onChange={(event) => {
                  setUrl(event.target.value);
                  setProbe(null);
                  setOutcome(null);
                  setError(null);
                }}
              />
              <button type="submit" className="primary icon-text" disabled={busy || !url.trim()}>
                <Icon name="search" size={14} />
                <span>{stage === 'probing' ? 'Analizando…' : 'Analizar'}</span>
              </button>
            </form>
            <div className="download-cookies">
              <div>
                <span className="eyebrow">Cookies (opcional)</span>
                <p className="fine-print">
                  {cookiesPath
                    ? `Usando ${cookiesPath.split(/[\\/]/).pop()} sólo para esta sesión.`
                    : 'Para contenido con login, exportá cookies.txt en formato Netscape y elegilo acá. No se guardan en el proyecto.'}
                </p>
              </div>
              <div className="actions compact">
                <label className="field compact-field">
                  <span>O leer del navegador</span>
                  <select
                    value={cookiesBrowser}
                    disabled={busy || Boolean(cookiesPath)}
                    onChange={(event) => setCookiesBrowser(event.target.value)}
                  >
                    <option value="">No usar</option>
                    <option value="chrome">Chrome</option>
                    <option value="edge">Edge</option>
                    <option value="firefox">Firefox</option>
                    <option value="brave">Brave</option>
                    <option value="chromium">Chromium</option>
                    <option value="opera">Opera</option>
                    <option value="vivaldi">Vivaldi</option>
                  </select>
                </label>
                <button type="button" className="small ghost" disabled={busy} onClick={() => void chooseCookies()}>
                  {cookiesPath ? 'Cambiar cookies' : 'Elegir cookies.txt'}
                </button>
                {cookiesPath ? (
                  <button
                    type="button"
                    className="small ghost"
                    disabled={busy}
                    onClick={() => {
                      setCookiesPath(null);
                      setProbe(null);
                    }}
                  >
                    Quitar
                  </button>
                ) : null}
              </div>
            </div>
            <p className="fine-print download-legal">
              Descargá sólo contenido propio o con permiso.
              <InfoTip
                label="Límites del motor"
                text="Sitios con DRM, captchas, transmisiones en vivo o contenido privado pueden fallar incluso con cookies."
              />
            </p>

            {probe ? (
              <div className="download-probe">
                <div className="download-probe-title">
                  <span className="asset-kind kind-video">{KIND_LABELS[probe.kind]}</span>
                  <strong>{probe.title}</strong>
                </div>
                <div className="download-probe-meta">
                  {probe.uploader ? <span>{probe.uploader}</span> : null}
                  <span>{formatDuration(probe.durationSeconds)}</span>
                  {probe.entryCount > 1 ? <span>{probe.entryCount} elementos</span> : null}
                  {probe.estimatedBytes ? (
                    <span>≈ {formatBytes(probe.estimatedBytes)}</span>
                  ) : null}
                  {probe.maxHeight ? <span>máx. {probe.maxHeight}p</span> : null}
                </div>
              </div>
            ) : null}
          </div>

          {probe ? (
            <div className="card download-options">
              <div className="production-card-head">
                <div>
                  <p className="eyebrow">Salida</p>
                  <h3>Calidad y compresión</h3>
                </div>
              </div>
              {probe.kind === 'video' && qualityOptions.length > 0 ? (
                <>
                  <label className="field">
                    <span>Calidad a descargar</span>
                    <select
                      value={String(quality)}
                      disabled={busy}
                      onChange={(event) => {
                        const value = event.target.value;
                        setQuality(
                          value === 'best' || value === 'worst' ? value : Number(value),
                        );
                      }}
                    >
                      <option value="best">
                        {isPro ? 'Mejor disponible' : 'Mejor hasta 1080p (Free)'}
                        {isPro && bestQuality ? ` · ${qualitySummary(bestQuality)}` : ''}
                      </option>
                      <option value="worst">
                        Mínima disponible
                        {minQuality ? ` · ${qualitySummary(minQuality)}` : ''}
                      </option>
                      {qualityOptions.map((item) => (
                        <option
                          key={item.height}
                          value={item.height}
                          disabled={!isPro && item.height > 1080}
                        >
                          Solo {qualitySummary(item)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="fine-print">
                    Mejor y Mínima eligen automáticamente la pista de video y audio del sitio;
                    las opciones con altura fijan un tope.
                  </p>
                </>
              ) : (
                <p className="fine-print">
                  {probe.kind === 'gallery'
                    ? 'El carrusel se descarga con la mejor calidad disponible de cada elemento (hasta 12).'
                    : probe.kind === 'image'
                      ? 'La imagen se descarga en su formato y resolución originales.'
                      : 'El audio se descarga en la mejor calidad disponible.'}
                </p>
              )}
              <div className="inspector-grid">
                <label className="field">
                  <span>Formato de salida</span>
                  <select
                    value={format}
                    disabled={busy || probe.kind === 'image'}
                    onChange={(event) => {
                      const value = event.target.value as 'mp4' | 'mkv' | 'webm' | 'mp3' | 'm4a';
                      setFormat(value);
                      if (value !== 'mp4') {
                        setCompression('none');
                        setCinematic(false);
                        setAutoPipeline(false);
                        setAudioSpeedNoise(false);
                        setVoicePipeline(false);
                        setTargetSizeMb('');
                        setHdrMode('tonemap');
                      }
                    }}
                  >
                    <option value="mp4">MP4 · más compatible</option>
                    <option value="mkv" disabled={!isPro}>MKV · contenedor flexible</option>
                    <option value="webm" disabled={!isPro}>WebM · web</option>
                    <option value="mp3">MP3 · sólo audio</option>
                    <option value="m4a">M4A · audio AAC</option>
                  </select>
                </label>
                <label className="field">
                  <span>Compresión</span>
                  <select
                    value={compression}
                    disabled={busy || probe.kind === 'image' || format !== 'mp4' || cinematic}
                    onChange={(event) =>
                      setCompression(
                        event.target.value as (typeof COMPRESSION_OPTIONS)[number]['value'],
                      )
                    }
                  >
                    {COMPRESSION_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Códec de compresión</span>
                  <select
                    value={codec}
                    disabled={
                      busy ||
                      (compression === 'none' && !targetSizeMb.trim()) ||
                      probe.kind === 'image' ||
                      format !== 'mp4' ||
                      cinematic
                    }
                    onChange={(event) =>
                      setCodec(event.target.value as 'h265' | 'h264' | 'av1')
                    }
                  >
                    <option value="h265" disabled={!isPro}>H.265 · más chico</option>
                    <option value="h264" disabled={hdrMode === 'preserve'}>
                      H.264 · más compatible
                    </option>
                    <option value="av1" disabled={!isPro}>AV1 · máxima compresión</option>
                  </select>
                </label>
                <label className="field">
                  <span>HDR</span>
                  <select
                    value={hdrMode}
                    disabled={busy || probe.kind === 'image' || format !== 'mp4' || cinematic}
                    onChange={(event) => {
                      const value = event.target.value as 'tonemap' | 'preserve';
                      setHdrMode(value);
                      if (value === 'preserve' && codec === 'h264') setCodec('h265');
                    }}
                  >
                    <option value="tonemap">HDR → SDR · tonemap</option>
                    <option value="preserve" disabled={!isPro}>Conservar HDR 10-bit (H.265/AV1)</option>
                  </select>
                </label>
                <label className="field">
                  <span>Tamaño objetivo (MB)</span>
                  <input
                    type="number"
                    min={5}
                    max={100000}
                    step={1}
                    value={targetSizeMb}
                    disabled={busy || probe.kind === 'image' || format !== 'mp4' || cinematic}
                    className={targetReady ? undefined : 'error'}
                    placeholder="auto por CRF"
                    onChange={(event) => setTargetSizeMb(event.target.value)}
                  />
                </label>
              </div>
              <label className="check">
                <input
                  type="checkbox"
                  checked={keepOriginal}
                  disabled={
                    busy ||
                    (!cinematic && compression === 'none' && !targetSizeMb.trim())
                  }
                  onChange={(event) => setKeepOriginal(event.target.checked)}
                />
                <span>
                  Conservar el archivo original además del procesado. Si no hay post-proceso, no
                  hace falta.
                </span>
              </label>
              {probe.kind === 'video' || probe.kind === 'gallery' ? (
                <>
                  <div className="download-cinematic download-route">
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={autoRoute}
                        disabled={busy || format !== 'mp4'}
                        onChange={(event) => {
                          const enabled = event.target.checked;
                          setAutoRoute(enabled);
                          if (enabled) {
                            setCinematic(true);
                            setAutoPipeline(true);
                            setAudioSpeedNoise(false);
                            setVoicePipeline(false);
                            setCinematicAudio(null);
                            setWatermark(true);
                            setDenoiseDownloads(false);
                          }
                        }}
                      />
                      <span>
                        Enrutamiento automático adaptativo: el pipeline decide según la duración
                        y el título, sin preguntar. ≤60 s look completo + audio original
                        masterizado; &gt;60 s ruta rápida espejo/zoom 4 % sin flujo óptico;
                        música conserva el audio original sin tocar.
                      </span>
                    </label>
                    {autoRoute ? (
                      <p className="fine-print route-preview" role="status">
                        {routeLabel(probe.durationSeconds, probe.title)}
                      </p>
                    ) : null}
                  </div>
                  <div className="download-cinematic">
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={cinematic}
                      disabled={busy || format !== 'mp4' || autoRoute}
                      onChange={(event) => {
                        setCinematic(event.target.checked);
                        if (!event.target.checked) setAutoPipeline(false);
                        if (event.target.checked) setDenoiseDownloads(false);
                      }}
                    />
                    <span>
                      {autoRoute
                        ? 'Look adaptativo: el enrutador aplica el recetario completo o la ruta rápida según duración y título, con espejo y zoom 4 % siempre.'
                        : 'Look cine analógico 35 mm: 60 fps por flujo óptico, 0,98×, gamma y saturación, grano, zoom 4 %, espejo y audio original masterizado salvo banda o voz.'}
                    </span>
                  </label>
                  {cinematic ? (
                    <div className="download-cinematic-body">
                      <label className="field">
                        <span>Foco del reencuadre</span>
                        <select
                          value={cinematicFocus}
                          disabled={busy}
                          onChange={(event) =>
                            setCinematicFocus(
                              event.target.value as
                                | 'center'
                                | 'left'
                                | 'right'
                                | 'top'
                                | 'bottom',
                            )
                          }
                        >
                          <option value="center">Centro</option>
                          <option value="left">Tercio izquierdo</option>
                          <option value="right">Tercio derecho</option>
                          <option value="top">Tercio superior</option>
                          <option value="bottom">Tercio inferior</option>
                        </select>
                      </label>
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={delogo}
                          disabled={busy}
                          onChange={(event) => setDelogo(event.target.checked)}
                        />
                        <span>
                          Quitar logo fijo con <code>delogo</code>: parche rectangular
                          proporcional al canvas que interpola los bordes y neutraliza marcas
                          de agua estáticas antes del zoom 4 %.
                        </span>
                      </label>
                      {delogo ? (
                        <>
                          <label className="field">
                            <span>Esquina del logo</span>
                            <select
                              value={delogoCorner}
                              disabled={busy}
                              onChange={(event) => {
                                setDelogoCorner(
                                  event.target.value as
                                    | 'top-right'
                                    | 'top-left'
                                    | 'bottom-right'
                                    | 'bottom-left',
                                );
                                setDelogoManualRect(null);
                              }}
                            >
                              <option value="top-right">Superior derecha</option>
                              <option value="top-left">Superior izquierda</option>
                              <option value="bottom-right">Inferior derecha</option>
                              <option value="bottom-left">Inferior izquierda</option>
                            </select>
                          </label>
                          <div className="delogo-preview" ref={delogoPreviewRef}>
                            {probe.thumbnail ? (
                              <img
                                src={probe.thumbnail}
                                alt="Miniatura para ubicar el logo"
                                draggable={false}
                              />
                            ) : (
                              <div className="delogo-placeholder">
                                Miniatura no disponible; usá el recuadro como guía.
                              </div>
                            )}
                            <div
                              className="delogo-box"
                              role="group"
                              aria-label="Zona del logo"
                              onPointerDown={(event) => beginDelogoDrag('move', event)}
                              style={{
                                left: `${activeDelogoRect.x * 100}%`,
                                top: `${activeDelogoRect.y * 100}%`,
                                width: `${activeDelogoRect.w * 100}%`,
                                height: `${activeDelogoRect.h * 100}%`,
                              }}
                            >
                              <span>logo</span>
                              <span
                                className="delogo-handle"
                                role="button"
                                aria-label="Redimensionar zona del logo"
                                onPointerDown={(event) => beginDelogoDrag('resize', event)}
                              />
                            </div>
                          </div>
                          <div className="delogo-preview-actions">
                            <small className="fine-print">
                              Arrastrá el recuadro para moverlo; la esquina inferior derecha lo
                              redimensiona. Se guarda en fracciones del canvas.
                            </small>
                            {delogoManualRect ? (
                              <button
                                type="button"
                                className="small ghost"
                                disabled={busy}
                                onClick={() => setDelogoManualRect(null)}
                              >
                                Usar parche automático
                              </button>
                            ) : null}
                          </div>
                        </>
                      ) : null}
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={upscale && isPro}
                          disabled={busy || !isPro}
                          onChange={(event) => setUpscale(event.target.checked)}
                        />
                        <span>
                          Escalar con Lanczos si el origen queda por debajo del objetivo:
                          bordes definidos, sin pixelado y después del denoise.
                        </span>
                      </label>
                      {upscale ? (
                        <label className="field">
                          <span>Objetivo de resolución</span>
                          <select
                            value={upscaleTarget}
                            disabled={busy}
                            onChange={(event) =>
                              setUpscaleTarget(
                                event.target.value as 'auto' | '1080' | '2160',
                              )
                            }
                          >
                            <option value="auto" disabled={!isPro}>Auto · 1080p cortos / 4K largos</option>
                            <option value="1080">Full HD · 1920×1080</option>
                            <option value="2160" disabled={!isPro}>4K UHD · 3840×2160</option>
                          </select>
                          <small className="fine-print">
                            Mantiene la orientación: un vertical va a 1080×1920. Nunca
                            reduce un origen que ya supera el objetivo; en videos largos el
                            4K puede tardar bastante.
                          </small>
                        </label>
                      ) : null}
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={autoRoute || autoPipeline}
                          disabled={busy || voicePipeline || autoRoute}
                          onChange={(event) => setAutoPipeline(event.target.checked)}
                        />
                        <span>
                          Pipeline automático post-descarga: denoise + delogo + Lanczos +
                          cine en una pasada, H.265/HEVC adaptativo al hardware, MD5 +
                          SHA-256 y limpieza del archivo original.
                        </span>
                      </label>
                      {!autoRoute ? (
                        <>
                          <label className="check">
                            <input
                              type="checkbox"
                              checked={audioSpeedNoise}
                              disabled={busy || Boolean(cinematicAudio) || voicePipeline}
                              onChange={(event) => setAudioSpeedNoise(event.target.checked)}
                            />
                            <span>
                              Procesar audio original: 1,02× con atempo + ruido rosa a −50 dB;
                              reemplaza la pista original.
                            </span>
                          </label>
                          <label className="check">
                            <input
                              type="checkbox"
                              checked={voicePipeline}
                              disabled={busy}
                              onChange={(event) => {
                                setVoicePipeline(event.target.checked);
                                if (event.target.checked) {
                                  setAudioSpeedNoise(false);
                                  setCinematicAudio(null);
                                  setAutoPipeline(true);
                                  setWatermark(true);
                                  setDenoiseDownloads(false);
                                }
                              }}
                            />
                            <span>
                              Generar voz IA local con Piper y usarla como audio final. 100 %
                              offline; reemplaza la banda y el audio original.
                            </span>
                          </label>
                          {voicePipeline ? (
                            <label className="field">
                              <span>Guion para Piper</span>
                              <textarea
                                value={voiceScript}
                                maxLength={4_000}
                                rows={4}
                                disabled={busy}
                                placeholder="Escribí lo que debe narrar la voz local…"
                                onChange={(event) => setVoiceScript(event.target.value)}
                              />
                              <small className="fine-print">
                                Modelo empaquetado es_voice.onnx · {voiceScript.length}/4000
                                caracteres.
                              </small>
                            </label>
                          ) : null}
                          <div className="download-cinematic-audio">
                            <button
                              type="button"
                              className="small icon-text"
                              disabled={busy || cinematicAudioBusy || voicePipeline}
                              onClick={() => void chooseCinematicAudio()}
                            >
                              <Icon name="audio" size={13} />
                              <span>
                                {cinematicAudioBusy
                                  ? 'Eligiendo…'
                                  : cinematicAudio
                                    ? 'Cambiar banda sonora'
                                    : 'Elegir banda sonora'}
                              </span>
                            </button>
                            {cinematicAudio ? (
                              <>
                                <span className="fine-print">
                                  {cinematicAudio.split(/[\\/]/).pop()} · se normaliza a −14 LUFS.
                                </span>
                                <button
                                  type="button"
                                  className="small ghost"
                                  disabled={busy}
                                  onClick={() => setCinematicAudio(null)}
                                >
                                  Quitar audio
                                </button>
                              </>
                            ) : (
                              <span className="fine-print">
                                Sin banda nueva: se usa el audio original si existe.
                              </span>
                            )}
                          </div>
                        </>
                      ) : (
                        <p className="fine-print route-preview">
                          Audio automático: el video corto conserva su pista original con
                          mastering transparente (sin cambiar velocidad ni tono); el largo lleva
                          1,02× con ruido a −50 dB y la música queda intacta. Piper sólo si lo
                          activás a mano.
                        </p>
                      )}
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={watermark}
                          disabled={busy}
                          onChange={(event) => setWatermark(event.target.checked)}
                        />
                        <span>Superponer la marca de agua de Olyvia (watermark.png).</span>
                      </label>
                      <p className="fine-print">
                        Delogo, Lanczos, flujo óptico y grano corren en una sola pasada de
                        FFmpeg; la salida se reencoda siempre en H.265/HEVC (CRF 22–24) y puede
                        tardar bastante más que una descarga normal. La compresión se omite
                        porque el pipeline ya reencodea.{' '}
                        {autoRoute
                          ? 'El enrutador elige encoder por hardware real y evita el flujo óptico en videos de más de 60 s.'
                          : voicePipeline
                            ? 'La voz de Piper reemplaza por completo al audio original y se masteriza a −14 LUFS.'
                            : audioSpeedNoise
                              ? 'El audio original se acelera 1,02× y se mezcla con ruido rosa a −50 dB.'
                              : autoPipeline
                                ? 'Sin banda nueva, el audio original se conserva con mastering transparente a −14 LUFS, sin cambiar velocidad ni tono.'
                                : 'El look manual conserva el audio original con mastering transparente; la banda o la voz lo reemplazan si las activás.'}
                      </p>
                    </div>
                  ) : null}
                </div>
                </>
              ) : null}
              <details className="download-cinematic download-network">
                <summary>Red, proxy y utilidades del motor</summary>
                <div className="download-cinematic-body">
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={engineAuto}
                      disabled={busy}
                      onChange={(event) => {
                        setEngineAuto(event.target.checked);
                        saveEngineAuto(event.target.checked);
                      }}
                    />
                    <span>Actualizar yt-dlp automáticamente cada 7 días.</span>
                  </label>
                  <label className="field">
                    <span>Proxy HTTP/SOCKS (uno por línea)</span>
                    <textarea
                      rows={2}
                      value={proxy}
                      disabled={busy}
                      className={proxyReady ? undefined : 'error'}
                      placeholder={'socks5://127.0.0.1:1080\nhttp://127.0.0.1:8080'}
                      onChange={(event) => setProxy(event.target.value)}
                    />
                    <small className="fine-print">
                      {proxyReady
                        ? proxyPool.length > 1
                          ? `${proxyPool.length} proxies: la cola rota uno por trabajo. Vacío = conexión directa.`
                          : 'Se pasa a yt-dlp; vacío = conexión directa. Podés pegar uno por línea para rotar.'
                        : 'Usá http://, https://, socks4:// o socks5:// en cada línea.'}
                    </small>
                  </label>
                  <label className="field">
                    <span>Límite global de bajada (opcional)</span>
                    <input
                      type="text"
                      value={limitRate}
                      disabled={busy}
                      className={limitReady ? undefined : 'error'}
                      placeholder="8M"
                      onChange={(event) => setLimitRate(event.target.value)}
                    />
                    <small className="fine-print">
                      {limitReady
                        ? 'Formato 500K u 8M; se aplica a cada archivo de la cola.'
                        : 'Escribí un tamaño como 500K u 8M.'}
                    </small>
                  </label>
                  <div className="inspector-grid">
                    <label className="field">
                      <span>Recorte previo · desde (s)</span>
                      <input
                        type="number"
                        min={0}
                        step={0.1}
                        value={trimStart}
                        disabled={busy}
                        placeholder="0"
                        onChange={(event) => setTrimStart(event.target.value)}
                      />
                    </label>
                    <label className="field">
                      <span>Recorte previo · hasta (s)</span>
                      <input
                        type="number"
                        min={0}
                        step={0.1}
                        value={trimEnd}
                        disabled={busy}
                        placeholder="sin límite"
                        onChange={(event) => setTrimEnd(event.target.value)}
                      />
                    </label>
                  </div>
                  <small className="fine-print">
                    Se pasa a yt-dlp con `--download-sections`; vacío = video completo.
                  </small>
                  <label className="field">
                    <span>Plantilla de nombre</span>
                    <input
                      type="text"
                      value={filenameTemplate}
                      disabled={busy}
                      placeholder="{title} [{height}p]"
                      maxLength={120}
                      onChange={(event) => setFilenameTemplate(event.target.value)}
                    />
                    <small className="fine-print">
                      Opcional. Tokens: {'{title}'}, {'{id}'}, {'{platform}'}, {'{height}'} y{' '}
                      {'{date}'}. No se permiten barras ni «..».
                    </small>
                  </label>
                  {probe.entryCount > 1 ? (
                    <label className="field">
                      <span>Elementos de playlist</span>
                      <input
                        type="text"
                        value={playlistItems}
                        disabled={busy}
                        placeholder="1-10"
                        maxLength={100}
                        onChange={(event) => setPlaylistItems(event.target.value)}
                      />
                      <small className="fine-print">
                        Sólo números, comas, guiones y dos puntos: 1-10, 1,3,5 o 2:8.
                      </small>
                    </label>
                  ) : null}
                  {probe.entryCount > 1 ? (
                    <div className="download-playlist">
                      <button
                        type="button"
                        className="small ghost"
                        disabled={playlistLoading}
                        onClick={() => void loadPlaylist()}
                      >
                        {playlistLoading ? 'Leyendo playlist…' : 'Ver elementos de la playlist'}
                      </button>
                      {playlistEntries.length > 0 ? (
                        <ul className="download-automation-list">
                          {playlistEntries.map((entry) => (
                            <li key={`${entry.index}-${entry.title}`}>
                              <label className="check">
                                <input
                                  type="checkbox"
                                  checked={playlistSelected.has(entry.index)}
                                  onChange={(event) => {
                                    const next = new Set(playlistSelected);
                                    if (event.target.checked) next.add(entry.index);
                                    else next.delete(entry.index);
                                    syncPlaylistSelection(next);
                                  }}
                                />
                                <span>
                                  {entry.index}. {entry.title}
                                  {entry.durationSeconds
                                    ? ` · ${formatDuration(entry.durationSeconds)}`
                                    : ''}
                                </span>
                              </label>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  ) : null}
                  <label className="field">
                    <span>Idioma de audio (es, en, pt-BR o all)</span>
                    <input
                      type="text"
                      value={audioLanguage}
                      disabled={busy}
                      placeholder="all"
                      maxLength={10}
                      onChange={(event) => setAudioLanguage(event.target.value)}
                    />
                    <small className="fine-print">
                      Se pasa a yt-dlp como preferencia de idioma; «all» conserva todas las
                      pistas cuando el sitio las ofrece.
                    </small>
                  </label>
                  <div className="download-audio-tracks">
                    <button
                      type="button"
                      className="small ghost"
                      disabled={audioTracksLoading}
                      onClick={() => void loadAudioTracks()}
                    >
                      {audioTracksLoading ? 'Analizando audio…' : 'Ver pistas de audio'}
                    </button>
                    {audioTracks.length > 0 ? (
                      <ul className="download-automation-list">
                        {audioTracks.map((track) => (
                          <li key={track.formatId}>
                            <label className="check">
                              <input
                                type="radio"
                                name="audio-track"
                                checked={audioFormatId === track.formatId}
                                onChange={() => setAudioFormatId(track.formatId)}
                              />
                              <span>
                                {track.language ?? 'sin idioma'} · {track.ext ?? '?'} ·{' '}
                                {track.abr ? `${Math.round(track.abr)} kbps` : track.note ?? ''}
                              </span>
                            </label>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {audioFormatId ? (
                      <button
                        type="button"
                        className="small ghost"
                        onClick={() => setAudioFormatId(null)}
                      >
                        Usar la pista automática
                      </button>
                    ) : null}
                  </div>
                  <div className="inspector-grid">
                    <label className="field">
                      <span>Metadatos · título</span>
                      <input
                        type="text"
                        value={metadataTitle}
                        disabled={busy}
                        maxLength={200}
                        onChange={(event) => setMetadataTitle(event.target.value)}
                      />
                    </label>
                    <label className="field">
                      <span>Metadatos · artista</span>
                      <input
                        type="text"
                        value={metadataArtist}
                        disabled={busy}
                        maxLength={200}
                        onChange={(event) => setMetadataArtist(event.target.value)}
                      />
                    </label>
                  </div>
                  <label className="field">
                    <span>Metadatos · comentario</span>
                    <input
                      type="text"
                      value={metadataComment}
                      disabled={busy}
                      maxLength={500}
                      onChange={(event) => setMetadataComment(event.target.value)}
                    />
                  </label>
                  <label className="field">
                    <span>Carátula incrustada</span>
                    <input
                      readOnly
                      value={coverPath ?? ''}
                      placeholder="Sin carátula"
                      aria-label="Carátula incrustada"
                    />
                  </label>
                  <div className="actions compact">
                    <button
                      type="button"
                      className="small ghost"
                      onClick={() =>
                        void service.chooseImageFile('Elegir carátula').then((picked) => {
                          if (picked) setCoverPath(picked);
                        })
                      }
                    >
                      Elegir carátula…
                    </button>
                    {coverPath ? (
                      <button
                        type="button"
                        className="small ghost"
                        onClick={() => setCoverPath(null)}
                      >
                        Quitar
                      </button>
                    ) : null}
                  </div>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={hashFiles}
                      disabled={busy}
                      onChange={(event) => setHashFiles(event.target.checked)}
                    />
                    <span>Calcular MD5 y SHA-256 de todos los archivos descargados.</span>
                  </label>
                  <label className="field">
                    <span>SHA-256 esperado (opcional)</span>
                    <input
                      type="text"
                      value={expectedSha256}
                      disabled={busy}
                      placeholder="64 caracteres hexadecimales"
                      maxLength={64}
                      onChange={(event) => setExpectedSha256(event.target.value)}
                    />
                    <small className="fine-print">
                      Si ningún archivo coincide, la descarga se marca como error y los archivos
                      quedan en la carpeta para revisarlos.
                    </small>
                  </label>
                  <button
                    type="button"
                    className="small ghost"
                    onClick={() => void readSourceChecksum()}
                  >
                    Leer checksum de la fuente
                  </button>
                  <div className="download-utility-grid">
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={downloadSubtitles}
                        disabled={busy}
                        onChange={(event) => setDownloadSubtitles(event.target.checked)}
                      />
                      <span>Descargar subtítulos y adjuntarlos al proyecto.</span>
                    </label>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={downloadThumbnail}
                        disabled={busy}
                        onChange={(event) => setDownloadThumbnail(event.target.checked)}
                      />
                      <span>Miniatura JPG; se importa a Medios.</span>
                    </label>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={downloadChapters}
                        disabled={busy}
                        onChange={(event) => setDownloadChapters(event.target.checked)}
                      />
                      <span>Capítulos embebidos y como marcadores del proyecto.</span>
                    </label>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={sponsorblock && isPro}
                        disabled={busy || !isPro}
                        onChange={(event) => {
                          setSponsorblock(event.target.checked);
                          if (!event.target.checked) setSponsorSegments([]);
                        }}
                      />
                      <span>Quitar segmentos de SponsorBlock.</span>
                    </label>
                    {!isPro ? (
                      <p className="fine-print download-pro-note">
                        El borrado automático de SponsorBlock requiere Pro.
                      </p>
                    ) : null}
                  </div>
                  {downloadSubtitles ? (
                    <label className="field">
                      <span>Idiomas de subtítulos</span>
                      <input
                        type="text"
                        value={subtitleLangs}
                        disabled={busy}
                        placeholder="es.*,en.*"
                        onChange={(event) => setSubtitleLangs(event.target.value)}
                      />
                    </label>
                  ) : null}
                  {downloadSubtitles ? (
                    <>
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={translateDownloadSubtitles}
                          disabled={busy}
                          onChange={(event) =>
                            setTranslateDownloadSubtitles(event.target.checked)
                          }
                        />
                        <span>
                          Traducir los subtítulos al descargar con el proveedor de Localización.
                        </span>
                      </label>
                      {translateDownloadSubtitles ? (
                        <label className="field">
                          <span>Idioma de destino</span>
                          <select
                            value={translateTo}
                            disabled={busy}
                            onChange={(event) => setTranslateTo(event.target.value)}
                          >
                            <option value="es">Español</option>
                            <option value="en">Inglés</option>
                            <option value="pt">Portugués</option>
                            <option value="fr">Francés</option>
                            <option value="de">Alemán</option>
                            <option value="it">Italiano</option>
                            <option value="ja">Japonés</option>
                            <option value="zh">Chino</option>
                          </select>
                        </label>
                      ) : null}
                      <div className="download-utility-grid">
                        {([
                          ['es', 'Español'],
                          ['en', 'Inglés'],
                          ['pt', 'Portugués'],
                          ['fr', 'Francés'],
                          ['de', 'Alemán'],
                          ['it', 'Italiano'],
                          ['ja', 'Japonés'],
                          ['zh', 'Chino'],
                        ] as const)
                          .filter(([value]) => value !== translateTo)
                          .map(([value, label]) => (
                            <label className="check" key={value}>
                              <input
                                type="checkbox"
                                checked={translateExtras.includes(value)}
                                disabled={busy}
                                onChange={(event) =>
                                  setTranslateExtras((current) =>
                                    event.target.checked
                                      ? [...current, value]
                                      : current.filter((item) => item !== value),
                                  )
                                }
                              />
                              <span>También {label}</span>
                            </label>
                          ))}
                      </div>
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={translateApproveCost}
                          disabled={busy}
                          onChange={(event) =>
                            setTranslateApproveCost(event.target.checked)
                          }
                        />
                        <span>
                          Autorizo el costo si el proveedor de traducción es remoto.
                        </span>
                      </label>
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={burnDownloadSubtitles}
                          disabled={busy}
                          onChange={(event) =>
                            setBurnDownloadSubtitles(event.target.checked)
                          }
                        />
                        <span>
                          Quemar los subtítulos en el video descargado (reencode con FFmpeg).
                        </span>
                      </label>
                    </>
                  ) : null}
                  {sponsorblock ? (
                    <div className="download-utility-grid">
                      {([
                        ['sponsor', 'Patrocinio'],
                        ['selfpromo', 'Autopromoción'],
                        ['interaction', 'Interacción'],
                        ['intro', 'Intro'],
                        ['outro', 'Outro'],
                        ['preview', 'Avance'],
                        ['filler', 'Relleno'],
                        ['music_offtopic', 'Música fuera de tema'],
                      ] as const).map(([value, label]) => (
                        <label className="check" key={value}>
                          <input
                            type="checkbox"
                            checked={sponsorCategories.includes(value)}
                            disabled={busy}
                            onChange={(event) =>
                              setSponsorCategories((current) =>
                                event.target.checked
                                  ? [...current, value]
                                  : current.filter((item) => item !== value),
                              )
                            }
                          />
                          <span>{label}</span>
                        </label>
                      ))}
                    </div>
                  ) : null}
                  {sponsorblock ? (
                    <div className="download-sponsor-preview">
                      <button
                        type="button"
                        className="small ghost"
                        disabled={
                          busy ||
                          sponsorLoading ||
                          sponsorCategories.length +
                            sponsorMarkCategories.length +
                            sponsorMuteCategories.length ===
                          0
                        }
                        onClick={() => void loadSponsorSegments()}
                      >
                        {sponsorLoading ? 'Consultando…' : 'Ver segmentos antes de descargar'}
                      </button>
                      {sponsorSegments.length > 0 ? (
                        <ul>
                          {sponsorSegments.map((segment) => (
                            <li key={`${segment.category}-${segment.startSeconds}`}>
                              <strong>{segment.category}</strong>
                              <span>
                                {formatTimestamp(segment.startSeconds)} →{' '}
                                {formatTimestamp(segment.endSeconds)} ({segment.action})
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  ) : null}
                  {sponsorblock ? (
                    <div className="download-sponsor-mark">
                      <p className="eyebrow">Marcar como capítulo sin quitar</p>
                      <div className="download-utility-grid">
                        {([
                          ['sponsor', 'Patrocinio'],
                          ['selfpromo', 'Autopromoción'],
                          ['interaction', 'Interacción'],
                          ['intro', 'Intro'],
                          ['outro', 'Outro'],
                          ['preview', 'Avance'],
                          ['filler', 'Relleno'],
                          ['music_offtopic', 'Música fuera de tema'],
                        ] as const).map(([value, label]) => (
                          <label className="check" key={value}>
                            <input
                              type="checkbox"
                              checked={sponsorMarkCategories.includes(value)}
                              disabled={
                                busy ||
                                sponsorCategories.includes(value) ||
                                sponsorMuteCategories.includes(value)
                              }
                              onChange={(event) =>
                                setSponsorMarkCategories((current) =>
                                  event.target.checked
                                    ? [...current, value]
                                    : current.filter((item) => item !== value),
                                )
                              }
                            />
                            <span>
                              {label}
                              {sponsorCategories.includes(value) ? (
                                <small> · se quita</small>
                              ) : null}
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {sponsorblock ? (
                    <div className="download-sponsor-mark">
                      <p className="eyebrow">Silenciar el audio del tramo</p>
                      <div className="download-utility-grid">
                        {([
                          ['sponsor', 'Patrocinio'],
                          ['selfpromo', 'Autopromoción'],
                          ['interaction', 'Interacción'],
                          ['intro', 'Intro'],
                          ['outro', 'Outro'],
                          ['preview', 'Avance'],
                          ['filler', 'Relleno'],
                          ['music_offtopic', 'Música fuera de tema'],
                        ] as const).map(([value, label]) => (
                          <label className="check" key={value}>
                            <input
                              type="checkbox"
                              checked={sponsorMuteCategories.includes(value)}
                              disabled={
                                busy ||
                                sponsorCategories.includes(value) ||
                                sponsorMarkCategories.includes(value)
                              }
                              onChange={(event) =>
                                setSponsorMuteCategories((current) =>
                                  event.target.checked
                                    ? [...current, value]
                                    : current.filter((item) => item !== value),
                                )
                              }
                            />
                            <span>{label}</span>
                          </label>
                        ))}
                      </div>
                      <p className="fine-print">
                        Se consulta SponsorBlock al descargar y se silencia sólo el audio de
                        esos tramos; el video se copia sin reencodear.
                      </p>
                    </div>
                  ) : null}
                  <div className="download-utility-grid">
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={insertTimeline}
                        disabled={busy}
                        onChange={(event) => setInsertTimeline(event.target.checked)}
                      />
                      <span>Insertar los videos descargados en el timeline.</span>
                    </label>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={attachSubtitles}
                        disabled={busy}
                        onChange={(event) => setAttachSubtitles(event.target.checked)}
                      />
                      <span>Adjuntar SRT como subtítulos del proyecto.</span>
                    </label>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={addChapters}
                        disabled={busy}
                        onChange={(event) => setAddChapters(event.target.checked)}
                      />
                      <span>Agregar capítulos como marcadores.</span>
                    </label>
                  </div>
                  <label className="field">
                    <span>Lote de URLs · una por línea</span>
                    <textarea
                      rows={3}
                      value={batchUrls}
                      disabled={!rights}
                      placeholder={'https://youtube.com/watch?v=…\nhttps://tiktok.com/@cuenta/video/…'}
                      onChange={(event) => setBatchUrls(event.target.value)}
                    />
                    <small className="fine-print">
                      Se agregan con la configuración actual. Podés seguir editando mientras la
                      cola trabaja.
                    </small>
                  </label>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={skipDuplicates}
                      onChange={(event) => setSkipDuplicates(event.target.checked)}
                    />
                    <span>Omitir URLs que ya se completaron en el historial.</span>
                  </label>
                  <button
                    type="button"
                    className="small"
                    disabled={!rights || batchUrls.trim().length === 0}
                    onClick={enqueueBatch}
                  >
                    Agregar lote a la cola
                  </button>
                </div>
              </details>
              <details className="download-cinematic download-network download-automation">
                <summary>Automatización: carpeta vigilada, RSS y salud de proxies</summary>
                {!isPro ? (
                  <p className="fine-print download-pro-note">
                    Carpeta vigilada, RSS y refresco automático son Pro. La prueba manual de
                    proxies sigue disponible.
                  </p>
                ) : null}
                <div className="download-cinematic-body">
                  <label className="field">
                    <span>Carpeta vigilada · archivos .txt con URLs</span>
                    <input
                      readOnly
                      value={watchDir}
                      placeholder="Elegí una carpeta con listas…"
                      aria-label="Carpeta vigilada"
                    />
                  </label>
                  <div className="actions compact">
                    <button
                      type="button"
                      className="small"
                      onClick={() => void chooseWatchFolder()}
                    >
                      Elegir carpeta…
                    </button>
                    <button
                      type="button"
                      className="small ghost"
                      disabled={!isPro || !watchDir}
                      onClick={() => void refreshWatch()}
                    >
                      Escanear ahora
                    </button>
                  </div>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={watchEnabled && isPro}
                      disabled={!isPro || !watchDir}
                      onChange={(event) => {
                        setWatchEnabled(event.target.checked);
                        saveWatchFolder(watchDir, event.target.checked);
                      }}
                    />
                    <span>
                      Vigilar cada 60 s: cada .txt nuevo o modificado agrega sus URLs a la
                      cola.
                    </span>
                  </label>
                  <label className="field">
                    <span>Feed RSS o Atom</span>
                    <input
                      type="url"
                      value={rssUrl}
                      placeholder="https://ejemplo.com/feed.xml"
                      onChange={(event) => setRssUrl(event.target.value)}
                    />
                  </label>
                  <div className="inspector-grid">
                    <label className="field">
                      <span>RSS · incluir palabras</span>
                      <input
                        type="text"
                        value={rssFilter.include}
                        placeholder="tutorial, ia"
                        onChange={(event) => {
                          const next = { ...rssFilter, include: event.target.value };
                          setRssFilter(next);
                          saveRssFilter(next.include, next.exclude);
                        }}
                      />
                    </label>
                    <label className="field">
                      <span>RSS · excluir palabras</span>
                      <input
                        type="text"
                        value={rssFilter.exclude}
                        placeholder="shorts, promo"
                        onChange={(event) => {
                          const next = { ...rssFilter, exclude: event.target.value };
                          setRssFilter(next);
                          saveRssFilter(next.include, next.exclude);
                        }}
                      />
                    </label>
                  </div>
                  <div className="actions compact">
                    <button
                      type="button"
                      className="small"
                      disabled={!isPro || feedBusy || !rssUrl.trim()}
                      onClick={() => void addFeed()}
                    >
                      {feedBusy ? 'Leyendo…' : 'Agregar feed'}
                    </button>
                    <button
                      type="button"
                      className="small ghost"
                      disabled={!isPro || feedBusy || feeds.length === 0}
                      onClick={() => void refreshFeeds()}
                    >
                      Actualizar feeds
                    </button>
                  </div>
                  {feeds.length > 0 ? (
                    <ul className="download-automation-list">
                      {feeds.map((feed) => (
                        <li key={feed.url}>
                          <span title={feed.url}>{feed.title}</span>
                          <button
                            type="button"
                            className="small ghost"
                            onClick={() => removeFeed(feed.url)}
                          >
                            Quitar
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <div className="actions compact">
                    <button
                      type="button"
                      className="small"
                      disabled={proxyTesting || proxyPool.length === 0}
                      onClick={() => void testProxies()}
                    >
                      {proxyTesting ? 'Probando…' : 'Probar proxies'}
                    </button>
                    <button
                      type="button"
                      className="small ghost"
                      disabled={proxyHealth.length === 0}
                      onClick={keepAliveProxies}
                    >
                      Conservar los que responden
                    </button>
                  </div>
                  {proxyHealth.length > 0 ? (
                    <ul className="download-automation-list">
                      {proxyHealth.map((health) => (
                        <li key={health.proxy}>
                          <span title={health.proxy}>{health.proxy}</span>
                          <small className={health.ok ? 'ok' : 'error'}>
                            {health.ok
                              ? `${health.latencyMs ?? '?'} ms`
                              : health.error ?? 'sin respuesta'}
                          </small>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <div className="download-watchdog">
                    <p className="eyebrow">Vigilante de Windows</p>
                    <p className="fine-print">
                      {watchdog?.installed
                        ? 'Activo: Olyvia se abre oculta al iniciar sesión y cada 5 minutos si la cola quedó pendiente.'
                        : 'Opcional: crea tareas de Windows para relanzar Olyvia oculta si se cierra o reinicia.'}
                    </p>
                    <div className="actions compact">
                      <button
                        type="button"
                        className="small"
                        onClick={() =>
                          void service
                            .installWatchdog()
                            .then((status) => {
                              setWatchdog(status);
                              setAutomationNotice(status.hint);
                            })
                            .catch((reason) =>
                              setAutomationNotice(
                                reason instanceof Error
                                  ? reason.message
                                  : 'No se pudo instalar el vigilante.',
                              ),
                            )
                        }
                      >
                        Activar vigilante
                      </button>
                      <button
                        type="button"
                        className="small ghost"
                        onClick={() =>
                          void service
                            .removeWatchdog()
                            .then((status) => {
                              setWatchdog(status);
                              setAutomationNotice('Vigilante desactivado.');
                            })
                            .catch(() => setAutomationNotice('No se pudo desactivar.'))
                        }
                      >
                        Desactivar
                      </button>
                    </div>
                  </div>
                  {automationNotice ? (
                    <p className="fine-print" role="status">
                      {automationNotice}
                    </p>
                  ) : null}
                </div>
              </details>
              <p className="fine-print">
                MP3/M4A extraen sólo el audio; MKV/WebM cambian el contenedor y dependen de los
                códecs del sitio. La compresión sólo se aplica a MP4, tarda y puede cambiar el
                aspecto: se conserva el archivo comprimido sólo si queda más chico. HDR: elegí
                «Conservar HDR 10-bit» con H.265 o AV1; «tonemap» lo pasa a SDR 8-bit.
              </p>
            </div>
          ) : null}
        </div>

        <aside className="download-side">
          <div className="card download-run">
            <div className="production-card-head">
              <div>
                <p className="eyebrow">Descarga</p>
                <h3>
                  {queueRunning > 0
                    ? `${queueRunning} descarga(s) en paralelo`
                    : busy
                      ? 'Trabajando…'
                      : project
                        ? 'Listo para importar'
                        : 'A la biblioteca local'}
                </h3>
              </div>
            </div>
            {displayProgress ? (
              <div className="download-progress" role="status" aria-live="polite">
                <div className="download-progress-head">
                  <span>{STAGE_LABELS[displayProgress.stage]}</span>
                  {displayProgress.percent != null ? (
                    <strong>{Math.round(displayProgress.percent)}%</strong>
                  ) : null}
                </div>
                {displayProgress.percent != null ? (
                  <div
                    className="download-progress-track"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(displayProgress.percent)}
                    aria-label="Progreso de la descarga"
                  >
                    <span
                      style={{
                        width: `${Math.max(0, Math.min(100, displayProgress.percent))}%`,
                      }}
                    />
                  </div>
                ) : null}
                <p className="fine-print">{displayProgress.message}</p>
                {primaryJob && (primaryJob.status === 'running' || primaryJob.status === 'paused') ? (
                  <div className="actions compact">
                    {primaryJob.status === 'paused' ? (
                      <button
                        type="button"
                        className="small"
                        onClick={() => void resumeQueued(primaryJob)}
                      >
                        Reanudar
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="small"
                        onClick={() => void pauseJob(primaryJob)}
                      >
                        Pausar
                      </button>
                    )}
                    <button
                      type="button"
                      className="small ghost"
                      onClick={() => void cancelQueued(primaryJob)}
                    >
                      Cancelar
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
            {queue.length > 0 ? (
              <div className={`download-queue${showQueueDetails ? '' : ' is-collapsed'}`}>
                <div className="download-queue-head">
                  <p className="eyebrow">Cola persistente · {queue.length}</p>
                  <div className="actions compact">
                    <span className="download-queue-summary">
                      {queueRunning > 0
                        ? `${queueRunning} activa(s)`
                        : pendingJobs > 0
                          ? `${pendingJobs} en espera`
                          : failedJobs > 0
                            ? `${failedJobs} con error`
                            : 'sin trabajos activos'}
                    </span>
                    {queue.length > 3 ? (
                      <button
                        type="button"
                        className="small ghost"
                        onClick={() => setQueueExpanded((current) => !current)}
                      >
                        {showQueueDetails ? 'Ocultar detalle' : 'Ver detalle'}
                      </button>
                    ) : null}
                  </div>
                </div>
                {showQueueDetails ? (
                <>
                <div className="download-queue-tools">
                  <label className="download-parallel">
                    <span>Simultáneas</span>
                    <input
                      type="number"
                      min={MIN_PARALLEL}
                      max={parallelMax}
                      value={maxParallel}
                      aria-label="Descargas simultáneas"
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        if (!Number.isFinite(value)) return;
                        const clamped = clampParallel(value, parallelMax > RECOMMENDED_PARALLEL_MAX);
                        setMaxParallel(clamped);
                        saveMaxParallel(clamped);
                      }}
                    />
                  </label>
                  <label className="download-parallel">
                    <span>Notificar</span>
                    <input
                      type="checkbox"
                      checked={notifyOnFinish}
                      aria-label="Notificar al terminar"
                      onChange={(event) => setNotifyOnFinish(event.target.checked)}
                    />
                  </label>
                  <label className="download-parallel">
                    <span>Avanzado</span>
                    <input
                      type="checkbox"
                      checked={advancedParallel && isPro}
                      disabled={!isPro}
                      aria-label="Permitir hasta 512 descargas simultáneas"
                      onChange={(event) => {
                        const next = event.target.checked;
                        setAdvancedParallel(next);
                        if (!next && maxParallel > RECOMMENDED_PARALLEL_MAX) {
                          setMaxParallel(RECOMMENDED_PARALLEL_MAX);
                          saveMaxParallel(RECOMMENDED_PARALLEL_MAX);
                        }
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    className="small ghost"
                    onClick={() =>
                      void service
                        .notifyUser('Olyvia', 'Notificación de prueba desde Descargas.')
                        .catch(() => setError('No se pudo mostrar la notificación.'))
                    }
                  >
                    Probar
                  </button>
                  <button type="button" className="small ghost" onClick={() => void pauseAll()}>
                    Pausar todo
                  </button>
                  <button type="button" className="small ghost" onClick={() => void resumeAll()}>
                    Reanudar todo
                  </button>
                  <button type="button" className="small ghost" onClick={() => void cancelAll()}>
                    Cancelar todo
                  </button>
                </div>
                <p className="fine-print download-parallel-hint">
                  {isPro
                    ? '4–8 simultáneas es el rango recomendado. El modo avanzado permite hasta 512 y puede saturar conexiones domésticas.'
                    : 'Plan Free: máximo 2 descargas simultáneas. Activá Pro para el rango 4–8 y hasta 512.'}
                </p>
                <ul className="download-queue-list">
                  {queue.map((job) => (
                    <li key={job.id}>
                      <div>
                        <strong title={job.url}>{job.title || job.url}</strong>
                        <small>
                          {job.status === 'pending' && job.scheduledFor
                            ? `Programada para ${new Date(job.scheduledFor).toLocaleString('es-AR')}${
                                job.repeat && job.repeat !== 'none'
                                  ? ` · ${REPEAT_LABELS[job.repeat]}`
                                  : ''
                              }`
                            : job.status === 'running' && jobProgress[job.runId]
                              ? `${jobProgress[job.runId]?.message ?? 'Descargando'}${
                                  jobProgress[job.runId]?.percent != null
                                    ? ` · ${Math.round(jobProgress[job.runId]?.percent ?? 0)}%`
                                    : ''
                                }`
                              : {
                                  pending: 'En espera',
                                  running: 'Descargando',
                                  paused: 'Pausada',
                                  done: 'Lista',
                                  error: job.error ?? 'Error',
                                  cancelled: 'Cancelada',
                                }[job.status]}
                        </small>
                      </div>
                      <div className="actions compact">
                        {job.status !== 'running' && job.status !== 'done' ? (
                          <>
                            <button
                              type="button"
                              className="small ghost"
                              aria-label="Subir en la cola"
                              onClick={() => moveJob(job.id, -1)}
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              className="small ghost"
                              aria-label="Bajar en la cola"
                              onClick={() => moveJob(job.id, 1)}
                            >
                              ↓
                            </button>
                          </>
                        ) : null}
                        {job.status === 'pending' && job.scheduledFor ? (
                          <button
                            type="button"
                            className="small"
                            aria-label="Descargar ahora"
                            onClick={() => patchJob(job.id, { scheduledFor: null })}
                          >
                            Ahora
                          </button>
                        ) : null}
                        {job.status === 'running' ? (
                          <button
                            type="button"
                            className="small ghost"
                            onClick={() => void pauseJob(job)}
                          >
                            Pausar
                          </button>
                        ) : null}
                        {job.status === 'paused' ? (
                          <button
                            type="button"
                            className="small"
                            onClick={() => void resumeQueued(job)}
                          >
                            Reanudar
                          </button>
                        ) : null}
                        {job.status === 'error' ? (
                          <button type="button" className="small" onClick={() => retryQueued(job)}>
                            Reintentar
                          </button>
                        ) : null}
                        {job.status !== 'done' ? (
                          <button
                            type="button"
                            className="small ghost"
                            onClick={() => void cancelQueued(job)}
                          >
                            {job.status === 'running' || job.status === 'paused'
                              ? 'Cancelar'
                              : 'Quitar'}
                          </button>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
                </>
                ) : null}
              </div>
            ) : null}
            {history.length > 0 ? (
              <details className="download-accordion download-history">
                <summary>
                  Historial · {history.length} registro(s)
                  {historyDone > 0 ? ` · ${historyDone} completada(s)` : ''}
                  {historyBytes > 0 ? ` · ${formatBytes(historyBytes)}` : ''}
                </summary>
                <div className="download-queue">
                  <div className="download-queue-head">
                    <p className="eyebrow">Descargas anteriores</p>
                    <div className="actions compact">
                      <button type="button" className="small ghost" onClick={exportHistory}>
                        Exportar JSON
                      </button>
                      <button
                        type="button"
                        className="small ghost"
                        onClick={() => setHistory([])}
                      >
                        Limpiar
                      </button>
                    </div>
                  </div>
                  <ul className="download-queue-list">
                    {history.slice(0, 6).map((entry) => (
                      <li key={`${entry.id}-${entry.at}`}>
                        <div>
                          <strong>{entry.title || entry.url}</strong>
                          <small>
                            {entry.status === 'done'
                              ? 'Completada'
                              : entry.status === 'cancelled'
                                ? 'Cancelada'
                                : entry.error ?? 'Error'}
                          </small>
                          {entry.averageBytesPerSecond ? (
                            <small>
                              {formatBytes(entry.averageBytesPerSecond)}/s ·{' '}
                              {formatDuration(entry.elapsedSeconds ?? null)}
                            </small>
                          ) : null}
                        </div>
                        <div className="actions compact">
                          <button
                            type="button"
                            className="small"
                            onClick={() => retryHistory(entry)}
                          >
                            Reintentar
                          </button>
                          {entry.files[0] ? (
                            <button
                              type="button"
                              className="small ghost"
                              onClick={() => {
                                const path = entry.files[0]?.path;
                                if (!path) return;
                                void service
                                  .revealOutput(path)
                                  .catch(() => store.setNotice('No se pudo abrir la carpeta.'));
                              }}
                            >
                              Ver archivo
                            </button>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              </details>
            ) : null}
            <div className="download-destination">
              <div className="download-destination-head">
                <Icon name="folder" size={15} />
                <div>
                  <p className="eyebrow">Guardar en</p>
                  <strong>
                    {destinationRoot ? destinationDrive ?? 'Carpeta elegida' : 'Predeterminada'}
                  </strong>
                </div>
              </div>
              <code title={destinationPath}>{destinationPath}</code>
              <div className="actions compact">
                <button
                  type="button"
                  className="small"
                  onClick={() => void chooseDestination()}
                  disabled={busy}
                >
                  Elegir carpeta…
                </button>
                {destinationRoot ? (
                  <button
                    type="button"
                    className="small"
                    onClick={useDefaultDestination}
                    disabled={busy}
                  >
                    Usar predeterminada
                  </button>
                ) : null}
              </div>
              <p className="fine-print">
                Por defecto: <code>Descargas/Videos descargados/&lt;Red&gt;/&lt;Video&gt;</code>.
              </p>
            </div>
            <div className="download-estimate">
              <span>
                Libre: <strong>{diskFree == null ? 'midiendo…' : formatBytes(diskFree)}</strong>
              </span>
              <span>
                Salida ≈ <strong>{estimateBytes ? formatBytes(estimateBytes) : 'sin estimar'}</strong>
              </span>
              <span>
                Tiempo ≈{' '}
                <strong>
                  {estimateSeconds ? formatDuration(estimateSeconds) : 'sin estimar'}
                </strong>
              </span>
            </div>
            <details className="download-accordion download-schedule">
              <summary>Programación y repetición</summary>
              {!isPro ? (
                <p className="fine-print download-pro-note">
                  Programación, repetición y ventanas horarias son parte de Pro.
                </p>
              ) : null}
              <fieldset className="download-pro-fields" disabled={!isPro}>
              <label className="field">
                <span>Programar inicio (opcional)</span>
                <input
                  type="datetime-local"
                  value={scheduledFor}
                  disabled={!probe}
                  onChange={(event) => setScheduledFor(event.target.value)}
                />
              </label>
              <label className="field">
                <span>Repetir</span>
                <select
                  value={repeat}
                  disabled={!probe}
                  onChange={(event) =>
                    setRepeat(event.target.value as 'none' | 'hourly' | 'daily' | 'weekly')
                  }
                >
                  <option value="none">No repetir</option>
                  <option value="hourly">Cada hora</option>
                  <option value="daily">Cada día</option>
                  <option value="weekly">Cada semana</option>
                </select>
              </label>
              <div className="inspector-grid">
                <label className="field">
                  <span>Ventana · desde</span>
                  <input
                    type="time"
                    value={windowStart}
                    disabled={!probe}
                    onChange={(event) => setWindowStart(event.target.value)}
                  />
                </label>
                <label className="field">
                  <span>Ventana · hasta</span>
                  <input
                    type="time"
                    value={windowEnd}
                    disabled={!probe}
                    onChange={(event) => setWindowEnd(event.target.value)}
                  />
                </label>
              </div>
              <p className="fine-print">
                Opcional. Fuera de esta ventana local el trabajo espera; una ventana nocturna
                (por ejemplo 22:00–06:00) cruza la medianoche.
              </p>
              <div className="download-utility-grid">
                {WEEKDAYS.map(([value, label]) => (
                  <label className="check" key={value}>
                    <input
                      type="checkbox"
                      checked={windowDays.includes(value)}
                      disabled={!probe}
                      onChange={(event) =>
                        setWindowDays((current) =>
                          event.target.checked
                            ? [...current, value]
                            : current.filter((day) => day !== value),
                        )
                      }
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
              <p className="fine-print">
                Sin fecha, empieza de inmediato. Si programás, la cola espera hasta esa hora y podés
                adelantarla con “Ahora” en la lista.
              </p>
              </fieldset>
            </details>
            <label className="check">
              <input
                type="checkbox"
                checked={rights}
                disabled={busy || !probe}
                onChange={(event) => setRights(event.target.checked)}
              />
              <span>Tengo derechos para descargar y usar este contenido.</span>
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={denoiseDownloads}
                disabled={busy || !probe || probe.kind !== 'video' || cinematic}
                onChange={(event) => setDenoiseDownloads(event.target.checked)}
              />
              <span>
                Reducir ruido del video al importar (reprocesa con FFmpeg y tarda más).
              </span>
            </label>
            {!voiceReady ? (
              <p className="fine-print">
                Escribí el guion de la voz IA para habilitar la descarga.
              </p>
            ) : null}
            {!project ? (
              <p className="fine-print">
                Se guarda en la biblioteca y no se importa a Medios.
              </p>
            ) : null}
            <button
              type="button"
              className="primary icon-text"
              disabled={!canDownload}
              onClick={enqueueCurrent}
            >
              <Icon name="download" size={15} />
              <span>
                {stage === 'downloading'
                  ? 'Descargando…'
                  : project
                    ? 'Descargar e importar'
                    : 'Descargar a la biblioteca'}
              </span>
            </button>
            {error ? (
              <div className="notice notice-warning" role="alert">
                {error}
              </div>
            ) : null}
            {warnings.length > 0 ? (
              <ul className="download-warnings">
                {warnings.map((warning, index) => (
                  <li key={`${index}-${warning}`}>{warning}</li>
                ))}
              </ul>
            ) : null}
            {outcome ? (
              <div className="download-outcome">
                <p className="eyebrow">Archivos</p>
                <ul>
                  {outcome.files.map((file) => (
                    <li key={file.path}>
                      <span>
                        {file.name}
                        {file.md5 ? (
                          <small className="download-md5" title={file.md5}>
                            MD5 {file.md5}
                          </small>
                        ) : null}
                        {file.sha256 ? (
                          <small className="download-md5" title={file.sha256}>
                            SHA-256 {file.sha256}
                          </small>
                        ) : null}
                      </span>
                      <strong>{formatBytes(file.bytes)}</strong>
                    </li>
                  ))}
                </ul>
                <p className="fine-print">
                  Guardado en <code>{outcome.directory}</code>
                </p>
                <div className="actions compact">
                  <button
                    type="button"
                    className="small ghost"
                    onClick={() => {
                      const path = outcome.files[0]?.path ?? outcome.directory;
                      void store.service.revealOutput(path).catch((reason) =>
                        store.setNotice(
                          reason instanceof Error
                            ? reason.message
                            : 'no se pudo abrir la carpeta',
                        ),
                      );
                    }}
                  >
                    Mostrar en carpeta
                  </button>
                  {outcome.files.find((file) => file.kind === 'video') ? (
                    <button
                      type="button"
                      className="small"
                      onClick={() => {
                        const video = outcome.files.find((file) => file.kind === 'video');
                        if (!video) return;
                        try {
                          window.sessionStorage.setItem(
                            'editor-ia.creator-input',
                            video.path,
                          );
                        } catch {
                          // Sin sessionStorage se elige a mano en Creador.
                        }
                        onNavigate('creator');
                      }}
                    >
                      Abrir en Creador
                    </button>
                  ) : null}
                  {importedCount > 0 ? (
                    <>
                      <button
                        type="button"
                        className="small primary"
                        onClick={() => onNavigate('auto-edit')}
                      >
                        Auto-editar
                      </button>
                      <button
                        type="button"
                        className="small"
                        onClick={() => onNavigate('editor')}
                      >
                        Abrir en Studio
                      </button>
                      <button
                        type="button"
                        className="small ghost"
                        onClick={() => onNavigate('assets')}
                      >
                        Ver {importedCount} archivo(s) en Medios
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>

          <div className="card download-notes download-notes-compact">
            <span>FFmpeg local</span>
            <span>Hasta 8K</span>
            <span>Cola persistente</span>
            <InfoTip
              label="Cómo funciona Descargas"
              text="Analizá el enlace para ver calidades reales, elegí hasta 8K y comprimí localmente sin subir archivos. Cada descarga queda en Descargas/Videos descargados/<Plataforma>/<Video>. Con un proyecto abierto se importa a Medios. Cerrar la ventana deja la cola viva en la bandeja."
            />
          </div>
        </aside>
      </div>
      {queue.length > 0 ? (
        <div className="download-queue-footer" role="status" aria-live="polite">
          <span
            className={`statusbar-dot ${
              queueRunning > 0
                ? 'phase-saving'
                : failedJobs > 0
                  ? 'phase-failed'
                  : pendingJobs > 0
                    ? 'phase-dirty'
                    : 'phase-saved'
            }`}
            aria-hidden="true"
          />
          <strong>
            {queueRunning > 0
              ? `${queueRunning} descarga(s) activas`
              : pendingJobs > 0
                ? 'Cola en espera'
                : failedJobs > 0
                  ? `${failedJobs} descarga(s) con error`
                  : 'Cola lista'}
          </strong>
          <span className="queue-footer-meta">
            {pendingJobs} pendiente(s) · {queue.length} en total
          </span>
          {queueRunning > 0 ? (
            <div
              className="queue-footer-track"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(consolidatedPercent)}
              aria-label="Progreso consolidado de la cola"
            >
              <span style={{ width: `${Math.max(0, Math.min(100, consolidatedPercent))}%` }} />
            </div>
          ) : null}
          <span className="queue-footer-percent">
            {queueRunning > 0 ? `${Math.round(consolidatedPercent)}%` : '—'}
          </span>
          <button
            type="button"
            className="small ghost"
            onClick={() => setQueueExpanded((current) => !current)}
          >
            {queueExpanded ? 'Contraer' : 'Expandir'}
          </button>
        </div>
      ) : null}
    </section>
  );
}
