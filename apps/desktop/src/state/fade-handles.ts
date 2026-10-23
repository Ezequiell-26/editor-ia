export function fadeFramesForDrag(
  side: 'in' | 'out',
  initialFrames: number,
  deltaFrames: number,
  durationFrames: number,
): number {
  const max = Math.max(0, Math.round(durationFrames));
  const raw = side === 'in' ? initialFrames + deltaFrames : initialFrames - deltaFrames;
  return Math.min(max, Math.max(0, Math.round(raw)));
}
