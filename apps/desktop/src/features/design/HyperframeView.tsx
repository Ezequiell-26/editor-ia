import { useEffect, useMemo, useRef, useState } from 'react';
import type { Asset } from '@editor-ia/project-schema';
import type { ViewId } from '../../app/navigation';
import { Icon } from '../../components/Icon';
import { addAsset, addClipFromAsset } from '../../state/project-actions';
import { useProjectStore } from '../../state/project-store';
import { fetchHyperframePreviewBase64, renderHyperframeToVideo } from './hyperframe';
import {
  filterHyperframePreviews,
  filterHyperframes,
  hyperframeDocumentUrl,
  hyperframePreviewUrl,
  hyperframePreviewVideoUrl,
  type HyperframeEntry,
  type HyperframePreviewEntry,
} from './open-design';
import type { DesignVideoResult } from './video';

const DURATIONS = [3, 5, 8, 10, 15] as const;
const FPS = [15, 30] as const;

function HyperframePreview({ entry }: { readonly entry: HyperframeEntry }) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(0.4);

  useEffect(() => {
    const node = frameRef.current;
    if (!node) return;
    const update = () => {
      const width = node.clientWidth;
      if (width > 0) setScale(width / entry.width);
    };
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [entry.width]);

  return (
    <div
      className="hyperframe-preview"
      ref={frameRef}
      style={{ aspectRatio: `${entry.width} / ${entry.height}` }}
    >
      <iframe
        key={entry.id}
        title={`Composición ${entry.title}`}
        src={hyperframeDocumentUrl(entry)}
        sandbox="allow-same-origin"
        style={{
          width: entry.width,
          height: entry.height,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
        }}
      />
    </div>
  );
}

