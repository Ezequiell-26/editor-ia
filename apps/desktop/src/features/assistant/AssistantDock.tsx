import { useEffect, useMemo, useRef, useState } from 'react';
import { NAV_VIEWS, type ViewId } from '../../app/navigation';
import { Icon } from '../../components/Icon';
import { AiBrandMark } from '../../components/AiBrandMark';
import {
  detectAiBrand,
  endpointLabel,
  suggestedModels,
} from '../../services/ai-models';
import {
  isLocalProviderUrl,
  type AssistantAction,
  type AssistantChatReply,
  type AssistantChatRequest,
  type AssistantStreamHandle,
  type ImageContent,
  type ProviderInfo,
  type ProviderTestResult,
  type TranscriptionResult,
} from '../../services/project-service';
import { parseProject } from '@editor-ia/project-schema';
import type { Asset, ProjectDocument } from '@editor-ia/project-schema';
import { DOWNLOAD_DIR_KEY } from '../../state/download-prefs';
import {
  ASSISTANT_TOKEN_BUDGET_CHANGED_EVENT,
  estimateConversationTokens,
  loadAssistantTokenBudget,
} from '../../state/assistant-budget';
import { replyPreviewFromStream } from '../../state/assistant-stream';
import {
  applyProposals,
  applySafeProposals,
  brainBrief,
  planEdits,
  type EditIntent,
} from '../../state/brain';
import { buildFolderTimeline } from '../../state/folder-timeline';
import { buildNarrationPlan, fallbackAssignments } from '../../state/narration-plan';
import { buildNarrationTimeline } from '../../state/narration-timeline';
import {
  describeForPrompt,
  planImageAssignments,
} from '../../state/visual-intelligence';
import {
  addAsset,
  addCaptionCue,
  addClipFromAsset,
  addMotionGraphic,
  addTranscriptionCues,
  deleteCaptionCue,
  deleteClip,
  deleteTrack,
  fpsOf,
  markAssetReady,
  secondsToFrames,
  setClipSpeed,
  splitClip,
  totalFrames,
  updateClip,
} from '../../state/project-actions';
import { useProjectStore } from '../../state/project-store';
import { runSilenceCuts } from '../../state/silence-cuts';
import { autoCleanupSummary, runAutoCleanup } from '../../state/auto-cleanup';
import { autoPilotSummary, runAutoPilot } from '../../state/auto-pilot';
import {
  applySpeechCuts,
  cuesForClip,
  planSpeechCutsFromCues,
} from '../../state/speech-cuts';
import { queueDownloadUrl } from '../download/pending';
import {
  OPERATOR_HELP,
  parseOperatorCommand,
  type OperatorAction,
} from '../ai-hub/operator';
import { PetCompanion, type PetMood } from './PetCompanion';
import { executeMcpTool, type McpToolContext } from '../../state/mcp-tools';
import { MCP_TOOL_BY_NAME, MCP_TOOLS } from '../../state/mcp-catalog';
import { validateMcpToolArguments } from '../../state/mcp-validation';

interface ChatEntry {
  readonly role: 'user' | 'assistant';
  readonly text: string;
}

const GREETING: ChatEntry = {
  role: 'assistant',
  text:
    'Hola, soy Olyvia. Puedo controlar la app, montar una carpeta de Descargas con fotos y audio, resumir el proyecto o crear un gráfico. Probá «usar la carpeta video 1 de descargas» o «abrir editor».',
};

function audioDurationFrames(asset: Asset): number {
  return 'media' in asset && asset.media && 'durationFrames' in asset.media
    ? asset.media.durationFrames
    : 0;
}

function byLabel(left: Asset, right: Asset): number {
  return left.label.localeCompare(right.label, 'es', { numeric: true, sensitivity: 'base' });
}

/**
 * ¿La respuesta afirma que hizo algo?
 *
 * El modelo a veces contesta «listo, ya lo hice» sin devolver ninguna acción.
 * Detectarlo permite decir la verdad en vez de dejar a la persona esperando un
 * cambio que nunca ocurrió.
 */
const QUICK_ACTIONS: readonly { readonly label: string; readonly command: string }[] = [
  { label: 'Limpiar', command: 'limpiá el video' },
  { label: 'Silencios', command: 'cortá los silencios' },
  { label: 'Subtítulos', command: 'subtitulá el clip' },
  { label: 'Piloto', command: 'piloto automático' },
];

/** El streaming falló antes del primer delta: se reintenta sin streaming. */
class AssistantStreamRetry extends Error {}

/** La persona detuvo la respuesta en curso. */
class AssistantStreamStopped extends Error {}

const COMPLETION_CLAIM =
  /\b(listo|hecho|ya (lo )?hice|ya est[aá]|aplicad[oa]|apliqu[eé]|ediqu[eé]|edit[eé]|export[eé]|cort[eé]|limpi[eé]|borr[eé]|agregu[eé]|gener[eé])\b/i;

function claimsCompletion(text: string): boolean {
  return COMPLETION_CLAIM.test(text);
}

function motionProps(
  templateId: string,
  text: string,
  secondary?: string,
): Record<string, unknown> | null {
  if (templateId === 'title-card') {
    return {
      title: text,
      subtitle: secondary ?? '',
      background: '#0f172a',
      accent: '#35d6ff',
      align: 'left',
      animation: 'slide-up',
    };
  }
  if (templateId === 'lower-third') {
    return {
      name: text,
      role: secondary ?? '',
      accent: '#35d6ff',
      side: 'left',
      animation: 'slide-left',
    };
  }
  if (templateId === 'end-card') {
    return {
      title: text,
      cta: secondary ?? '',
      background: '#0f172a',
      accent: '#35d6ff',
      animation: 'fade',
    };
  }
  if (templateId === 'stat-callout') {
    return {
      value: text,
      label: secondary || 'dato',
      accent: '#35d6ff',
      animation: 'pop',
    };
  }
  return null;
}

