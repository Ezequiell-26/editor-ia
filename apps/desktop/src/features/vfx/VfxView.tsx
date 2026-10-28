import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import type { Clip, ClipEffects, ClipMask, MaskPoint } from '@editor-ia/project-schema';
import { sampleMaskKeyframes } from '@editor-ia/project-schema';
import type { ViewId } from '../../app/navigation';
import { Icon } from '../../components/Icon';
import { fpsOf, setMaskKeyframe, updateClip } from '../../state/project-actions';
import { useProjectStore } from '../../state/project-store';
import { maskFromFaceTrack, polygonAroundCenter } from './face-mask';
import { ChromaPreview, sampleBackgroundColor, type ChromaSettings } from './ChromaPreview';

export interface VfxViewProps {
  readonly onNavigate: (view: ViewId) => void;
}

const VISUAL_KINDS = new Set(['video', 'image', 'freeze']);

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function visualClip(clip: Clip | undefined): boolean {
  return Boolean(clip && VISUAL_KINDS.has(clip.kind));
}

export function VfxView({ onNavigate }: VfxViewProps) {
  const store = useProjectStore();
  const project = store.state.project;
  const [selectedClipId, setSelectedClipId] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editPoints, setEditPoints] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [mediaEl, setMediaEl] = useState<HTMLVideoElement | HTMLImageElement | null>(null);
  const [chromaPreview, setChromaPreview] = useState(true);
  const attachVideo = useCallback((node: HTMLVideoElement | null) => {
    videoRef.current = node;
    setMediaEl((current) => (current === node ? current : node));
  }, []);
  const attachImage = useCallback((node: HTMLImageElement | null) => {
    imageRef.current = node;
    setMediaEl((current) => (current === node ? current : node));
  }, []);
  const dragIndex = useRef<number | null>(null);
  const dragMoved = useRef(false);

  const visualClips = useMemo(
    () => (project?.timeline.clips ?? []).filter(visualClip),
    [project],
  );
  const clip =
    visualClips.find((item) => item.id === selectedClipId) ?? visualClips[0] ?? undefined;

  useEffect(() => {
    if (clip && clip.id !== selectedClipId) setSelectedClipId(clip.id);
  }, [clip, selectedClipId]);

  const clipAssetId = clip?.source.type === 'asset' ? clip.source.assetId : undefined;
  const asset = clipAssetId
    ? project?.assets.find((item) => item.id === clipAssetId)
    : undefined;
  const root = store.state.opened?.root ?? '';
  const url = asset ? store.service.mediaUrl(root, asset.source.path) : '';
  const fps = project ? fpsOf(project) : 30;
  const localFrame = clip
    ? Math.max(0, Math.min(clip.durationFrames - 1, store.state.playheadFrame - clip.startFrame))
    : 0;
  const mask: ClipMask | undefined =
    clip && 'mask' in clip ? (clip as Clip & { mask?: ClipMask }).mask : undefined;
  const polygon = mask?.shape === 'polygon' ? mask : undefined;
  const sampled = useMemo(() => {
    if (!polygon?.keyframes) return {};
    return sampleMaskKeyframes(polygon.keyframes, localFrame);
  }, [polygon, localFrame]);
  const translateX = sampled.x ?? polygon?.x ?? 0;
  const translateY = sampled.y ?? polygon?.y ?? 0;
  const points = polygon?.points ?? [];
  const polygonPoints = points;
  const overlayPoints = points.map((point) => ({
    x: point.x + translateX,
    y: point.y + translateY,
  }));
  const effects: ClipEffects =
    clip && 'effects' in clip
      ? ((clip as Clip & { effects?: ClipEffects }).effects ?? {})
      : {};
  const chroma: ChromaSettings | undefined =
    clip && 'chromaKey' in clip
      ? (clip as Clip & { chromaKey?: ChromaSettings }).chromaKey
      : undefined;

  function applyChroma(next: ChromaSettings): void {
    if (!clip) return;
    store.update((current) =>
      updateClip(current, clip.id, { chromaKey: next }),
    );
  }

  function updateChroma(patch: Partial<ChromaSettings>): void {
    if (!chroma) return;
    applyChroma({ ...chroma, ...patch });
  }

  function removeChroma(): void {
    if (!clip) return;
    store.update((current) => updateClip(current, clip.id, { chromaKey: undefined }));
  }

  function enableChroma(screen: 'green' | 'blue'): void {
    applyChroma({
      color: screen === 'green' ? '#00ff00' : '#0000ff',
      similarity: 0.3,
      blend: 0.12,
      spill: 0.6,
    });
    setChromaPreview(true);
  }

  function detectBackground(): void {
    const color = sampleBackgroundColor(mediaEl);
    if (!color) {
      setNotice(
        'La vista todavía no tiene un frame disponible; esperá a que cargue y reintentá.',
      );
      return;
    }
    const red = Number.parseInt(color.slice(1, 3), 16);
    const green = Number.parseInt(color.slice(3, 5), 16);
    const blue = Number.parseInt(color.slice(5, 7), 16);
    const isScreen = (green > red && green > blue) || (blue > red && blue > green);
    applyChroma({
      color,
      similarity: 0.28,
      blend: 0.12,
      spill: isScreen ? 0.5 : 0,
    });
    setChromaPreview(true);
    setNotice(
      `Fondo detectado: ${color.toUpperCase()}. Ajustá similitud y suavizado hasta que el borde quede limpio.`,
    );
  }

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !clip || clip.kind !== 'video' || !url || clip.source.type !== 'asset') return;
    const speed = clip.speed ? clip.speed.num / clip.speed.den : 1;
    const target = (clip.source.inFrame + localFrame * speed) / fps;
    if (Number.isFinite(target) && Math.abs(video.currentTime - target) > 0.08) {
      try {
        video.currentTime = Math.max(0, target);
      } catch {
        // metadata pending
      }
    }
  }, [clip, fps, localFrame, url]);

  if (!project) {
    return (
      <section className="view vfx-view">
        <header className="view-toolbar">
          <div>
            <h1>VFX y rotoscopía</h1>
            <p>Composición por nodos, máscaras poligonales y seguimiento facial.</p>
          </div>
        </header>
        <div className="empty-state">
          <Icon name="effects" size={28} />
          <h2>No hay un proyecto abierto</h2>
          <button type="button" className="primary" onClick={() => onNavigate('projects')}>
            Ir a Proyectos
          </button>
        </div>
      </section>
    );
  }

  function patchEffects(patch: Record<string, unknown>): void {
    if (!clip) return;
    const current = clip as Clip & { effects?: ClipEffects };
    store.update((state) =>
      updateClip(state, clip.id, {
        effects: { ...current.effects, ...patch } as ClipEffects,
      }),
    );
  }

  function patchMask(next: ClipMask | undefined): void {
    if (!clip) return;
    store.update((current) => updateClip(current, clip.id, { mask: next }));
  }

  function createPolygon(): void {
    if (
      polygon &&
      ((polygon.keyframes?.length ?? 0) > 0 || points.length > 3) &&
      !window.confirm(
        'Reiniciar el polígono descarta los vértices y las claves de seguimiento. ¿Continuar?',
      )
    ) {
      return;
    }
    setError(null);
    setNotice('Polígono creado. Hacé clic en el visor para sumar vértices.');
    setEditPoints(true);
    patchMask(polygonAroundCenter(0.5, 0.5, 0.22));
  }

  function addPoint(event: MouseEvent<SVGSVGElement>): void {
    if (!editPoints || !polygon) return;
    if (dragMoved.current) {
      dragMoved.current = false;
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    if (polygonPoints.length >= 16) {
      setError('El polígono admite hasta 16 vértices.');
      return;
    }
    const point: MaskPoint = {
      x: clamp01((event.clientX - rect.left) / rect.width - translateX),
      y: clamp01((event.clientY - rect.top) / rect.height - translateY),
    };
    patchMask({ ...polygon, points: [...polygonPoints, point] });
  }

  function pointFromEvent(event: PointerEvent<SVGSVGElement>): MaskPoint {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: clamp01((event.clientX - rect.left) / rect.width - translateX),
      y: clamp01((event.clientY - rect.top) / rect.height - translateY),
    };
  }

  function startDrag(index: number): void {
    dragIndex.current = index;
    dragMoved.current = false;
  }

  function moveDrag(event: PointerEvent<SVGSVGElement>): void {
    if (dragIndex.current === null || !polygon) return;
    const point = pointFromEvent(event);
    dragMoved.current = true;
    patchMask({
      ...polygon,
      points: polygonPoints.map((current, index) =>
        index === dragIndex.current ? point : current,
      ),
    });
  }

  function endDrag(): void {
    dragIndex.current = null;
  }

  function removeLastPoint(): void {
    if (!polygon || polygonPoints.length <= 3) return;
    patchMask({ ...polygon, points: polygonPoints.slice(0, -1) });
  }

  async function trackFace(): Promise<void> {
    if (!clip || !asset || clip.kind !== 'video' || clip.source.type !== 'asset') return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const startSeconds = clip.source.inFrame / fps;
      const endSeconds = clip.source.outFrame / fps;
      const result = await store.service.analyzeFaceTrack({
        path: asset.source.path,
        startSeconds,
        endSeconds,
      });
      const tracked = maskFromFaceTrack(result, fps);
      if (!tracked) {
        setError('No se detectaron rostros con suficiente confianza en este clip.');
        return;
      }
      patchMask(tracked);
      setNotice(
        `Seguimiento facial: ${result.detections} detección(es), ${tracked.keyframes?.length ?? 0} claves.`,
      );
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : 'no se pudo analizar el rostro del clip',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="view vfx-view">
      <header className="view-toolbar vfx-toolbar">
        <div>
          <h1>VFX y rotoscopía</h1>
          <p>
            Cadena lineal de nodos para un clip: chroma, máscara poligonal, color y detalle. El
            orden refleja el render real.
          </p>
        </div>
        <div className="vfx-actions">
          <label className="field">
            <span>Clip</span>
            <select
              value={clip?.id ?? ''}
              onChange={(event) => {
                setSelectedClipId(event.target.value);
                setNotice(null);
                setError(null);
              }}
            >
              {visualClips.length === 0 ? <option value="">Sin clips visuales</option> : null}
              {visualClips.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label ?? item.kind} · {item.startFrame + 1}–
                  {item.startFrame + item.durationFrames}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="small icon-text" onClick={() => onNavigate('editor')}>
            <Icon name="editor" size={14} />
            <span>Volver al editor</span>
          </button>
        </div>
      </header>

      {!clip ? (
        <div className="empty-state">
          <Icon name="film" size={28} />
          <h2>No hay clips visuales</h2>
          <p>Importá un video o una imagen y montálo en la timeline para trabajar el VFX.</p>
          <button type="button" className="primary" onClick={() => onNavigate('assets')}>
            Ir a Medios
          </button>
        </div>
      ) : (
        <>
          <div className="vfx-workspace">
            <div className="vfx-stage">
              <div className="vfx-stage-head">
                <strong>{clip.label ?? 'Clip'}</strong>
                <span>
                  frame {localFrame + 1}/{clip.durationFrames} · {fps} fps
                </span>
              </div>
              <p className="fine-print vfx-stage-note">
                La vista aproxima el chroma sobre un damero y conserva la máscara. Sharpen y
                viñeta se aplican recién en el export; el color (HSL y match) sí se ve en el
                monitor del editor.
              </p>
              <div className={`vfx-frame${chroma && chromaPreview ? ' chroma-active' : ''}`}>
                {clip.kind === 'video' && url ? (
                  <video
                    ref={attachVideo}
                    className={chroma && chromaPreview ? 'chroma-source-hidden' : undefined}
                    src={url}
                    crossOrigin="anonymous"
                    muted
                    playsInline
                    preload="auto"
                  />
                ) : url ? (
                  <img
                    ref={attachImage}
                    className={chroma && chromaPreview ? 'chroma-source-hidden' : undefined}
                    src={url}
                    alt=""
                    crossOrigin="anonymous"
                  />
                ) : (
                  <div className="media-missing">Sin vista previa del medio</div>
                )}
                <ChromaPreview
                  source={mediaEl}
                  active={Boolean(chroma) && chromaPreview}
                  settings={{
                    color: chroma?.color ?? '#00ff00',
                    similarity: chroma?.similarity ?? 0.3,
                    blend: chroma?.blend ?? 0.12,
                    spill: chroma?.spill ?? 0,
                  }}
                  revision={localFrame}
                />
                <svg
                  className={`vfx-overlay${editPoints ? ' editing' : ''}`}
                  viewBox="0 0 1 1"
                  preserveAspectRatio="none"
                  onClick={addPoint}
                  onPointerMove={moveDrag}
                  onPointerUp={endDrag}
                  onPointerLeave={endDrag}
                >
                  {polygon ? (
                    <polygon
                      points={overlayPoints.map((point) => `${point.x},${point.y}`).join(' ')}
                      className="vfx-polygon"
                    />
                  ) : null}
                  {editPoints
                    ? overlayPoints.map((point, index) => (
                        <circle
                          key={`${index}-${point.x}-${point.y}`}
                          cx={point.x}
                          cy={point.y}
                          r={0.012}
                          className="vfx-vertex"
                          onPointerDown={(event) => {
                            event.stopPropagation();
                            event.currentTarget.setPointerCapture?.(event.pointerId);
                            startDrag(index);
                          }}
                          onClick={(event) => event.stopPropagation()}
                        />
                      ))
                    : null}
                </svg>
              </div>
              <div className="vfx-stage-controls">
                <input
                  type="range"
                  min={0}
                  max={Math.max(0, clip.durationFrames - 1)}
                  value={localFrame}
                  aria-label="Frame del clip para roto"
                  onChange={(event) =>
                    store.setPlayhead(clip.startFrame + Number(event.target.value))
                  }
                />
                <span className="vfx-frame-readout">
                  {polygon ? `${points.length} vértices` : 'Sin polígono'}
                </span>
              </div>
            </div>

            <div className="vfx-chain" aria-label="Cadena de nodos VFX">
              <article className="vfx-node">
                <header>
                  <span className="vfx-node-index">01</span>
                  <strong>Entrada</strong>
                  <span className="vfx-node-kind">Clip</span>
                </header>
                <p>{asset?.label ?? clip.label ?? 'Clip de la timeline'}</p>
              </article>

              <article className={`vfx-node${chroma ? ' on' : ''}`}>
                <header>
                  <span className="vfx-node-index">02</span>
                  <strong>Chroma</strong>
                  <label className="vfx-switch">
                    <input
                      type="checkbox"
                      checked={Boolean(chroma)}
                      onChange={(event) => {
                        if (event.target.checked) enableChroma('green');
                        else removeChroma();
                      }}
                    />
                    <span>{chroma ? 'on' : 'off'}</span>
                  </label>
                </header>
                {chroma ? (
                  <div className="vfx-node-fields">
                    <div className="vfx-preset-row">
                      <button type="button" className="small" onClick={() => enableChroma('green')}>
                        Verde
                      </button>
                      <button type="button" className="small" onClick={() => enableChroma('blue')}>
                        Azul
                      </button>
                      <button type="button" className="small" onClick={detectBackground}>
                        Detectar fondo
                      </button>
                      <button
                        type="button"
                        className="small ghost"
                        aria-pressed={chromaPreview}
                        onClick={() => setChromaPreview((value) => !value)}
                      >
                        {chromaPreview ? 'Vista de clave' : 'Vista original'}
                      </button>
                    </div>
                    <label className="field">
                      <span>Color clave</span>
                      <input
                        type="color"
                        value={chroma.color}
                        onChange={(event) => updateChroma({ color: event.target.value })}
                      />
                    </label>
                    <label className="field">
                      <span>Similitud {(chroma.similarity * 100).toFixed(0)} %</span>
                      <input
                        type="range"
                        min={0.01}
                        max={1}
                        step={0.01}
                        value={chroma.similarity}
                        onChange={(event) =>
                          updateChroma({ similarity: Number(event.target.value) })
                        }
                      />
                    </label>
                    <label className="field">
                      <span>Suavizado {(chroma.blend * 100).toFixed(0)} %</span>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.01}
                        value={chroma.blend}
                        onChange={(event) => updateChroma({ blend: Number(event.target.value) })}
                      />
                    </label>
                    <label className="field">
                      <span>Derrame {((chroma.spill ?? 0) * 100).toFixed(0)} %</span>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.01}
                        value={chroma.spill ?? 0}
                        onChange={(event) => updateChroma({ spill: Number(event.target.value) })}
                      />
                    </label>
                    <p className="fine-print">
                      Cualquier fondo parejo sirve: usá “Detectar fondo” sobre una pared o una
                      tela. Si hay textura o personas detrás,{' '}
                      <button
                        type="button"
                        className="link"
                        onClick={() => onNavigate('background')}
                      >
                        abrí Quitar fondo (IA)
                      </button>
                      .
                    </p>
                  </div>
                ) : (
                  <div className="vfx-node-fields">
                    <div className="vfx-preset-row">
                      <button
                        type="button"
                        className="small"
                        onClick={() => enableChroma('green')}
                      >
                        Pantalla verde
                      </button>
                      <button
                        type="button"
                        className="small"
                        onClick={() => enableChroma('blue')}
                      >
                        Pantalla azul
                      </button>
                      <button
                        type="button"
                        className="small"
                        onClick={detectBackground}
                      >
                        Detectar fondo
                      </button>
                    </div>
                    <p className="vfx-node-hint">
                      Elegí una pantalla o detectá el color del fondo actual.
                    </p>
                  </div>
                )}
              </article>

              <article className={`vfx-node${polygon ? ' on' : ''}`}>
                <header>
                  <span className="vfx-node-index">03</span>
                  <strong>Roto</strong>
                  <span className="vfx-node-kind">Polígono</span>
                </header>
                <p>
                  {polygon
                    ? `${points.length} vértices · ${polygon.keyframes?.length ?? 0} claves`
                    : 'Sin máscara poligonal.'}
                </p>
                <div className="vfx-node-actions">
                  <button type="button" className="small" onClick={createPolygon}>
                    {polygon ? 'Reiniciar polígono' : 'Crear polígono'}
                  </button>
                  <button
                    type="button"
                    className="small"
                    disabled={!polygon}
                    onClick={() => setEditPoints((value) => !value)}
                  >
                    {editPoints ? 'Terminar edición' : 'Editar vértices'}
                  </button>
                  <button
                    type="button"
                    className="small"
                    disabled={!polygon || busy}
                    onClick={() => void trackFace()}
                    title="Detecta el rostro principal y traslada el polígono con claves x/y"
                  >
                    <Icon name="sparkles" size={12} />
                    <span>{busy ? 'Analizando…' : 'Seguir rostro'}</span>
                  </button>
                  <button
                    type="button"
                    className="small"
                    disabled={!polygon || points.length <= 3}
                    onClick={removeLastPoint}
                  >
                    Quitar vértice
                  </button>
                  <button
                    type="button"
                    className="small"
                    disabled={!polygon}
                    onClick={() =>
                      store.update((current) =>
                        setMaskKeyframe(current, clip.id, localFrame, {
                          x: translateX,
                          y: translateY,
                        }),
                      )
                    }
                    title="Guarda la posición actual del polígono como clave en este frame"
                  >
                    Clave x/y
                  </button>
                  <button
                    type="button"
                    className="small"
                    disabled={!polygon}
                    onClick={() => {
                      if (
                        window.confirm(
                          'Quitar la máscara borra sus vértices y claves. ¿Continuar?',
                        )
                      ) {
                        patchMask(undefined);
                      }
                    }}
                  >
                    Quitar máscara
                  </button>
                </div>
                {editPoints ? (
                  <p className="vfx-node-hint">
                    Clic en el visor para agregar; arrastrá un vértice para moverlo.
                  </p>
                ) : null}
              </article>

              <article className="vfx-node on">
                <header>
                  <span className="vfx-node-index">04</span>
                  <strong>Color</strong>
                  <span className="vfx-node-kind">Look</span>
                </header>
                <div className="vfx-node-fields">
                  <label className="field">
                    <span>Brillo {((effects.brightness ?? 0) * 100).toFixed(0)}</span>
                    <input
                      type="range"
                      min={-1}
                      max={1}
                      step={0.01}
                      value={effects.brightness ?? 0}
                      onChange={(event) => patchEffects({ brightness: Number(event.target.value) })}
                    />
                  </label>
                  <label className="field">
                    <span>Contraste {(effects.contrast ?? 1).toFixed(2)}</span>
                    <input
                      type="range"
                      min={0}
                      max={3}
                      step={0.01}
                      value={effects.contrast ?? 1}
                      onChange={(event) => patchEffects({ contrast: Number(event.target.value) })}
                    />
                  </label>
                  <label className="field">
                    <span>Saturación {(effects.saturation ?? 1).toFixed(2)}</span>
                    <input
                      type="range"
                      min={0}
                      max={3}
                      step={0.01}
                      value={effects.saturation ?? 1}
                      onChange={(event) => patchEffects({ saturation: Number(event.target.value) })}
                    />
                  </label>
                </div>
              </article>

              <article className="vfx-node on">
                <header>
                  <span className="vfx-node-index">05</span>
                  <strong>Detalle</strong>
                  <span className="vfx-node-kind">Denoise / Sharpen / Blur</span>
                </header>
                <div className="vfx-node-fields">
                  <label className="field">
                    <span>Reducción de ruido {((effects.denoise ?? 0) * 100).toFixed(0)} %</span>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={effects.denoise ?? 0}
                      onChange={(event) => patchEffects({ denoise: Number(event.target.value) })}
                    />
                  </label>
                  <label className="field">
                    <span>Sharpen {(effects.sharpen ?? 0).toFixed(1)}</span>
                    <input
                      type="range"
                      min={0}
                      max={5}
                      step={0.1}
                      value={effects.sharpen ?? 0}
                      onChange={(event) => patchEffects({ sharpen: Number(event.target.value) })}
                    />
                  </label>
                  <label className="field">
                    <span>Blur {(effects.blur ?? 0).toFixed(1)}</span>
                    <input
                      type="range"
                      min={0}
                      max={50}
                      step={0.5}
                      value={effects.blur ?? 0}
                      onChange={(event) => patchEffects({ blur: Number(event.target.value) })}
                    />
                  </label>
                </div>
              </article>

              <article className="vfx-node vfx-output">
                <header>
                  <span className="vfx-node-index">06</span>
                  <strong>Salida</strong>
                  <span className="vfx-node-kind">Render</span>
                </header>
                <p>El clip sale con chroma, máscara y look aplicados en ese orden.</p>
              </article>
            </div>
          </div>

          {notice ? <p className="vfx-status">{notice}</p> : null}
          {error ? <p className="vfx-status error">{error}</p> : null}
        </>
      )}
    </section>
  );
}
