import type { CaptionCue } from '@editor-ia/project-schema';

/**
 * Vista previa animada del subtítulo palabra por palabra — paridad del
 * preview karaoke de `previa_legendas.js` de AlaukCut. Cada palabra tiene
 * sus propios keyframes CSS generados (se enciende sólo durante su ventana
 * dentro del cue) y todas comparten el mismo ciclo = duración del cue, así
 * el conjunto queda sincronizado y en loop.
 */
export function CaptionKaraokePreview(props: {
  readonly cue: CaptionCue;
  readonly fps: number;
}) {
  const { cue, fps } = props;
  const words = cue.words ?? [];
  const durationFrames = cue.endFrame - cue.startFrame;
  if (words.length === 0 || durationFrames <= 0 || fps <= 0) return null;

  const durationSec = durationFrames / fps;
  const keyframes = words.map((word, index) => {
    const start = Math.min(1, Math.max(0, (word.startFrame - cue.startFrame) / durationFrames));
    const end = Math.min(1, Math.max(start, (word.endFrame - cue.startFrame) / durationFrames));
    const s = start * 100;
    const e = end * 100;
    // Margen mínimo (~0,4 % del ciclo) para que la palabra llegue a verse
    // aunque su ventana sea de un solo frame.
    const eBright = Math.min(100, e + 0.4);
    const fade = Math.min(100, eBright + 0.4);
    return `@keyframes caption-kw-${index}{0%,${s.toFixed(2)}%{opacity:.4;color:inherit}${s.toFixed(2)}%,${eBright.toFixed(2)}%{opacity:1;color:var(--fm-accent,#6fa8dc)}${eBright.toFixed(2)}%,${fade.toFixed(2)}%{opacity:.4;color:inherit}${fade.toFixed(2)}%,100%{opacity:.4;color:inherit}}`;
  });

  return (
    <div
      className="caption-karaoke"
      role="img"
      aria-label="Vista previa del subtítulo palabra por palabra"
    >
      <style>{keyframes.join('\n')}</style>
      <p className="caption-karaoke-text">
        {words.map((word, index) => (
          <span
            key={`${word.startFrame}-${index}`}
            className="caption-karaoke-word"
            style={{ animation: `caption-kw-${index} ${durationSec}s linear infinite` }}
          >
            {word.text}{' '}
          </span>
        ))}
      </p>
    </div>
  );
}
