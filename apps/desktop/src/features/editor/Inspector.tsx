import { useEffect, useState, type ReactNode } from 'react';
import type { Asset, CaptionCue, ChromaKey, Clip, ClipEffects, ClipMotion, Scene, Track } from '@editor-ia/project-schema';
import { friendlyAssetLabel } from '../../state/asset-labels';
import {
  addCaptionCue,
  addClipFromAsset,
  addTranscriptionCues,
  deleteCaptionCue,
  deleteClip,
  deleteTrack,
  ensureDelivery,
  formatTimecode,
  fpsOf,
  markAssetReady,
  moveClip,
  removeAsset,
  setClipSpeed,
  splitClip,
  splitClipAtFrames,
  trimClip,
  updateAssetLabel,
  updateAudioMix,
  updateCaptionCue,
  updateCaptionStyle,
  updateClip,
  updateProjectSettings,
  totalFrames,
  updateTrack,
} from '../../state/project-actions';
import { useProjectStore } from '../../state/project-store';
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
}: {
  readonly label: string;
  readonly value: string;
  readonly onCommit: (value: string) => void;
  readonly maxLength?: number;
  readonly rows?: number;
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
      <textarea
        rows={rows}
        value={draft}
        maxLength={maxLength}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
      />
    </label>
  );
}

function Section({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section className="inspector-section">
      <h4>{title}</h4>
      {children}
    </section>
  );
}

function clipKindLabel(kind: Clip['kind']): string {
  return { video: 'Video', image: 'Imagen', audio: 'Audio', graphic: 'Gráfico' }[kind];
}

function trackKindLabel(kind: Track['kind']): string {
  return {
    video: 'Video',
    image: 'Imagen',
    audio: 'Audio',
    narration: 'Narración',
    caption: 'Subtítulos',
    graphic: 'Gráficos',
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

const COLOR_LOOKS: readonly { readonly id: string; readonly label: string; readonly effects: ClipEffects }[] = [
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

function ClipInspector({ clip, track, project }: { clip: Clip; track: Track; project: ReturnType<typeof useProjectStore>['state']['project'] }) {
  const store = useProjectStore();
  const [sceneThreshold, setSceneThreshold] = useState(0.35);
  const [sceneCuts, setSceneCuts] = useState<number[]>([]);
  const [sceneBusy, setSceneBusy] = useState(false);
  const [transcribeBusy, setTranscribeBusy] = useState(false);
  const [transcribeInfo, setTranscribeInfo] = useState<string | null>(null);
  useEffect(() => {
    setSceneCuts([]);
    setSceneBusy(false);
    setTranscribeInfo(null);
  }, [clip.id]);
  if (!project) return null;
  const fps = fpsOf(project);
  const source = clip.source;
  const asset = source.type === 'asset' ? project.assets.find((item) => item.id === source.assetId) : undefined;
  const windowedSource = source.type === 'asset' && 'inFrame' in source ? source : undefined;
  const transform = clip.transform ?? {};
  const audio = clip.audio ?? {};
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

  const speedFactor =
    clip.kind === 'video' || clip.kind === 'audio'
      ? (clip.speed?.num ?? 1) / (clip.speed?.den ?? 1)
      : 1;
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
  const speed =
    clip.kind === 'video' || clip.kind === 'audio'
      ? (clip.speed?.num ?? 1) / (clip.speed?.den ?? 1)
      : 1;
  function setEffect<K extends keyof ClipEffects>(key: K, value: ClipEffects[K] | undefined): void {
    const nextEffects: ClipEffects = { ...effects };
    if (value === undefined) {
      delete nextEffects[key];
    } else {
      nextEffects[key] = value;
    }
    store.update((current) => updateClip(current, clip.id, { effects: nextEffects }));
  }

  function applyLook(look: ClipEffects): void {
    const nextEffects: ClipEffects = { ...look };
    if (effects.fadeInFrames !== undefined) nextEffects.fadeInFrames = effects.fadeInFrames;
    if (effects.fadeOutFrames !== undefined) nextEffects.fadeOutFrames = effects.fadeOutFrames;
    store.update((current) => updateClip(current, clip.id, { effects: nextEffects }));
  }
  const compatibleTracks = project.timeline.tracks.filter((item) =>
    clip.kind === 'audio'
      ? item.kind === 'audio' || item.kind === 'narration'
      : item.kind === trackKind(clip),
  );

  return (
    <>
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
        ) : (
          <p className="inspector-meta">Fuente gráfica: {source.motionId}</p>
        )}
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

      <Section title="Transformación">
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
      </Section>

      {clip.kind === 'video' || clip.kind === 'audio' ? (
        <Section title="Velocidad">
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
        </Section>
      ) : null}

      {clip.kind === 'video' || clip.kind === 'image' ? (
        <Section title="Movimiento">
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

      {clip.kind === 'video' || clip.kind === 'image' ? (
        <Section title="Fondo / chroma key">
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

      {clip.kind === 'video' || clip.kind === 'image' ? (
        <Section title="Color y efectos">
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
          </div>
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
          <div className="actions compact">
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

      {clip.kind === 'video' ? (
        <Section title="Análisis de escenas">
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
        <Section title="Audio del clip">
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
    </>
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
  }
}

function TrackInspector({ track }: { track: Track }) {
  const store = useProjectStore();
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
      <div className="flag-row">
        <label className="check">
          <input
            type="checkbox"
            checked={track.muted}
            onChange={(event) => store.update((current) => updateTrack(current, track.id, { muted: event.target.checked }))}
          />
          <span>Silenciada</span>
        </label>
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
  return (
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
  const fps = project.video.frameRate.num / project.video.frameRate.den;
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
            max={16_384}
            step={2}
            onCommit={(value) => store.update((current) => updateProjectSettings(current, { width: value }))}
          />
          <NumberField
            label="Alto"
            value={project.video.height}
            min={16}
            max={16_384}
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
          <input
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
        {style ? (
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
          </div>
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
    <aside className="inspector" aria-label="Inspector">
      <div className="inspector-head">
        <h3>Inspector</h3>
        <span>{selection.kind === 'none' ? 'proyecto' : selection.kind}</span>
      </div>
      <div className="inspector-body">{body}</div>
    </aside>
  );
}
