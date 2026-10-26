// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { afterEach } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { createEmptyProject, type ProjectDocument } from '@editor-ia/project-schema';
import { addAsset, addClipFromAsset, ensureDelivery } from '../../state/project-actions';
import { readyAsset } from '../../test/fake-service';
import { PreviewTransformBox } from './PreviewTransformBox';

// El store se sustituye por uno mínimo: `update` aplica la receta al proyecto
// real, igual que hace `ProjectProvider` pero sin servicio ni Tauri.
let project: ProjectDocument;
vi.mock('../../state/project-store', () => ({
  useProjectStore: () => ({
    update: (recipe: (current: ProjectDocument) => ProjectDocument) => {
      project = recipe(project);
    },
  }),
}));

function setup() {
  const asset = readyAsset();
  project = ensureDelivery(createEmptyProject('Prueba'));
  project = addClipFromAsset(addAsset(project, asset), asset, {}).project;
  return project.timeline.clips[0]!;
}

describe('caja de manipulación directa', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('arrastrar el cuerpo mueve la capa en píxeles del proyecto', () => {
    const clip = setup();
    const { getByTestId } = render(
      <div className="preview-canvas">
        <PreviewTransformBox
          clip={clip}
          project={project}
          playheadFrame={0}
          canvas={{ width: 960, height: 540 }}
        />
      </div>,
    );
    const box = getByTestId('transform-box');
    fireEvent.pointerDown(box, { clientX: 480, clientY: 270, pointerId: 1 });
    fireEvent.pointerMove(box, { clientX: 530, clientY: 300 });
    fireEvent.pointerUp(box);

    const transform = project.timeline.clips[0]!.transform;
    expect(transform?.offsetX).toBe(100);
    expect(transform?.offsetY).toBe(60);
  });

  it('la esquina escala y el tirador superior rota', () => {
    const clip = setup();
    const { getByTestId, container } = render(
      <div className="preview-canvas">
        <PreviewTransformBox
          clip={clip}
          project={project}
          playheadFrame={0}
          canvas={{ width: 960, height: 540 }}
        />
      </div>,
    );
    const corner = container.querySelector('.transform-handle.se')!;
    fireEvent.pointerDown(corner, { clientX: 580, clientY: 270, pointerId: 1 });
    fireEvent.pointerMove(corner, { clientX: 680, clientY: 270 });
    fireEvent.pointerUp(corner);
    expect(project.timeline.clips[0]!.transform?.scaleX).toBe(2);

    const rotate = container.querySelector('.transform-rotate')!;
    fireEvent.pointerDown(rotate, { clientX: 580, clientY: 270, pointerId: 1 });
    fireEvent.pointerMove(rotate, { clientX: 480, clientY: 370 });
    fireEvent.pointerUp(rotate);
    expect(project.timeline.clips[0]!.transform?.rotationDeg).toBe(90);
  });

  it('con keyframes no permite arrastrar', () => {
    const clip = setup();
    const keyed = {
      ...clip,
      transform: {
        ...(clip.transform ?? {}),
        keyframes: [
          {
            frame: 0,
            offsetX: 0,
            offsetY: 0,
            scale: 1,
            rotationDeg: 0,
          },
        ],
      },
    } as typeof clip;
    const { getByTestId } = render(
      <div className="preview-canvas">
        <PreviewTransformBox
          clip={keyed}
          project={project}
          playheadFrame={0}
          canvas={{ width: 960, height: 540 }}
        />
      </div>,
    );
    const box = getByTestId('transform-box');
    fireEvent.pointerDown(box, { clientX: 480, clientY: 270, pointerId: 1 });
    fireEvent.pointerMove(box, { clientX: 560, clientY: 300 });
    fireEvent.pointerUp(box);
    expect(project.timeline.clips[0]!.transform?.offsetX ?? 0).toBe(0);
  });
});
