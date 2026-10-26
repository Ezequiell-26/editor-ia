import { useCallback, useMemo, useRef, useState } from 'react';
import type { Clip, ProjectDocument } from '@editor-ia/project-schema';
import { clipTransformAtFrame } from '../../state/project-actions';
import { useProjectStore } from '../../state/project-store';
import {
  boxRect,
  movePatch,
  resetPatch,
  rotatePatch,
  scalePatch,
  type BoxTransform,
  type CanvasSize,
} from './transform-overlay';

interface PreviewTransformBoxProps {
  readonly clip: Clip;
  readonly project: ProjectDocument;
  readonly playheadFrame: number;
  readonly canvas: CanvasSize;
}

type DragKind = 'move' | 'scale' | 'rotate';

/** Captura de puntero tolerante: jsdom no la implementa y algunos WebView tampoco. */
function capturePointer(target: HTMLElement, pointerId: number): void {
  try {
    target.setPointerCapture(pointerId);
  } catch {
    // Sin captura el arrastre sigue funcionando dentro del propio elemento.
  }
}

function releasePointer(target: HTMLElement, pointerId: number): void {
  try {
    target.releasePointerCapture(pointerId);
  } catch {
    // Nada que liberar.
  }
}

interface DragState {
  readonly kind: DragKind;
  readonly startX: number;
  readonly startY: number;
  readonly transform: BoxTransform;
}

/** Clips con transformación editable desde la vista previa. */
export function isTransformable(clip: Clip): boolean {
  return clip.kind === 'video' || clip.kind === 'image' || clip.kind === 'freeze' || clip.kind === 'graphic';
}

/**
 * Caja de manipulación directa sobre la vista previa.
 *
 * Se dibuja en coordenadas del lienzo (hereda zoom y paneo) y escribe en el
 * clip con `updateClip`. Arrastrar el cuerpo mueve, las esquinas escalan y el
 * tirador superior rota. Con keyframes de transformación la caja se muestra
 * bloqueada: mover la base no se vería en esos frames.
 */
