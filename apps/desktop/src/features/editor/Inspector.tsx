import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../../components/Icon';
import type { Asset, AssetProxy, BlendMode, CaptionCue, CaptionMotionPreset, ChromaKey, Clip, ClipAnimation, ClipEffects, ClipMask, ClipMotion, ClipTransition, KeyframeEasing, ProjectDocument, Scene, Track } from '@editor-ia/project-schema';
import { MARKER_COLORS, MAX_MARKERS, type MarkerColor } from '@editor-ia/project-schema';
import {
  addMarker,
  chaptersFromMarkers,
  clearMarkers,
  deleteMarker,
  formatMarkerChapters,
  markersFromScenes,
  updateMarker,
  validateChapters,
} from '../../state/markers';
import { friendlyAssetLabel } from '../../state/asset-labels';
import { AUDIO_PRESETS, type AudioPresetId } from '../../state/audio-presets';
import {
  EFFECT_PRESETS,
  applyEffectPreset,
  type EffectPreset,
} from '../../state/effect-presets';
import {
  SPEED_RAMP_PRESETS,
  applySpeedRampPreset,
} from '../../state/speed-ramp-presets';
import { CLIP_COLORS } from '../../state/clip-colors';
import { MotionClipInspector } from '../motion/MotionClipInspector';
import { polygonAroundCenter } from '../vfx/face-mask';
import { captionMotionPreset } from '../../state/caption-motion';
import { parseSubtitles, serializeSrt } from '../../state/subtitles';
import { EmojiPickerButton } from '../emoji/EmojiPicker';
import { insertEmoji } from '../emoji/emoji';
import { KeyframeCurveEditor } from './KeyframeCurveEditor';
import {
  addAsset,
  addCaptionCue,
  addClipFromAsset,
  addTitleCue,
  applyAudioPresetToAll,
  applyFaceCenter,
  applyTransitionToCuts,
  importSubtitleCues,
  addTranscriptionCues,
  applySpeedCurve,
  applySpeedRamp,
  captureTransformKeyframe,
  clearGainKeyframes,
  clearMaskKeyframes,
  clearTransformKeyframes,
  clipGainAtFrame,
  clipTransformAtFrame,
  closeGaps,
  createCompound,
  deleteCaptionCue,
  deleteClip,
  deleteTrack,
  detachAudio,
  ensureDelivery,
  expandCompound,
  formatTimecode,
  fpsOf,
  freezeFrameInPlace,
  markAssetReady,
  markAssetReadyFrom,
  moveClip,
  moveTrack,
  removeAsset,
  removeGainKeyframe,
  removeMaskKeyframe,
  removeTransformKeyframe,
  replaceClipWithDerivedAsset,
  rollClip,
  setClipSpeed,
  setClipStabilization,
  setSlowMotionSmoothing,
  slideClip,
  slipClip,
  setAssetProxy,
  setProjectLook,
  setGainKeyframe,
  setMaskKeyframe,
  setTransformKeyframe,
  splitClip,
  splitClipAtFrames,
  splitClipsAtMarkers,
  splitTrackAtFrames,
  trimClip,
  updateAssetLabel,
  updateAssetMetadata,
  updateAudioMix,
  updateCaptionCue,
  updateCaptionStyle,
  updateClip,
  updateProjectLook,
  updateProjectSettings,
  totalFrames,
  updateTrack,
} from '../../state/project-actions';
import { useProjectStore } from '../../state/project-store';
import { detectBeats, decodeAudioSamples, planBeatCuts, type BeatAnalysis } from '../../state/beat-sync';
import {
  FPS_PRESETS,
  FORMAT_PRESETS,
  aspectRatioOf,
  formatFps,
} from '../../state/video-format';

function NumberField({
  label,
  value,
  min,
  max,
  step = 1,
  disabled = false,
  onCommit,
}: {
  readonly label: string;
  readonly value: number;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly disabled?: boolean;
  readonly onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => {
    setDraft(String(value));
  }, [value]);
  function commit(): void {
    const numeric = Number(draft);
    if (Number.isFinite(numeric)) {
      const clamped =
        min !== undefined || max !== undefined
          ? Math.max(min ?? -Infinity, Math.min(max ?? Infinity, numeric))
          : numeric;
      onCommit(clamped);
    } else {
      setDraft(String(value));
    }
  }
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        value={draft}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
          }
        }}
      />
    </label>
  );
}

function TextField({
  label,
  value,
  onCommit,
  maxLength,
}: {
  readonly label: string;
  readonly value: string;
  readonly onCommit: (value: string) => void;
  readonly maxLength?: number;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    setDraft(value);
  }, [value]);
  function commit(): void {
    if (draft.trim()) onCommit(draft);
    else setDraft(value);
  }
  return (
    <label className="field">
      <span>{label}</span>
      <input
        value={draft}
        maxLength={maxLength}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
          }
        }}
      />
    </label>
  );
}

function TextAreaField({
  label,
  value,
  onCommit,
  maxLength,
  rows = 3,
  emoji = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly onCommit: (value: string) => void;
  readonly maxLength?: number;
  readonly rows?: number;
  readonly emoji?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    setDraft(value);
  }, [value]);
  function commit(): void {
    if (draft.trim()) onCommit(draft);
    else setDraft(value);
  }
  function insertEmojiAtCursor(emojiValue: string): void {
    const field = ref.current;
    const next = insertEmoji(
      draft,
      emojiValue,
      field?.selectionStart ?? draft.length,
      field?.selectionEnd ?? draft.length,
    );
    setDraft(next.value);
    onCommit(next.value);
    window.requestAnimationFrame(() => {
      const current = ref.current;
      if (!current) return;
      current.focus();
      current.setSelectionRange(next.cursor, next.cursor);
    });
  }
  return (
    <label className="field">
      <span className="field-label-row">
        <span>{label}</span>
        {emoji ? <EmojiPickerButton onPick={insertEmojiAtCursor} label={`Insertar emoji en ${label}`} /> : null}
      </span>
      <textarea
        ref={ref}
        className="emoji-capable"
        rows={rows}
        value={draft}
        maxLength={maxLength}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
      />
    </label>
  );
}

function Section({
  title,
  children,
  group,
}: {
  readonly title: string;
  readonly children: ReactNode;
  readonly group?: 'video' | 'audio' | 'speed' | 'trim' | 'animation' | 'color' | 'style';
}) {
  return (
    <section className="inspector-section" data-group={group}>
      <h4>{title}</h4>
      {children}
    </section>
  );
}

function clipKindLabel(kind: Clip['kind']): string {
  return {
    video: 'Video',
    image: 'Imagen',
    audio: 'Audio',
    graphic: 'Gráfico',
    adjustment: 'Ajuste',
    freeze: 'Congelado',
    compound: 'Compuesto',
  }[kind];
}

function trackKindLabel(kind: Track['kind']): string {
  return {
    video: 'Video',
    image: 'Imagen',
    audio: 'Audio',
    narration: 'Narración',
    caption: 'Subtítulos',
    graphic: 'Gráficos',
    adjustment: 'Ajustes',
  }[kind];
}

function assetKindLabel(kind: Asset['kind']): string {
  return { video: 'Video', image: 'Imagen', audio: 'Audio', font: 'Fuente', text: 'Texto' }[kind];
}

function assetStatusLabel(status: Asset['status']): string {
  return { ready: 'listo', unverified: 'sin verificar', missing: 'faltante', failed: 'fallido' }[
    status
  ];
}

function mediaInfo(asset: Asset): string {
  if (asset.kind === 'video' && asset.media) {
    return `${asset.media.width}×${asset.media.height} · ${asset.media.durationFrames} frames · ${asset.media.frameRate.num}/${asset.media.frameRate.den} fps`;
  }
  if (asset.kind === 'image' && asset.media) {
    return `${asset.media.width}×${asset.media.height}`;
  }
  if (asset.kind === 'audio' && asset.media) {
    return `${asset.media.sampleRate} Hz · ${asset.media.channels} canales · ${asset.media.durationFrames} frames`;
  }
  return 'sin medición';
}

const MARKER_COLOR_LABELS: Record<MarkerColor, string> = {
  mint: 'Menta',
  amber: 'Ámbar',
  rose: 'Rosa',
  blue: 'Azul',
  violet: 'Violeta',
  slate: 'Gris',
};

export const COLOR_LOOKS: readonly { readonly id: string; readonly label: string; readonly effects: ClipEffects }[] = [
  { id: 'neutral', label: 'Neutro', effects: {} },
  {
    id: 'warm',
    label: 'Cálido',
    effects: { temperature: 0.22, saturation: 1.08, contrast: 1.03 },
  },
  {
    id: 'cool',
    label: 'Frío',
    effects: { temperature: -0.22, saturation: 0.95, contrast: 1.04 },
  },
  {
    id: 'cinema',
    label: 'Cine',
    effects: {
      contrast: 1.14,
      saturation: 0.9,
      temperature: -0.05,
      vignette: 0.18,
      curvePreset: 'contrast-medium',
    },
  },
  {
    id: 'vintage',
    label: 'Vintage',
    effects: {
      sepia: true,
      saturation: 0.8,
      contrast: 1.05,
      vignette: 0.22,
      curvePreset: 'vintage',
    },
  },
  {
    id: 'mono',
    label: 'B/N',
    effects: { grayscale: true, contrast: 1.08 },
  },
];

type ClipTab = 'video' | 'audio' | 'speed' | 'trim' | 'animation' | 'color' | 'style' | 'all';

function ClipInspector(props: {
  clip: Clip;
  track: Track;
  project: ReturnType<typeof useProjectStore>['state']['project'];
}) {
  if (props.clip.kind === 'compound') {
    return <CompoundInspector clip={props.clip} project={props.project} />;
  }
  return <RegularClipInspector {...props} />;
}

function CompoundInspector({
  clip,
  project,
}: {
  clip: Extract<Clip, { kind: 'compound' }>;
  project: ReturnType<typeof useProjectStore>['state']['project'];
}) {
  const store = useProjectStore();
  const compound = (project?.compounds ?? []).find(
    (item) => item.id === clip.source.compoundId,
  );
  const inner = compound?.clips ?? [];
  return (
    <div className="clip-inspector">
      <Section title="Clip compuesto">
        <TextField
          label="Nombre"
          value={clip.label ?? ''}
          maxLength={200}
          onCommit={(value) =>
            store.update((current) => updateClip(current, clip.id, { label: value }))
          }
        />
        <p className="fine-print">
          Agrupa {inner.length} clip(s) que se mueven, se silencian y se ubican juntos. El
          render los aplana de vuelta a sus pistas originales.
        </p>
        <dl className="data-list compact">
          <div>
            <dt>Duración</dt>
            <dd>{clip.durationFrames} frames</dd>
          </div>
          <div>
            <dt>Clips internos</dt>
            <dd>{inner.length}</dd>
          </div>
        </dl>
        <div className="actions compact">
          <button
            type="button"
            className="small"
            onClick={() => {
              const ids = inner.map((item) => item.id);
              const result = store.mutate((current) => ({
                project: expandCompound(current, clip.id),
                ids,
              }));
              if (result?.ids[0]) {
                store.setSelection({ kind: 'clip', id: result.ids[0] });
              }
            }}
          >
            Deshacer compuesto
          </button>
        </div>
        {inner.length > 0 ? (
          <ul className="keyframe-list">
            {inner.map((item) => (
              <li key={item.id} className="fine-print">
                {item.label ?? item.kind} · {item.durationFrames} frames
              </li>
            ))}
          </ul>
        ) : null}
        <p className="fine-print">
          Mientras esté agrupado no se puede recortar ni dividir. Deshacelo para editar los
          clips internos y volvé a agrupar cuando quieras.
        </p>
      </Section>
    </div>
  );
}

