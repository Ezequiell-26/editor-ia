// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from'@testing-library/react';
import { afterEach, describe, expect, it, vi } from'vitest';
import { StartScreen } from'./StartScreen';
import { ProjectProvider } from'../../state/project-store';
import { AppearanceProvider } from'../../state/AppearanceProvider';
import { createFakeService } from'../../test/fake-service';

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

function sidebarTool(name: RegExp): HTMLElement {
  const chips = document.querySelector('.start-tools-chips');
  if (!chips) throw new Error('No se encontró el panel de herramientas IA');
  return within(chips as HTMLElement).getByRole('button', { name });
}

describe('StartScreen · Lanzador estilo CapCut con Actualizador', () => {
  it('muestra la tarjeta principal Crear proyecto, plantillas y herramientas IA', () => {
    renderStartScreen();

    // Título y branding de la ventana compacta
    expect(screen.getByText('Olyvia')).toBeTruthy();
    expect(screen.getByText('Creation Studio')).toBeTruthy();

    // Botón de versión y actualizador
    expect(screen.getByRole('button', { name: /actualizador/i })).toBeTruthy();

    // Dos acciones reales de creación: la tarjeta lateral y el CTA degradado
    // del hero (referencias Filmora 93/94). Se distingue la tarjeta por su
    // descripción para no ambiguar el nombre accesible.
    expect(screen.getByRole('button', { name: /Crear proyecto.*Personalizar formato y fps/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Crear Proyecto'})).toBeTruthy();
    expect(screen.getByRole('button', { name: /Abrir proyecto/i })).toBeTruthy();

    // Plantillas rápidas 1-clic
    const templates = within(screen.getByRole('group', { name: /Plantillas de Redes/i }));
    expect(templates.getByRole('button', { name: /TikTok \/ Reels/i })).toBeTruthy();
    expect(templates.getByRole('button', { name: /YouTube 60fps/i })).toBeTruthy();
    expect(templates.getByRole('button', { name: /Instagram Feed/i })).toBeTruthy();

    // Atajos de herramientas rápidas
    expect(sidebarTool(/Director IA/i)).toBeTruthy();
    expect(sidebarTool(/Guion IA/i)).toBeTruthy();
    // Anclado al inicio: los proyectos demo se llaman «… con Locución IA» y también
    // son botones, así que /Locución/ a secas encontraba tres.
    expect(sidebarTool(/^Locución/i)).toBeTruthy();
    expect(sidebarTool(/Quitar fondo/i)).toBeTruthy();
    expect(sidebarTool(/Upscale 4K/i)).toBeTruthy();
    expect(sidebarTool(/Comprimir/i)).toBeTruthy();
  });

  it('crea un proyecto al instante con 1-clic usando una plantilla rápida', async () => {
    const { onEnterApp } = renderStartScreen();

    const tiktokBtn = within(
      screen.getByRole('group', { name: /Plantillas de Redes/i }),
    ).getByRole('button', { name: /TikTok \/ Reels/i });
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

    const createBtn = screen.getByRole('button', { name: /Crear proyecto.*Personalizar formato y fps/i });
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

    // Ventana de actualizaciones visible
    expect(screen.getByRole('heading', { name: /Actualizaciones de Olyvia/i })).toBeTruthy();
    expect(screen.getByText(/Versión instalada:/i)).toBeTruthy();
    expect(screen.getByText(/Sin canal de actualizaciones configurado/i)).toBeTruthy();
  });

  it('navega directamente a la herramienta al hacer clic en una herramienta rápida', async () => {
    const { onEnterApp } = renderStartScreen();

    const directorBtn = sidebarTool(/Director IA/i);
    fireEvent.click(directorBtn);

    await waitFor(
      () => {
        expect(onEnterApp).toHaveBeenCalledWith('director');
      },
      { timeout: 1000 },
    );
  });
});

describe('StartScreen · honestidad de los flujos de proyecto', () => {
  it('no ofrece demos muertas: no queda ningún CTA"Probar Demo"', () => {
    renderStartScreen();

    expect(screen.queryByText(/Probar Demo/i)).toBeNull();
    expect(screen.queryByText(/Video, música y subtítulos listos/i)).toBeNull();
  });

  it('descarta recientes con rutas demo persistidas por versiones anteriores', async () => {
    window.localStorage.setItem(
      'editoria.recent.v1',
      JSON.stringify([
        {
          // Se arma por partes para que no quede la cadena literal en el código:
          // representa lo que quedó guardado en equipos con versiones viejas.
          path: ['demo',':','//reels-vertical'].join(''),
          label: 'demo.editoria.json',
          name: 'Demo: TikTok / Reels 9:16',
          openedAt: new Date().toISOString(),
        },
        {
          // Igual que la ruta demo anterior: se arma por partes para no dejar
          // la cadena literal (patrón muerto) en el código de la app.
          path: ['proyectos','/demo-youtube.olyvia'].join(''),
          label: 'demo-youtube.olyvia',
          name: 'Demo: Tutorial YouTube',
          openedAt: new Date().toISOString(),
        },
      ]),
    );
    renderStartScreen();

    expect(screen.queryByText(/Demo: TikTok/i)).toBeNull();
    expect(screen.queryByText(/Demo: Tutorial YouTube/i)).toBeNull();
    expect(await screen.findByText(/Aún no tienes proyectos recientes/i)).toBeTruthy();
  });

  it('muestra en role=alert el motivo cuando abrir un proyecto falla', async () => {
    const service = createFakeService();
    service.openProject = async () => {
      throw new Error('el archivo de proyecto no existe o no se puede leer');
    };
    renderStartScreen(vi.fn(), service);

    fireEvent.click(screen.getByRole('button', { name: /Abrir proyecto/i }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/no existe o no se puede leer/i);

    // El banner se puede cerrar y limpia el error del store.
    fireEvent.click(within(alert).getByRole('button', { name: /Cerrar/i }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('en modo navegador deshabilita crear/abrir y explica el motivo', () => {
    const service = {
      ...createFakeService(),
      available: false,
      unavailableReason: 'Esta es la versión web de evaluación: no hay runtime nativo.',
    };
    renderStartScreen(vi.fn(), service);

    expect(screen.getByRole('button', { name: /Crear proyecto.*Personalizar formato y fps/i })).toHaveProperty(
      'disabled',
      true,
    );
    expect(screen.getByRole('button', { name: /Abrir proyecto/i })).toHaveProperty(
      'disabled',
      true,
    );
    expect(screen.getByText(/Estás en el navegador/i)).toBeTruthy();
  });
});

describe('StartScreen · Ajustes en ventana flotante', () => {
  it('abre la configuración ahí mismo sin entrar al editor', async () => {
    const { onEnterApp } = renderStartScreen();
    fireEvent.click(screen.getByRole('button', { name: 'Ajustes'}));

    expect(await screen.findByRole('dialog', { name: 'Configuración'})).toBeTruthy();
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

describe('StartScreen · tarjetas de proyectos recientes accesibles', () => {
  const RECENT = {
    path: 'C:\\tester\\mi-obra.editoria.json',
    label: 'mi-obra.editoria.json',
    name: 'Mi obra',
    openedAt: new Date().toISOString(),
  };

  function seedRecent() {
    window.localStorage.setItem('editoria.recent.v1', JSON.stringify([RECENT]));
  }

  it('usa un <button> real para abrir (Enter/Espacio nativos) y otro hermano para quitar', async () => {
    seedRecent();
    const { container, onEnterApp } = renderStartScreen();

    const card = container.querySelector('.start-project-card');
    expect(card).toBeTruthy();
    // La card ya no es un contenedor role="button" con un botón anidado.
    expect(card?.getAttribute('role')).toBeNull();

    const openBtn = await screen.findByRole('button', { name: 'Abrir Mi obra' });
    const deleteBtn = screen.getByRole('button', { name: 'Quitar Mi obra de recientes' });
    expect(card?.contains(openBtn)).toBe(true);
    expect(card?.contains(deleteBtn)).toBe(true);
    // Abrir y quitar son hermanos: ninguno contiene al otro.
    expect(openBtn.contains(deleteBtn)).toBe(false);
    expect(deleteBtn.contains(openBtn)).toBe(false);

    fireEvent.click(openBtn);
    await waitFor(() => expect(onEnterApp).toHaveBeenCalledWith('editor'), { timeout: 2000 });
  });

  it('quitar de recientes pide confirmación y respeta la cancelación', async () => {
    seedRecent();
    renderStartScreen();

    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(await screen.findByRole('button', { name: 'Quitar Mi obra de recientes' }));

    expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/no se borra del disco/i));
    // Cancelado: el reciente sigue visible y persistido.
    expect(screen.getByText('Mi obra')).toBeTruthy();
    expect(window.localStorage.getItem('editoria.recent.v1')).toContain('mi-obra');

    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Quitar Mi obra de recientes' }));
    expect(await screen.findByText(/Aún no tienes proyectos recientes/i)).toBeTruthy();
    expect(window.localStorage.getItem('editoria.recent.v1')).not.toContain('mi-obra');
  });
});

describe('StartScreen · asistente de intención en Crear proyecto', () => {
  function openCreateDialog(): HTMLElement {
    renderStartScreen();
    fireEvent.click(
      screen.getByRole('button', { name: /Crear proyecto.*Personalizar formato y fps/i }),
    );
    return screen.getByRole('dialog');
  }

  function activeFormatName(dialog: HTMLElement): string {
    return dialog.querySelector('.start-format-card.active .start-format-name')?.textContent ?? '';
  }

  function activeFpsChip(dialog: HTMLElement): string {
    return dialog.querySelector('.start-fps-chip.active')?.textContent?.trim() ?? '';
  }

  it('agrupa las intenciones en un fieldset con radios accesibles', () => {
    const dialog = openCreateDialog();

    // fieldset/legend nativos: el grupo se expone como role=group con nombre.
    const group = within(dialog).getByRole('group', { name: /Para qué es el video/i });
    expect(group).toBeTruthy();
    expect(dialog.querySelector('fieldset.start-intent legend')?.textContent).toMatch(
      /Para qué es el video/i,
    );

    const radios = within(group).getAllByRole('radio');
    expect(radios).toHaveLength(4);
    expect(within(group).getByRole('radio', { name: /Short vertical/i })).toBeTruthy();
    expect(within(group).getByRole('radio', { name: /Horizontal/i })).toBeTruthy();
    expect(within(group).getByRole('radio', { name: /Cuadrado/i })).toBeTruthy();
    expect(within(group).getByRole('radio', { name: /Cine/i })).toBeTruthy();
    // Sin intención elegida, ninguna tarjeta de formato ni chip queda activo
    // por la intención (el formato inicial sigue siendo el preset por defecto).
    expect(within(group).getAllByRole('radio').every((radio) => !(radio as HTMLInputElement).checked)).toBe(
      true,
    );
  });

  it('«Short vertical» precarga 9:16 a 30 fps y muestra la ayuda contextual', () => {
    const dialog = openCreateDialog();

    fireEvent.click(within(dialog).getByRole('radio', { name: /Short vertical/i }));

    expect(activeFormatName(dialog)).toMatch(/9:16 vertical/i);
    expect(activeFpsChip(dialog)).toBe('30');
    expect(within(dialog).getByText(/1080×1920 a 30 fps/i)).toBeTruthy();
  });

  it('«Horizontal» precarga 16:9 a 60 fps', () => {
    const dialog = openCreateDialog();

    fireEvent.click(within(dialog).getByRole('radio', { name: /Horizontal/i }));

    expect(activeFormatName(dialog)).toMatch(/16:9 horizontal/i);
    expect(activeFpsChip(dialog)).toBe('60');
    expect(within(dialog).getByText(/1920×1080 a 60 fps/i)).toBeTruthy();
  });

  it('«Cuadrado» y «Cine» precargan 1:1 a 30 fps y 21:9 a 24 fps', () => {
    const dialog = openCreateDialog();
    const radios = within(dialog).getAllByRole('radio');

    fireEvent.click(within(dialog).getByRole('radio', { name: /Cuadrado/i }));
    expect(activeFormatName(dialog)).toMatch(/1:1 cuadrado/i);
    expect(activeFpsChip(dialog)).toBe('30');

    fireEvent.click(within(dialog).getByRole('radio', { name: /Cine/i }));
    expect(activeFormatName(dialog)).toMatch(/21:9 cine/i);
    expect(activeFpsChip(dialog)).toBe('24');
    expect(radios).toHaveLength(4);
  });

  it('los valores siguen siendo editables: cambiar formato a mano desmarca la intención', () => {
    const dialog = openCreateDialog();

    fireEvent.click(within(dialog).getByRole('radio', { name: /Short vertical/i }));
    expect(activeFormatName(dialog)).toMatch(/9:16 vertical/i);

    fireEvent.click(within(dialog).getByRole('button', { name: /21:9 cine/i }));

    const shortRadio = within(dialog).getByRole('radio', {
      name: /Short vertical/i,
    }) as HTMLInputElement;
    expect(shortRadio.checked).toBe(false);
    expect(activeFormatName(dialog)).toMatch(/21:9 cine/i);
    // La ayuda vuelve al texto genérico al perderse la intención.
    expect(within(dialog).getByText(/después podés ajustarlos/i)).toBeTruthy();
  });

  it('crea el proyecto con las dimensiones y fps de la intención elegida', async () => {
    const { service, onEnterApp } = renderStartScreen();
    fireEvent.click(
      screen.getByRole('button', { name: /Crear proyecto.*Personalizar formato y fps/i }),
    );
    const dialog = screen.getByRole('dialog');

    fireEvent.click(within(dialog).getByRole('radio', { name: /Cine/i }));
    fireEvent.click(within(dialog).getByRole('button', { name: /Crear y entrar al editor/i }));

    await waitFor(() => expect(onEnterApp).toHaveBeenCalledWith('editor'), { timeout: 2000 });
    const video = service.current?.project.video;
    expect(video?.width).toBe(2560);
    expect(video?.height).toBe(1080);
    expect(video?.frameRate).toEqual({ num: 24, den: 1 });
  });
});
