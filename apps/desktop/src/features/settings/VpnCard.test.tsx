// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectProvider } from '../../state/project-store';
import { createFakeService } from '../../test/fake-service';
import { VpnCard } from './VpnCard';

afterEach(cleanup);

function renderCard(service = createFakeService()) {
  render(
    <ProjectProvider service={service}>
      <VpnCard />
    </ProjectProvider>,
  );
  return service;
}

describe('tarjeta VPN del sistema', () => {
  it('lista las conexiones con su estado y ofrece conectar/desconectar', async () => {
    renderCard();
    expect(await screen.findByText('Casa')).toBeTruthy();
    expect(screen.getByText('Oficina')).toBeTruthy();
    expect(screen.getByText('Desconectada')).toBeTruthy();
    expect(screen.getByText('Conectada')).toBeTruthy();
    // «Casa» está desconectada → botón Conectar; «Oficina» conectada → Desconectar.
    expect(screen.getAllByRole('button', { name: 'Conectar' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Desconectar' })).toHaveLength(1);
  });

  it('conecta y desconecta por el servicio', async () => {
    const service = createFakeService();
    const connect = vi.spyOn(service, 'vpnConnect');
    const disconnect = vi.spyOn(service, 'vpnDisconnect');
    renderCard(service);
    const connectButton = await screen.findByRole('button', { name: 'Conectar' });
    fireEvent.click(connectButton);
    await waitFor(() => expect(connect).toHaveBeenCalledWith('Casa'));
    expect(await screen.findByText(/«Casa» conectada/)).toBeTruthy();

    const disconnectButton = screen.getAllByRole('button', { name: 'Desconectar' })[0];
    expect(disconnectButton).toBeTruthy();
    fireEvent.click(disconnectButton as HTMLElement);
    await waitFor(() => expect(disconnect).toHaveBeenCalled());
  });

  it('muestra el error del backend sin romper la tarjeta', async () => {
    const service = createFakeService();
    service.vpnConnect = async () => {
      throw new Error('rasdial no pudo conectar: credenciales no guardadas');
    };
    renderCard(service);
    fireEvent.click(await screen.findByRole('button', { name: 'Conectar' }));
    expect(await screen.findByText(/credenciales no guardadas/)).toBeTruthy();
  });

  it('sin conexiones explica cómo crearlas y no muestra botones', async () => {
    const service = createFakeService();
    service.vpnList = async () => [];
    renderCard(service);
    expect(await screen.findByText(/No hay conexiones VPN configuradas/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Conectar' })).toBeNull();
  });

  it('ofrece abrir WireGuard sólo si está instalado', async () => {
    const service = createFakeService();
    service.vpnWireguard = async () => ({ installed: true, path: 'C:/WireGuard/wireguard.exe' });
    const open = vi.spyOn(service, 'vpnWireguardOpen');
    renderCard(service);
    const button = await screen.findByRole('button', { name: 'Abrir WireGuard' });
    fireEvent.click(button);
    await waitFor(() => expect(open).toHaveBeenCalled());
  });
});
