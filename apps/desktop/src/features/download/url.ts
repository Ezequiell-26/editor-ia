/**
 * Accepts what people actually paste: a full URL, a bare domain copied from a
 * browser, or share text with a link inside. Returns a canonical http(s) URL
 * or null. The Rust command validates it again before spawning yt-dlp.
 */
export function normalizeDownloadUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^(?:javascript|data|file|blob):/i.test(trimmed)) return null;
  const embedded = trimmed.match(/https?:\/\/[^\s<>"']+/i)?.[0];
  let candidate = (embedded ?? trimmed).replace(/[)\].,;!?]+$/g, '');
  if (!candidate) return null;
  if (candidate.startsWith('//')) {
    candidate = `https:${candidate}`;
  } else if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) {
    if (!/^(?:[\w-]+\.)+[a-z]{2,}(?::\d+)?(?:[/?#]|$)/i.test(candidate)) {
      return null;
    }
    candidate = `https://${candidate}`;
  }
  try {
    const parsed = new URL(candidate);
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}
