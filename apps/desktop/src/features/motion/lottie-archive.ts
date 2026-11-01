/**
 * Lector de packs `.lottie` (ZIP) para el pipeline existente.
 *
 * Un `.lottie` es un ZIP con `manifest.json`, `animations/*.json`, imágenes y,
 * opcionalmente, themes (`t/*.json`) y state machines (`s/*.json`). Se cargan
 * todas las animaciones, se embeben las imágenes como data URLs y se exponen
 * themes/state machines para que la UI los aplique sin volver a descomprimir.
 *
 * Decisión de diseño: no se agrega el runtime WASM de dotlottie-web. Se
 * descomprime con `fflate` (MIT) y se reutiliza lottie-web para preview/export;
 * themes y state machines se aplican en TypeScript con límites explícitos.
 */
import { parseLottieStateMachine, type LottieStateMachine } from './lottie-state-machine';
import { parseLottieTheme, type LottieTheme } from './lottie-theme';

export const LOTTIE_ARCHIVE_MAX_BYTES = 8 * 1024 * 1024;

const MAX_ENTRIES = 200;
const MAX_UNCOMPRESSED_BYTES = 32 * 1024 * 1024;
const MAX_ANIMATION_BYTES = 8 * 1024 * 1024;
const MAX_ANIMATIONS = 24;
const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_METADATA_BYTES = 512 * 1024;

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  avif: 'image/avif',
};

export class LottieArchiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LottieArchiveError';
  }
}

export interface LottieArchiveResult {
  /** Animación por defecto (la primera del manifest). */
  readonly raw: Record<string, unknown>;
  readonly animationId: string | null;
  readonly animations: ReadonlyMap<string, Record<string, unknown>>;
  readonly themes: ReadonlyMap<string, LottieTheme>;
  readonly stateMachines: ReadonlyMap<string, LottieStateMachine>;
  readonly initialTheme: string | null;
  readonly embeddedAssets: number;
  readonly warnings: readonly string[];
}

