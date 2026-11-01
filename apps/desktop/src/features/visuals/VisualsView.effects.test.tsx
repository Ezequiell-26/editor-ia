// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createEmptyProject } from '@editor-ia/project-schema';
import { ProjectProvider, useProjectStore } from '../../state/project-store';
import { addAsset, addClipFromAsset, addTrack, ensureDelivery } from '../../state/project-actions';
import { createFakeService, readyAsset } from '../../test/fake-service';
import { VisualsView } from './VisualsView';

const NOW = '2026-10-30T00:00:00.000Z';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function Probe() {
  const store = useProjectStore();
  const clips = store.state.project?.timeline.clips ?? [];
  const effects = clips.map((clip) => ('effects' in clip ? (clip.effects ?? {}) : {}));
  const keyframes = clips.map((clip) =>
    'effectKeyframes' in clip ? (clip.effectKeyframes ?? []) : [],
  );
  const transitions = clips.map((clip) =>
    'transitionIn' in clip ? clip.transitionIn : undefined,
  );
  const clipSummary = clips.map((clip) => ({
    kind: clip.kind,
    startFrame: clip.startFrame,
    durationFrames: clip.durationFrames,
    effects: 'effects' in clip ? (clip.effects ?? {}) : {},
  }));
  return (
    <div>
      <output data-testid="effects">{JSON.stringify(effects)}</output>
      <output data-testid="keyframes">{JSON.stringify(keyframes)}</output>
      <output data-testid="transitions">{JSON.stringify(transitions)}</output>
      <output data-testid="clips">{JSON.stringify(clipSummary)}</output>
      <button type="button" onClick={() => store.undo()}>
        Deshacer prueba
      </button>
    </div>
  );
}

function renderVisuals(clips = 1) {
  let project = ensureDelivery(createEmptyProject('Efectos', NOW));
  const asset = readyAsset();
  project = addAsset(project, asset);
  for (let index = 0; index < clips; index += 1) {
    project = addClipFromAsset(project, asset, {
      atFrame: index * 150,
      durationFrames: 100,
    }).project;
  }
  const service = createFakeService();
  render(
    <ProjectProvider
      service={service}
      initial={{
        project,
        opened: {
          project,
          label: 'efectos.editoria.json',
          path: 'C:\\tester\\efectos.editoria.json',
          root: 'C:\\tester',
        },
      }}
    >
      <VisualsView onNavigate={() => {}} />
      <Probe />
    </ProjectProvider>,
  );
}

