// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createEmptyProject, type ProjectDocument } from '@editor-ia/project-schema';
import { addClipFromAsset } from '../../state/project-actions';
import { ProjectProvider, useProjectStore } from '../../state/project-store';
import { createFakeService, readyAsset } from '../../test/fake-service';
import { MinimalEditor } from './MinimalEditor';

// La Timeline real (montada dentro del shell mínimo desde B3/P3) usa
// pointer events — jsdom no los trae; mismo polyfill que Timeline.test.tsx.
if (typeof window.PointerEvent === 'undefined') {
  class PointerEventPolyfill extends MouseEvent {
    readonly pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
    }
  }
  Object.defineProperty(window, 'PointerEvent', { value: PointerEventPolyfill, configurable: true });
  Object.defineProperty(globalThis, 'PointerEvent', { value: PointerEventPolyfill, configurable: true });
}

afterEach(cleanup);

// Los paneles productivos llegan por import() dinámico (lazy). Con la
// máquina cargada (p. ej. cargo compilando) el transform de Inspector.tsx
// (~7k líneas) puede superar los timeouts de waitFor — calentar el cache de
// módulos una vez para que lazy() resuelva al instante en cada test.
beforeAll(async () => {
  await Promise.all([
    import('./EditorAssets'),
    import('./Inspector'),
    import('./Timeline'),
  ]);
});

function renderEditor() {
  return render(
    <ProjectProvider
      service={createFakeService()}
      initial={{ project: createEmptyProject('0919') }}
    >
      <MinimalEditor />
    </ProjectProvider>,
  );
}

describe('editor mínimo · réplica AlaukCut', () => {
  it('monta la superficie con sus tres columnas y la timeline', () => {
    const { container } = renderEditor();
    expect(container.querySelector('.minimal-editor')).toBeTruthy();
    expect(container.querySelector('.me-topbar')).toBeTruthy();
    expect(container.querySelector('.me-library')).toBeTruthy();
    expect(container.querySelector('.me-center')).toBeTruthy();
    expect(container.querySelector('.me-inspector')).toBeTruthy();
    expect(container.querySelector('.me-timeline-real')).toBeTruthy();
    expect(container.querySelector('.me-footer')).toBeTruthy();
  });

  it('monta el rail de assets real y conserva el monitor (P5)', async () => {
    const { container } = renderEditor();
    // El EditorAssets productivo llega por import() dinámico.
    await waitFor(() => {
      expect(container.querySelector('.me-library .asset-rail')).toBeTruthy();
    });
    expect(await screen.findByRole('button', { name: /^Importar$/i })).toBeTruthy();
    expect(container.querySelector('.me-monitor')).toBeTruthy();
  });

  it('mantiene Exportar activo y con el acento de la referencia', () => {
    renderEditor();
    const button = screen.getByRole('button', { name: 'Exportar' }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(button.getAttribute('title')).toBe('Exportar');
  });

  it('no duplica los roles banner / contentinfo del shell', () => {
    const { container } = renderEditor();
    expect(container.querySelector('header')).toBeNull();
    expect(container.querySelector('footer')).toBeNull();
  });

  it('monta la Timeline productiva real con los clips del proyecto (B3/P3)', async () => {
    const asset = readyAsset();
    let project = createEmptyProject('0919');
    project = addClipFromAsset(project, asset, { atFrame: 0 }).project;
    project = addClipFromAsset(project, asset, { atFrame: 300 }).project;
    const { container } = render(
      <ProjectProvider service={createFakeService()} initial={{ project }}>
        <MinimalEditor />
      </ProjectProvider>,
    );
    // La Timeline real llega por import() dinámico — hay que esperarla.
    await waitFor(() => {
      expect(container.querySelectorAll('.timeline-clip').length).toBe(2);
    });
    // Los clips se ordenan por su posición real en la secuencia: el segundo
    // queda a la derecha del primero (px, no el porcentaje de la réplica).
    const blocks = [...container.querySelectorAll<HTMLElement>('.timeline-clip')];
    const lefts = blocks.map((block) => parseFloat(block.style.left || '0'));
    expect(lefts[1]!).toBeGreaterThan(lefts[0]!);
  });

  it('el monitor muestra el frame real compuesto del playhead (UI-002)', async () => {
    const asset = readyAsset();
    const project = addClipFromAsset(createEmptyProject('0919'), asset, { atFrame: 0 }).project;
    const service = createFakeService();
    const frames: { clipId: string; frame: number; composite: boolean | undefined }[] = [];
    const original = service.renderPreviewFrame.bind(service);
    service.renderPreviewFrame = async (request) => {
      frames.push({ clipId: request.clipId, frame: request.frame, composite: request.composite });
      return original(request);
    };
    const { container } = render(
      <ProjectProvider service={service} initial={{ project }}>
        <MinimalEditor />
      </ProjectProvider>,
    );
    // Debounce de 300 ms + render async: el frame real llega después.
    await waitFor(() => {
      const img = container.querySelector<HTMLImageElement>('.me-monitor-media');
      expect(img?.src).toContain('data:image');
    });
    expect(frames.length).toBeGreaterThan(0);
    expect(frames[0]!.composite).toBe(true);
    expect(frames[0]!.frame).toBe(0);
    expect(frames[0]!.clipId).toBe(project.timeline.clips[0]!.id);
  });

  it('escribe la rotación del clip seleccionado vía el Inspector real (P4)', async () => {
    const asset = readyAsset();
    // El asset tiene que estar en project.assets: si no, parseProject
    // rechaza CUALQUIER edición (el clip referencia un asset inexistente).
    const base = createEmptyProject('0919');
    base.assets = [asset];
    const project = addClipFromAsset(base, asset, { atFrame: 0 }).project;
    let latest: ProjectDocument | null = null;
    function Probe() {
      latest = useProjectStore().state.project;
      return null;
    }
    const { container } = render(
      <ProjectProvider service={createFakeService()} initial={{ project }}>
        <MinimalEditor />
        <Probe />
      </ProjectProvider>,
    );
    // Seleccionar el clip en la Timeline real: el Inspector productivo
    // (lazy) lee store.selection y muestra ClipInspector → TransformSection.
    await waitFor(() => {
      expect(container.querySelector('.timeline-clip')).toBeTruthy();
    });
    const clipEl = container.querySelector('.timeline-clip')!;
    fireEvent.pointerDown(clipEl, { button: 0, clientX: 200, pointerId: 1 });
    // Inspector.tsx (~7k líneas) + EditorAssets (~2k) llegan por import()
    // dinámico — esperar el montaje real antes de buscar el campo.
    await waitFor(
      () => expect(container.querySelector('.me-inspector .inspector')).toBeTruthy(),
      { timeout: 10000 },
    );
    const rotate = await screen.findByRole('spinbutton', { name: 'Rotación' }, { timeout: 10000 });
    fireEvent.change(rotate, { target: { value: '45' } });
    // React onBlur se implementa sobre focusout — blur() no burbujea.
    fireEvent.focusOut(rotate);

    // `latest` se asigna dentro de Probe: TS lo narrowea a null en este scope.
    const clip = (latest as ProjectDocument | null)?.timeline.clips[0];
    expect(clip?.transform?.rotationDeg).toBe(45);
    // El input refleja el valor confirmado tras el update del store.
    expect((rotate as HTMLInputElement).value).toBe('45');
  });
});
