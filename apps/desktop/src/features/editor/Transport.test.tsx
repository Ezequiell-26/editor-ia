// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createEmptyProject } from '@editor-ia/project-schema';
import { ProjectProvider, useProjectStore } from '../../state/project-store';
import { createFakeService } from '../../test/fake-service';
import {
  loadEditorPreferences,
  resetEditorPreferences,
  updateEditorPreferences,
} from '../../state/editor-preferences';
import { Transport } from './Transport';

const NOW = '2026-11-08T00:00:00.000Z';

function renderTransport() {
  const project = createEmptyProject('Loop', NOW);
  render(
    <ProjectProvider service={createFakeService()} initial={{ project }}>
      <Transport />
    </ProjectProvider>,
  );
}

function loopButton(): HTMLElement {
  return screen.getByRole('button', { name: 'Bucle de reproducción' });
}

afterEach(() => {
  cleanup();
  resetEditorPreferences();
});

describe('Transport · botón Bucle', () => {
  it('refleja la preferencia persistida loopPlayback', () => {
    updateEditorPreferences({ loopPlayback: true });
    renderTransport();
    expect(loopButton().className).toContain('active');
    expect(loopButton().title).toBe('Bucle activado');
  });

  it('sin la preferencia el botón no aparece activo', () => {
    updateEditorPreferences({ loopPlayback: false });
    renderTransport();
    expect(loopButton().className).not.toContain('active');
    expect(loopButton().title).toBe('Activar bucle');
  });

  it('el click escribe la preferencia real que lee usePlayback', () => {
    updateEditorPreferences({ loopPlayback: false });
    renderTransport();
    fireEvent.click(loopButton());
    expect(loadEditorPreferences().loopPlayback).toBe(true);
    expect(loopButton().className).toContain('active');
    fireEvent.click(loopButton());
    expect(loadEditorPreferences().loopPlayback).toBe(false);
    expect(loopButton().className).not.toContain('active');
  });
});

describe('Transport · velocidad de reproducción', () => {
  it('el selector escribe la preferencia persistida playbackRate', () => {
    renderTransport();
    const select = screen.getByLabelText('Velocidad de reproducción');
    expect((select as HTMLSelectElement).value).toBe('1');
    fireEvent.change(select, { target: { value: '2' } });
    expect(loadEditorPreferences().playbackRate).toBe(2);
    expect((select as HTMLSelectElement).value).toBe('2');
    // Y la preferencia elegida es la que arranca el próximo transporte.
    cleanup();
    renderTransport();
    expect(
      (screen.getByLabelText('Velocidad de reproducción') as HTMLSelectElement).value,
    ).toBe('2');
  });
});

describe('Transport · sentido del shuttle', () => {
  it('en reversa el botón de play/pausa lo indica en título e icono', () => {
    function ShuttleBack() {
      const store = useProjectStore();
      return (
        <button
          type="button"
          onClick={() => {
            store.setPlaybackDirection(-1);
            store.setPlaying(true);
          }}
        >
          shuttle atras
        </button>
      );
    }
    const project = createEmptyProject('Reversa', NOW);
    render(
      <ProjectProvider service={createFakeService()} initial={{ project }}>
        <Transport />
        <ShuttleBack />
      </ProjectProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'shuttle atras' }));
    const play = screen.getByRole('button', { name: 'Pausar' });
    expect(play.title).toContain('hacia atrás');
    // El icono es playReverse (triángulo a la izquierda), no pause.
    expect(play.querySelector('svg path')?.getAttribute('d')).toContain('M16');
  });
});
