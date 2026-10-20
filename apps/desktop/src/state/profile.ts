/**
 * Local operator profile: a name, a role and an optional photo. It is chrome,
 * not project data, so it lives in localStorage and never travels with an
 * `.editoria.json`.
 */

export const PROFILE_STORAGE_KEY = 'editor-ia.profile.v1';
const MAX_AVATAR_CHARS = 1_500_000;

export interface LocalProfile {
  readonly version: 1;
  readonly name: string;
  readonly role: string;
  readonly avatar: string | null;
}

export const DEFAULT_PROFILE: LocalProfile = {
  version: 1,
  name: 'Mi perfil',
  role: 'Creador de contenido',
  avatar: null,
};

function text(value: unknown, fallback: string, max: number): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : fallback;
}

function avatar(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (!/^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(value)) return null;
  return value.length <= MAX_AVATAR_CHARS ? value : null;
}

export function normalizeProfile(raw: unknown): LocalProfile {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    version: 1,
    name: text(source.name, DEFAULT_PROFILE.name, 80),
    role: text(source.role, DEFAULT_PROFILE.role, 80),
    avatar: avatar(source.avatar),
  };
}

export function loadProfile(
  storage: Pick<Storage, 'getItem'> | null = safeStorage(),
): LocalProfile {
  if (!storage) return DEFAULT_PROFILE;
  try {
    const raw = storage.getItem(PROFILE_STORAGE_KEY);
    return raw ? normalizeProfile(JSON.parse(raw)) : DEFAULT_PROFILE;
  } catch {
    return DEFAULT_PROFILE;
  }
}

export function saveProfile(
  profile: LocalProfile,
  storage: Pick<Storage, 'setItem'> | null = safeStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(normalizeProfile(profile)));
  } catch {
    // Quota or private mode: keep the in-memory profile.
  }
}

export function initialsOf(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() ?? '').join('') || 'IA';
}

/** Center-crop and downscale a photo to a 256px JPEG data URL. */
export async function fileToAvatar(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Elegí un archivo de imagen.');
  }
  if (file.size > 8 * 1024 * 1024) {
    throw new Error('La foto supera los 8 MB; elegí una más chica.');
  }
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('No se pudo leer la foto.'));
    reader.readAsDataURL(file);
  });
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error('La foto no se pudo decodificar.'));
    element.src = dataUrl;
  });
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) return dataUrl;
  const scale = Math.max(size / image.naturalWidth, size / image.naturalHeight);
  const width = image.naturalWidth * scale;
  const height = image.naturalHeight * scale;
  context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
  return canvas.toDataURL('image/jpeg', 0.86);
}

function safeStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}
