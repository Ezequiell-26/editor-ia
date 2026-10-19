import { useEffect, useState, type ReactNode } from 'react';
import type { Asset, CaptionCue, Clip, Scene, Track } from '@editor-ia/project-schema';
import {
  addCaptionCue,
  addClipFromAsset,
  deleteCaptionCue,
  deleteClip,
  deleteTrack,
  ensureDelivery,
  formatTimecode,
  fpsOf,
  markAssetReady,
  moveClip,
  removeAsset,
  splitClip,
  trimClip,
  updateAssetLabel,
  updateCaptionCue,
  updateCaptionStyle,
  updateClip,
  updateProjectSettings,
  updateTrack,
} from '../../state/project-actions';
import { useProjectStore } from '../../state/project-store';

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

function ClipInspector({ clip, track, project }: { clip: Clip; track: Track; project: ReturnType<typeof useProjectStore>['state']['project'] }) {
  const store = useProjectStore();
  if (!project) return null;
  const fps = fpsOf(project);
  const source = clip.source;
  const asset = source.type === 'asset' ? project.assets.find((item) => item.id === source.assetId) : undefined;
  const windowedSource = source.type === 'asset' && 'inFrame' in source ? source : undefined;
  const transform = clip.transform ?? {};
  const audio = clip.audio ?? {};
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
          {clip.kind} · {track.label} · {formatTimecode(clip.startFrame, fps)} →{' '}
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
                {item.label} ({item.kind})
              </option>
            ))}
          </select>
        </label>
        {source.type === 'asset' && windowedSource ? (
          <p className="inspector-meta">
            Fuente: {asset?.label ?? 'material ausente'} · in {windowedSource.inFrame} · out{' '}
            {windowedSource.outFrame}
          </p>
        ) : source.type === 'asset' ? (
          <p className="inspector-meta">Fuente: {asset?.label ?? 'material ausente'} · imagen fija</p>
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
              store.update((current) => deleteClip(current, clip.id));
              store.setSelection({ kind: 'none' });
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
        <Section title="Audio del clip">
          <div className="inspector-grid">
            <NumberField
              label="Ganancia (dB)"
              value={audio.gainDb ?? 0}
              min={-60}
              max={12}
              step={0.5}
              onCommit={(value) =>
                store.update((current) => updateClip(current, clip.id, { audio: { ...audio, gainDb: value } }))
              }
            />
            <NumberField
              label="Fade in (frames)"
              value={audio.fadeInFrames ?? 0}
              min={0}
              onCommit={(value) =>
                store.update((current) =>
                  updateClip(current, clip.id, { audio: { ...audio, fadeInFrames: Math.round(value) } }),
                )
              }
            />
            <NumberField
              label="Fade out (frames)"
              value={audio.fadeOutFrames ?? 0}
              min={0}
              onCommit={(value) =>
                store.update((current) =>
                  updateClip(current, clip.id, { audio: { ...audio, fadeOutFrames: Math.round(value) } }),
                )
              }
            />
          </div>
          <div className="actions compact">
            <button
              type="button"
              className="small ghost"
              onClick={() => store.update((current) => updateClip(current, clip.id, { audio: {} }))}
            >
              Limpiar audio
            </button>
          </div>
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
        {track.kind} · orden {track.order}
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
        {asset.kind} · {mediaInfo(asset)}
      </p>
      <p className="inspector-meta">
        {asset.source.type === 'local' ? `local · ${asset.source.path}` : asset.source.type}
      </p>
      <p className="inspector-meta">
        Licencia {asset.rights.license.id} · {asset.rights.license.commercialUse} · {asset.status}
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
  if (!project) return null;
  const fps = project.video.frameRate.num / project.video.frameRate.den;
  const style = project.captions.styles[0];
  const hasClips = project.timeline.clips.length > 0;
  return (
    <>
      <Section title="Proyecto">
        <TextField
          label="Nombre"
          value={project.name}
          maxLength={120}
          onCommit={(value) => store.update((current) => updateProjectSettings(current, { name: value }))}
        />
        <div className="inspector-grid">
          <NumberField
            label="Ancho"
            value={project.video.width}
            min={16}
            max={16_384}
            onCommit={(value) => store.update((current) => updateProjectSettings(current, { width: value }))}
          />
          <NumberField
            label="Alto"
            value={project.video.height}
            min={16}
            max={16_384}
            onCommit={(value) => store.update((current) => updateProjectSettings(current, { height: value }))}
          />
          <NumberField
            label="FPS numerador"
            value={project.video.frameRate.num}
            min={1}
            disabled={hasClips}
            onCommit={(value) => store.update((current) => updateProjectSettings(current, { fpsNum: value }))}
          />
          <NumberField
            label="FPS denominador"
            value={project.video.frameRate.den}
            min={1}
            disabled={hasClips}
            onCommit={(value) => store.update((current) => updateProjectSettings(current, { fpsDen: value }))}
          />
        </div>
        {hasClips ? (
          <p className="fine-print">
            La tasa de frames no se puede cambiar con clips montados: reinterpretaría todo el
            timing. Duplicá el proyecto si necesitás otro fps.
          </p>
        ) : null}
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
          Asegurar perfiles 16:9 y 9:16
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
