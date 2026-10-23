export type ThumbnailAspect = '16:9' | '9:16' | '1:1';
export type ThumbnailTemplateId = 'bold-bottom' | 'split' | 'minimal' | 'gradient';

export interface ThumbnailAspectOption {
  readonly id: ThumbnailAspect;
  readonly label: string;
  readonly detail: string;
  readonly width: number;
  readonly height: number;
}

export interface ThumbnailTemplate {
  readonly id: ThumbnailTemplateId;
  readonly label: string;
  readonly detail: string;
}

export const THUMBNAIL_ASPECTS: readonly ThumbnailAspectOption[] = [
  { id: '16:9', label: 'Horizontal', detail: '1280×720 · YouTube', width: 1280, height: 720 },
  { id: '9:16', label: 'Vertical', detail: '1080×1920 · Shorts/Reels', width: 1080, height: 1920 },
  { id: '1:1', label: 'Cuadrado', detail: '1080×1080 · feed', width: 1080, height: 1080 },
];

export const THUMBNAIL_TEMPLATES: readonly ThumbnailTemplate[] = [
  { id: 'bold-bottom', label: 'Banda inferior', detail: 'Degradado + título grande' },
  { id: 'split', label: 'Split', detail: 'Mitad imagen, mitad color' },
  { id: 'minimal', label: 'Minimal', detail: 'Texto centrado y limpio' },
  { id: 'gradient', label: 'Gradiente', detail: 'Overlay de color y badge' },
];

/** Tres plantillas para el lote A/B/C: la actual y las dos siguientes. */
export function thumbnailVariants(
  current: ThumbnailTemplateId,
): readonly ThumbnailTemplateId[] {
  const rest = THUMBNAIL_TEMPLATES.map((entry) => entry.id).filter(
    (id) => id !== current,
  );
  return [current, ...rest].slice(0, 3);
}

export function thumbnailAspect(id: ThumbnailAspect): ThumbnailAspectOption {
  return THUMBNAIL_ASPECTS.find((aspect) => aspect.id === id) ?? THUMBNAIL_ASPECTS[0]!;
}

export function thumbnailTemplate(id: ThumbnailTemplateId): ThumbnailTemplate {
  return THUMBNAIL_TEMPLATES.find((template) => template.id === id) ?? THUMBNAIL_TEMPLATES[0]!;
}

/** Rectángulo source para dibujar la imagen cubriendo el canvas sin deformar. */
export function coverRect(
  imageWidth: number,
  imageHeight: number,
  canvasWidth: number,
  canvasHeight: number,
): { sx: number; sy: number; sw: number; sh: number } {
  if (imageWidth <= 0 || imageHeight <= 0 || canvasWidth <= 0 || canvasHeight <= 0) {
    return { sx: 0, sy: 0, sw: 1, sh: 1 };
  }
  const imageRatio = imageWidth / imageHeight;
  const canvasRatio = canvasWidth / canvasHeight;
  if (imageRatio > canvasRatio) {
    const sw = imageHeight * canvasRatio;
    return { sx: (imageWidth - sw) / 2, sy: 0, sw, sh: imageHeight };
  }
  const sh = imageWidth / canvasRatio;
  return { sx: 0, sy: (imageHeight - sh) / 2, sw: imageWidth, sh };
}

/** Zona segura: 6 % horizontal y 7 % vertical. */
export function safeArea(width: number, height: number): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const x = Math.round(width * 0.06);
  const y = Math.round(height * 0.07);
  return { x, y, width: width - x * 2, height: height - y * 2 };
}

export function wrapLines(text: string, maxChars: number, maxLines = 3): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return [];
  const words = normalized.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = word;
    if (lines.length === maxLines) break;
  }
  if (current && lines.length < maxLines) lines.push(current);
  if (lines.length === maxLines) {
    const consumed = lines.join(' ').length;
    if (consumed < normalized.length) {
      const last = lines[maxLines - 1] ?? '';
      lines[maxLines - 1] = `${last.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
    }
  }
  return lines;
}

export function thumbnailFileName(
  title: string,
  width: number,
  height: number,
): string {
  const stem = title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  const base = stem || 'miniatura';
  return `${base}-${width}x${height}`;
}

export function formatThumbnailBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(2)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
