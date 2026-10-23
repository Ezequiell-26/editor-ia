// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StartScreen } from './StartScreen';
import { ProjectProvider } from '../../state/project-store';
import { createFakeService } from '../../test/fake-service';

function renderStartScreen(onEnterApp = vi.fn()) {
  const service = createFakeService();
  const result = render(
    <ProjectProvider service={service}>
      <StartScreen onEnterApp={onEnterApp} />
    </ProjectProvider>,
  );
  return { ...result, service, onEnterApp };
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('StartScreen · Lanzador estilo CapCut con Actualizador', () => {
  it('muestra la tarjeta principal Crear proyecto, plantillas y herramientas IA', () => {
    renderStartScreen();

    // Título y branding de la ventana compacta
    expect(screen.getByText('Montaje')).toBeTruthy();
    expect(screen.getByText('Editor IA Local')).toBeTruthy();

    // Botón de versión y actualizador
    expect(screen.getByRole('button', { name: /actualizador/i })).toBeTruthy();

    // Tarjeta hero "Crear proyecto"
    expect(screen.getByRole('button', { name: /Crear proyecto/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Abrir proyecto/i })).toBeTruthy();

    // Plantillas rápidas 1-clic
    expect(screen.getByRole('button', { name: /TikTok \/ Reels/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /YouTube 60fps/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Instagram Feed/i })).toBeTruthy();

    // Atajos de herramientas rápidas
    expect(screen.getByRole('button', { name: /Director IA/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Guion IA/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Locución/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Quitar fondo/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Upscale 4K/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Comprimir/i })).toBeTruthy();
  });

  it('crea un proyecto al instante con 1-clic usando una plantilla rápida', async () => {
    const { onEnterApp } = renderStartScreen();

    const tiktokBtn = screen.getByRole('button', { name: /TikTok \/ Reels/i });
    fireEvent.click(tiktokBtn);

    await waitFor(
      () => {
        expect(onEnterApp).toHaveBeenCalledWith('editor');
      },
      { timeout: 2000 },
    );
  });

  it('abre el diálogo de creación al hacer clic en Crear proyecto con nombre por defecto', async () => {
    const { onEnterApp } = renderStartScreen();

    const createBtn = screen.getByRole('button', { name: /Crear proyecto/i });
    fireEvent.click(createBtn);

    // Diálogo modal abierto
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Nuevo proyecto/i })).toBeTruthy();

    // Campo de texto con nombre sugerido
    const input = screen.getByPlaceholderText('Ej: Video para YouTube') as HTMLInputElement;
    expect(input.value).toMatch(/Proyecto \d+/);

    // Formatos visuales disponibles
    expect(screen.getByRole('button', { name: /16:9 horizontal/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /9:16 vertical/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /1:1 cuadrado/i })).toBeTruthy();

    // Presionar el botón de crear y entrar
    const submitBtn = screen.getByRole('button', { name: /Crear y entrar al editor/i });
    fireEvent.click(submitBtn);

    await waitFor(
      () => {
        expect(onEnterApp).toHaveBeenCalledWith('editor');
      },
      { timeout: 2000 },
    );
  });

  it('abre el actualizador de la app al pulsar el botón de versión o actualizaciones', async () => {
    renderStartScreen();

    const updaterBtn = screen.getByRole('button', { name: /actualizador/i });
    fireEvent.click(updaterBtn);

    // Modal del actualizador visible
    expect(screen.getByRole('heading', { name: /Actualizador de Montaje/i })).toBeTruthy();
    expect(screen.getByText(/Versión instalada:/i)).toBeTruthy();
  });

  it('navega directamente a la herramienta al hacer clic en una herramienta rápida', async () => {
    const { onEnterApp } = renderStartScreen();

    const directorBtn = screen.getByRole('button', { name: /Director IA/i });
    fireEvent.click(directorBtn);

    await waitFor(
      () => {
        expect(onEnterApp).toHaveBeenCalledWith('director');
      },
      { timeout: 1000 },
    );
  });
});
