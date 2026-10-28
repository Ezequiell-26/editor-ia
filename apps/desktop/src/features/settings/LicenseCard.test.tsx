// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { LicenseProvider } from '../../state/LicenseProvider';
import { createFakeService } from '../../test/fake-service';
import { LicenseCard } from './LicenseCard';

afterEach(cleanup);

function renderCard() {
  const service = createFakeService();
  render(
    <LicenseProvider service={service}>
      <LicenseCard />
    </LicenseProvider>,
  );
  return service;
}

describe('tarjeta de licencia', () => {
  it('muestra Pro y permite desactivar y reactivar el archivo', async () => {
    const service = renderCard();
    expect(await screen.findByText('Olyvia Pro')).toBeTruthy();
    expect(screen.getByText('tester@example.com')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Desactivar en este equipo/i }));
    await waitFor(() => expect(screen.getByText('Olyvia Free')).toBeTruthy());
    expect(screen.getByText(/hasta 2 descargas simultáneas/i)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Activar Olyvia Pro/i }));
    expect(await screen.findByRole('dialog', { name: /Activá funciones avanzadas/i })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Probar 14 días gratis/i }));
    await waitFor(() => expect(screen.getByText(/Olyvia Pro · Prueba/i)).toBeTruthy());
    expect(service.calls).toBeTruthy();
  });

  it('refleja un Free del backend sin fingir activación', async () => {
    const service = createFakeService();
    service.setLicenseTier('free');
    render(
      <LicenseProvider service={service}>
        <LicenseCard />
      </LicenseProvider>,
    );
    expect(await screen.findByText('Olyvia Free')).toBeTruthy();
    expect(screen.getByText(/Pro: hasta 512 descargas/i)).toBeTruthy();
  });
});
