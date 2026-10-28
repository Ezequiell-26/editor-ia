// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createEmptyProject } from '@editor-ia/project-schema';
import {
  addAsset,
  addClipFromAsset,
  addTrack,
  ensureDelivery,
} from '../../state/project-actions';
import { readyAsset } from '../../test/fake-service';
import {
  clipKeyboardAction,
  isCompatibleTrack,
  nearestCompatibleTrack,
  type ClipKeyboardEvent,
} from './timeline-keyboard';

const NOW = '2026-10-20T00:00:00.000Z';
const FPS = 30;

function evento(sobres: Partial<ClipKeyboardEvent> = {}): ClipKeyboardEvent {
  return {
    key: 'ArrowRight',
    altKey: true,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    defaultPrevented: false,
    ...sobres,
  };
}

/**
 * Proyecto con un clip de video en V1 y dos pistas más arriba: A1 (audio, no
 * compatible) y V2 (video, compatible). Orden de la interfaz: V2, A1, V1.
 */
function proyectoConPistas() {
  const base = ensureDelivery(createEmptyProject('Teclado timeline', NOW));
  const asset = readyAsset();
  const conClip = addClipFromAsset(addAsset(base, asset), asset, {
    atFrame: 0,
    durationFrames: 60,
  }).project;
  const conAudio = addTrack(conClip, 'audio', 'A1').project;
  return addTrack(conAudio, 'video', 'V2').project;
}

describe('teclado de la timeline · decisión de acción', () => {
  it('las flechas sin Alt no son edición de clip: siguen siendo del playhead', () => {
    expect(clipKeyboardAction(evento({ altKey: false }), FPS)).toBeNull();
    expect(clipKeyboardAction(evento({ altKey: false, shiftKey: true }), FPS)).toBeNull();
  });

  it('Alt+flecha horizontal mueve el clip ±1 frame', () => {
    expect(clipKeyboardAction(evento({ key: 'ArrowRight' }), FPS)).toEqual({
      kind: 'move',
      deltaFrames: 1,
    });
    expect(clipKeyboardAction(evento({ key: 'ArrowLeft' }), FPS)).toEqual({
      kind: 'move',
      deltaFrames: -1,
    });
  });

  it('Alt+Shift+flecha horizontal mueve el clip ±1 segundo', () => {
    expect(clipKeyboardAction(evento({ key: 'ArrowRight', shiftKey: true }), FPS)).toEqual({
      kind: 'move',
      deltaFrames: FPS,
    });
    expect(clipKeyboardAction(evento({ key: 'ArrowLeft', shiftKey: true }), FPS)).toEqual({
      kind: 'move',
      deltaFrames: -FPS,
    });
  });

  it('Alt+flecha vertical cambia la pista del clip', () => {
    expect(clipKeyboardAction(evento({ key: 'ArrowUp' }), FPS)).toEqual({
      kind: 'move-track',
      direction: -1,
    });
    expect(clipKeyboardAction(evento({ key: 'ArrowDown' }), FPS)).toEqual({
      kind: 'move-track',
      direction: 1,
    });
  });

  it('Ctrl+Alt+flecha recorta el borde de entrada: la flecha apunta hacia donde va el borde', () => {
    expect(clipKeyboardAction(evento({ key: 'ArrowRight', ctrlKey: true }), FPS)).toEqual({
      kind: 'trim',
      edge: 'start',
      deltaFrames: 1,
    });
    expect(clipKeyboardAction(evento({ key: 'ArrowLeft', ctrlKey: true }), FPS)).toEqual({
      kind: 'trim',
      edge: 'start',
      deltaFrames: -1,
    });
  });

  it('Ctrl+Alt+Shift+flecha recorta el borde de salida', () => {
    expect(
      clipKeyboardAction(evento({ key: 'ArrowRight', ctrlKey: true, shiftKey: true }), FPS),
    ).toEqual({ kind: 'trim', edge: 'end', deltaFrames: 1 });
    expect(
      clipKeyboardAction(evento({ key: 'ArrowLeft', ctrlKey: true, shiftKey: true }), FPS),
    ).toEqual({ kind: 'trim', edge: 'end', deltaFrames: -1 });
  });

  it('Cmd (Mac) cuenta como Ctrl para el recorte del borde', () => {
    expect(clipKeyboardAction(evento({ key: 'ArrowLeft', metaKey: true }), FPS)).toEqual({
      kind: 'trim',
      edge: 'start',
      deltaFrames: -1,
    });
  });

  it('ignora teclas que no son flechas y eventos ya prevenidos', () => {
    expect(clipKeyboardAction(evento({ key: 'm' }), FPS)).toBeNull();
    expect(clipKeyboardAction(evento({ key: 'Home' }), FPS)).toBeNull();
    expect(clipKeyboardAction(evento({ defaultPrevented: true }), FPS)).toBeNull();
  });
});

describe('teclado de la timeline · pistas compatibles', () => {
  it('respeta la tabla clip↔pista que usa el arrastre', () => {
    expect(isCompatibleTrack('video', 'video')).toBe(true);
    expect(isCompatibleTrack('video', 'audio')).toBe(false);
    expect(isCompatibleTrack('audio', 'narration')).toBe(true);
    expect(isCompatibleTrack('freeze', 'video')).toBe(true);
    expect(isCompatibleTrack('image', 'video')).toBe(false);
    expect(isCompatibleTrack('graphic', 'graphic')).toBe(true);
  });

  it('sube al salto: elige la pista compatible más cercana aunque haya una de otro tipo en el medio', () => {
    const project = proyectoConPistas();
    const clip = project.timeline.clips[0]!;
    // Orden en pantalla: V2 (arriba), A1 (medio), V1 (abajo). El clip está en V1.
    const arriba = nearestCompatibleTrack(project, clip, -1);
    expect(arriba?.label).toBe('V2');
    // Hacia abajo no hay nada después de V1.
    expect(nearestCompatibleTrack(project, clip, 1)).toBeNull();
  });

  it('baja de la pista de arriba a la compatible más cercana hacia abajo', () => {
    const project = proyectoConPistas();
    const clip = project.timeline.clips[0]!;
    const v2 = nearestCompatibleTrack(project, clip, -1);
    if (!v2) throw new Error('se esperaba una pista V2 compatible');
    const enV2 = { ...clip, trackId: v2.id };
    const abajo = nearestCompatibleTrack(project, enV2, 1);
    expect(abajo?.label).toBe('V1');
  });
});
