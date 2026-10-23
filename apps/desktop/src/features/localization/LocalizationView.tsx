import { useEffect, useState } from 'react';
import type { ViewId } from '../../app/navigation';
import { Icon } from '../../components/Icon';
import { ViewToolbar } from '../../components/ViewToolbar';
import type {
  CloneEngine,
  CloneVoiceResult,
  DubResult,
  LipSyncResult,
  ProviderInfo,
  SaveLocalizedSubtitleResult,
  TranslatedTexts,
  VoiceInfo,
} from '../../services/project-service';
import { useProjectStore } from '../../state/project-store';
import {
  parseSubtitles,
  serializeSrtSeconds,
  serializeVttSeconds,
  type ParsedSubtitles,
  type SubtitleCueSeconds,
} from '../../state/subtitles';
import {
  LOCALIZATION_LANGUAGES,
  chunkCues,
  estimateLocalizationTokens,
  formatLocalizationBytes,
  isLocalProviderBaseUrl,
  localizationLanguage,
  subtitleTexts,
  type LocalizationFormat,
  type LocalizationLanguageCode,
} from './localization';

interface SubtitleSource {
  readonly name: string;
  readonly parsed: ParsedSubtitles;
}

interface LocalizedCues {
  readonly language: LocalizationLanguageCode;
  readonly cues: SubtitleCueSeconds[];
  readonly simulated: boolean;
  readonly providerId: string;
  readonly model: string;
}

function baseName(name: string): string {
  return name.replace(/\.[^.]+$/, '') || 'subtitulos';
}

function totalCharacters(cues: readonly SubtitleCueSeconds[]): number {
  return cues.reduce((sum, cue) => sum + cue.text.trim().length, 0);
}

