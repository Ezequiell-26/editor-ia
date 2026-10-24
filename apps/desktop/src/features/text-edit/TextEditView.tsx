import { useEffect, useMemo, useState } from 'react';
import type { ViewId } from '../../app/navigation';
import { Icon } from '../../components/Icon';
import { ViewToolbar } from '../../components/ViewToolbar';
import type { TranscriptionResult } from '../../services/project-service';
import { fpsOf } from '../../state/project-actions';
import { useProjectStore } from '../../state/project-store';
import {
  buildTextEditProject,
  selectedDurationSeconds,
  transcriptToRanges,
  videoDurationFrames,
  type TextEditBuild,
} from './text-edit';

function clock(seconds: number): string {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const rest = safe - minutes * 60;
  return `${minutes}:${rest.toFixed(2).padStart(5, '0')}`;
}

/**
 * Edición basada en texto: transcribe un video con Whisper local, deja elegir
 * qué segmentos del texto quedan y arma un corte nuevo, no destructivo, en una
 * pista secuencial. El material original no se toca.
 */
export function TextEditView({ onNavigate }: { readonly onNavigate: (id: ViewId) => void }) {
  const store = useProjectStore();
  const project = store.state.project;
  const videos = useMemo(
    () =>
      (project?.assets ?? []).filter(
        (asset) => asset.kind === 'video' && asset.status === 'ready',
      ),
    [project],
  );
  const [assetId, setAssetId] = useState('');
  const [transcript, setTranscript] = useState<TranscriptionResult | null>(null);
  const [excluded, setExcluded] = useState<ReadonlySet<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const asset = videos.find((item) => item.id === assetId) ?? null;
  const fps = project ? fpsOf(project) : 30;
  const mediaFrames = asset ? videoDurationFrames(asset) : null;

  useEffect(() => {
    if (videos.length === 0) {
      if (assetId) setAssetId('');
      return;
    }
    if (!videos.some((item) => item.id === assetId)) {
      setAssetId(videos[0]?.id ?? '');
    }
  }, [videos, assetId]);

  useEffect(() => {
    setTranscript(null);
    setExcluded(new Set());
    setError(null);
  }, [assetId]);

  const ranges = useMemo(
    () =>
      transcript && mediaFrames
        ? transcriptToRanges(transcript.segments, fps, mediaFrames, [...excluded])
        : [],
    [transcript, mediaFrames, fps, excluded],
  );
  const seconds = selectedDurationSeconds(ranges, fps);

  async function transcribe(): Promise<void> {
    if (!asset || !project) return;
    setBusy(true);
    setError(null);
    setTranscript(null);
    setExcluded(new Set());
    try {
      const result = await store.service.transcribeAsset(asset.id, 'auto', 'small');
      setTranscript(result);
      store.setNotice(
        `Transcripción lista: ${result.segments.length} segmentos en ${result.language}.`,
      );
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'no se pudo transcribir el video con Whisper local',
      );
    } finally {
      setBusy(false);
    }
  }

  function toggle(index: number): void {
    setExcluded((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  function apply(): void {
    if (!project || !asset || !transcript) return;
    let built: TextEditBuild | null = null;
    const ok = store.mutate(
      (current) => {
        built = buildTextEditProject(current, asset, transcript.segments, [...excluded]);
        return { project: built.project };
      },
      {
        notice: `Edición por texto: ${ranges.length} segmento(s), ${clock(seconds)} en la pista «Texto».`,
      },
    );
    if (!ok || !built) {
      setError('No se pudo crear el corte por texto; el proyecto quedó igual.');
      return;
    }
    store.setSelection({ kind: 'none' });
    store.setPlayhead(0);
    onNavigate('editor');
  }

  return (
    <section className="view text-edit-view">
      <ViewToolbar
        label="Edición por texto"
        actions={
          <button type="button" className="ghost icon-text" onClick={() => onNavigate('learn')}>
            <Icon name="learn" size={14} />
            <span>Ayuda</span>
          </button>
        }
      />

      <header className="text-edit-head">
        <div>
          <h2>Editá el video desde el texto</h2>
          <p>
            Whisper transcribe el audio en esta máquina. Desmarcá las frases que sobran y Olyvia
            arma un corte limpio en una pista nueva; las pistas originales quedan intactas.
          </p>
        </div>
        <span className="fine-print">IA local · el audio no sale del equipo</span>
      </header>

      {!project ? (
        <div className="card text-edit-empty">
          <h3>Abrí un proyecto</h3>
          <p>La edición por texto necesita un proyecto con un video y sus derechos confirmados.</p>
          <button type="button" className="primary icon-text" onClick={() => onNavigate('projects')}>
            <Icon name="projects" size={15} />
            <span>Ir a Proyectos</span>
          </button>
        </div>
      ) : videos.length === 0 ? (
        <div className="card text-edit-empty">
          <h3>No hay videos listos</h3>
          <p>Importá un video en Medios y confirmá sus derechos para poder transcribirlo.</p>
          <button type="button" className="primary icon-text" onClick={() => onNavigate('assets')}>
            <Icon name="assets" size={15} />
            <span>Ir a Medios</span>
          </button>
        </div>
      ) : (
        <>
          <div className="card text-edit-controls">
            <label className="field">
              <span>Video a transcribir</span>
              <select
                value={assetId}
                onChange={(event) => setAssetId(event.target.value)}
                disabled={busy}
              >
                {videos.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="text-edit-source-meta">
              <span>
                {mediaFrames
                  ? `${clock(mediaFrames / fps)} de material · ${fps.toFixed(0)} fps`
                  : 'duración desconocida'}
              </span>
              <span>Modelo Whisper small · CPU</span>
            </div>
            <button
              type="button"
              className="primary icon-text"
              onClick={() => void transcribe()}
              disabled={busy || !asset}
            >
              <Icon name="captions" size={15} />
              <span>{busy ? 'Transcribiendo…' : transcript ? 'Volver a transcribir' : 'Transcribir'}</span>
            </button>
          </div>

          {busy ? (
            <p className="notice notice-notice" role="status">
              Transcribiendo con Whisper local. En CPU puede tardar; podés seguir editando mientras
              termina.
            </p>
          ) : null}

          {error ? (
            <p className="notice notice-warning" role="alert">
              {error}
            </p>
          ) : null}

          {transcript ? (
            <div className="card text-edit-transcript">
              <header className="text-edit-transcript-head">
                <div>
                  <p className="eyebrow">Transcripción</p>
                  <h3>
                    {transcript.segments.length} segmentos · idioma {transcript.language}
                  </h3>
                  <p className="muted">
                    Quedan {ranges.length} segmento(s) · {clock(seconds)} de corte. Desmarcá lo
                    que no querés.
                  </p>
                </div>
                <div className="text-edit-bulk">
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => setExcluded(new Set())}
                    disabled={excluded.size === 0}
                  >
                    Todo
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() =>
                      setExcluded(new Set(transcript.segments.map((_, index) => index)))
                    }
                    disabled={excluded.size === transcript.segments.length}
                  >
                    Nada
                  </button>
                </div>
              </header>

              <ol className="text-edit-list">
                {transcript.segments.map((segment, index) => {
                  const included = !excluded.has(index);
                  const segmentText = segment.text.trim() || 'Sin texto';
                  return (
                    <li
                      key={`${index}-${segment.start}`}
                      className={`text-edit-segment${included ? '' : ' is-removed'}`}
                    >
                      <label>
                        <input
                          type="checkbox"
                          checked={included}
                          onChange={() => toggle(index)}
                          aria-label={`Incluir «${segmentText}»`}
                        />
                        <span className="text-edit-time">
                          {clock(segment.start)} → {clock(segment.end)}
                        </span>
                        <span className="text-edit-copy">{segmentText}</span>
                      </label>
                    </li>
                  );
                })}
              </ol>

              <footer className="text-edit-actions">
                <p className="fine-print">
                  Se agrega una pista «Texto» al principio de la timeline. El video y el audio
                  originales no se borran.
                </p>
                <button
                  type="button"
                  className="primary icon-text"
                  onClick={apply}
                  disabled={ranges.length === 0}
                >
                  <Icon name="editor" size={15} />
                  <span>Crear corte por texto</span>
                </button>
              </footer>
            </div>
          ) : null}

          {!transcript && !busy && !error ? (
            <div className="card text-edit-empty">
              <h3>Transcribí para empezar</h3>
              <p>
                La edición por texto usa la transcripción palabra por palabra: elegí el video y
                pulsá Transcribir. Después vas a poder quitar frases enteras y montar el corte.
              </p>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