function RegularClipInspector({ clip, track, project }: { clip: Clip; track: Track; project: ReturnType<typeof useProjectStore>['state']['project'] }) {
  const store = useProjectStore();
  const [tab, setTab] = useState<ClipTab>(
    clip.kind === 'audio' ? 'audio' : clip.kind === 'adjustment' ? 'color' : 'video',
  );
  const [sceneThreshold, setSceneThreshold] = useState(0.35);
  const [sceneCuts, setSceneCuts] = useState<number[]>([]);
  const [sceneBusy, setSceneBusy] = useState(false);
  const [transcribeBusy, setTranscribeBusy] = useState(false);
  const [transcribeInfo, setTranscribeInfo] = useState<string | null>(null);
  const [selectedKeyframe, setSelectedKeyframe] = useState<number | null>(null);
  const [rampFrom, setRampFrom] = useState(2);
  const [rampTo, setRampTo] = useState(0.5);
  const [trimDelta, setTrimDelta] = useState(1);
  const [curveSegments, setCurveSegments] = useState(8);
  const [beatAnalysis, setBeatAnalysis] = useState<BeatAnalysis | null>(null);
  const [beatBusy, setBeatBusy] = useState(false);
  const [beatStride, setBeatStride] = useState(4);
  const [beatInfo, setBeatInfo] = useState<string | null>(null);
  const [freezeBusy, setFreezeBusy] = useState(false);
  const [backgroundBusy, setBackgroundBusy] = useState(false);
  const [backgroundPercent, setBackgroundPercent] = useState<number | null>(null);
  const [stabilizeBusy, setStabilizeBusy] = useState(false);
  const [faceCenterBusy, setFaceCenterBusy] = useState(false);
  const [stabilizeSmoothing, setStabilizeSmoothing] = useState(10);
  const [stabilizeInfo, setStabilizeInfo] = useState<string | null>(null);
  const [matchRefId, setMatchRefId] = useState('');
  const [matchStrength, setMatchStrength] = useState(0.75);
  const [matchBusy, setMatchBusy] = useState(false);
  const [relightBusy, setRelightBusy] = useState(false);
  const [relightError, setRelightError] = useState<string | null>(null);
  const [effectPrompt, setEffectPrompt] = useState('');
  const [effectApproved, setEffectApproved] = useState(false);
  const [effectBusy, setEffectBusy] = useState(false);
  const [effectError, setEffectError] = useState<string | null>(null);
  useEffect(() => {
    setSceneCuts([]);
    setSceneBusy(false);
    setTranscribeInfo(null);
    setSelectedKeyframe(null);
    setBeatAnalysis(null);
    setBeatBusy(false);
    setBeatInfo(null);
    setStabilizeInfo(null);
    setStabilizeBusy(false);
    setFaceCenterBusy(false);
    setBackgroundBusy(false);
    setBackgroundPercent(null);
    setTrimDelta(1);
    setTab(clip.kind === 'audio' ? 'audio' : clip.kind === 'adjustment' ? 'color' : 'video');
  }, [clip.id, clip.kind]);
  if (!project) return null;
  const fps = fpsOf(project);
  const source = clip.source;
  const asset = source.type === 'asset' ? project.assets.find((item) => item.id === source.assetId) : undefined;
  const windowedSource = source.type === 'asset' && 'inFrame' in source ? source : undefined;
  const transform = clip.transform ?? {};
  const audio = clip.audio ?? {};
  const transitionIn =
    'transitionIn' in clip
      ? (
          clip as Clip & {
            transitionIn?: {
              type: ClipTransition['type'];
              frames: number;
            };
          }
        ).transitionIn
      : undefined;
  const reverse =
    'reverse' in clip ? Boolean((clip as Clip & { reverse?: boolean }).reverse) : false;
  const mask =
    'mask' in clip ? (clip as Clip & { mask?: ClipMask }).mask : undefined;
  const blendMode =
    'blendMode' in clip
      ? (clip as Clip & { blendMode?: BlendMode }).blendMode
      : undefined;
  const animationClip = clip as Clip & {
    animationIn?: ClipAnimation;
    animationOut?: ClipAnimation;
  };
  const canAnimate = clip.kind === 'video' || clip.kind === 'image' || clip.kind === 'freeze';
  const animationIn = canAnimate ? animationClip.animationIn : undefined;
  const animationOut = canAnimate ? animationClip.animationOut : undefined;
  const animationMax = Math.max(1, Math.min(240, clip.durationFrames));
  const localFrame = Math.max(
    0,
    Math.min(clip.durationFrames - 1, store.state.playheadFrame - clip.startFrame),
  );
  const maskKeyframe = mask?.keyframes?.find((keyframe) => keyframe.frame === localFrame);
  const maskView = {
    x: maskKeyframe?.x ?? mask?.x ?? 0,
    y: maskKeyframe?.y ?? mask?.y ?? 0,
    width: maskKeyframe?.width ?? mask?.width ?? 1,
    height: maskKeyframe?.height ?? mask?.height ?? 1,
    rotationDeg: maskKeyframe?.rotationDeg ?? mask?.rotationDeg ?? 0,
    feather: maskKeyframe?.feather ?? mask?.feather ?? 0.08,
  };
  const transformKeyframes = transform.keyframes ?? [];
  const gainKeyframes = audio.gainKeyframes ?? [];
  const selectedTransformKeyframe =
    selectedKeyframe === null
      ? null
      : transformKeyframes.find((keyframe) => keyframe.frame === selectedKeyframe) ?? null;
  const effects: ClipEffects = 'effects' in clip ? clip.effects ?? {} : {};
  const motion = 'motion' in clip ? clip.motion : undefined;
  const chromaKey = 'chromaKey' in clip ? clip.chromaKey : undefined;
  const motionType: ClipMotion['type'] | 'none' = motion?.type ?? 'none';
  function setMotion(next: ClipMotion | undefined): void {
    store.update((current) => updateClip(current, clip.id, { motion: next }));
  }
  function setChromaKey(next: ChromaKey | undefined): void {
    store.update((current) => updateClip(current, clip.id, { chromaKey: next }));
  }
  function patchAudio(patch: Partial<NonNullable<Clip['audio']>>): void {
    const next: Record<string, unknown> = { ...audio };
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) delete next[key];
      else next[key] = value;
    }
    store.update((current) =>
      updateClip(current, clip.id, { audio: next as NonNullable<Clip['audio']> }),
    );
  }
  function patchMask(patch: Partial<ClipMask>): void {
    const animatable =
      patch.x !== undefined ||
      patch.y !== undefined ||
      patch.width !== undefined ||
      patch.height !== undefined ||
      patch.rotationDeg !== undefined ||
      patch.feather !== undefined;
    if (maskKeyframe && animatable) {
      store.update((current) =>
        setMaskKeyframe(current, clip.id, localFrame, {
          x: patch.x ?? maskKeyframe.x,
          y: patch.y ?? maskKeyframe.y,
          width: patch.width ?? maskKeyframe.width,
          height: patch.height ?? maskKeyframe.height,
          rotationDeg: patch.rotationDeg ?? maskKeyframe.rotationDeg,
          feather: patch.feather ?? maskKeyframe.feather,
          ...(maskKeyframe.easing ? { easing: maskKeyframe.easing } : {}),
        }),
      );
      return;
    }
    const shape = (patch.shape ?? mask?.shape ?? 'rectangle') as ClipMask['shape'];
    const polygonPoints =
      shape === 'polygon' ? (patch.points ?? mask?.points) : undefined;
    const next: ClipMask = {
      shape,
      x: maskView.x,
      y: maskView.y,
      width: maskView.width,
      height: maskView.height,
      rotationDeg: maskView.rotationDeg,
      feather: maskView.feather,
      invert: mask?.invert ?? false,
      ...(polygonPoints ? { points: polygonPoints } : {}),
      ...(mask?.keyframes ? { keyframes: mask.keyframes } : {}),
      ...(mask?.text !== undefined ? { text: mask.text } : {}),
      ...(mask?.fontScale !== undefined ? { fontScale: mask.fontScale } : {}),
      ...patch,
    };
    store.update((current) => updateClip(current, clip.id, { mask: next }));
  }

  const speedFactor =
    clip.kind === 'video' || clip.kind === 'audio'
      ? (clip.speed?.num ?? 1) / (clip.speed?.den ?? 1)
      : 1;
  const lockedTrack = project.timeline.tracks.find((item) => item.id === clip.trackId)?.locked === true;
  const transitionFrames =
    'transitionIn' in clip
      ? (clip as Clip & { transitionIn?: { frames: number } }).transitionIn?.frames ?? 0
      : 0;
  const faceCenterBlockReason =
    clip.kind !== 'video'
      ? null
      : clip.reverse
        ? 'Quitá el reverse para seguir el rostro.'
        : clip.motion
          ? 'Quitá el movimiento Ken Burns: el seguimiento se calcula sobre el frame crudo.'
          : clip.stabilization
            ? 'Quitá la estabilización: mueve el encuadre y el seguimiento quedaría desfasado.'
            : (clip.transform?.keyframes?.length ?? 0) > 0
              ? 'Quitá los keyframes de transformación para que el seguimiento no los pise.'
              : null;
  async function freezeFrame(mode: 'track' | 'overlay'): Promise<void> {
    if (
      !project ||
      clip.kind !== 'video' ||
      !asset ||
      asset.source.type !== 'local' ||
      !windowedSource
    ) {
      return;
    }
    const atFrame = store.state.playheadFrame;
    const localFrame = Math.max(
      0,
      Math.min(clip.durationFrames - 1, atFrame - clip.startFrame),
    );
    const seconds = (windowedSource.inFrame + localFrame * speedFactor) / fps;
    setFreezeBusy(true);
    try {
      const frameAsset = await store.service.extractFreezeFrame({
        path: asset.source.path,
        seconds,
        fpsNum: project.video.frameRate.num,
        fpsDen: project.video.frameRate.den,
      });
      if (!frameAsset) return;
      const result = store.mutate((current) => {
        let next = addAsset(current, frameAsset);
        next = markAssetReady(next, frameAsset.id, 'allowed');
        const ready = next.assets.find((item) => item.id === frameAsset.id);
        if (!ready) throw new Error('el frame no quedó en la biblioteca');
        if (mode === 'track') {
          const frozen = freezeFrameInPlace(
            next,
            clip.id,
            atFrame,
            frameAsset.id,
            Math.max(1, Math.round(2 * fps)),
          );
          return { project: frozen.project, clipId: frozen.freezeClipId };
        }
        const added = addClipFromAsset(next, ready, {
          atFrame,
          durationFrames: Math.max(1, Math.round(2 * fps)),
        });
        return { project: added.project, clipId: added.clipId };
      });
      if (result) {
        store.setSelection({ kind: 'clip', id: result.clipId });
        store.setNotice(
          mode === 'track'
            ? 'Frame congelado: 2 s en la pista del video y el resto se corrió.'
            : 'Frame congelado: capa de 2 s agregada en el playhead.',
        );
      }
    } catch (error) {
      store.setNotice(
        error instanceof Error ? error.message : 'no se pudo congelar el frame',
      );
    } finally {
      setFreezeBusy(false);
    }
  }
  async function removeAutomaticBackground(): Promise<void> {
    if (!project || !asset) return;
    const kind =
      clip.kind === 'video'
        ? 'video'
        : clip.kind === 'image' || clip.kind === 'freeze'
          ? 'image'
          : null;
    if (!kind) return;
    if (lockedTrack) {
      store.setNotice(
        'La pista del clip está bloqueada; desbloqueala antes de recortar el fondo.',
      );
      return;
    }
    if (asset.status !== 'ready' || asset.rights.license.commercialUse === 'unknown') {
      store.setNotice(
        'Marcá los derechos del material original antes de recortarle el fondo.',
      );
      return;
    }
    if (kind === 'video' && !windowedSource) return;
    const windowStart = kind === 'video' ? windowedSource?.inFrame ?? 0 : 0;
    const windowEnd = kind === 'video' ? windowedSource?.outFrame ?? 0 : 0;
    // El render lee el pre-roll de la transición antes de `inFrame`, con el
    // mismo tope que `transition_lead_seconds`: duración del clip, inicio en
    // la timeline y 2 s. Se procesa ese tramo y el clip derivado arranca con
    // el mismo desplazamiento para no correr el contenido.
    const leadTimeline = Math.max(
      0,
      Math.min(
        transitionFrames,
        clip.durationFrames,
        clip.startFrame,
        Math.round(2 * fps),
      ),
    );
    const leadSource =
      kind === 'video' ? Math.max(0, Math.round(leadTimeline * speedFactor)) : 0;
    const availableStart = Math.max(0, windowStart - leadSource);
    const sourceOffset = windowStart - availableStart;
    const hadStabilization =
      kind === 'video' && 'stabilization' in clip && clip.stabilization !== undefined;
    setBackgroundBusy(true);
    setBackgroundPercent(kind === 'video' ? 0 : null);
    let unsubscribe: (() => void) | null = null;
    try {
      try {
        unsubscribe = await store.service.onBackgroundProgress((event) => {
          if (typeof event.percent === 'number') setBackgroundPercent(event.percent);
        });
      } catch {
        // Sin puente de eventos el progreso es opcional; el recorte continúa.
        unsubscribe = null;
      }
      const derived = await store.service.removeBackgroundAsset({
        path: asset.source.path,
        kind,
        inFrame: kind === 'video' ? availableStart : 0,
        outFrame: kind === 'video' ? windowEnd : 0,
        fpsNum: project.video.frameRate.num,
        fpsDen: project.video.frameRate.den,
      });
      const result = store.mutate((current) => {
        let next = addAsset(current, derived);
        next = markAssetReadyFrom(next, derived.id, asset.id);
        return {
          project: replaceClipWithDerivedAsset(next, clip.id, derived.id, {
            sourceOffset,
          }),
        };
      });
      if (result) {
        const stabilizationNote = hadStabilization
          ? ' Se quitó la estabilización porque el archivo cambió; volvé a analizarla.'
          : '';
        store.setNotice(
          kind === 'video'
            ? `Fondo quitado: el clip usa el recorte con transparencia y conserva su audio.${stabilizationNote}`
            : `Fondo quitado: el clip usa la versión con transparencia.${stabilizationNote}`,
        );
      }
    } catch (error) {
      store.setNotice(
        error instanceof Error ? error.message : 'no se pudo quitar el fondo',
      );
    } finally {
      unsubscribe?.();
      setBackgroundBusy(false);
      setBackgroundPercent(null);
    }
  }

  async function matchColor(): Promise<void> {
    if (!project) return;
    const reference = project.assets.find((item) => item.id === matchRefId);
    if (
      !reference ||
      !asset ||
      (reference.kind !== 'video' && reference.kind !== 'image') ||
      (asset.kind !== 'video' && asset.kind !== 'image')
    ) {
      return;
    }
    let sourceSeconds = 0;
    if (clip.kind === 'video' && windowedSource) {
      const localFrame = Math.max(
        0,
        Math.min(clip.durationFrames - 1, store.state.playheadFrame - clip.startFrame),
      );
      sourceSeconds = (windowedSource.inFrame + localFrame * speedFactor) / fps;
    }
    setMatchBusy(true);
    try {
      const [source, target] = await Promise.all([
        store.service.sampleAssetColor({
          path: asset.source.path,
          seconds: sourceSeconds,
        }),
        store.service.sampleAssetColor({
          path: reference.source.path,
          seconds: 0,
        }),
      ]);
      const safe = (value: number): number => Math.max(4, value);
      let r = target.r / safe(source.r);
      let g = target.g / safe(source.g);
      let b = target.b / safe(source.b);
      const average = (r + g + b) / 3;
      if (!Number.isFinite(average) || average < 0.02) {
        throw new Error('los frames son demasiado oscuros para igualar el color');
      }
      r /= average;
      g /= average;
      b /= average;
      const clamp = (value: number): number => Math.min(4, Math.max(0.25, value));
      setEffect('colorMatch', {
        r: clamp(r),
        g: clamp(g),
        b: clamp(b),
        strength: matchStrength,
      });
      store.setNotice(
        `Color igualado: ganancias R ${r.toFixed(2)} · G ${g.toFixed(2)} · B ${b.toFixed(2)}.`,
      );
    } catch (error) {
      store.setNotice(
        error instanceof Error ? error.message : 'no se pudo igualar el color',
      );
    } finally {
      setMatchBusy(false);
    }
  }
  const sceneTimelineCuts =
    clip.kind === 'video' && windowedSource
      ? sceneCuts
          .filter(
            (frame) =>
              frame > windowedSource.inFrame && frame < windowedSource.outFrame,
          )
          .map((frame) =>
            Math.round(
              clip.startFrame + (frame - windowedSource.inFrame) / Math.max(0.01, speedFactor),
            ),
          )
          .filter(
            (frame) => frame > clip.startFrame && frame < clip.startFrame + clip.durationFrames,
          )
      : [];

  async function analyzeScenes(): Promise<void> {
    if (!asset || asset.kind !== 'video') return;
    setSceneBusy(true);
    try {
      const result = await store.service.detectScenes(asset.id, sceneThreshold);
      setSceneCuts(result.cuts.map((cut) => cut.frame));
      store.setNotice(
        result.cuts.length > 0
          ? `${result.cuts.length} corte(s) de escena detectados en ${asset.label}.`
          : `${asset.label} no mostró cortes por encima de la sensibilidad elegida.`,
      );
    } catch (error) {
      store.setNotice(
        error instanceof Error ? error.message : 'no se pudieron detectar escenas',
      );
    } finally {
      setSceneBusy(false);
    }
  }

  function applySceneCuts(): void {
    if (sceneTimelineCuts.length === 0) return;
    store.update((current) => {
      const result = splitClipAtFrames(current, clip.id, sceneTimelineCuts);
      return result?.project ?? current;
    });
    store.setNotice(`Clip dividido en ${sceneTimelineCuts.length + 1} partes.`);
    setSceneCuts([]);
  }

  async function transcribeClip(): Promise<void> {
    if (!asset || (asset.kind !== 'audio' && asset.kind !== 'video')) return;
    setTranscribeBusy(true);
    setTranscribeInfo(null);
    try {
      const saved = await store.saveNow();
      if (!saved) {
        store.setNotice('No se pudo guardar el proyecto; la transcripción no se inició.');
        return;
      }
      const result = await store.service.transcribeAsset(asset.id, project?.language, 'small');
      const inserted = store.update((current) =>
        addTranscriptionCues(current, clip.id, result.segments).project,
      );
      if (inserted) {
        setTranscribeInfo(
          `${result.segments.length} segmento(s) · idioma ${result.language} · modelo ${result.model}`,
        );
        store.setNotice(
          `Transcripción local agregada como subtítulos (${result.segments.length} segmento(s)). Revisá nombres y puntuación.`,
        );
      }
    } catch (error) {
      store.setNotice(
        error instanceof Error ? error.message : 'no se pudo transcribir el audio',
      );
    } finally {
      setTranscribeBusy(false);
    }
  }

  async function analyzeBeats(): Promise<void> {
    if (!asset) return;
    const root = store.state.opened?.root ?? '';
    const url = store.service.mediaUrl(root, asset.source.path);
    setBeatBusy(true);
    setBeatInfo(null);
    try {
      const decoded = await decodeAudioSamples(url);
      if (!decoded) {
        setBeatAnalysis(null);
        setBeatInfo('No se pudo decodificar el audio del clip.');
        return;
      }
      const analysis = detectBeats(decoded.samples, decoded.sampleRate);
      setBeatAnalysis(analysis);
      if (analysis.beatsSeconds.length === 0) {
        setBeatInfo('Sin pulso claro: no se detectaron golpes.');
      } else if (analysis.confidence < 0.4) {
        setBeatInfo('Pulso irregular: revisá los cortes antes de exportar.');
      }
    } finally {
      setBeatBusy(false);
    }
  }

  function cutVideoToBeat(): void {
    if (!project || !beatAnalysis) return;
    const source = clip.source.type === 'asset' && 'inFrame' in clip.source ? clip.source : null;
    if (!source) {
      setBeatInfo('Este clip no tiene una ventana de origen.');
      return;
    }
    const speedRatio = 'speed' in clip && clip.speed ? clip.speed.num / Math.max(1, clip.speed.den) : 1;
    if (Math.abs(speedRatio - 1) > 0.001) {
      setBeatInfo('Poné la velocidad del audio en 1× para cortar al ritmo.');
      return;
    }
    const target = [...project.timeline.tracks]
      .filter((item) => item.kind === 'video' && !item.locked)
      .sort((a, b) => b.order - a.order)[0];
    if (!target) {
      setBeatInfo('No hay una pista de video desbloqueada para cortar.');
      return;
    }
    const frames = planBeatCuts({
      beatsSeconds: beatAnalysis.beatsSeconds,
      fps,
      audioInFrame: source.inFrame,
      audioOutFrame: source.outFrame,
      audioStartFrame: clip.startFrame,
      speed: speedRatio,
      stride: beatStride,
      targetStartFrame: 0,
      targetEndFrame: totalFrames(project),
    });
    if (frames.length === 0) {
      setBeatInfo('Los pulsos no caen dentro de la pista de video.');
      return;
    }
    let applied = false;
    store.update((current) => {
      const next = splitTrackAtFrames(current, target.id, frames);
      applied = next !== null;
      return next ?? current;
    });
    setBeatInfo(
      applied
        ? `Pista “${target.label}” cortada al ritmo: ${frames.length} cortes.`
        : 'No se pudo cortar la pista.',
    );
  }

  async function stabilizeClip(): Promise<void> {
    if (clip.kind !== 'video' || !asset) return;
    const windowed = clip.source.type === 'asset' && 'inFrame' in clip.source ? clip.source : null;
    if (!windowed) return;
    setStabilizeBusy(true);
    setStabilizeInfo(null);
    try {
      const result = await store.service.analyzeStabilization(
        asset.id,
        windowed.inFrame,
        windowed.outFrame,
        stabilizeSmoothing,
      );
      store.update((current) =>
        setClipStabilization(current, clip.id, {
          smoothing: result.smoothing,
          transformFile: result.path,
          inFrame: result.inFrame,
          outFrame: result.outFrame,
        }),
      );
      store.setNotice(
        `Estabilización analizada (suavizado ${result.smoothing}). Se hornea en el MP4; la preview no la simula.`,
      );
    } catch (error) {
      setStabilizeInfo(
        error instanceof Error ? error.message : 'no se pudo estabilizar el clip',
      );
    } finally {
      setStabilizeBusy(false);
    }
  }

  const speed =
    clip.kind === 'video' || clip.kind === 'audio'
      ? (clip.speed?.num ?? 1) / (clip.speed?.den ?? 1)
      : 1;
  const currentStabilization = 'stabilization' in clip ? clip.stabilization : undefined;
  const stabilizeBlocked =
    clip.kind === 'video' &&
    (Math.abs(speed - 1) > 0.001 ||
      Boolean(reverse) ||
      (transitionIn !== undefined && Object.keys(transitionIn).length > 0));
  const stabilizeStale =
    currentStabilization !== undefined &&
    windowedSource !== undefined &&
    (currentStabilization.inFrame !== windowedSource.inFrame ||
      currentStabilization.outFrame !== windowedSource.outFrame);
  function setEffect<K extends keyof ClipEffects>(key: K, value: ClipEffects[K] | undefined): void {
    const nextEffects: ClipEffects = { ...effects };
    if (value === undefined) {
      delete nextEffects[key];
    } else {
      nextEffects[key] = value;
    }
    store.update((current) => updateClip(current, clip.id, { effects: nextEffects }));
  }

  async function generateEffect(): Promise<void> {
    const prompt = effectPrompt.trim();
    if (!prompt || effectBusy) return;
    setEffectBusy(true);
    setEffectError(null);
    try {
      const recipe = await store.service.generateVideoEffect({
        prompt,
        approvedCost: effectApproved,
      });
      store.update((current) =>
        updateClip(current, clip.id, {
          effects: { ...effects, ...(recipe.effects as ClipEffects) },
        }),
      );
      store.setNotice(
        `Efecto IA aplicado: ${recipe.name}${recipe.simulated ? ' (simulado)' : ''}. ${recipe.description}`,
      );
      setEffectPrompt('');
    } catch (failure) {
      setEffectError(
        failure instanceof Error ? failure.message : 'no se pudo generar el efecto',
      );
    } finally {
      setEffectBusy(false);
    }
  }

  async function exportLookLut(): Promise<void> {
    try {
      const dir = await store.service.chooseDownloadDirectory();
      if (!dir) return;
      const result = await store.service.exportLookLut({
        outputDir: dir,
        title: clip.label ?? 'look',
        effects,
      });
      store.setNotice(
        `Look exportado como LUT .cube (${result.size}³, ${Math.round(result.bytes / 1024)} KB): ${result.path}`,
      );
    } catch (failure) {
      store.setNotice(
        failure instanceof Error ? failure.message : 'no se pudo exportar el look',
      );
    }
  }

  function setLens(patch: { readonly k1?: number; readonly k2?: number }): void {
    const current = effects.lensCorrection;
    const k1 = patch.k1 ?? current?.k1 ?? 0;
    const k2 = patch.k2 ?? current?.k2 ?? 0;
    if (Math.abs(k1) < 0.0001 && Math.abs(k2) < 0.0001) {
      setEffect('lensCorrection', undefined);
      return;
    }
    setEffect('lensCorrection', {
      k1,
      k2,
      ...(current?.cx !== undefined ? { cx: current.cx } : {}),
      ...(current?.cy !== undefined ? { cy: current.cy } : {}),
    });
  }

  function setGlow(patch: Partial<NonNullable<ClipEffects['glow']>>): void {
    const current = effects.glow ?? { intensity: 0.6, radius: 24, threshold: 0.55 };
    const next = {
      intensity: patch.intensity ?? current.intensity,
      radius: patch.radius ?? current.radius,
      threshold: patch.threshold ?? current.threshold,
    };
    if (next.intensity <= 0.001) {
      setEffect('glow', undefined);
      return;
    }
    setEffect('glow', next);
  }

  function setMotionBlur(
    patch: Partial<NonNullable<ClipEffects['motionBlur']>>,
  ): void {
    const current = effects.motionBlur ?? { frames: 4, intensity: 0.5 };
    setEffect('motionBlur', {
      frames: patch.frames ?? current.frames,
      intensity: patch.intensity ?? current.intensity,
    });
  }

  function setRelight(
    patch: Partial<NonNullable<ClipEffects['relight']>>,
  ): void {
    const current = effects.relight;
    setEffect('relight', {
      x: patch.x ?? current?.x ?? 0,
      y: patch.y ?? current?.y ?? 0,
      radius: patch.radius ?? current?.radius ?? 0.45,
      strength: patch.strength ?? current?.strength ?? 0.35,
      warmth: patch.warmth ?? current?.warmth ?? 0.08,
      ...(patch.feather !== undefined
        ? { feather: patch.feather }
        : current?.feather !== undefined
          ? { feather: current.feather }
          : {}),
    });
  }

  async function detectRelight(): Promise<void> {
    if (!asset || asset.kind !== 'video' || !windowedSource || relightBusy) return;
    const media = asset.media;
    if (!media) {
      setRelightError('El video no tiene duración medida para analizar rostros.');
      return;
    }
    const fps = media.frameRate.num / media.frameRate.den;
    if (!(fps > 0)) {
      setRelightError('El video no tiene una tasa de frames válida.');
      return;
    }
    setRelightBusy(true);
    setRelightError(null);
    try {
      const track = await store.service.analyzeFaceTrack({
        path: asset.source.path,
        startSeconds: windowedSource.inFrame / fps,
        endSeconds: windowedSource.outFrame / fps,
      });
      const samples = track.samples;
      if (samples.length === 0) {
        setRelightError(
          'No se detectó un rostro frontal en el clip; podés centrar el relight a mano.',
        );
        return;
      }
      const count = samples.length;
      const centerX = samples.reduce((sum, sample) => sum + sample.centerX, 0) / count;
      const centerY = samples.reduce((sum, sample) => sum + sample.centerY, 0) / count;
      const size = samples.reduce((sum, sample) => sum + sample.size, 0) / count;
      setRelight({
        x: Math.max(-1, Math.min(1, (centerX - 0.5) * 2)),
        y: Math.max(-1, Math.min(1, (centerY - 0.5) * 2)),
        radius: Math.max(0.18, Math.min(1, size * 2.2)),
      });
      store.setNotice(
        `Relight centrado en el rostro (${track.detections} muestras del clip).`,
      );
    } catch (cause) {
      setRelightError(
        cause instanceof Error
          ? cause.message
          : 'no se pudo detectar el rostro para el relight',
      );
    } finally {
      setRelightBusy(false);
    }
  }

  async function centerFace(): Promise<void> {
    if (
      !project ||
      !asset ||
      asset.kind !== 'video' ||
      clip.kind !== 'video' ||
      !windowedSource ||
      faceCenterBusy
    ) {
      return;
    }
    if (faceCenterBlockReason) {
      store.setNotice(faceCenterBlockReason);
      return;
    }
    setFaceCenterBusy(true);
    try {
      const track = await store.service.analyzeFaceTrack({
        path: asset.source.path,
        startSeconds: windowedSource.inFrame / fps,
        endSeconds: windowedSource.outFrame / fps,
      });
      if (track.samples.length < 2) {
        store.setNotice(
          'No se detectó un rostro estable en el tramo; no se crearon keyframes.',
        );
        return;
      }
      const changed = store.update((current) =>
        applyFaceCenter(current, clip.id, track.samples),
      );
      if (changed) {
        store.setNotice(
          `Rostro centrado con ${track.samples.length} muestras (${track.detections} detecciones). Revisá el encuadre y la escala.`,
        );
      }
    } catch (error) {
      store.setNotice(
        error instanceof Error ? error.message : 'no se pudo centrar el rostro',
      );
    } finally {
      setFaceCenterBusy(false);
    }
  }

  function applyLook(look: ClipEffects): void {
    const nextEffects: ClipEffects = { ...look };
    if (effects.fadeInFrames !== undefined) nextEffects.fadeInFrames = effects.fadeInFrames;
    if (effects.fadeOutFrames !== undefined) nextEffects.fadeOutFrames = effects.fadeOutFrames;
    store.update((current) => updateClip(current, clip.id, { effects: nextEffects }));
  }

  function applyTrim(
    action: (
      project: ProjectDocument,
      clipId: string,
      delta: number,
    ) => ProjectDocument,
  ): void {
    if (!Number.isFinite(trimDelta) || trimDelta === 0) {
      store.setNotice('elegí un desplazamiento distinto de cero');
      return;
    }
    store.update((current) => action(current, clip.id, trimDelta));
  }
  function setWheel(
    kind: 'lift' | 'gamma' | 'gain' | 'offset',
    channel: 'r' | 'g' | 'b',
    value: number,
  ): void {
    const current = effects[kind] ?? { r: 0, g: 0, b: 0 };
    setEffect(kind, { ...current, [channel]: value });
  }
  function patchHsl(patch: Partial<NonNullable<ClipEffects['hsl']>>): void {
    const current = effects.hsl ?? { hue: 0, saturation: 0, intensity: 0 };
    setEffect('hsl', { ...current, ...patch });
  }
  function applyCreativePreset(preset: EffectPreset): void {
    const next = applyEffectPreset(effects, preset);
    store.update((current) => updateClip(current, clip.id, { effects: next }));
    store.setNotice(`Efecto ${preset.label} aplicado.`);
  }
  const compatibleTracks = project.timeline.tracks.filter((item) =>
    clip.kind === 'audio'
      ? item.kind === 'audio' || item.kind === 'narration'
      : item.kind === trackKind(clip),
  );
  const matchReferences = project.assets.filter(
    (item) =>
      item.id !== asset?.id &&
      item.status === 'ready' &&
      (item.kind === 'video' || item.kind === 'image'),
  );
  const visual = clip.kind === 'video' || clip.kind === 'image' || clip.kind === 'freeze';
  const isAdjustment = clip.kind === 'adjustment';
  const timed = clip.kind === 'video' || clip.kind === 'audio';
  const tabs: { readonly id: ClipTab; readonly label: string }[] = [
    ...(visual ? [{ id: 'video' as const, label: 'Video' }] : []),
    ...(timed ? [{ id: 'audio' as const, label: 'Audio' }] : []),
    ...(timed ? [{ id: 'speed' as const, label: 'Velocidad' }] : []),
    ...(timed ? [{ id: 'trim' as const, label: 'Recorte' }] : []),
    ...(visual ? [{ id: 'animation' as const, label: 'Animación' }] : []),
    ...(visual || isAdjustment
      ? [{ id: 'color' as const, label: isAdjustment ? 'Ajuste' : 'Color' }]
      : []),
    ...(visual ? [{ id: 'style' as const, label: 'Estilo' }] : []),
    { id: 'all', label: 'Todo' },
  ];

  return (
    <div className="clip-inspector" data-tab={tab}>
      <div className="inspector-tabs" role="tablist" aria-label="Propiedades del clip">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={tab === item.id ? 'active' : ''}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <Section title="Clip">
        <TextField
          label="Nombre"
          value={clip.label ?? ''}
          maxLength={200}
          onCommit={(value) => store.update((current) => updateClip(current, clip.id, { label: value }))}
        />
        <p className="inspector-meta">
          {clipKindLabel(clip.kind)} · {track.label} · {formatTimecode(clip.startFrame, fps)} →{' '}
          {formatTimecode(clip.startFrame + clip.durationFrames, fps)}
        </p>
        <div className="color-chips" role="group" aria-label="Color del clip">
          {CLIP_COLORS.map((color) => (
            <button
              key={color.id}
              type="button"
              className={`small color-chip${clip.colorTag === color.id ? ' active' : ''}`}
              aria-label={`Color ${color.label}`}
              aria-pressed={clip.colorTag === color.id}
              onClick={() =>
                store.update((current) =>
                  updateClip(current, clip.id, { colorTag: color.id }),
                )
              }
            >
              <span className="clip-color-swatch" style={{ background: color.hex }} />
              {color.label}
            </button>
          ))}
          <button
            type="button"
            className="small ghost"
            onClick={() =>
              store.update((current) => updateClip(current, clip.id, { colorTag: undefined }))
            }
            disabled={clip.colorTag === undefined}
          >
            Sin color
          </button>
        </div>
        <div className="inspector-grid">
          <NumberField
            label="Inicio (frame)"
            value={clip.startFrame}
            min={0}
            onCommit={(value) => {
              store.update((current) => {
                const next = moveClip(current, clip.id, value, clip.trackId);
                if (!next) throw new Error('el nuevo inicio se superpone con otro clip');
                return next;
              });
            }}
          />
          <NumberField
            label="Duración (frames)"
            value={clip.durationFrames}
            min={1}
            onCommit={(value) => {
              store.update((current) => {
                const next = trimClip(current, clip.id, 'end', clip.startFrame + value);
                if (!next) throw new Error('la duración excede la ventana de origen del clip');
                return next;
              });
            }}
          />
        </div>
        <label className="field">
          <span>Pista</span>
          <select
            value={clip.trackId}
            onChange={(event) => {
              store.update((current) => {
                const next = moveClip(current, clip.id, clip.startFrame, event.target.value);
                if (!next) throw new Error('la pista no acepta el clip o hay una superposición');
                return next;
              });
            }}
          >
            {compatibleTracks.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label === trackKindLabel(item.kind)
                  ? item.label
                  : `${item.label} · ${trackKindLabel(item.kind)}`}
              </option>
            ))}
          </select>
        </label>
        {source.type === 'asset' && windowedSource ? (
          <p className="inspector-meta">
            Fuente: {asset ? friendlyAssetLabel(asset.label) : 'material ausente'} · in{' '}
            {windowedSource.inFrame} · out {windowedSource.outFrame}
          </p>
        ) : source.type === 'asset' ? (
          <p className="inspector-meta">
            Fuente: {asset ? friendlyAssetLabel(asset.label) : 'material ausente'} · imagen fija
          </p>
        ) : source.type === 'graphic' ? (
          <p className="inspector-meta">Fuente gráfica: {source.motionId}</p>
        ) : (
          <p className="inspector-meta">
            Capa de ajuste · se aplica al compuesto dentro de su tramo
          </p>
        )}
        {clip.kind === 'graphic' && clip.source.type === 'graphic' ? (
          (() => {
            const motion = project.motion.find((item) => item.id === clip.source.motionId);
            return motion ? (
              <MotionClipInspector clip={clip} motion={motion} />
            ) : (
              <p className="notice notice-warning" role="alert">
                Falta el motion item de este clip gráfico.
              </p>
            );
          })()
        ) : null}
        <div className="actions compact">
          <button
            type="button"
            className="small"
            onClick={() => {
              store.mutate((current) => {
                const split = splitClip(current, clip.id, store.state.playheadFrame);
                if (!split) throw new Error('el playhead no está dentro de este clip');
                return { project: split.project, rightClipId: split.rightClipId };
              });
            }}
          >
            Dividir en playhead
          </button>
          <button
            type="button"
            className="small"
            disabled={
              clip.kind === 'audio' ||
              clip.kind === 'adjustment' ||
              clip.kind === 'graphic'
            }
            onClick={() => {
              const result = store.mutate((current) => {
                const grouped = createCompound(current, clip.id);
                return {
                  project: grouped.project,
                  compoundClipId: grouped.compoundClipId,
                  grouped: grouped.grouped,
                };
              });
              if (result) {
                store.setSelection({ kind: 'clip', id: result.compoundClipId });
                store.setNotice(
                  `Compuesto creado con ${result.grouped} clip(s). Deshacelo desde el Inspector para editarlos.`,
                );
              }
            }}
          >
            Agrupar en compuesto
          </button>
          <button
            type="button"
            className="small danger-ghost"
            onClick={() => {
              let nextDuration = 0;
              store.update((current) => {
                const next = deleteClip(current, clip.id);
                nextDuration = totalFrames(next);
                return next;
              });
              store.setSelection({ kind: 'none' });
              store.setPlayhead(Math.min(store.state.playheadFrame, nextDuration));
            }}
          >
            Borrar clip
          </button>
        </div>
      </Section>

      <Section title="Transformación" group="video">
        <div className="inspector-grid">
          <NumberField
            label="Desplaz. X"
            value={transform.offsetX ?? 0}
            onCommit={(value) =>
              store.update((current) =>
                updateClip(current, clip.id, { transform: { ...transform, offsetX: Math.round(value) } }),
              )
            }
          />
          <NumberField
            label="Desplaz. Y"
            value={transform.offsetY ?? 0}
            onCommit={(value) =>
              store.update((current) =>
                updateClip(current, clip.id, { transform: { ...transform, offsetY: Math.round(value) } }),
              )
            }
          />
          <NumberField
            label="Escala X"
            value={transform.scaleX ?? 1}
            min={0.01}
            max={100}
            step={0.05}
            onCommit={(value) =>
              store.update((current) => updateClip(current, clip.id, { transform: { ...transform, scaleX: value } }))
            }
          />
          <NumberField
            label="Escala Y"
            value={transform.scaleY ?? 1}
            min={0.01}
            max={100}
            step={0.05}
            onCommit={(value) =>
              store.update((current) => updateClip(current, clip.id, { transform: { ...transform, scaleY: value } }))
            }
          />
          <NumberField
            label="Rotación"
            value={transform.rotationDeg ?? 0}
            min={-360}
            max={360}
            onCommit={(value) =>
              store.update((current) => updateClip(current, clip.id, { transform: { ...transform, rotationDeg: value } }))
            }
          />
          <NumberField
            label="Opacidad"
            value={transform.opacity ?? 1}
            min={0}
            max={1}
            step={0.05}
            onCommit={(value) =>
              store.update((current) => updateClip(current, clip.id, { transform: { ...transform, opacity: value } }))
            }
          />
        </div>
        <label className="field">
          <span>Mezcla</span>
          <select
            value={blendMode ?? 'normal'}
            onChange={(event) =>
              store.update((current) =>
                updateClip(current, clip.id, {
                  blendMode:
                    event.target.value === 'normal'
                      ? undefined
                      : (event.target.value as BlendMode),
                }),
              )
            }
          >
            <option value="normal">Normal</option>
            <option value="multiply">Multiplicar</option>
            <option value="screen">Trama / aclarar</option>
            <option value="overlay">Superponer</option>
            <option value="soft-light">Luz suave</option>
            <option value="darken">Oscurecer</option>
            <option value="lighten">Aclarar</option>
            <option value="color-dodge">Sobreexponer color</option>
            <option value="color-burn">Subexponer color</option>
            <option value="hard-light">Luz fuerte</option>
          </select>
        </label>
        <p className="fine-print">
          La mezcla se calcula contra las capas inferiores. Rinde mejor cuando el clip llena el
          cuadro; en la preview usa `mix-blend-mode` y en el MP4 `blend`.
        </p>
        <div className="actions compact">
          <label className="check">
            <input
              type="checkbox"
              checked={transform.flipH ?? false}
              onChange={(event) =>
                store.update((current) =>
                  updateClip(current, clip.id, {
                    transform: { ...transform, flipH: event.target.checked || undefined },
                  }),
                )
              }
            />
            <span>Voltear horizontal</span>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={transform.flipV ?? false}
              onChange={(event) =>
                store.update((current) =>
                  updateClip(current, clip.id, {
                    transform: { ...transform, flipV: event.target.checked || undefined },
                  }),
                )
              }
            />
            <span>Voltear vertical</span>
          </label>
          {[90, 180, 270].map((degrees) => (
            <button
              key={degrees}
              type="button"
              className="small"
              onClick={() =>
                store.update((current) =>
                  updateClip(current, clip.id, {
                    transform: { ...transform, rotationDeg: degrees },
                  }),
                )
              }
            >
              {degrees}°
            </button>
          ))}
          <button
            type="button"
            className="small ghost"
            onClick={() => store.update((current) => updateClip(current, clip.id, { transform: {} }))}
            disabled={Object.keys(transform).length === 0}
          >
            Limpiar transformación
          </button>
        </div>

        {visual ? (
          <div className="keyframe-panel">
            <div className="production-card-head">
              <div>
                <p className="eyebrow">Keyframes de transformación</p>
                <span className="fine-print">
                  {transformKeyframes.length} clave(s) · playhead{' '}
                  {formatTimecode(localFrame, fps)}
                </span>
              </div>
              <div className="actions compact">
                <button
                  type="button"
                  className="small"
                  onClick={() => {
                    store.update((current) =>
                      setTransformKeyframe(
                        current,
                        clip.id,
                        localFrame,
                        captureTransformKeyframe(clip, localFrame),
                      ),
                    );
                    setSelectedKeyframe(localFrame);
                  }}
                >
                  Fijar en playhead
                </button>
                <button
                  type="button"
                  className="small ghost"
                  disabled={transformKeyframes.length === 0}
                  onClick={() => {
                    store.update((current) =>
                      clearTransformKeyframes(current, clip.id, localFrame),
                    );
                    setSelectedKeyframe(null);
                  }}
                >
                  Quitar animación
                </button>
              </div>
            </div>
            {transformKeyframes.length === 0 ? (
              <p className="fine-print">
                Fijá una clave, mové el playhead, cambiá escala/posición/opacidad y fijá otra. La
                vista previa y el MP4 interpolan entre claves.
              </p>
            ) : (
              <div className="keyframe-list">
                {transformKeyframes.map((keyframe) => (
                  <div
                    key={keyframe.frame}
                    className={`keyframe-row ${
                      selectedKeyframe === keyframe.frame ? 'active' : ''
                    }`}
                  >
                    <button
                      type="button"
                      className="small ghost"
                      onClick={() => setSelectedKeyframe(keyframe.frame)}
                    >
                      {formatTimecode(keyframe.frame, fps)}
                    </button>
                    <span className="fine-print">
                      {[
                        keyframe.offsetX !== undefined ? `X ${keyframe.offsetX}` : '',
                        keyframe.offsetY !== undefined ? `Y ${keyframe.offsetY}` : '',
                        keyframe.scale !== undefined ? `×${keyframe.scale.toFixed(2)}` : '',
                        keyframe.rotationDeg !== undefined ? `${keyframe.rotationDeg}°` : '',
                        keyframe.opacity !== undefined
                          ? `α ${keyframe.opacity.toFixed(2)}`
                          : '',
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                    <button
                      type="button"
                      className="small ghost"
                      aria-label={`Quitar clave en ${formatTimecode(keyframe.frame, fps)}`}
                      onClick={() => {
                        store.update((current) =>
                          removeTransformKeyframe(current, clip.id, keyframe.frame),
                        );
                        if (selectedKeyframe === keyframe.frame) setSelectedKeyframe(null);
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
            {selectedTransformKeyframe ? (
              <div className="inspector-grid">
                <NumberField
                  label="KF desplaz. X"
                  value={selectedTransformKeyframe.offsetX ?? 0}
                  onCommit={(value) =>
                    store.update((current) =>
                      setTransformKeyframe(current, clip.id, selectedTransformKeyframe.frame, {
                        offsetX: Math.round(value),
                      }),
                    )
                  }
                />
                <NumberField
                  label="KF desplaz. Y"
                  value={selectedTransformKeyframe.offsetY ?? 0}
                  onCommit={(value) =>
                    store.update((current) =>
                      setTransformKeyframe(current, clip.id, selectedTransformKeyframe.frame, {
                        offsetY: Math.round(value),
                      }),
                    )
                  }
                />
                <NumberField
                  label="KF escala"
                  value={selectedTransformKeyframe.scale ?? 1}
                  min={0.5}
                  max={4}
                  step={0.05}
                  onCommit={(value) =>
                    store.update((current) =>
                      setTransformKeyframe(current, clip.id, selectedTransformKeyframe.frame, {
                        scale: value,
                      }),
                    )
                  }
                />
                <NumberField
                  label="KF rotación"
                  value={selectedTransformKeyframe.rotationDeg ?? 0}
                  min={-360}
                  max={360}
                  onCommit={(value) =>
                    store.update((current) =>
                      setTransformKeyframe(current, clip.id, selectedTransformKeyframe.frame, {
                        rotationDeg: value,
                      }),
                    )
                  }
                />
                <NumberField
                  label="KF opacidad"
                  value={selectedTransformKeyframe.opacity ?? 1}
                  min={0}
                  max={1}
                  step={0.05}
                  onCommit={(value) =>
                    store.update((current) =>
                      setTransformKeyframe(current, clip.id, selectedTransformKeyframe.frame, {
                        opacity: value,
                      }),
                    )
                  }
                />
                <label className="field">
                  <span>Curva</span>
                  <select
                    value={selectedTransformKeyframe.easing ?? 'linear'}
                    onChange={(event) =>
                      store.update((current) =>
                        setTransformKeyframe(current, clip.id, selectedTransformKeyframe.frame, {
                          easing: event.target.value as KeyframeEasing,
                        }),
                      )
                    }
                  >
                    <option value="linear">Lineal</option>
                    <option value="ease-in">Acelerar</option>
                    <option value="ease-out">Desacelerar</option>
                    <option value="ease-in-out">Suave</option>
                    <option value="hold">Mantener</option>
                  </select>
                </label>
              </div>
            ) : null}
          </div>
        ) : null}
      </Section>

      {visual ? (
        <Section title="Transición de entrada" group="video">
          <div className="inspector-grid">
            <label className="field">
              <span>Tipo</span>
              <select
                value={transitionIn?.type ?? 'none'}
                onChange={(event) => {
                  if (event.target.value === 'none') {
                    store.update((current) =>
                      updateClip(current, clip.id, { transitionIn: {} }),
                    );
                  } else {
                    store.update((current) =>
                      updateClip(current, clip.id, {
                        transitionIn: {
                          type: event.target.value as NonNullable<
                            typeof transitionIn
                          >['type'],
                          frames: transitionIn?.frames ?? Math.min(12, clip.durationFrames),
                        },
                      }),
                    );
                  }
                }}
              >
                <option value="none">Sin transición</option>
                <option value="dissolve">Disolvencia</option>
                <option value="fade-black">Fundido a negro</option>
                <option value="fade-white">Fundido a blanco</option>
                <option value="slide-left">Deslizar desde la derecha</option>
                <option value="slide-right">Deslizar desde la izquierda</option>
                <option value="slide-up">Deslizar desde abajo</option>
                <option value="slide-down">Deslizar desde arriba</option>
              </select>
            </label>
            <NumberField
              label="Duración (frames)"
              value={transitionIn?.frames ?? 12}
              min={1}
              max={Math.min(120, clip.durationFrames)}
              disabled={!transitionIn}
              onCommit={(value) =>
                store.update((current) =>
                  updateClip(current, clip.id, {
                    transitionIn: {
                      type: transitionIn?.type ?? 'dissolve',
                      frames: Math.max(
                        1,
                        Math.min(Math.min(120, clip.durationFrames), Math.round(value)),
                      ),
                    },
                  }),
                )
              }
            />
          </div>
          <p className="fine-print">
            La disolvencia superpone el arranque de este clip al final del anterior. No cambia
            la duración de la timeline y se hornea en el MP4; el primer clip no la muestra.
          </p>
        </Section>
      ) : null}

      {visual ? (
        <Section title="Animación de entrada y salida" group="animation">
          <div className="inspector-grid">
            <label className="field">
              <span>Entrada</span>
              <select
                value={animationIn?.type ?? 'none'}
                onChange={(event) => {
                  const type = event.target.value;
                  if (type === 'none') {
                    store.update((current) =>
                      updateClip(current, clip.id, { animationIn: undefined }),
                    );
                  } else {
                    store.update((current) =>
                      updateClip(current, clip.id, {
                        animationIn: {
                          type: type as ClipAnimation['type'],
                          durationFrames: Math.min(
                            animationIn?.durationFrames ?? 15,
                            animationMax,
                          ),
                        },
                      }),
                    );
                  }
                }}
              >
                <option value="none">Sin animación</option>
                <option value="fade">Fundido</option>
                <option value="slide-left">Deslizar a la izquierda</option>
                <option value="slide-right">Deslizar a la derecha</option>
                <option value="slide-up">Deslizar hacia arriba</option>
                <option value="slide-down">Deslizar hacia abajo</option>
              </select>
            </label>
            <NumberField
              label="Duración entrada"
              value={animationIn?.durationFrames ?? Math.min(15, animationMax)}
              min={1}
              max={animationMax}
              disabled={!animationIn}
              onCommit={(value) =>
                animationIn
                  ? store.update((current) =>
                      updateClip(current, clip.id, {
                        animationIn: {
                          type: animationIn.type,
                          durationFrames: Math.max(
                            1,
                            Math.min(animationMax, Math.round(value)),
                          ),
                        },
                      }),
                    )
                  : undefined
              }
            />
          </div>
          <div className="inspector-grid">
            <label className="field">
              <span>Salida</span>
              <select
                value={animationOut?.type ?? 'none'}
                onChange={(event) => {
                  const type = event.target.value;
                  if (type === 'none') {
                    store.update((current) =>
                      updateClip(current, clip.id, { animationOut: undefined }),
                    );
                  } else {
                    store.update((current) =>
                      updateClip(current, clip.id, {
                        animationOut: {
                          type: type as ClipAnimation['type'],
                          durationFrames: Math.min(
                            animationOut?.durationFrames ?? 15,
                            animationMax,
                          ),
                        },
                      }),
                    );
                  }
                }}
              >
                <option value="none">Sin animación</option>
                <option value="fade">Fundido</option>
                <option value="slide-left">Deslizar a la izquierda</option>
                <option value="slide-right">Deslizar a la derecha</option>
                <option value="slide-up">Deslizar hacia arriba</option>
                <option value="slide-down">Deslizar hacia abajo</option>
              </select>
            </label>
            <NumberField
              label="Duración salida"
              value={animationOut?.durationFrames ?? Math.min(15, animationMax)}
              min={1}
              max={animationMax}
              disabled={!animationOut}
              onCommit={(value) =>
                animationOut
                  ? store.update((current) =>
                      updateClip(current, clip.id, {
                        animationOut: {
                          type: animationOut.type,
                          durationFrames: Math.max(
                            1,
                            Math.min(animationMax, Math.round(value)),
                          ),
                        },
                      }),
                    )
                  : undefined
              }
            />
          </div>
          <div className="actions compact">
            <button
              type="button"
              className="small"
              onClick={() =>
                store.update((current) =>
                  updateClip(current, clip.id, {
                    animationIn: {
                      type: 'fade',
                      durationFrames: Math.min(12, animationMax),
                    },
                    animationOut: {
                      type: 'fade',
                      durationFrames: Math.min(12, animationMax),
                    },
                  }),
                )
              }
            >
              Suave
            </button>
            <button
              type="button"
              className="small"
              onClick={() =>
                store.update((current) =>
                  updateClip(current, clip.id, {
                    animationIn: {
                      type: 'slide-down',
                      durationFrames: Math.min(10, animationMax),
                    },
                    animationOut: {
                      type: 'slide-up',
                      durationFrames: Math.min(10, animationMax),
                    },
                  }),
                )
              }
            >
              Dinámica
            </button>
            <button
              type="button"
              className="small"
              onClick={() =>
                store.update((current) =>
                  updateClip(current, clip.id, {
                    animationIn: {
                      type: 'slide-left',
                      durationFrames: Math.min(12, animationMax),
                    },
                    animationOut: {
                      type: 'slide-left',
                      durationFrames: Math.min(12, animationMax),
                    },
                  }),
                )
              }
            >
              Deslizar
            </button>
            <button
              type="button"
              className="small ghost"
              onClick={() =>
                store.update((current) =>
                  updateClip(current, clip.id, {
                    animationIn: undefined,
                    animationOut: undefined,
                  }),
                )
              }
            >
              Quitar
            </button>
          </div>
          <p className="fine-print">
            Las animaciones se reproducen dentro del clip, no mueven a los vecinos ni cambian
            la duración. Se combinan con el movimiento Ken Burns y con la transición de entrada.
          </p>
        </Section>
      ) : null}

      {clip.kind === 'freeze' ? (
        <Section title="Congelado" group="video">
          <p className="fine-print">
            Este clip es un frame fijo exportado del video original. Se renderiza como imagen
            y podés moverlo, recortarlo o aplicarle color, máscara y animación sin alterar los
            frames vecinos.
          </p>
        </Section>
      ) : null}

      {clip.kind === 'video' || clip.kind === 'audio' ? (
        <Section title="Velocidad" group="speed">
          <div className="inspector-grid">
            <NumberField
              label="Velocidad (x)"
              value={speed}
              min={0.1}
              max={4}
              step={0.05}
              onCommit={(value) =>
                store.update((current) => setClipSpeed(current, clip.id, value))
              }
            />
          </div>
          <div className="actions compact">
            {[0.5, 1, 1.5, 2].map((value) => (
              <button
                key={value}
                type="button"
                className="small"
                onClick={() => store.update((current) => setClipSpeed(current, clip.id, value))}
                disabled={Math.abs(speed - value) < 0.001}
              >
                {value}x
              </button>
            ))}
          </div>
          <p className="fine-print">
            Cambiar la velocidad ajusta la duración del clip y desplaza los clips siguientes de la
            misma pista. La ventana de origen se ajusta para mantener frames enteros.
          </p>
          {clip.kind === 'video' ? (
            <div className="keyframe-panel">
              <div className="production-card-head">
                <div>
                  <p className="eyebrow">Cámara lenta</p>
                  <span className="fine-print">Interpolación de movimiento al exportar</span>
                </div>
                <div className="actions compact">
                  {[0.25, 0.5].map((value) => (
                    <button
                      key={value}
                      type="button"
                      className="small"
                      onClick={() =>
                        store.update((current) =>
                          setClipSpeed(current, clip.id, value, { smoothSlowMotion: true }),
                        )
                      }
                      disabled={
                        Math.abs(speed - value) < 0.001 && clip.slowMotionSmoothing === true
                      }
                    >
                      {value === 0.25 ? '0.25× lento' : '0.5× lento'}
                    </button>
                  ))}
                </div>
              </div>
              <label className="check">
                <input
                  type="checkbox"
                  checked={speedFactor < 0.999 && clip.slowMotionSmoothing === true}
                  disabled={speedFactor >= 0.999}
                  onChange={(event) =>
                    store.update((current) =>
                      setSlowMotionSmoothing(current, clip.id, event.target.checked),
                    )
                  }
                />
                <span>Interpolar fotogramas (movimiento suave)</span>
              </label>
              <p className="fine-print">
                `minterpolate` genera frames intermedios entre los originales: el clip se ve
                fluido a 1/4 o 1/2 de velocidad, pero el export tarda más. No se aplica al
                acelerar ni a 1×.
              </p>
            </div>
          ) : null}
          <label className="check">
            <input
              type="checkbox"
              checked={reverse}
              onChange={(event) =>
                store.update((current) =>
                  updateClip(current, clip.id, { reverse: event.target.checked }),
                )
              }
            />
            <span>Reproducir al revés</span>
          </label>
          <p className="fine-print">
            El video y su audio se invierten en el render con `reverse`/`areverse`. La preview
            reproduce hacia adelante; verificá el MP4 antes de publicar.
          </p>
          <div className="keyframe-panel">
            <div className="production-card-head">
              <div>
                <p className="eyebrow">Rampa de velocidad</p>
                <span className="fine-print">3 tramos: rápido → lento o al revés</span>
              </div>
              <div className="actions compact">
                <NumberField
                  label="Desde (x)"
                  value={rampFrom}
                  min={0.1}
                  max={4}
                  step={0.05}
                  onCommit={setRampFrom}
                />
                <NumberField
                  label="Hasta (x)"
                  value={rampTo}
                  min={0.1}
                  max={4}
                  step={0.05}
                  onCommit={setRampTo}
                />
                <button
                  type="button"
                  className="small"
                  onClick={() => {
                    const result = store.mutate((current) =>
                      applySpeedRamp(current, clip.id, { from: rampFrom, to: rampTo }),
                    );
                    if (result) {
                      store.setSelection({ kind: 'clip', id: result.clipIds[0]! });
                      store.setNotice(
                        `Rampa aplicada: ${result.speeds
                          .map((value) => `${value.toFixed(2)}x`)
                          .join(' → ')}.`,
                      );
                    }
                  }}
                >
                  Aplicar rampa
                </button>
              </div>
            </div>
            <p className="fine-print">
              Divide el clip en tres tramos contiguos que conservan la duración total y la
              ventana de origen. Requiere un clip sin keyframes, Ken Burns ni reverse; podés
              aplicar movimiento después, tramo por tramo.
            </p>
          </div>
          <div className="keyframe-panel">
            <div className="production-card-head">
              <div>
                <p className="eyebrow">Curva de velocidad</p>
                <span className="fine-print">6–24 tramos suaves con extremos exactos</span>
              </div>
              <div className="actions compact">
                <label className="field">
                  <span>Tramos</span>
                  <select
                    value={curveSegments}
                    onChange={(event) => setCurveSegments(Number(event.target.value))}
                  >
                    {[6, 8, 12, 16, 20, 24].map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="small"
                  onClick={() => {
                    const result = store.mutate((current) =>
                      applySpeedCurve(current, clip.id, {
                        from: rampFrom,
                        to: rampTo,
                        segments: curveSegments,
                      }),
                    );
                    if (result) {
                      store.setSelection({ kind: 'clip', id: result.clipIds[0]! });
                      store.setNotice(
                        `Curva aplicada (${result.clipIds.length} tramos): ${result.speeds
                          .map((value) => `${value.toFixed(2)}x`)
                          .join(' → ')}.`,
                      );
                    }
                  }}
                >
                  Curva suave
                </button>
              </div>
            </div>
            <p className="fine-print">
              Usa las velocidades Desde/Hasta de la rampa y reparte el clip en tramos contiguos
              con una curva suave. Conserva la duración total y la ventana; los tramos
              intermedios absorben la diferencia. Requiere clip sin keyframes, Ken Burns ni
              reverse.
            </p>
          </div>
          <div className="keyframe-panel">
            <div className="production-card-head">
              <div>
                <p className="eyebrow">Presets de rampa</p>
                <span className="fine-print">Curvas de velocidad listas para aplicar</span>
              </div>
              <div className="actions compact">
                {SPEED_RAMP_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    className="small"
                    title={preset.descripcion}
                    onClick={() => {
                      const result = store.mutate((current) =>
                        applySpeedRampPreset(current, clip.id, preset),
                      );
                      if (result) {
                        store.setSelection({ kind: 'clip', id: result.clipIds[0]! });
                        store.setNotice(
                          `Preset “${preset.nombre}” aplicado (${result.clipIds.length} tramos): ${result.velocidades
                            .map((value) => `${value.toFixed(2)}x`)
                            .join(' → ')}.`,
                        );
                      }
                    }}
                  >
                    {preset.nombre}
                  </button>
                ))}
              </div>
            </div>
            <p className="fine-print">
              Divide el clip en tramos contiguos y aplica la velocidad de cada tramo con el
              mismo control de velocidad: los tramos lentos ocupan más tiempo en la pista y
              los clips siguientes se desplazan. Requiere un clip de video o audio sin
              keyframes, Ken Burns ni reverse.
            </p>
          </div>
          {clip.kind === 'video' ? (
            <div className="keyframe-panel">
              <div className="production-card-head">
                <div>
                  <p className="eyebrow">Freeze frame</p>
                  <span className="fine-print">Frame exacto del playhead como 2 s fijos</span>
                </div>
                <div className="actions compact">
                  <button
                    type="button"
                    className="small"
                    onClick={() => void freezeFrame('track')}
                    disabled={
                      freezeBusy ||
                      !asset ||
                      asset.kind !== 'video' ||
                      asset.source.type !== 'local'
                    }
                  >
                    {freezeBusy ? 'Congelando…' : 'Congelar en la pista'}
                  </button>
                  <button
                    type="button"
                    className="small ghost"
                    onClick={() => void freezeFrame('overlay')}
                    disabled={
                      freezeBusy ||
                      !asset ||
                      asset.kind !== 'video' ||
                      asset.source.type !== 'local'
                    }
                  >
                    Como capa
                  </button>
                </div>
              </div>
              <p className="fine-print">
                En la pista divide el video en el playhead, inserta 2 s fijos sobre la misma
                pista y corre clips, subtítulos y marcadores posteriores. Como capa monta el
                frame como imagen encima, sin tocar el resto. En ambos casos el PNG queda en
                Medios.
              </p>
            </div>
          ) : null}
        </Section>
      ) : null}

      {transformKeyframes.length >= 2 ? (
        <Section title="Curvas" group="video">
          <p className="fine-print">
            Edita las curvas de interpolación entre keyframes. Arrastra los puntos naranjas para definir un easing
            Bézier propio del segmento que empieza en cada clave.
          </p>
          <KeyframeCurveEditor
            keyframes={transformKeyframes}
            property="scale"
            onEditBezier={(index, bezier) => {
              const ordenados = [...transformKeyframes].sort((a, b) => a.frame - b.frame);
              const inicio = ordenados[index];
              if (!inicio) return;
              store.update((current) => setTransformKeyframe(current, clip.id, inicio.frame, { bezier }));
            }}
          />
          <p className="fine-print inspector-full">
            La vista previa y el export respetan las curvas Bézier guardadas; sin curva específica se usa el preset de
            la clave (linear, ease-in, ease-out, ease-in-out o hold).
          </p>
        </Section>
      ) : null}

      {clip.kind === 'video' ? (
        <Section title="Estabilización" group="video">
          <div className="inspector-grid">
            <NumberField
              label="Suavizado (1–60)"
              value={stabilizeSmoothing}
              min={1}
              max={60}
              step={1}
              onCommit={setStabilizeSmoothing}
            />
          </div>
          <div className="actions compact">
            <button
              type="button"
              className="small"
              onClick={() => void stabilizeClip()}
              disabled={
                stabilizeBusy ||
                stabilizeBlocked ||
                !asset ||
                asset.kind !== 'video' ||
                asset.source.type !== 'local'
              }
            >
              {stabilizeBusy
                ? 'Analizando…'
                : currentStabilization
                  ? 'Reanalizar'
                  : 'Analizar y aplicar'}
            </button>
            {currentStabilization ? (
              <button
                type="button"
                className="small"
                onClick={() => {
                  store.update((current) =>
                    setClipStabilization(current, clip.id, undefined),
                  );
                  setStabilizeInfo(null);
                }}
              >
                Quitar
              </button>
            ) : null}
          </div>
          {currentStabilization ? (
            <p className="fine-print">
              Ventana {currentStabilization.inFrame}–{currentStabilization.outFrame} · suavizado{' '}
              {currentStabilization.smoothing}.
              {stabilizeStale
                ? ' El recorte cambió: reanalizá para que la transformación coincida.'
                : ''}
            </p>
          ) : null}
          {stabilizeBlocked ? (
            <p className="fine-print">
              Volvé la velocidad a 1× y quitá el reverse y la transición de entrada: el análisis
              se hace sobre la ventana exacta que renderiza FFmpeg.
            </p>
          ) : null}
          {stabilizeInfo ? <p className="fine-print">{stabilizeInfo}</p> : null}
          <p className="fine-print">
            vidstab analiza el movimiento del tramo y el render lo compensa con recorte negro.
            Se hornea en el MP4; la vista previa no la simula.
          </p>
        </Section>
      ) : null}

      {clip.kind === 'video' ? (
        <Section title="Seguimiento de rostro" group="video">
          <p className="fine-print">
            Detecta el rostro en el tramo y crea keyframes de posición y escala para
            mantenerlo centrado, como el camera tracking de CapCut. Requiere el modelo de
            rostros descargado.
          </p>
          <div className="actions compact">
            <button
              type="button"
              className="small"
              onClick={() => void centerFace()}
              disabled={
                faceCenterBusy ||
                !asset ||
                asset.kind !== 'video' ||
                faceCenterBlockReason !== null
              }
            >
              {faceCenterBusy ? 'Analizando rostro…' : 'Centrar rostro'}
            </button>
          </div>
          {faceCenterBlockReason ? (
            <p className="fine-print">{faceCenterBlockReason}</p>
          ) : null}
        </Section>
      ) : null}

      {timed ? (
        <Section title="Ajuste fino" group="trim">
          <p className="inspector-meta">
            Ventana de origen{' '}
            {windowedSource
              ? `${windowedSource.inFrame}–${windowedSource.outFrame}`
              : 'no disponible'}{' '}
            · velocidad {speed.toFixed(2)}×
          </p>
          <div className="inspector-grid">
            <NumberField
              label="Desplazamiento (frames)"
              value={trimDelta}
              min={-300}
              max={300}
              onCommit={setTrimDelta}
            />
          </div>
          <div className="actions compact">
            <button
              type="button"
              className="small"
              disabled={Math.abs(speed - 1) > 0.001}
              onClick={() => applyTrim(slipClip)}
            >
              Slip
            </button>
            <button
              type="button"
              className="small"
              disabled={Math.abs(speed - 1) > 0.001}
              onClick={() => applyTrim(slideClip)}
            >
              Slide
            </button>
            <button
              type="button"
              className="small"
              disabled={Math.abs(speed - 1) > 0.001}
              onClick={() =>
                applyTrim((project, id, delta) => rollClip(project, id, 'in', delta))
              }
            >
              Roll entrada
            </button>
            <button
              type="button"
              className="small"
              disabled={Math.abs(speed - 1) > 0.001}
              onClick={() =>
                applyTrim((project, id, delta) => rollClip(project, id, 'out', delta))
              }
            >
              Roll salida
            </button>
          </div>
          <p className="fine-print">
            Slip mueve el contenido dentro del clip sin mover la timeline. Slide
            mueve el clip y reparte la diferencia entre los vecinos; Roll mueve el
            corte con el vecino. Requieren velocidad 1×; Slide y Roll necesitan
            clips contiguos y rechazan keyframes.
          </p>
        </Section>
      ) : null}

      {visual ? (
        <Section title="Movimiento" group="video">
          <label className="field">
            <span>Movimiento de cámara</span>
            <select
              value={motionType}
              onChange={(event) => {
                const value = event.target.value as ClipMotion['type'] | 'none';
                if (value === 'none') {
                  setMotion(undefined);
                } else {
                  setMotion({ type: value, intensity: motion?.intensity ?? 0.12 });
                }
              }}
            >
              <option value="none">Sin movimiento</option>
              <option value="zoom-in">Zoom in</option>
              <option value="zoom-out">Zoom out</option>
              <option value="pan-left">Paneo a la izquierda</option>
              <option value="pan-right">Paneo a la derecha</option>
              <option value="pan-up">Paneo hacia arriba</option>
              <option value="pan-down">Paneo hacia abajo</option>
            </select>
          </label>
          <div className="inspector-grid">
            <NumberField
              label="Intensidad (%)"
              value={Math.round((motion?.intensity ?? 0.12) * 100)}
              min={2}
              max={50}
              step={1}
              disabled={motion === undefined}
              onCommit={(value) => {
                if (motion) setMotion({ ...motion, intensity: value / 100 });
              }}
            />
          </div>
          <div className="actions compact">
            <button
              type="button"
              className="small"
              onClick={() => setMotion({ type: 'zoom-in', intensity: 0.14 })}
            >
              Ken Burns
            </button>
            <button
              type="button"
              className="small"
              onClick={() => setMotion({ type: 'pan-right', intensity: 0.12 })}
            >
              Paneo suave
            </button>
            <button
              type="button"
              className="small ghost"
              onClick={() => setMotion(undefined)}
              disabled={motion === undefined}
            >
              Quitar
            </button>
          </div>
          <p className="fine-print">
            El movimiento se aplica durante todo el clip; la vista previa lo aproxima y el MP4 lo
            renderiza recortando la fuente con FFmpeg. Combinado con fades, sirve para diapositivas
            y fotos.
          </p>
        </Section>
      ) : null}

      {visual && asset ? (
        <Section title="Fondo automático" group="video">
          <p className="fine-print">
            Segmenta la persona u objeto principal con el modelo local u2netp y crea una
            versión con transparencia. El material original queda intacto en la biblioteca.
          </p>
          {asset.status !== 'ready' ||
          asset.rights.license.commercialUse === 'unknown' ? (
            <p className="fine-print">
              Primero declaramos los derechos del material original: el recorte hereda esa
              licencia.
            </p>
          ) : null}
          <div className="actions compact">
            <button
              type="button"
              className="small"
              onClick={() => void removeAutomaticBackground()}
              disabled={
                backgroundBusy ||
                lockedTrack ||
                asset.status !== 'ready' ||
                asset.rights.license.commercialUse === 'unknown'
              }
            >
              {backgroundBusy
                ? backgroundPercent !== null
                  ? `Recortando… ${Math.round(backgroundPercent)}%`
                  : 'Recortando…'
                : clip.kind === 'video'
                  ? 'Quitar fondo del tramo'
                  : 'Quitar fondo'}
            </button>
          </div>
          {lockedTrack ? (
            <p className="fine-print">
              La pista está bloqueada; desbloqueala para recortar el fondo.
            </p>
          ) : null}
          {clip.kind === 'video' ? (
            <p className="fine-print">
              Procesa hasta 2 minutos por vez, conserva el audio y limita la salida a 1080p.
              Puede tardar varios minutos; la interpolación y los efectos se aplican después,
              sobre el recorte.
            </p>
          ) : null}
        </Section>
      ) : null}

      {visual ? (
        <Section title="Fondo / chroma key" group="video">
          <div className="inspector-grid">
            <label className="field">
              <span>Color a remover</span>
              <input
                type="color"
                value={chromaKey?.color ?? '#00ff00'}
                onChange={(event) =>
                  setChromaKey({
                    color: event.target.value,
                    similarity: chromaKey?.similarity ?? 0.3,
                    blend: chromaKey?.blend ?? 0.1,
                  })
                }
              />
            </label>
            <NumberField
              label="Similitud (%)"
              value={Math.round((chromaKey?.similarity ?? 0.3) * 100)}
              min={1}
              max={100}
              disabled={chromaKey === undefined}
              onCommit={(value) =>
                setChromaKey({
                  color: chromaKey?.color ?? '#00ff00',
                  similarity: value / 100,
                  blend: chromaKey?.blend ?? 0.1,
                })
              }
            />
            <NumberField
              label="Mezcla (%)"
              value={Math.round((chromaKey?.blend ?? 0.1) * 100)}
              min={0}
              max={100}
              disabled={chromaKey === undefined}
              onCommit={(value) =>
                setChromaKey({
                  color: chromaKey?.color ?? '#00ff00',
                  similarity: chromaKey?.similarity ?? 0.3,
                  blend: value / 100,
                })
              }
            />
          </div>
          <div className="actions compact">
            <button
              type="button"
              className="small"
              onClick={() => setChromaKey({ color: '#00ff00', similarity: 0.3, blend: 0.1 })}
            >
              Fondo verde
            </button>
            <button
              type="button"
              className="small"
              onClick={() => setChromaKey({ color: '#0000ff', similarity: 0.3, blend: 0.1 })}
            >
              Fondo azul
            </button>
            <button
              type="button"
              className="small ghost"
              onClick={() => setChromaKey(undefined)}
              disabled={chromaKey === undefined}
            >
              Quitar
            </button>
          </div>
          <p className="fine-print">
            El render remueve el color con FFmpeg y deja el canal alfa para la capa inferior. La
            vista previa no simula el recorte; revisá el MP4. Para fondos reales sin croma hace
            falta un modelo de segmentación, que no está incluido.
          </p>
        </Section>
      ) : null}

      {visual ? (
        <Section title="Máscara" group="video">
          <div className="inspector-grid">
            <label className="field">
              <span>Forma</span>
              <select
                value={mask?.shape ?? 'rectangle'}
                onChange={(event) => {
                  const shape = event.target.value as ClipMask['shape'];
                  if (shape === 'polygon') {
                    patchMask({
                      shape,
                      points: mask?.points ?? polygonAroundCenter(0.5, 0.5).points,
                    });
                  } else if (shape === 'text') {
                    patchMask({
                      shape,
                      text: mask?.text ?? 'TEXTO',
                      fontScale: mask?.fontScale ?? 0.16,
                      width: mask?.width ?? 1,
                      height: mask?.height ?? 1,
                      feather: 0,
                    });
                  } else {
                    patchMask({ shape });
                  }
                }}
              >
                <option value="rectangle">Rectángulo</option>
                <option value="ellipse">Elipse</option>
                <option value="diamond">Diamante</option>
                <option value="triangle">Triángulo</option>
                <option value="rounded">Rectángulo redondeado</option>
                <option value="polygon">Polígono (roto)</option>
                <option value="text">Texto recortado</option>
              </select>
            </label>
            <NumberField
              label="Centro X"
              value={maskView.x}
              min={-1}
              max={1}
              step={0.05}
              onCommit={(value) => patchMask({ x: value })}
            />
            <NumberField
              label="Centro Y"
              value={maskView.y}
              min={-1}
              max={1}
              step={0.05}
              onCommit={(value) => patchMask({ y: value })}
            />
            {mask?.shape === 'polygon' ? (
              <p className="fine-print inspector-full">
                Polígono de {mask.points?.length ?? 0} vértices. La forma se dibuja y anima en
                VFX; acá movés el conjunto con Centro X/Y.
              </p>
            ) : mask?.shape === 'text' ? (
              <>
                <label className="field inspector-full">
                  <span>Texto</span>
                  <input
                    type="text"
                    maxLength={200}
                    value={mask.text ?? ''}
                    onChange={(event) => patchMask({ text: event.target.value })}
                  />
                </label>
                <NumberField
                  label="Tamaño (% alto)"
                  value={Math.round((mask.fontScale ?? 0.16) * 100)}
                  min={2}
                  max={50}
                  step={1}
                  onCommit={(value) => patchMask({ fontScale: value / 100 })}
                />
                <NumberField
                  label="Feather"
                  value={maskView.feather}
                  min={0}
                  max={1}
                  step={0.02}
                  onCommit={(value) => patchMask({ feather: value })}
                />
                <p className="fine-print inspector-full">
                  La máscara usa los glifos como alfa: el clip se ve sólo a través del texto.
                  Se renderiza con drawtext y es estática; la preview CSS no la dibuja, usá
                  Frame real para verla.
                </p>
              </>
            ) : (
              <>
                <NumberField
                  label="Ancho"
                  value={maskView.width}
                  min={0.05}
                  max={2}
                  step={0.05}
                  onCommit={(value) => patchMask({ width: value })}
                />
                <NumberField
                  label="Alto"
                  value={maskView.height}
                  min={0.05}
                  max={2}
                  step={0.05}
                  onCommit={(value) => patchMask({ height: value })}
                />
                <NumberField
                  label="Rotación (°)"
                  value={maskView.rotationDeg}
                  min={-180}
                  max={180}
                  step={1}
                  onCommit={(value) => patchMask({ rotationDeg: value })}
                />
                <NumberField
                  label="Feather"
                  value={maskView.feather}
                  min={0}
                  max={1}
                  step={0.02}
                  onCommit={(value) => patchMask({ feather: value })}
                />
              </>
            )}
          </div>
          <div className="actions compact">
            <label className="check">
              <input
                type="checkbox"
                checked={mask?.invert ?? false}
                onChange={(event) => patchMask({ invert: event.target.checked })}
              />
              <span>Invertir máscara</span>
            </label>
            <button
              type="button"
              className="small ghost"
              disabled={!mask}
              onClick={() =>
                store.update((current) => updateClip(current, clip.id, { mask: undefined }))
              }
            >
              Quitar máscara
            </button>
          </div>
          {!mask ? (
            <button type="button" className="small" onClick={() => patchMask({})}>
              Crear máscara
            </button>
          ) : null}
          <div className="inspector-meta">
            {maskKeyframe
              ? `Keyframe en ${formatTimecode(maskKeyframe.frame, fps)}`
              : 'Sin keyframe en el playhead'}
          </div>
          <div className="actions compact">
            <button
              type="button"
              className="small"
              disabled={!mask || mask.shape === 'text'}
              onClick={() =>
                store.update((current) =>
                  setMaskKeyframe(current, clip.id, localFrame, maskView),
                )
              }
            >
              {maskKeyframe ? 'Actualizar keyframe' : 'Capturar keyframe'}
            </button>
            <button
              type="button"
              className="small ghost"
              disabled={!mask?.keyframes?.length}
              onClick={() => {
                store.update((current) => clearMaskKeyframes(current, clip.id));
              }}
            >
              Quitar animación
            </button>
          </div>
          {mask?.keyframes?.length ? (
            <div className="keyframe-list">
              {mask.keyframes.map((keyframe) => (
                <div
                  key={keyframe.frame}
                  className={`keyframe-row ${
                    keyframe.frame === localFrame ? 'active' : ''
                  }`}
                >
                  <button
                    type="button"
                    className="small ghost"
                    onClick={() => store.setPlayhead(clip.startFrame + keyframe.frame)}
                  >
                    {formatTimecode(keyframe.frame, fps)}
                  </button>
                  <span className="fine-print">
                    {[
                      `x ${(keyframe.x ?? maskView.x).toFixed(2)}`,
                      `y ${(keyframe.y ?? maskView.y).toFixed(2)}`,
                      `${(keyframe.width ?? maskView.width).toFixed(2)}×${(
                        keyframe.height ?? maskView.height
                      ).toFixed(2)}`,
                      `${(keyframe.rotationDeg ?? maskView.rotationDeg).toFixed(0)}°`,
                    ].join(' · ')}
                  </span>
                  <button
                    type="button"
                    className="small ghost"
                    aria-label={`Quitar keyframe de máscara en ${formatTimecode(
                      keyframe.frame,
                      fps,
                    )}`}
                    onClick={() =>
                      store.update((current) =>
                        removeMaskKeyframe(current, clip.id, keyframe.frame),
                      )
                    }
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          <p className="fine-print">
            Recorta la capa con una forma rectangular o elíptica, posición normalizada,
            rotación y borde suave. Capturá una máscara en un frame, mové el playhead, cambiá
            los valores y capturá otra: la preview y el MP4 interpolan entre keyframes. La
            preview dibuja la rotación con un SVG y el MP4 aplica la máscara por píxel con
            `geq`.
          </p>
        </Section>
      ) : null}

      {visual ? (
        <Section title="Efectos creativos" group="style">
          <p className="fine-print">
            Recetas de un clic que reemplazan el grade del clip y conservan sus
            fades y LUT.
          </p>
          <div className="look-presets" role="group" aria-label="Efectos creativos">
            <span className="appearance-label">Efectos rápidos</span>
            {EFFECT_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className="look-chip"
                onClick={() => applyCreativePreset(preset)}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </Section>
      ) : null}

      {visual ? (
        <Section title="Estilo" group="style">
          <p className="inspector-meta">
            Punto de partida rápido para el look; conserva los fades del clip.
          </p>
          <div className="look-presets" role="group" aria-label="Looks rápidos">
            <span className="appearance-label">Looks rápidos</span>
            {COLOR_LOOKS.map((look) => (
              <button
                key={look.id}
                type="button"
                className="look-chip"
                onClick={() => applyLook({ ...look.effects })}
              >
                {look.label}
              </button>
            ))}
          </div>
        </Section>
      ) : null}

      {isAdjustment ? (
        <Section title="Capa de ajuste" group="color">
          <p className="inspector-meta">
            {track.label} · {formatTimecode(clip.startFrame, fps)} →{' '}
            {formatTimecode(clip.startFrame + clip.durationFrames, fps)}
          </p>
          <p className="fine-print">
            El grade se aplica al compuesto final sólo dentro de este tramo. No modifica los
            clips y no afecta subtítulos ni títulos. Movelo o recortalo en la timeline como
            cualquier clip; el MP4 usa `enable='between(t, …)'`.
          </p>
          <div className="look-presets" role="group" aria-label="Looks rápidos para la capa de ajuste">
            <span className="appearance-label">Looks rápidos</span>
            {COLOR_LOOKS.map((look) => (
              <button
                key={look.id}
                type="button"
                className="look-chip"
                onClick={() => applyLook({ ...look.effects })}
              >
                {look.label}
              </button>
            ))}
          </div>
        </Section>
      ) : null}

      {visual || isAdjustment ? (
        <Section title="Color y efectos" group="color">
          {/* DaVinci Resolve Color Wheels (Lift, Gamma, Gain) */}
          <div className="inspector-color-wheels" role="group" aria-label="Ruedas de color DaVinci">
            <div className="color-wheel-item">
              <span className="color-wheel-label">Lift</span>
              <div className="color-wheel-circle" title="Lift (Sombras)">
                <span className="color-wheel-reticle" />
              </div>
              <span className="color-wheel-sub">Sombras</span>
            </div>
            <div className="color-wheel-item">
              <span className="color-wheel-label">Gamma</span>
              <div className="color-wheel-circle" title="Gamma (Medios tonos)">
                <span className="color-wheel-reticle" />
              </div>
              <span className="color-wheel-sub">Tonos</span>
            </div>
            <div className="color-wheel-item">
              <span className="color-wheel-label">Gain</span>
              <div className="color-wheel-circle" title="Gain (Altas luces)">
                <span className="color-wheel-reticle" />
              </div>
              <span className="color-wheel-sub">Luces</span>
            </div>
          </div>
          <div className="inspector-grid">
            <NumberField
              label="Brillo"
              value={effects.brightness ?? 0}
              min={-1}
              max={1}
              step={0.05}
              onCommit={(value) => setEffect('brightness', value)}
            />
            <NumberField
              label="Contraste"
              value={effects.contrast ?? 1}
              min={0}
              max={3}
              step={0.05}
              onCommit={(value) => setEffect('contrast', value)}
            />
            <NumberField
              label="Saturación"
              value={effects.saturation ?? 1}
              min={0}
              max={3}
              step={0.05}
              onCommit={(value) => setEffect('saturation', value)}
            />
            <NumberField
              label="Temperatura"
              value={effects.temperature ?? 0}
              min={-1}
              max={1}
              step={0.05}
              onCommit={(value) => setEffect('temperature', value)}
            />
            <NumberField
              label="Sombras"
              value={effects.shadows ?? 0}
              min={-1}
              max={1}
              step={0.05}
              onCommit={(value) =>
                setEffect('shadows', value === 0 ? undefined : value)
              }
            />
            <NumberField
              label="Altas luces"
              value={effects.highlights ?? 0}
              min={-1}
              max={1}
              step={0.05}
              onCommit={(value) =>
                setEffect('highlights', value === 0 ? undefined : value)
              }
            />
            <NumberField
              label="Fade tonal"
              value={effects.fade ?? 0}
              min={0}
              max={1}
              step={0.05}
              onCommit={(value) => setEffect('fade', value === 0 ? undefined : value)}
            />
            <NumberField
              label="Rotación de tono (°)"
              value={effects.hueRotateDeg ?? 0}
              min={-180}
              max={180}
              onCommit={(value) => setEffect('hueRotateDeg', value === 0 ? undefined : value)}
            />
            <label className="field">
              <span>Curva de color</span>
              <select
                value={effects.curvePreset ?? ''}
                onChange={(event) =>
                  setEffect(
                    'curvePreset',
                    event.target.value
                      ? (event.target.value as NonNullable<ClipEffects['curvePreset']>)
                      : undefined,
                  )
                }
              >
                <option value="">Ninguna</option>
                <option value="contrast-soft">Contraste suave</option>
                <option value="contrast-medium">Contraste medio</option>
                <option value="contrast-strong">Contraste fuerte</option>
                <option value="vintage">Vintage</option>
                <option value="cross-process">Cross process</option>
                <option value="darker">Oscurecer</option>
                <option value="lighter">Aclarar</option>
              </select>
            </label>
            <NumberField
              label="Viñeta"
              value={effects.vignette ?? 0}
              min={0}
              max={1}
              step={0.05}
              onCommit={(value) => setEffect('vignette', value)}
            />
            <NumberField
              label="Nitidez"
              value={effects.sharpen ?? 0}
              min={0}
              max={5}
              step={0.1}
              onCommit={(value) => setEffect('sharpen', value)}
            />
            <NumberField
              label="Desenfoque"
              value={effects.blur ?? 0}
              min={0}
              max={50}
              step={1}
              onCommit={(value) => setEffect('blur', value)}
            />
            <NumberField
              label="Lente K1"
              value={effects.lensCorrection?.k1 ?? 0}
              min={-1}
              max={1}
              step={0.01}
              onCommit={(value) => setLens({ k1: value })}
            />
            <NumberField
              label="Lente K2"
              value={effects.lensCorrection?.k2 ?? 0}
              min={-1}
              max={1}
              step={0.01}
              onCommit={(value) => setLens({ k2: value })}
            />
            <p className="fine-print">
              Lente K1/K2 corrige la distorsión en el MP4; la preview no la simula y
              los bordes sin datos quedan negros.
            </p>
            {!isAdjustment ? (
              <>
                <NumberField
                  label="Fade in (frames)"
                  value={effects.fadeInFrames ?? 0}
                  min={0}
                  max={clip.durationFrames}
                  onCommit={(value) => setEffect('fadeInFrames', Math.round(value))}
                />
                <NumberField
                  label="Fade out (frames)"
                  value={effects.fadeOutFrames ?? 0}
                  min={0}
                  max={clip.durationFrames}
                  onCommit={(value) => setEffect('fadeOutFrames', Math.round(value))}
                />
              </>
            ) : null}
          </div>
          {!isAdjustment ? (
            <>
              <div className="keyframe-panel">
            <div className="production-card-head">
              <div>
                <p className="eyebrow">Glow / halo</p>
                <span className="fine-print">Halo alrededor de las zonas claras</span>
              </div>
              <label className="check">
                <input
                  type="checkbox"
                  checked={effects.glow !== undefined}
                  onChange={(event) =>
                    setEffect(
                      'glow',
                      event.target.checked
                        ? { intensity: 0.6, radius: 24, threshold: 0.55 }
                        : undefined,
                    )
                  }
                />
                <span>Activar</span>
              </label>
            </div>
            {effects.glow ? (
              <div className="inspector-grid">
                <NumberField
                  label="Intensidad"
                  value={effects.glow.intensity}
                  min={0}
                  max={1}
                  step={0.05}
                  onCommit={(value) => setGlow({ intensity: value })}
                />
                <NumberField
                  label="Radio (px)"
                  value={effects.glow.radius}
                  min={1}
                  max={80}
                  step={1}
                  onCommit={(value) => setGlow({ radius: value })}
                />
                <NumberField
                  label="Umbral"
                  value={effects.glow.threshold}
                  min={0}
                  max={0.95}
                  step={0.05}
                  onCommit={(value) => setGlow({ threshold: value })}
                />
              </div>
            ) : null}
            <p className="fine-print">
              El halo se calcula en el render con las zonas que superan el umbral. La
              preview CSS no lo simula; usá Frame real para verlo.
            </p>
          </div>
          <div className="keyframe-panel">
            <div className="production-card-head">
              <div>
                <p className="eyebrow">Movimiento difuminado</p>
                <span className="fine-print">Estela temporal de 2–12 frames</span>
              </div>
              <label className="check">
                <input
                  type="checkbox"
                  checked={effects.motionBlur !== undefined}
                  onChange={(event) =>
                    setEffect(
                      'motionBlur',
                      event.target.checked
                        ? { frames: 4, intensity: 0.5 }
                        : undefined,
                    )
                  }
                />
                <span>Activar</span>
              </label>
            </div>
            {effects.motionBlur ? (
              <div className="inspector-grid">
                <NumberField
                  label="Frames"
                  value={effects.motionBlur.frames}
                  min={2}
                  max={12}
                  step={1}
                  onCommit={(value) => setMotionBlur({ frames: Math.round(value) })}
                />
                <NumberField
                  label="Intensidad"
                  value={effects.motionBlur.intensity}
                  min={0}
                  max={1}
                  step={0.05}
                  onCommit={(value) => setMotionBlur({ intensity: value })}
                />
              </div>
            ) : null}
            <p className="fine-print">
              Mezcla los frames anteriores en el render; sirve para que un zoom o una
              animación se sientan más naturales. No se aplica a imágenes fijas.
            </p>
          </div>
            </>
          ) : null}
          <div className="color-wheels">
            {(
              [
                ['lift', 'Sombras'],
                ['gamma', 'Medios'],
                ['gain', 'Luces'],
                ['offset', 'Offset'],
              ] as const
            ).map(([kind, label]) => (
              <fieldset className="color-wheel" key={kind}>
                <legend>{label}</legend>
                {(['r', 'g', 'b'] as const).map((channel) => (
                  <NumberField
                    key={channel}
                    label={channel.toUpperCase()}
                    value={effects[kind]?.[channel] ?? 0}
                    min={-1}
                    max={1}
                    step={0.02}
                    onCommit={(value) => setWheel(kind, channel, value)}
                  />
                ))}
              </fieldset>
            ))}
          </div>
          <div className="actions compact">
            <button
              type="button"
              className="small ghost"
              onClick={() => {
                setEffect('lift', undefined);
                setEffect('gamma', undefined);
                setEffect('gain', undefined);
                setEffect('offset', undefined);
              }}
            >
              Neutralizar ruedas
            </button>
          </div>
          <p className="fine-print">
            Sombras y luces usan `colorbalance`; medios usa gamma en `eq`. La preview es
            aproximada, el MP4 aplica los valores exactos.
          </p>
          <div className="keyframe-panel">
            <div className="production-card-head">
              <div>
                <p className="eyebrow">HSL selectivo</p>
                <span className="fine-print">Tono, saturación e intensidad por rango</span>
              </div>
            </div>
            <div className="inspector-grid">
              <NumberField
                label="Tono HSL"
                value={effects.hsl?.hue ?? 0}
                min={-180}
                max={180}
                onCommit={(value) => patchHsl({ hue: value })}
              />
              <NumberField
                label="Saturación HSL"
                value={effects.hsl?.saturation ?? 0}
                min={-1}
                max={1}
                step={0.05}
                onCommit={(value) => patchHsl({ saturation: value })}
              />
              <NumberField
                label="Intensidad HSL"
                value={effects.hsl?.intensity ?? 0}
                min={-1}
                max={1}
                step={0.05}
                onCommit={(value) => patchHsl({ intensity: value })}
              />
            </div>
            <div className="color-range-list">
              {(
                [
                  ['r', 'Rojos'],
                  ['y', 'Amarillos'],
                  ['g', 'Verdes'],
                  ['c', 'Cianes'],
                  ['b', 'Azules'],
                  ['m', 'Magentas'],
                ] as const
              ).map(([key, label]) => {
                const ranges = effects.hsl?.colors ?? ['r', 'y', 'g', 'c', 'b', 'm'];
                return (
                  <label className="check" key={key}>
                    <input
                      type="checkbox"
                      checked={ranges.includes(key)}
                      onChange={() => {
                        const next = ranges.includes(key)
                          ? ranges.filter((value) => value !== key)
                          : [...ranges, key];
                        if (next.length === 0) return;
                        patchHsl({
                          colors:
                            next.length === 6
                              ? undefined
                              : (next as NonNullable<ClipEffects['hsl']>['colors']),
                        });
                      }}
                    />
                    <span>{label}</span>
                  </label>
                );
              })}
            </div>
            <p className="fine-print">
              Usa `huesaturation` con lightness preservada. La selección de rangos se aplica en
              el MP4; la preview aproxima el efecto sobre toda la imagen.
            </p>
          </div>
          {!isAdjustment ? (
          <div className="keyframe-panel">
            <div className="production-card-head">
              <div>
                <p className="eyebrow">Igualar color</p>
                <span className="fine-print">Toma el color de otro material del proyecto</span>
              </div>
              <div className="actions compact">
                <button
                  type="button"
                  className="small"
                  onClick={() => void matchColor()}
                  disabled={matchBusy || !matchRefId || !asset}
                >
                  {matchBusy ? 'Muestreando…' : 'Igualar color'}
                </button>
              </div>
            </div>
            <div className="inspector-grid">
              <label className="field">
                <span>Referencia</span>
                <select
                  value={matchRefId}
                  onChange={(event) => setMatchRefId(event.target.value)}
                >
                  <option value="">Elegí un material…</option>
                  {matchReferences.map((item) => (
                    <option key={item.id} value={item.id}>
                      {friendlyAssetLabel(item.label)}
                    </option>
                  ))}
                </select>
              </label>
              <NumberField
                label="Fuerza"
                value={matchStrength}
                min={0}
                max={1}
                step={0.05}
                onCommit={setMatchStrength}
              />
            </div>
            {effects.colorMatch ? (
              <p className="fine-print">
                Ganancias R {effects.colorMatch.r.toFixed(2)} · G{' '}
                {effects.colorMatch.g.toFixed(2)} · B {effects.colorMatch.b.toFixed(2)} ·{' '}
                <button
                  type="button"
                  className="small ghost"
                  onClick={() => setEffect('colorMatch', undefined)}
                >
                  Quitar
                </button>
              </p>
            ) : (
              <p className="fine-print">
                Muestrea 8×8 px del frame en el playhead y del primer frame de la referencia,
                normaliza el brillo y aplica ganancias por canal. La preview es aproximada.
              </p>
            )}
          </div>
          ) : null}
          <div className="actions compact">
            <label className="check">
              <input
                type="checkbox"
                checked={effects.grayscale ?? false}
                onChange={(event) => setEffect('grayscale', event.target.checked)}
              />
              <span>Blanco y negro</span>
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={effects.sepia ?? false}
                onChange={(event) => setEffect('sepia', event.target.checked)}
              />
              <span>Sepia</span>
            </label>
          </div>
          <div className="keyframe-panel">
            <div className="production-card-head">
              <div>
                <p className="eyebrow">LUT 3D (.cube)</p>
                <span className="fine-print">
                  {effects.lutFile ? effects.lutFile : 'Sin LUT aplicado'}
                </span>
              </div>
              <div className="actions compact">
                <button
                  type="button"
                  className="small"
                  onClick={() => {
                    void (async () => {
                      try {
                        const lut = await store.service.importLut();
                        if (!lut) return;
                        store.update((current) =>
                          updateClip(current, clip.id, {
                            effects: { ...effects, lutFile: lut.path },
                          }),
                        );
                        store.setNotice(`LUT importado: ${lut.name}`);
                      } catch (error) {
                        store.setNotice(
                          error instanceof Error ? error.message : 'no se pudo importar el LUT',
                        );
                      }
                    })();
                  }}
                >
                  Cargar .cube
                </button>
                {effects.lutFile ? (
                  <button
                    type="button"
                    className="small ghost"
                    onClick={() =>
                      store.update((current) =>
                        updateClip(current, clip.id, {
                          effects: { ...effects, lutFile: undefined, lutIntensity: undefined },
                        }),
                      )
                    }
                  >
                    Quitar LUT
                  </button>
                ) : null}
              </div>
            </div>
            {effects.lutFile ? (
              <div className="inspector-grid">
                <NumberField
                  label="Intensidad LUT (%)"
                  value={Math.round((effects.lutIntensity ?? 1) * 100)}
                  min={0}
                  max={100}
                  step={5}
                  onCommit={(value) => setEffect('lutIntensity', value / 100)}
                />
              </div>
            ) : null}
            <p className="fine-print">
              El archivo se copia a `media/luts` del proyecto y FFmpeg lo mezcla con el original
              después del color. La preview no simula el LUT; revisá el MP4.
            </p>
          </div>
          <div className="keyframe-panel">
            <div className="production-card-head">
              <div>
                <p className="eyebrow">Efecto con IA</p>
                <span className="fine-print">Describe el look; la IA devuelve parámetros nativos</span>
              </div>
            </div>
            <label className="field">
              <span>Qué efecto querés</span>
              <input
                value={effectPrompt}
                onChange={(event) => setEffectPrompt(event.target.value)}
                placeholder="cine frío con viñeta y grano suave"
                maxLength={500}
                disabled={effectBusy}
              />
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={effectApproved}
                onChange={(event) => setEffectApproved(event.target.checked)}
                disabled={effectBusy}
              />
              <span>Autorizo una posible llamada con costo al proveedor</span>
            </label>
            <div className="actions compact">
              <button
                type="button"
                className="small primary icon-text"
                onClick={() => void generateEffect()}
                disabled={effectBusy || effectPrompt.trim().length < 3}
              >
                <Icon name="sparkles" size={14} />
                <span>{effectBusy ? 'Generando…' : 'Generar y aplicar'}</span>
              </button>
            </div>
            {effectError ? (
              <p className="notice notice-warning" role="alert">
                {effectError}
              </p>
            ) : null}
          </div>
          <div className="actions compact">
            <button
              type="button"
              className="small ghost"
              onClick={() => void exportLookLut()}
              disabled={Object.keys(effects).length === 0}
              title="Genera una LUT .cube de 33³ con FilmCraft para usar el look en otra app"
            >
              Exportar look .cube
            </button>
            <button
              type="button"
              className="small ghost"
              onClick={() => store.update((current) => updateClip(current, clip.id, { effects: {} }))}
              disabled={Object.keys(effects).length === 0}
            >
              Limpiar color y efectos
            </button>
          </div>
          <p className="fine-print">
            La vista previa aplica color, desenfoque y blanco y negro de forma aproximada; el MP4
            renderiza los ajustes con FFmpeg.
          </p>
        </Section>
      ) : null}

      {visual ? (
        <Section title="Relight por rostro" group="video">
          <p className="fine-print">
            Máscara radial de luz sobre el sujeto. No es un modelo generativo:
            aclara/oscurce y templa la zona elegida en el MP4.
          </p>
          <div className="actions compact">
            <button
              type="button"
              className="small ghost icon-text"
              onClick={() => void detectRelight()}
              disabled={!asset || asset.kind !== 'video' || relightBusy}
            >
              <Icon name="eye" size={14} />
              <span>{relightBusy ? 'Detectando…' : 'Centrar en el rostro'}</span>
            </button>
            {effects.relight ? (
              <button
                type="button"
                className="small ghost"
                onClick={() => setEffect('relight', undefined)}
              >
                Quitar relight
              </button>
            ) : null}
          </div>
          {relightError ? (
            <p className="notice notice-warning" role="alert">
              {relightError}
            </p>
          ) : null}
          <div className="inspector-grid">
            <NumberField
              label="Fuerza"
              value={effects.relight?.strength ?? 0.35}
              min={-1}
              max={1}
              step={0.05}
              onCommit={(value) => setRelight({ strength: value })}
            />
            <NumberField
              label="Calidez"
              value={effects.relight?.warmth ?? 0.08}
              min={-1}
              max={1}
              step={0.05}
              onCommit={(value) => setRelight({ warmth: value })}
            />
            <NumberField
              label="Radio"
              value={effects.relight?.radius ?? 0.45}
              min={0.05}
              max={1}
              step={0.05}
              onCommit={(value) => setRelight({ radius: value })}
            />
            <NumberField
              label="Centro X"
              value={effects.relight?.x ?? 0}
              min={-1}
              max={1}
              step={0.05}
              onCommit={(value) => setRelight({ x: value })}
            />
            <NumberField
              label="Centro Y"
              value={effects.relight?.y ?? 0}
              min={-1}
              max={1}
              step={0.05}
              onCommit={(value) => setRelight({ y: value })}
            />
          </div>
          <p className="fine-print">
            Sólo se renderiza en el MP4; la preview no muestra el cambio. El
            `geq` por píxel puede ser lento en 4K.
          </p>
        </Section>
      ) : null}

      {clip.kind === 'video' ? (
        <Section title="Análisis de escenas" group="video">
          <label className="field">
            <span>Sensibilidad al cambio de escena</span>
            <select
              value={sceneThreshold}
              onChange={(event) => setSceneThreshold(Number(event.target.value))}
            >
              <option value={0.2}>Alta (0.20)</option>
              <option value={0.35}>Media (0.35)</option>
              <option value={0.5}>Baja (0.50)</option>
              <option value={0.65}>Muy baja (0.65)</option>
            </select>
          </label>
          <div className="actions compact">
            <button
              type="button"
              className="small"
              onClick={() => void analyzeScenes()}
              disabled={sceneBusy || !asset || asset.kind !== 'video'}
            >
              {sceneBusy ? 'Analizando…' : 'Detectar escenas'}
            </button>
            <button
              type="button"
              className="small primary"
              onClick={applySceneCuts}
              disabled={sceneTimelineCuts.length === 0}
            >
              Dividir en {sceneTimelineCuts.length + 1} clips
            </button>
          </div>
          {sceneTimelineCuts.length > 0 ? (
            <p className="inspector-meta">
              {sceneTimelineCuts
                .slice(0, 8)
                .map((frame) => formatTimecode(frame, fps))
                .join(' · ')}
              {sceneTimelineCuts.length > 8 ? ' · …' : ''}
            </p>
          ) : (
            <p className="fine-print">
              FFmpeg analiza el video localmente. Si no detecta cortes, bajá la sensibilidad o
              dividí a mano.
            </p>
          )}
        </Section>
      ) : null}

      {clip.kind === 'video' || clip.kind === 'audio' ? (
        <Section title="Audio del clip" group="audio">
          <label className="check">
            <input
              type="checkbox"
              checked={audio.muted === true}
              onChange={(event) =>
                patchAudio({ muted: event.target.checked ? true : undefined })
              }
            />
            <span>Silenciar este clip</span>
          </label>
          <p className="fine-print">
            Apaga sólo el audio de este clip; la pista y los demás clips siguen sonando.
          </p>
          {clip.kind === 'video' ? (
            <div className="actions compact">
              <button
                type="button"
                className="small"
                onClick={() => {
                  const result = store.mutate((current) => detachAudio(current, clip.id));
                  if (!result) return;
                  store.setSelection({ kind: 'clip', id: result.clipId });
                  store.setNotice(
                    result.createdTrack
                      ? 'Audio separado en una pista nueva; el video quedó en silencio.'
                      : 'Audio separado a una pista libre; el video quedó en silencio.',
                  );
                }}
              >
                Separar audio
              </button>
            </div>
          ) : null}
          <div className="inspector-grid">
            <NumberField
              label="Ganancia (dB)"
              value={audio.gainDb ?? 0}
              min={-60}
              max={12}
              step={0.5}
              onCommit={(value) => patchAudio({ gainDb: value })}
            />
            <NumberField
              label="High-pass (Hz)"
              value={audio.highPassHz ?? 0}
              min={0}
              max={2_000}
              step={10}
              onCommit={(value) => patchAudio({ highPassHz: value > 20 ? value : undefined })}
            />
            <NumberField
              label="Low-pass (Hz)"
              value={audio.lowPassHz ?? 0}
              min={0}
              max={20_000}
              step={100}
              onCommit={(value) => patchAudio({ lowPassHz: value > 1_000 ? value : undefined })}
            />
            <NumberField
              label="EQ graves (dB)"
              value={audio.eqLowDb ?? 0}
              min={-12}
              max={12}
              step={0.5}
              onCommit={(value) => patchAudio({ eqLowDb: value })}
            />
            <NumberField
              label="EQ medios (dB)"
              value={audio.eqMidDb ?? 0}
              min={-12}
              max={12}
              step={0.5}
              onCommit={(value) => patchAudio({ eqMidDb: value })}
            />
            <NumberField
              label="EQ agudos (dB)"
              value={audio.eqHighDb ?? 0}
              min={-12}
              max={12}
              step={0.5}
              onCommit={(value) => patchAudio({ eqHighDb: value })}
            />
            <NumberField
              label="Reducción de ruido (%)"
              value={Math.round((audio.denoise ?? 0) * 100)}
              min={0}
              max={100}
              step={5}
              onCommit={(value) =>
                patchAudio({ denoise: value > 0 ? value / 100 : undefined })
              }
            />
            <NumberField
              label="Puerta de ruido (dB)"
              value={audio.gateDb ?? -60}
              min={-60}
              max={-10}
              step={1}
              onCommit={(value) => patchAudio({ gateDb: value > -60 ? value : undefined })}
            />
            <NumberField
              label="Fade in (frames)"
              value={audio.fadeInFrames ?? 0}
              min={0}
              onCommit={(value) => patchAudio({ fadeInFrames: Math.round(value) })}
            />
            <NumberField
              label="Fade out (frames)"
              value={audio.fadeOutFrames ?? 0}
              min={0}
              onCommit={(value) => patchAudio({ fadeOutFrames: Math.round(value) })}
            />
          </div>
          <label className="field">
            <span>Efecto de voz (render)</span>
            <select
              value={audio.voiceEffect ?? 'none'}
              onChange={(event) =>
                patchAudio({
                  voiceEffect:
                    event.target.value === 'none'
                      ? undefined
                      : (event.target.value as NonNullable<
                          NonNullable<Clip['audio']>['voiceEffect']
                        >),
                })
              }
            >
              <option value="none">Sin efecto</option>
              <option value="deep">Voz grave</option>
              <option value="chipmunk">Voz aguda</option>
              <option value="robot">Robot</option>
              <option value="echo">Eco</option>
              <option value="cave">Cueva</option>
              <option value="radio">Radio / teléfono</option>
            </select>
          </label>
          <p className="fine-print">
            El efecto se aplica en el render con filtros locales (`asetrate`, `aecho`, `vibrato`,
            high/low-pass). La preview reproduce la voz original.
          </p>
          <div className="actions compact">
            <label className="check">
              <input
                type="checkbox"
                checked={audio.compressor ?? false}
                onChange={(event) => patchAudio({ compressor: event.target.checked })}
              />
              <span>Compresor</span>
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={audio.deesser ?? false}
                onChange={(event) => patchAudio({ deesser: event.target.checked })}
              />
              <span>De-esser</span>
            </label>
            <button
              type="button"
              className="small"
              onClick={() =>
                patchAudio({
                  highPassHz: 80,
                  lowPassHz: 16_000,
                  eqLowDb: -2,
                  eqMidDb: 3,
                  eqHighDb: 2,
                  compressor: true,
                  deesser: true,
                  denoise: 0.15,
                })
              }
            >
              Voz clara
            </button>
            <button
              type="button"
              className="small"
              onClick={() =>
                patchAudio({
                  highPassHz: 40,
                  eqLowDb: 2,
                  eqMidDb: 0,
                  eqHighDb: 1,
                  compressor: false,
                  denoise: 0,
                })
              }
            >
              Música
            </button>
            <button
              type="button"
              className="small primary"
              onClick={() => void transcribeClip()}
              disabled={transcribeBusy || !asset || (asset.kind !== 'audio' && asset.kind !== 'video')}
            >
              {transcribeBusy ? 'Transcribiendo…' : 'Transcribir a subtítulos'}
            </button>
            <button
              type="button"
              className="small ghost"
              onClick={() => store.update((current) => updateClip(current, clip.id, { audio: {} }))}
            >
              Limpiar audio
            </button>
          </div>
          <div className="keyframe-panel">
            <div className="production-card-head">
              <div>
                <p className="eyebrow">Automatización de volumen</p>
                <span className="fine-print">
                  {gainKeyframes.length} clave(s) · playhead {formatTimecode(localFrame, fps)}
                </span>
              </div>
              <div className="actions compact">
                <button
                  type="button"
                  className="small"
                  onClick={() =>
                    store.update((current) =>
                      setGainKeyframe(
                        current,
                        clip.id,
                        localFrame,
                        clipGainAtFrame(clip, localFrame),
                      ),
                    )
                  }
                >
                  Fijar en playhead
                </button>
                <button
                  type="button"
                  className="small ghost"
                  disabled={gainKeyframes.length === 0}
                  onClick={() => store.update((current) => clearGainKeyframes(current, clip.id))}
                >
                  Quitar animación
                </button>
              </div>
            </div>
            {gainKeyframes.length === 0 ? (
              <p className="fine-print">
                La ganancia sigue el valor estático. Fijá claves para subir o bajar el volumen
                entre puntos; el render usa `volume` evaluado por frame.
              </p>
            ) : (
              <div className="keyframe-list">
                {gainKeyframes.map((keyframe) => (
                  <div key={keyframe.frame} className="keyframe-row">
                    <span className="fine-print">{formatTimecode(keyframe.frame, fps)}</span>
                    <span className="fine-print">{keyframe.gainDb.toFixed(1)} dB</span>
                    <select
                      value={keyframe.easing ?? 'linear'}
                      aria-label={`Curva de volumen en ${formatTimecode(keyframe.frame, fps)}`}
                      onChange={(event) =>
                        store.update((current) =>
                          setGainKeyframe(
                            current,
                            clip.id,
                            keyframe.frame,
                            keyframe.gainDb,
                            event.target.value as KeyframeEasing,
                          ),
                        )
                      }
                    >
                      <option value="linear">Lineal</option>
                      <option value="ease-in">Acelerar</option>
                      <option value="ease-out">Desacelerar</option>
                      <option value="ease-in-out">Suave</option>
                      <option value="hold">Mantener</option>
                    </select>
                    <button
                      type="button"
                      className="small ghost"
                      aria-label={`Quitar clave de volumen en ${formatTimecode(keyframe.frame, fps)}`}
                      onClick={() =>
                        store.update((current) =>
                          removeGainKeyframe(current, clip.id, keyframe.frame),
                        )
                      }
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <p className="fine-print">
            Filtros y compresor se aplican en el render con FFmpeg. La reducción de ruido usa
            `afftdn` y conviene probarla en el MP4; no reemplaza un modelo de voice isolation.
          </p>
          <p className="fine-print">
            {transcribeInfo
              ? `Transcripción: ${transcribeInfo}. Revisá nombres y puntuación antes de publicar.`
              : 'La transcripción usa Faster-Whisper local (modelo small) y reemplaza los subtítulos que se solapen con este clip. Puede tardar.'}
          </p>
        </Section>
      ) : null}

      {clip.kind === 'audio' ? (
        <Section title="Ritmo" group="audio">
          <p className="fine-print">
            Analiza los golpes del audio en la máquina (sin red) y corta la pista de video en
            esos frames. Es detección de energía, no un modelo de IA: si el pulso no es regular,
            elegí un pulso de cada N.
          </p>
          <div className="actions compact">
            <button
              type="button"
              className="small"
              onClick={() => void analyzeBeats()}
              disabled={beatBusy || !asset}
            >
              {beatBusy ? 'Analizando…' : 'Analizar ritmo'}
            </button>
          </div>
          {beatAnalysis ? (
            <p className="fine-print">
              ≈ {beatAnalysis.bpm} BPM · {beatAnalysis.beatsSeconds.length} pulsos · confianza{' '}
              {Math.round(beatAnalysis.confidence * 100)}%
            </p>
          ) : null}
          <div className="inspector-grid">
            <label className="field">
              <span>Cortar cada</span>
              <select
                value={beatStride}
                onChange={(event) => setBeatStride(Number(event.target.value))}
              >
                {[1, 2, 4, 8].map((value) => (
                  <option key={value} value={value}>
                    {value} pulso{value === 1 ? '' : 's'}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="actions compact">
            <button
              type="button"
              className="small"
              onClick={cutVideoToBeat}
              disabled={!beatAnalysis || beatAnalysis.beatsSeconds.length === 0 || beatBusy}
            >
              Cortar video al ritmo
            </button>
          </div>
          {beatInfo ? <p className="fine-print">{beatInfo}</p> : null}
        </Section>
      ) : null}
    </div>
  );
}

function trackKind(clip: Clip): Track['kind'] {
  switch (clip.kind) {
    case 'video':
      return 'video';
    case 'image':
      return 'image';
    case 'audio':
      return 'audio';
    case 'graphic':
      return 'graphic';
    case 'adjustment':
      return 'adjustment';
    case 'compound':
      return 'video';
    case 'freeze':
      return 'video';
  }
}

function TrackInspector({ track }: { track: Track }) {
  const store = useProjectStore();
  const sorted = [...(store.state.project?.timeline.tracks ?? [])].sort(
    (a, b) => a.order - b.order,
  );
  const index = sorted.findIndex((item) => item.id === track.id);
  const canMoveUp = index >= 0 && index < sorted.length - 1;
  const canMoveDown = index > 0;
  return (
    <Section title="Pista">
      <TextField
        label="Nombre"
        value={track.label}
        maxLength={120}
        onCommit={(value) => store.update((current) => updateTrack(current, track.id, { label: value }))}
      />
      <p className="inspector-meta">
        {trackKindLabel(track.kind)} · orden {track.order}
      </p>
      {track.kind === 'video' || track.kind === 'audio' || track.kind === 'narration' ? (
        <>
          <NumberField
            label="Ganancia de pista (dB)"
            value={track.gainDb ?? 0}
            min={-60}
            max={12}
            step={0.5}
            onCommit={(value) =>
              store.update((current) => updateTrack(current, track.id, { gainDb: value }))
            }
          />
          <p className="inspector-meta">
            Se suma a la ganancia de cada clip y se aplica en la preview y en el render.
          </p>
        </>
      ) : null}
      <div className="flag-row">
        <label className="check">
          <input
            type="checkbox"
            checked={track.muted}
            onChange={(event) => store.update((current) => updateTrack(current, track.id, { muted: event.target.checked }))}
          />
          <span>Silenciada</span>
        </label>
        {track.kind === 'video' || track.kind === 'audio' || track.kind === 'narration' ? (
          <label className="check">
            <input
              type="checkbox"
              checked={track.solo === true}
              onChange={(event) =>
                store.update((current) => updateTrack(current, track.id, { solo: event.target.checked }))
              }
            />
            <span>Solo</span>
          </label>
        ) : null}
        <label className="check">
          <input
            type="checkbox"
            checked={track.hidden}
            onChange={(event) => store.update((current) => updateTrack(current, track.id, { hidden: event.target.checked }))}
          />
          <span>Oculta</span>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={track.locked}
            onChange={(event) => store.update((current) => updateTrack(current, track.id, { locked: event.target.checked }))}
          />
          <span>Bloqueada</span>
        </label>
      </div>
      <div className="actions compact">
        <button
          type="button"
          className="small"
          disabled={!canMoveUp}
          onClick={() => store.update((current) => moveTrack(current, track.id, 'up'))}
        >
          Subir capa
        </button>
        <button
          type="button"
          className="small"
          disabled={!canMoveDown}
          onClick={() => store.update((current) => moveTrack(current, track.id, 'down'))}
        >
          Bajar capa
        </button>
        <button
          type="button"
          className="small"
          disabled={track.locked}
          onClick={() => {
            try {
              const current = store.state.project;
              if (!current) return;
              const result = closeGaps(current, track.id);
              if (result.moved === 0) {
                store.setNotice('La pista no tiene huecos entre clips.');
                return;
              }
              store.update(() => result.project);
              store.setNotice(
                `Huecos cerrados: ${result.moved} clip(s), ${(result.removedFrames / fpsOf(result.project)).toFixed(2)} s.`,
              );
            } catch (error) {
              store.setNotice(
                error instanceof Error ? error.message : 'no se pudieron cerrar los huecos',
              );
            }
          }}
        >
          Cerrar huecos
        </button>
        <button
          type="button"
          className="small danger-ghost"
          onClick={() => {
            store.update((current) => deleteTrack(current, track.id));
            store.setSelection({ kind: 'none' });
          }}
        >
          Borrar pista vacía
        </button>
      </div>
    </Section>
  );
}

function CueInspector({ cue }: { cue: CaptionCue }) {
  const store = useProjectStore();
  const project = store.state.project;
  if (!project) return null;
  const fps = fpsOf(project);
  return (
    <Section title="Subtítulo">
      <TextAreaField
        label="Texto"
        value={cue.text}
        maxLength={500}
        emoji
        onCommit={(value) => store.update((current) => updateCaptionCue(current, cue.id, { text: value }))}
      />
      <div className="inspector-grid">
        <NumberField
          label="Inicio (frame)"
          value={cue.startFrame}
          min={0}
          onCommit={(value) => store.update((current) => updateCaptionCue(current, cue.id, { startFrame: value }))}
        />
        <NumberField
          label="Fin (frame)"
          value={cue.endFrame}
          min={1}
          onCommit={(value) => store.update((current) => updateCaptionCue(current, cue.id, { endFrame: value }))}
        />
      </div>
      <p className="inspector-meta">
        {formatTimecode(cue.startFrame, fps)} → {formatTimecode(cue.endFrame, fps)} · {cue.language}
      </p>
      <label className="field">
        <span>Estilo</span>
        <select
          value={cue.styleId ?? ''}
          onChange={(event) => store.update((current) => updateCaptionCue(current, cue.id, { styleId: event.target.value }))}
        >
          {project.captions.styles.map((style) => (
            <option key={style.id} value={style.id}>
              {style.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Animación</span>
        <select
          value={cue.animation ?? 'none'}
          onChange={(event) =>
            store.update((current) =>
              updateCaptionCue(current, cue.id, {
                animation: event.target.value as CaptionCue['animation'],
              }),
            )
          }
        >
          <option value="none">Sin animación</option>
          <option value="fade">Aparición suave</option>
          <option value="pop">Pop</option>
          <option value="slide-up">Subir</option>
        </select>
      </label>
      <label className="field">
        <span>Movimiento</span>
        <select
          value={cue.motion ? (cue.motion.preset ?? 'custom') : 'none'}
          disabled={Boolean(cue.words && cue.words.length > 1)}
          onChange={(event) => {
            const value = event.target.value;
            if (value === 'none') {
              store.update((current) =>
                updateCaptionCue(current, cue.id, { motion: null }),
              );
            } else if (value !== 'custom') {
              store.update((current) =>
                updateCaptionCue(current, cue.id, {
                  motion: captionMotionPreset(
                    value as CaptionMotionPreset,
                    cue.endFrame - cue.startFrame,
                  ),
                }),
              );
            }
          }}
        >
          <option value="none">Sin movimiento</option>
          <option value="fade">Aparecer</option>
          <option value="zoom">Zoom de entrada</option>
          <option value="slide-left">Entrar desde la izquierda</option>
          <option value="slide-right">Entrar desde la derecha</option>
          <option value="zoom-out">Salir con zoom</option>
          {cue.motion && !cue.motion.preset ? (
            <option value="custom">Personalizado</option>
          ) : null}
        </select>
      </label>
      <p className="fine-print">
        Dos claves (inicio y fin del cue) para posición, escala, rotación y opacidad. Se
        renderiza en ASS y la preview lo aproxima. No se aplica a subtítulos con palabras
        animadas.
      </p>
      <label className="check">
        <input
          type="checkbox"
          checked={cue.wordReveal ?? false}
          onChange={(event) =>
            store.update((current) =>
              updateCaptionCue(current, cue.id, {
                wordReveal: event.target.checked,
              }),
            )
          }
        />
        <span>Revelar por palabra</span>
      </label>
      <p className="fine-print">
        Muestra el texto a medida que cada palabra empieza. Necesita palabras con
        tiempos (por ejemplo, una transcripción); sin ellos se muestra la línea
        completa. En el MP4 se emiten eventos ASS incrementales.
      </p>
      <div className="actions compact">
        <button
          type="button"
          className="small danger-ghost"
          onClick={() => {
            store.update((current) => deleteCaptionCue(current, cue.id));
            store.setSelection({ kind: 'none' });
          }}
        >
          Borrar subtítulo
        </button>
      </div>
    </Section>
  );
}

function AssetInspector({ asset }: { asset: Asset }) {
  const store = useProjectStore();
  const [proxyBusy, setProxyBusy] = useState(false);
  const proxy =
    'proxy' in asset ? (asset as Asset & { proxy?: AssetProxy }).proxy : undefined;
  const alphaCutout = asset.kind === 'video' && asset.media?.alpha === true;

  async function createProxy(): Promise<void> {
    if (alphaCutout) {
      store.setNotice(
        'Este recorte tiene transparencia; un proxy H.264 la perdería. Se usa el WebM original.',
      );
      return;
    }
    setProxyBusy(true);
    try {
      const created = await store.service.createVideoProxy({ path: asset.source.path });
      if (!created.path) throw new Error('el proxy no devolvió una ruta');
      store.update((current) => setAssetProxy(current, asset.id, created));
      store.setNotice(
        `Proxy ${created.width}×${created.height} listo para la preview (${(
          created.bytes / 1_000_000
        ).toFixed(1)} MB).`,
      );
    } catch (error) {
      store.setNotice(error instanceof Error ? error.message : 'no se pudo crear el proxy');
    } finally {
      setProxyBusy(false);
    }
  }

  return (
    <>
      <Section title="Material">
        <TextField
          label="Nombre"
          value={asset.label}
          maxLength={200}
          onCommit={(value) => store.update((current) => updateAssetLabel(current, asset.id, value))}
        />
        <p className="inspector-meta">
          {assetKindLabel(asset.kind)} · {mediaInfo(asset)}
        </p>
        <p className="inspector-meta">
          {asset.source.type === 'local' ? `local · ${asset.source.path}` : asset.source.type}
        </p>
        <p className="inspector-meta">
          Licencia {asset.rights.license.id} · {asset.rights.license.commercialUse} ·{' '}
          {assetStatusLabel(asset.status)}
        </p>
        {asset.status !== 'ready' ? (
          <div className="actions compact">
            <button
              type="button"
              className="small"
              onClick={() => store.update((current) => markAssetReady(current, asset.id, 'allowed'))}
            >
              Uso permitido
            </button>
            <button
              type="button"
              className="small"
              onClick={() => store.update((current) => markAssetReady(current, asset.id, 'requires-attribution'))}
            >
              Requiere atribución
            </button>
          </div>
        ) : (
          <div className="actions compact">
            <button
              type="button"
              className="small"
              disabled={asset.kind === 'font' || asset.kind === 'text'}
              onClick={() => {
                const result = store.mutate((current) =>
                  addClipFromAsset(current, asset, { atFrame: store.state.playheadFrame }),
                );
                if (result) store.setSelection({ kind: 'clip', id: result.clipId });
              }}
            >
              Montar en playhead
            </button>
            <button
              type="button"
              className="small danger-ghost"
              onClick={() => store.update((current) => removeAsset(current, asset.id))}
            >
              Quitar de la biblioteca
            </button>
          </div>
        )}
      </Section>
      <Section title="Organización">
        <label className="check">
          <input
            type="checkbox"
            checked={asset.favorite ?? false}
            onChange={(event) =>
              store.update((current) =>
                updateAssetMetadata(current, asset.id, {
                  favorite: event.target.checked,
                }),
              )
            }
          />
          <span>Favorito</span>
        </label>
        <TextField
          label="Bin"
          value={asset.bin ?? ''}
          maxLength={40}
          onCommit={(value) =>
            store.update((current) =>
              updateAssetMetadata(current, asset.id, { bin: value }),
            )
          }
        />
        <TextField
          label="Etiquetas (coma)"
          value={(asset.tags ?? []).join(', ')}
          maxLength={200}
          onCommit={(value) =>
            store.update((current) =>
              updateAssetMetadata(current, asset.id, { tags: value.split(',') }),
            )
          }
        />
        <p className="fine-print">
          Hasta 8 etiquetas de 24 caracteres. El bin y las etiquetas se pueden
          filtrar en Medios y en el rail del editor.
        </p>
      </Section>
      {asset.kind === 'video' ? (
        <Section title="Proxy de edición">
          {alphaCutout ? (
            <p className="fine-print">
              Este recorte tiene canal alfa; un proxy H.264 perdería la transparencia. La
              preview y el export usan el WebM VP9 original.
            </p>
          ) : (
            <>
              <p className="inspector-meta">
                {proxy
                  ? `${proxy.width}×${proxy.height} · ${(proxy.bytes / 1_000_000).toFixed(1)} MB`
                  : 'Sin proxy; la preview usa el video original.'}
              </p>
              <div className="actions compact">
                <button
                  type="button"
                  className="small"
                  onClick={() => void createProxy()}
                  disabled={proxyBusy}
                >
                  {proxyBusy ? 'Creando proxy…' : proxy ? 'Regenerar proxy' : 'Crear proxy'}
                </button>
                {proxy ? (
                  <button
                    type="button"
                    className="small ghost"
                    onClick={() =>
                      store.update((current) => setAssetProxy(current, asset.id, undefined))
                    }
                  >
                    Quitar proxy
                  </button>
                ) : null}
              </div>
              <p className="fine-print">
                El proxy se usa sólo en la preview para aligerar la reproducción; el MP4 final
                se renderiza siempre desde el archivo original.
              </p>
            </>
          )}
        </Section>
      ) : null}
    </>
  );
}

function SceneInspector({ scene }: { scene: Scene }) {
  return (
    <Section title="Escena">
      <p className="inspector-meta">
        {scene.title} · {scene.intent} · {scene.status}
      </p>
      <p className="inspector-text">{scene.narration.text ?? 'sin narración escrita'}</p>
      {scene.narration.assetId ? (
        <p className="inspector-meta">Narración vinculada a un asset del proyecto.</p>
      ) : null}
      <p className="fine-print">Editá el guion completo desde la vista Guion.</p>
    </Section>
  );
}

function ProjectInspector() {
  const store = useProjectStore();
  const project = store.state.project;
  const [cueText, setCueText] = useState('');
  const [titleText, setTitleText] = useState('');
  const cueInputRef = useRef<HTMLInputElement | null>(null);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const [subtitleIo, setSubtitleIo] = useState<'closed' | 'import' | 'export'>('closed');
  const [subtitleDraft, setSubtitleDraft] = useState('');
  const [subtitleWarnings, setSubtitleWarnings] = useState<string[]>([]);
  const currentFpsNum = project?.video.frameRate.num ?? 30;
  const currentFpsDen = project?.video.frameRate.den ?? 1;
  const currentFpsPreset = FPS_PRESETS.find(
    (preset) => preset.num === currentFpsNum && preset.den === currentFpsDen,
  );
  const [customFps, setCustomFps] = useState(!currentFpsPreset);
  const [fpsDraft, setFpsDraft] = useState({ num: currentFpsNum, den: currentFpsDen });
  useEffect(() => {
    setFpsDraft({ num: currentFpsNum, den: currentFpsDen });
    setCustomFps(!FPS_PRESETS.some((preset) => preset.num === currentFpsNum && preset.den === currentFpsDen));
  }, [currentFpsNum, currentFpsDen]);
  if (!project) return null;
  const activeProject = project;
  const fps = project.video.frameRate.num / project.video.frameRate.den;
  const look = project.look ?? {};
  const sortedMarkers = [...project.markers].sort((a, b) => a.frame - b.frame);
  const markerChapters = formatMarkerChapters(project.markers, fps);
  const chapterValidation = validateChapters(chaptersFromMarkers(project.markers, fps));

  function insertIntoCue(emojiValue: string): void {
    const input = cueInputRef.current;
    const next = insertEmoji(
      cueText,
      emojiValue,
      input?.selectionStart ?? cueText.length,
      input?.selectionEnd ?? cueText.length,
    );
    setCueText(next.value);
    window.requestAnimationFrame(() => {
      cueInputRef.current?.focus();
      cueInputRef.current?.setSelectionRange(next.cursor, next.cursor);
    });
  }

  function insertIntoTitle(emojiValue: string): void {
    const input = titleInputRef.current;
    const next = insertEmoji(
      titleText,
      emojiValue,
      input?.selectionStart ?? titleText.length,
      input?.selectionEnd ?? titleText.length,
    );
    setTitleText(next.value);
    window.requestAnimationFrame(() => {
      titleInputRef.current?.focus();
      titleInputRef.current?.setSelectionRange(next.cursor, next.cursor);
    });
  }

  function addMarkerAtPlayhead(): void {
    store.update((current) => addMarker(current, store.state.playheadFrame).project);
  }

  function createMarkersFromScenes(): void {
    const current = store.state.project;
    if (!current) return;
    try {
      const result = markersFromScenes(current);
      if (result.added === 0) {
        store.setNotice('Ninguna escena aportó un marcador nuevo.');
        return;
      }
      store.update(() => result.project);
      store.setNotice(
        `${result.added} marcador(es) desde escenas.${
          result.skipped > 0 ? ` ${result.skipped} escena(s) salteada(s).` : ''
        }`,
      );
    } catch (error) {
      store.setNotice(
        error instanceof Error ? error.message : 'no se pudieron crear los marcadores',
      );
    }
  }

  function applyAudioPreset(preset: AudioPresetId): void {
    const current = store.state.project;
    if (!current) return;
    try {
      const result = applyAudioPresetToAll(current, preset);
      if (result.applied === 0) {
        store.setNotice('No hay clips de audio en pistas desbloqueadas.');
        return;
      }
      store.update(() => result.project);
      const label = AUDIO_PRESETS.find((item) => item.id === preset)?.label ?? preset;
      store.setNotice(
        `${label} aplicado a ${result.applied} clip(s) de audio.${
          result.skipped > 0 ? ` ${result.skipped} en pistas bloqueadas.` : ''
        }`,
      );
    } catch (error) {
      store.setNotice(
        error instanceof Error ? error.message : 'no se pudo aplicar el preset de audio',
      );
    }
  }

  function dissolveCuts(): void {    const current = store.state.project;
    if (!current) return;
    try {
      const result = applyTransitionToCuts(current, {
        type: 'dissolve',
        frames: 12,
      });
      if (result.applied === 0) {
        store.setNotice('No hay cortes contiguos de video o imagen para disolver.');
        return;
      }
      store.update(() => result.project);
      store.setNotice(`${result.applied} corte(s) con disolvencia de 12 frames.`);
    } catch (error) {
      store.setNotice(
        error instanceof Error ? error.message : 'no se pudieron aplicar las disolvencias',
      );
    }
  }

  function cutClipsAtMarkers(): void {    const current = store.state.project;
    if (!current) return;
    try {
      const result = splitClipsAtMarkers(current);
      if (result.cuts === 0) {
        store.setNotice('Ningún clip cruza los marcadores.');
        return;
      }
      store.update(() => result.project);
      store.setNotice(
        `${result.cuts} corte(s) en ${result.clips} clip(s).${
          result.skippedTracks > 0
            ? ` ${result.skippedTracks} pista(s) bloqueada(s) sin tocar.`
            : ''
        }`,
      );
    } catch (error) {
      store.setNotice(
        error instanceof Error ? error.message : 'no se pudieron cortar los clips',
      );
    }
  }

  async function copyMarkerChapters(): Promise<void> {
    if (!markerChapters) {
      store.setNotice('Agregá al menos un marcador para exportar capítulos.');
      return;
    }
    try {
      await navigator.clipboard.writeText(markerChapters);
      store.setNotice('Capítulos copiados al portapapeles.');
    } catch {
      store.setNotice('No se pudo copiar; descargá el .txt o copiá la vista previa.');
    }
  }

  function downloadMarkerChapters(): void {
    if (!markerChapters) return;
    const blob = new Blob([markerChapters], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${activeProject.name.replace(/[^a-zA-Z0-9-_]+/g, '-') || 'capitulos'}-capitulos.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function patchLook(patch: Partial<ClipEffects>): void {
    store.update((current) => updateProjectLook(current, patch));
  }

  function exportSubtitles(): void {
    const captionTracks = new Set(
      activeProject.timeline.tracks
        .filter((track) => track.kind === 'caption' && track.label !== 'Títulos')
        .map((track) => track.id),
    );
    const cues = activeProject.captions.cues
      .filter((cue) => captionTracks.has(cue.trackId))
      .map((cue) => ({
        startFrame: cue.startFrame,
        endFrame: cue.endFrame,
        text: cue.text,
      }));
    if (cues.length === 0) {
      store.setNotice('No hay subtítulos en la pista principal para exportar.');
      return;
    }
    setSubtitleDraft(serializeSrt(cues, fps));
    setSubtitleWarnings([]);
    setSubtitleIo('export');
  }

  async function copySubtitleDraft(): Promise<void> {
    try {
      await navigator.clipboard.writeText(subtitleDraft);
      store.setNotice('Subtítulos copiados al portapapeles.');
    } catch {
      store.setNotice('No se pudo copiar; seleccioná el texto y copialo manualmente.');
    }
  }

  function downloadSubtitleDraft(): void {
    const blob = new Blob([subtitleDraft], { type: 'application/x-subrip;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${activeProject.name.replace(/[^a-zA-Z0-9-_]+/g, '-') || 'subtitulos'}.srt`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function pickSubtitleFile(): Promise<void> {
    try {
      const picked = await store.service.chooseSubtitleFile();
      if (!picked) return;
      const parsed = parseSubtitles(picked.text);
      setSubtitleDraft(picked.text);
      setSubtitleWarnings(parsed.warnings);
      setSubtitleIo('import');
      store.setNotice(
        `${picked.name}: ${parsed.cues.length} subtítulos detectados; revisá y confirmá la importación.`,
      );
    } catch (error) {
      store.setNotice(
        error instanceof Error
          ? error.message
          : 'no se pudo leer el archivo de subtítulos',
      );
    }
  }

  function importSubtitles(): void {
    const parsed = parseSubtitles(subtitleDraft);
    if (parsed.cues.length === 0) {
      setSubtitleWarnings(
        parsed.warnings.length > 0
          ? parsed.warnings
          : ['No se encontraron subtítulos válidos en el texto.'],
      );
      return;
    }
    if (
      !window.confirm(
        'Se reemplazarán los subtítulos de la pista principal. Los títulos se conservan. ¿Continuar?',
      )
    ) {
      return;
    }
    const result = store.mutate((current) =>
      importSubtitleCues(current, parsed.cues, { replace: true }),
    );
    if (result) {
      store.setNotice(
        `Importados ${result.added} subtítulos${result.skipped > 0 ? `; ${result.skipped} omitidos` : ''}.`,
      );
    }
    setSubtitleWarnings(parsed.warnings);
    setSubtitleDraft('');
    setSubtitleIo('closed');
  }

  const style = project.captions.styles[0];
  const ratio = aspectRatioOf(project.video.width, project.video.height);
  const formatPreset = FORMAT_PRESETS.find(
    (preset) => preset.width === project.video.width && preset.height === project.video.height,
  );
  const hasSpeedClip = project.timeline.clips.some((clip) => {
    const speed = (clip as { speed?: { num: number; den: number } }).speed;
    return speed !== undefined && speed.num !== speed.den;
  });

  function changeFormat(id: string): void {
    const preset = FORMAT_PRESETS.find((item) => item.id === id);
    if (!preset) return;
    store.update((current) =>
      updateProjectSettings(current, { width: preset.width, height: preset.height }),
    );
  }

  function changeFps(num: number, den: number): void {
    store.update((current) => updateProjectSettings(current, { fpsNum: num, fpsDen: den }));
  }

  return (
    <>
      <Section title="Proyecto">
        <TextField
          label="Nombre"
          value={project.name}
          maxLength={120}
          onCommit={(value) => store.update((current) => updateProjectSettings(current, { name: value }))}
        />
        <label className="field">
          <span>Formato · {ratio}</span>
          <select
            value={formatPreset?.id ?? 'custom'}
            onChange={(event) => changeFormat(event.target.value)}
          >
            {FORMAT_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.label} · {preset.width}×{preset.height}
              </option>
            ))}
            <option value="custom">Personalizado</option>
          </select>
        </label>
        <div className="inspector-grid">
          <NumberField
            label="Ancho"
            value={project.video.width}
            min={16}
            max={32_768}
            step={2}
            onCommit={(value) => store.update((current) => updateProjectSettings(current, { width: value }))}
          />
          <NumberField
            label="Alto"
            value={project.video.height}
            min={16}
            max={32_768}
            step={2}
            onCommit={(value) => store.update((current) => updateProjectSettings(current, { height: value }))}
          />
        </div>
        <label className="field">
          <span>Tasa de frames · {formatFps(project.video.frameRate.num, project.video.frameRate.den)} fps</span>
          <select
            value={customFps ? 'custom' : (currentFpsPreset?.id ?? 'custom')}
            disabled={hasSpeedClip}
            onChange={(event) => {
              if (event.target.value === 'custom') {
                setCustomFps(true);
                return;
              }
              const preset = FPS_PRESETS.find((item) => item.id === event.target.value);
              if (preset) changeFps(preset.num, preset.den);
            }}
          >
            {FPS_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.label} fps
              </option>
            ))}
            <option value="custom">Personalizada…</option>
          </select>
        </label>
        {customFps ? (
          <div className="fps-custom">
            <label className="field">
              <span>Numerador</span>
              <input
                type="number"
                min={1}
                max={240_000}
                value={fpsDraft.num}
                onChange={(event) => setFpsDraft({ ...fpsDraft, num: Number(event.target.value) })}
              />
            </label>
            <label className="field">
              <span>Denominador</span>
              <input
                type="number"
                min={1}
                max={100_100}
                value={fpsDraft.den}
                onChange={(event) => setFpsDraft({ ...fpsDraft, den: Number(event.target.value) })}
              />
            </label>
            <button
              type="button"
              className="small"
              disabled={hasSpeedClip || !fpsDraft.num || !fpsDraft.den}
              onClick={() => changeFps(fpsDraft.num, fpsDraft.den)}
            >
              Aplicar fps
            </button>
          </div>
        ) : null}
        {hasSpeedClip ? (
          <p className="fine-print">
            Para cambiar los fps, poné los clips con velocidad distinta de 1× en 1×. El resto del
            timeline se reajusta conservando los segundos.
          </p>
        ) : (
          <p className="fine-print">
            Cambiar los fps reajusta clips, subtítulos y escenas para conservar los segundos. Se
            admiten tasas exactas como 23,976 (24000/1001) o cualquier par numerador/denominador.
          </p>
        )}
        <label className="field">
          <span>Color de fondo</span>
          <input
            type="color"
            value={project.video.backgroundColor ?? '#0b0e13'}
            onChange={(event) =>
              store.update((current) => updateProjectSettings(current, { backgroundColor: event.target.value }))
            }
          />
        </label>
        <p className="inspector-meta">
          {formatTimecode(store.durationFrames, fps)} · {project.assets.length} medios ·{' '}
          {project.timeline.clips.length} clips · revisión {project.revision}
        </p>
      </Section>

      <Section title="Transiciones de corte">
        <p className="fine-print">
          Aplica una disolvencia de 12 frames a cada corte contiguo entre clips de
          video, imagen o congelado, en todas las pistas desbloqueadas. No mueve
          clips ni cambia duraciones.
        </p>
        <div className="actions compact">
          <button type="button" className="small" onClick={dissolveCuts}>
            Disolver cortes contiguos
          </button>
        </div>
      </Section>

      <Section title="Marcadores y capítulos">
        <p className="inspector-meta">
          {sortedMarkers.length} de {MAX_MARKERS} · el primer capítulo siempre arranca en 0:00
        </p>
        <div className="actions compact">
          <button type="button" className="small" onClick={addMarkerAtPlayhead}>
            Agregar en playhead
          </button>
          <button
            type="button"
            className="small"
            onClick={createMarkersFromScenes}
            disabled={project.scenes.length === 0}
          >
            Marcadores desde escenas
          </button>
          <button
            type="button"
            className="small"
            onClick={cutClipsAtMarkers}
            disabled={sortedMarkers.length === 0}
          >
            Cortar clips en marcadores
          </button>
          <button
            type="button"
            className="small ghost"
            onClick={() => void copyMarkerChapters()}
            disabled={!markerChapters}
          >
            Copiar capítulos
          </button>
          <button
            type="button"
            className="small ghost"
            onClick={downloadMarkerChapters}
            disabled={!markerChapters}
          >
            Descargar .txt
          </button>
          <button
            type="button"
            className="small danger-ghost"
            onClick={() => store.update(clearMarkers)}
            disabled={sortedMarkers.length === 0}
          >
            Borrar todos
          </button>
        </div>
        {sortedMarkers.length === 0 ? (
          <p className="fine-print">
            Pulsá M en la timeline o “Agregar en playhead”. Los capítulos se
            exportan en formato YouTube y alimentan el manifiesto de publicación.
          </p>
        ) : (
          <>
            <div className="marker-list">
              {sortedMarkers.map((marker) => (
                <div className="marker-row" key={marker.id}>
                  <span
                    className={`marker-dot marker-${marker.color ?? 'mint'}`}
                    aria-hidden="true"
                  />
                  <NumberField
                    label="Frame"
                    value={marker.frame}
                    min={0}
                    max={240_000}
                    onCommit={(value) =>
                      store.update((current) =>
                        updateMarker(current, marker.id, { frame: value }),
                      )
                    }
                  />
                  {marker.endFrame !== undefined ? (
                    <NumberField
                      label="Fin"
                      value={marker.endFrame}
                      min={marker.frame + 1}
                      max={240_000}
                      onCommit={(value) =>
                        store.update((current) =>
                          updateMarker(current, marker.id, { endFrame: value }),
                        )
                      }
                    />
                  ) : null}
                  {marker.endFrame === undefined ? (
                    <button
                      type="button"
                      className="small ghost"
                      onClick={() =>
                        store.update((current) =>
                          updateMarker(current, marker.id, {
                            endFrame: marker.frame + Math.max(1, Math.round(2 * fps)),
                          }),
                        )
                      }
                    >
                      Rango 2 s
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="small ghost"
                      onClick={() =>
                        store.update((current) =>
                          updateMarker(current, marker.id, { endFrame: undefined }),
                        )
                      }
                    >
                      Quitar rango
                    </button>
                  )}
                  <TextField
                    label="Nombre"
                    value={marker.label}
                    maxLength={120}
                    onCommit={(value) =>
                      store.update((current) =>
                        updateMarker(current, marker.id, { label: value }),
                      )
                    }
                  />
                  <label className="field marker-color">
                    <span>Color</span>
                    <select
                      value={marker.color ?? 'mint'}
                      onChange={(event) =>
                        store.update((current) =>
                          updateMarker(current, marker.id, {
                            color: event.target.value as MarkerColor,
                          }),
                        )
                      }
                    >
                      {MARKER_COLORS.map((color) => (
                        <option key={color} value={color}>
                          {MARKER_COLOR_LABELS[color]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    className="small danger-ghost"
                    onClick={() =>
                      store.update((current) => deleteMarker(current, marker.id))
                    }
                  >
                    Borrar
                  </button>
                </div>
              ))}
            </div>
            <pre className="marker-chapters-preview">{markerChapters}</pre>
            {chapterValidation.ok ? (
              <p className="fine-print">
                Cumple el mínimo de YouTube: tres capítulos y al menos 10 s entre inicios. La
                plataforma todavía puede revisar el contenido.
              </p>
            ) : (
              <div className="chapter-warning" role="status">
                <strong>Formato de YouTube</strong>
                <ul>
                  {chapterValidation.issues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
        <p className="fine-print">
          Un marcador por frame. Si el primero no está en 0:00 se agrega “Inicio”.
          El manifiesto de publicación usa los marcadores cuando existen.
        </p>
      </Section>

      <Section title="Look del proyecto">
        <p className="inspector-meta">
          Color global sobre el compuesto final: se aplica después de mezclar las capas y antes
          de subtítulos, títulos y guías. Cambiarlo no toca los clips.
        </p>
        <div className="look-presets" role="group" aria-label="Presets del look del proyecto">
          <span className="appearance-label">Presets</span>
          {COLOR_LOOKS.map((item) => (
            <button
              key={item.id}
              type="button"
              className="look-chip"
              onClick={() =>
                store.update((current) =>
                  setProjectLook(
                    current,
                    Object.keys(item.effects).length === 0 ? null : { ...item.effects },
                  ),
                )
              }
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="inspector-grid">
          <NumberField
            label="Brillo"
            value={look.brightness ?? 0}
            min={-1}
            max={1}
            step={0.05}
            onCommit={(value) => patchLook({ brightness: value === 0 ? undefined : value })}
          />
          <NumberField
            label="Contraste"
            value={look.contrast ?? 1}
            min={0}
            max={3}
            step={0.05}
            onCommit={(value) => patchLook({ contrast: value === 1 ? undefined : value })}
          />
          <NumberField
            label="Saturación"
            value={look.saturation ?? 1}
            min={0}
            max={3}
            step={0.05}
            onCommit={(value) => patchLook({ saturation: value === 1 ? undefined : value })}
          />
          <NumberField
            label="Temperatura"
            value={look.temperature ?? 0}
            min={-1}
            max={1}
            step={0.05}
            onCommit={(value) => patchLook({ temperature: value === 0 ? undefined : value })}
          />
          <NumberField
            label="Sombras"
            value={look.shadows ?? 0}
            min={-1}
            max={1}
            step={0.05}
            onCommit={(value) => patchLook({ shadows: value === 0 ? undefined : value })}
          />
          <NumberField
            label="Altas luces"
            value={look.highlights ?? 0}
            min={-1}
            max={1}
            step={0.05}
            onCommit={(value) => patchLook({ highlights: value === 0 ? undefined : value })}
          />
          <NumberField
            label="Fade tonal"
            value={look.fade ?? 0}
            min={0}
            max={1}
            step={0.05}
            onCommit={(value) => patchLook({ fade: value === 0 ? undefined : value })}
          />
          <NumberField
            label="Rotación de tono (°)"
            value={look.hueRotateDeg ?? 0}
            min={-180}
            max={180}
            onCommit={(value) => patchLook({ hueRotateDeg: value === 0 ? undefined : value })}
          />
          <NumberField
            label="Viñeta"
            value={look.vignette ?? 0}
            min={0}
            max={1}
            step={0.05}
            onCommit={(value) => patchLook({ vignette: value === 0 ? undefined : value })}
          />
          <NumberField
            label="Nitidez"
            value={look.sharpen ?? 0}
            min={0}
            max={5}
            step={0.1}
            onCommit={(value) => patchLook({ sharpen: value === 0 ? undefined : value })}
          />
          <NumberField
            label="Desenfoque (px)"
            value={look.blur ?? 0}
            min={0}
            max={50}
            onCommit={(value) => patchLook({ blur: value === 0 ? undefined : value })}
          />
          <label className="field">
            <span>Curva de color</span>
            <select
              value={look.curvePreset ?? ''}
              onChange={(event) =>
                patchLook({
                  curvePreset: event.target.value
                    ? (event.target.value as NonNullable<ClipEffects['curvePreset']>)
                    : undefined,
                })
              }
            >
              <option value="">Ninguna</option>
              <option value="contrast-soft">Contraste suave</option>
              <option value="contrast-medium">Contraste medio</option>
              <option value="contrast-strong">Contraste fuerte</option>
              <option value="vintage">Vintage</option>
              <option value="cross-process">Cross process</option>
              <option value="darker">Oscurecer</option>
              <option value="lighter">Aclarar</option>
            </select>
          </label>
        </div>
        <div className="inspector-grid">
          <label className="check">
            <input
              type="checkbox"
              checked={look.grayscale ?? false}
              onChange={(event) =>
                patchLook({ grayscale: event.target.checked || undefined })
              }
            />
            <span>Blanco y negro</span>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={look.sepia ?? false}
              onChange={(event) => patchLook({ sepia: event.target.checked || undefined })}
            />
            <span>Sepia</span>
          </label>
        </div>
        <div className="keyframe-panel">
          <div className="production-card-head">
            <div>
              <p className="eyebrow">LUT 3D global (.cube)</p>
              <span className="fine-print">
                {look.lutFile ? look.lutFile : 'Sin LUT global'}
              </span>
            </div>
            <div className="actions compact">
              <button
                type="button"
                className="small"
                onClick={() => {
                  void (async () => {
                    try {
                      const lut = await store.service.importLut();
                      if (!lut) return;
                      store.update((current) =>
                        updateProjectLook(current, { lutFile: lut.path }),
                      );
                      store.setNotice(`LUT global importado: ${lut.name}`);
                    } catch (error) {
                      store.setNotice(
                        error instanceof Error ? error.message : 'no se pudo importar el LUT',
                      );
                    }
                  })();
                }}
              >
                Cargar .cube
              </button>
              {look.lutFile ? (
                <button
                  type="button"
                  className="small ghost"
                  onClick={() => patchLook({ lutFile: undefined, lutIntensity: undefined })}
                >
                  Quitar LUT
                </button>
              ) : null}
            </div>
          </div>
          {look.lutFile ? (
            <div className="inspector-grid">
              <NumberField
                label="Intensidad LUT global (%)"
                value={Math.round((look.lutIntensity ?? 1) * 100)}
                min={0}
                max={100}
                step={5}
                onCommit={(value) => patchLook({ lutIntensity: value / 100 })}
              />
            </div>
          ) : null}
          <p className="fine-print">
            Se copia a `media/luts` del proyecto y FFmpeg lo mezcla al final del grade global.
            La preview no simula el LUT; revisá el MP4.
          </p>
        </div>
        <div className="actions compact">
          <button
            type="button"
            className="small ghost"
            disabled={!project.look || Object.keys(look).length === 0}
            onClick={() => store.update((current) => setProjectLook(current, null))}
          >
            Quitar look
          </button>
          <span className="inspector-meta">
            {Object.keys(look).length === 0
              ? 'Sin look global'
              : `${Object.keys(look).length} ajustes activos`}
          </span>
        </div>
      </Section>

      <Section title="Audio del proyecto">
        <div className="inspector-grid">
          <NumberField
            label="Ganancia master (dB)"
            value={project.audio.master.gainDb}
            min={-60}
            max={12}
            step={0.5}
            onCommit={(value) => store.update((current) => updateAudioMix(current, { masterGainDb: value }))}
          />
          <label className="field">
            <span>Normalización loudness</span>
            <select
              value={project.audio.loudnessTarget?.platform ?? 'none'}
              onChange={(event) => {
                const value = event.target.value;
                const target =
                  value === 'none'
                    ? undefined
                    : value === 'broadcast'
                      ? {
                          platform: 'broadcast' as const,
                          integratedLufs: -23,
                          truePeakDb: -2,
                          toleranceDb: 2,
                        }
                      : {
                          platform: value as 'youtube' | 'shorts' | 'tiktok',
                          integratedLufs: -14,
                          truePeakDb: -1.5,
                          toleranceDb: 1.5,
                        };
                store.update((current) => updateAudioMix(current, { loudnessTarget: target }));
              }}
            >
              <option value="none">Sin normalizar</option>
              <option value="youtube">YouTube · -14 LUFS</option>
              <option value="shorts">Shorts · -14 LUFS</option>
              <option value="tiktok">TikTok · -14 LUFS</option>
              <option value="broadcast">Broadcast · -23 LUFS</option>
            </select>
          </label>
        </div>
        {project.audio.loudnessTarget ? (
          <div className="inspector-grid">
            <NumberField
              label="LUFS objetivo"
              value={project.audio.loudnessTarget.integratedLufs}
              min={-33}
              max={-9}
              step={0.5}
              onCommit={(value) =>
                store.update((current) =>
                  updateAudioMix(current, {
                    loudnessTarget: {
                      ...project.audio.loudnessTarget!,
                      integratedLufs: value,
                    },
                  }),
                )
              }
            />
            <NumberField
              label="True peak (dBTP)"
              value={project.audio.loudnessTarget.truePeakDb}
              min={-9}
              max={0}
              step={0.1}
              onCommit={(value) =>
                store.update((current) =>
                  updateAudioMix(current, {
                    loudnessTarget: {
                      ...project.audio.loudnessTarget!,
                      truePeakDb: value,
                    },
                  }),
                )
              }
            />
            <NumberField
              label="Tolerancia (dB)"
              value={project.audio.loudnessTarget.toleranceDb}
              min={0}
              max={3}
              step={0.1}
              onCommit={(value) =>
                store.update((current) =>
                  updateAudioMix(current, {
                    loudnessTarget: {
                      ...project.audio.loudnessTarget!,
                      toleranceDb: value,
                    },
                  }),
                )
              }
            />
          </div>
        ) : null}
        <label className="check">
          <input
            type="checkbox"
            checked={project.audio.master.limiter}
            onChange={(event) =>
              store.update((current) => updateAudioMix(current, { masterLimiter: event.target.checked }))
            }
          />
          <span>Limitar picos a -0,45 dB</span>
        </label>
        <div className="actions compact">
          {AUDIO_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className="small"
              onClick={() => applyAudioPreset(preset.id)}
            >
              {preset.label} a todos
            </button>
          ))}
        </div>
        <p className="fine-print">
          Aplica EQ, filtros, compresor y denoise a los clips de audio de las pistas
          desbloqueadas; conserva ganancia, fades y keyframes. No toca el audio de los videos.
        </p>
        <p className="fine-print">
          La normalización usa `loudnorm` en una pasada; es una aproximación declarada. El render
          siempre aplica un limitador final a 0,95.
        </p>
      </Section>

      <Section title="Ducking automático">
        <p className="fine-print">
          Baja la música cuando habla la voz. Elegí la pista de voz (source) y la de música
          (target); el render aplica `sidechaincompress`.
        </p>
        <label className="check">
          <input
            type="checkbox"
            checked={project.audio.ducking.enabled}
            onChange={(event) =>
              store.update((current) => {
                const next = { ...current };
                next.audio = {
                  ...next.audio,
                  ducking: { ...next.audio.ducking, enabled: event.target.checked },
                };
                return next;
              })
            }
          />
          <span>Activar ducking</span>
        </label>
        {project.audio.ducking.enabled ? (
          <div className="inspector-grid">
            <label className="field">
              <span>Pista de voz (source)</span>
              <select
                multiple
                value={project.audio.ducking.sourceTrackIds}
                onChange={(event) => {
                  const ids = Array.from(event.target.selectedOptions, (option) => option.value);
                  store.update((current) => {
                    const next = { ...current };
                    next.audio = {
                      ...next.audio,
                      ducking: { ...next.audio.ducking, sourceTrackIds: ids },
                    };
                    return next;
                  });
                }}
              >
                {project.timeline.tracks
                  .filter((track) => track.kind === 'narration' || track.kind === 'audio')
                  .map((track) => (
                    <option key={track.id} value={track.id}>
                      {track.label}
                    </option>
                  ))}
              </select>
            </label>
            <label className="field">
              <span>Pista de música (target)</span>
              <select
                multiple
                value={project.audio.ducking.targetTrackIds}
                onChange={(event) => {
                  const ids = Array.from(event.target.selectedOptions, (option) => option.value);
                  store.update((current) => {
                    const next = { ...current };
                    next.audio = {
                      ...next.audio,
                      ducking: { ...next.audio.ducking, targetTrackIds: ids },
                    };
                    return next;
                  });
                }}
              >
                {project.timeline.tracks
                  .filter((track) => track.kind === 'audio')
                  .map((track) => (
                    <option key={track.id} value={track.id}>
                      {track.label}
                    </option>
                  ))}
              </select>
            </label>
            <NumberField
              label="Reducción (dB)"
              value={project.audio.ducking.amountDb}
              min={-60}
              max={0}
              step={1}
              onCommit={(value) =>
                store.update((current) => {
                  const next = { ...current };
                  next.audio = {
                    ...next.audio,
                    ducking: { ...next.audio.ducking, amountDb: value },
                  };
                  return next;
                })
              }
            />
          </div>
        ) : null}
      </Section>

      <Section title="Entrega">
        <p className="inspector-meta">{project.renderProfiles.length} perfil(es) de exportación</p>
        <ul className="profile-list">
          {project.renderProfiles.map((profile) => (
            <li key={profile.id}>
              <strong>{profile.name}</strong>
              <span>
                {profile.resolution.width}×{profile.resolution.height} · {profile.videoCodec} ·{' '}
                {profile.aspectRatio}
              </span>
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="small"
          onClick={() => store.update((current) => ensureDelivery(current))}
        >
          Asegurar perfiles 16:9, 9:16 y 1:1
        </button>
      </Section>

      <Section title="Subtítulos">
        <div className="actions compact">
          <div className="emoji-input-row">
            <input
              ref={cueInputRef}
              className="emoji-capable"
              value={cueText}
              maxLength={500}
              placeholder="Texto del subtítulo en el playhead"
              onChange={(event) => setCueText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && cueText.trim()) {
                  store.mutate((current) =>
                    addCaptionCue(current, {
                      text: cueText,
                      startFrame: store.state.playheadFrame,
                      durationFrames: Math.round(3 * fps),
                    }),
                  );
                  setCueText('');
                }
              }}
            />
            <EmojiPickerButton onPick={insertIntoCue} label="Insertar emoji en el subtítulo" />
          </div>
          <button
            type="button"
            className="small"
            disabled={!cueText.trim()}
            onClick={() => {
              store.mutate((current) =>
                addCaptionCue(current, {
                  text: cueText,
                  startFrame: store.state.playheadFrame,
                  durationFrames: Math.round(3 * fps),
                }),
              );
              setCueText('');
            }}
          >
            Agregar subtítulo
          </button>
        </div>
        <div className="actions compact">
          <div className="emoji-input-row">
            <input
              ref={titleInputRef}
              className="emoji-capable"
              value={titleText}
              maxLength={500}
              placeholder="Título centrado en el playhead"
              onChange={(event) => setTitleText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && titleText.trim()) {
                  store.mutate((current) =>
                    addTitleCue(current, {
                      text: titleText,
                      startFrame: store.state.playheadFrame,
                      durationFrames: Math.round(3 * fps),
                    }),
                  );
                  setTitleText('');
                }
              }}
            />
            <EmojiPickerButton onPick={insertIntoTitle} label="Insertar emoji en el título" />
          </div>
          <button
            type="button"
            className="small"
            disabled={!titleText.trim()}
            onClick={() => {
              store.mutate((current) =>
                addTitleCue(current, {
                  text: titleText,
                  startFrame: store.state.playheadFrame,
                  durationFrames: Math.round(3 * fps),
                }),
              );
              setTitleText('');
            }}
          >
            Agregar título
          </button>
        </div>
        <p className="fine-print">
          Los títulos usan una pista y un estilo propios (92 px, centrado) para no chocar con
          los subtítulos. Se queman en el MP4 y se pueden editar como cualquier cue.
        </p>
        <div className="actions compact">
          <button type="button" className="small" onClick={exportSubtitles}>
            Exportar SRT
          </button>
          <button
            type="button"
            className="small"
            onClick={() => void pickSubtitleFile()}
          >
            Elegir archivo…
          </button>
          <button
            type="button"
            className="small ghost"
            onClick={() => {
              setSubtitleDraft('');
              setSubtitleWarnings([]);
              setSubtitleIo('import');
            }}
          >
            Importar SRT/VTT/ASS
          </button>
        </div>
        {subtitleIo !== 'closed' ? (
          <div className="card subtitle-io">
            <p className="eyebrow">
              {subtitleIo === 'export' ? 'Exportar subtítulos' : 'Importar subtítulos'}
            </p>
            <label className="field">
              <span>
                {subtitleIo === 'export'
                  ? 'SRT generado desde la pista principal'
                  : 'Pegá el contenido o cargá un archivo SRT/VTT/ASS'}
              </span>
              <textarea
                rows={9}
                value={subtitleDraft}
                readOnly={subtitleIo === 'export'}
                placeholder="Ej.: 00:00:00,000 --> 00:00:02,000"
                onChange={(event) => setSubtitleDraft(event.target.value)}
              />
            </label>
            {subtitleWarnings.length > 0 ? (
              <ul className="notice notice-warning">
                {subtitleWarnings.slice(0, 6).map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : null}
            <div className="actions compact">
              {subtitleIo === 'export' ? (
                <>
                  <button type="button" className="small" onClick={() => void copySubtitleDraft()}>
                    Copiar
                  </button>
                  <button type="button" className="small" onClick={downloadSubtitleDraft}>
                    Descargar .srt
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="small"
                  disabled={!subtitleDraft.trim()}
                  onClick={importSubtitles}
                >
                  Importar y reemplazar
                </button>
              )}
              <button
                type="button"
                className="small ghost"
                onClick={() => {
                  setSubtitleIo('closed');
                  setSubtitleWarnings([]);
                }}
              >
                Cerrar
              </button>
            </div>
            <p className="fine-print">
              La importación reemplaza la pista principal, conserva los títulos y convierte
              segundos a frames con el fps del proyecto. Las líneas con tiempos inválidos se
              omiten y se informan.
            </p>
          </div>
        ) : null}
        {style ? (
          <>
          <div className="inspector-grid">
            <NumberField
              label="Tamaño"
              value={style.fontSizePx}
              min={1}
              max={400}
              onCommit={(value) =>
                store.update((current) => updateCaptionStyle(current, style.id, { fontSizePx: value }))
              }
            />
            <label className="field">
              <span>Color</span>
              <input
                type="color"
                value={style.color}
                onChange={(event) =>
                  store.update((current) => updateCaptionStyle(current, style.id, { color: event.target.value }))
                }
              />
            </label>
            <label className="field">
              <span>Posición</span>
              <select
                value={style.position}
                onChange={(event) =>
                  store.update((current) =>
                    updateCaptionStyle(current, style.id, {
                      position: event.target.value as 'top' | 'center' | 'bottom',
                    }),
                  )
                }
              >
                <option value="bottom">abajo</option>
                <option value="center">centro</option>
                <option value="top">arriba</option>
              </select>
            </label>
            <label className="field">
              <span>Borde</span>
              <select
                value={style.borderStyle ?? 'outline'}
                onChange={(event) =>
                  store.update((current) =>
                    updateCaptionStyle(current, style.id, {
                      borderStyle: event.target.value as 'outline' | 'box',
                    }),
                  )
                }
              >
                <option value="outline">Contorno</option>
                <option value="box">Caja</option>
              </select>
            </label>
            <label className="field">
              <span>Fondo de caja</span>
              <input
                type="color"
                value={style.backgroundColor ?? '#0b0e13'}
                onChange={(event) =>
                  store.update((current) =>
                    updateCaptionStyle(current, style.id, {
                      backgroundColor: event.target.value,
                    }),
                  )
                }
              />
            </label>
          </div>
          <div className="actions compact">
            <label className="check">
              <input
                type="checkbox"
                checked={style.bold ?? false}
                onChange={(event) =>
                  store.update((current) =>
                    updateCaptionStyle(current, style.id, { bold: event.target.checked }),
                  )
                }
              />
              <span>Negrita</span>
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={style.italic ?? false}
                onChange={(event) =>
                  store.update((current) =>
                    updateCaptionStyle(current, style.id, { italic: event.target.checked }),
                  )
                }
              />
              <span>Itálica</span>
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={style.shadow ?? false}
                onChange={(event) =>
                  store.update((current) =>
                    updateCaptionStyle(current, style.id, { shadow: event.target.checked }),
                  )
                }
              />
              <span>Sombra</span>
            </label>
          </div>
          <div className="inspector-grid">
            <NumberField
              label="Profundidad 3D"
              value={style.depth3d ?? 0}
              min={0}
              max={12}
              onCommit={(value) =>
                store.update((current) =>
                  updateCaptionStyle(current, style.id, { depth3d: value }),
                )
              }
            />
            <label className="field">
              <span>Color 3D</span>
              <input
                type="color"
                value={style.depthColor ?? '#1f2937'}
                onChange={(event) =>
                  store.update((current) =>
                    updateCaptionStyle(current, style.id, {
                      depthColor: event.target.value,
                    }),
                  )
                }
              />
            </label>
          </div>
          <div className="actions compact">
            <button
              type="button"
              className="small"
              onClick={() =>
                store.update((current) =>
                  updateCaptionStyle(current, style.id, {
                    bold: true,
                    italic: false,
                    borderStyle: 'outline',
                    fontSizePx: 64,
                    color: '#ffffff',
                    outlineColor: '#000000',
                    position: 'center',
                  }),
                )
              }
            >
              Creador
            </button>
            <button
              type="button"
              className="small"
              onClick={() =>
                store.update((current) =>
                  updateCaptionStyle(current, style.id, {
                    bold: true,
                    borderStyle: 'box',
                    backgroundColor: '#0b0e13',
                    fontSizePx: 56,
                    color: '#ffffff',
                    position: 'bottom',
                  }),
                )
              }
            >
              Caja
            </button>
            <button
              type="button"
              className="small ghost"
              onClick={() =>
                store.update((current) =>
                  updateCaptionStyle(current, style.id, {
                    bold: false,
                    borderStyle: 'outline',
                    fontSizePx: 44,
                    color: '#ffffff',
                    outlineColor: '#000000',
                    position: 'bottom',
                  }),
                )
              }
            >
              Minimal
            </button>
            <button
              type="button"
              className="small ghost"
              onClick={() =>
                store.update((current) =>
                  updateCaptionStyle(current, style.id, {
                    bold: true,
                    fontSizePx: 96,
                    position: 'center',
                  }),
                )
              }
            >
              Grande
            </button>
            <button
              type="button"
              className="small"
              onClick={() =>
                store.update((current) =>
                  updateCaptionStyle(current, style.id, {
                    bold: true,
                    borderStyle: 'outline',
                    fontSizePx: 72,
                    color: '#ffffff',
                    outlineColor: '#000000',
                    depth3d: 6,
                    depthColor: '#f43f5e',
                    position: 'center',
                  }),
                )
              }
            >
              3D
            </button>
          </div>
          </>
        ) : (
          <p className="fine-print">Todavía no hay un estilo de subtítulos; agregá uno creando un subtítulo.</p>
        )}
      </Section>

      <Section title="Procedencia">
        <p className="inspector-meta">
          {project.provenance.sources.length} fuentes · {project.provenance.claims.length} citas ·{' '}
          {project.provenance.operations.length} operaciones
        </p>
        <ul className="operation-list">
          {project.provenance.operations.slice(-3).reverse().map((operation) => (
            <li key={operation.id}>
              <strong>{operation.role}</strong> {operation.summary}
              <span>{new Date(operation.createdAt).toLocaleString('es-AR')}</span>
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}

export function Inspector() {
  const store = useProjectStore();
  const project = store.state.project;
  const selection = store.state.selection;
  if (!project) return null;

  let body: ReactNode = null;
  if (selection.kind === 'clip') {
    const clip = project.timeline.clips.find((item) => item.id === selection.id);
    const track = clip ? project.timeline.tracks.find((item) => item.id === clip.trackId) : undefined;
    if (clip && track) body = <ClipInspector clip={clip} track={track} project={project} />;
  } else if (selection.kind === 'track') {
    const track = project.timeline.tracks.find((item) => item.id === selection.id);
    if (track) body = <TrackInspector track={track} />;
  } else if (selection.kind === 'cue') {
    const cue = project.captions.cues.find((item) => item.id === selection.id);
    if (cue) body = <CueInspector cue={cue} />;
  } else if (selection.kind === 'asset') {
    const asset = project.assets.find((item) => item.id === selection.id);
    if (asset) body = <AssetInspector asset={asset} />;
  } else if (selection.kind === 'scene') {
    const scene = project.scenes.find((item) => item.id === selection.id);
    if (scene) body = <SceneInspector scene={scene} />;
  }
  if (!body) body = <ProjectInspector />;

  return (
    <aside className="inspector" aria-label="Detalles">
      <div className="inspector-head">
        <h3>Detalles</h3>
        <span>{selection.kind === 'none' ? 'proyecto' : selection.kind}</span>
      </div>
      <div className="inspector-body">{body}</div>
    </aside>
  );
}
