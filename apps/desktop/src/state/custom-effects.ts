import {
  clearCustomEffects,
  parseEffectPackage,
  registerCustomEffects,
} from '@editor-ia/effect-kit';

/**
 * Efectos de terceros importados por el usuario.
 *
 * El paquete crudo (JSON) se guarda tal cual en `localStorage`: al
 * arrancar se vuelve a parsear y validar, así un paquete que quedó
 * inválido por una versión nueva del validador no rompe el arranque —
 * simplemente no se registra. El storage es inyectable para tests
 * (mismo patrón que `effect-templates`).
 */

const STORAGE_KEY = 'editor-ia.custom-effects.v1';
const MAX_STORED = 100;

let restored = false;

function defaultStorage(): Storage | null {
  return typeof window !== 'undefined' ? window.localStorage : null;
}

function readStored(store: Storage | null): unknown[] {
  try {
    const raw = store?.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeStored(packages: readonly unknown[], store: Storage | null): void {
  try {
    store?.setItem(STORAGE_KEY, JSON.stringify(packages.slice(0, MAX_STORED)));
  } catch {
    // Sin storage (o lleno): los efectos viven sólo en memoria.
  }
}

function manifestsFrom(packages: readonly unknown[]) {
  const manifests = [];
  for (const entry of packages) {
    const parsed = parseEffectPackage(entry);
    if (parsed.ok) manifests.push(parsed.manifest);
  }
  return manifests;
}

/**
 * Restaura los paquetes guardados. Idempotente: `force` fuerza la
 * re-lectura (tests); en producción se llama una vez por arranque.
 */
export function restoreCustomEffects(force = false, store: Storage | null = defaultStorage()): void {
  if (restored && !force) return;
  restored = true;
  clearCustomEffects();
  registerCustomEffects(manifestsFrom(readStored(store)));
}

export interface CustomEffectImportResult {
  readonly ok: boolean;
  readonly name?: string;
  readonly id?: string;
  readonly error?: string;
}

/**
 * Importa un paquete desde texto JSON. Valida, registra y persiste el
 * paquete crudo para que sobreviva al reinicio.
 */
export function importCustomEffectPackage(
  text: string,
  store: Storage | null = defaultStorage(),
): CustomEffectImportResult {
  restoreCustomEffects(false, store);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'el archivo no es JSON válido' };
  }
  const parsed = parseEffectPackage(raw);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  registerCustomEffects([parsed.manifest]);
  const stored = readStored(store).filter(
    (entry) => JSON.stringify(entry) !== JSON.stringify(raw),
  );
  stored.push(raw);
  writeStored(stored, store);
  return { ok: true, name: parsed.manifest.name, id: parsed.manifest.id };
}

/** Quita un efecto de terceros por id (persiste el borrado). */
export function removeCustomEffect(id: string, store: Storage | null = defaultStorage()): void {
  restoreCustomEffects(false, store);
  const kept = readStored(store).filter((entry) => {
    const parsed = parseEffectPackage(entry);
    return !(parsed.ok && parsed.manifest.id === id);
  });
  writeStored(kept, store);
  clearCustomEffects();
  registerCustomEffects(manifestsFrom(kept));
}