export function PreviewTransformBox({
  clip,
  project,
  playheadFrame,
  canvas,
}: PreviewTransformBoxProps) {
  const store = useProjectStore();
  const dragRef = useRef<DragState | null>(null);
  const [dragging, setDragging] = useState<DragKind | null>(null);

  const relativeFrame = Math.max(
    0,
    Math.min(clip.durationFrames - 1, playheadFrame - clip.startFrame),
  );
  const sampled = clipTransformAtFrame(clip, relativeFrame);
  const transform: BoxTransform = useMemo(
    () => ({
      // Un clip sin transformación previa no tiene muestra: se arranca de
      // los valores por defecto, no de `undefined` (que daría NaN al mover).
      offsetX: sampled.offsetX ?? 0,
      offsetY: sampled.offsetY ?? 0,
      scaleX: sampled.scaleX ?? 1,
      scaleY: sampled.scaleY ?? 1,
      rotationDeg: sampled.rotationDeg ?? 0,
    }),
    [sampled.offsetX, sampled.offsetY, sampled.scaleX, sampled.scaleY, sampled.rotationDeg],
  );
  const hasKeyframes = (clip.transform?.keyframes?.length ?? 0) > 0;
  const box = boxRect(transform, project.video, canvas);

  const apply = useCallback(
    (patch: Partial<BoxTransform>) => {
      store.update((current) => {
        const target = current.timeline.clips.find((item) => item.id === clip.id);
        // `transform` es opcional en el esquema: puede no existir todavía, así
        // que no se exige su presencia para escribir el primer valor.
        if (!target || !isTransformable(target)) return current;
        return {
          ...current,
          timeline: {
            ...current.timeline,
            clips: current.timeline.clips.map((item) =>
              item.id === clip.id && isTransformable(item)
                ? {
                    ...item,
                    transform: {
                      ...(item.transform ?? {}),
                      ...patch,
                      // Un valor en cero se omite: el proyecto queda limpio y
                      // el render usa su valor por defecto.
                      ...(patch.offsetX === 0 ? { offsetX: undefined } : {}),
                      ...(patch.offsetY === 0 ? { offsetY: undefined } : {}),
                      ...(patch.rotationDeg === 0 ? { rotationDeg: undefined } : {}),
                      ...(patch.scaleX === 1 ? { scaleX: undefined } : {}),
                      ...(patch.scaleY === 1 ? { scaleY: undefined } : {}),
                    },
                  }
                : item,
            ),
          },
        };
      });
    },
    [clip.id, store],
  );

  function begin(kind: DragKind, event: React.PointerEvent<HTMLElement>): void {
    if (hasKeyframes) return;
    // Sin coordenadas no hay arrastre posible; evita escribir NaN en el clip.
    if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
    event.preventDefault();
    event.stopPropagation();
    capturePointer(event.currentTarget, event.pointerId);
    dragRef.current = { kind, startX: event.clientX, startY: event.clientY, transform };
    setDragging(kind);
  }

  function move(event: React.PointerEvent<HTMLElement>): void {
    const drag = dragRef.current;
    if (!drag) return;
    if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
    event.preventDefault();
    const canvasBox = event.currentTarget.closest('.preview-canvas')?.getBoundingClientRect();
    if (!canvasBox) return;
    const center = { x: canvasBox.left + box.cx, y: canvasBox.top + box.cy };
    const from = { x: drag.startX, y: drag.startY };
    const to = { x: event.clientX, y: event.clientY };

    if (drag.kind === 'move') {
      apply(
        movePatch(
          drag.transform,
          { x: to.x - from.x, y: to.y - from.y },
          project.video,
          canvas,
          !event.altKey,
        ),
      );
      return;
    }
    if (drag.kind === 'scale') {
      apply(scalePatch(drag.transform, from, to, center));
      return;
    }
    apply(rotatePatch(drag.transform, from, to, center, event.shiftKey));
  }

  function end(event: React.PointerEvent<HTMLElement>): void {
    if (!dragRef.current) return;
    dragRef.current = null;
    setDragging(null);
    releasePointer(event.currentTarget, event.pointerId);
  }

  const style: React.CSSProperties = {
    left: box.cx - box.width / 2,
    top: box.cy - box.height / 2,
    width: box.width,
    height: box.height,
    transform: `rotate(${box.rotationDeg}deg)`,
  };

  return (
    <div
      className={`transform-box${dragging ? ' dragging' : ''}${hasKeyframes ? ' locked' : ''}`}
      style={style}
      role="group"
      aria-label={`Encuadre de ${clip.label}`}
      data-testid="transform-box"
      onPointerDown={(event) => begin('move', event)}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <span className="transform-size">
        {Math.round(box.width / (canvas.width / project.video.width))}×
        {Math.round(box.height / (canvas.height / project.video.height))}
      </span>
      {(['nw', 'ne', 'sw', 'se'] as const).map((corner) => (
        <span
          key={corner}
          className={`transform-handle ${corner}`}
          role="presentation"
          onPointerDown={(event) => begin('scale', event)}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
        />
      ))}
      <span
        className="transform-rotate"
        role="presentation"
        title="Arrastrá para rotar (Shift: pasos de 15°)"
        onPointerDown={(event) => begin('rotate', event)}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      />
      <div className="transform-toolbar">
        <button
          type="button"
          className="ghost"
          title="Centrar en el cuadro"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => apply({ offsetX: 0, offsetY: 0 })}
        >
          Centrar
        </button>
        <button
          type="button"
          className="ghost"
          title="Volver a escala 1 y sin rotación"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => apply(resetPatch())}
        >
          Restablecer
        </button>
      </div>
      {hasKeyframes ? (
        <span className="transform-locked-hint">
          Con keyframes, editá el encuadre en el Inspector
        </span>
      ) : null}
    </div>
  );
}
