// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyProject } from '@editor-ia/project-schema';
import { AppShell } from './AppShell';
import { AppearanceProvider } from '../state/AppearanceProvider';
import { ProjectProvider } from '../state/project-store';
import { ensureDelivery } from '../state/project-actions';
import { writeRecoverySnapshot } from '../state/recovery';
import { createFakeService } from '../test/fake-service';

const SAVED_AT = '2026-11-03T18:00:00.000Z';
const RECOVERY_PATH = 'C:\\tester\\interrumpido.editoria.json';

function seedRecoverySnapshot(): void {
  const project = ensureDelivery(createEmptyProject('Interrumpido', SAVED_AT));
  writeRecoverySnapshot(project, RECOVERY_PATH, SAVED_AT);
}

function renderShell(service = createFakeService()) {
  render(
    <AppearanceProvider>
      <ProjectProvider service={service}>
        <AppShell activeId="home" onSelect={() => {}} content={<div />} />
      </ProjectProvider>
    </AppearanceProvider>,
  );
  return service;
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('Shell · banner de recuperación (único dentro de la app)', () => {
  it('descartar pide confirmación y sólo entonces limpia la oferta', async () => {
    seedRecoverySnapshot();
    renderShell();
    expect(await screen.findByText(/Se interrumpió la sesión anterior/i)).toBeTruthy();

    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(screen.getByRole('button', { name: 'Descartar' }));
    expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/descarta la sesión sin guardar/i));
    expect(screen.getByText(/Se interrumpió la sesión anterior/i)).toBeTruthy();

    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Descartar' }));
    await waitFor(() =>
      expect(screen.queryByText(/Se interrumpió la sesión anterior/i)).toBeNull(),
    );
  });

  it('recuperar abre el proyecto de la instantánea y limpia el banner', async () => {
    seedRecoverySnapshot();
    const service = renderShell();

    fireEvent.click(await screen.findByRole('button', { name: 'Recuperar' }));

    await waitFor(() =>
      expect(screen.queryByText(/Se interrumpió la sesión anterior/i)).toBeNull(),
    );
    expect(service.calls.open).toBe(1);
  });

  it('si recuperar falla, el banner sigue visible y el error se declara', async () => {
    seedRecoverySnapshot();
    const service = renderShell();
    service.openProjectAt = async () => {
      throw new Error('el archivo de la sesión ya no existe');
    };

    fireEvent.click(await screen.findByRole('button', { name: 'Recuperar' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/el archivo de la sesión ya no existe/i);
    expect(screen.getByText(/Se interrumpió la sesión anterior/i)).toBeTruthy();
  });
});