export function AssistantDock({
  activeId,
  onSelect,
}: {
  readonly activeId: ViewId;
  readonly onSelect: (view: ViewId) => void;
}) {
  const store = useProjectStore();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<readonly ChatEntry[]>([GREETING]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Acción destructiva que el modelo propuso y que espera confirmación. */
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [pendingMcpCall, setPendingMcpCall] = useState<{
    readonly tool: string;
    readonly arguments: Readonly<Record<string, unknown>>;
  } | null>(null);
  const [provider, setProvider] = useState<ProviderInfo | null>(null);
  /** Último resultado tipado de «Probar proveedor» desde el estado de error. */
  const [providerTest, setProviderTest] = useState<ProviderTestResult | null>(null);
  const [providerTestFailure, setProviderTestFailure] = useState<string | null>(null);
  const [testingProvider, setTestingProvider] = useState(false);
  const [consent, setConsent] = useState(false);
  const [listening, setListening] = useState(false);
  const [replying, setReplying] = useState(false);
  /** Buffer crudo del streaming (JSON parcial); se muestra el `reply` parcial. */
  const [streamBuffer, setStreamBuffer] = useState<string | null>(null);
  /** Hay un streaming activo en el backend (aunque aún no llegó el primer delta). */
  const [streaming, setStreaming] = useState(false);
  const [tokenBudget, setTokenBudget] = useState(loadAssistantTokenBudget);
  const logRef = useRef<HTMLDivElement | null>(null);
  const replyTimerRef = useRef<number | null>(null);
  const streamHandleRef = useRef<AssistantStreamHandle | null>(null);

  useEffect(
    () => () => {
      if (replyTimerRef.current !== null) window.clearTimeout(replyTimerRef.current);
      // Si la ventana se desmonta a mitad de una respuesta, el backend no sigue
      // generando para nadie.
      streamHandleRef.current?.cancel();
    },
    [],
  );

  useEffect(() => {
    const refresh = (): void => setTokenBudget(loadAssistantTokenBudget());
    window.addEventListener(ASSISTANT_TOKEN_BUDGET_CHANGED_EVENT, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(ASSISTANT_TOKEN_BUDGET_CHANGED_EVENT, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  useEffect(() => {
    let active = true;
    void store.service
      .getProvider()
      .then((info) => {
        if (active) setProvider(info);
      })
      .catch(() => {
        if (active) setProvider(null);
      });
    return () => {
      active = false;
    };
  }, [store.service]);

  useEffect(() => {
    if (!open) return;
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [messages, open, busy]);

  const needsConsent =
    provider !== null &&
    provider.kind !== 'mock' &&
    provider.baseUrl.length > 0 &&
    !isLocalProviderUrl(provider.baseUrl);

  // Qué familia de modelo responde: se muestra con su marca de un vistazo.
  const brand = useMemo(
    () => (provider ? detectAiBrand(provider.baseUrl, provider.model) : 'mock'),
    [provider],
  );
  const providerLabel = useMemo(
    () => (provider ? endpointLabel(provider.baseUrl) : 'sin proveedor'),
    [provider],
  );
  const modelChoices = useMemo(
    () => (provider ? suggestedModels(provider.baseUrl, provider.model) : []),
    [provider],
  );
  const providerStatus: 'local' | 'remote' | 'sim' | 'none' = !provider
    ? 'none'
    : provider.kind === 'mock'
      ? 'sim'
      : isLocalProviderUrl(provider.baseUrl)
        ? 'local'
        : 'remote';

  /**
   * Recuperación desde el estado de error: prueba el proveedor configurado y
   * muestra el resultado tipado (HTTP, latencia y modelo) sin cerrar el chat.
   * El backend redacta el motivo accionable; acá no se inventa un éxito.
   */
  async function probeProvider(): Promise<void> {
    if (testingProvider) return;
    setTestingProvider(true);
    setProviderTest(null);
    setProviderTestFailure(null);
    try {
      setProviderTest(await store.service.testProvider());
    } catch (cause) {
      setProviderTestFailure(
        cause instanceof Error
          ? cause.message
          : 'no se pudo probar la conexión con el proveedor',
      );
    } finally {
      setTestingProvider(false);
    }
  }

  // Estimación visible (4 caracteres por token, igual que AI Hub). El aviso es
  // configurable en Ajustes → IA y nunca bloquea el envío.
  const tokenEstimate = useMemo(
    () =>
      estimateConversationTokens([
        ...messages
          .filter((entry) => entry.text !== GREETING.text)
          .map((entry) => entry.text),
        input,
      ]),
    [messages, input],
  );
  const tokenBudgetExceeded = tokenEstimate >= tokenBudget;
  const streamPreview = streamBuffer === null ? '' : replyPreviewFromStream(streamBuffer);

  /**
   * Respuesta del asistente: streaming con burbuja en vivo si el backend lo
   * soporta; si el comando no existe, falla antes del primer delta o el
   * endpoint no habla SSE, se usa el camino no-streaming de siempre.
   */
  async function requestAssistantReply(
    request: AssistantChatRequest,
  ): Promise<AssistantChatReply> {
    const service = store.service;
    if (!service.available) return service.assistantChat(request);
    let resolveReply!: (reply: AssistantChatReply) => void;
    let rejectReply!: (cause: unknown) => void;
    const answer = new Promise<AssistantChatReply>((resolve, reject) => {
      resolveReply = resolve;
      rejectReply = reject;
    });
    let handle: AssistantStreamHandle;
    try {
      handle = await service.assistantChatStream(request, {
        onDelta(delta) {
          setStreamBuffer((current) => `${current ?? ''}${delta}`);
        },
        onCompleted(reply) {
          resolveReply(reply);
        },
        onFailed(failure) {
          rejectReply(
            failure.retryable
              ? new AssistantStreamRetry(failure.message)
              : new Error(failure.message),
          );
        },
        onCancelled() {
          rejectReply(new AssistantStreamStopped('Respuesta detenida.'));
        },
      });
      streamHandleRef.current = handle;
      setStreaming(true);
    } catch {
      // Build viejo sin el comando o invoke rechazado antes de empezar.
      return service.assistantChat(request);
    }
    try {
      return await answer;
    } catch (cause) {
      if (cause instanceof AssistantStreamRetry) {
        // Mismo contrato, sin streaming: la app sigue siendo usable con
        // proveedores que ignoran `stream:true`.
        return service.assistantChat(request);
      }
      throw cause;
    } finally {
      streamHandleRef.current = null;
      setStreamBuffer(null);
      setStreaming(false);
    }
  }

  function stopStreaming(): void {
    streamHandleRef.current?.cancel();
  }

  async function switchModel(model: string): Promise<void> {
    if (!provider || busy) return;
    const next = model.trim();
    if (!next || next === provider.model) return;
    setBusy(true);
    setError(null);
    try {
      // Sin `apiKey`: la clave guardada se conserva en el almacén de Windows.
      const info = await store.service.saveProvider({
        kind: provider.kind,
        baseUrl: provider.baseUrl,
        model: next,
      });
      setProvider(info);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'no se pudo cambiar el modelo');
    } finally {
      setBusy(false);
    }
  }

  const mood: PetMood = busy
    ? 'thinking'
    : replying
      ? 'replying'
      : listening
        ? 'listening'
        : 'awake';

  function flashReply(): void {
    setReplying(true);
    if (replyTimerRef.current !== null) window.clearTimeout(replyTimerRef.current);
    replyTimerRef.current = window.setTimeout(() => setReplying(false), 2400);
  }

  function toggleOpen(): void {
    if (open) {
      setOpen(false);
      setListening(false);
      setReplying(false);
    } else {
      setOpen(true);
    }
  }

  function append(entry: ChatEntry): void {
    setMessages((current) => [...current, entry].slice(-24));
  }

  function navigate(view: string, label?: string): string {
    const target = NAV_VIEWS.find((item) => item.id === view);
    if (!target) return 'No conozco esa vista.';
    onSelect(target.id);
    return `Abriendo ${label ?? target.label}.`;
  }

  /**
   * Importa una carpeta de Descargas y monta imágenes/audio en la timeline.
   * La carpeta llega como nombre (nunca una ruta): Rust la resuelve dentro de
   * Descargas y del destino configurado del descargador.
   */
  async function mountMediaFolder(folder: string): Promise<string> {
    const name = folder.trim();
    const isAbsolute = /^[a-zA-Z]:[\\/]/.test(name) || /^\//.test(name);
    if (!name || (!isAbsolute && /[\\/]/.test(name))) {
      return 'El nombre de la carpeta no es válido.';
    }
    const root = window.localStorage.getItem(DOWNLOAD_DIR_KEY) ?? undefined;
    let listing;
    try {
      listing = await store.service.listMediaFolder({
        folder: name,
        ...(root ? { root } : {}),
      });
    } catch (cause) {
      return cause instanceof Error ? cause.message : 'No pude leer la carpeta.';
    }
    if (listing.files.length === 0) {
      return `No encontré imágenes, audio o video en «${name}».`;
    }
    let target = store.getProject();
    if (!target) {
      const projectName = isAbsolute
        ? name.split(/[\\/]/).filter(Boolean).pop() || 'Proyecto'
        : name;
      const created = await store.createProject({
        name: projectName,
        width: 1920,
        height: 1080,
        fpsNum: 30,
        fpsDen: 1,
      });
      if (!created) return 'No pude crear el proyecto para montar la carpeta.';
      // El store publica el proyecto en el próximo render; se espera sin
      // bloquear la UI y se aborta si no aparece.
      for (let attempt = 0; attempt < 50 && !target; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        target = store.getProject();
      }
      if (!target) return 'El proyecto se está abriendo; probá de nuevo en un segundo.';
    }
    const rate = target.video.frameRate;
    let outcome;
    try {
      outcome = await store.service.importMediaPaths({
        paths: listing.files.map((file) => file.path),
        fpsNum: rate.num,
        fpsDen: rate.den,
        confirmRights: true,
      });
    } catch (cause) {
      return cause instanceof Error ? cause.message : 'No pude importar los archivos.';
    }
    if (outcome.assets.length === 0) {
      return outcome.warnings[0] ?? 'No pude importar los archivos de la carpeta.';
    }
    const images = outcome.assets
      .filter((asset) => asset.kind === 'image')
      .sort(byLabel);
    const videos = outcome.assets
      .filter((asset) => asset.kind === 'video')
      .sort(byLabel);
    const audios = outcome.assets
      .filter((asset) => asset.kind === 'audio')
      .sort((left, right) => audioDurationFrames(right) - audioDurationFrames(left));
    const voice = audios[0];
    const music = audios.slice(1);

    let prepared = target;
    for (const asset of outcome.assets) {
      prepared = addAsset(prepared, asset);
      prepared = markAssetReady(prepared, asset.id, 'allowed');
    }

    let builtProject: ProjectDocument | null = null;
    let firstClipId: string | null = null;
    let summary = '';
    const warnings: string[] = [];

    if (voice && images.length > 0 && audioDurationFrames(voice) > 0) {
      // La transcripción lee el proyecto desde disco: se aplican los assets y
      // se guarda antes de pedirla.
      const assetsApplied = store.update(() => prepared, { history: false });
      const saved = assetsApplied ? await store.saveNow() : false;
      if (saved) {
        try {
          setBusyLabel('Transcribiendo la voz…');
          const transcript = await store.service.transcribeAsset(voice.id);
          const plan = buildNarrationPlan(transcript.segments);
          if (plan.sentences.length > 0) {
            const sentenceTexts = plan.sentences.map((sentence) => sentence.text);

            // 1. Medir qué muestra cada imagen. Es local y rápido; si falla, el
            //    montaje sigue funcionando con el orden de archivos.
            let contents: ImageContent[] = [];
            try {
              setBusyLabel('Mirando el contenido de las imágenes…');
              contents = await store.service.analyzeImages(images.map((image) => image.id));
            } catch {
              contents = [];
            }
            const byAsset = new Map(contents.map((item) => [item.assetId, item]));
            const ordered = images.map((image) => byAsset.get(image.id) ?? null);
            const measured = ordered.filter((item): item is ImageContent => item !== null);
            const allMeasured = measured.length === images.length;

            // 2. Plan local por contenido: siempre disponible, sin costo.
            let assignments: number[] | null = null;
            let matchedBy = 'el orden de archivos';
            if (allMeasured && images.length > 1) {
              const localPlan = planImageAssignments(sentenceTexts, measured);
              if (localPlan.length === sentenceTexts.length) {
                assignments = localPlan.map((item) => item.imageIndex);
                matchedBy = 'el contenido de cada imagen';
              }
            }

            // 3. La IA decide con las descripciones delante, no con el nombre.
            try {
              setBusyLabel('Pensando el montaje con la IA…');
              const match = await store.service.matchMediaPlan({
                sentences: sentenceTexts,
                images: images.map((image) => image.label),
                imageDescriptions: ordered.map((item) =>
                  item ? describeForPrompt(item) : 'sin datos de contenido',
                ),
                approvedCost: consent,
              });
              const valid =
                match.assignments.length === plan.sentences.length &&
                match.assignments.every(
                  (index) => Number.isInteger(index) && index >= 0 && index < images.length,
                );
              // Un plan que repite la misma imagen seguida cuando hay
              // alternativa se descarta: se ve como un error de montaje.
              const repeatsBackToBack =
                images.length > 1 &&
                match.assignments.some(
                  (index, position) => position > 0 && index === match.assignments[position - 1],
                );
              if (valid && !repeatsBackToBack) {
                assignments = [...match.assignments];
                matchedBy = 'la IA con la descripción visual';
              }
            } catch {
              // Sin IA queda el plan por contenido.
            }
            if (!assignments) {
              assignments = fallbackAssignments(plan.sentences.length, images.length);
              matchedBy = 'el orden de archivos';
            }
            // `store.getProject()` puede devolver todavía el proyecto previo a
            // aplicar los assets (el estado se publica en el próximo render).
            // Si le faltan los assets que vamos a usar, montamos sobre
            // `prepared`: si no, los clips quedan apuntando a material
            // inexistente y el proyecto no valida.
            const liveProject = store.getProject();
            const neededAssets = [voice.id, ...images.map((image) => image.id)];
            const liveHasAssets =
              liveProject !== null &&
              neededAssets.every((id) => liveProject.assets.some((asset) => asset.id === id));
            const live = liveHasAssets ? liveProject : prepared;
            setBusyLabel('Montando imágenes, voz y subtítulos…');
            const built = buildNarrationTimeline(
              live,
              {
                images,
                voice,
                ...(music.length > 0 ? { music } : {}),
              },
              plan,
              assignments,
            );
            builtProject = built.project;
            firstClipId = built.firstClipId;
            warnings.push(...built.warnings);
            const seconds = Math.max(0, plan.end - plan.start).toFixed(1);
            const imageWord = images.length === 1 ? 'imagen' : 'imágenes';
            const sentenceWord = plan.sentences.length === 1 ? 'frase' : 'frases';
            const captionWord = built.captionCount === 1 ? 'subtítulo' : 'subtítulos';
            summary = `Monté ${images.length} ${imageWord} sobre ${plan.sentences.length} ${sentenceWord} (${seconds}s), con ${built.captionCount} ${captionWord} y audio a −14 LUFS.`;
            summary += ` Imágenes colocadas por ${matchedBy}.`;
            if (allMeasured) {
              const count = measured.length === 1 ? '1 imagen' : `${measured.length} imágenes`;
              summary += ` Analicé luz, color, encuadre y personas en ${count}.`;
            }
            if (music.length > 0) summary += ' Música con ducking.';
          } else {
            warnings.push('La voz no tiene palabras reconocibles; usé 3 s por imagen.');
          }
        } catch (cause) {
          warnings.push(
            cause instanceof Error
              ? cause.message
              : 'No pude transcribir la voz; usé 3 s por imagen.',
          );
        }
      } else {
        warnings.push('No pude guardar el proyecto para transcribir; usé 3 s por imagen.');
      }
    }

    if (!builtProject) {
      let fallback;
      try {
        fallback = buildFolderTimeline(prepared, { images, videos, audio: audios });
      } catch (cause) {
        return cause instanceof Error ? cause.message : 'No pude montar la carpeta.';
      }
      builtProject = fallback.project;
      firstClipId = fallback.firstClipId;
      warnings.push(...fallback.warnings);
      const parts = [
        images.length > 0 ? `${images.length} imagen(es)` : null,
        videos.length > 0 ? `${videos.length} video(s)` : null,
        audios.length > 0 ? 'audio' : null,
      ]
        .filter(Boolean)
        .join(' + ');
      summary = `Monté ${parts} de «${name}» en el editor.`;
    }

    const parsed = parseProject(builtProject);
    if (!parsed.ok) {
      const first = parsed.issues[0];
      return `No pude montar: ${
        first ? `${first.path}: ${first.message}` : 'el proyecto quedaría inválido'
      }.`;
    }
    const applied = store.update(() => parsed.project, {
      notice: 'Montaje aplicado.',
    });
    if (!applied) return 'El proyecto cambió mientras montaba; probá de nuevo.';
    if (firstClipId) store.setSelection({ kind: 'clip', id: firstClipId });
    onSelect('editor');
    const saved = await store.saveNow();
    if (!saved) warnings.push('Quedó sin guardar; usá Guardar.');
    const warning = warnings.length > 0 ? ` ${warnings.slice(0, 2).join(' ')}` : '';
    return `${summary}${warning}`;
  }

  /**
   * Garantiza un proyecto abierto antes de tocar la timeline. Si no hay uno,
   * crea uno estándar y espera a que el store lo publique.
   */
  async function ensureProjectForEdit(): Promise<ProjectDocument | null> {
    let target = store.getProject();
    if (target) return target;
    const created = await store.createProject({
      name: 'Proyecto del asistente',
      width: 1920,
      height: 1080,
      fpsNum: 30,
      fpsDen: 1,
    });
    if (!created) return null;
    for (let attempt = 0; attempt < 50 && !target; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      target = store.getProject();
    }
    return target;
  }

  function selectedClipId(): string | null {
    const selection = store.state.selection;
    return selection.kind === 'clip' ? selection.id : null;
  }

  async function importFileFromDisk(path: string): Promise<string> {
    const clean = path.trim();
    if (!/^[a-zA-Z]:[\\/]/.test(clean) && !/^\//.test(clean)) {
      return 'Necesito una ruta absoluta, por ejemplo C:\\Videos\\clip.mp4.';
    }
    const project = await ensureProjectForEdit();
    if (!project) return 'No pude preparar un proyecto para importar.';
    let outcome;
    try {
      outcome = await store.service.importMediaPaths({
        paths: [clean],
        fpsNum: project.video.frameRate.num,
        fpsDen: project.video.frameRate.den,
        confirmRights: true,
        provider: 'assistant',
      });
    } catch (cause) {
      return cause instanceof Error ? cause.message : 'No pude importar el archivo.';
    }
    const asset = outcome.assets[0];
    if (!asset) return outcome.warnings[0] ?? 'No pude importar ese archivo.';
    store.update((current) => {
      let next = addAsset(current, asset);
      next = markAssetReady(next, asset.id, 'allowed');
      return next;
    }, { notice: `${asset.label} importado a Medios.` });
    store.setSelection({ kind: 'asset', id: asset.id });
    return `${asset.label} quedó en Medios. Decime “agregá el clip ${asset.label}” para llevarlo a la timeline.`;
  }

  async function addClipByLabel(label: string, atPlayhead: boolean): Promise<string> {
    const project = await ensureProjectForEdit();
    if (!project) return 'No pude abrir un proyecto para editar.';
    const wanted = label.trim().toLowerCase();
    const asset = project.assets.find(
      (item) =>
        item.status === 'ready' &&
        (item.label.toLowerCase() === wanted ||
          item.label.toLowerCase().includes(wanted) ||
          wanted.includes(item.label.toLowerCase())),
    );
    if (!asset) {
      const names = project.assets
        .filter((item) => item.status === 'ready')
        .slice(0, 5)
        .map((item) => item.label);
      return `No encuentro un material que se llame “${label}”.${
        names.length > 0 ? ` Tengo: ${names.join(', ')}.` : ' No hay material listo en Medios.'
      }`;
    }
    const mediaFrames =
      'media' in asset && asset.media && 'durationFrames' in asset.media
        ? asset.media.durationFrames
        : undefined;
    let clipId: string | null = null;
    const ok = store.mutate((current) => {
      const fps = fpsOf(current);
      const mediaSeconds = mediaFrames ? mediaFrames / fps : 5;
      const start = atPlayhead ? store.getPlayhead() : totalFrames(current);
      const added = addClipFromAsset(current, asset, {
        atFrame: start,
        ...(mediaFrames ? { inFrame: 0, outFrame: mediaFrames } : {}),
        durationFrames: mediaFrames ?? Math.round(fps * Math.max(1, mediaSeconds)),
      });
      clipId = added.clipId;
      return { project: added.project };
    }, { notice: `Clip agregado: ${asset.label}.` });
    if (!ok || !clipId) return 'No pude agregar el clip a la timeline.';
    store.setSelection({ kind: 'clip', id: clipId });
    onSelect('editor');
    return `${asset.label} agregado a la timeline${atPlayhead ? ' en el playhead' : ' al final'}. Podés deshacer.`;
  }

  async function deleteSelection(): Promise<string> {
    const selection = store.state.selection;
    if (selection.kind === 'clip') {
      let nextDuration = 0;
      store.update((current) => {
        const next = deleteClip(current, selection.id);
        nextDuration = totalFrames(next);
        return next;
      }, { notice: 'Clip eliminado.' });
      store.setSelection({ kind: 'none' });
      store.setPlayhead(Math.min(store.getPlayhead(), nextDuration));
      return 'Clip eliminado. Podés deshacer.';
    }
    if (selection.kind === 'cue') {
      store.update((current) => deleteCaptionCue(current, selection.id), {
        notice: 'Subtítulo eliminado.',
      });
      store.setSelection({ kind: 'none' });
      return 'Subtítulo eliminado. Podés deshacer.';
    }
    if (selection.kind === 'track') {
      store.update((current) => deleteTrack(current, selection.id), {
        notice: 'Pista eliminada.',
      });
      store.setSelection({ kind: 'none' });
      return 'Pista eliminada. Podés deshacer.';
    }
    return 'No hay nada seleccionado para borrar. Tocá un clip en la timeline y volvé a pedirme.';
  }

  async function splitSelection(): Promise<string> {
    const clipId = selectedClipId();
    if (!clipId) {
      return 'Elegí un clip en la timeline y volvé a pedirme el corte.';
    }
    let rightClipId: string | null = null;
    const ok = store.mutate((current) => {
      const split = splitClip(current, clipId, store.getPlayhead());
      if (!split) {
        throw new Error('el playhead no está dentro del clip seleccionado');
      }
      rightClipId = split.rightClipId;
      return { project: split.project };
    }, { notice: 'Clip cortado en el playhead.' });
    if (!ok || !rightClipId) {
      return 'El playhead no está dentro del clip seleccionado.';
    }
    store.setSelection({ kind: 'clip', id: rightClipId });
    return 'Corté el clip en el playhead. Podés deshacer.';
  }

  function goTo(seconds: number): string {
    const project = store.state.project;
    const fps = project ? fpsOf(project) : 30;
    store.setPlayhead(Math.max(0, Math.round(seconds * fps)));
    if (store.state.project) onSelect('editor');
    return `Playhead en ${seconds.toFixed(1)} s.`;
  }

  async function addCaptionNow(text: string, seconds: number): Promise<string> {
    const project = await ensureProjectForEdit();
    if (!project) return 'No pude abrir un proyecto para el subtítulo.';
    const clean = text.trim();
    if (!clean) return 'El subtítulo está vacío.';
    let cueId: string | null = null;
    const ok = store.mutate((current) => {
      const fps = fpsOf(current);
      const added = addCaptionCue(current, {
        text: clean,
        startFrame: store.getPlayhead(),
        durationFrames: Math.max(1, Math.round(seconds * fps)),
      });
      cueId = added.cueId;
      return { project: added.project };
    }, { notice: 'Subtítulo agregado.' });
    if (!ok || !cueId) return 'No pude agregar el subtítulo (¿la pista está bloqueada?).';
    store.setSelection({ kind: 'cue', id: cueId });
    onSelect('editor');
    return `Subtítulo agregado en el playhead (${seconds.toFixed(1)} s). Podés deshacer.`;
  }

  async function changeSpeed(speed: number): Promise<string> {
    const clipId = selectedClipId();
    if (!clipId) return 'Elegí un clip para cambiar la velocidad.';
    try {
      store.update((current) => setClipSpeed(current, clipId, speed), {
        notice: `Velocidad ${speed.toFixed(2)}x.`,
      });
      onSelect('editor');
      return `Velocidad del clip en ${speed.toFixed(2)}x. Podés deshacer.`;
    } catch (cause) {
      return cause instanceof Error ? cause.message : 'No pude cambiar la velocidad.';
    }
  }

  async function changeGain(db: number): Promise<string> {
    const clipId = selectedClipId();
    if (!clipId) return 'Elegí un clip para cambiar el volumen.';
    const current = store.state.project?.timeline.clips.find((clip) => clip.id === clipId);
    const existing =
      current && 'audio' in current && current.audio ? current.audio : undefined;
    try {
      store.update((currentProject) =>
        updateClip(currentProject, clipId, {
          audio: { ...(existing ?? {}), gainDb: db },
        }),
      { notice: `Ganancia ${db > 0 ? '+' : ''}${db} dB.` });
      onSelect('editor');
      return `Volumen del clip en ${db > 0 ? '+' : ''}${db} dB. Podés deshacer.`;
    } catch (cause) {
      return cause instanceof Error ? cause.message : 'No pude cambiar el volumen.';
    }
  }

  function setClipMuted(muted: boolean): string {
    const clipId = selectedClipId();
    if (!clipId) return 'Elegí un clip para silenciar o reactivar.';
    const current = store.state.project?.timeline.clips.find((clip) => clip.id === clipId);
    const existing = current && 'audio' in current && current.audio ? current.audio : undefined;
    const ok = store.update((currentProject) =>
      updateClip(currentProject, clipId, {
        audio: { ...(existing ?? {}), muted },
      }),
    { notice: muted ? 'Clip silenciado.' : 'Audio del clip reactivado.' });
    if (!ok) return 'No pude cambiar el audio del clip.';
    onSelect('editor');
    return muted ? 'Clip silenciado. Podés deshacer.' : 'Audio del clip reactivado.';
  }

  /**
   * Corta los silencios medidos por la app.
   *
   * El asistente no decide qué es silencio: pide el corte y el motor de
   * `state/silence-cuts` mide los picos, arma el plan y aplica con ripple. La
   * guardia del 80 % y las pistas bloqueadas se respetan igual que en la UI.
   */
  async function cutSilences(action: {
    readonly scope: 'selection' | 'project';
    readonly thresholdDb: number;
    readonly minSilenceSeconds: number;
    readonly paddingSeconds: number;
  }): Promise<string> {
    const project = store.state.project;
    if (!project) return 'Abrí o creá un proyecto para cortar silencios.';
    const selection = store.state.selection;
    const selected = action.scope === 'selection' && selection.kind === 'clip';
    // Sin clip seleccionado el pedido cae al proyecto completo, igual que el
    // menú: se avisa en la respuesta para que no parezca que tocó otra cosa.
    const fallback = action.scope === 'selection' && !selected;
    const clipIds = selected ? [selection.id] : undefined;
    const result = await runSilenceCuts(
      project,
      (assetId) => store.service.audioPeaks(assetId),
      {
        clipIds,
        thresholdDb: action.thresholdDb,
        minSilenceSeconds: action.minSilenceSeconds,
        paddingSeconds: action.paddingSeconds,
      },
    );
    if (result.candidates === 0) {
      return 'No hay clips con audio a 1× en pistas desbloqueadas para analizar.';
    }
    if (result.clips === 0) {
      return result.skipped === result.candidates
        ? 'No pude medir los picos de esos clips: el material no tiene audio analizable.'
        : 'No encontré silencios que superen el mínimo con ese umbral.';
    }
    const ok = store.update(() => result.project, {
      notice: `Silencios recortados en ${result.clips} clip(s): ${result.removedSeconds.toFixed(2)} s menos.`,
    });
    if (!ok) return 'El corte no dejó el proyecto en un estado válido; no se aplicó.';
    onSelect('editor');
    const prefix = fallback
      ? 'No había un clip seleccionado: corté los silencios de todo el proyecto. '
      : '';
    return `${prefix}Recorté ${result.cuts} silencio(s) en ${result.clips} clip(s): ${result.removedSeconds.toFixed(2)} s menos. Podés deshacer con Ctrl+Z.`;
  }

  /**
   * Subtítulos automáticos desde la voz.
   *
   * La IA no inventa el texto: transcribe con Whisper local y el planificador
   * de `state/caption-planner` parte cada segmento en cues de dos líneas con
   * los tiempos de palabra. Un segmento de 8 segundos no es un subtítulo.
   */
  async function autoSubtitles(action: {
    readonly scope: 'selection' | 'project';
  }): Promise<string> {
    const MAX_CLIPS = 12;
    const project = store.state.project;
    if (!project) return 'Abrí o creá un proyecto para generar subtítulos.';
    const selection = store.state.selection;
    const selected = action.scope === 'selection' && selection.kind === 'clip';
    const fallback = action.scope === 'selection' && !selected;
    const clipIds = selected ? [selection.id] : undefined;
    const candidates = project.timeline.clips.filter((clip) => {
      if (clipIds && !clipIds.includes(clip.id)) return false;
      if (clip.kind !== 'video' && clip.kind !== 'audio') return false;
      if (clip.source.type !== 'asset') return false;
      const track = project.timeline.tracks.find((item) => item.id === clip.trackId);
      return track?.locked !== true;
    });
    if (candidates.length === 0) {
      return 'No hay clips con audio en pistas desbloqueadas para transcribir.';
    }
    // El transcriptor lee el archivo desde disco: el proyecto tiene que estar
    // guardado, igual que en el botón del Inspector.
    const saved = await store.saveNow();
    if (!saved) {
      return 'No pude guardar el proyecto: la transcripción lee el archivo desde disco.';
    }
    const cache = new Map<string, TranscriptionResult | null>();
    const transcripts: { clipId: string; segments: TranscriptionResult['segments'] }[] = [];
    let model = '';
    let firstError = '';
    for (const clip of candidates.slice(0, MAX_CLIPS)) {
      if (clip.source.type !== 'asset') continue;
      const assetId = clip.source.assetId;
      let transcription = cache.get(assetId);
      if (transcription === undefined) {
        try {
          transcription = await store.service.transcribeAsset(
            assetId,
            project.language,
            'small',
          );
          model = transcription.model;
        } catch (error) {
          transcription = null;
          if (!firstError) {
            firstError = error instanceof Error ? error.message : 'error desconocido';
          }
        }
        cache.set(assetId, transcription);
      }
      if (transcription) {
        transcripts.push({ clipId: clip.id, segments: transcription.segments });
      }
    }
    if (transcripts.length === 0) {
      return `No pude transcribir el material${firstError ? `: ${firstError}` : '.'}`;
    }
    let added = 0;
    let overCps = 0;
    let split = 0;
    let worstCps = 0;
    const ok = store.update(
      (current) => {
        let next = current;
        for (const item of transcripts) {
          const result = addTranscriptionCues(next, item.clipId, item.segments, true);
          next = result.project;
          added += result.added;
          overCps += result.overCps;
          split += result.splitSegments;
          worstCps = Math.max(worstCps, result.maxCps);
        }
        return next;
      },
      { notice: `Subtítulos generados: ${added} cue(s).` },
    );
    if (!ok) {
      return 'Los subtítulos no dejaron el proyecto en un estado válido; no se aplicaron.';
    }
    onSelect('editor');
    const prefix = fallback ? 'No había un clip seleccionado: subtitulé todo el proyecto. ' : '';
    const capped =
      candidates.length > MAX_CLIPS
        ? ` Para no bloquear el chat transcribí ${MAX_CLIPS} de ${candidates.length} clips; repetí el comando para el resto.`
        : '';
    const warning =
      overCps > 0
        ? ` ${overCps} cue(s) superan la velocidad de lectura cómoda (máx. ${worstCps.toFixed(1)} car/s): acortá el texto de esos tramos.`
        : '';
    return `${prefix}Generé ${added} subtítulo(s) en ${transcripts.length} clip(s) con Whisper ${model}. ${split} segmento(s) se partieron para entrar en dos líneas.${warning}${capped} Podés deshacer con Ctrl+Z.`;
  }

  /**
   * Corta el aire entre frases usando los subtítulos.
   *
   * Si el clip no tiene subtítulos, los genera primero (misma transcripción
   * local que `auto_subtitles`) y después corta: sin tiempos de palabra no hay
   * forma honesta de saber dónde termina una frase. Todo va en un solo paso de
   * deshacer.
   */
  async function cutVoicePauses(action: {
    readonly minPauseSeconds: number;
    readonly paddingSeconds: number;
    readonly scope: 'selection' | 'project';
  }): Promise<string> {
    const project = store.state.project;
    if (!project) return 'Abrí o creá un proyecto para cortar pausas.';
    const selection = store.state.selection;
    const selected = action.scope === 'selection' && selection.kind === 'clip';
    const fallback = action.scope === 'selection' && !selected;
    const clipIds = selected ? [selection.id] : undefined;
    const candidates = project.timeline.clips
      .filter((clip) => {
        if (clipIds && !clipIds.includes(clip.id)) return false;
        if (clip.kind !== 'video' && clip.kind !== 'audio') return false;
        if (clip.source.type !== 'asset') return false;
        const track = project.timeline.tracks.find((item) => item.id === clip.trackId);
        return track?.locked !== true;
      })
      .sort((a, b) => a.startFrame - b.startFrame);
    if (candidates.length === 0) {
      return 'No hay clips con audio en pistas desbloqueadas para analizar.';
    }

    const missing = candidates.filter((clip) => cuesForClip(project, clip.id).length === 0);
    const transcripts: { clipId: string; segments: TranscriptionResult['segments'] }[] = [];
    if (missing.length > 0) {
      const saved = await store.saveNow();
      if (!saved) {
        return 'No pude guardar el proyecto: la transcripción lee el archivo desde disco.';
      }
      const cache = new Map<string, TranscriptionResult | null>();
      let firstError = '';
      for (const clip of missing.slice(0, 12)) {
        if (clip.source.type !== 'asset') continue;
        const assetId = clip.source.assetId;
        let transcription = cache.get(assetId);
        if (transcription === undefined) {
          try {
            transcription = await store.service.transcribeAsset(assetId, project.language, 'small');
          } catch (error) {
            transcription = null;
            if (!firstError) {
              firstError = error instanceof Error ? error.message : 'error desconocido';
            }
          }
          cache.set(assetId, transcription);
        }
        if (transcription) {
          transcripts.push({ clipId: clip.id, segments: transcription.segments });
        }
      }
      if (transcripts.length === 0) {
        return `No pude transcribir el material para medir las pausas${firstError ? `: ${firstError}` : '.'}`;
      }
    }

    let pauses = 0;
    let removed = 0;
    let touched = 0;
    let subtitles = 0;
    const ok = store.update(
      (current) => {
        let next = current;
        for (const item of transcripts) {
          const result = addTranscriptionCues(next, item.clipId, item.segments, true);
          next = result.project;
          subtitles += result.added;
        }
        for (const clip of candidates) {
          const live = next.timeline.clips.find((item) => item.id === clip.id);
          if (!live) continue;
          const plan = planSpeechCutsFromCues(
            cuesForClip(next, clip.id),
            live,
            fpsOf(next),
            {
              minPauseSeconds: action.minPauseSeconds,
              paddingSeconds: action.paddingSeconds,
            },
          );
          if (!plan || plan.excessive) continue;
          const after = applySpeechCuts(next, clip.id, plan);
          if (after === next) continue;
          touched += 1;
          pauses += plan.pauses;
          removed += plan.removedSeconds;
          next = after;
        }
        return next;
      },
      { notice: `Pausas recortadas: ${pauses} en ${touched} clip(s).` },
    );
    if (!ok) return 'El corte no dejó el proyecto en un estado válido; no se aplicó.';
    if (touched === 0) {
      return 'No encontré pausas entre frases con ese mínimo. Probá con una pausa mínima más chica.';
    }
    onSelect('editor');
    const prefix = fallback ? 'No había un clip seleccionado: analicé todo el proyecto. ' : '';
    const generated =
      subtitles > 0 ? ` Generé ${subtitles} subtítulo(s) para medir las frases.` : '';
    return `${prefix}Recorté ${pauses} pausa(s) en ${touched} clip(s): ${removed.toFixed(2)} s menos.${generated} Podés deshacer con Ctrl+Z.`;
  }

  /**
   * Limpieza completa en un paso: silencios, pausas, ruido, volumen y zoom.
   * El reporte vuelve medido para que la respuesta diga qué se hizo y cuánto.
   */
  async function autoCleanup(action: {
    readonly denoise: 'off' | 'light' | 'medium' | 'strong';
    readonly levelAudio: boolean;
    readonly zoomCuts: boolean;
    readonly cutSilences: boolean;
    readonly cutPauses: boolean;
    readonly targetLufs: number;
  }): Promise<string> {
    const project = store.state.project;
    if (!project) return 'Abrí o creá un proyecto para limpiarlo.';
    const report = await runAutoCleanup(
      project,
      (assetId) => store.service.audioPeaks(assetId),
      {
        denoise: action.denoise,
        levelAudio: action.levelAudio,
        zoomCuts: action.zoomCuts,
        cutSilences: action.cutSilences,
        cutPauses: action.cutPauses,
        targetLufs: action.targetLufs,
      },
    );
    if (report.project === project) return 'No había nada que limpiar en el proyecto.';
    const ok = store.update(() => report.project, {
      notice: `Limpieza automática: ${autoCleanupSummary(report)}`,
    });
    if (!ok) return 'La limpieza no dejó el proyecto en un estado válido; no se aplicó.';
    onSelect('editor');
    return `Limpieza automática: ${autoCleanupSummary(report)} Podés deshacer con Ctrl+Z.`;
  }

  /**
   * Piloto automático completo: mide, limpia, exporta y verifica. La entrega
   * sale a `<raíz del proyecto>\entregas`, igual que desde el menú.
   */
  async function autoPilot(): Promise<string> {
    const project = store.state.project;
    const opened = store.state.opened;
    if (!project) return 'Abrí o creá un proyecto para usar el piloto automático.';
    if (!opened) return 'Guardá el proyecto antes de usar el piloto automático.';
    const saved = await store.saveNow();
    if (!saved) return 'No pude guardar el proyecto: el piloto necesita el archivo en disco.';
    const report = await runAutoPilot({
      project,
      service: store.service,
      options: { outputDir: `${opened.root.replace(/[\\/]+$/, '')}\\entregas` },
    });
    const unchanged = store.state.project === project;
    if (unchanged) store.update(() => report.project);
    onSelect('editor');
    return `Piloto automático: ${autoPilotSummary(report)} → ${report.videoPath}`;
  }

  async function createProjectNamed(name: string): Promise<string> {
    const clean = name.trim().slice(0, 60);
    if (!clean) return 'Decime cómo se llama el proyecto.';
    const created = await store.createProject({
      name: clean,
      width: 1920,
      height: 1080,
      fpsNum: 30,
      fpsDen: 1,
    });
    if (!created) return 'No pude crear el proyecto.';
    onSelect('editor');
    return `Proyecto «${clean}» creado (1920×1080 a 30 fps).`;
  }

  /** Atajo: ejecuta un comando local sin pasar por el modelo. */
  async function runQuick(command: string): Promise<void> {
    if (busy) return;
    append({ role: 'user', text: command });
    try {
      const reply = await runLocalCommand(command);
      append({ role: 'assistant', text: reply });
      flashReply();
    } catch (error) {
      append({
        role: 'assistant',
        text: error instanceof Error ? error.message : 'no pude ejecutar la acción',
      });
    }
  }

  /**
   * Puente para plugins y skills: cualquier parte de la app puede pedir un
   * comando con `window.dispatchEvent(new CustomEvent('olyvia:run-command'))`.
   * Se ejecuta con el mismo operador local que el chat, sin pasar por el modelo.
   */
  useEffect(() => {
    const handler = (event: Event): void => {
      const detail = (event as CustomEvent<{ text?: unknown }>).detail;
      const text = typeof detail?.text === 'string' ? detail.text.trim() : '';
      if (!text) return;
      void (async () => {
        append({ role: 'user', text });
        try {
          const reply = await runLocalCommand(text);
          append({ role: 'assistant', text: reply });
          flashReply();
        } catch (error) {
          append({
            role: 'assistant',
            text: error instanceof Error ? error.message : 'no pude ejecutar el comando',
          });
        }
      })();
    };
    window.addEventListener('olyvia:run-command', handler);
    return () => window.removeEventListener('olyvia:run-command', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

  async function runLocalCommand(text: string): Promise<string> {
    const action = parseOperatorCommand(text, NAV_VIEWS);
    if (action.kind === 'unknown') {
      return 'No reconocí ese comando. Probá «cortá los silencios», «limpiá el video», «piloto automático» o «subtitulá el clip».';
    }
    return executeOperator(action);
  }

  /** Arranca el servidor MCP y devuelve la configuración para el cliente. */
  async function startMcp(): Promise<string> {
    const info = await store.service.startMcpServer();
    const config = {
      mcpServers: {
        olyvia: {
          type: 'http',
          url: info.url,
          headers: { Authorization: `Bearer ${info.token}` },
        },
      },
    };
    return [
      `Servidor MCP escuchando en ${info.url}`,
      'Pegá este bloque en Claude Desktop (claude_desktop_config.json) o en Cursor:',
      '```json',
      JSON.stringify(config, null, 2),
      '```',
      'Herramientas: proyectos, timeline, clips, pistas, subtitulos, automatizaciones, navegacion y render.',
    ].join('\n');
  }

  async function executeOperator(action: Exclude<OperatorAction, { kind: 'unknown' }>): Promise<string> {
    switch (action.kind) {
      case 'brain':
        return brainEdit(action.mode);
      case 'navigate':
        return navigate(action.view, action.label);
      case 'media_folder':
        return mountMediaFolder(action.folder);
      case 'play':
        store.setPlaying(true);
        return 'Reproduciendo.';
      case 'pause':
        store.setPlaying(false);
        return 'Pausado.';
      case 'undo':
        store.undo();
        return 'Deshice el último cambio.';
      case 'redo':
        store.redo();
        return 'Rehice el cambio.';
      case 'save':
        return (await store.saveNow()) ? 'Proyecto guardado.' : 'No hay un proyecto abierto para guardar.';
      case 'export':
        if (activeId !== 'editor') onSelect('editor');
        store.requestExport();
        return 'Abrí el diálogo de exportación.';
      case 'status': {
        const project = store.state.project;
        if (!project) return 'No hay un proyecto abierto.';
        return `${project.name}: ${project.timeline.clips.length} clip(s), playhead ${store.getPlayhead()}, ${fpsOf(project).toFixed(0)} fps.`;
      }
      case 'create':
        window.localStorage.setItem('editoria.factory.brief', action.topic);
        onSelect('factory');
        return `Brief «${action.topic}» enviado a Fábrica.`;
      case 'new_project':
        return createProjectNamed(action.name);
      case 'import_file':
        return importFileFromDisk(action.path);
      case 'download_url':
        queueDownloadUrl(action.url);
        onSelect('download');
        return `Envié la URL a Descargar. Revisá el formato y confirmá el pedido.`;
      case 'add_clip':
        return addClipByLabel(action.asset, action.atPlayhead);
      case 'delete_selected':
        return deleteSelection();
      case 'split_at_playhead':
        return splitSelection();
      case 'goto':
        return goTo(action.seconds);
      case 'add_caption':
        return addCaptionNow(action.text, action.seconds);
      case 'set_speed':
        return changeSpeed(action.speed);
      case 'set_gain':
        return changeGain(action.db);
      case 'mute_clip':
        return setClipMuted(action.muted);
      case 'cut_silences':
        return cutSilences(action);
      case 'auto_subtitles':
        return autoSubtitles(action);
      case 'cut_voice_pauses':
        return cutVoicePauses(action);
      case 'auto_cleanup':
        return autoCleanup(action);
      case 'auto_pilot':
        return autoPilot();
      case 'mcp_server':
        return startMcp();
      case 'help':
        return OPERATOR_HELP;
      case 'motion': {
        const project = store.state.project;
        if (!project) return 'Abrí o creá un proyecto para agregar un gráfico.';
        const props = motionProps(action.templateId, action.text, action.secondary);
        if (!props) return 'La plantilla de motion no es válida.';
        let clipId: string | null = null;
        const ok = store.mutate(
          (current) => {
            const added = addMotionGraphic(current, {
              templateId: action.templateId,
              templateVersion: '1.0.0',
              props,
              durationFrames: Math.max(1, Math.round(fpsOf(current) * 3)),
              atFrame: store.getPlayhead(),
              label: action.text.slice(0, 80),
            });
            clipId = added.clipId;
            return { project: added.project };
          },
          { notice: `Gráfico agregado: ${action.text}.` },
        );
        if (!ok || !clipId) return 'El gráfico no deja el proyecto en un estado válido.';
        store.setSelection({ kind: 'clip', id: clipId });
        onSelect('editor');
        return `Gráfico agregado: ${action.text}.`;
      }
    }
  }

  /**
   * Delega la edición al cerebro: la app mide y corta, el asistente sólo pide.
   * Es la diferencia entre "la IA adivina el corte" y "la IA pide el corte".
   */
  function brainEdit(mode: 'safe' | 'all' | 'report'): string {
    const project = store.state.project;
    if (!project) return 'No hay un proyecto abierto para analizar.';
    const plan = planEdits(project, { intent: assistantIntent() });
    if (mode === 'report') return brainBrief(plan);
    const outcome =
      mode === 'all'
        ? applyProposals(project, plan.proposals)
        : applySafeProposals(project, plan);
    if (outcome.applied.length > 0) store.update(() => outcome.project);
    if (outcome.applied.length === 0) {
      return `${outcome.summary} El cerebro no encontró nada que aplicar (salud ${plan.score.now}/100).`;
    }
    return `${outcome.summary} Salud ${plan.score.now} → ${plan.score.potential}/100.`;
  }

  function mcpActionNeedsConfirmation(tool: string): boolean {
    const definition = MCP_TOOL_BY_NAME.get(tool);
    if (!definition || definition.annotations?.readOnlyHint === true) return false;
    return (
      definition.annotations?.destructiveHint === true ||
      definition.annotations?.openWorldHint === true
    );
  }

  function mcpContext(): McpToolContext {
    return {
      store,
      selectView: (view) => {
        const target = NAV_VIEWS.find((item) => item.id === view);
        if (target) onSelect(target.id);
      },
      runCommand: async (command) => {
        const parsed = parseOperatorCommand(command, NAV_VIEWS);
        if (parsed.kind === 'unknown') throw new Error('no reconocí el comando del operador');
        return executeOperator(parsed);
      },
    };
  }

  function compactMcpResult(result: string): string {
    const normalized = result.trim();
    return normalized.length > 1_200
      ? `${normalized.slice(0, 1_200)}… (resultado recortado)`
      : normalized;
  }

  async function confirmPendingMcpCall(): Promise<void> {
    const pending = pendingMcpCall;
    setPendingMcpCall(null);
    if (!pending) return;
    const definition = MCP_TOOL_BY_NAME.get(pending.tool);
    if (!definition) {
      append({ role: 'assistant', text: `La herramienta MCP «${pending.tool}» ya no existe en el catálogo.` });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await executeMcpTool(pending.tool, pending.arguments, mcpContext());
      append({
        role: 'assistant',
        text: `${definition.annotations?.title ?? pending.tool}: ${compactMcpResult(result)}`,
      });
      flashReply();
    } catch (cause) {
      append({
        role: 'assistant',
        text: cause instanceof Error ? `No se pudo ejecutar ${pending.tool}: ${cause.message}` : `No se pudo ejecutar ${pending.tool}.`,
      });
    } finally {
      setBusy(false);
    }
  }

  async function runAssistantAction(action: AssistantAction): Promise<string | null> {
    if (action.kind === 'mcp_call') {
      const definition = MCP_TOOL_BY_NAME.get(action.tool);
      if (!definition) return `Herramienta MCP desconocida: «${action.tool}».`;
      try {
        const argumentsValue = validateMcpToolArguments(action.tool, action.arguments);
        const result = await executeMcpTool(action.tool, argumentsValue, mcpContext());
        return `${definition.annotations?.title ?? action.tool}: ${compactMcpResult(result)}`;
      } catch (cause) {
        return cause instanceof Error
          ? `No ejecuté ${definition.annotations?.title ?? action.tool}: ${cause.message}`
          : `No ejecuté ${definition.annotations?.title ?? action.tool}.`;
      }
    }
    if (action.kind === 'brain') {
      return brainEdit(action.mode);
    }
    if (action.kind === 'media_folder') {
      return mountMediaFolder(action.folder);
    }
    if (action.kind === 'new_project') {
      return createProjectNamed(action.name);
    }
    if (action.kind === 'import_file') {
      return importFileFromDisk(action.path);
    }
    if (action.kind === 'download_url') {
      queueDownloadUrl(action.url);
      onSelect('download');
      return 'Envié la URL a Descargar.';
    }
    if (action.kind === 'add_clip') {
      return addClipByLabel(action.asset, action.atPlayhead);
    }
    if (action.kind === 'delete_selected') {
      // Borrar lo que pidió un modelo no se ejecuta solo: espera confirmación.
      const selection = store.state.selection;
      const target =
        selection.kind === 'clip'
          ? 'el clip seleccionado'
          : selection.kind === 'cue'
            ? 'el subtítulo seleccionado'
            : selection.kind === 'track'
              ? 'la pista seleccionada'
              : null;
      if (!target) {
        return 'No hay nada seleccionado para borrar.';
      }
      setPendingDelete(target);
      return `Quiero borrar ${target}. Confirmá abajo para que se ejecute; podés deshacer después.`;
    }
    if (action.kind === 'split_at_playhead') {
      return splitSelection();
    }
    if (action.kind === 'goto') {
      return goTo(action.seconds);
    }
    if (action.kind === 'add_caption') {
      return addCaptionNow(action.text, action.seconds);
    }
    if (action.kind === 'set_speed') {
      return changeSpeed(action.speed);
    }
    if (action.kind === 'set_gain') {
      return changeGain(action.db);
    }
    if (action.kind === 'mute_clip') {
      return setClipMuted(action.muted);
    }
    if (action.kind === 'cut_silences') {
      return cutSilences(action);
    }
    if (action.kind === 'auto_subtitles') {
      return autoSubtitles(action);
    }
    if (action.kind === 'cut_voice_pauses') {
      return cutVoicePauses(action);
    }
    if (action.kind === 'auto_cleanup') {
      return autoCleanup(action);
    }
    if (action.kind === 'auto_pilot') {
      return autoPilot();
    }
    if (action.kind === 'navigate') {
      navigate(action.view);
      return null;
    }
    if (action.kind === 'play' || action.kind === 'pause') {
      store.setPlaying(action.kind === 'play');
      return null;
    }
    if (action.kind === 'undo') {
      store.undo();
      return null;
    }
    if (action.kind === 'redo') {
      store.redo();
      return null;
    }
    if (action.kind === 'save') {
      await store.saveNow();
      return null;
    }
    if (action.kind === 'export') {
      if (activeId !== 'editor') onSelect('editor');
      store.requestExport();
      return null;
    }
    if (action.kind === 'status') {
      return null;
    }
    if (action.kind === 'motion') {
      const project = store.state.project;
      if (!project) return null;
      const props = motionProps(action.templateId, action.text, action.secondary);
      if (!props) return null;
      let clipId: string | null = null;
      const ok = store.mutate((current) => {
        const added = addMotionGraphic(current, {
          templateId: action.templateId,
          templateVersion: '1.0.0',
          props,
          durationFrames: Math.max(1, Math.round(fpsOf(current) * 3)),
          atFrame: store.getPlayhead(),
          label: action.text.slice(0, 80),
        });
        clipId = added.clipId;
        return { project: added.project };
      });
      if (ok && clipId) {
        store.setSelection({ kind: 'clip', id: clipId });
        onSelect('editor');
      }
    }
    return null;
  }

  /** El formato del primer perfil de entrega decide el ritmo que se propone. */
  function assistantIntent(): EditIntent {
    const aspect = store.state.project?.renderProfiles[0]?.aspectRatio;
    if (aspect === '9:16') return 'short';
    if (aspect === '1:1') return 'reel';
    return 'tighten';
  }

  async function send(): Promise<void> {
    const text = input.trim();
    if (!text || busy) return;
    if (pendingDelete || pendingMcpCall) {
      setError('Primero confirmá o cancelá la operación pendiente.');
      return;
    }
    if (needsConsent && !consent) {
      setError('Marcá “Permitir llamada remota” para usar el proveedor configurado.');
      return;
    }
    setInput('');
    setError(null);
    setProviderTest(null);
    setProviderTestFailure(null);
    setStreamBuffer(null);
    append({ role: 'user', text });

    const local = parseOperatorCommand(text, NAV_VIEWS);
    if (local.kind !== 'unknown') {
      const longRunning = local.kind === 'media_folder';
      if (longRunning) setBusy(true);
      try {
        const reply = await executeOperator(local);
        append({ role: 'assistant', text: reply });
      } catch (cause) {
        append({
          role: 'assistant',
          text: cause instanceof Error ? cause.message : 'No pude ejecutar el comando.',
        });
      } finally {
        if (longRunning) {
          setBusy(false);
          setBusyLabel(null);
        }
      }
      flashReply();
      return;
    }

    setBusy(true);
    try {
      const projectContext = store.state.project
        ? {
            projectName: store.state.project.name,
            clips: store.state.project.timeline.clips.length,
            playheadFrame: store.getPlayhead(),
            fps: Number(fpsOf(store.state.project).toFixed(2)),
            view: activeId,
            // El cerebro mide la timeline y entrega el brief listo: el modelo
            // elige entre propuestas concretas en vez de inventar cortes.
            brain: brainBrief(planEdits(store.state.project, { intent: assistantIntent() })),
          }
        : { view: activeId };
      const context = {
        ...projectContext,
        // El proveedor recibe las definiciones JSON Schema exactas; la IA
        // puede elegir una herramienta real y la app valida antes de invocarla.
        mcpTools: MCP_TOOLS.map(({ name, description, inputSchema, annotations }) => ({
          name,
          description: description.slice(0, 220),
          inputSchema,
          annotations: {
            readOnly: annotations?.readOnlyHint === true,
            destructive: annotations?.destructiveHint === true,
            openWorld: annotations?.openWorldHint === true,
          },
        })),
      };
      const history = [...messages, { role: 'user' as const, text }]
        .filter((entry) => entry.text !== GREETING.text)
        .slice(-12)
        .map((entry) => ({ role: entry.role, content: entry.text }));
      const result = await requestAssistantReply({
        messages: history,
        context,
        approvedCost: consent,
      });
      // Compatibilidad: proveedores/servidores anteriores sólo envían `action`.
      // El backend nuevo envía `actions` ya saneadas y ordenadas.
      const actions = (
        result.actions?.length
          ? result.actions
          : result.action
            ? [result.action]
            : []
      ).slice(0, 5);
      const summaries: string[] = [];
      for (const [index, action] of actions.entries()) {
        if (action.kind === 'mcp_call' && mcpActionNeedsConfirmation(action.tool)) {
          const definition = MCP_TOOL_BY_NAME.get(action.tool);
          try {
            validateMcpToolArguments(action.tool, action.arguments);
            if (definition) {
              setPendingMcpCall({ tool: action.tool, arguments: action.arguments });
              summaries.push(
                `«${definition.annotations?.title ?? action.tool}» necesita confirmación por su nivel de riesgo. Detuve el resto del plan hasta que autorices o canceles esta herramienta.`,
              );
            } else {
              summaries.push(`Herramienta MCP desconocida: «${action.tool}».`);
            }
          } catch (cause) {
            summaries.push(
              cause instanceof Error ? `No ejecuté ${action.tool}: ${cause.message}` : `No ejecuté ${action.tool}.`,
            );
          }
          break;
        }

        const summary = await runAssistantAction(action);
        if (summary) summaries.push(summary);

        // El borrado abre una confirmación. No se ejecuta ninguna acción que
        // venga detrás hasta que la persona confirme esa operación.
        if (action.kind === 'delete_selected') {
          if (index < actions.length - 1) {
            summaries.push('Detuve el resto del plan: primero tenés que confirmar el borrado.');
          }
          break;
        }
      }

      append({ role: 'assistant', text: result.reply });
      if (summaries.length > 0) {
        append({ role: 'assistant', text: summaries.join('\n') });
      }
      if (actions.length === 0 && claimsCompletion(result.reply)) {
        append({
          role: 'assistant',
          text: 'Ojo: no ejecuté ningún cambio, el modelo no devolvió una acción. Probá «limpiá el video», «cortá los silencios» o usá los botones rápidos.',
        });
      }
      flashReply();
    } catch (cause) {
      if (cause instanceof AssistantStreamStopped) {
        append({
          role: 'assistant',
          text: 'Respuesta detenida por vos. Podés volver a pedirla cuando quieras.',
        });
        flashReply();
      } else {
        setError(cause instanceof Error ? cause.message : 'no se pudo contactar al asistente');
      }
    } finally {
      setStreamBuffer(null);
      setStreaming(false);
      setBusy(false);
    }
  }

  async function confirmPendingDelete(): Promise<void> {
    const target = pendingDelete;
    setPendingDelete(null);
    if (!target) return;
    try {
      append({ role: 'assistant', text: await deleteSelection() });
      flashReply();
    } catch (cause) {
      append({
        role: 'assistant',
        text: cause instanceof Error ? cause.message : 'No pude borrar la selección.',
      });
    }
  }

  function quick(text: string): void {
    setInput(text);
    setError(null);
    setProviderTest(null);
    setProviderTestFailure(null);
  }

  return (
    <>
      {open ? (
        <section
          id="olyvia-assistant-panel"
          className="assistant-panel"
          role="dialog"
          aria-label="Asistente Olyvia"
        >
          <header className="assistant-head">
            <div className="assistant-identity">
              <PetCompanion mood={mood} />
              <div>
                <strong>Olyvia Assistant</strong>
                <span>
                  {provider
                    ? provider.kind === 'mock'
                      ? 'Modo simulado · sin red'
                      : providerLabel
                    : 'Proveedor no consultado'}
                </span>
              </div>
            </div>
            <button
              type="button"
              className="icon-button"
              aria-label="Cerrar asistente"
              onClick={toggleOpen}
            >
              <Icon name="close" size={15} />
            </button>
          </header>

          <div className="assistant-model-bar">
            <AiBrandMark
              brand={brand}
              size={26}
              title={`Modelo en uso: ${provider?.model || 'sin modelo'}`}
            />
            <div className="assistant-model-info">
              {modelChoices.length > 1 ? (
                <select
                  className="assistant-model-select"
                  value={provider?.model ?? ''}
                  aria-label="Modelo en uso"
                  disabled={busy || !provider}
                  onChange={(event) => void switchModel(event.target.value)}
                >
                  {modelChoices.map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                </select>
              ) : (
                <strong>{provider?.model || 'sin modelo'}</strong>
              )}
              <span>{providerLabel}</span>
            </div>
            <span
              className={`assistant-model-chip ${providerStatus}`}
              title={
                providerStatus === 'sim'
                  ? 'El proveedor simulado no hace red'
                  : providerStatus === 'local'
                    ? 'Corre en esta máquina'
                    : 'Llamada a un servicio remoto: puede gastar cuota'
              }
            >
              {providerStatus === 'sim'
                ? 'simulado'
                : providerStatus === 'local'
                  ? 'local'
                  : providerStatus === 'remote'
                    ? 'remoto'
                    : '—'}
            </span>
          </div>

          <div className="assistant-log" role="log" aria-live="polite" ref={logRef}>
            {messages.map((entry, index) => (
              <p key={`${entry.role}-${index}`} className={`assistant-message ${entry.role}`}>
                {entry.text}
              </p>
            ))}
            {busy ? (
              streamBuffer === null ? (
                <p className="assistant-message assistant">{busyLabel ?? 'Pensando…'}</p>
              ) : (
                <p className="assistant-message assistant assistant-streaming">
                  {streamPreview || '…'}
                </p>
              )
            ) : null}
          </div>

          {error ? (
            <div className="assistant-error-recovery">
              <p className="assistant-error" role="alert">
                {error}
              </p>
              <div className="actions compact" role="group" aria-label="Recuperar proveedor">
                <button
                  type="button"
                  className="small ghost"
                  disabled={busy || testingProvider}
                  onClick={() => void probeProvider()}
                >
                  {testingProvider ? 'Probando…' : 'Probar proveedor'}
                </button>
                <button
                  type="button"
                  className="small ghost"
                  disabled={busy}
                  onClick={() => onSelect('settings')}
                >
                  Abrir Ajustes
                </button>
              </div>
              {providerTest ? (
                <p
                  className={`notice ${providerTest.ok ? 'notice-notice' : 'notice-warning'}`}
                  role="status"
                >
                  {providerTest.ok
                    ? `Conexión correcta en ${providerTest.latencyMs} ms`
                    : 'El proveedor no respondió correctamente'}
                  {' · '}
                  {providerTest.detail}
                </p>
              ) : null}
              {providerTestFailure ? (
                <p className="notice notice-warning" role="status">
                  {providerTestFailure}
                </p>
              ) : null}
            </div>
          ) : null}

          {pendingMcpCall ? (
            <div className="assistant-confirm" role="alertdialog" aria-label="Confirmar acción MCP">
              <p>
                La IA solicita ejecutar <strong>{MCP_TOOL_BY_NAME.get(pendingMcpCall.tool)?.annotations?.title ?? pendingMcpCall.tool}</strong>.
              </p>
              <p>
                {MCP_TOOL_BY_NAME.get(pendingMcpCall.tool)?.description ?? 'Operación del catálogo MCP.'}
              </p>
              <p>Esta herramienta está marcada como operación de riesgo. No se ejecutó todavía.</p>
              <div className="actions compact">
                <button
                  type="button"
                  className="primary"
                  disabled={busy}
                  onClick={() => void confirmPendingMcpCall()}
                >
                  Sí, ejecutar
                </button>
                <button
                  type="button"
                  className="ghost"
                  disabled={busy}
                  onClick={() => setPendingMcpCall(null)}
                >
                  No, cancelar
                </button>
              </div>
            </div>
          ) : null}

          {pendingDelete ? (
            <div className="assistant-confirm" role="alertdialog" aria-label="Confirmar borrado">
              <p>
                La IA quiere borrar {pendingDelete}. ¿Lo ejecuto?
              </p>
              <div className="actions compact">
                <button
                  type="button"
                  className="primary"
                  onClick={() => void confirmPendingDelete()}
                >
                  Sí, borrar
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => setPendingDelete(null)}
                >
                  No, cancelar
                </button>
              </div>
            </div>
          ) : null}

          <div className="assistant-quick" role="group" aria-label="Acciones rápidas">
            <button type="button" onClick={() => quick('abrir editor')}>Editor</button>
            <button type="button" onClick={() => quick('estado')}>Estado</button>
            <button type="button" onClick={() => quick('guardar')}>Guardar</button>
            <button type="button" onClick={() => quick('exportar')}>Exportar</button>
          </div>

          {needsConsent ? (
            <label className="assistant-consent">
              <input
                type="checkbox"
                checked={consent}
                onChange={(event) => setConsent(event.target.checked)}
              />
              <span>Permitir llamada remota (puede consumir cuota)</span>
            </label>
          ) : null}

          <div className="assistant-quick" role="group" aria-label="Acciones rápidas">
            {QUICK_ACTIONS.map((action) => (
              <button
                key={action.command}
                type="button"
                className="small ghost"
                disabled={busy}
                onClick={() => void runQuick(action.command)}
              >
                {action.label}
              </button>
            ))}
          </div>

          {busy && streaming ? (
            <div className="actions compact">
              <button type="button" className="ghost small" onClick={stopStreaming}>
                Detener respuesta
              </button>
            </div>
          ) : null}

          <p
            className={`fine-print assistant-token-budget${tokenBudgetExceeded ? ' exceeded' : ''}`}
            title="Estimación aproximada de 4 caracteres por token; no incluye el contexto del proyecto"
          >
            ≈ {tokenEstimate.toLocaleString('es-AR')} tokens en la conversación · aviso en{' '}
            {tokenBudget.toLocaleString('es-AR')}
            {tokenBudgetExceeded
              ? ' · superaste el aviso configurado; podés acortar el mensaje o cambiarlo en Ajustes → IA.'
              : ''}
          </p>

          <form
            className="assistant-composer"
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
              rows={2}
              maxLength={800}
              autoFocus
              aria-label="Mensaje para Olyvia"
              placeholder="Pedile algo a Olyvia…"
              onFocus={() => setListening(true)}
              onBlur={() => setListening(false)}
            />
            <button
              type="submit"
              className="primary"
              aria-label="Enviar mensaje"
              disabled={busy || !input.trim() || Boolean(pendingDelete) || Boolean(pendingMcpCall)}
            >
              <Icon name="send" size={15} />
            </button>
          </form>

          <footer className="assistant-foot">
            <span className="assistant-foot-model">
              <AiBrandMark brand={brand} size={13} />
              <span>{provider?.model || 'sin modelo'}</span>
            </span>
            <button type="button" className="link" onClick={() => onSelect('settings')}>
              Configurar proveedor
            </button>
          </footer>
        </section>
      ) : null}

      <button
        type="button"
        className="assistant-launcher"
        data-tour="ai-dock"
        aria-label={open ? 'Cerrar asistente Olyvia' : 'Abrir asistente Olyvia'}
        aria-expanded={open}
        aria-controls="olyvia-assistant-panel"
        title="Olyvia Assistant"
        onClick={toggleOpen}
      >
        <Icon name={open ? 'close' : 'chat'} size={20} />
      </button>
    </>
  );
}
