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
  // Desplazamiento (en px del interior de la barra) entre el cursor y el borde
  // izquierdo de la ventana visible en el instante del `pointerdown`. Anclar la
  // ventana al punto de agarre es lo que permite arrastrarla 1:1 y llegar a los
  // extremos sin que "se trabe" ni se desfase del cursor.
  const grabOffsetRef = useRef(0);
  const totalFrames = Math.max(1, durationFrames);
  const maxScroll = Math.max(1, contentWidth - clientWidth);
  const windowWidthRatio = Math.min(1, clientWidth / Math.max(1, contentWidth));
  const windowLeftRatio = Math.min(1 - windowWidthRatio, Math.max(0, scrollLeft / maxScroll) * (1 - windowWidthRatio));

  /**
   * Convierte la posición X del puntero en un `scrollLeft` del timeline,
   * manteniendo anclada la ventana al punto donde se agarró (grabOffsetRef).
   *
   * La ventana visible ocupa `windowWidthRatio` de la barra, así que su margen
   * izquierdo sólo puede recorrer `1 - windowWidthRatio` de la barra; por eso el
   * ratio de scroll se calcula sobre ese tramo, igual que en el render
   * (`windowLeftRatio = (scrollLeft / maxScroll) * (1 - windowWidthRatio)`).
   */
  function applyScrollFromClientX(clientX: number): void {
    const bar = barRef.current;
    if (!bar) return;
    const rect = bar.getBoundingClientRect();
    const width = rect.width;
    if (width <= 0) return;
    const cursorX = clientX - rect.left;
    const windowWidthPx = windowWidthRatio * width;
    const maxLeftPx = Math.max(0, width - windowWidthPx);
    const desiredLeftPx = cursorX - grabOffsetRef.current;
    const leftPx = Math.min(maxLeftPx, Math.max(0, desiredLeftPx));
    const ratio = maxLeftPx > 0 ? leftPx / maxLeftPx : 0;
    onScrollTo(Math.max(0, Math.min(maxScroll, ratio * maxScroll)));
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    draggingRef.current = true;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const bar = barRef.current;
    if (!bar) return;
    const rect = bar.getBoundingClientRect();
    const width = rect.width;
    if (width <= 0) return;
    const cursorX = event.clientX - rect.left;
    const windowWidthPx = windowWidthRatio * width;
    const leftPx = windowLeftRatio * width;
    if (cursorX >= leftPx && cursorX <= leftPx + windowWidthPx) {
      // Se agarró DENTRO de la ventana: conserva el punto de agarre para
      // que la ventana siga al cursor 1:1 (sin saltos ni desfase).
      grabOffsetRef.current = cursorX - leftPx;
    } else {
      // Clic FUERA de la ventana: la centra en el cursor y arranca el arrastre
      // desde el centro, de modo que un solo clic salta y luego se puede afinar.
      grabOffsetRef.current = windowWidthPx / 2;
      applyScrollFromClientX(event.clientX);
    }
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>): void {
    if (!draggingRef.current) return;
    applyScrollFromClientX(event.clientX);
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
