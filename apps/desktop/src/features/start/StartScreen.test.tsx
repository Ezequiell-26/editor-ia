// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StartScreen } from './StartScreen';
import { ProjectProvider } from '../../state/project-store';
import { AppearanceProvider } from '../../state/AppearanceProvider';
import { createFakeService } from '../../test/fake-service';

function renderStartScreen(onEnterApp = vi.fn(), injectedService?: ReturnType<typeof createFakeService>) {
  const service = injectedService ?? createFakeService();
  const result = render(
    <AppearanceProvider>
      <ProjectProvider service={service}>
        <StartScreen onEnterApp={onEnterApp} />
      </ProjectProvider>
    </AppearanceProvider>,
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
    expect(screen.getByText('Olyvia')).toBeTruthy();
    expect(screen.getByText('Creation Studio')).toBeTruthy();

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
    expect(screen.getByRole('heading', { name: /Actualizador de Olyvia/i })).toBeTruthy();
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

describe('StartScreen · Ajustes en ventana flotante', () => {
  it('abre la configuración ahí mismo sin entrar al editor', async () => {
    const { onEnterApp } = renderStartScreen();
    fireEvent.click(screen.getByRole('button', { name: 'Ajustes' }));

    expect(await screen.findByRole('dialog', { name: 'Configuración' })).toBeTruthy();
    expect(onEnterApp).not.toHaveBeenCalled();

    // SettingsHome se carga en diferido: con la suite completa compitiendo por
    // CPU el chunk puede tardar más que el timeout por defecto de 1 s.
    const sections = await screen.findByRole(
      'navigation',
      { name: /Secciones de Ajustes/i },
      { timeout: 5000 },
    );
    fireEvent.click(within(sections).getByRole('button', { name: /Herramientas/i }));
    expect(
      await screen.findByRole('heading', { name: 'Herramientas', level: 2 }, { timeout: 5000 }),
    ).toBeTruthy();
  });
});

describe('StartScreen · portada de proyectos recientes', () => {
  it('muestra la imagen del proyecto guardado', async () => {
    window.localStorage.setItem(
      'editoria.recent.v1',
      JSON.stringify([
        {
          path: 'C:\tester\proyecto.editoria.json',
          label: 'proyecto.editoria.json',
          name: 'Proyecto con portada',
          openedAt: new Date().toISOString(),
        },
      ]),
    );
    const { container } = renderStartScreen();
    expect(await screen.findByText('Proyecto con portada')).toBeTruthy();
    await waitFor(() => {
      const image = container.querySelector('.start-thumb-image');
      expect(image?.getAttribute('src')).toMatch(/^data:image/);
    });
  });

  it('muestra la inicial del proyecto cuando todavía no tiene visuales', async () => {
    window.localStorage.setItem(
      'editoria.recent.v1',
      JSON.stringify([
        {
          path: 'C:\\tester\\vacio.editoria.json',
          label: 'vacio.editoria.json',
          name: 'Proyecto 22 oct',
          openedAt: new Date().toISOString(),
        },
      ]),
    );
    const service = {
      ...createFakeService(),
      recentProjectThumbnail: async () => null,
    };
    const { container } = renderStartScreen(vi.fn(), service);

    expect(await screen.findByText('Proyecto 22 oct')).toBeTruthy();
    expect(container.querySelector('.start-thumb-image')).toBeNull();
    expect(container.querySelector('.start-thumb-initial')?.textContent).toBe('P');
    expect(screen.getByText('Sin vista previa')).toBeTruthy();
  });
});