export function LocalizationView({
  onNavigate,
}: {
  readonly onNavigate: (id: ViewId) => void;
}) {
  const store = useProjectStore();
  const [source, setSource] = useState<SubtitleSource | null>(null);
  const [sourceLanguage, setSourceLanguage] = useState('auto');
  const [targets, setTargets] = useState<LocalizationLanguageCode[]>(['en']);
  const [format, setFormat] = useState<LocalizationFormat>('srt');
  const [glossary, setGlossary] = useState('');
  const [approvedCost, setApprovedCost] = useState(false);
  const [provider, setProvider] = useState<ProviderInfo | null>(null);
  const [translations, setTranslations] = useState<
    Partial<Record<LocalizationLanguageCode, LocalizedCues>>
  >({});
  const [activeTarget, setActiveTarget] = useState<LocalizationLanguageCode>('en');
  const [outputDir, setOutputDir] = useState<string | null>(null);
  const [results, setResults] = useState<SaveLocalizedSubtitleResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dubAssetId, setDubAssetId] = useState('');
  const [dubLanguage, setDubLanguage] = useState<LocalizationLanguageCode>('en');
  const [voices, setVoices] = useState<VoiceInfo[]>([]);
  const [dubVoice, setDubVoice] = useState('');
  const [bedVolume, setBedVolume] = useState(0);
  const [dubBusy, setDubBusy] = useState(false);
  const [dubProgress, setDubProgress] = useState(0);
  const [dubResult, setDubResult] = useState<DubResult | null>(null);
  const [dubError, setDubError] = useState<string | null>(null);
  const [cloneReferenceId, setCloneReferenceId] = useState('');
  const [cloneEngine, setCloneEngine] = useState<CloneEngine>('xtts');
  const [cloneUrl, setCloneUrl] = useState('http://127.0.0.1:8020');
  const [cloneLanguage, setCloneLanguage] = useState<LocalizationLanguageCode>('es');
  const [cloneText, setCloneText] = useState('');
  const [clonePrompt, setClonePrompt] = useState('');
  const [cloneKey, setCloneKey] = useState('');
  const [cloneBusy, setCloneBusy] = useState(false);
  const [cloneProgress, setCloneProgress] = useState(0);
  const [cloneResult, setCloneResult] = useState<CloneVoiceResult | null>(null);
  const [cloneError, setCloneError] = useState<string | null>(null);
  const [lipVideoId, setLipVideoId] = useState('');
  const [lipAudioId, setLipAudioId] = useState('');
  const [lipEngine, setLipEngine] = useState('wav2lip');
  const [lipUrl, setLipUrl] = useState('http://127.0.0.1:8765/lipsync');
  const [lipKey, setLipKey] = useState('');
  const [lipBusy, setLipBusy] = useState(false);
  const [lipProgress, setLipProgress] = useState(0);
  const [lipResult, setLipResult] = useState<LipSyncResult | null>(null);
  const [lipError, setLipError] = useState<string | null>(null);

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
    let active = true;
    void store.service
      .listVoices()
      .then((list) => {
        if (active) setVoices(list);
      })
      .catch(() => {
        if (active) setVoices([]);
      });
    return () => {
      active = false;
    };
  }, [store.service]);

  useEffect(() => {
    let active = true;
    let stop: (() => void) | null = null;
    void store.service
      .onDubProgress((event) => {
        if (active) setDubProgress(event.percent);
      })
      .then((unlisten) => {
        if (active) stop = unlisten;
        else unlisten();
      })
      .catch(() => {});
    return () => {
      active = false;
      stop?.();
    };
  }, [store.service]);

  useEffect(() => {
    let active = true;
    let stop: (() => void) | null = null;
    void store.service
      .onCloneProgress((event) => {
        if (active) setCloneProgress(event.percent);
      })
      .then((unlisten) => {
        if (active) stop = unlisten;
        else unlisten();
      })
      .catch(() => {});
    return () => {
      active = false;
      stop?.();
    };
  }, [store.service]);

  useEffect(() => {
    let active = true;
    let stop: (() => void) | null = null;
    void store.service
      .onLipSyncProgress((event) => {
        if (active) setLipProgress(event.percent);
      })
      .then((unlisten) => {
        if (active) stop = unlisten;
        else unlisten();
      })
      .catch(() => {});
    return () => {
      active = false;
      stop?.();
    };
  }, [store.service]);

  const project = store.state.project;
  const videos = (project?.assets ?? []).filter(
    (asset) => asset.kind === 'video' && asset.status === 'ready',
  );
  const audioAssets = (project?.assets ?? []).filter((asset) => asset.kind === 'audio');
  const translatedLanguages = Object.keys(translations) as LocalizationLanguageCode[];
  const dubTranslation = translations[dubLanguage] ?? null;
  const dubCues = dubTranslation?.cues ?? [];
  const matchingVoices = voices.filter((voice) =>
    voice.culture.toLowerCase().startsWith(dubLanguage),
  );
  const dubEnd =
    dubCues.length > 0 ? Math.max(...dubCues.map((cue) => cue.endSeconds)) : 0;

  useEffect(() => {
    if (videos.length > 0 && !videos.some((asset) => asset.id === dubAssetId)) {
      setDubAssetId(videos[0]!.id);
    }
  }, [videos, dubAssetId]);

  useEffect(() => {
    if (
      audioAssets.length > 0 &&
      !audioAssets.some((asset) => asset.id === cloneReferenceId)
    ) {
      setCloneReferenceId(audioAssets[0]!.id);
    }
  }, [audioAssets, cloneReferenceId]);

  useEffect(() => {
    if (videos.length > 0 && !videos.some((asset) => asset.id === lipVideoId)) {
      setLipVideoId(videos[0]!.id);
    }
    if (audioAssets.length > 0 && !audioAssets.some((asset) => asset.id === lipAudioId)) {
      setLipAudioId(audioAssets[0]!.id);
    }
  }, [videos, audioAssets, lipVideoId, lipAudioId]);

  useEffect(() => {
    if (translatedLanguages.length > 0 && !translatedLanguages.includes(dubLanguage)) {
      setDubLanguage(translatedLanguages[0]!);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [translations]);

  useEffect(() => {
    if (matchingVoices.length === 0) {
      setDubVoice('');
      return;
    }
    if (!matchingVoices.some((voice) => voice.name === dubVoice)) {
      setDubVoice(matchingVoices[0]!.name);
    }
  }, [dubLanguage, voices]);

  const simulator = provider?.kind === 'mock';
  const remote = Boolean(provider && !simulator && !isLocalProviderBaseUrl(provider.baseUrl));
  const cues = source?.parsed.cues ?? [];
  const characters = totalCharacters(cues);
  const chunks = chunkCues(cues);
  const active = translations[activeTarget] ?? null;
  const selectedTranslations = targets
    .map((code) => translations[code])
    .filter((value): value is LocalizedCues => Boolean(value));
  const hasSimulated = selectedTranslations.some((value) => value.simulated);

  async function pickFile(): Promise<void> {
    setBusy(true);
    setError(null);
    setResults([]);
    try {
      const picked = await store.service.chooseSubtitleFile();
      if (!picked) return;
      const parsed = parseSubtitles(picked.text);
      if (parsed.cues.length === 0) {
        setSource(null);
        setError(
          parsed.warnings[0] ?? 'El archivo no tiene subtítulos con tiempos válidos.',
        );
        return;
      }
      setSource({ name: picked.name, parsed });
      setTranslations({});
      setActiveTarget(targets[0] ?? 'en');
      store.setNotice(
        `${picked.name}: ${parsed.cues.length} subtítulos listos para localizar.`,
      );
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : 'no se pudo leer el archivo de subtítulos',
      );
    } finally {
      setBusy(false);
    }
  }

  function toggleTarget(code: LocalizationLanguageCode): void {
    if (targets.includes(code)) {
      const next = targets.filter((item) => item !== code);
      setTargets(next);
      if (activeTarget === code) setActiveTarget(next[0] ?? 'en');
      return;
    }
    setTargets([...targets, code]);
    setActiveTarget(code);
  }

  async function translate(): Promise<void> {
    if (!source) {
      setError('Elegí un archivo de subtítulos con tiempos antes de traducir.');
      return;
    }
    if (targets.length === 0) {
      setError('Elegí al menos un idioma de destino.');
      return;
    }
    if (remote && !approvedCost) {
      setError('Autorizá el consumo de cuota del proveedor remoto antes de traducir.');
      return;
    }
    setBusy(true);
    setError(null);
    setResults([]);
    setTranslations({});
    setProgress(null);
    try {
      for (const language of targets) {
        let merged: TranslatedTexts | null = null;
        const translated: string[] = [];
        for (const [index, chunk] of chunks.entries()) {
          const label = localizationLanguage(language)?.label ?? language;
          setProgress(
            chunks.length > 1
              ? `${label}: lote ${index + 1} de ${chunks.length}`
              : `${label}: traduciendo ${chunk.cues.length} subtítulos`,
          );
          const response = await store.service.translateSubtitles({
            texts: subtitleTexts(chunk.cues),
            sourceLanguage,
            targetLanguage: language,
            ...(glossary.trim() ? { glossary: glossary.trim() } : {}),
            approvedCost,
          });
          if (response.texts.length !== chunk.cues.length) {
            throw new Error(
              `${label}: el proveedor devolvió ${response.texts.length} textos y se esperaban ${chunk.cues.length}.`,
            );
          }
          translated.push(...response.texts);
          merged = response;
        }
        if (translated.length !== source.parsed.cues.length) {
          throw new Error('La traducción no cubrió todos los subtítulos; no se aplicó.');
        }
        const localized: LocalizedCues = {
          language,
          cues: source.parsed.cues.map((cue, index) => ({
            ...cue,
            text: translated[index] ?? cue.text,
          })),
          simulated: merged?.simulated ?? true,
          providerId: merged?.providerId ?? 'desconocido',
          model: merged?.model ?? '',
        };
        setTranslations((current) => ({ ...current, [language]: localized }));
        setActiveTarget(language);
      }
      setProgress(null);
      store.setNotice('Traducción terminada; revisá el texto antes de exportar.');
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : 'no se pudo traducir el archivo',
      );
      setProgress(null);
    } finally {
      setBusy(false);
    }
  }

  async function chooseFolder(): Promise<void> {
    try {
      const folder = await store.service.chooseDownloadDirectory();
      if (folder) setOutputDir(folder);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'no se pudo elegir la carpeta');
    }
  }

  async function exportAll(): Promise<void> {
    if (!source) {
      setError('Elegí un archivo de subtítulos antes de exportar.');
      return;
    }
    if (hasSimulated) {
      setError(
        'El proveedor simulado no produce una traducción real; configurá un proveedor en Ajustes para exportar.',
      );
      return;
    }
    if (selectedTranslations.length === 0) {
      setError('Traducí al menos un idioma antes de exportar.');
      return;
    }
    setBusy(true);
    setError(null);
    setResults([]);
    try {
      let destination = outputDir;
      if (!destination) {
        destination = await store.service.chooseDownloadDirectory();
        if (!destination) {
          setError('Elegí una carpeta de destino para los subtítulos.');
          return;
        }
        setOutputDir(destination);
      }
      const saved: SaveLocalizedSubtitleResult[] = [];
      for (const localized of selectedTranslations) {
        const content =
          format === 'srt'
            ? serializeSrtSeconds(localized.cues)
            : serializeVttSeconds(localized.cues);
        const result = await store.service.saveLocalizedSubtitle({
          content,
          outputDir: destination,
          baseName: baseName(source.name),
          language: localized.language,
          format,
        });
        saved.push(result);
      }
      setResults(saved);
      store.setNotice(`${saved.length} archivo(s) de subtítulos guardados.`);
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : 'no se pudieron guardar los subtítulos',
      );
    } finally {
      setBusy(false);
    }
  }

  async function dubVideo(): Promise<void> {
    const asset = videos.find((item) => item.id === dubAssetId);
    const translated = translations[dubLanguage];
    if (!project || !asset || !translated) {
      setDubError('Elegí un proyecto con video y una traducción terminada.');
      return;
    }
    if (!dubVoice) {
      setDubError(
        `No hay una voz SAPI instalada para ${localizationLanguage(dubLanguage)?.label ?? dubLanguage}.`,
      );
      return;
    }
    setDubBusy(true);
    setDubError(null);
    setDubResult(null);
    setDubProgress(0);
    try {
      let destination = outputDir;
      if (!destination) {
        destination = await store.service.chooseDownloadDirectory();
        if (!destination) {
          setDubError('Elegí una carpeta de destino para el doblaje.');
          return;
        }
        setOutputDir(destination);
      }
      const result = await store.service.synthesizeDub({
        path: asset.source.path,
        outputDir: destination,
        language: dubLanguage,
        voice: dubVoice,
        cues: translated.cues.map((cue) => ({
          startSeconds: cue.startSeconds,
          endSeconds: cue.endSeconds,
          text: cue.text,
        })),
        ...(dubEnd > 0 ? { endSeconds: dubEnd + 0.4 } : {}),
        ...(bedVolume > 0 ? { bedVolume } : {}),
      });
      setDubResult(result);
      store.setNotice(`Doblaje guardado: ${result.voice} · ${result.cues} subtítulos.`);
    } catch (failure) {
      setDubError(
        failure instanceof Error ? failure.message : 'no se pudo doblar el video',
      );
    } finally {
      setDubBusy(false);
    }
  }

  async function cloneVoice(): Promise<void> {
    const reference = audioAssets.find((asset) => asset.id === cloneReferenceId);
    if (!project || !reference) {
      setCloneError('Elegí un proyecto con un audio de referencia de 3–30 s.');
      return;
    }
    if (!cloneText.trim()) {
      setCloneError('Escribí el texto que va a decir la voz clonada.');
      return;
    }
    setCloneBusy(true);
    setCloneError(null);
    setCloneResult(null);
    setCloneProgress(0);
    try {
      let destination = outputDir;
      if (!destination) {
        destination = await store.service.chooseDownloadDirectory();
        if (!destination) {
          setCloneError('Elegí una carpeta de destino para la voz clonada.');
          return;
        }
        setOutputDir(destination);
      }
      const result = await store.service.cloneVoice({
        text: cloneText,
        referencePath: reference.source.path,
        engineUrl: cloneUrl,
        engine: cloneEngine,
        language: cloneLanguage,
        ...(clonePrompt.trim() ? { promptText: clonePrompt } : {}),
        ...(cloneKey.trim() ? { apiKey: cloneKey } : {}),
      });
      setCloneResult(result);
      store.setNotice(`Voz clonada: ${result.durationSeconds.toFixed(1)} s · ${result.engine}.`);
    } catch (failure) {
      setCloneError(
        failure instanceof Error
          ? failure.message
          : 'no se pudo clonar la voz con el motor local',
      );
    } finally {
      setCloneBusy(false);
    }
  }

  async function syncLips(): Promise<void> {
    const video = videos.find((asset) => asset.id === lipVideoId);
    const audio = audioAssets.find((asset) => asset.id === lipAudioId);
    if (!video || !audio) {
      setLipError('Elegí un video y un audio del proyecto para sincronizar los labios.');
      return;
    }
    setLipBusy(true);
    setLipError(null);
    setLipResult(null);
    setLipProgress(0);
    try {
      let destination = outputDir;
      if (!destination) {
        destination = await store.service.chooseDownloadDirectory();
        if (!destination) {
          setLipError('Elegí una carpeta de destino para el lip-sync.');
          return;
        }
        setOutputDir(destination);
      }
      const result = await store.service.lipSync({
        videoPath: video.source.path,
        audioPath: audio.source.path,
        outputDir: destination,
        engineUrl: lipUrl,
        engine: lipEngine,
        ...(lipKey.trim() ? { apiKey: lipKey } : {}),
      });
      setLipResult(result);
      store.setNotice(`Lip-sync listo: ${result.width}×${result.height} · ${result.engine}.`);
    } catch (failure) {
      setLipError(
        failure instanceof Error
          ? failure.message
          : 'no se pudo sincronizar los labios con el motor local',
      );
    } finally {
      setLipBusy(false);
    }
  }

  const previewCues = (active?.cues ?? cues).slice(0, 8);

  return (
    <section className="view compress-view localization-view">
      <ViewToolbar
        label="Localización"
        actions={
          <button type="button" className="ghost icon-text" onClick={() => onNavigate('settings')}>
            <Icon name="settings" size={14} />
            <span>Proveedor</span>
          </button>
        }
      />

      <header className="compress-head">
        <div>
          <h2>Un video, ocho idiomas</h2>
          <p>
            Elegí los subtítulos originales, el idioma de destino y el formato. La
            traducción usa el proveedor que configuraste en Ajustes; los archivos se
            escriben en tu equipo y no se suben a ningún servicio desde la app.
          </p>
        </div>
      </header>

      {error ? (
        <p className="notice notice-warning" role="alert">
          {error}
        </p>
      ) : null}

      <div className="localization-provider">
        <Icon name="globe" size={17} />
        <div>
          <strong>
            {provider
              ? simulator
                ? 'Proveedor simulado'
                : `${provider.model || 'Proveedor'} · ${remote ? 'remoto' : 'local'}`
              : 'Proveedor no consultado'}
          </strong>
          <span>
            {simulator
              ? 'No inventa traducciones: devuelve el texto original marcado como simulado y bloquea la exportación. Configurá Ollama, LM Studio u otro endpoint compatible.'
              : provider
                ? remote
                  ? 'La llamada envía sólo el texto de los subtítulos al endpoint configurado.'
                  : 'El proveedor está en loopback: el texto no sale de tu equipo.'
                : 'Entrá a Ajustes → Inteligencia artificial para configurar un proveedor.'}
          </span>
        </div>
        <button type="button" className="ghost" onClick={() => onNavigate('settings')}>
          Cambiar
        </button>
      </div>

      <div className="localization-layout">
        <div className="localization-controls">
          <button
            type="button"
            className={`compress-slot${source ? ' loaded' : ''}`}
            onClick={() => void pickFile()}
            disabled={busy}
          >
            <Icon name="captions" size={16} />
            <strong>{source ? source.name : 'Elegir subtítulos originales'}</strong>
            <span>
              {source
                ? `${source.parsed.cues.length} subtítulos · ${characters} caracteres · origen ${source.parsed.format.toUpperCase()}`
                : 'SRT, VTT, ASS o SSA en UTF-8, hasta 4 MB'}
            </span>
          </button>

          {source && source.parsed.warnings.length > 0 ? (
            <p className="fine-print">
              {source.parsed.warnings.slice(0, 2).join(' ')}
              {source.parsed.warnings.length > 2
                ? ` (+${source.parsed.warnings.length - 2} avisos)`
                : ''}
            </p>
          ) : null}

          <label className="field">
            <span>Idioma de origen</span>
            <select
              value={sourceLanguage}
              onChange={(event) => setSourceLanguage(event.target.value)}
              disabled={busy}
            >
              <option value="auto">Detección automática</option>
              {LOCALIZATION_LANGUAGES.map((language) => (
                <option key={language.code} value={language.code}>
                  {language.label} · {language.native}
                </option>
              ))}
            </select>
          </label>

          <div>
            <p className="field-label">Idiomas de destino</p>
            <div className="localization-languages" role="group" aria-label="Idiomas de destino">
              {LOCALIZATION_LANGUAGES.map((language) => (
                <button
                  key={language.code}
                  type="button"
                  className={`localization-language${targets.includes(language.code) ? ' active' : ''}`}
                  aria-pressed={targets.includes(language.code)}
                  onClick={() => toggleTarget(language.code)}
                  disabled={busy}
                >
                  <strong>{language.label}</strong>
                  <span>{language.native}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="localization-options">
            <div className="compress-presets" role="group" aria-label="Formato de salida">
              <button
                type="button"
                className={`compress-preset${format === 'srt' ? ' active' : ''}`}
                aria-pressed={format === 'srt'}
                onClick={() => setFormat('srt')}
                disabled={busy}
              >
                <strong>SRT</strong>
                <span>Universal</span>
              </button>
              <button
                type="button"
                className={`compress-preset${format === 'vtt' ? ' active' : ''}`}
                aria-pressed={format === 'vtt'}
                onClick={() => setFormat('vtt')}
                disabled={busy}
              >
                <strong>VTT</strong>
                <span>Web</span>
              </button>
            </div>
            <label className="field">
              <span>Glosario que no se traduce</span>
              <input
                type="text"
                value={glossary}
                maxLength={1000}
                placeholder="Marcas, nombres propios, siglas…"
                onChange={(event) => setGlossary(event.target.value)}
                disabled={busy}
              />
            </label>
          </div>

          {remote ? (
            <label className="localization-approval">
              <input
                type="checkbox"
                checked={approvedCost}
                onChange={(event) => setApprovedCost(event.target.checked)}
                disabled={busy}
              />
              <span>
                Autorizo el consumo de cuota del proveedor remoto. Verificá el precio
                en tu proveedor; esta app no inventa una tarifa.
              </span>
            </label>
          ) : null}

          <p className="fine-print">
            {cues.length > 0
              ? `${chunks.length} lote(s) por idioma · ≈ ${estimateLocalizationTokens(
                  characters,
                ).toLocaleString('es-AR')} tokens de entrada por idioma (estimación de 4 caracteres por token).`
              : 'El texto nunca se envía hasta que presiones Traducir.'}
          </p>

          <div className="compress-actions">
            <button
              type="button"
              className="primary icon-text"
              onClick={() => void translate()}
              disabled={busy || !source || targets.length === 0 || (remote && !approvedCost)}
            >
              <Icon name="globe" size={15} />
              <span>{busy ? 'Trabajando…' : `Traducir a ${targets.length}`}</span>
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => void chooseFolder()}
              disabled={busy}
            >
              Carpeta: {outputDir ? outputDir.split(/[\\/]/).pop() : 'elegir…'}
            </button>
            <button
              type="button"
              className="ghost icon-text"
              onClick={() => void exportAll()}
              disabled={busy || selectedTranslations.length === 0 || hasSimulated}
            >
              <Icon name="save" size={15} />
              <span>Exportar {format.toUpperCase()}</span>
            </button>
          </div>

          {progress ? (
            <p className="fine-print" role="status">
              {progress}
            </p>
          ) : null}
        </div>

        <div className="localization-preview-panel">
          <div className="localization-tabs" role="tablist" aria-label="Traducciones">
            {targets.map((code) => {
              const language = localizationLanguage(code);
              const translated = translations[code];
              return (
                <button
                  key={code}
                  type="button"
                  role="tab"
                  aria-selected={activeTarget === code}
                  className={`localization-tab${activeTarget === code ? ' active' : ''}`}
                  onClick={() => setActiveTarget(code)}
                >
                  {language?.label ?? code}
                  <span>{translated ? (translated.simulated ? 'simulado' : 'listo') : 'pendiente'}</span>
                </button>
              );
            })}
          </div>

          {translatedBanner(active)}

          <div
            className="localization-cues"
            dir={localizationLanguage(activeTarget)?.direction ?? 'ltr'}
          >
            {previewCues.length === 0 ? (
              <p className="fine-print">Elegí un archivo para ver la vista previa.</p>
            ) : (
              previewCues.map((cue, index) => (
                <article className="localization-cue" key={`${cue.startSeconds}-${index}`}>
                  <time>
                    {formatClock(cue.startSeconds)} → {formatClock(cue.endSeconds)}
                  </time>
                  <p>{cue.text}</p>
                  {active ? null : (
                    <span className="localization-pending">Sin traducir · original</span>
                  )}
                </article>
              ))
            )}
            {active && active.cues.length > previewCues.length ? (
              <p className="fine-print">
                Vista previa de {previewCues.length} de {active.cues.length} subtítulos. El
                archivo exportado incluye todos.
              </p>
            ) : null}
          </div>

          <p className="fine-print">
            La dirección se ajusta para árabe. La app traduce el texto y conserva los
            tiempos originales; el doblaje de abajo usa una voz instalada en Windows.
          </p>
        </div>
      </div>

      <section className="card localization-dub">
        <div className="production-card-head">
          <div>
            <p className="eyebrow">Doblaje local</p>
            <h3>La voz en el idioma traducido</h3>
          </div>
          <span className="fine-print">SAPI · audio reemplazado o mezclado</span>
        </div>
        {!project ? (
          <p className="fine-print">
            Abrí un proyecto con un video importado para doblarlo con una voz local.
          </p>
        ) : videos.length === 0 ? (
          <p className="fine-print">
            El proyecto no tiene videos listos. Importá uno en Medios y volvé.
          </p>
        ) : translatedLanguages.length === 0 ? (
          <p className="fine-print">
            Traducí al menos un idioma arriba; después vas a poder doblar el video.
          </p>
        ) : (
          <>
            <div className="localization-dub-grid">
              <label className="field">
                <span>Video</span>
                <select
                  value={dubAssetId}
                  onChange={(event) => setDubAssetId(event.target.value)}
                  disabled={dubBusy}
                >
                  {videos.map((asset) => (
                    <option key={asset.id} value={asset.id}>
                      {asset.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Idioma del doblaje</span>
                <select
                  value={dubLanguage}
                  onChange={(event) =>
                    setDubLanguage(event.target.value as LocalizationLanguageCode)
                  }
                  disabled={dubBusy}
                >
                  {translatedLanguages.map((code) => (
                    <option key={code} value={code}>
                      {localizationLanguage(code)?.label ?? code}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Voz instalada</span>
                <select
                  value={dubVoice}
                  onChange={(event) => setDubVoice(event.target.value)}
                  disabled={dubBusy || matchingVoices.length === 0}
                >
                  {matchingVoices.length === 0 ? (
                    <option value="">Sin voz para este idioma</option>
                  ) : (
                    matchingVoices.map((voice) => (
                      <option key={voice.id} value={voice.name}>
                        {voice.name} · {voice.culture}
                      </option>
                    ))
                  )}
                </select>
              </label>
              <label className="field">
                <span>
                  Audio original debajo <output>{Math.round(bedVolume * 100)}%</output>
                </span>
                <input
                  type="range"
                  min={0}
                  max={0.6}
                  step={0.05}
                  value={bedVolume}
                  aria-label="Volumen del audio original"
                  onChange={(event) => setBedVolume(Number(event.target.value))}
                  disabled={dubBusy}
                />
              </label>
              <div className="compress-actions">
                <button
                  type="button"
                  className="primary icon-text"
                  onClick={() => void dubVideo()}
                  disabled={dubBusy || !dubVoice || dubCues.length === 0}
                >
                  <Icon name="audio" size={15} />
                  <span>{dubBusy ? `Doblando… ${Math.round(dubProgress)}%` : 'Doblar video'}</span>
                </button>
                <span className="fine-print">
                  {dubCues.length} subtítulos · hasta {dubEnd.toFixed(1)} s
                </span>
              </div>
            </div>
            {matchingVoices.length === 0 ? (
              <p className="notice notice-warning">
                No hay una voz SAPI para {localizationLanguage(dubLanguage)?.label ?? dubLanguage}.
                Voces instaladas: {voices.map((voice) => `${voice.name} (${voice.culture})`).join(', ') || 'ninguna'}.
              </p>
            ) : null}
            {dubBusy ? (
              <p className="fine-print" role="status">
                Generando {dubCues.length} voces y mezclando el audio…
              </p>
            ) : null}
          </>
        )}
        {dubError ? (
          <p className="notice notice-warning" role="alert">
            {dubError}
          </p>
        ) : null}
        {dubResult ? (
          <div className="localization-dub-result" role="status">
            <p className="compress-numbers">
              MP4 {dubResult.width}×{dubResult.height} ·{' '}
              <strong>{formatLocalizationBytes(dubResult.bytes)}</strong> ·{' '}
              {dubResult.durationSeconds.toFixed(1)} s · {dubResult.cues} subtítulos
            </p>
            <p className="compress-path">{dubResult.path}</p>
            <p className="fine-print">
              Voz: {dubResult.voice}.{' '}
              {dubResult.replacedOriginalAudio
                ? 'Audio original reemplazado.'
                : `Audio original al ${Math.round(dubResult.originalAudioVolume * 100)}%.`}
            </p>
            {dubResult.warnings.length > 0 ? (
              <ul className="fine-print">
                {dubResult.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : null}
            <button
              type="button"
              className="ghost"
              onClick={() => void store.service.revealOutput(dubResult.path)}
            >
              Mostrar en carpeta
            </button>
          </div>
        ) : null}
      </section>

      <section className="card localization-clone">
        <div className="production-card-head">
          <div>
            <p className="eyebrow">Clonación de voz local</p>
            <h3>Tu muestra, tu motor, tu equipo</h3>
          </div>
          <span className="fine-print">Requiere XTTS o GPT-SoVITS local</span>
        </div>
        {!project ? (
          <p className="fine-print">
            Abrí un proyecto y traé un audio de referencia para clonar una voz.
          </p>
        ) : audioAssets.length === 0 ? (
          <p className="fine-print">
            Importá en Medios un audio limpio de 3–30 segundos para usarlo como referencia.
          </p>
        ) : (
          <div className="localization-clone-grid">
            <label className="field">
              <span>Motor local</span>
              <select
                value={cloneEngine}
                onChange={(event) => {
                  const engine = event.target.value as CloneEngine;
                  setCloneEngine(engine);
                  setCloneUrl(
                    engine === 'gpt-sovits'
                      ? 'http://127.0.0.1:9880'
                      : 'http://127.0.0.1:8020',
                  );
                }}
                disabled={cloneBusy}
              >
                <option value="xtts">XTTS API Server</option>
                <option value="gpt-sovits">GPT-SoVITS</option>
              </select>
            </label>
            <label className="field">
              <span>URL loopback</span>
              <input
                type="url"
                value={cloneUrl}
                onChange={(event) => setCloneUrl(event.target.value)}
                disabled={cloneBusy}
                placeholder="http://127.0.0.1:8020"
              />
            </label>
            <label className="field">
              <span>Audio de referencia</span>
              <select
                value={cloneReferenceId}
                onChange={(event) => setCloneReferenceId(event.target.value)}
                disabled={cloneBusy}
              >
                {audioAssets.map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Idioma</span>
              <select
                value={cloneLanguage}
                onChange={(event) =>
                  setCloneLanguage(event.target.value as LocalizationLanguageCode)
                }
                disabled={cloneBusy}
              >
                {LOCALIZATION_LANGUAGES.map((language) => (
                  <option key={language.code} value={language.code}>
                    {language.label} · {language.native}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Clave del motor (opcional)</span>
              <input
                type="password"
                value={cloneKey}
                onChange={(event) => setCloneKey(event.target.value)}
                disabled={cloneBusy}
                autoComplete="off"
                placeholder="No se guarda"
              />
            </label>
            {cloneEngine === 'gpt-sovits' ? (
              <label className="field">
                <span>Transcripción de la referencia</span>
                <input
                  type="text"
                  value={clonePrompt}
                  onChange={(event) => setClonePrompt(event.target.value)}
                  disabled={cloneBusy}
                  maxLength={1000}
                  placeholder="Lo que dice la muestra"
                />
              </label>
            ) : null}
            <label className="field localization-clone-text">
              <span>Texto de la voz clonada</span>
              <textarea
                rows={4}
                value={cloneText}
                maxLength={2000}
                onChange={(event) => setCloneText(event.target.value)}
                disabled={cloneBusy}
                placeholder="Escribí lo que va a decir la voz clonada…"
              />
            </label>
            <div className="compress-actions localization-clone-actions">
              <button
                type="button"
                className="primary icon-text"
                onClick={() => void cloneVoice()}
                disabled={cloneBusy || !cloneText.trim()}
              >
                <Icon name="sparkles" size={15} />
                <span>{cloneBusy ? `Clonando… ${Math.round(cloneProgress)}%` : 'Clonar voz'}</span>
              </button>
              <button
                type="button"
                className="ghost"
                onClick={() => setCloneText(dubCues.map((cue) => cue.text).join(' ').slice(0, 2000))}
                disabled={cloneBusy || dubCues.length === 0}
              >
                Usar texto traducido
              </button>
            </div>
            <p className="fine-print localization-clone-note">
              La app no incluye el modelo ni manda la muestra a internet: el motor tiene que
              estar corriendo en localhost, 127.0.0.1 o ::1. La calidad depende del motor.
            </p>
          </div>
        )}
        {cloneError ? (
          <p className="notice notice-warning" role="alert">
            {cloneError}
          </p>
        ) : null}
        {cloneResult ? (
          <div className="localization-dub-result" role="status">
            <p className="compress-numbers">
              WAV {cloneResult.durationSeconds.toFixed(1)} s ·{' '}
              <strong>{formatLocalizationBytes(cloneResult.bytes)}</strong> ·{' '}
              {cloneResult.engine} · {cloneResult.language}
            </p>
            <p className="compress-path">{cloneResult.path}</p>
            <p className="fine-print">
              Referencia SHA-256: {cloneResult.referenceSha256.slice(0, 16)}…
            </p>
            <button
              type="button"
              className="ghost"
              onClick={() => {
                const root = store.state.opened?.path;
                void store.service.revealOutput(
                  root ? store.service.joinPath(root, cloneResult.path) : cloneResult.path,
                );
              }}
            >
              Mostrar en carpeta
            </button>
          </div>
        ) : null}
      </section>

      <section className="card localization-lipsync">
        <div className="production-card-head">
          <div>
            <p className="eyebrow">Sincronización labial</p>
            <h3>Que la boca siga la voz</h3>
          </div>
          <span className="fine-print">Motor local · el video no sale del equipo</span>
        </div>
        {!project ? (
          <p className="fine-print">
            Abrí un proyecto con un video y un audio para sincronizar los labios.
          </p>
        ) : videos.length === 0 || audioAssets.length === 0 ? (
          <p className="fine-print">
            Necesitás un video y un audio listos en el proyecto. Importalos en Medios;
            el audio puede ser una narración o una voz clonada.
          </p>
        ) : (
          <div className="localization-lipsync-grid">
            <label className="field">
              <span>Video</span>
              <select
                value={lipVideoId}
                onChange={(event) => setLipVideoId(event.target.value)}
                disabled={lipBusy}
              >
                {videos.map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Audio de la voz</span>
              <select
                value={lipAudioId}
                onChange={(event) => setLipAudioId(event.target.value)}
                disabled={lipBusy}
              >
                {audioAssets.map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Motor</span>
              <select
                value={lipEngine}
                onChange={(event) => setLipEngine(event.target.value)}
                disabled={lipBusy}
              >
                <option value="wav2lip">Wav2Lip (adaptador incluido)</option>
                <option value="local">Otro adaptador local</option>
              </select>
            </label>
            <label className="field">
              <span>Endpoint loopback</span>
              <input
                type="url"
                value={lipUrl}
                onChange={(event) => setLipUrl(event.target.value)}
                disabled={lipBusy}
                placeholder="http://127.0.0.1:8765/lipsync"
              />
            </label>
            <label className="field">
              <span>Clave del motor (opcional)</span>
              <input
                type="password"
                value={lipKey}
                onChange={(event) => setLipKey(event.target.value)}
                disabled={lipBusy}
                autoComplete="off"
                placeholder="No se guarda"
              />
            </label>
            <div className="compress-actions localization-lipsync-actions">
              <button
                type="button"
                className="primary icon-text"
                onClick={() => void syncLips()}
                disabled={lipBusy}
              >
                <Icon name="captions" size={15} />
                <span>{lipBusy ? `Sincronizando… ${Math.round(lipProgress)}%` : 'Sincronizar labios'}</span>
              </button>
              <p className="fine-print">
                El motor debe aceptar `{'{'} video_path, audio_path, output_format {'}'}` y devolver MP4.
                El adaptador incluido escucha en <code>127.0.0.1:8765</code>; la app no
                redistribuye pesos. En CPU puede tardar 10–30 veces la duración
                del clip. Wav2Lip es sólo para uso personal o de investigación:
                para publicar comercialmente usá MuseTalk u otro motor con
                licencia compatible.
              </p>
            </div>
          </div>
        )}
        {lipError ? (
          <p className="notice notice-warning" role="alert">
            {lipError}
          </p>
        ) : null}
        {lipResult ? (
          <div className="localization-dub-result" role="status">
            <p className="compress-numbers">
              MP4 {lipResult.width}×{lipResult.height} ·{' '}
              <strong>{formatLocalizationBytes(lipResult.bytes)}</strong> ·{' '}
              {lipResult.durationSeconds.toFixed(1)} s · {lipResult.engine}
            </p>
            <p className="compress-path">{lipResult.path}</p>
            <button
              type="button"
              className="ghost"
              onClick={() => void store.service.revealOutput(lipResult.path)}
            >
              Mostrar en carpeta
            </button>
          </div>
        ) : null}
      </section>

      {results.length > 0 ? (
        <div className="compress-result" role="status">
          <p className="compress-numbers">
            <strong>{results.length}</strong> archivo(s) · {format.toUpperCase()}
          </p>
          <ul className="localization-results">
            {results.map((result) => (
              <li key={result.path}>
                <span>{result.path}</span>
                <em>{formatLocalizationBytes(result.bytes)}</em>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => void store.service.revealOutput(result.path)}
                >
                  Mostrar
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function formatClock(seconds: number): string {
  const clamped = Math.max(0, Math.round(seconds * 1000));
  const minutes = Math.floor(clamped / 60_000);
  const secs = Math.floor((clamped % 60_000) / 1000);
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(
    clamped % 1000,
  ).padStart(3, '0')}`;
}

function translatedBanner(active: LocalizedCues | null) {
  if (!active) return null;
  if (active.simulated) {
    return (
      <p className="notice notice-warning" role="status">
        Simulación: el texto no se tradujo. La exportación está bloqueada hasta que
        configures un proveedor real.
      </p>
    );
  }
  return (
    <p className="fine-print" role="status">
      Traducido con {active.model || active.providerId}. Revisá nombres y modismos antes
      de publicar; el texto del archivo todavía puede editarse fuera de la app.
    </p>
  );
}
