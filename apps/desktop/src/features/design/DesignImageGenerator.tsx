import { useEffect, useRef, useState } from 'react';
import type { Asset } from '@editor-ia/project-schema';
import type { ViewId } from '../../app/navigation';
import { Icon } from '../../components/Icon';
import type {
  DesignImageReply,
  DesignImageSource,
} from '../../services/project-service';
import { addAsset, addClipFromAsset } from '../../state/project-actions';
import { useProjectStore } from '../../state/project-store';

const PROMPT_LIMIT = 1_200;

const SOURCES: readonly {
  readonly id: DesignImageSource;
  readonly label: string;
  readonly hint: string;
  readonly sizes: readonly { readonly width: number; readonly height: number }[];
}[] = [
  {
    id: 'pollinations',
    label: 'Pollinations · gratis',
    hint: 'Sin clave. Límite gratuito: una imagen cada 45 segundos. Mejor para fondos y pruebas.',
    sizes: [
      { width: 512, height: 512 },
      { width: 512, height: 768 },
      { width: 768, height: 512 },
      { width: 512, height: 288 },
    ],
  },
  {
    id: 'gateway',
    label: 'Proveedor configurado',
    hint: 'Usa Ajustes → IA y su endpoint de imágenes. Calidad y disponibilidad dependen de las claves del gateway.',
    sizes: [
      { width: 1024, height: 1024 },
      { width: 768, height: 1024 },
      { width: 1024, height: 768 },
      { width: 1280, height: 720 },
    ],
  },
];

const PRESETS: readonly { readonly label: string; readonly prompt: string }[] = [
  {
    label: 'Fondo editorial',
    prompt:
      'Fondo abstracto editorial en azul cobalto profundo con acentos ámbar, textura de grano sutil, composición geométrica limpia, espacio negativo para texto.',
  },
  {
    label: 'Miniatura de video',
    prompt:
      'Composición de miniatura para YouTube: objeto central nítido, luz de estudio, contraste alto, fondo desenfocado, colores cobalt y ámbar, sin texto.',
  },
  {
    label: 'Póster',
    prompt:
      'Póster gráfico de calidad impresa con tipografía integrada en la composición, paleta cobalto y crema, formas geométricas, estilo suizo contemporáneo.',
  },
  {
    label: 'Personaje',
    prompt:
      'Retrato de personaje con iluminación cinematográfica, fondo neutro, detalle alto, mirada a cámara, acabado fotográfico.',
  },
];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function sourceConfig(source: DesignImageSource) {
  return SOURCES.find((entry) => entry.id === source) ?? SOURCES[0]!;
}

