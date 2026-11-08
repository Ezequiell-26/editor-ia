// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createEmptyProject } from '@editor-ia/project-schema';
import { ProjectProvider } from '../../state/project-store';
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
