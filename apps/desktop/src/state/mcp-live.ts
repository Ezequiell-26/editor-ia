/**
 * Preferencias locales del control MCP en vivo. Apagado por defecto: mientras no
 * se active, el puente responde 403 y no se emite ningún pedido a la UI.
 * La exportación es un permiso separado: sin él, las herramientas de render y
 * export no se publican y un pedido directo se rechaza.
 */
const STORAGE_KEY = 'olyvia.mcp.live';
const EXPORT_KEY = 'olyvia.mcp.live.export';
export const MCP_LIVE_EVENT = 'olyvia:mcp-live';

function readFlag(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeFlag(key: string, enabled: boolean): void {
  try {
    window.localStorage.setItem(key, enabled ? '1' : '0');
  } catch {
    // sin almacenamiento: el valor queda sólo en memoria durante la sesión
  }
  window.dispatchEvent(
    new CustomEvent(MCP_LIVE_EVENT, {
      detail: {
        enabled: isMcpLiveEnabled(),
        exportEnabled: isMcpLiveExportEnabled(),
      },
    }),
  );
}

export function isMcpLiveEnabled(): boolean {
  return readFlag(STORAGE_KEY);
}

export function setMcpLiveEnabled(enabled: boolean): void {
  writeFlag(STORAGE_KEY, enabled);
}

export function isMcpLiveExportEnabled(): boolean {
  return readFlag(EXPORT_KEY);
}

export function setMcpLiveExportEnabled(enabled: boolean): void {
  writeFlag(EXPORT_KEY, enabled);
}
