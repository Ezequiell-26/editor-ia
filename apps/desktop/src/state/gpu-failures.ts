/**
 * Contador de caídas de GPU en ventana de 10 minutos (paridad
 * `placa_perdida.js` de AlaukCut): el backend emite `GPU_RENDER_FAILED`
 * cuando la firma del log es de dispositivo gráfico; acá se cuentan las
 * caídas y a la ≥2ª en la ventana el diálogo de export avisa con
 * instrucciones (driver, programas que usan la GPU, reinicio) en vez de
 * sólo repetir el error.
 *
 * Persistencia en `sessionStorage` para que el conteo sobreviva al cierre
 * del diálogo; si no hay storage (tests viejos, modo privado) queda en
 * memoria del módulo.
 */

export const GPU_FAILURE_WINDOW_MS = 10 * 60 * 1000;
export const GPU_FAILURE_WARN_THRESHOLD = 2;
const STORAGE_KEY = 'editoria.gpuFailures';

let memoryTimestamps: number[] = [];

function storage(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

function loadTimestamps(): number[] {
  const store = storage();
  if (!store) return [...memoryTimestamps];
  try {
    const raw = store.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((v): v is number => typeof v === 'number')
      : [];
  } catch {
    return [...memoryTimestamps];
  }
}

function saveTimestamps(timestamps: number[]): void {
  memoryTimestamps = timestamps;
  const store = storage();
  if (!store) return;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(timestamps));
  } catch {
    // Storage lleno o bloqueado: el conteo sigue en memoria.
  }
}

/** Timestamps dentro de la ventana, podados los viejos. */
export function gpuFailuresInWindow(now = Date.now()): number[] {
  const cutoff = now - GPU_FAILURE_WINDOW_MS;
  const fresh = loadTimestamps().filter((ts) => ts > cutoff);
  if (fresh.length !== loadTimestamps().length) saveTimestamps(fresh);
  return fresh;
}

/**
 * Registra una caída de GPU y devuelve cuántas hubo en la ventana
 * (incluida ésta). `status:'completed'` NO resetea: la ventana expira
 * sola, como en AlaukCut.
 */
export function recordGpuRenderFailure(now = Date.now()): number {
  const fresh = gpuFailuresInWindow(now);
  fresh.push(now);
  saveTimestamps(fresh);
  return fresh.length;
}

/** `true` cuando la ventana acumuló suficientes caídas para avisar. */
export function shouldWarnGpuFailures(count: number): boolean {
  return count >= GPU_FAILURE_WARN_THRESHOLD;
}
