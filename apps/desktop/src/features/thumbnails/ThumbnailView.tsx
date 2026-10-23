import { useEffect, useRef, useState } from 'react';
import type { ViewId } from '../../app/navigation';
import { Icon } from '../../components/Icon';
import { ViewToolbar } from '../../components/ViewToolbar';
import type {
  BestThumbnailFrame,
  ThumbnailExportResult,
} from '../../services/project-service';
import { useProjectStore } from '../../state/project-store';
import {
  THUMBNAIL_ASPECTS,
  THUMBNAIL_TEMPLATES,
  coverRect,
  formatThumbnailBytes,
  safeArea,
  thumbnailAspect,
  thumbnailFileName,
  thumbnailTemplate,
  thumbnailVariants,
  wrapLines,
  type ThumbnailAspect,
  type ThumbnailTemplateId,
} from './thumbnail';

interface DrawOptions {
  readonly image: HTMLImageElement | null;
  readonly title: string;
  readonly subtitle: string;
  readonly badge: string;
  readonly template: ThumbnailTemplateId;
  readonly aspect: ThumbnailAspect;
  readonly accent: string;
  readonly overlay: number;
}

function inkFor(hex: string): string {
  const value = hex.replace('#', '');
  if (value.length !== 6) return '#07110e';
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.62 ? '#07110e' : '#ffffff';
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawLines(
  ctx: CanvasRenderingContext2D,
  lines: readonly string[],
  x: number,
  y: number,
  font: string,
  color: string,
  lineHeight: number,
  align: CanvasTextAlign = 'left',
): number {
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'top';
  lines.forEach((line, index) => {
    ctx.fillText(line, x, y + index * lineHeight);
  });
  return y + lines.length * lineHeight;
}

function drawThumbnail(canvas: HTMLCanvasElement, options: DrawOptions): void {
  const size = thumbnailAspect(options.aspect);
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { width, height } = size;
  const safe = safeArea(width, height);
  const accent = options.accent;

  ctx.clearRect(0, 0, width, height);
  if (options.image) {
    const source = coverRect(
      options.image.naturalWidth,
      options.image.naturalHeight,
      width,
      height,
    );
    ctx.drawImage(
      options.image,
      source.sx,
      source.sy,
      source.sw,
      source.sh,
      0,
      0,
      width,
      height,
    );
  } else {
    const placeholder = ctx.createLinearGradient(0, 0, width, height);
    placeholder.addColorStop(0, '#12202b');
    placeholder.addColorStop(1, '#060b10');
    ctx.fillStyle = placeholder;
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    for (let x = -height; x < width; x += 64) {
      ctx.fillRect(x, 0, 1, height);
    }
  }

  const overlay = Math.max(0, Math.min(100, options.overlay)) / 100;
  const titleSize = Math.round(width * (options.aspect === '9:16' ? 0.095 : 0.086));
  const subtitleSize = Math.round(width * 0.034);
  const badgeSize = Math.round(width * 0.022);
  const titleFont = `800 ${titleSize}px "Segoe UI Variable Display", "Segoe UI", Arial, sans-serif`;
  const subtitleFont = `600 ${subtitleSize}px "Segoe UI Variable Text", "Segoe UI", Arial, sans-serif`;
  const badgeFont = `700 ${badgeSize}px "Segoe UI", Arial, sans-serif`;
  const titleLines = wrapLines(
    options.title || 'Tu próximo video',
    Math.max(10, Math.floor(safe.width / (titleSize * 0.54))),
    3,
  );
  const subtitleLines = wrapLines(
    options.subtitle,
    Math.max(12, Math.floor(safe.width / (subtitleSize * 0.48))),
    2,
  );
  const badgeText = options.badge.trim().toUpperCase();

  if (options.template === 'split') {
    const vertical = options.aspect !== '16:9';
    const panel = vertical
      ? { x: 0, y: height * 0.54, w: width, h: height * 0.46 }
      : { x: 0, y: 0, w: width * 0.44, h: height };
    ctx.fillStyle = accent;
    ctx.fillRect(panel.x, panel.y, panel.w, panel.h);
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(panel.x, panel.y, panel.w, panel.h);
    const ink = inkFor(accent);
    const pad = Math.round(width * 0.06);
    let cursor = panel.y + pad;
    if (badgeText) {
      ctx.font = badgeFont;
      const textWidth = ctx.measureText(badgeText).width;
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      roundRect(ctx, panel.x + pad, cursor, textWidth + pad * 0.8, badgeSize * 2, badgeSize);
      ctx.fill();
      ctx.fillStyle = ink;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(badgeText, panel.x + pad + pad * 0.4, cursor + badgeSize);
      cursor += badgeSize * 2 + pad * 0.8;
    }
    const availableHeight = panel.h - (cursor - panel.y) - pad;
    const maxTitleLines = Math.max(1, Math.floor(availableHeight / (titleSize * 1.05)));
    const clippedTitle = titleLines.slice(0, maxTitleLines);
    cursor = drawLines(
      ctx,
      clippedTitle,
      panel.x + pad,
      cursor,
      titleFont,
      ink,
      titleSize * 1.05,
    );
    if (subtitleLines.length > 0) {
      cursor += pad * 0.35;
      drawLines(
        ctx,
        subtitleLines,
        panel.x + pad,
        cursor,
        subtitleFont,
        ink,
        subtitleSize * 1.3,
      );
    }
    return;
  }

  if (options.template === 'minimal') {
    ctx.fillStyle = `rgba(3, 8, 12, ${0.42 + overlay * 0.3})`;
    ctx.fillRect(0, 0, width, height);
    const centerX = width / 2;
    let cursor = height / 2 - (titleLines.length * titleSize * 1.08) / 2;
    if (badgeText) {
      ctx.font = badgeFont;
      const textWidth = ctx.measureText(badgeText).width;
      const badgeWidth = textWidth + width * 0.045;
      ctx.fillStyle = accent;
      roundRect(ctx, centerX - badgeWidth / 2, cursor - badgeSize * 3.1, badgeWidth, badgeSize * 2, badgeSize);
      ctx.fill();
      ctx.fillStyle = inkFor(accent);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(badgeText, centerX, cursor - badgeSize * 2.1);
    }
    cursor = drawLines(
      ctx,
      titleLines,
      centerX,
      cursor,
      titleFont,
      '#ffffff',
      titleSize * 1.08,
      'center',
    );
    if (subtitleLines.length > 0) {
      drawLines(
        ctx,
        subtitleLines,
        centerX,
        cursor + subtitleSize * 0.35,
        subtitleFont,
        'rgba(255,255,255,0.84)',
        subtitleSize * 1.3,
        'center',
      );
    }
    return;
  }

  const gradient = ctx.createLinearGradient(0, height * 0.32, 0, height);
  if (options.template === 'gradient') {
    gradient.addColorStop(0, 'rgba(0,0,0,0)');
    gradient.addColorStop(0.55, 'rgba(0,0,0,0.42)');
    gradient.addColorStop(1, `${accent}cc`);
  } else {
    gradient.addColorStop(0, 'rgba(0,0,0,0)');
    gradient.addColorStop(0.45, 'rgba(0,0,0,0.48)');
    gradient.addColorStop(1, 'rgba(0,0,0,0.94)');
  }
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = `rgba(0,0,0,${overlay * 0.25})`;
  ctx.fillRect(0, 0, width, height);

  const titleHeight = titleLines.length * titleSize * 1.04;
  const subtitleHeight = subtitleLines.length * subtitleSize * 1.28;
  const badgeHeight = badgeText ? badgeSize * 2.2 : 0;
  let cursor = height - safe.y - subtitleHeight - titleHeight - badgeHeight - (badgeText ? badgeSize : 0);
  if (badgeText) {
    ctx.font = badgeFont;
    const textWidth = ctx.measureText(badgeText).width;
    ctx.fillStyle = accent;
    roundRect(
      ctx,
      safe.x,
      cursor,
      textWidth + width * 0.04,
      badgeSize * 2,
      badgeSize,
    );
    ctx.fill();
    ctx.fillStyle = inkFor(accent);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(badgeText, safe.x + width * 0.02, cursor + badgeSize);
    cursor += badgeSize * 2 + badgeSize * 0.45;
  }
  cursor = drawLines(
    ctx,
    titleLines,
    safe.x,
    cursor,
    titleFont,
    '#ffffff',
    titleSize * 1.04,
  );
  if (subtitleLines.length > 0) {
    drawLines(
      ctx,
      subtitleLines,
      safe.x,
      cursor + subtitleSize * 0.3,
      subtitleFont,
      'rgba(255,255,255,0.86)',
      subtitleSize * 1.28,
    );
  }
}

export function ThumbnailView({ onNavigate }: { readonly onNavigate: (id: ViewId) => void }) {
  const store = useProjectStore();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [inputPath, setInputPath] = useState<string | null>(null);
  const [title, setTitle] = useState('Tu próximo video');
  const [subtitle, setSubtitle] = useState('Una idea que se entiende en 3 segundos');
  const [badge, setBadge] = useState('Nuevo');
  const [template, setTemplate] = useState<ThumbnailTemplateId>('bold-bottom');
  const [aspect, setAspect] = useState<ThumbnailAspect>('16:9');
  const [accent, setAccent] = useState('#4b8fd6');
  const [overlay, setOverlay] = useState(25);
  const [outputDir, setOutputDir] = useState<string | null>(null);
  const [result, setResult] = useState<ThumbnailExportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bestFrames, setBestFrames] = useState<readonly BestThumbnailFrame[]>([]);
  const [frameBusy, setFrameBusy] = useState(false);
  const [variantPaths, setVariantPaths] = useState<readonly string[]>([]);

  const inputUrl = inputPath ? store.service.absoluteFileUrl(inputPath) : '';

  useEffect(() => {
    if (!inputUrl) {
      setImage(null);
      return;
    }
    let active = true;
    const next = new Image();
    next.crossOrigin = 'anonymous';
    next.onload = () => {
      if (active) setImage(next);
    };
    next.onerror = () => {
      if (active) {
        setImage(null);
        setError('No se pudo cargar la imagen. Si se movió, elegila de nuevo.');
      }
    };
    next.src = inputUrl;
    return () => {
      active = false;
      next.onload = null;
      next.onerror = null;
    };
  }, [inputUrl]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawThumbnail(canvas, {
      image,
      title,
      subtitle,
      badge,
      template,
      aspect,
      accent,
      overlay,
    });
  }, [image, title, subtitle, badge, template, aspect, accent, overlay]);

  async function pickImage(): Promise<void> {
    setBusy(true);
    setError(null);
    setResult(null);
    setBestFrames([]);
    try {
      const path = await store.service.chooseImageFile('Elegir la imagen de fondo de la miniatura');
      if (path) setInputPath(path);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'no se pudo abrir la imagen');
    } finally {
      setBusy(false);
    }
  }

  async function pickBestFrames(): Promise<void> {
    setFrameBusy(true);
    setError(null);
    setResult(null);
    try {
      const path = await store.service.chooseVideoFile(
        'Elegir el video para sacar el mejor frame',
      );
      if (!path) return;
      const frames = await store.service.pickThumbnailFrames({ path });
      setBestFrames(frames);
      if (frames[0]) {
        setInputPath(frames[0].path);
        store.setNotice(
          `Mejor frame elegido: ${frames[0].score.toFixed(1)} puntos en ${frames[0].timeSeconds.toFixed(1)} s.`,
        );
      } else {
        setError('El video no devolvió frames utilizables.');
      }
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : 'no se pudo analizar el video',
      );
    } finally {
      setFrameBusy(false);
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

  async function exportThumbnail(): Promise<void> {
    const canvas = canvasRef.current;
    if (!canvas || !image) {
      setError('Elegí una imagen antes de exportar la miniatura.');
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      let destination = outputDir;
      if (!destination) {
        destination = await store.service.chooseDownloadDirectory();
        if (!destination) {
          setError('Elegí una carpeta de destino para la miniatura.');
          return;
        }
        setOutputDir(destination);
      }
      const size = thumbnailAspect(aspect);
      const dataUrl = canvas.toDataURL('image/png');
      const saved = await store.service.saveThumbnail({
        dataUrl,
        outputDir: destination,
        fileName: thumbnailFileName(title, size.width, size.height),
      });
      setResult(saved);
      store.setNotice(`Miniatura guardada: ${formatThumbnailBytes(saved.bytes)}.`);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'no se pudo guardar la miniatura');
    } finally {
      setBusy(false);
    }
  }

  async function exportVariants(): Promise<void> {
    if (!image) {
      setError('Elegí una imagen antes de exportar variantes.');
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    setVariantPaths([]);
    try {
      let destination = outputDir;
      if (!destination) {
        destination = await store.service.chooseDownloadDirectory();
        if (!destination) {
          setError('Elegí una carpeta para las variantes.');
          return;
        }
        setOutputDir(destination);
      }
      const size = thumbnailAspect(aspect);
      const base = thumbnailFileName(title, size.width, size.height).replace(/\.png$/i, '');
      const paths: string[] = [];
      for (const [index, variant] of thumbnailVariants(template).entries()) {
        const canvas = document.createElement('canvas');
        drawThumbnail(canvas, {
          image,
          title,
          subtitle,
          badge,
          template: variant,
          aspect,
          accent,
          overlay,
        });
        const saved = await store.service.saveThumbnail({
          dataUrl: canvas.toDataURL('image/png'),
          outputDir: destination,
          fileName: `${base}-${String.fromCharCode(97 + index)}`,
        });
        paths.push(saved.path);
      }
      setVariantPaths(paths);
      store.setNotice(`3 variantes A/B/C exportadas en ${destination}.`);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'no se pudieron exportar las variantes');
    } finally {
      setBusy(false);
    }
  }

  const selectedTemplate = thumbnailTemplate(template);
  const selectedAspect = thumbnailAspect(aspect);

  return (
    <section className="view compress-view thumbnail-view">
      <ViewToolbar
        label="Miniaturas"
        actions={
          <button type="button" className="ghost icon-text" onClick={() => onNavigate('learn')}>
            <Icon name="learn" size={14} />
            <span>Ayuda</span>
          </button>
        }
      />

      <header className="compress-head">
        <div>
          <h2>Miniaturas que se entienden en el feed</h2>
          <p>
            Elegí una foto, una plantilla y el texto. El canvas se actualiza en vivo;
            el PNG se exporta a la carpeta que elijas, sin subir la imagen a ningún lado.
          </p>
        </div>
      </header>

      {error ? (
        <p className="notice notice-warning" role="alert">
          {error}
        </p>
      ) : null}

      <div className="thumbnail-layout">
        <div className="thumbnail-controls">
          <button
            type="button"
            className={`compress-slot${inputPath ? ' loaded' : ''}`}
            onClick={() => void pickImage()}
            disabled={busy}
          >
            <Icon name="assets" size={16} />
            <strong>{inputPath ? 'Imagen elegida' : 'Elegir imagen de fondo'}</strong>
            <span>
              {inputPath
                ? inputPath.split(/[\\/]/).pop()
                : 'JPG, PNG, WebP y otros formatos que FFmpeg lee'}
            </span>
          </button>
          <button
            type="button"
            className="ghost icon-text"
            onClick={() => void pickBestFrames()}
            disabled={busy || frameBusy}
          >
            <Icon name="sparkles" size={15} />
            <span>{frameBusy ? 'Analizando frames…' : 'Mejor frame de un video'}</span>
          </button>
          {bestFrames.length > 0 ? (
            <div className="thumbnail-best-frames" role="group" aria-label="Mejores frames">
              {bestFrames.map((frame) => (
                <button
                  key={frame.path}
                  type="button"
                  className={`thumbnail-best-frame${inputPath === frame.path ? ' active' : ''}`}
                  onClick={() => {
                    setInputPath(frame.path);
                    setResult(null);
                  }}
                  title={`${frame.score.toFixed(1)} puntos · ${frame.timeSeconds.toFixed(1)} s`}
                >
                  <img
                    src={store.service.absoluteFileUrl(frame.path)}
                    alt={`Frame en ${frame.timeSeconds.toFixed(1)} segundos`}
                    loading="lazy"
                  />
                  <span>{frame.score.toFixed(0)}</span>
                </button>
              ))}
            </div>
          ) : null}

          <div className="compress-presets" role="group" aria-label="Formato de miniatura">
            {THUMBNAIL_ASPECTS.map((option) => (
              <button
                key={option.id}
                type="button"
                className={`compress-preset${aspect === option.id ? ' active' : ''}`}
                aria-pressed={aspect === option.id}
                onClick={() => setAspect(option.id)}
                disabled={busy}
              >
                <strong>{option.label}</strong>
                <span>{option.detail}</span>
              </button>
            ))}
          </div>

          <div className="compress-presets" role="group" aria-label="Plantilla de miniatura">
            {THUMBNAIL_TEMPLATES.map((option) => (
              <button
                key={option.id}
                type="button"
                className={`compress-preset${template === option.id ? ' active' : ''}`}
                aria-pressed={template === option.id}
                onClick={() => setTemplate(option.id)}
                disabled={busy}
              >
                <strong>{option.label}</strong>
                <span>{option.detail}</span>
              </button>
            ))}
          </div>

          <label className="field">
            <span>Título</span>
            <input
              type="text"
              value={title}
              maxLength={90}
              onChange={(event) => setTitle(event.target.value)}
              disabled={busy}
            />
          </label>
          <label className="field">
            <span>Subtítulo</span>
            <input
              type="text"
              value={subtitle}
              maxLength={120}
              onChange={(event) => setSubtitle(event.target.value)}
              disabled={busy}
            />
          </label>
          <label className="field">
            <span>Badge</span>
            <input
              type="text"
              value={badge}
              maxLength={28}
              onChange={(event) => setBadge(event.target.value)}
              disabled={busy}
            />
          </label>

          <div className="thumbnail-row">
            <label className="field">
              <span>Acento</span>
              <input
                type="color"
                value={accent}
                aria-label="Color de acento"
                onChange={(event) => setAccent(event.target.value)}
                disabled={busy}
              />
            </label>
            <label className="field thumbnail-overlay">
              <span>
                Oscurecer <output>{overlay}%</output>
              </span>
              <input
                type="range"
                min={0}
                max={80}
                value={overlay}
                aria-label="Oscurecer la imagen"
                onChange={(event) => setOverlay(Number(event.target.value))}
                disabled={busy}
              />
            </label>
          </div>

          <div className="compress-actions">
            <button
              type="button"
              className="primary icon-text"
              onClick={() => void exportThumbnail()}
              disabled={busy || !image}
            >
              <Icon name="save" size={15} />
              <span>{busy ? 'Guardando…' : 'Exportar PNG'}</span>
            </button>
            <button
              type="button"
              className="ghost icon-text"
              onClick={() => void exportVariants()}
              disabled={busy || !image}
            >
              <Icon name="copy" size={15} />
              <span>3 variantes A/B/C</span>
            </button>
            <button type="button" className="ghost" onClick={() => void chooseFolder()} disabled={busy}>
              Carpeta: {outputDir ? outputDir.split(/[\\/]/).pop() : 'elegir…'}
            </button>
          </div>
          {variantPaths.length > 0 ? (
            <div className="thumbnail-variants-result" role="status">
              {variantPaths.map((path) => (
                <button
                  key={path}
                  type="button"
                  className="small ghost"
                  onClick={() => void store.service.revealOutput(path)}
                >
                  {path.split(/[\/]/).pop()}
                </button>
              ))}
            </div>
          ) : null}
          <p className="fine-print">
            {selectedTemplate.label} · {selectedAspect.width}×{selectedAspect.height}. La
            previsualización usa el canvas real del export; el texto se recorta con elipsis
            si no entra.
          </p>
        </div>

        <div className="thumbnail-preview-column">
          <div className="thumbnail-preview-frame">
            <canvas
              ref={canvasRef}
              className="thumbnail-canvas"
              aria-label="Previsualización de la miniatura"
            />
          </div>
          <p className="fine-print">
            Zona segura: 6 % horizontal y 7 % vertical. El resultado se exporta como PNG
            con nombre único en la carpeta elegida.
          </p>
        </div>
      </div>

      {result ? (
        <div className="compress-result" role="status">
          <p className="compress-numbers">
            PNG {result.width}×{result.height} ·{' '}
            <strong>{formatThumbnailBytes(result.bytes)}</strong>
          </p>
          <p className="compress-path">{result.path}</p>
          <button
            type="button"
            className="primary icon-text"
            onClick={() => void store.service.revealOutput(result.path)}
          >
            <Icon name="folder" size={15} />
            <span>Mostrar en carpeta</span>
          </button>
        </div>
      ) : null}
    </section>
  );
}
