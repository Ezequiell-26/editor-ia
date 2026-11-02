import { useEffect, useState } from 'react';
import type { Clip } from '@editor-ia/project-schema';
import { useProjectStore } from '../../state/project-store';
import { applySpeakerSegments } from '../../state/speakers';

/**
 * Hablantes por proveedor externo.
 *
 * La app no embebe un modelo de diarización: la persona conecta su propia API
 * (Deepgram o AssemblyAI, free o paga) y la clave se guarda en el almacén de
 * Windows. Sin proveedor configurado, la sección no etiqueta nada.
 */

const KINDS = [
  { id: 'none', label: 'Sin proveedor' },
  { id: 'deepgram', label: 'Deepgram' },
  { id: 'assemblyai', label: 'AssemblyAI' },
] as const;

export function SpeakersSection({ clip }: { readonly clip: Clip }) {
  const store = useProjectStore();
  const root = store.state.opened?.root ?? '';
  const [kind, setKind] = useState('none');
  const [language, setLanguage] = useState('es');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [prefix, setPrefix] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const info = await store.service.getDiarizeProvider();
        if (cancelled) return;
        setKind(info.kind);
        setLanguage(info.language);
        setBaseUrl(info.baseUrl);
        setHasKey(info.hasKey);
      } catch {
        // Sin backend disponible la sección queda en «sin proveedor».
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save(): Promise<void> {
    setBusy(true);
    setMessage(null);
    try {
      const info = await store.service.saveDiarizeProvider({
        kind,
        baseUrl,
        language,
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      });
      setHasKey(info.hasKey);
      setApiKey('');
      setMessage('Proveedor guardado.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'no pude guardar el proveedor');
    } finally {
      setBusy(false);
    }
  }

  async function label(): Promise<void> {
    if (clip.source.type !== 'asset' || !root) {
      setMessage('El clip no tiene un archivo en disco.');
      return;
    }
    const assetId = clip.source.assetId;
    const asset = store.state.project?.assets.find((item) => item.id === assetId);
    if (!asset) return;
    const path = `${root.replace(/[\\/]+$/, '')}\\${asset.source.path.replace(/^[\\/]+/, '')}`;
    setBusy(true);
    setMessage(null);
    try {
      const result = await store.service.diarizeAudio(path, language);
      let labelled = 0;
      const ok = store.update((current) => {
        const applied = applySpeakerSegments(current, clip.id, result.segments, { prefix });
        labelled = applied.labelled;
        return applied.project;
      });
      setMessage(
        ok
          ? `${labelled} subtítulo(s) etiquetados con ${result.segments.length} tramo(s) de ${result.provider}.`
          : 'No se pudo aplicar: el proyecto quedaría inválido.',
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'el proveedor no respondió');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="inspector-section" data-group="audio">
      <h4>Hablantes</h4>
      <p className="fine-print">
        Usa tu propia API de diarización. La clave se guarda en el almacén de Windows y no viaja en
        el proyecto.
      </p>
      <div className="inspector-grid">
        <label className="field">
          <span>Proveedor</span>
          <select value={kind} onChange={(event) => setKind(event.target.value)}>
            {KINDS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Idioma</span>
          <input
            type="text"
            value={language}
            maxLength={8}
            onChange={(event) => setLanguage(event.target.value)}
          />
        </label>
        <label className="field">
          <span>URL base (opcional)</span>
          <input
            type="text"
            value={baseUrl}
            placeholder="https://api.deepgram.com"
            onChange={(event) => setBaseUrl(event.target.value)}
          />
        </label>
        <label className="field">
          <span>Clave {hasKey ? '(guardada)' : ''}</span>
          <input
            type="password"
            value={apiKey}
            placeholder={hasKey ? '••••••••' : 'pegá tu clave'}
            onChange={(event) => setApiKey(event.target.value)}
          />
        </label>
      </div>
      <label className="check">
        <input
          type="checkbox"
          checked={prefix}
          onChange={(event) => setPrefix(event.target.checked)}
        />
        <span>Anteponer «Hablante N:» al texto</span>
      </label>
      <div className="actions compact">
        <button type="button" className="small ghost" onClick={() => void save()} disabled={busy}>
          Guardar proveedor
        </button>
        <button
          type="button"
          className="small"
          onClick={() => void label()}
          disabled={busy || kind === 'none' || !hasKey}
        >
          {busy ? 'Consultando…' : 'Etiquetar hablantes'}
        </button>
      </div>
      {message ? <p className="fine-print">{message}</p> : null}
    </section>
  );
}
