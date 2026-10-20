/**
 * Turns generated file names into short, human labels without losing
 * uniqueness. Shared by the media rail and the timeline.
 */
export function friendlyAssetLabel(label: string): string {
  const base = label.replace(/\.(wav|mp3|m4a|aac|flac|mp4|mov|mkv|webm|png|jpe?g|webp)$/i, '');
  const match = base.match(
    /^(.+?)[-_]([0-9a-f]{8})[-_][0-9a-f]{4}[-_][0-9a-f]{4}[-_][0-9a-f]{4}[-_][0-9a-f]{12}$/i,
  );
  if (!match) return base;
  const stem = (match[1] ?? '').replace(/[-_]+/g, ' ').trim();
  const short = (match[2] ?? '').slice(0, 4);
  const normalized = /^narraci[oó]n$/i.test(stem)
    ? 'Narración'
    : stem.charAt(0).toUpperCase() + stem.slice(1);
  return short ? `${normalized} · ${short}` : base;
}
