// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ProviderInfo, ProviderTestResult } from '../../services/project-service';
import { AppearanceProvider } from '../../state/AppearanceProvider';
import { ProjectProvider } from '../../state/project-store';
import { createFakeService } from '../../test/fake-service';
import { SettingsHome } from './SettingsHome';

const LOCAL_PROVIDER: ProviderInfo = {
  kind: 'openai-compatible',
  baseUrl: 'http://127.0.0.1:11434/v1',
  model: 'llama3.1',
  hasKey: false,
  keyringAvailable: true,
};

function renderSettings(configure: (service: ReturnType<typeof createFakeService>) => void = () => {}) {
  const service = createFakeService();
  configure(service);
  render(
    <AppearanceProvider>
      <ProjectProvider service={service}>
        <SettingsHome />
      </ProjectProvider>
    </AppearanceProvider>,
  );
  return service;
}

async function openAiSection(): Promise<void> {
  const navigation = await screen.findByRole('navigation', { name: /Secciones de Ajustes/i });
  fireEvent.click(within(navigation).getByRole('button', { name: /Inteligencia artificial/i }));
  expect(
    await screen.findByRole('heading', { name: 'Inteligencia artificial', level: 2 }),
  ).toBeTruthy();
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('Ajustes → Inteligencia artificial · probar conexión', () => {
  it('prueba el proveedor y muestra modelo, latencia y HTTP en role=status', async () => {
    renderSettings((service) => {
      service.getProvider = async () => LOCAL_PROVIDER;
      service.testProvider = async (): Promise<ProviderTestResult> => ({
        status: 'ok',
        ok: true,
        httpStatus: 200,
        latencyMs: 123,
        model: 'llama3.1',
        detail: 'el proveedor respondió y el modelo configurado aparece en /models',
        baseUrl: LOCAL_PROVIDER.baseUrl,
      });
    });
    await openAiSection();

    // El formulario se rellena con lo guardado antes de poder probar.
    await waitFor(() =>
      expect(screen.getByDisplayValue(LOCAL_PROVIDER.baseUrl)).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole('button', { name: /Probar conexión/i }));

    const result = await screen.findByText(/Conexión correcta/i);
    expect(result.textContent).toMatch(/el endpoint respondió y el modelo está disponible/i);
    const status = result.closest('[role="status"]');
    expect(status).toBeTruthy();
    expect(status?.textContent).toMatch(/HTTP 200/);
    expect(status?.textContent).toMatch(/123 ms/);
    expect(status?.textContent).toMatch(/llama3\.1/);
  });

  it('muestra el error tipado con su detalle accionable sin fingir éxito', async () => {
    renderSettings((service) => {
      service.getProvider = async () => LOCAL_PROVIDER;
      service.testProvider = async (): Promise<ProviderTestResult> => ({
        status: 'unauthorized',
        ok: false,
        httpStatus: 401,
        latencyMs: 42,
        model: null,
        detail: 'el proveedor rechazó la clave (HTTP 401); revisá la clave guardada en Ajustes → IA',
        baseUrl: LOCAL_PROVIDER.baseUrl,
      });
    });
    await openAiSection();
    await waitFor(() =>
      expect(screen.getByDisplayValue(LOCAL_PROVIDER.baseUrl)).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole('button', { name: /Probar conexión/i }));

    await screen.findByText(/Conexión fallida/i);
    const status = screen.getByText(/Conexión fallida/i).closest('[role="status"]');
    expect(status).toBeTruthy();
    expect(status?.textContent).toMatch(/Clave rechazada por el proveedor/i);
    expect(status?.textContent).toMatch(/HTTP 401/);
    expect(status?.textContent).toMatch(/revisá la clave guardada/i);
  });

  it('declara el fallo cuando el servicio no puede ejecutar la prueba', async () => {
    renderSettings((service) => {
      service.getProvider = async () => LOCAL_PROVIDER;
      service.testProvider = async () => {
        throw new Error('el runtime nativo no está disponible en el navegador');
      };
    });
    await openAiSection();
    await waitFor(() =>
      expect(screen.getByDisplayValue(LOCAL_PROVIDER.baseUrl)).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole('button', { name: /Probar conexión/i }));

    const message = await screen.findByText(/La prueba no pudo ejecutarse/i);
    expect(message.textContent).toMatch(/runtime nativo no está disponible/i);
    expect(screen.queryByText(/Conexión correcta/i)).toBeNull();
  });

  it('deshabilita la prueba sin URL y modelo configurados', async () => {
    renderSettings((service) => {
      service.getProvider = async () => ({
        kind: 'openai-compatible',
        baseUrl: '',
        model: '',
        hasKey: false,
        keyringAvailable: true,
      });
    });
    await openAiSection();

    const button = await screen.findByRole('button', { name: /Probar conexión/i });
    await waitFor(() => expect(button).toHaveProperty('disabled', true));
  });
});
