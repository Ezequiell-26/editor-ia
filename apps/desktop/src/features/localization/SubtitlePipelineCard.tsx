import { useState } from 'react';
import { Icon } from '../../components/Icon';
import type { SubtitlePipelineResult } from '../../services/project-service';
import { useProjectStore } from '../../state/project-store';
import { LOCALIZATION_LANGUAGES, type LocalizationLanguageCode } from './localization';

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'no se pudo procesar el video';
}

/**
 * Pipeline automático de subtítulos: video → faster-whisper → traducción
 * por proveedor → .ass → quema en MP4 (todo en Rust/FFmpeg). La traducción
 * usa el proveedor configurado en Ajustes; si es simulado se avisa.
 */
export function SubtitlePipelineCard() {
  const store = useProjectStore();
  const service = store.service;
  const [inputName, setInputName] = useState<string | null>(null);
  const [inputPath, setInputPath] = useState<string | null>(null);
  const [target, setTarget] = useState<LocalizationLanguageCode>('en');
  const [source, setSource] = useState('');
  const [burn, setBurn] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SubtitlePipelineResult | null>(null);

  async function pickVideo(): Promise<void> {
    const path = await service.chooseVideoFile('Elegir el video para subtitular');
    if (!path) return;
    setInputPath(path);
    setInputName(path.split(/[\\/]/).pop() ?? path);
    setError(null);
    setResult(null);
  }

  async function run(): Promise<void> {
    if (!inputPath) {
      setError('Elegí primero un video.');
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const outcome = await service.subtitlesPipeline({
        inputPath,
        targetLanguage: target,
        ...(source.trim() ? { sourceLanguage: source.trim() } : {}),
        burn,
      });
      setResult(outcome);
      if (!outcome.ok) setError('El pipeline no pudo completarse; revisá el proveedor de IA y faster-whisper.');
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card localization-pipeline">
      <div className="production-card-head">
        <div>
          <p className="eyebrow">Pipeline automático</p>
          <h3>Video → subtítulos traducidos</h3>
        </div>
        <span className="fine-print">
          <Icon name="captions" size={13} /> Whisper + proveedor + FFmpeg
        </span>
      </div>
      <p className="fine-print">
        Transcribe el video con faster-whisper, traduce los subtítulos con el proveedor
        configurado y quema el resultado en un MP4 nuevo. Requiere faster-whisper y el
        proveedor de IA disponibles en el equipo.
      </p>

      <div className="localization-controls">
        <button
          type="button"
          className={`compress-slot${inputPath ? ' loaded' : ''}`}
          onClick={() => void pickVideo()}
          disabled={busy}
        >
          <Icon name="film" size={16} />
          <strong>{inputName ?? 'Elegir video'}</strong>
          <span>{inputPath ? 'Video fuente del pipeline' : 'MP4, MOV, MKV…'}</span>
        </button>

        <div className="denoise-controls">
          <label className="field">
            <span>Idioma de destino</span>
            <select value={target} onChange={(e) => setTarget(e.target.value as LocalizationLanguageCode)}>
              {LOCALIZATION_LANGUAGES.map((language) => (
                <option key={language.code} value={language.code}>
                  {language.label} · {language.native}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Idioma origen (opcional)</span>
            <input
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder="Auto"
              maxLength={16}
            />
          </label>
          <label className="check">
            <input type="checkbox" checked={burn} onChange={(e) => setBurn(e.target.checked)} />
            <span>Quemar subtítulos en el video de salida</span>
          </label>
        </div>

        <div className="actions compact">
          <button
            type="button"
            className="primary icon-text"
            onClick={() => void run()}
            disabled={busy || !service.available || !inputPath}
          >
            <Icon name="captions" size={14} />
            {busy ? 'Procesando…' : 'Generar subtítulos'}
          </button>
        </div>
      </div>

      {result?.ok ? (
        <div className="fine-print" role="status">
          <p>
            {result.cues ?? 0} subtítulos · idioma {result.language ?? target}
            {result.translated ? ' · traducidos' : ''}
            {result.burned ? ' · quemados en el video' : ''}
            {result.simulated ? ' · traducción simulada (revisá el proveedor)' : ''}
          </p>
          <div className="actions compact">
            {result.assPath ? (
              <button
                type="button"
                className="ghost"
                onClick={() => void service.revealOutput(result.assPath!)}
              >
                Ver .ass
              </button>
            ) : null}
            {result.outputPath ? (
              <button
                type="button"
                className="ghost"
                onClick={() => void service.revealOutput(result.outputPath!)}
              >
                Ver video
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      {error ? (
        <p className="notice notice-warning" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
