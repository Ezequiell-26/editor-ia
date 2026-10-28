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

  
/** jsdom no tiene PointerEvent: un MouseEvent con tipo pointer* sí porta clientX/Y. */
function firePointer(
  target: HTMLElement,
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  clientX: number,
  clientY: number,
): void {
  fireEvent(target, new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY }));
}


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
    firePointer(box, 'pointerdown', 480, 270);
    firePointer(box, 'pointermove', 530, 300);
    firePointer(box, 'pointerup', 0, 0);

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
    const corner = container.querySelector<HTMLElement>('.transform-handle.se')!;
    firePointer(corner, 'pointerdown', 580, 270);
    firePointer(corner, 'pointermove', 680, 270);
    firePointer(corner, 'pointerup', 0, 0);
    expect(project.timeline.clips[0]!.transform?.scaleX).toBe(2);

    const rotate = container.querySelector<HTMLElement>('.transform-rotate')!;
    firePointer(rotate, 'pointerdown', 580, 270);
    firePointer(rotate, 'pointermove', 480, 370);
    firePointer(rotate, 'pointerup', 0, 0);
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
    firePointer(box, 'pointerdown', 480, 270);
    firePointer(box, 'pointermove', 560, 300);
    firePointer(box, 'pointerup', 0, 0);
    expect(project.timeline.clips[0]!.transform?.offsetX ?? 0).toBe(0);
  });

  it('al acercarse al centro aparecen las guías y el clip se imanta', () => {
    const clip = setup();
    const { getByTestId, queryByTestId, container } = render(
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
    expect(queryByTestId('guide-x')).toBeNull();

    firePointer(box, 'pointerdown', 480, 270);
    // 4 px de pantalla = 8 px de proyecto: dentro de la tolerancia del centro.
    firePointer(box, 'pointermove', 484, 274);
    expect(queryByTestId('guide-x')).not.toBeNull();
    expect(queryByTestId('guide-y')).not.toBeNull();
    expect(container.querySelectorAll('.transform-guide').length).toBe(2);
    expect(project.timeline.clips[0]!.transform?.offsetX ?? 0).toBe(0);

    // Al soltar, las guías se van.
    firePointer(box, 'pointerup', 0, 0);
    expect(queryByTestId('guide-x')).toBeNull();
  });

  it('con Alt las guías no imantan', () => {
    const clip = setup();
    const { getByTestId, queryByTestId } = render(
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
    firePointer(box, 'pointerdown', 480, 270);
    fireEvent(box, new MouseEvent('pointermove', { bubbles: true, clientX: 484, clientY: 274, altKey: true }));
    expect(queryByTestId('guide-x')).toBeNull();
    expect(project.timeline.clips[0]!.transform?.offsetX).toBe(8);
    firePointer(box, 'pointerup', 0, 0);
  });

  it('el tirador de borde estira un solo eje', () => {
    const clip = setup();
    const { container } = render(
      <div className="preview-canvas">
        <PreviewTransformBox
          clip={clip}
          project={project}
          playheadFrame={0}
          canvas={{ width: 960, height: 540 }}
        />
      </div>,
    );
    const east = container.querySelector<HTMLElement>('.transform-handle.edge-e')!;
    firePointer(east, 'pointerdown', 960, 270);
    firePointer(east, 'pointermove', 1440, 270);
    firePointer(east, 'pointerup', 0, 0);
    const transform = project.timeline.clips[0]!.transform;
    expect(transform?.scaleX).toBe(2);
    expect(transform?.scaleY ?? 1).toBe(1);
  });

  it('el deslizador de opacidad escribe la transparencia', () => {
    const clip = setup();
    const { getByLabelText } = render(
      <div className="preview-canvas">
        <PreviewTransformBox
          clip={clip}
          project={project}
          playheadFrame={0}
          canvas={{ width: 960, height: 540 }}
        />
      </div>,
    );
    const slider = getByLabelText('Opacidad') as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '0.4' } });
    expect(project.timeline.clips[0]!.transform?.opacity).toBe(0.4);
  });
});
