// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useEffect } from 'react';
import { createEmptyProject, type ProjectDocument } from '@editor-ia/project-schema';
import { ProjectProvider, useProjectStore } from '../../state/project-store';
import { addTrack, updateTrack } from '../../state/project-actions';
import { createFakeService } from '../../test/fake-service';
import { TrackAutomationPanel } from './TrackAutomationPanel';

const NOW = '2026-10-24T00:00:00.000Z';

afterEach(cleanup);

interface HarnessProps {
  readonly project: ProjectDocument;
  readonly trackId: string;
  readonly playhead: number;
  /** Valor del fader aplicado al montar/cambiar, para capturar valores nuevos. */
  readonly faderGain?: number;
  readonly faderPan?: number;
}

/**
 * Arnes de prueba: mueve el playhead y el fader del store global (como lo hace
 * el editor) y monta el panel leyendo la pista del store, igual que MixerView.
 */
function Harness({ project, trackId, playhead, faderGain, faderPan }: HarnessProps) {
  const store = useProjectStore();
  // El store cambia de identidad en cada update. Estos efectos deben ser
  // idempotentes y comparar antes de escribir o entran en un bucle de render
  // infinito (el worker de Vitest moría en este archivo).
  useEffect(() => {
    if (store.state.playheadFrame !== playhead) {
      store.setPlayhead(playhead);
    }
  }, [playhead, store]);
  useEffect(() => {
    if (faderGain === undefined) return;
    const current = store.state.project?.timeline.tracks.find(
      (item) => item.id === trackId,
    );
    if (!current || current.gainDb === faderGain) return;
    store.update((doc) => updateTrack(doc, trackId, { gainDb: faderGain }));
  }, [faderGain, trackId, store]);
  useEffect(() => {
    if (faderPan === undefined) return;
    const current = store.state.project?.timeline.tracks.find(
      (item) => item.id === trackId,
    );
    if (!current || current.pan === faderPan) return;
    store.update((doc) => updateTrack(doc, trackId, { pan: faderPan }));
  }, [faderPan, trackId, store]);
  const track = store.state.project?.timeline.tracks.find((item) => item.id === trackId);
  if (!track) return null;
  return <TrackAutomationPanel track={track} />;
}

function proyectoInicial(options: { locked?: boolean; gainDb?: number; pan?: number } = {}) {
  let project = createEmptyProject('Mezcla', NOW);
  const added = addTrack(project, 'audio', 'Música');
  project = added.project;
  project = updateTrack(project, added.trackId, {
    gainDb: options.gainDb ?? 0,
    pan: options.pan ?? 0,
    ...(options.locked ? { locked: true } : {}),
  });
  return { project, trackId: added.trackId };
}

function volumenClave() {
  return screen.getByRole('spinbutton', {
    name: /Volumen de la clave de Música/i,
  }) as HTMLInputElement;
}

function curvaVolumen() {
  return screen.getByRole('combobox', {
    name: /Curva de volumen de Música/i,
  }) as HTMLSelectElement;
}

