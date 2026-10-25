// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyProject, type ProjectDocument } from '@editor-ia/project-schema';
import { ProjectProvider } from '../../state/project-store';
import { ensureDelivery } from '../../state/project-actions';
import { createFakeService } from '../../test/fake-service';
import { LoudnessMonitor } from './LoudnessMonitor';

const NOW = '2026-10-24T00:00:00.000Z';

afterEach(cleanup);

function projectWithTarget(withTarget: boolean): ProjectDocument {
  let project = ensureDelivery(createEmptyProject('Mezcla loudness', NOW));
  if (withTarget) {
    project = {
      ...project,
      audio: {
        ...project.audio,
        loudnessTarget: {
          platform: 'youtube',
          integratedLufs: -14,
          truePeakDb: -1.5,
          toleranceDb: 1,
        },
      },
    } as ProjectDocument;
  }
  return project;
}

function renderMonitor(withTarget = true) {
  const project = projectWithTarget(withTarget);
  const service = createFakeService();
  const result = render(
    <ProjectProvider
      service={service}
      initial={{
        project,
        opened: {
          project,
          label: 'mezcla.editoria.json',
          path: 'C:\\tester\\mezcla.editoria.json',
          root: 'C:\\tester',
        },
      }}
    >
      <LoudnessMonitor />
    </ProjectProvider>,
  );
  return { ...result, service };
}

describe('monitor de loudness', () => {
  it('invita a medir antes de la primera medición', () => {
    renderMonitor();
    expect(screen.getByRole('heading', { name: /Loudness de la mezcla/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Medir loudness/i })).toBeTruthy();
    expect(screen.getByText(/Todavía no hay medición/i)).toBeTruthy();
  });

  it('mide la mezcla guardada y muestra el reporte con delta', async () => {
    const { service } = renderMonitor();
    const button = screen.getByRole('button', { name: /Medir loudness/i });
    fireEvent.click(button);
    await waitFor(() => {
      expect(screen.getByText('-16.2 LUFS')).toBeTruthy();
    });
    expect(service.calls.save).toBe(1);
    expect(screen.getByText('4.5 LU')).toBeTruthy();
    expect(screen.getByText('-2.8 dBTP')).toBeTruthy();
    const delta = screen.getByText('+2.2 dB');
    expect(delta).toBeTruthy();
    expect(screen.getByText(/La normalización subirá la mezcla ≈ 2\.2 dB/i)).toBeTruthy();
    // El historial dibuja ambas curvas.
    expect(document.querySelectorAll('polyline.loudness-momentary').length).toBe(1);
    expect(document.querySelectorAll('polyline.loudness-short-term').length).toBe(1);
  });

  it('avisa si el proyecto no pudo guardarse antes de medir', async () => {
    const { service } = renderMonitor();
    service.setSaveFailure('disco lleno');
    fireEvent.click(screen.getByRole('button', { name: /Medir loudness/i }));
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain(
        'Guardá el proyecto antes de medir',
      );
    });
    // Sin medición no hay reporte.
    expect(screen.getByText(/Todavía no hay medición/i)).toBeTruthy();
  });

  it('sin objetivo configurado no muestra delta', async () => {
    renderMonitor(false);
    fireEvent.click(screen.getByRole('button', { name: /Medir loudness/i }));
    await waitFor(() => {
      expect(screen.getByText('-16.2 LUFS')).toBeTruthy();
    });
    expect(screen.queryByText('+2.2 dB')).toBeNull();
    expect(screen.getByText(/Sin objetivo configurado/i)).toBeTruthy();
  });
});
