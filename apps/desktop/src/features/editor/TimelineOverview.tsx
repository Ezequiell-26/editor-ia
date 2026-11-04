import { useRef, type PointerEvent as ReactPointerEvent } from 'react';

/**
 * Minimapa / overview del timeline para proyectos largos.
 *
 * Muestra la duración completa en una barra fina, los clips como segmentos
 * del color de su medio, el cabezal y la ventana visible; click/arrastre sobre
 * la barra mueve el scroll horizontal del timeline. Se renderiza sólo cuando
 * hay scroll horizontal real (parent decide), así no ocupa espacio en proyectos
 * cortos ni en jsdom.
 */
export interface OverviewClip {
  readonly id: string;
  readonly kind: string;
  readonly startFrame: number;
  readonly durationFrames: number;
}

export function TimelineOverview({
  durationFrames,
  fps,
  clips,
  playheadFrame,
  contentWidth,
  clientWidth,
  scrollLeft,
  onScrollTo,
}: {
  readonly durationFrames: number;
  readonly fps: number;
  readonly clips: readonly OverviewClip[];
  readonly playheadFrame: number;
  readonly contentWidth: number;
  readonly clientWidth: number;
  readonly scrollLeft: number;
  readonly onScrollTo: (scrollLeft: number) => void;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const totalFrames = Math.max(1, durationFrames);
  const maxScroll = Math.max(1, contentWidth - clientWidth);
  const windowWidthRatio = Math.min(1, clientWidth / Math.max(1, contentWidth));
  const windowLeftRatio = Math.min(1 - windowWidthRatio, Math.max(0, scrollLeft / maxScroll) * (1 - windowWidthRatio));

  function seekFromClientX(clientX: number): void {
    const bar = barRef.current;
    if (!bar) return;
    const rect = bar.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    // Centrar la ventana en el punto clickeado (patrón de overview NLE).
    const next = ratio * maxScroll;
    onScrollTo(Math.max(0, Math.min(maxScroll, next)));
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    draggingRef.current = true;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    seekFromClientX(event.clientX);
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>): void {
    if (!draggingRef.current) return;
    seekFromClientX(event.clientX);
  }

  function finishPointer(event: ReactPointerEvent<HTMLDivElement>): void {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    try {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    } catch {
      // El pointer ya puede estar liberado.
    }
  }

  const totalSeconds = Math.max(0, totalFrames / Math.max(1, fps));
  const durationLabel = `${Math.floor(totalSeconds / 60)}:${String(
    Math.floor(totalSeconds % 60),
  ).padStart(2, '0')}`;

  return (
    <div
      className="timeline-overview"
      role="group"
      aria-label="Minimapa del timeline"
      data-duration-frames={totalFrames}
    >
      <span className="timeline-overview-label" aria-hidden="true">
        00:00
      </span>
      <div
        ref={barRef}
        className="timeline-overview-bar"
        role="slider"
        aria-label="Vista general del timeline"
        aria-valuemin={0}
        aria-valuemax={totalFrames}
        aria-valuenow={Math.round(playheadFrame)}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishPointer}
        onPointerCancel={finishPointer}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
          event.preventDefault();
          const step = Math.max(1, Math.round(totalFrames / 40));
          onScrollTo(
            Math.max(
              0,
              Math.min(
                maxScroll,
                scrollLeft + (event.key === 'ArrowRight' ? step : -step) * 4,
              ),
            ),
          );
        }}
      >
        <div className="timeline-overview-clips" aria-hidden="true">
          {clips.map((clip) => (
            <span
              key={clip.id}
              className={`timeline-overview-clip kind-${clip.kind}`}
              style={{
                left: `${(clip.startFrame / totalFrames) * 100}%`,
                width: `${Math.max(0.4, (clip.durationFrames / totalFrames) * 100)}%`,
              }}
            />
          ))}
        </div>
        <span
          className="timeline-overview-window"
          style={{
            left: `${windowLeftRatio * 100}%`,
            width: `${Math.max(2, windowWidthRatio * 100)}%`,
          }}
          aria-hidden="true"
        />
        <span
          className="timeline-overview-playhead"
          style={{ left: `${(Math.max(0, Math.min(totalFrames, playheadFrame)) / totalFrames) * 100}%` }}
          aria-hidden="true"
        />
      </div>
      <span className="timeline-overview-label" aria-hidden="true">
        {durationLabel}
      </span>
    </div>
  );
}