export function HyperframeView({
  entries,
  previews = [],
  onNavigate,
}: {
  readonly entries: readonly HyperframeEntry[];
  readonly previews?: readonly HyperframePreviewEntry[];
  readonly onNavigate: (id: ViewId) => void;
}) {
  const store = useProjectStore();
  const [mode, setMode] = useState<'render' | 'preview'>('render');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(entries[0]?.id ?? null);
  const [seconds, setSeconds] = useState(5);
  const [fps, setFps] = useState<15 | 30>(15);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [video, setVideo] = useState<DesignVideoResult | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [saveBusy, setSaveBusy] = useState(false);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [mediaSent, setMediaSent] = useState<string | null>(null);
  const [mediaAsset, setMediaAsset] = useState<Asset | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(previews[0]?.id ?? null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewSaved, setPreviewSaved] = useState<string | null>(null);
  const [previewSent, setPreviewSent] = useState<string | null>(null);
  const [previewMediaAsset, setPreviewMediaAsset] = useState<Asset | null>(null);

  const filtered = useMemo(() => filterHyperframes(entries, query), [entries, query]);
  const filteredPreviews = useMemo(
    () => filterHyperframePreviews(previews, query),
    [previews, query],
  );
  const selectedPreview =
    previews.find((entry) => entry.id === previewId) ??
    filteredPreviews[0] ??
    previews[0] ??
    null;
  const selected =
    entries.find((entry) => entry.id === selectedId) ?? filtered[0] ?? entries[0] ?? null;
  const durations = selected
    ? DURATIONS.filter((value) => value <= selected.durationSec)
    : [...DURATIONS];

  function choose(entry: HyperframeEntry): void {
    setSelectedId(entry.id);
    setSeconds(Math.min(5, entry.durationSec));
    setVideo(null);
    setSaved(null);
    setError(null);
    setMediaError(null);
    setMediaSent(null);
    setMediaAsset(null);
  }

  async function render(): Promise<void> {
    if (!selected) return;
    setBusy(true);
    setError(null);
    setSaved(null);
    setVideo(null);
    setMediaError(null);
    setMediaSent(null);
    setMediaAsset(null);
    try {
      const result = await renderHyperframeToVideo(selected, {
        durationSeconds: Math.min(seconds, selected.durationSec),
        fps,
      });
      setVideo(result);
      store.setNotice(
        `HyperFrame ${selected.title} listo: ${result.width}×${result.height} · ${result.durationSeconds} s.`,
      );
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'No se pudo renderizar el HyperFrame.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function save(): Promise<void> {
    if (!video || !selected) return;
    setSaveBusy(true);
    setError(null);
    try {
      const path = await store.service.saveDesignVideo(
        video.base64,
        `hyperframe-${selected.id}.mp4`,
      );
      if (path) {
        setSaved(path);
        store.setNotice('HyperFrame guardado.');
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo guardar el video.');
    } finally {
      setSaveBusy(false);
    }
  }

  async function sendToMedia(): Promise<void> {
    if (!video) return;
    const project = store.state.project;
    if (!project) {
      setMediaError('Abrí un proyecto para enviar el HyperFrame a Medios.');
      return;
    }
    setMediaBusy(true);
    setMediaError(null);
    setMediaSent(null);
    try {
      const path = await store.service.stageDesignMedia(video.base64, 'mp4');
      const outcome = await store.service.importMediaPaths({
        paths: [path],
        fpsNum: project.video.frameRate.num,
        fpsDen: project.video.frameRate.den,
        confirmRights: true,
        provider: 'olyvia-design',
      });
      const imported = outcome.assets[0];
      if (!imported) {
        setMediaError(outcome.warnings[0] ?? 'No se pudo importar el video a Medios.');
        return;
      }
      const ok = store.update(
        (current) => addAsset(current, imported),
        { notice: `HyperFrame agregado a Medios: ${imported.label}.` },
      );
      if (!ok) {
        setMediaError(store.state.error ?? 'No se pudo agregar el video a Medios.');
        return;
      }
      setMediaSent(imported.label);
      setMediaAsset(imported);
    } catch (reason) {
      setMediaError(
        reason instanceof Error ? reason.message : 'No se pudo enviar el video a Medios.',
      );
    } finally {
      setMediaBusy(false);
    }
  }

  function mountInTimeline(): void {
    if (!mediaAsset) return;
    const ok = store.update(
      (current) =>
        addClipFromAsset(current, mediaAsset, { atFrame: store.state.playheadFrame }).project,
      { notice: `HyperFrame montado en la timeline: ${mediaAsset.label}.` },
    );
    if (!ok) {
      setMediaError(store.state.error ?? 'No se pudo montar el video en la timeline.');
      return;
    }
    onNavigate('editor');
  }

  async function savePreview(): Promise<void> {
    if (!selectedPreview) return;
    setPreviewBusy(true);
    setPreviewError(null);
    setPreviewSaved(null);
    try {
      const base64 = await fetchHyperframePreviewBase64(selectedPreview);
      const path = await store.service.saveDesignVideo(
        base64,
        `hyperframe-preview-${selectedPreview.id}.mp4`,
      );
      if (path) {
        setPreviewSaved(path);
        store.setNotice('Preview guardado.');
      }
    } catch (reason) {
      setPreviewError(
        reason instanceof Error ? reason.message : 'No se pudo guardar el preview.',
      );
    } finally {
      setPreviewBusy(false);
    }
  }

  async function sendPreviewToMedia(): Promise<void> {
    if (!selectedPreview) return;
    const project = store.state.project;
    if (!project) {
      setPreviewError('Abrí un proyecto para enviar el preview a Medios.');
      return;
    }
    setPreviewBusy(true);
    setPreviewError(null);
    setPreviewSent(null);
    try {
      const base64 = await fetchHyperframePreviewBase64(selectedPreview);
      const path = await store.service.stageDesignMedia(base64, 'mp4');
      const outcome = await store.service.importMediaPaths({
        paths: [path],
        fpsNum: project.video.frameRate.num,
        fpsDen: project.video.frameRate.den,
        confirmRights: true,
        provider: 'olyvia-design',
      });
      const imported = outcome.assets[0];
      if (!imported) {
        setPreviewError(outcome.warnings[0] ?? 'No se pudo importar el preview a Medios.');
        return;
      }
      const ok = store.update(
        (current) => addAsset(current, imported),
        { notice: `Preview agregado a Medios: ${imported.label}.` },
      );
      if (!ok) {
        setPreviewError(store.state.error ?? 'No se pudo agregar el preview a Medios.');
        return;
      }
      setPreviewSent(imported.label);
      setPreviewMediaAsset(imported);
    } catch (reason) {
      setPreviewError(
        reason instanceof Error ? reason.message : 'No se pudo enviar el preview a Medios.',
      );
    } finally {
      setPreviewBusy(false);
    }
  }

  function mountPreview(): void {
    if (!previewMediaAsset) return;
    const ok = store.update(
      (current) =>
        addClipFromAsset(current, previewMediaAsset, {
          atFrame: store.state.playheadFrame,
        }).project,
      { notice: `Preview montado en la timeline: ${previewMediaAsset.label}.` },
    );
    if (!ok) {
      setPreviewError(store.state.error ?? 'No se pudo montar el preview en la timeline.');
      return;
    }
    onNavigate('editor');
  }

  function changeMode(next: 'render' | 'preview'): void {
    setMode(next);
    setQuery('');
    setError(null);
    setPreviewError(null);
    setPreviewSaved(null);
    setPreviewSent(null);
  }

  return (
    <div className="hyperframe-panel">
      <div className="hyperframe-hero">
        <div>
          <span className="design-kicker">
            <Icon name="film" size={13} />
            HyperFrames · Apache-2.0
          </span>
          <h2>Composiciones reales, renderizables o en preview oficial</h2>
          <p>
            {entries.length} composiciones HTML/CSS con animaciones y fuentes locales,
            renderizadas en Olyvia con WebCodecs. Sumá {previews.length} previews MP4
            de las que usan scripts/GSAP: no ejecutamos su runtime, pero podés verlas,
            descargarlas y montarlas. Sólo la variante Remotion quedó fuera.
          </p>
        </div>
        <ul className="design-image-facts" aria-label="Qué incluye">
          <li>Preview en vivo</li>
          <li>MP4 VP9 local</li>
          <li>Guardar y enviar a Medios</li>
          <li>Montaje en la timeline</li>
        </ul>
      </div>

      <div className="hyperframe-toolbar">
        <div className="hyperframe-modes" role="group" aria-label="Tipo de composición">
          <button
            type="button"
            aria-pressed={mode === 'render'}
            className={mode === 'render' ? 'active' : ''}
            onClick={() => changeMode('render')}
          >
            Renderizables <span>{entries.length}</span>
          </button>
          <button
            type="button"
            aria-pressed={mode === 'preview'}
            className={mode === 'preview' ? 'active' : ''}
            disabled={previews.length === 0}
            onClick={() => changeMode('preview')}
          >
            Solo preview <span>{previews.length}</span>
          </button>
        </div>
        <label className="design-search">
          <Icon name="search" size={14} />
          <input
            type="search"
            value={query}
            placeholder={
              mode === 'preview'
                ? 'Buscar un preview por nombre, estilo o etiqueta…'
                : 'Buscar una composición por nombre, estilo o etiqueta…'
            }
            aria-label="Buscar HyperFrames"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <span className="design-result-count">
          {mode === 'preview' ? filteredPreviews.length : filtered.length}{' '}
          {mode === 'preview' ? 'previews' : 'composiciones'}
        </span>
      </div>

      <div className="hyperframe-body" hidden={mode !== 'render'}>
        <ul className="hyperframe-list" aria-label="Composiciones HyperFrames">
          {filtered.map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                aria-current={selected?.id === entry.id ? 'true' : undefined}
                className={selected?.id === entry.id ? 'active' : ''}
                onClick={() => choose(entry)}
              >
                <img src={hyperframePreviewUrl(entry)} alt="" loading="lazy" />
                <span>
                  <strong>{entry.title}</strong>
                  <small>
                    {entry.width}×{entry.height} · {entry.durationSec} s · {entry.license}
                  </small>
                </span>
              </button>
            </li>
          ))}
        </ul>

        {selected ? (
          <article className="hyperframe-detail">
            <header>
              <div>
                <span className="design-detail-kicker">
                  {selected.category} · {selected.aspect}
                </span>
                <h2>{selected.title}</h2>
                <p>{selected.summary}</p>
              </div>
              <div className="hyperframe-badges">
                {selected.tags.slice(0, 5).map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>
            </header>

            <HyperframePreview entry={selected} />

            <div className="hyperframe-controls">
              <fieldset>
                <legend>Duración</legend>
                {durations.map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={seconds === value}
                    className={seconds === value ? 'active' : ''}
                    onClick={() => setSeconds(value)}
                  >
                    {value} s
                  </button>
                ))}
              </fieldset>
              <fieldset>
                <legend>FPS</legend>
                {FPS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={fps === value}
                    className={fps === value ? 'active' : ''}
                    onClick={() => setFps(value)}
                  >
                    {value} fps
                  </button>
                ))}
              </fieldset>
              <button
                type="button"
                className="primary icon-text"
                disabled={busy}
                onClick={() => void render()}
              >
                <Icon name="film" size={14} />
                <span>{busy ? 'Renderizando…' : 'Renderizar MP4'}</span>
              </button>
            </div>

            {busy ? (
              <p className="hyperframe-status" role="status">
                Capturando y codificando frames con WebCodecs. No cierres esta vista.
              </p>
            ) : null}
            {error ? (
              <p className="design-inline-error" role="alert">
                {error}
              </p>
            ) : null}

            {video ? (
              <div className="hyperframe-result">
                <video src={video.url} controls aria-label={`Video de ${selected.title}`} />
                <p className="design-image-meta">
                  <strong>
                    {video.width}×{video.height}
                  </strong>
                  <span>{video.durationSeconds} s</span>
                  <span>{video.fps} fps</span>
                  <span>{video.scenes} escena</span>
                  <span>{Math.round((video.base64.length * 3) / 4 / 1024)} KB</span>
                </p>
                <div className="design-image-actions">
                  <button
                    type="button"
                    className="small"
                    onClick={() => void save()}
                    disabled={saveBusy}
                  >
                    <Icon name="save" size={14} />
                    <span>{saveBusy ? 'Guardando…' : 'Guardar MP4'}</span>
                  </button>
                  <button
                    type="button"
                    className="small"
                    onClick={() => void sendToMedia()}
                    disabled={mediaBusy}
                  >
                    <Icon name="assets" size={14} />
                    <span>{mediaBusy ? 'Enviando…' : 'Enviar a Medios'}</span>
                  </button>
                  {mediaAsset ? (
                    <button
                      type="button"
                      className="small primary icon-text"
                      onClick={mountInTimeline}
                    >
                      <Icon name="editor" size={14} />
                      <span>Montar en la timeline</span>
                    </button>
                  ) : null}
                </div>
                {saved ? (
                  <p className="design-generator-saved" role="status">
                    Guardado en <strong>{saved}</strong>
                  </p>
                ) : null}
                {mediaSent ? (
                  <p className="design-generator-saved" role="status">
                    En Medios como <strong>{mediaSent}</strong>.
                  </p>
                ) : null}
                {mediaError ? (
                  <p className="design-inline-error" role="alert">
                    {mediaError}
                  </p>
                ) : null}
              </div>
            ) : null}

            <footer className="design-source">
              {selected.author ? <>Autor: {selected.author} · </> : null}
              Licencia {selected.license}
              {selected.sourceUrl ? (
                <>
                  {' '}·{' '}
                  <a href={selected.sourceUrl} target="_blank" rel="noreferrer">
                    ver original <Icon name="external" size={11} />
                  </a>
                </>
              ) : null}{' '}
              · Fuentes locales de Google Fonts (OFL-1.1).
            </footer>
          </article>
        ) : (
          <p className="design-empty" role="status">
            Ninguna composición coincide con la búsqueda.
          </p>
        )}
      </div>

      <div className="hyperframe-body" hidden={mode !== 'preview'}>
        <ul className="hyperframe-list" aria-label="Previews HyperFrames">
          {filteredPreviews.map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                aria-current={selectedPreview?.id === entry.id ? 'true' : undefined}
                className={selectedPreview?.id === entry.id ? 'active' : ''}
                onClick={() => setPreviewId(entry.id)}
              >
                <img src={hyperframePreviewUrl(entry)} alt="" loading="lazy" />
                <span>
                  <strong>{entry.title}</strong>
                  <small>{entry.license} · preview oficial</small>
                </span>
              </button>
            </li>
          ))}
        </ul>

        {selectedPreview ? (
          <article className="hyperframe-detail">
            <header>
              <div>
                <span className="design-detail-kicker">
                  Preview oficial · {selectedPreview.aspect}
                </span>
                <h2>{selectedPreview.title}</h2>
                <p>{selectedPreview.summary}</p>
              </div>
              <div className="hyperframe-badges">
                {selectedPreview.tags.slice(0, 5).map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>
            </header>

            <div className="hyperframe-preview-video">
              <video
                src={hyperframePreviewVideoUrl(selectedPreview)}
                poster={hyperframePreviewUrl(selectedPreview)}
                controls
                preload="metadata"
                aria-label={`Preview de ${selectedPreview.title}`}
              />
            </div>

            <p className="hyperframe-status">
              Esta composición usa {selectedPreview.reason}. Olyvia no ejecuta su
              runtime ni permite editar el HTML: el MP4 es el preview oficial ya
              renderizado, listo para descargar o montar.
            </p>

            <div className="design-image-actions">
              <button
                type="button"
                className="small"
                onClick={() => void savePreview()}
                disabled={previewBusy}
              >
                <Icon name="save" size={14} />
                <span>{previewBusy ? 'Preparando…' : 'Guardar MP4'}</span>
              </button>
              <button
                type="button"
                className="small"
                onClick={() => void sendPreviewToMedia()}
                disabled={previewBusy}
              >
                <Icon name="assets" size={14} />
                <span>Enviar a Medios</span>
              </button>
              {previewMediaAsset ? (
                <button type="button" className="small primary icon-text" onClick={mountPreview}>
                  <Icon name="editor" size={14} />
                  <span>Montar en la timeline</span>
                </button>
              ) : null}
            </div>

            {previewSaved ? (
              <p className="design-generator-saved" role="status">
                Guardado en <strong>{previewSaved}</strong>
              </p>
            ) : null}
            {previewSent ? (
              <p className="design-generator-saved" role="status">
                En Medios como <strong>{previewSent}</strong>.
              </p>
            ) : null}
            {previewError ? (
              <p className="design-inline-error" role="alert">
                {previewError}
              </p>
            ) : null}

            <footer className="design-source">
              {selectedPreview.author ? <>Autor: {selectedPreview.author} · </> : null}
              Licencia {selectedPreview.license} · Preview oficial, no editable.
            </footer>
          </article>
        ) : (
          <p className="design-empty" role="status">
            Ningún preview coincide con la búsqueda.
          </p>
        )}
      </div>
    </div>
  );
}
