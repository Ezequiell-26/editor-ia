import { useRef, useState } from 'react';
import type { Clip, PerspectiveCorner, ProjectDocument } from '@editor-ia/project-schema';
import { clipTransformAtFrame, updateClip } from '../../state/project-actions';
import { useProjectStore } from '../../state/project-store';
import { fittedContentBox, type PerspectiveViewport } from './perspective';
import {
  canvasToCorner,
  canvasToLocal,
  isValidPerspectiveQuad,
  perspectiveHandlePoints,
  translateCorners,
  type QuadPoint,
} from './perspective-handles';
import type { CanvasSize } from './transform-overlay';

interface PerspectiveHandlesProps {
  readonly clip: Clip;
  readonly project: ProjectDocument;
  readonly playheadFrame: number;
  readonly canvas: CanvasSize;
  readonly viewport: PerspectiveViewport;
}

interface DragState {
  readonly kind: 'corner' | 'quad';
  readonly index: number;
  readonly startPoint: QuadPoint;
  readonly startCorners: { x: number; y: number }[];
}

/**
 * Tiradores del quad de perspectiva sobre la vista previa, equivalente al
 * `canto_fixado.js` de AlaukCut: cada vértice se arrastra por separado y el
 * quad completo se traslada arrastrando el cuerpo. Escribe
 * `transform.perspective.corners` en el clip seleccionado.
 */
export function PerspectiveHandles({
  clip,
  project,
  playheadFrame,
  canvas,
  viewport,
}: PerspectiveHandlesProps) {
  const store = useProjectStore();
  const dragRef = useRef<DragState | null>(null);
  const [dragging, setDragging] = useState(false);

  const perspective = clip.transform?.perspective;
  if (!perspective) return null;
  const corners = perspective.corners;

  const relativeFrame = Math.max(
    0,
    Math.min(clip.durationFrames - 1, playheadFrame - clip.startFrame),
  );
  const sampled = clipTransformAtFrame(clip, relativeFrame);
  const transform = {
    offsetX: sampled.offsetX,
    offsetY: sampled.offsetY,
    scaleX: sampled.scaleX,
    scaleY: sampled.scaleY,
    rotationDeg: sampled.rotationDeg,
  };
  const box = fittedContentBox({
    width: canvas.width,
    height: canvas.height,
    ...(viewport.mediaWidth !== undefined ? { mediaWidth: viewport.mediaWidth } : {}),
    ...(viewport.mediaHeight !== undefined ? { mediaHeight: viewport.mediaHeight } : {}),
  });
  const points = perspectiveHandlePoints(
    corners,
    transform,
    project.video,
    canvas,
    viewport,
  );
  const polygon = points.map((point) => `${point[0]},${point[1]}`).join(' ');

  function localPoint(event: React.PointerEvent<HTMLElement>): QuadPoint {
    const rect = event.currentTarget.closest('.preview-canvas')?.getBoundingClientRect();
    if (!rect) return [0, 0];
    return [event.clientX - rect.left, event.clientY - rect.top];
  }

  function writeCorners(corners: readonly { x: number; y: number }[]): void {
    store.update((current) => {
      const target = current.timeline.clips.find((item) => item.id === clip.id);
      if (!target?.transform) return current;
      return updateClip(current, clip.id, {
        transform: {
          ...target.transform,
          perspective: {
            corners: corners as [
              PerspectiveCorner,
              PerspectiveCorner,
              PerspectiveCorner,
              PerspectiveCorner,
            ],
          },
        },
      });
    });
  }

  function begin(
    kind: 'corner' | 'quad',
    index: number,
    event: React.PointerEvent<HTMLElement>,
  ): void {
    if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
    event.preventDefault();
    event.stopPropagation();
    if (!event.currentTarget.closest('.preview-canvas')) return;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // jsdom/WebView viejos sin captura de puntero.
    }
    dragRef.current = {
      kind,
      index,
      startPoint: localPoint(event),
      startCorners: corners.map((corner) => ({ ...corner })),
    };
    setDragging(true);
  }

  function move(event: React.PointerEvent<HTMLElement>): void {
    const drag = dragRef.current;
    if (!drag || box.width <= 0 || box.height <= 0) return;
    const point = localPoint(event);
    if (drag.kind === 'corner') {
      const corner = canvasToCorner(point, transform, project.video, canvas, viewport);
      const corners = drag.startCorners.map((item, index) =>
        index === drag.index ? corner : item,
      );
      if (!isValidPerspectiveQuad(corners)) return;
      writeCorners(corners);
      return;
    }
    // Drag del quad completo: delta en px del elemento → normalizado.
    const startLocal = canvasToLocal(drag.startPoint, transform, project.video, canvas);
    const nextLocal = canvasToLocal(point, transform, project.video, canvas);
    const dx = (nextLocal[0] - startLocal[0]) / box.width;
    const dy = (nextLocal[1] - startLocal[1]) / box.height;
    const corners = translateCorners(drag.startCorners, dx, dy);
    if (!isValidPerspectiveQuad(corners)) return;
    writeCorners(corners);
  }

  function end(event: React.PointerEvent<HTMLElement>): void {
    if (!dragRef.current) return;
    dragRef.current = null;
    setDragging(false);
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Nada que liberar.
    }
  }

  return (
    <div
      className={`perspective-handles${dragging ? ' dragging' : ''}`}
      data-testid="perspective-handles"
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: canvas.width,
        height: canvas.height,
      }}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <svg
        className="perspective-quad"
        width={canvas.width}
        height={canvas.height}
        aria-hidden="true"
      >
        <polygon points={polygon} />
      </svg>
      <button
        type="button"
        className="perspective-quad-hit"
        aria-label="Mover las cuatro esquinas de perspectiva"
        onPointerDown={(event) => begin('quad', -1, event)}
      />
      {points.map((point, index) => (
        <span
          key={index}
          className="perspective-handle"
          data-testid={`perspective-handle-${index}`}
          role="presentation"
          title="Arrastrá para mover esta esquina"
          style={{ left: point[0], top: point[1] }}
          onPointerDown={(event) => begin('corner', index, event)}
        />
      ))}
    </div>
  );
}
