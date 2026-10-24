import { useEffect, useState } from 'react';
import type { AudioProviderInfo, VoiceInfo } from '../../services/project-service';
import { useProjectStore } from '../../state/project-store';

const ELEVENLABS_PANEL = 'https://elevenlabs.io/app/speech-synthesis';

export function AudioProviderCard() {
  const store = useProjectStore();
  const [info, setInfo] = useState<AudioProviderInfo | null>(null);
  const [kind, setKind] = useState('windows-sapi');
  const [voiceId, setVoiceId] = useState('');
  const [modelId, setModelId] = useState('eleven_multilingual_v2');
  const [externalUrl, setExternalUrl] = useState(ELEVENLABS_PANEL);
  const [approved, setApproved] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [voices, setVoices] = useState<VoiceInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!store.service.available) return;
    let active = true;
    void store.service
      .getAudioProvider()
      .then((value) => {
        if (!active) return;
        setInfo(value);
        setKind(value.kind);
        setVoiceId(value.voiceId);
        setModelId(value.modelId);
        setExternalUrl(value.externalUrl || ELEVENLABS_PANEL);
        setApproved(value.approved);
      })
      .catch(() => {
        if (active) setInfo(null);
      });
    return () => {
      active = false;
    };
  }, [store.service]);

  async function loadVoices(): Promise<void> {
    setLoading(true);
    try {
      const list = await store.service.listVoices();
      setVoices(list);
      if (!voiceId && list[0]) setVoiceId(list[0].id);
    } catch (error) {
      setVoices([]);
      store.setNotice(
        error instanceof Error ? error.message : 'no se pudieron cargar las voces del proveedor',
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (kind === 'external-web') {
      setVoices([]);
      return;
    }
    if (info?.kind !== kind) {
      setVoices([]);
      return;
    }
    void loadVoices();
    // Load voices only when the saved provider matches the selected one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, info?.kind]);

  async function save(): Promise<void> {
    if (kind === 'elevenlabs' && !apiKey.trim() && !info?.hasKey) {
      store.setNotice('Escribí la clave de ElevenLabs para usar la API oficial.');
      return;
    }
    if (kind === 'elevenlabs' && !approved) {
      store.setNotice('Confirmá que ElevenLabs puede consumir créditos antes de guardar.');
      return;
    }
    setBusy(true);
    try {
      const next = await store.service.saveAudioProvider({
        kind,
        voiceId,
        modelId,
        externalUrl: kind === 'external-web' ? externalUrl : '',
        approved,
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      });
      setInfo(next);
      setApiKey('');
      store.setNotice('Proveedor de audio guardado. La clave, si la escribiste, quedó en Windows.');
      if (kind !== 'external-web') await loadVoices();
    } catch (error) {
      store.setNotice(error instanceof Error ? error.message : 'no se pudo guardar el proveedor de audio');
    } finally {
      setBusy(false);
    }
  }

  async function clearKey(): Promise<void> {
    setBusy(true);
    try {
      setInfo(await store.service.clearAudioProviderKey());
      store.setNotice('Clave de audio eliminada del almacén de Windows.');
    } catch (error) {
      store.setNotice(error instanceof Error ? error.message : 'no se pudo borrar la clave');
    } finally {
      setBusy(false);
    }
  }

  async function openWeb(): Promise<void> {
    try {
      await store.service.openExternalUrl(externalUrl);
    } catch (error) {
      store.setNotice(error instanceof Error ? error.message : 'no se pudo abrir la web');
    }
  }

  return (
    <article className="card">
      <h3>Proveedor de narración</h3>
      <p className="muted">
        SAPI local es gratis y sin red. ElevenLabs usa su API oficial y puede consumir
        créditos. La web externa es un puente manual: Olyvia la abre, vos descargás el
        audio y lo importás en Medios; no automatiza ni evade los límites del sitio.
      </p>
      <div className="form-grid">
        <label className="field">
          <span>Proveedor</span>
          <select
            value={kind}
            onChange={(event) => {
              setKind(event.target.value);
              setVoiceId('');
              setVoices([]);
            }}
          >
            <option value="windows-sapi">Windows SAPI (local, gratis)</option>
            <option value="elevenlabs">ElevenLabs (API oficial)</option>
            <option value="external-web">Web externa (manual)</option>
          </select>
        </label>

        {kind === 'elevenlabs' ? (
          <>
            <label className="field">
              <span>Clave API {info?.hasKey ? '(ya guardada)' : ''}</span>
              <input
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={info?.hasKey ? '••••••••  dejala vacía para conservarla' : 'xi-…'}
                autoComplete="new-password"
              />
            </label>
            <label className="field">
              <span>Modelo</span>
              <input
                value={modelId}
                onChange={(event) => setModelId(event.target.value)}
                placeholder="eleven_multilingual_v2"
                autoComplete="off"
              />
            </label>
            <label className="field">
              <span>Voz</span>
              <select
                value={voiceId}
                onChange={(event) => setVoiceId(event.target.value)}
                disabled={loading}
              >
                <option value="">Elegí una voz…</option>
                {voices.map((voice) => (
                  <option key={voice.id} value={voice.id}>
                    {voice.name}
                    {voice.culture ? ` · ${voice.culture}` : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="check production-check">
              <input
                type="checkbox"
                checked={approved}
                onChange={(event) => setApproved(event.target.checked)}
              />
              <span>
                Entiendo que cada llamada a ElevenLabs puede consumir créditos de mi cuenta y
                que debo verificar la licencia de la voz antes de publicar.
              </span>
            </label>
            <div className="actions">
              <button type="button" className="ghost" onClick={() => void loadVoices()} disabled={loading}>
                {loading ? 'Cargando voces…' : 'Recargar voces'}
              </button>
              <button
                type="button"
                className="ghost"
                onClick={() =>
                  void store.service
                    .openExternalUrl('https://elevenlabs.io/app/settings/api-keys')
                    .catch((error) =>
                      store.setNotice(error instanceof Error ? error.message : 'no se pudo abrir la web'),
                    )
                }
              >
                Abrir panel de claves
              </button>
            </div>
          </>
        ) : null}

        {kind === 'windows-sapi' ? (
          <label className="field">
            <span>Voz instalada</span>
            <select
              value={voiceId}
              onChange={(event) => setVoiceId(event.target.value)}
              disabled={loading}
            >
              <option value="">Voz predeterminada de Windows</option>
              {voices.map((voice) => (
                <option key={voice.id} value={voice.id}>
                  {voice.name}
                  {voice.culture ? ` · ${voice.culture}` : ''}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {kind === 'external-web' ? (
          <>
            <label className="field">
              <span>URL de la web (HTTPS)</span>
              <input
                value={externalUrl}
                onChange={(event) => setExternalUrl(event.target.value)}
                placeholder="https://elevenlabs.io/app/speech-synthesis"
                autoComplete="off"
              />
            </label>
            <div className="actions">
              <button type="button" onClick={() => void openWeb()} disabled={busy}>
                Abrir web de audio
              </button>
            </div>
            <p className="fine-print">
              Después de generar el audio en la web, descargalo e importalo desde Medios. La
              app no inicia sesión, no evade captchas ni automatiza el sitio.
            </p>
          </>
        ) : null}
      </div>

      <div className="actions">
        <button type="button" className="primary" onClick={() => void save()} disabled={busy}>
          {busy ? 'Guardando…' : 'Guardar proveedor de audio'}
        </button>
        <button type="button" onClick={() => void clearKey()} disabled={busy || !info?.hasKey}>
          Borrar clave
        </button>
      </div>
      <p className="fine-print">
        {info?.keyringAvailable === false
          ? 'El almacén de credenciales no respondió; no se guardarán claves.'
          : 'La clave de audio vive en el Administrador de credenciales de Windows, separada de la del guion.'}
      </p>
    </article>
  );
}