export interface LottieArchiveOptions {
  /** Sólo para pruebas: reduce el tope de bytes descomprimidos. */
  readonly maxUncompressedBytes?: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isSafeEntry(name: string): boolean {
  const clean = name.replace(/\\/g, '/');
  if (clean.length === 0 || clean.length > 240) return false;
  if (clean.startsWith('/') || /^[a-zA-Z]:/.test(clean) || clean.includes('\0')) return false;
  const parts = clean.split('/');
  return parts.every((part) => part.length > 0 && part !== '.' && part !== '..');
}

function mimeFor(name: string): string | null {
  const extension = name.split('.').pop()?.toLowerCase() ?? '';
  return MIME_BY_EXTENSION[extension] ?? null;
}

function toDataUrl(bytes: Uint8Array, mime: string): string {
  let binary = '';
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

function isRemoteReference(value: string): boolean {
  return /^(https?:)?\/\//i.test(value.trim());
}

function readUtf8(files: Record<string, Uint8Array>, name: string, label: string): string {
  const file = files[name]!;
  if (file.byteLength > MAX_METADATA_BYTES) {
    throw new LottieArchiveError(`${label} supera el tamaño máximo permitido.`);
  }
  return new TextDecoder().decode(file);
}

function parseJson(value: string, label: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new LottieArchiveError(`${label} no es JSON válido.`);
  }
}

function embedImages(
  raw: Record<string, unknown>,
  files: Record<string, Uint8Array>,
  animationId: string,
): { embedded: number; warnings: string[] } {
  let embedded = 0;
  const warnings: string[] = [];
  if (!Array.isArray(raw.assets)) return { embedded, warnings };
  raw.assets = raw.assets.map((asset) => {
    const record = asRecord(asset);
    if (!record || record.e === 1) return record ?? asset;
    const path = typeof record.p === 'string' ? record.p : null;
    if (!path || path.startsWith('data:')) return record;
    const base = typeof record.u === 'string' ? record.u : '';
    if (isRemoteReference(path) || isRemoteReference(base)) {
      throw new LottieArchiveError(
        `La animación ${animationId} referencia una imagen remota; el render local no descarga assets.`,
      );
    }
    const candidate = `${base}${path}`
      .replace(/\\/g, '/')
      .replace(/^\.\//, '')
      .replace(/^\/+/, '');
    const fileName = path.split('/').pop() ?? path;
    const file = files[candidate] ?? files[`images/${fileName}`];
    if (!file) {
      throw new LottieArchiveError(
        `La animación ${animationId} referencia una imagen que no está incluida: ${candidate}`,
      );
    }
    const mime = mimeFor(fileName);
    if (!mime) {
      throw new LottieArchiveError(
        `La imagen ${fileName} usa un formato no soportado por el pipeline.`,
      );
    }
    record.e = 1;
    record.u = '';
    record.p = toDataUrl(file, mime);
    embedded += 1;
    return record;
  });
  return { embedded, warnings };
}

function manifestThemes(manifest: Record<string, unknown> | null): Map<string, unknown> {
  const themes = new Map<string, unknown>();
  if (!manifest || !Array.isArray(manifest.themes)) return themes;
  for (const entry of manifest.themes) {
    const record = asRecord(entry);
    if (record && typeof record.id === 'string') {
      themes.set(record.id, record);
    }
  }
  return themes;
}

function manifestStateMachines(manifest: Record<string, unknown> | null): Map<string, unknown> {
  const machines = new Map<string, unknown>();
  if (!manifest || !Array.isArray(manifest.stateMachines)) return machines;
  for (const entry of manifest.stateMachines) {
    const record = asRecord(entry);
    if (record && typeof record.id === 'string') {
      machines.set(record.id, record);
    }
  }
  return machines;
}

/** Año/mes del manifest para reportar nombres; opcional. */
function manifestAnimations(manifest: Record<string, unknown> | null): Map<string, Record<string, unknown>> {
  const animations = new Map<string, Record<string, unknown>>();
  if (!manifest || !Array.isArray(manifest.animations)) return animations;
  for (const entry of manifest.animations) {
    const record = asRecord(entry);
    if (record && typeof record.id === 'string') {
      animations.set(record.id, record);
    }
  }
  return animations;
}

/**
 * Extrae y valida un pack `.lottie`.
 *
 * Límites: 8 MB comprimido, 200 entradas, 32 MB descomprimido, 24 animaciones,
 * 8 MB por animación y 512 KB por theme/state machine. Las rutas absolutas, con
 * `..` o con unidad de Windows se rechazan. Una imagen faltante o remota falla
 * el import en vez de dejar un render incompleto que parezca correcto.
 */
export async function parseLottieArchive(
  bytes: Uint8Array,
  options: LottieArchiveOptions = {},
): Promise<LottieArchiveResult> {
  if (bytes.length === 0) {
    throw new LottieArchiveError('El pack .lottie está vacío.');
  }
  if (bytes.length > LOTTIE_ARCHIVE_MAX_BYTES) {
    throw new LottieArchiveError(
      `El pack .lottie pesa ${(bytes.length / 1024 / 1024).toFixed(1)} MB; el tope es ${
        LOTTIE_ARCHIVE_MAX_BYTES / 1024 / 1024
      } MB.`,
    );
  }

  const requestedLimit = options.maxUncompressedBytes;
  const limit =
    Number.isFinite(requestedLimit) && (requestedLimit as number) >= 1024
      ? (requestedLimit as number)
      : MAX_UNCOMPRESSED_BYTES;

  const { unzipSync, strFromU8 } = await import('fflate');
  let unsafeEntry: string | null = null;
  let declaredBytes = 0;
  let unpacked: Record<string, Uint8Array>;
  try {
    unpacked = unzipSync(bytes, {
      filter(file) {
        const name = file.name.replace(/\\/g, '/');
        if (name.endsWith('/')) return false;
        if (!isSafeEntry(name)) {
          unsafeEntry = name;
          return false;
        }
        declaredBytes += file.originalSize;
        return declaredBytes <= limit;
      },
    });
  } catch {
    throw new LottieArchiveError('El archivo no es un pack .lottie (ZIP) válido.');
  }
  if (unsafeEntry) {
    throw new LottieArchiveError(`El pack contiene una ruta no permitida: ${unsafeEntry}`);
  }
  if (declaredBytes > limit) {
    throw new LottieArchiveError('El pack .lottie supera el tamaño descomprimido máximo.');
  }

  const files: Record<string, Uint8Array> = {};
  for (const [name, data] of Object.entries(unpacked)) {
    const normalized = name.replace(/\\/g, '/');
    if (!isSafeEntry(normalized)) {
      throw new LottieArchiveError(`El pack contiene una ruta no permitida: ${normalized}`);
    }
    files[normalized] = data;
  }
  const names = Object.keys(files);
  if (names.length === 0) {
    throw new LottieArchiveError('El pack .lottie no contiene archivos.');
  }
  if (names.length > MAX_ENTRIES) {
    throw new LottieArchiveError('El pack .lottie tiene demasiadas entradas.');
  }

  const warnings: string[] = [];
  let manifest: Record<string, unknown> | null = null;
  const manifestBytes = files['manifest.json'];
  if (manifestBytes) {
    if (manifestBytes.byteLength > MAX_MANIFEST_BYTES) {
      warnings.push('El manifest.json es demasiado grande; se ignoró.');
    } else {
      try {
        manifest = asRecord(JSON.parse(strFromU8(manifestBytes)) as unknown);
        if (!manifest) warnings.push('El manifest.json no es un objeto; se ignoró.');
      } catch {
        warnings.push('El manifest.json no es JSON válido; se ignoró.');
      }
    }
  }

  const animationEntries = names
    .filter((name) => /^animations\/[^/]+\.json$/i.test(name))
    .sort();
  if (animationEntries.length === 0) {
    throw new LottieArchiveError('El pack no contiene animations/*.json.');
  }
  if (animationEntries.length > MAX_ANIMATIONS) {
    throw new LottieArchiveError('El pack .lottie contiene demasiadas animaciones.');
  }

  const animations = new Map<string, Record<string, unknown>>();
  let embeddedAssets = 0;
  for (const entry of animationEntries) {
    const id = entry.slice('animations/'.length, -'.json'.length);
    const data = files[entry]!;
    if (data.byteLength > MAX_ANIMATION_BYTES) {
      throw new LottieArchiveError(`La animación ${id} es demasiado grande.`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(strFromU8(data)) as unknown;
    } catch {
      throw new LottieArchiveError(`La animación ${id} no es JSON válido.`);
    }
    const raw = asRecord(parsed);
    if (!raw) {
      throw new LottieArchiveError(`La animación ${id} no es un objeto Lottie.`);
    }
    embeddedAssets += embedImages(raw, files, id).embedded;
    animations.set(id, raw);
  }

  const manifestAnimationMap = manifestAnimations(manifest);
  const firstManifestId = [...manifestAnimationMap.keys()][0];
  const defaultId =
    firstManifestId && animations.has(firstManifestId)
      ? firstManifestId
      : [...animations.keys()][0]!;
  if (firstManifestId && !animations.has(firstManifestId)) {
    warnings.push(
      `El manifest declara la animación "${firstManifestId}" pero no está en el pack; se usó "${defaultId}".`,
    );
  }
  const raw = animations.get(defaultId)!;

  const themes = new Map<string, LottieTheme>();
  const declaredThemes = manifestThemes(manifest);
  for (const [id, entry] of declaredThemes) {
    const record = asRecord(entry);
    if (!record || !Array.isArray(record.rules)) continue;
    const theme = parseLottieTheme(id, record);
    if (theme) {
      themes.set(id, {
        ...theme,
        ...(typeof record.name === 'string' ? { name: record.name } : {}),
      });
    }
  }
  for (const name of names) {
    const match = /^t\/([^/]+)\.json$/i.exec(name);
    if (!match) continue;
    const id = match[1]!;
    try {
      const theme = parseLottieTheme(id, parseJson(readUtf8(files, name, `t/${id}.json`), `t/${id}.json`));
      if (theme) themes.set(id, theme);
      else warnings.push(`El theme "${id}" no tiene reglas válidas.`);
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : `No se pudo leer el theme "${id}".`);
    }
  }

  const stateMachines = new Map<string, LottieStateMachine>();
  const declaredMachines = manifestStateMachines(manifest);
  for (const [id, entry] of declaredMachines) {
    const record = asRecord(entry);
    if (!record || !Array.isArray(record.states)) continue;
    const machine = parseLottieStateMachine(id, record);
    if (machine) {
      stateMachines.set(id, {
        ...machine,
        ...(typeof record.name === 'string' ? { name: record.name } : {}),
      });
    }
  }
  for (const name of names) {
    const match = /^s\/([^/]+)\.json$/i.exec(name);
    if (!match) continue;
    const id = match[1]!;
    try {
      const machine = parseLottieStateMachine(
        id,
        parseJson(readUtf8(files, name, `s/${id}.json`), `s/${id}.json`),
      );
      if (machine) stateMachines.set(id, machine);
      else warnings.push(`La state machine "${id}" no tiene un formato válido.`);
    } catch (error) {
      warnings.push(
        error instanceof Error ? error.message : `No se pudo leer la state machine "${id}".`,
      );
    }
  }

  let initialTheme: string | null = null;
  const defaultManifest = manifestAnimationMap.get(defaultId);
  if (defaultManifest && typeof defaultManifest.initialTheme === 'string') {
    if (themes.has(defaultManifest.initialTheme)) {
      initialTheme = defaultManifest.initialTheme;
    } else {
      warnings.push(
        `El tema inicial "${defaultManifest.initialTheme}" no está incluido; no se aplicó.`,
      );
    }
  }

  if (names.some((name) => name.startsWith('audio/'))) {
    warnings.push(
      'El pack incluye audio; el pipeline Lottie sólo exporta video con alfa y no mezcla ese audio.',
    );
  }

  return {
    raw,
    animationId: defaultId,
    animations,
    themes,
    stateMachines,
    initialTheme,
    embeddedAssets,
    warnings,
  };
}
