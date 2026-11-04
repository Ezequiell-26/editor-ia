// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyProject } from '@editor-ia/project-schema';
import { StartScreen } from './StartScreen';
import { AppearanceProvider } from '../../state/AppearanceProvider';
import { ProjectProvider } from '../../state/project-store';
import { ensureDelivery } from '../../state/project-actions';
import { writeRecoverySnapshot } from '../../state/recovery';
import { createFakeService } from '../../test/fake-service';

const SAVED_AT = '2026-11-03T18:00:00.000Z';
const RECOVERY_PATH = 'C:\\tester\\interrumpido.editoria.json';

function seedRecoverySnapshot(): void {
  const project = ensureDelivery(createEmptyProject('Interrumpido', SAVED_AT));
  writeRecoverySnapshot(project, RECOVERY_PATH, SAVED_AT);
}

function renderStartScreen(
  service: ReturnType<typeof createFakeService> = createFakeService(),
  onEnterApp = vi.fn(),
) {
  render(
    <AppearanceProvider>
      <ProjectProvider service={service}>
        <StartScreen onEnterApp={onEnterApp} />
      </ProjectProvider>
    </AppearanceProvider>,
  );
  return { service, onEnterApp };
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('Lanzador · oferta de sesión sin guardar', () => {
  it('muestra la oferta con el archivo y la fecha relativa', async () => {
    seedRecoverySnapshot();
    renderStartScreen();

    expect(await screen.findByText('Sesión sin guardar')).toBeTruthy();
    expect(screen.getByText(/Recuperar sesión anterior/i)).toBeTruthy();
    expect(screen.getByText(/interrumpido\.editoria\.json/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Descartar sesión sin guardar/i })).toBeTruthy();
  });

  it('recupera la sesión y entra al editor', async () => {
    seedRecoverySnapshot();
    const { onEnterApp } = renderStartScreen();

    fireEvent.click(await screen.findByText(/Recuperar sesión anterior/i));

    await waitFor(() => expect(onEnterApp).toHaveBeenCalledWith('editor'), { timeout: 3000 });
    expect(window.localStorage.getItem('editoria.recovery.v1')).toBeNull();
  });

  it('descarta la oferta sólo con confirmación', async () => {
    seedRecoverySnapshot();
    renderStartScreen();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);

    fireEvent.click(await screen.findByText(/Descartar sesión sin guardar/i));
    expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/descarta la sesión sin guardar/i));
    expect(screen.getByText(/Recuperar sesión anterior/i)).toBeTruthy();

    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByText(/Descartar sesión sin guardar/i));
    await waitFor(() => expect(screen.queryByText(/Recuperar sesión anterior/i)).toBeNull());
    expect(window.localStorage.getItem('editoria.recovery.v1')).toBeNull();
  });

  it('sin snapshot no muestra la tarjeta', () => {
    renderStartScreen();
    expect(screen.queryByText(/Sesión sin guardar/i)).toBeNull();
  });

  it('en navegador la oferta se ve pero recuperar está deshabilitado con motivo', async () => {
    seedRecoverySnapshot();
    const service = {
      ...createFakeService(),
      available: false,
      unavailableReason: 'Esta es la versión web de evaluación: no hay runtime nativo.',
    };
    renderStartScreen(service as ReturnType<typeof createFakeService>);

    const recover = (await screen.findByText(/Recuperar sesión anterior/i)).closest('button');
    expect(recover).toBeTruthy();
    expect(recover).toHaveProperty('disabled', true);
    expect(recover?.getAttribute('title')).toMatch(/app de escritorio/i);
  });
});
