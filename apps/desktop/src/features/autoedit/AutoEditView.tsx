import { useMemo, useState } from 'react';
import type { Asset } from '@editor-ia/project-schema';
import type { ViewId } from '../../app/navigation';
import { Icon } from '../../components/Icon';
import type { TranscriptionResult } from '../../services/project-service';
import { parseSubtitles } from '../../state/subtitles';
import { useProjectStore } from '../../state/project-store';
import { applyAutoEditVariant } from './apply-auto-edit';
import {
  DEFAULT_RECIPE,
  MAX_CUT_SECONDS,
  MIN_CUT_SECONDS,
  buildAutoEditVariants,
  clampRecipe,
  recipeSummary,
  reorderVariant,
  subsetVariant,
  type AutoEditRecipe,
  type AutoEditSource,
  type AutoEditTransition,
  type AutoEditVariant,
} from './auto-edit';
import { buildDirectorMessages, parseDirectorProposal, type DirectorProposal } from './ai-director';

const MAX_SOURCES = 6;

function formatSeconds(value: number): string {
  const total = Math.max(0, Math.round(value));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function formatLufs(value: number | null | undefined): string {
  return value === null || value === undefined ? 'sin medir' : `${value.toFixed(1)} LUFS`;
}

const REASON_LABEL: Record<string, string> = {
  hook: 'gancho',
  speech: 'voz',
  scene: 'escena',
  energy: 'energía',
  fill: 'relleno',
};

/** Convierte la onda medida en energía 0–1 lista para puntuar. */
function energyFromPeaks(peaks: readonly { min: number; max: number }[]): number[] {
  return peaks.map((peak) =>
    Math.min(1, Math.max(Math.abs(peak.min), Math.abs(peak.max)) / 0.35),
  );
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

  const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);
  const [recipe, setRecipe] = useState<AutoEditRecipe>(DEFAULT_RECIPE);
  const [sources, setSources] = useState<readonly AutoEditSource[]>([]);
  const [included, setIncluded] = useState<Record<string, readonly number[]>>({});
  const [orders, setOrders] = useState<Record<string, readonly number[]>>({});
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [allowTranscription, setAllowTranscription] = useState(false);
  const [useEmbeddedCaptions, setUseEmbeddedCaptions] = useState(true);
  const [improveAudio, setImproveAudio] = useState(true);
  const [addCaptions, setAddCaptions] = useState(true);
  const [replaceTimeline, setReplaceTimeline] = useState(true);
  const [approveCost, setApproveCost] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [director, setDirector] = useState<DirectorProposal | null>(null);
  const [directorFor, setDirectorFor] = useState<string | null>(null);
  const [directorBusy, setDirectorBusy] = useState(false);
  const [directorError, setDirectorError] = useState<string | null>(null);

  // El motor es puro: mover un control reconstruye las variantes al instante,
  // sin volver a medir el video.
  const variants = useMemo<readonly AutoEditVariant[]>(
    () => (sources.length === 0 ? [] : buildAutoEditVariants(sources, clampRecipe(recipe))),
    [sources, recipe],
  );

  /** Variantes con el orden que haya propuesto la IA (si lo hay). */
  const finalVariants = useMemo(
    () =>
      variants.map((variant) => {
        const order = orders[variant.id];
        return order ? reorderVariant(variant, order) : variant;
      }),
    [variants, orders],
  );

  const selection =
    selectedIds.length > 0 ? selectedIds : videoAssets.slice(0, 1).map((asset) => asset.id);

  const totals = useMemo(
    () => ({
      videos: sources.length,
      duration: sources.reduce((sum, source) => sum + source.analysis.durationSeconds, 0),
      scenes: sources.reduce((sum, source) => sum + source.analysis.scenes.length, 0),
      silences: sources.reduce((sum, source) => sum + source.analysis.silences.length, 0),
      transcribed: sources.filter((source) => source.transcript).length,
      lufs: sources[0]?.analysis.loudness?.integratedLufs ?? null,
    }),
    [sources],
  );

  function patch(next: Partial<AutoEditRecipe>): void {
    // Cambiar la receta invalida el orden de la IA: los cortes ya no son los mismos.
    setOrders({});
    setDirector(null);
    setDirectorFor(null);
    setRecipe((current) => clampRecipe({ ...current, ...next }));
  }

  function toggleSource(id: string): void {
    setSelectedIds((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id);
      if (current.length >= MAX_SOURCES) return current;
      return [...current, id];
    });
  }

  function includedIndices(variant: AutoEditVariant): readonly number[] {
    const stored = included[variant.id];
    const all = variant.cuts.map((_, index) => index);
    if (!stored) return all;
    const valid = stored.filter((index) => index >= 0 && index < variant.cuts.length);
    return valid.length > 0 ? valid : all;
  }

  function toggleCut(variant: AutoEditVariant, index: number): void {
    const current = new Set(includedIndices(variant));
    if (current.has(index)) {
      if (current.size === 1) return;
      current.delete(index);
    } else {
      current.add(index);
    }
    setIncluded((previous) => ({
      ...previous,
      [variant.id]: [...current].sort((a, b) => a - b),
    }));
  }

  async function analyze(): Promise<void> {
    if (busy) return;
    const picked = selection
      .map((id) => videoAssets.find((asset) => asset.id === id))
      .filter((asset): asset is Asset => Boolean(asset));
    if (picked.length === 0) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    setDirector(null);
    setDirectorFor(null);
    setDirectorError(null);
    setSources([]);
    setIncluded({});
    setOrders({});
    setTitles({});
    try {
      const measured: AutoEditSource[] = [];
      const messages: string[] = [];
      for (const [index, asset] of picked.entries()) {
        setStage(`Midiendo ${index + 1}/${picked.length}: ${asset.label}…`);
        const analysis = await store.service.analyzeMedia(
          asset.id,
          undefined,
          undefined,
          undefined,
          false,
        );
        let energy: number[] | null = null;
        if (analysis.hasAudio) {
          try {
            const peaks = await store.service.audioPeaks(asset.id, 240);
            energy = energyFromPeaks(peaks.peaks);
          } catch {
            energy = null;
          }
        }
        let transcript: TranscriptionResult | null = null;
        if (addCaptions && useEmbeddedCaptions) {
          try {
            const extracted = await store.service.extractSubtitles(asset.source.path);
            if (extracted) {
              const parsed = parseSubtitles(extracted.srt);
              if (parsed.cues.length > 0) {
                transcript = {
                  language: extracted.language ?? project?.language ?? 'es',
                  languageProbability: 1,
                  durationSeconds: analysis.durationSeconds,
                  model: 'embedded',
                  segments: parsed.cues.map((cue) => ({
                    start: cue.startSeconds,
                    end: cue.endSeconds,
                    text: cue.text,
                    words: [],
                  })),
                };
                messages.push(`${asset.label}: ${parsed.cues.length} subtítulos incrustados.`);
              }
            }
          } catch {
            // Un video sin pista de subtítulos no es un error del montaje.
          }
        }
        if (!transcript && allowTranscription) {
          setStage(`Transcribiendo ${index + 1}/${picked.length}: ${asset.label}…`);
          try {
            transcript = await store.service.transcribeAsset(asset.id);
            messages.push(`${asset.label}: ${transcript.segments.length} segmentos de voz.`);
          } catch (cause) {
            messages.push(
              `${asset.label}: no se pudo transcribir (${
                cause instanceof Error ? cause.message : 'modelo no disponible'
              }).`,
            );
          }
        }
        measured.push({
          assetId: asset.id,
          label: asset.label,
          analysis,
          transcript,
          energy,
        });
      }
      setSources(measured);
      const built = buildAutoEditVariants(measured, clampRecipe(recipe));
      if (built.length === 0) {
        setError('No hay suficiente material limpio para armar variantes.');
      } else {
        setNotice(
          `${built.length} variantes con ${measured.length} video${
            measured.length === 1 ? '' : 's'
          }. ${messages.join(' ')}`.trim(),
        );
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'no se pudo analizar el material');
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
      if (sources.length === 0) {
        setNotice(`${picked.name}: analizá el material primero para poder subtitularlo.`);
        return;
      }
      // Un SRT no declara de qué archivo salió: se asocia al primero medido en
      // lugar de repartirlo a ciegas entre varios videos.
      const [first, ...rest] = sources;
      const text: TranscriptionResult = {
        language: project?.language ?? 'es',
        languageProbability: 1,
        durationSeconds: first!.analysis.durationSeconds,
        model: 'file',
        segments: parsed.cues.map((cue) => ({
          start: cue.startSeconds,
          end: cue.endSeconds,
          text: cue.text,
          words: [],
        })),
      };
      setSources([{ ...first!, transcript: text }, ...rest]);
      setOrders({});
      setNotice(`${picked.name}: ${parsed.cues.length} subtítulos cargados en ${first!.label}.`);
    } catch (cause) {
      setNotice(
        cause instanceof Error ? cause.message : 'no se pudo leer el archivo de subtítulos',
      );
    }
  }

  function applyVariant(variant: AutoEditVariant): void {
    if (!project || sources.length === 0) return;
    const chosen = subsetVariant(variant, includedIndices(variant));
    if (chosen.cuts.length === 0) {
      setError('No hay cortes seleccionados para aplicar.');
      return;
    }
    const label = titles[variant.id] ?? chosen.name;
    if (replaceTimeline && project.timeline.clips.length > 0) {
      const confirmed = window.confirm(
        `Se reemplazarán ${project.timeline.clips.length} clip(s), ${
          project.timeline.tracks.length
        } pista(s) y ${project.captions.cues.length} subtítulo(s) por “${label}”. Podés deshacer. ¿Continuar?`,
      );
      if (!confirmed) return;
    }
    const matched = videoAssets.filter((asset) =>
      chosen.cuts.some((cut) => cut.assetId === asset.id),
    );
    try {
      const applied = store.update((current) =>
        applyAutoEditVariant(
          current,
          matched.length > 0 ? matched : videoAssets,
          chosen,
          sources[0]?.analysis ?? null,
          {
            replace: replaceTimeline,
            improveAudio,
            addCaptions: addCaptions && chosen.captions.length > 0,
            transition: chosen.recipe.transition,
            zoom: chosen.recipe.zoom,
          },
        ).project,
      );
      if (!applied) return;
      store.setNotice(
        `${label} aplicado (${
          replaceTimeline ? 'reemplazó la timeline' : 'agregado al final'
        }, ${chosen.cuts.length} cortes). Revisá el corte y exportá desde el editor; podés deshacer.`,
      );
      onNavigate('editor');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'no se pudo aplicar la variante');
    }
  }

  async function askDirector(variant: AutoEditVariant): Promise<void> {
    if (directorBusy) return;
    if (!approveCost) {
      setDirectorError(
        'Marcá la autorización de consumo de cuota antes de pedir criterio a la IA.',
      );
      return;
    }
    setDirectorBusy(true);
    setDirectorError(null);
    setDirector(null);
    setDirectorFor(null);
    try {
      const reply = await store.service.assistantChat({
        messages: buildDirectorMessages(
          variant,
          sources.map((source) => source.label),
        ),
        approvedCost: true,
      });
      if (reply.simulated) {
        setDirectorError(
          'El proveedor está en modo simulado: la respuesta no se aplica. Configurá un proveedor real en Ajustes → IA.',
        );
        return;
      }
      const proposal = parseDirectorProposal(reply.reply, variant, reply.model);
      if (!proposal) {
        setDirectorError(
          'La IA no devolvió un orden válido para estos cortes. Se mantiene el orden medido.',
        );
        return;
      }
      setDirector(proposal);
      setDirectorFor(variant.id);
    } catch (cause) {
      setDirectorError(cause instanceof Error ? cause.message : 'la IA no respondió');
    } finally {
      setDirectorBusy(false);
    }
  }

  function applyDirector(variant: AutoEditVariant): void {
    if (!director || directorFor !== variant.id) return;
    if (director.order.length !== variant.cuts.length) {
      setDirectorError('Los cortes cambiaron desde que la IA respondió. Volvé a pedirlo.');
      return;
    }
    setOrders((current) => ({ ...current, [variant.id]: director.order }));
    setTitles((current) => ({ ...current, [variant.id]: director.title }));
    setIncluded({});
    setDirector(null);
    setDirectorFor(null);
    setDirectorError(null);
    setNotice(
      `“${director.title}” reordenado por la IA. Revisá la timeline antes de aplicar.`,
    );
  }

  if (!project) {
    return (
      <section className="view auto-edit-view">
        <header className="view-toolbar">
          <div>
            <h1>Editor automático</h1>
            <p>Cortes por análisis local y, si querés, una segunda opinión de la IA.</p>
          </div>
        </header>
        <div className="empty-state">
          <Icon name="film" size={28} />
          <h2>Abrí un proyecto</h2>
          <p>El editor automático trabaja sobre videos ya importados en Medios.</p>
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
            Mide escenas, silencios, negros, energía de audio y voz con FFmpeg, y arma
            variantes editables. Todo corre en tu máquina.
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
            disabled={busy || videoAssets.length === 0}
            onClick={() => void analyze()}
          >
            <Icon name="sparkles" size={15} />
            <span>
              {busy ? 'Analizando…' : sources.length > 0 ? 'Volver a analizar' : 'Analizar material'}
            </span>
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
          <div className="auto-edit-side">
            <div className="card auto-edit-source">
              <div className="production-card-head">
                <div>
                  <p className="eyebrow">Material</p>
                  <h3>Qué entra al montaje</h3>
                </div>
                <span className="fine-print">
                  {selection.length}/{MAX_SOURCES}
                </span>
              </div>
              <ul className="auto-source-list" aria-label="Videos disponibles">
                {videoAssets.map((asset) => {
                  const checked = selection.includes(asset.id);
                  const measured = sources.find((source) => source.assetId === asset.id);
                  return (
                    <li key={asset.id}>
                      <label className={`auto-source-row${checked ? ' on' : ''}`}>
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={busy}
                          onChange={() => toggleSource(asset.id)}
                        />
                        <span className="auto-source-name">{asset.label}</span>
                        <span className="auto-source-meta">
                          {measured
                            ? `${formatSeconds(measured.analysis.durationSeconds)} · ${
                                measured.analysis.scenes.length
                              } esc.`
                            : 'sin medir'}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
              <p className="fine-print">
                Con más de un video el montaje alterna archivos para que no se sienta pegado a
                una sola toma. Máximo {MAX_SOURCES} por análisis.
              </p>
            </div>

            <div className="card">
              <div className="production-card-head">
                <div>
                  <p className="eyebrow">Receta</p>
                  <h3>Ritmo y textura</h3>
                </div>
              </div>
              <div className="auto-recipe">
                <label className="field auto-slider">
                  <span>
                    Duración del corte <output>{recipe.cutSeconds.toFixed(1)} s</output>
                  </span>
                  <input
                    type="range"
                    min={MIN_CUT_SECONDS}
                    max={MAX_CUT_SECONDS}
                    step={0.1}
                    value={recipe.cutSeconds}
                    onChange={(event) => patch({ cutSeconds: Number(event.target.value) })}
                    aria-label="Duración media del corte"
                  />
                </label>
                <label className="field auto-slider">
                  <span>
                    Duración objetivo{' '}
                    <output>
                      {recipe.targetSeconds === 0 ? 'sin límite' : `${recipe.targetSeconds} s`}
                    </output>
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={180}
                    step={5}
                    value={recipe.targetSeconds}
                    onChange={(event) => patch({ targetSeconds: Number(event.target.value) })}
                    aria-label="Duración objetivo del montaje"
                  />
                </label>
                <label className="field auto-slider">
                  <span>
                    Zoom <output>{recipe.zoom}%</output>
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={recipe.zoom}
                    onChange={(event) => patch({ zoom: Number(event.target.value) })}
                    aria-label="Intensidad del zoom"
                  />
                </label>
                <label className="field">
                  <span>Transición entre cortes</span>
                  <select
                    value={recipe.transition}
                    onChange={(event) =>
                      patch({ transition: event.target.value as AutoEditTransition })
                    }
                  >
                    <option value="dissolve">Disolvencia</option>
                    <option value="fade">Fundido a negro</option>
                    <option value="none">Corte seco</option>
                  </select>
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={recipe.hook}
                    onChange={(event) => patch({ hook: event.target.checked })}
                  />
                  <span>Abrir con el gancho de mayor energía (más corto).</span>
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={recipe.speechCuts}
                    onChange={(event) => patch({ speechCuts: event.target.checked })}
                  />
                  <span>Cortar en pausas de voz cuando hay transcripción.</span>
                </label>
              </div>
              <p className="fine-print">{recipeSummary(recipe)}</p>
            </div>

            <div className="card">
              <div className="production-card-head">
                <div>
                  <p className="eyebrow">Al aplicar</p>
                  <h3>Qué se escribe en la timeline</h3>
                </div>
              </div>
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
                  <span>Agregar subtítulos si hay texto disponible.</span>
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={useEmbeddedCaptions}
                    onChange={(event) => setUseEmbeddedCaptions(event.target.checked)}
                  />
                  <span>Leer subtítulos incrustados del video (sin IA).</span>
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
                  <span>Transcribir con Whisper local al analizar (lento, sin nube).</span>
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={replaceTimeline}
                    onChange={(event) => setReplaceTimeline(event.target.checked)}
                  />
                  <span>Reemplazar la timeline al aplicar (desmarcado = agregar al final).</span>
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={approveCost}
                    onChange={(event) => setApproveCost(event.target.checked)}
                  />
                  <span>Autorizo el consumo de cuota del proveedor para el criterio de la IA.</span>
                </label>
              </div>
            </div>
          </div>

          <div className="auto-edit-results">
            {stage ? (
              <p className="fine-print" role="status">
                {stage}
              </p>
            ) : null}
            {error ? (
              <p className="banner banner-error" role="alert">
                {error}
              </p>
            ) : null}
            {notice ? <p className="fine-print">{notice}</p> : null}
            {directorError ? (
              <p className="notice notice-warning" role="alert">
                {directorError}
              </p>
            ) : null}

            {sources.length > 0 ? (
              <div className="auto-edit-chips" aria-label="Resultado del análisis">
                <span>
                  {totals.videos} video{totals.videos === 1 ? '' : 's'}
                </span>
                <span>{formatSeconds(totals.duration)} de material</span>
                <span>
                  {totals.scenes} escena{totals.scenes === 1 ? '' : 's'}
                </span>
                <span>
                  {totals.silences} silencio{totals.silences === 1 ? '' : 's'}
                </span>
                <span>
                  {totals.transcribed} con texto
                </span>
                <span>{formatLufs(totals.lufs)}</span>
              </div>
            ) : null}

            {finalVariants.length === 0 ? (
              <div className="card auto-edit-empty">
                <Icon name="film" size={22} />
                <h3>Sin variantes todavía</h3>
                <p>
                  Elegí el material, ajustá la receta y tocá «Analizar material». Vas a obtener
                  cuatro ediciones del mismo material: tu receta, pulso rápido, historia e
                  impacto. Después elegís qué cortes llevar a la timeline.
                </p>
              </div>
            ) : (
              finalVariants.map((variant) => {
                const chosenIndices = includedIndices(variant);
                const chosen = subsetVariant(variant, chosenIndices);
                const title = titles[variant.id] ?? variant.name;
                const proposal = directorFor === variant.id ? director : null;
                return (
                  <article className="card auto-edit-variant" key={variant.id}>
                    <header>
                      <div>
                        <p className="eyebrow">{variant.style}</p>
                        <h3>{title}</h3>
                      </div>
                      <div className="auto-variant-stats">
                        <strong>{formatSeconds(chosen.durationSeconds)}</strong>
                        <span className="auto-score" title="Interés medio medido">
                          {variant.score}/100
                        </span>
                      </div>
                    </header>
                    <p>{variant.description}</p>
                    <div className="auto-timeline" role="group" aria-label={`Cortes de ${title}`}>
                      {variant.cuts.map((cut, index) => {
                        const on = chosenIndices.includes(index);
                        const share =
                          (cut.endSeconds - cut.startSeconds) /
                          Math.max(0.1, variant.durationSeconds);
                        return (
                          <button
                            key={`${cut.assetId}-${cut.startSeconds}-${index}`}
                            type="button"
                            className={`auto-cut${on ? ' on' : ''}${cut.zoom ? ' zoom' : ''}`}
                            style={{ flexGrow: Math.max(0.4, share * 100), flexBasis: 0 }}
                            aria-pressed={on}
                            title={`${formatSeconds(cut.startSeconds)}–${formatSeconds(
                              cut.endSeconds,
                            )} · interés ${cut.score} · ${REASON_LABEL[cut.reason] ?? cut.reason}${
                              cut.zoom ? ' · con zoom' : ''
                            }`}
                            onClick={() => toggleCut(variant, index)}
                          >
                            <span className="auto-cut-index">{index + 1}</span>
                          </button>
                        );
                      })}
                    </div>
                    <p className="fine-print">
                      {chosen.cuts.length} de {variant.cuts.length} cortes · {chosen.zoomCount} con
                      zoom · {chosen.captions.length} subtítulo
                      {chosen.captions.length === 1 ? '' : 's'} · {recipeSummary(variant.recipe)}
                    </p>
                    <details className="auto-cut-details">
                      <summary>Ver los cortes</summary>
                      <ol className="auto-cut-list">
                        {variant.cuts.map((cut, index) => (
                          <li
                            key={`${cut.assetId}-${cut.startSeconds}-list-${index}`}
                            className={chosenIndices.includes(index) ? '' : 'off'}
                          >
                            <span>
                              {formatSeconds(cut.startSeconds)}–{formatSeconds(cut.endSeconds)}
                            </span>
                            <span>{REASON_LABEL[cut.reason] ?? cut.reason}</span>
                            <span>{cut.score}</span>
                          </li>
                        ))}
                      </ol>
                    </details>

                    {proposal ? (
                      <div className="auto-director-proposal">
                        <strong>{proposal.title}</strong>
                        {proposal.hook ? <p>Gancho: «{proposal.hook}»</p> : null}
                        {proposal.notes ? <p className="fine-print">{proposal.notes}</p> : null}
                        <p className="fine-print">
                          Modelo: <code>{proposal.model}</code> · orden de {proposal.order.length}{' '}
                          cortes
                        </p>
                        <div className="actions compact">
                          <button
                            type="button"
                            className="primary"
                            onClick={() => applyDirector(variant)}
                          >
                            Aplicar orden
                          </button>
                          <button
                            type="button"
                            className="ghost"
                            onClick={() => {
                              setDirector(null);
                              setDirectorFor(null);
                            }}
                          >
                            Descartar
                          </button>
                        </div>
                      </div>
                    ) : null}

                    <div className="actions compact">
                      <button
                        type="button"
                        className="primary"
                        onClick={() => applyVariant(variant)}
                      >
                        {replaceTimeline ? 'Reemplazar timeline' : 'Agregar al final'} ·{' '}
                        {formatSeconds(chosen.durationSeconds)}
                      </button>
                      <button
                        type="button"
                        className="ghost icon-text"
                        disabled={directorBusy || !approveCost}
                        title={
                          approveCost
                            ? 'La IA propone otro orden para estos cortes'
                            : 'Marcá la autorización de cuota en la columna izquierda'
                        }
                        onClick={() => void askDirector(variant)}
                      >
                        <Icon name="sparkles" size={14} />
                        <span>{directorBusy ? 'Consultando…' : 'Criterio IA'}</span>
                      </button>
                      {chosenIndices.length < variant.cuts.length ? (
                        <button
                          type="button"
                          className="ghost"
                          onClick={() =>
                            setIncluded((previous) => {
                              const next = { ...previous };
                              delete next[variant.id];
                              return next;
                            })
                          }
                        >
                          Restablecer cortes
                        </button>
                      ) : null}
                    </div>
                  </article>
                );
              })
            )}
          </div>
        </div>
      )}
    </section>
  );
}
