import { useEffect, useRef, useState } from 'react';
import type { ViewId } from '../../app/navigation';
import { Icon } from '../../components/Icon';
import { useProjectStore } from '../../state/project-store';
import { writeClipboard } from './clipboard';
import { applyDesignSystem } from './design-selection';
import { extractPalette, paletteFromColors, type ExtractedPalette } from './palette';
import './design.css';

const MAX_BYTES = 12 * 1024 * 1024;

export function PaletteExtractor({
  open,
  onClose,
  onNavigate,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onNavigate: (id: ViewId) => void;
}) {
  const store = useProjectStore();
  const [mode, setMode] = useState<'image' | 'url'>('image');
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [fonts, setFonts] = useState<readonly string[]>([]);
  const [preview, setPreview] = useState<string | null>(null);
  const [palette, setPalette] = useState<ExtractedPalette | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const previewRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, busy, onClose]);

  useEffect(
    () => () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    },
    [],
  );

  function chooseFile(file: File | undefined | null): void {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Elegí una imagen PNG, JPEG o WebP.');
      return;
    }
    if (file.size > MAX_BYTES) {
      setError('La imagen supera los 12 MB.');
      return;
    }
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    const url = URL.createObjectURL(file);
    previewRef.current = url;
    setPreview(url);
    setBusy(true);
    setError(null);
    setPalette(null);
    const image = new Image();
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('No se pudo preparar el lienzo.');
        context.drawImage(image, 0, 0, 128, 128);
        const data = context.getImageData(0, 0, 128, 128).data;
        setPalette(extractPalette(data));
      } catch (reason) {
        setError(
          reason instanceof Error ? reason.message : 'No se pudo leer la imagen.',
        );
      } finally {
        setBusy(false);
      }
    };
    image.onerror = () => {
      setBusy(false);
      setError('No se pudo decodificar la imagen.');
    };
    image.src = url;
  }

  async function analyzeUrl(): Promise<void> {
    const value = url.trim();
    if (!/^https?:\/\//i.test(value)) {
      setError('Escribí una URL que empiece con http:// o https://.');
      return;
    }
    setBusy(true);
    setError(null);
    setPalette(null);
    setFonts([]);
    setTitle('');
    try {
      const reply = await store.service.extractDesignUrl({ url: value });
      if (reply.colors.length === 0) {
        setError('La página no declaró colores hexadecimales en su CSS inline.');
        return;
      }
      setPalette(paletteFromColors(reply.colors));
      setTitle(reply.title);
      setFonts(reply.fonts);
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
      previewRef.current = null;
      setPreview(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo analizar la URL.');
    } finally {
      setBusy(false);
    }
  }

  function apply(): void {
    if (!palette) return;
    const selection = applyDesignSystem({
      id: 'paleta-extraida',
      name: 'Paleta extraída',
      canvas: {
        accent: palette.accent,
        accentOn: palette.accentOn,
        bg: palette.bg,
        fg: palette.fg,
      },
    });
    if (!selection) {
      setError('La paleta no tiene un acento utilizable.');
      return;
    }
    store.setNotice('Paleta extraída aplicada a Miniaturas y Motion.');
    onClose();
    onNavigate('thumbnails');
  }

  async function copyTokens(): Promise<void> {
    if (!palette) return;
    const css = `:root {\n  --bg: ${palette.bg};\n  --surface: ${palette.colors[1] ?? palette.bg};\n  --fg: ${palette.fg};\n  --accent: ${palette.accent};\n  --accent-on: ${palette.accentOn};\n}\n`;
    const copied = await writeClipboard(css);
    store.setNotice(copied ? 'Tokens de la paleta copiados.' : 'No se pudo copiar la paleta.');
  }

  if (!open) return null;

  return (
    <div className="design-palette-backdrop" role="presentation" onClick={onClose}>
      <div
        className="design-palette-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="palette-extractor-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span className="design-detail-kicker">Design Extract · local</span>
            <h2 id="palette-extractor-title">Extraer paleta de una imagen</h2>
            <p>
              Los colores se calculan en tu equipo, sin modelos ni red. La tipografía
              no se detecta: la imagen aporta la paleta.
            </p>
          </div>
          <button
            type="button"
            className="design-generator-close"
            aria-label="Cerrar extractor de paleta"
            onClick={onClose}
            disabled={busy}
          >
            <Icon name="close" size={14} />
          </button>
        </header>

        <div className="design-palette-modes" role="group" aria-label="Fuente de la paleta">
          <button
            type="button"
            aria-pressed={mode === 'image'}
            className={mode === 'image' ? 'active' : ''}
            onClick={() => {
              setMode('image');
              setError(null);
            }}
          >
            Imagen
          </button>
          <button
            type="button"
            aria-pressed={mode === 'url'}
            className={mode === 'url' ? 'active' : ''}
            onClick={() => {
              setMode('url');
              setError(null);
            }}
          >
            URL
          </button>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          aria-label="Imagen para extraer la paleta"
          hidden
          onChange={(event) => chooseFile(event.target.files?.[0])}
        />
        <div className="design-palette-body">
          {mode === 'image' ? (
            <button
              type="button"
              className="design-palette-drop"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
            >
              {preview ? (
                <img src={preview} alt="Imagen elegida para extraer la paleta" />
              ) : (
                <>
                  <Icon name="palette" size={26} />
                  <strong>Elegir una imagen</strong>
                  <small>PNG, JPEG o WebP · hasta 12 MB</small>
                </>
              )}
            </button>
          ) : (
            <form
              className="design-palette-url"
              onSubmit={(event) => {
                event.preventDefault();
                void analyzeUrl();
              }}
            >
              <label htmlFor="design-extract-url">URL pública</label>
              <input
                id="design-extract-url"
                value={url}
                placeholder="https://sitio.com"
                inputMode="url"
                disabled={busy}
                onChange={(event) => setUrl(event.target.value)}
              />
              <button type="submit" className="primary" disabled={busy}>
                {busy ? 'Analizando…' : 'Extraer de la URL'}
              </button>
              <small>
                Lee HTML/CSS inline y hojas del mismo host. No ejecuta scripts ni
                navega la página.
              </small>
            </form>
          )}

          <div className="design-palette-result">
            {busy ? (
              <p className="hyperframe-status" role="status">
                Analizando píxeles…
              </p>
            ) : null}
            {palette ? (
              <>
                <div className="design-palette-swatches" aria-label="Paleta extraída">
                  {palette.colors.map((color) => (
                    <div key={color}>
                      <i style={{ background: color }} />
                      <span>{color}</span>
                    </div>
                  ))}
                </div>
                {title ? <p className="design-palette-title">{title}</p> : null}
                {fonts.length > 0 ? (
                  <div className="design-palette-fonts" aria-label="Tipografías detectadas">
                    {fonts.map((font) => (
                      <span key={font}>{font}</span>
                    ))}
                  </div>
                ) : null}
                <dl className="design-palette-meta">
                  <div>
                    <dt>Acento</dt>
                    <dd>{palette.accent}</dd>
                  </div>
                  <div>
                    <dt>Fondo</dt>
                    <dd>{palette.bg}</dd>
                  </div>
                  <div>
                    <dt>Texto</dt>
                    <dd>{palette.fg}</dd>
                  </div>
                </dl>
                <div className="design-image-actions">
                  <button type="button" className="primary icon-text" onClick={apply}>
                    <Icon name="thumbnails" size={14} />
                    <span>Aplicar a miniaturas y Motion</span>
                  </button>
                  <button type="button" className="small icon-text" onClick={() => void copyTokens()}>
                    <Icon name="copy" size={14} />
                    <span>Copiar tokens CSS</span>
                  </button>
                </div>
              </>
            ) : !busy ? (
              <p className="design-empty" role="status">
                Elegí una imagen para ver sus colores dominantes.
              </p>
            ) : null}
            {error ? (
              <p className="design-inline-error" role="alert">
                {error}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