export function DesignImageGenerator({
  initialPrompt = null,
  onNavigate,
}: {
  readonly initialPrompt?: { readonly text: string; readonly key: number } | null;
  readonly onNavigate?: (id: ViewId) => void;
}) {
  const store = useProjectStore();
  const [prompt, setPrompt] = useState(initialPrompt?.text ?? '');
  const [source, setSource] = useState<DesignImageSource>('pollinations');
  const [model, setModel] = useState('');
  const [seed, setSeed] = useState('');
  const [sizeIndex, setSizeIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DesignImageReply | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [saveBusy, setSaveBusy] = useState(false);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [mediaSent, setMediaSent] = useState<string | null>(null);
  const [mediaAsset, setMediaAsset] = useState<Asset | null>(null);
  const promptRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!initialPrompt) return;
    setPrompt(initialPrompt.text);
    setError(null);
    promptRef.current?.focus();
  }, [initialPrompt]);

  const config = sourceConfig(source);
  const size = config.sizes[Math.min(sizeIndex, config.sizes.length - 1)]!;
  const dataUrl = result
    ? `data:${result.mime};base64,${result.bytesBase64}`
    : null;
  const bytes = result ? Math.floor((result.bytesBase64.length * 3) / 4) : 0;

  function changeSource(next: DesignImageSource): void {
    setSource(next);
    setSizeIndex(0);
    setResult(null);
    setSaved(null);
    setError(null);
    setMediaError(null);
    setMediaSent(null);
    setMediaAsset(null);
  }

  async function generate(): Promise<void> {
    const clean = prompt.trim();
    if (clean.length < 8) {
      setError('Escribí un prompt de al menos 8 caracteres.');
      return;
    }
    setBusy(true);
    setError(null);
    setSaved(null);
    setMediaError(null);
    setMediaSent(null);
    setMediaAsset(null);
    try {
      const parsedSeed = seed.trim() === '' ? null : Number(seed.trim());
      if (parsedSeed !== null && !Number.isFinite(parsedSeed)) {
        throw new Error('La semilla debe ser un número entero.');
      }
      const next = await store.service.generateDesignImage({
        prompt: clean,
        source,
        model: model.trim(),
        width: size.width,
        height: size.height,
        seed: parsedSeed === null ? null : Math.max(0, Math.trunc(parsedSeed)),
        approvedCost: false,
      });
      setResult(next);
      store.setNotice(`Imagen ${next.width}×${next.height} generada.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo generar la imagen.');
    } finally {
      setBusy(false);
    }
  }

  async function save(): Promise<void> {
    if (!result) return;
    setSaveBusy(true);
    setError(null);
    try {
      const path = await store.service.saveDesignImage(
        result.bytesBase64,
        `imagen-${source}.${result.extension}`,
      );
      if (path) {
        setSaved(path);
        store.setNotice('Imagen guardada.');
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo guardar la imagen.');
    } finally {
      setSaveBusy(false);
    }
  }

  async function sendToMedia(): Promise<void> {
    if (!result) return;
    const project = store.state.project;
    if (!project) {
      setMediaError('Abrí un proyecto para enviar la imagen a Medios.');
      return;
    }
    setMediaBusy(true);
    setMediaError(null);
    setMediaSent(null);
    try {
      const path = await store.service.stageDesignMedia(
        result.bytesBase64,
        result.extension,
      );
      const outcome = await store.service.importMediaPaths({
        paths: [path],
        fpsNum: project.video.frameRate.num,
        fpsDen: project.video.frameRate.den,
        confirmRights: true,
        provider: 'olyvia-design',
      });
      const imported = outcome.assets[0];
      if (!imported) {
        setMediaError(outcome.warnings[0] ?? 'No se pudo importar la imagen a Medios.');
        return;
      }
      const ok = store.update(
        (current) => addAsset(current, imported),
        { notice: `Imagen agregada a Medios: ${imported.label}.` },
      );
      if (!ok) {
        setMediaError(store.state.error ?? 'No se pudo agregar la imagen a Medios.');
        return;
      }
      setMediaSent(imported.label);
      setMediaAsset(imported);
    } catch (reason) {
      setMediaError(
        reason instanceof Error ? reason.message : 'No se pudo enviar la imagen a Medios.',
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
      { notice: `Imagen montada en la timeline: ${mediaAsset.label}.` },
    );
    if (!ok) {
      setMediaError(store.state.error ?? 'No se pudo montar la imagen en la timeline.');
      return;
    }
    onNavigate?.('editor');
  }

  return (
    <div className="design-image-panel">
      <div className="design-image-intro">
        <div>
          <span className="design-kicker">
            <Icon name="sparkles" size={13} />
            Imagen IA
          </span>
          <h2>Generá la imagen, no la simules</h2>
          <p>
            Texto a imagen real con dos caminos: la API libre de Pollinations o el
            endpoint de imágenes del proveedor que ya configuraste. El resultado
            entra a Medios con su formato y tamaño medidos.
          </p>
        </div>
        <ul className="design-image-facts" aria-label="Qué incluye">
          <li>PNG, JPEG o WebP reales</li>
          <li>Vista previa y guardado</li>
          <li>Importación a Medios</li>
          <li>Montaje en la timeline</li>
        </ul>
      </div>

      <div className="design-image-grid">
        <form
          className="design-image-form"
          onSubmit={(event) => {
            event.preventDefault();
            void generate();
          }}
        >
          <label htmlFor="design-image-prompt">Prompt</label>
          <textarea
            id="design-image-prompt"
            ref={promptRef}
            value={prompt}
            maxLength={PROMPT_LIMIT}
            rows={5}
            placeholder="Ej.: fondo abstracto editorial en azul cobalto con acentos ámbar, grano sutil y espacio negativo."
            onChange={(event) => setPrompt(event.target.value)}
          />
          <div className="design-image-presets">
            {PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                className="design-chip"
                onClick={() => setPrompt(preset.prompt)}
              >
                {preset.label}
              </button>
            ))}
          </div>

          <fieldset className="design-image-source">
            <legend>Proveedor</legend>
            {SOURCES.map((entry) => (
              <label key={entry.id} className={source === entry.id ? 'active' : ''}>
                <input
                  type="radio"
                  name="design-image-source"
                  value={entry.id}
                  checked={source === entry.id}
                  onChange={() => changeSource(entry.id)}
                />
                <span>
                  <strong>{entry.label}</strong>
                  <small>{entry.hint}</small>
                </span>
              </label>
            ))}
          </fieldset>

          <div className="design-image-row">
            <div className="design-field">
              <label htmlFor="design-image-size">Tamaño</label>
              <select
                id="design-image-size"
                value={sizeIndex}
                onChange={(event) => setSizeIndex(Number(event.target.value))}
              >
                {config.sizes.map((option, index) => (
                  <option key={`${option.width}x${option.height}`} value={index}>
                    {option.width}×{option.height}
                  </option>
                ))}
              </select>
            </div>
            <div className="design-field">
              <label htmlFor="design-image-model">Modelo</label>
              <input
                id="design-image-model"
                value={model}
                onChange={(event) => setModel(event.target.value)}
                placeholder={source === 'gateway' ? 'auto' : 'sana'}
              />
            </div>
            <div className="design-field">
              <label htmlFor="design-image-seed">Semilla</label>
              <input
                id="design-image-seed"
                value={seed}
                inputMode="numeric"
                onChange={(event) => setSeed(event.target.value)}
                placeholder="aleatoria"
              />
            </div>
          </div>

          <div className="design-image-actions">
            <button type="submit" className="primary" disabled={busy}>
              <Icon name="sparkles" size={14} />
              <span>{busy ? 'Generando…' : 'Generar imagen'}</span>
            </button>
            <small>{prompt.trim().length} / {PROMPT_LIMIT} caracteres</small>
          </div>

          {error ? (
            <p className="design-inline-error" role="alert">
              {error}
            </p>
          ) : null}
          {source === 'pollinations' ? (
            <p className="design-image-note">
              El prompt se envía a pollinations.ai. La cuota gratuita es de una
              imagen cada 45 segundos por IP y el plan libre puede incluir la
              marca del servicio en una esquina; el límite se muestra tal cual
              lo devuelve la API.
            </p>
          ) : null}
        </form>

        <div className="design-image-preview">
          {dataUrl && result ? (
            <>
              <div className="design-image-frame">
                <img
                  src={dataUrl}
                  alt={`Imagen generada para: ${prompt.trim().slice(0, 120)}`}
                  width={result.width}
                  height={result.height}
                />
              </div>
              <p className="design-image-meta">
                <strong>{result.width}×{result.height}</strong>
                <span>{result.mime}</span>
                <span>{formatBytes(bytes)}</span>
                <span>{result.source === 'gateway' ? 'proveedor' : 'Pollinations'} · {result.model}</span>
              </p>
              <div className="design-image-actions">
                <button type="button" className="small" onClick={() => void save()} disabled={saveBusy}>
                  <Icon name="save" size={14} />
                  <span>{saveBusy ? 'Guardando…' : 'Guardar imagen'}</span>
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
                  <button type="button" className="small primary icon-text" onClick={mountInTimeline}>
                    <Icon name="editor" size={14} />
                    <span>Montar en la timeline</span>
                  </button>
                ) : null}
              </div>
              {saved ? (
                <p className="design-generator-saved" role="status">
                  Guardada en <strong>{saved}</strong>
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
            </>
          ) : (
            <div className="design-image-empty">
              <Icon name="thumbnails" size={34} />
              <p>La imagen generada aparece acá con su tamaño real.</p>
              <small>Se importa como material, no como una captura de la interfaz.</small>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
