// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectProvider } from '../../state/project-store';
import { createFakeService } from '../../test/fake-service';
import type { PluginInfo } from '../../services/project-service';
import { PluginsCard } from './PluginsCard';

afterEach(cleanup);

const OFFICIAL: PluginInfo = {
  id: 'limpieza-rapida',
  name: 'Limpieza rápida',
  version: '1.0.0',
  description: 'Deja el video listo.',
  author: 'Olyvia',
  official: true,
  kind: 'plugin',
  mcp: null,
  enabled: true,
  directory: 'C:/plugins/limpieza-rapida',
  error: null,
  presets: { effects: [], exportProfiles: [], captionStyles: [] },
  commands: [{ id: 'limpiar', label: 'Limpiar el video completo', steps: ['limpiá el video'] }],
};

const CUSTOM: PluginInfo = {
  ...OFFICIAL,
  id: 'mi-plugin',
  name: 'Mi plugin',
  official: false,
  enabled: false,
  commands: [],
};

describe('tarjeta de plugins', () => {
  it('lista oficiales y de usuario, y distingue los oficiales', async () => {
    const service = createFakeService();
    service.listPlugins = async () => [OFFICIAL, CUSTOM];
    render(
      <ProjectProvider service={service}>
        <PluginsCard />
      </ProjectProvider>,
    );
    expect(await screen.findByText(/Limpieza rápida/)).toBeTruthy();
    expect(screen.getByText('oficial')).toBeTruthy();
    expect(screen.getByText(/Mi plugin/)).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Quitar' })).toHaveLength(1);
  });

  it('activa y desactiva un plugin', async () => {
    const service = createFakeService();
    service.listPlugins = async () => [OFFICIAL];
    const toggle = vi.spyOn(service, 'setPluginEnabled').mockResolvedValue(undefined);
    render(
      <ProjectProvider service={service}>
        <PluginsCard />
      </ProjectProvider>,
    );
    fireEvent.click(await screen.findByLabelText('Activar Limpieza rápida'));
    await waitFor(() => expect(toggle).toHaveBeenCalledWith('limpieza-rapida', false));
  });

  it('ejecuta un comando de plugin con el puente del asistente', async () => {
    const service = createFakeService();
    service.listPlugins = async () => [OFFICIAL];
    const received: string[] = [];
    const listener = (event: Event): void => {
      received.push((event as CustomEvent<{ text: string }>).detail.text);
    };
    window.addEventListener('olyvia:run-command', listener);
    render(
      <ProjectProvider service={service}>
        <PluginsCard />
      </ProjectProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Limpiar el video completo' }));
    await waitFor(() => expect(received).toContain('limpiá el video'));
    window.removeEventListener('olyvia:run-command', listener);
  });

  it('muestra la respuesta del operador junto al comando', async () => {
    const service = createFakeService();
    service.listPlugins = async () => [OFFICIAL];
    const listener = (event: Event): void => {
      const detail = (event as CustomEvent<{ onResult?: (reply: string) => void }>).detail;
      detail.onResult?.('Listo: video limpio y subtitulado.');
    };
    window.addEventListener('olyvia:run-command', listener);
    render(
      <ProjectProvider service={service}>
        <PluginsCard />
      </ProjectProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Limpiar el video completo' }));
    expect(await screen.findByText('Ejecutando…')).toBeTruthy();
    expect(
      await screen.findByText('Listo: video limpio y subtitulado.'),
    ).toBeTruthy();
    window.removeEventListener('olyvia:run-command', listener);
  });

  it('instala desde una carpeta y avisa', async () => {
    const service = createFakeService();
    service.listPlugins = async () => [];
    const install = vi.spyOn(service, 'installPlugin').mockResolvedValue(CUSTOM);
    render(
      <ProjectProvider service={service}>
        <PluginsCard />
      </ProjectProvider>,
    );
    fireEvent.change(await screen.findByLabelText(/Instalar desde una carpeta/), {
      target: { value: 'C:/MisPlugins/mi-plugin' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Instalar' }));
    await waitFor(() => expect(install).toHaveBeenCalledWith('C:/MisPlugins/mi-plugin'));
  });
});
