/** Deterministic download names. Editor IA sorts the batch by file name. */

export function slugify(value, fallback = 'prompt') {
  const ascii = String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  const slug = ascii
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return slug || fallback;
}

export function extensionForMime(mime) {
  const value = String(mime ?? '').toLowerCase();
  if (value.includes('jpeg') || value.includes('jpg')) return 'jpg';
  if (value.includes('webp')) return 'webp';
  if (value.includes('gif')) return 'gif';
  return 'png';
}

export function runIdFromDate(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('');
}

export function resultFileName({ index, total, prompt, mime, runId }) {
  const width = Math.max(3, String(Math.max(1, total)).length);
  const position = String(index + 1).padStart(width, '0');
  const extension = extensionForMime(mime);
  return `flow-queue/${runId}/${position}_${slugify(prompt)}.${extension}`;
}

export function manifestFileName(runId) {
  return `flow-queue/${runId}/manifest.json`;
}
