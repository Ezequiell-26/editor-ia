const PENDING_DOWNLOAD_KEY = 'editor-ia.pending-download-url';

/** Hands a URL from another view to Descargar without persisting it. */
export function queueDownloadUrl(url: string): void {
  try {
    window.sessionStorage.setItem(PENDING_DOWNLOAD_KEY, url.trim());
  } catch {
    // Sin sessionStorage la vista Descargar igual se puede usar a mano.
  }
}

export function takePendingDownloadUrl(): string {
  try {
    const value = window.sessionStorage.getItem(PENDING_DOWNLOAD_KEY) ?? '';
    window.sessionStorage.removeItem(PENDING_DOWNLOAD_KEY);
    return value;
  } catch {
    return '';
  }
}