describe('panel de automatización de la mesa', () => {
  it('fija una clave de volumen en el playhead con el valor actual del fader', () => {
    const { project, trackId } = proyectoInicial({ gainDb: -9 });
    render(
      <ProjectProvider service={createFakeService()} initial={{ project }}>
        <Harness project={project} trackId={trackId} playhead={30} />
      </ProjectProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Fijar volumen de Música/i }));
    expect(volumenClave().value).toBe('-9');
    expect(screen.getByText(/1 clave\(s\) · playhead/i)).toBeTruthy();
  });

  it('fija una clave de paneo en el playhead con el valor actual del knob', () => {
    const { project, trackId } = proyectoInicial({ pan: 0.5 });
    render(
      <ProjectProvider service={createFakeService()} initial={{ project }}>
        <Harness project={project} trackId={trackId} playhead={0} />
      </ProjectProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Fijar paneo de Música/i }));
    const clave = screen.getByRole('spinbutton', {
      name: /Paneo de la clave de Música/i,
    }) as HTMLInputElement;
    expect(clave.value).toBe('0.5');
    expect(screen.getByText('R 50')).toBeTruthy();
  });

  it('sobrescribe la clave del mismo frame en vez de duplicarla', () => {
    const { project, trackId } = proyectoInicial({ gainDb: -3 });
    const service = createFakeService();
    const arbol = (faderGain: number) => (
      <ProjectProvider service={service} initial={{ project }}>
        <Harness project={project} trackId={trackId} playhead={30} faderGain={faderGain} />
      </ProjectProvider>
    );
    const vista = render(arbol(-3));
    fireEvent.click(screen.getByRole('button', { name: /Fijar volumen de Música/i }));
    expect(volumenClave().value).toBe('-3');

    // el fader cambia y se vuelve a fijar en el mismo playhead
    vista.rerender(arbol(-6));
    fireEvent.click(screen.getByRole('button', { name: /Fijar volumen de Música/i }));
    const claves = screen.getAllByRole('spinbutton', { name: /Volumen de la clave de Música/i });
    expect(claves).toHaveLength(1);
    expect((claves[0] as HTMLInputElement).value).toBe('-6');
  });

  it('edita el valor y la curva de una clave desde el listado', () => {
    const { project, trackId } = proyectoInicial();
    render(
      <ProjectProvider service={createFakeService()} initial={{ project }}>
        <Harness project={project} trackId={trackId} playhead={0} />
      </ProjectProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Fijar volumen de Música/i }));
    fireEvent.change(volumenClave(), { target: { value: '-4.5' } });
    expect(volumenClave().value).toBe('-4.5');

    fireEvent.change(curvaVolumen(), { target: { value: 'ease-in' } });
    expect(curvaVolumen().value).toBe('ease-in');
  });

  it('borra una clave individual con su botón y desactiva «Quitar animación» al vaciar', () => {
    const { project, trackId } = proyectoInicial({ gainDb: -2 });
    render(
      <ProjectProvider service={createFakeService()} initial={{ project }}>
        <Harness project={project} trackId={trackId} playhead={0} />
      </ProjectProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Fijar volumen de Música/i }));
    fireEvent.click(screen.getByRole('button', { name: /Quitar clave de volumen de Música/i }));
    expect(screen.getByText(/El fader y el paneo siguen sus valores estáticos/i)).toBeTruthy();
    const quitar = screen.getByRole('button', {
      name: /Quitar la animación de Música/i,
    }) as HTMLButtonElement;
    expect(quitar.disabled).toBe(true);
  });

  it('quita la animación congelando el valor muestreado en el playhead', () => {
    const { project, trackId } = proyectoInicial();
    render(
      <ProjectProvider service={createFakeService()} initial={{ project }}>
        <Harness project={project} trackId={trackId} playhead={0} />
      </ProjectProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Fijar volumen de Música/i }));
    fireEvent.click(screen.getByRole('button', { name: /Quitar la animación de Música/i }));
    expect(screen.getByText(/El fader y el paneo siguen sus valores estáticos/i)).toBeTruthy();
  });

  it('deshabilita la captura cuando la pista está bloqueada', () => {
    const { project, trackId } = proyectoInicial({ locked: true });
    render(
      <ProjectProvider service={createFakeService()} initial={{ project }}>
        <Harness project={project} trackId={trackId} playhead={0} />
      </ProjectProvider>,
    );
    const volumen = screen.getByRole('button', {
      name: /Fijar volumen de Música/i,
    }) as HTMLButtonElement;
    const paneo = screen.getByRole('button', {
      name: /Fijar paneo de Música/i,
    }) as HTMLButtonElement;
    expect(volumen.disabled).toBe(true);
    expect(paneo.disabled).toBe(true);
  });
});
