// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../../App';
import { createFakeService } from '../../test/fake-service';

function renderHome(configure: (service: ReturnType<typeof createFakeService>) => void = () => {}) {
  const service = createFakeService();
  configure(service);
  render(<App service={service} />);
  return service;
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.replaceState({}, '', '/');
});

describe('Inicio · sin demos muertas y con errores visibles', () => {
  it('no ofrece los CTAs "Probar demo" que apuntaban a proyectos inexistentes', async () => {
    renderHome();
    // La portada de Inicio se monta en el shell: se espera su título.
    expect(await screen.findByText(/Creá videos virales|Continuar con/i)).toBeTruthy();
    expect(screen.queryByText(/Probar demo/i)).toBeNull();
    expect(screen.queryByText(/demo Reels|demo YouTube/i)).toBeNull();
  });

  it('muestra el motivo cuando abrir un proyecto falla', async () => {
    renderHome((service) => {
      service.openProject = async () => {
        throw new Error('no se pudo leer el proyecto elegido');
      };
    });

    fireEvent.click(await screen.findByRole('button', { name: /Abrir proyecto/i }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/no se pudo leer el proyecto elegido/i);
  });
});