describe('VisualsView · efectos profesionales', () => {
  it('aplica un parámetro al clip y lo revierte con undo', () => {
    renderVisuals();
    fireEvent.click(screen.getByRole('button', { name: /^Brillo/ }));
    const editor = screen.getByRole('region', { name: 'Parámetros de Brillo' });
    const slider = within(editor).getByRole('slider', { name: 'Brillo' });
    fireEvent.change(slider, { target: { value: '0.4' } });
    fireEvent.click(within(editor).getByRole('button', { name: 'Aplicar efecto' }));

    const effects = () => JSON.parse(screen.getByTestId('effects').textContent ?? 'null');
    expect(effects()[0].brightness).toBeCloseTo(0.4);

    fireEvent.click(screen.getByRole('button', { name: 'Deshacer prueba' }));
    expect(effects()[0]?.brightness).toBeUndefined();
  });

  it('arrastra un efecto del panel al clip y aplica sus valores por defecto', () => {
    renderVisuals();
    const dataTransfer = {
      effectAllowed: 'copy',
      dropEffect: 'copy',
      setData: () => {},
      getData: (type: string) =>
        type === 'application/x-olyvia-effect' ? 'blur' : '',
    };
    fireEvent.dragStart(screen.getByRole('button', { name: /^Desenfoque/ }), { dataTransfer });
    const target = document.querySelector('[data-clip-id]') as HTMLElement;
    fireEvent.dragOver(target, { dataTransfer });
    fireEvent.drop(target, { dataTransfer });
    const effects = () => JSON.parse(screen.getByTestId('effects').textContent ?? 'null');
    expect(effects()[0].blur).toBe(2);
  });

  it('selecciona una pista y aplica el efecto sólo a sus clips', () => {
    let project = ensureDelivery(createEmptyProject('Pistas', NOW));
    const asset = readyAsset();
    project = addAsset(project, asset);
    project = addClipFromAsset(project, asset, { atFrame: 0, durationFrames: 100 }).project;
    const firstTrack = project.timeline.clips[0]!.trackId;
    const added = addTrack(project, 'video', 'V2');
    project = added.project;
    project = addClipFromAsset(project, asset, {
      trackId: added.trackId,
      atFrame: 0,
      durationFrames: 100,
    }).project;
    const service = createFakeService();
    render(
      <ProjectProvider
        service={service}
        initial={{ project, opened: { project, label: 'p.editoria.json', path: 'C:\tester\p.editoria.json', root: 'C:\tester' } }}
      >
        <VisualsView onNavigate={() => {}} />
        <Probe />
      </ProjectProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Ninguno' }));
    fireEvent.click(screen.getByRole('button', { name: 'Seleccionar pista V1' }));
    fireEvent.click(screen.getByRole('button', { name: /^Brillo/ }));
    const editor = screen.getByRole('region', { name: 'Parámetros de Brillo' });
    fireEvent.change(within(editor).getByRole('slider', { name: 'Brillo' }), {
      target: { value: '0.4' },
    });
    fireEvent.click(within(editor).getByRole('button', { name: 'Aplicar efecto' }));
    const effects = () => JSON.parse(screen.getByTestId('effects').textContent ?? 'null');
    expect(effects()[0].brightness).toBeCloseTo(0.4);
    expect(effects()[1]?.brightness).toBeUndefined();
  });

  it('agrega un keyframe de efecto al clip principal', () => {
    renderVisuals();
    fireEvent.click(screen.getByRole('button', { name: /^Brillo/ }));
    const editor = screen.getByRole('region', { name: 'Parámetros de Brillo' });
    fireEvent.click(within(editor).getByRole('button', { name: 'Agregar keyframe' }));
    const keyframes = () => JSON.parse(screen.getByTestId('keyframes').textContent ?? 'null');
    expect(keyframes()[0]).toEqual([
      { frame: 0, property: 'brightness', value: 0, easing: 'linear' },
    ]);
  });

  it('aplica una transición con curva ease-in y la persiste', () => {
    renderVisuals();
    const section = screen.getByText('Un corte que no se siente').closest('section');
    if (!section) throw new Error('falta la sección de transición');
    fireEvent.change(within(section).getByLabelText('Tipo de transición'), {
      target: { value: 'wipe-left' },
    });
    fireEvent.change(within(section).getByLabelText('Curva de transición'), {
      target: { value: 'ease-in' },
    });
    fireEvent.click(within(section).getByRole('button', { name: 'Aplicar' }));
    const transitions = () =>
      JSON.parse(screen.getByTestId('transitions').textContent ?? 'null');
    expect(transitions()[0]).toMatchObject({ type: 'wipe-left', easing: 'ease-in' });
    fireEvent.change(within(section).getByLabelText('Tipo de transición'), {
      target: { value: 'fade-black' },
    });
    expect(
      (within(section).getByLabelText('Curva de transición') as HTMLSelectElement).disabled,
    ).toBe(true);
  });

  it('aplica el efecto a toda la pista con una capa de ajuste', () => {
    renderVisuals(2);
    fireEvent.click(screen.getByRole('button', { name: /^Brillo/ }));
    const editor = screen.getByRole('region', { name: 'Parámetros de Brillo' });
    fireEvent.change(within(editor).getByRole('slider', { name: 'Brillo' }), {
      target: { value: '0.4' },
    });
    fireEvent.click(within(editor).getByRole('button', { name: 'Aplicar a la pista' }));
    const clips = () => JSON.parse(screen.getByTestId('clips').textContent ?? 'null');
    const adjustment = clips().find((clip: { kind: string }) => clip.kind === 'adjustment');
    expect(adjustment).toMatchObject({ startFrame: 0, durationFrames: 250 });
    expect(adjustment.effects.brightness).toBeCloseTo(0.4);
  });

  it('quita un efecto puntual sin borrar los demás', () => {
    renderVisuals(2);
    fireEvent.click(screen.getByRole('button', { name: /^Desenfoque/ }));
    const blurEditor = screen.getByRole('region', { name: 'Parámetros de Desenfoque' });
    fireEvent.click(within(blurEditor).getByRole('button', { name: 'Aplicar efecto' }));
    fireEvent.click(screen.getByRole('button', { name: /^Brillo/ }));
    const editor = screen.getByRole('region', { name: 'Parámetros de Brillo' });
    fireEvent.change(within(editor).getByRole('slider', { name: 'Brillo' }), {
      target: { value: '0.4' },
    });
    fireEvent.click(within(editor).getByRole('button', { name: 'Aplicar efecto' }));
    const effects = () => JSON.parse(screen.getByTestId('effects').textContent ?? 'null');
    expect(effects()[0].blur).toBe(2);
    expect(effects()[0].brightness).toBeCloseTo(0.4);
    fireEvent.click(screen.getByRole('button', { name: 'Quitar Brillo' }));
    expect(effects()[0].brightness).toBeUndefined();
    expect(effects()[0].blur).toBe(2);
    expect(effects()[1].brightness).toBeUndefined();
    expect(effects()[1].blur).toBe(2);
  });

  it('guarda un preset del clip y lo aplica a la selección', () => {
    renderVisuals(2);
    fireEvent.click(screen.getByRole('button', { name: /^Brillo/ }));
    const editor = screen.getByRole('region', { name: 'Parámetros de Brillo' });
    fireEvent.change(within(editor).getByRole('slider', { name: 'Brillo' }), {
      target: { value: '0.4' },
    });
    fireEvent.click(within(editor).getByRole('button', { name: 'Aplicar efecto' }));
    fireEvent.change(screen.getByLabelText('Nombre del preset'), {
      target: { value: 'Cálido' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar preset' }));
    fireEvent.click(screen.getByRole('button', { name: 'Quitar efectos' }));
    const effects = () => JSON.parse(screen.getByTestId('effects').textContent ?? 'null');
    expect(effects()[0].brightness).toBeUndefined();
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar Cálido' }));
    expect(effects()[0].brightness).toBeCloseTo(0.4);
    expect(effects()[1].brightness).toBeCloseTo(0.4);
  });

  it('copia, quita y pega efectos en todos los clips seleccionados', () => {
    renderVisuals(2);
    fireEvent.click(screen.getByRole('button', { name: /^Brillo/ }));
    const editor = screen.getByRole('region', { name: 'Parámetros de Brillo' });
    fireEvent.change(within(editor).getByRole('slider', { name: 'Brillo' }), {
      target: { value: '0.4' },
    });
    fireEvent.click(within(editor).getByRole('button', { name: 'Aplicar efecto' }));

    const effects = () => JSON.parse(screen.getByTestId('effects').textContent ?? 'null');
    expect(effects()[0].brightness).toBeCloseTo(0.4);
    expect(effects()[1].brightness).toBeCloseTo(0.4);

    fireEvent.click(screen.getByRole('button', { name: 'Copiar efectos' }));
    fireEvent.click(screen.getByRole('button', { name: 'Quitar efectos' }));
    expect(effects()[0].brightness).toBeUndefined();
    expect(effects()[1].brightness).toBeUndefined();

    fireEvent.click(screen.getByRole('button', { name: 'Pegar efectos' }));
    expect(effects()[0].brightness).toBeCloseTo(0.4);
    expect(effects()[1].brightness).toBeCloseTo(0.4);

    fireEvent.click(screen.getByRole('button', { name: 'Deshacer prueba' }));
    expect(effects()[0].brightness).toBeUndefined();
  });
});
