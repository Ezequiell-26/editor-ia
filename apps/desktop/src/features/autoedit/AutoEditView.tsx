import { useMemo, useState } from 'react';
import type { Asset } from '@editor-ia/project-schema';
import type { ViewId } from '../../app/navigation';
import { Icon } from '../../components/Icon';
import type {
  MediaAnalysis,
  TranscriptionResult,
} from '../../services/project-service';
import { parseSubtitles } from '../../state/subtitles';
import { useProjectStore } from '../../state/project-store';
import { applyAutoEditVariant } from './apply-auto-edit';
import {
  buildAutoEditVariants,
  type AutoEditVariant,
} from './auto-edit';

function formatSeconds(value: number): string {
  const total = Math.max(0, Math.round(value));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function formatLufs(value: number | null | undefined): string {
  return value === null || value === undefined ? 'sin medir' : `${value.toFixed(1)} LUFS`;
}

function variantSummary(variant: AutoEditVariant): string {
  return `${variant.cuts.length} cortes · ${variant.zoomCount} zoom${
    variant.zoomCount === 1 ? '' : 's'
  } · ${variant.captions.length} subtítulo${variant.captions.length === 1 ? '' : 's'}`;
}

export function AutoEditView({ onNavigate }: { readonly onNavigate: (id: ViewId) => void }) {
  const store = useProjectStore();
  const project = store.state.project;
  const videoAssets = useMemo<readonly Asset[]>(
    () =>
      (project?.assets ?? []).filter(
        (asset) => asset.kind === 'video' && asset.status === 'ready',
      ),
    [project],
  );
  const [selectedAssetId, setSelectedAssetId] = useState('');
  const asset =
    videoAssets.find((item) => item.id === selectedAssetId) ?? videoAssets[0];
  const [analysis, setAnalysis] = useState<MediaAnalysis | null>(null);
  const [transcript, setTranscript] = useState<TranscriptionResult | null>(null);
  const [variants, setVariants] = useState<readonly AutoEditVariant[]>([]);
  const [allowTranscription, setAllowTranscription] = useState(false);
  const [useEmbeddedCaptions, setUseEmbeddedCaptions] = useState(true);
  const [improveAudio, setImproveAudio] = useState(true);
  const [addCaptions, setAddCaptions] = useState(true);
  const [replaceTimeline, setReplaceTimeline] = useState(true);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function analyze(): Promise<void> {
    if (!asset || busy) return;
    setBusy(true);
    setStage('Midiendo escenas, silencios y audio…');
    setError(null);
    setNotice(null);
    setVariants([]);
    try {
      // Automático no usa luma/saturación: omitirlas evita tres procesos
      // FFmpeg y casi la mitad del costo de análisis en la muestra medida.
      const measured = await store.service.analyzeMedia(
        asset.id,
        undefined,
        undefined,
        undefined,
        false,
      );
      setAnalysis(measured);
      let text: TranscriptionResult | null = transcript;
      const messages: string[] = [];
      if (addCaptions && useEmbeddedCaptions) {
        setStage('Buscando subtítulos incrustados…');
        try {
          const extracted = await store.service.extractSubtitles(asset.source.path);
          if (extracted) {
            const parsed = parseSubtitles(extracted.srt);
            if (parsed.cues.length > 0) {
              text = {
                language: extracted.language ?? store.state.project?.language ?? 'es',
                languageProbability: 1,
                durationSeconds: measured.durationSeconds,
                model: 'embedded',
                segments: parsed.cues.map((cue) => ({
                  start: cue.startSeconds,
                  end: cue.endSeconds,
                  text: cue.text,
                  words: [],
                })),
              };
              setTranscript(text);
              messages.push(
                `${parsed.cues.length} subtítulos incrustados${
                  extracted.language ? ` (${extracted.language})` : ''
                }.`,
              );
            }
          } else {
            messages.push('El video no trae subtítulos incrustados.');
          }
        } catch (cause) {
          messages.push(
            `No se pudieron leer los subtítulos incrustados: ${
              cause instanceof Error ? cause.message : 'error de FFmpeg'
            }.`,
          );
        }
      }
      if (!text && allowTranscription) {
        setStage('Transcribiendo con el modelo local…');
        try {
          text = await store.service.transcribeAsset(asset.id);
          setTranscript(text);
          messages.push(`Transcripción local: ${text.segments.length} segmentos.`);
        } catch (cause) {
          messages.push(
            `No se pudo transcribir: ${
              cause instanceof Error ? cause.message : 'modelo no disponible'
            }. Las variantes se generan sin subtítulos.`,
          );
        }
      }
      const generated = buildAutoEditVariants(measured, addCaptions ? text : null);
      setVariants(generated);
      if (generated.length === 0) {
        setError('No hay suficiente material limpio para armar variantes.');
      } else {
        setNotice(
          `${generated.length} variantes listas. ${messages.join(' ')} No se creó ningún clip todavía.`,
        );
      }
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'no se pudo analizar el video',
      );
    } finally {
      setBusy(false);
      setStage('');
    }
  }

  async function importSubtitleFile(): Promise<void> {
    try {
      const picked = await store.service.chooseSubtitleFile();
      if (!picked) return;
      const parsed = parseSubtitles(picked.text);
      if (parsed.cues.length === 0) {
        setNotice(`${picked.name}: no se encontraron subtítulos válidos.`);
        return;
      }
      const text: TranscriptionResult = {
        language: store.state.project?.language ?? 'es',
        languageProbability: 1,
        durationSeconds: analysis?.durationSeconds ?? 0,
        model: 'file',
        segments: parsed.cues.map((cue) => ({
          start: cue.startSeconds,
          end: cue.endSeconds,
          text: cue.text,
          words: [],
        })),
      };
      setTranscript(text);
      if (analysis) setVariants(buildAutoEditVariants(analysis, addCaptions ? text : null));
      setNotice(`${picked.name}: ${parsed.cues.length} subtítulos cargados.`);
    } catch (cause) {
      setNotice(
        cause instanceof Error ? cause.message : 'no se pudo leer el archivo de subtítulos',
      );
    }
  }

  function applyVariant(variant: AutoEditVariant): void {
    if (!project || !asset || !analysis) return;
    if (replaceTimeline && project.timeline.clips.length > 0) {
      const confirmed = window.confirm(
        `Se reemplazarán ${project.timeline.clips.length} clip(s), ${
          project.timeline.tracks.length
        } pista(s) y ${project.captions.cues.length} subtítulo(s) por “${variant.name}”. Podés deshacer. ¿Continuar?`,
      );
      if (!confirmed) return;
    }
    const applied = store.update((current) =>
      applyAutoEditVariant(current, asset, variant, analysis, {
        replace: replaceTimeline,
        improveAudio,
        addCaptions: addCaptions && transcript !== null,
      }).project,
    );
    if (!applied) return;
    store.setNotice(
      `${variant.name} aplicado (${
        replaceTimeline ? 'reemplazó la timeline' : 'agregado al final'
      }). Revisá el corte y exportá desde el editor; podés deshacer.`,
    );
    onNavigate('editor');
  }

  if (!project) {
    return (
      <section className="view auto-edit-view">
        <header className="view-toolbar">
          <div>
            <h1>Editor automático</h1>
            <p>Cortes por análisis local, sin LLM ni servicios externos.</p>
          </div>
        </header>
        <div className="empty-state">
          <Icon name="film" size={28} />
          <h2>Abrí un proyecto</h2>
          <p>El editor automático trabaja sobre un video ya importado en Medios.</p>
          <button type="button" className="primary" onClick={() => onNavigate('projects')}>
            Abrir un proyecto
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="view auto-edit-view">
      <header className="view-toolbar">
        <div>
          <h1>Editor automático</h1>
          <p>
            Analiza escenas, silencios, negros y loudness con FFmpeg y arma variantes
            editables. Sin LLM ni servicios externos.
          </p>
        </div>
        <div className="auto-edit-actions">
          <button type="button" className="small icon-text" onClick={() => onNavigate('editor')}>
            <Icon name="editor" size={14} />
            <span>Volver al editor</span>
          </button>
          <button
            type="button"
            className="primary icon-text"
            disabled={!asset || busy}
            onClick={() => void analyze()}
          >
            <Icon name="sparkles" size={15} />
            <span>{busy ? 'Analizando…' : 'Analizar video'}</span>
          </button>
        </div>
      </header>

      {videoAssets.length === 0 ? (
        <div className="empty-state">
          <Icon name="film" size={28} />
          <h2>No hay videos listos</h2>
          <p>Importá un video en Medios y confirmá sus derechos para empezar.</p>
          <button type="button" className="primary" onClick={() => onNavigate('assets')}>
            Ir a Medios
          </button>
        </div>
      ) : (
        <div className="auto-edit-grid">
          <div className="card auto-edit-source">
            <div className="production-card-head">
              <div>
                <p className="eyebrow">Fuente</p>
                <h3>Elegí el material</h3>
              </div>
            </div>
            <label className="field">
              <span>Video</span>
              <select
                value={asset?.id ?? ''}
                onChange={(event) => {
                  setSelectedAssetId(event.target.value);
                  setAnalysis(null);
                  setVariants([]);
                  setTranscript(null);
                  setNotice(null);
                  setError(null);
                }}
              >
                {videoAssets.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>

            {analysis ? (
              <div className="auto-edit-chips" aria-label="Resultado del análisis">
                <span>{formatSeconds(analysis.durationSeconds)}</span>
                <span>{analysis.scenes.length} escenas</span>
                <span>{analysis.silences.length} silencios</span>
                <span>{analysis.blacks.length} negros</span>
                <span>{formatLufs(analysis.loudness?.integratedLufs)}</span>
              </div>
            ) : (
              <p className="fine-print">
                La medición usa el análisis local que ya alimenta a Director. No sube el
                video a ninguna nube.
              </p>
            )}

            <div className="auto-edit-options">
              <label className="check">
                <input
                  type="checkbox"
                  checked={improveAudio}
                  onChange={(event) => setImproveAudio(event.target.checked)}
                />
                <span>Mejorar audio: high-pass, denoise, compresor y gain a −14 LUFS.</span>
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={addCaptions}
                  onChange={(event) => setAddCaptions(event.target.checked)}
                />
                <span>Agregar subtítulos si hay transcripción disponible.</span>
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={useEmbeddedCaptions}
                  onChange={(event) => setUseEmbeddedCaptions(event.target.checked)}
                />
                <span>Usar subtítulos incrustados del video (sin IA).</span>
              </label>
              <button
                type="button"
                className="small ghost"
                disabled={busy}
                onClick={() => void importSubtitleFile()}
              >
                Importar SRT/VTT…
              </button>
              <label className="check">
                <input
                  type="checkbox"
                  checked={allowTranscription}
                  onChange={(event) => setAllowTranscription(event.target.checked)}
                />
                <span>
                  Transcribir con el modelo local (Whisper) al analizar. Es opcional y no
                  usa proveedores externos.
                </span>
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={replaceTimeline}
                  onChange={(event) => setReplaceTimeline(event.target.checked)}
                />
                <span>
                  Reemplazar la timeline al aplicar (desmarcado = agregar al final).
                </span>
              </label>
            </div>

            {stage ? <p className="fine-print">{stage}</p> : null}
            {error ? (
              <p className="banner banner-error" role="alert">
                {error}
              </p>
            ) : null}
            {notice ? <p className="fine-print">{notice}</p> : null}
            {transcript ? (
              <p className="fine-print">
                Transcripción: {transcript.segments.length} segmentos · idioma{' '}
                {transcript.language}.
              </p>
            ) : null}
          </div>

          <div className="auto-edit-results">
            {variants.length === 0 ? (
              <div className="card auto-edit-empty">
                <Icon name="film" size={22} />
                <h3>Sin variantes todavía</h3>
                <p>
                  Analizá el video para obtener tres ediciones: pulso rápido, historia e
                  impacto. Después elegís cuál llevar a la timeline.
                </p>
              </div>
            ) : (
              variants.map((variant) => (
                <article className="card auto-edit-variant" key={variant.id}>
                  <header>
                    <div>
                      <p className="eyebrow">{variant.style}</p>
                      <h3>{variant.name}</h3>
                    </div>
                    <strong>{formatSeconds(variant.durationSeconds)}</strong>
                  </header>
                  <p>{variant.description}</p>
                  <p className="fine-print">{variantSummary(variant)}</p>
                  {variant.captions.length > 0 && !(addCaptions && transcript) ? (
                    <p className="fine-print">
                      Los subtítulos de esta variante no se aplicarán: la opción está
                      desactivada o no hay transcripción cargada.
                    </p>
                  ) : null}
                  {variant.captions.length === 0 && addCaptions ? (
                    <p className="fine-print">
                      Sin subtítulos: el video no trae una pista incrustada y no importaste
                      un SRT/VTT.
                    </p>
                  ) : null}
                  <div className="actions compact">
                    <button
                      type="button"
                      className="primary"
                      onClick={() => applyVariant(variant)}
                    >
                      {replaceTimeline ? 'Reemplazar timeline' : 'Agregar al final'}
                    </button>
                  </div>
                </article>
              ))
            )}
          </div>
        </div>
      )}
    </section>
  );
}
