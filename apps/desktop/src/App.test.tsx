// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyProject } from '@editor-ia/project-schema';
import type { Asset, Scene } from '@editor-ia/project-schema';
import { App } from './App';
import { createFakeService, readyAsset } from './test/fake-service';
import { addAsset, addClipFromAsset, addTrack, ensureDelivery, updateClip } from './state/project-actions';
import { addMarker } from './state/markers';

function renderApp() {
  const service = createFakeService();
  render(<App service={service} />);
  return service;
}

function nav(label: string): void {
  fireEvent.click(
    within(screen.getByRole('navigation', { name: /vistas/i })).getByRole('button', { name: label }),
  );
}

async function createProject(name = 'Obra de prueba'): Promise<void> {
  nav('Proyectos');
  const input = within(screen.getByRole('main')).getByRole('textbox', { name: /nombre/i });
  fireEvent.change(input, { target: { value: name } });
  fireEvent.click(screen.getByRole('button', { name: /Crear y elegir ubicación/i }));
  await waitFor(
    () => {
      expect(screen.getByRole('main').textContent).toContain(name);
    },
    { timeout: 5000 },
  );
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('shell de Editor IA', () => {
  it('usa toda la pantalla con menús profesionales y un rail de iconos sin marca', () => {
    renderApp();
    const banner = screen.getByRole('banner');
    expect(within(banner).queryByRole('heading', { level: 1 })).toBeNull();
    expect(banner.textContent).not.toMatch(/Editor IA/);
    for (const menu of ['Archivo', 'Editar', 'Ver', 'Reproducción', 'Herramientas', 'Ayuda']) {
      expect(within(banner).getByRole('button', { name: menu })).toBeTruthy();
    }
    const navigation = screen.getByRole('navigation', { name: /vistas/i });
    expect(
      [...navigation.querySelectorAll('ul button')].map((button) => button.getAttribute('aria-label')),
    ).toEqual([
      'Inicio',
      'Proyectos',
      'Guion',
      'Medios',
      'Producción',
      'Editor',
      'Descargar',
      'Director',
      'Fábrica',
      'Cumplimiento',
      'Convertir',
      'Comparar',
      'Comprimir',
      'Denoise',
      'Miniaturas',
      'Localización',
      'AI Hub',
      'Efectos',
      'Fondo',
      'Upscale',
      'MCP',
      'Aprender',
      'Ajustes',
    ]);
    // Un separador al entrar a herramientas y otro al entrar a ayuda; no uno
    // delante de cada herramienta.
    expect(navigation.querySelectorAll('.nav-separator')).toHaveLength(2);
    expect(
      within(navigation).getByRole('button', { name: /Inicio/ }).getAttribute('aria-current'),
    ).toBe('page');
    expect(
      within(navigation).getByRole('button', { name: /Inicio/ }).getAttribute('data-tooltip'),
    ).toMatch(/Estado del estudio/i);
  });

  it('abre en Inicio con la preparación y la extensión listas para configurar', async () => {
    renderApp();
    const main = screen.getByRole('main');
    await waitFor(() => expect(main.textContent).toContain('Preparación del estudio'));
    expect(main.textContent).toContain('Extensión de Chrome / Edge');
    expect(main.textContent).toContain('Motor de descargas');
    expect(main.textContent).toContain('FFmpeg');
    fireEvent.click(within(main).getByRole('button', { name: /Nuevo proyecto/i }));
    await waitFor(() => expect(screen.getByRole('main').textContent).toContain('Crear un proyecto'));
  });

  it('abre los menús y ejecuta acciones reales', async () => {
    const service = renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'Archivo' }));
    expect(screen.getByRole('menuitem', { name: /Abrir proyecto/i })).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: /Abrir proyecto/i }));
    await waitFor(() => expect(service.calls.open).toBe(1));
    fireEvent.click(screen.getByRole('button', { name: 'Ver' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Ajustes' }));
    // Ajustes se abre como ventana flotante, no como vista de `main`.
    const dialog = await screen.findByRole('dialog', { name: 'Configuración' }, { timeout: 5000 });
    await waitFor(() => expect(dialog.textContent).toContain('Apariencia'), { timeout: 5000 });
  });

  it('empaqueta el proyecto desde Archivo y avisa dónde quedó el ZIP', async () => {
    const service = renderApp();
    await createProject('Obra empaquetada');
    fireEvent.click(screen.getByRole('button', { name: 'Archivo' }));
    const item = screen.getByRole('menuitem', { name: /Empaquetar proyecto/i });
    fireEvent.click(item);
    await waitFor(() => expect(service.deliveries).toHaveLength(1), { timeout: 5000 });
    expect(service.deliveries[0]?.fileName).toBe('obra-empaquetada-paquete.zip');
    expect(service.deliveries[0]?.bytes.byteLength).toBeGreaterThan(100);
    await waitFor(() =>
      expect(screen.getByText(/Paquete de entrega guardado en/i)).toBeTruthy(),
    );
  });

  it('abre el descargador, analiza una URL y la importa con el servicio simulado', async () => {
    renderApp();
    await createProject('Obra descarga');
    nav('Descargar');
    const main = screen.getByRole('main');
    await waitFor(() => expect(main.textContent).toContain('Motor de descargas'));
    await waitFor(() => expect(main.textContent).toContain('Copiar conexión'));
    const url = within(main).getByRole('textbox', { name: /URL para descargar/i });
    fireEvent.change(url, { target: { value: 'https://example.com/video' } });
    fireEvent.click(within(main).getByRole('button', { name: /Analizar/i }));
    await waitFor(() => expect(screen.getByRole('main').textContent).toContain('Video de prueba'));
    expect(screen.getByRole('main').textContent).toContain('4320p · 8K');
    const quality = within(main).getByLabelText(/Calidad a descargar/i) as HTMLSelectElement;
    expect(quality.value).toBe('best');
    expect(within(quality).getByRole('option', { name: /Mínima disponible/i })).toBeTruthy();
    fireEvent.change(quality, { target: { value: 'worst' } });
    expect(quality.value).toBe('worst');
    fireEvent.click(screen.getByRole('checkbox', { name: /Tengo derechos/i }));
    fireEvent.click(screen.getByRole('button', { name: /Descargar e importar/i }));
    await waitFor(() => expect(screen.getByRole('main').textContent).toContain('Ver 1 archivo(s) en Medios'));
    expect(screen.getByRole('main').textContent).toContain('video.mp4');
  });

  it('descarga sin proyecto y deja el archivo en la carpeta de descargas', async () => {
    const service = renderApp();
    nav('Descargar');
    const main = screen.getByRole('main');
    await waitFor(() =>
      expect(within(main).getByRole('textbox', { name: /URL para descargar/i })).toBeTruthy(),
    );
    const url = within(main).getByRole('textbox', { name: /URL para descargar/i });
    fireEvent.change(url, { target: { value: 'https://example.com/video' } });
    fireEvent.click(within(main).getByRole('button', { name: /Analizar/i }));
    await waitFor(() => expect(main.textContent).toContain('Video de prueba'));
    expect(main.textContent).toContain('No necesitás un proyecto para descargar');
    fireEvent.click(within(main).getByRole('checkbox', { name: /Tengo derechos/i }));
    const download = within(main).getByRole('button', {
      name: /Descargar a la biblioteca/i,
    });
    expect((download as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(download);
    await waitFor(() => expect(main.textContent).toContain('video.mp4'));
    expect(main.textContent).toMatch(/Descargas|downloads/i);
    expect(main.textContent).not.toContain('Ver 1 archivo(s) en Medios');
    expect(service.calls.import).toBe(0);
  });

  it('permite elegir carpeta y disco antes de descargar', async () => {
    window.localStorage.clear();
    const service = renderApp();
    nav('Descargar');
    const main = screen.getByRole('main');
    await waitFor(() => expect(main.textContent).toContain('Guardar en'));
    expect(main.textContent).toContain('Predeterminada');
    fireEvent.click(within(main).getByRole('button', { name: /Elegir carpeta/i }));
    await waitFor(() => expect(main.textContent).toContain('D:\\Videos descargados'));
    const url = within(main).getByRole('textbox', { name: /URL para descargar/i });
    fireEvent.change(url, { target: { value: 'https://example.com/video' } });
    fireEvent.click(within(main).getByRole('button', { name: /Analizar/i }));
    await waitFor(() => expect(main.textContent).toContain('Video de prueba'));
    fireEvent.click(within(main).getByRole('checkbox', { name: /Tengo derechos/i }));
    fireEvent.click(within(main).getByRole('button', { name: /Descargar a la biblioteca/i }));
    await waitFor(() => expect(service.calls.destination).toBe('D:\\Videos descargados'));
    expect(window.localStorage.getItem('editor-ia.download-dir.v1')).toBe('D:\\Videos descargados');
    fireEvent.click(within(main).getByRole('button', { name: /Usar predeterminada/i }));
    await waitFor(() =>
      expect(
        within(main).queryByRole('button', { name: /Usar predeterminada/i }),
      ).toBeNull(),
    );
    expect(window.localStorage.getItem('editor-ia.download-dir.v1')).toBeNull();
    window.localStorage.clear();
  });

  it('acepta un enlace de YouTube sin https desde Proyectos y lo deja listo sin proyecto', async () => {
    renderApp();
    const quick = screen.getByRole('textbox', { name: /URL para descargar/i });
    fireEvent.change(quick, { target: { value: 'youtube.com/watch?v=abc123' } });
    const quickForm = quick.closest('form');
    if (!quickForm) throw new Error('se esperaba el formulario de descarga rápida');
    fireEvent.click(within(quickForm).getByRole('button', { name: /^Descargar$/i }));
    await waitFor(() => expect(screen.getByRole('main').textContent).toContain('Video de prueba'));
    expect(
      (screen.getByRole('textbox', { name: /URL para descargar/i }) as HTMLInputElement).value,
    ).toBe('https://youtube.com/watch?v=abc123');
    expect(screen.getByRole('main').textContent).toMatch(/No necesitás un proyecto para descargar/);
    expect(screen.getByRole('main').textContent).toMatch(/Descargas\/Videos descargados/);
  });

  it('pega una URL en Proyectos y abre Descargar con el análisis listo', async () => {
    renderApp();
    await createProject('Obra URL rápida');
    nav('Proyectos');
    const quick = screen.getByRole('textbox', { name: /URL para descargar/i });
    fireEvent.change(quick, { target: { value: 'https://example.com/reel' } });
    const quickForm = quick.closest('form');
    if (!quickForm) throw new Error('se esperaba el formulario de descarga rápida');
    fireEvent.click(within(quickForm).getByRole('button', { name: /^Descargar$/i }));
    await waitFor(() => expect(screen.getByRole('main').textContent).toContain('Video de prueba'));
    expect(
      (screen.getByRole('textbox', { name: /URL para descargar/i }) as HTMLInputElement).value,
    ).toBe('https://example.com/reel');
  });

  it('abre Denoise Studio y muestra el flujo de reducción de ruido', async () => {
    renderApp();
    nav('Denoise');
    const main = screen.getByRole('main');
    await waitFor(() =>
      expect(main.textContent).toContain('Reducir ruido en tiempo real'),
    );
    expect(main.textContent).toContain('Elegir video');
    expect(main.textContent).toContain('Elegir imagen');
  });

  it('abre Miniaturas y muestra el editor con plantillas', async () => {
    renderApp();
    nav('Miniaturas');
    const main = screen.getByRole('main');
    await waitFor(() =>
      expect(main.textContent).toContain('Miniaturas que se entienden en el feed'),
    );
    expect(main.textContent).toContain('Banda inferior');
    expect(main.textContent).toContain('Exportar PNG');
    expect(within(main).getByRole('button', { name: /Exportar PNG/i })).toBeTruthy();
  });

  it('abre Localización, lee subtítulos y muestra la traducción', async () => {
    renderApp();
    nav('Localización');
    const main = screen.getByRole('main');
    await waitFor(() => expect(main.textContent).toContain('Un video, ocho idiomas'));
    for (const language of ['Español', 'Inglés', 'Chino', 'Hindi', 'Árabe', 'Portugués', 'Bengalí', 'Ruso']) {
      expect(main.textContent).toContain(language);
    }
    await waitFor(() => expect(main.textContent).toContain('Proveedor simulado'));
    fireEvent.click(within(main).getByRole('button', { name: /Elegir subtítulos originales/i }));
    await waitFor(() => expect(main.textContent).toContain('demo.srt'));
    fireEvent.click(within(main).getByRole('button', { name: /Traducir a 1/i }));
    await waitFor(() => expect(main.textContent).toContain('EN: Hola subtítulo'));
    expect(main.textContent).toContain('Traducido con simulado');
    expect(
      (within(main).getByRole('button', { name: /Exportar SRT/i }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('dobla un video traducido y lo importa al proyecto', async () => {
    const service = renderApp();
    await createProject('Doblaje');
    nav('Medios');
    await waitFor(() =>
      expect(screen.getByRole('main').textContent).toMatch(/Confirmo que tengo derechos/i),
    );
    const assets = screen.getByRole('main');
    fireEvent.click(within(assets).getByRole('checkbox'));
    fireEvent.click(within(assets).getByRole('button', { name: /Importar medios/i }));
    await waitFor(() => expect(within(screen.getByRole('main')).getByText(/Toma de prueba/)).toBeTruthy());

    nav('Localización');
    const main = screen.getByRole('main');
    await waitFor(() => expect(main.textContent).toContain('Un video, ocho idiomas'));
    fireEvent.click(within(main).getByRole('button', { name: /Elegir subtítulos originales/i }));
    await waitFor(() => expect(main.textContent).toContain('demo.srt'));
    fireEvent.click(within(main).getByRole('button', { name: /Traducir a 1/i }));
    await waitFor(() => expect(main.textContent).toContain('EN: Hola subtítulo'));
    fireEvent.click(within(main).getByRole('button', { name: /Doblar video/i }));
    await waitFor(() =>
      expect(within(screen.getByRole('main')).getByRole('button', { name: /Importar al proyecto/i })).toBeTruthy(),
    );
    const importsBefore = service.calls.import;
    fireEvent.click(
      within(screen.getByRole('main')).getByRole('button', { name: /Importar al proyecto/i }),
    );
    await waitFor(() =>
      expect(
        within(screen.getByRole('main')).getByRole('button', { name: /Importado al proyecto/i }),
      ).toBeTruthy(),
    );
    expect(service.calls.import).toBe(importsBefore + 1);
    fireEvent.click(within(screen.getByRole('main')).getByRole('button', { name: /Ver en Medios/i }));
    await waitFor(() =>
      expect(screen.getByRole('main').textContent).toContain('Importar medios'),
    );
  });

  it('abre AI Hub y compone una skill con presupuesto de tokens', async () => {
    renderApp();
    await createProject('AI Hub');
    nav('AI Hub');
    const main = screen.getByRole('main');
    await waitFor(() =>
      expect(main.textContent).toContain('Skills compactas para no gastar tokens de más'),
    );
    expect(main.textContent).toContain('Gancho de 3 segundos');
    expect(main.textContent).toContain('Auditoría de retención');
    const briefBox = within(main).getByRole('textbox', { name: /Brief del video/i });
    fireEvent.change(briefBox, {
      target: { value: 'Un video corto sobre cómo ordenar una timeline sin perder tomas.' },
    });
    await waitFor(() =>
      expect(main.textContent).toContain('ordenar una timeline sin perder tomas'),
    );
    expect(main.textContent).toContain('Prompt ≈');
    expect(main.textContent).toContain('SALIDA:');
    fireEvent.click(within(main).getByRole('button', { name: /Usar brief en Guion/i }));
    await waitFor(() => {
      const scriptBrief = within(screen.getByRole('main')).getByRole('textbox', {
        name: /Qué video querés hacer/i,
      });
      expect((scriptBrief as HTMLTextAreaElement).value).toBe(
        'Un video corto sobre cómo ordenar una timeline sin perder tomas.',
      );
    });
  });

  it('abre Efectos y muestra presets, transiciones y auditoría', async () => {
    renderApp();
    await createProject('Visual');
    nav('Efectos');
    const main = screen.getByRole('main');
    await waitFor(() =>
      expect(main.textContent).toContain('El mismo look para varios clips'),
    );
    expect(main.textContent).toContain('Suave');
    expect(main.textContent).toContain('Noir');
    expect(main.textContent).toContain('Transición de entrada');
    expect(main.textContent).toContain('La timeline no tiene clips visuales');
    fireEvent.click(within(main).getByRole('button', { name: /Auditar/i }));
    await waitFor(() => expect(main.textContent).toContain('No hay problemas'));
  });

  it('sin runtime nativo avisa y deshabilita la creación', () => {
    render(<App />);
    nav('Proyectos');
    const main = screen.getByRole('main');
    expect(main.textContent).toMatch(/Abrí la app de escritorio/i);
    expect((within(main).getByRole('button', { name: /Crear y elegir ubicación/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('crea un proyecto, navega al editor y muestra una timeline honestamente vacía', async () => {
    const service = renderApp();
    await createProject('Corte vertical');
    expect(service.calls.create).toBe(1);
    const main = screen.getByRole('main');
    expect(main.textContent).toContain('Corte vertical');
    expect(main.textContent).toContain('Timeline vacía');
    expect(main.textContent).toContain('Exportar MP4');
    expect(main.textContent).toMatch(/Vista previa aproximada/i);
    expect(
      (within(main).getByRole('button', { name: /Exportar MP4/i }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(within(main).getByRole('button', { name: /Exportar MP4/i }).getAttribute('title')).toMatch(
      /Montá al menos un clip/i,
    );
  });

  it('abre y cierra los scopes de color de la preview', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    renderApp();
    await createProject('Obra scopes');
    const main = screen.getByRole('main');
    fireEvent.click(within(main).getByRole('button', { name: /Scopes de color/i }));
    expect(within(main).getByRole('region', { name: /Scopes de color/i })).toBeTruthy();
    fireEvent.click(within(main).getByRole('button', { name: /Cerrar scopes/i }));
    expect(within(main).queryByRole('region', { name: /Scopes de color/i })).toBeNull();
  });

  it('agrega y quita un marcador con M y lo refleja en la regla', async () => {
    renderApp();
    await createProject('Obra marcadores');
    const main = screen.getByRole('main');
    await waitFor(() => expect(main.textContent).toContain('Timeline'));

    fireEvent.keyDown(window, { key: 'm' });
    await waitFor(() =>
      expect(
        within(main).getByRole('button', { name: /Marcador Marcador 1/i }),
      ).toBeTruthy(),
    );

    fireEvent.keyDown(window, { key: 'm' });
    await waitFor(() =>
      expect(
        within(main).queryByRole('button', { name: /Marcador Marcador 1/i }),
      ).toBeNull(),
    );
  });

  it('permite apagar y volver a prender el snapping desde el imán', async () => {
    renderApp();
    await createProject('Obra imán');
    const main = screen.getByRole('main');
    const toggle = within(main).getByRole('button', {
      name: /Activar o desactivar snapping/i,
    });
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
  });

  it('carga un SRT desde el selector nativo y lo deja listo para importar', async () => {
    renderApp();
    await createProject('Obra subtítulos');
    const main = screen.getByRole('main');
    fireEvent.click(within(main).getByRole('button', { name: /Elegir archivo/i }));
    await waitFor(() =>
      expect(screen.getByDisplayValue(/Hola subtítulo/)).toBeTruthy(),
    );
    expect(screen.getByRole('textbox', { name: /cargá un archivo SRT/i })).toBeTruthy();
  });

  it('abre un proyecto existente y permite guardarlo', async () => {
    const service = renderApp();
    fireEvent.click(screen.getByRole('button', { name: /Abrir proyecto/i }));
    await waitFor(() => expect(screen.getByRole('main').textContent).toMatch(/Timeline vacía|Exportar MP4/));
    fireEvent.click(screen.getByRole('button', { name: /^Guardar$/ }));
    await waitFor(() => expect(service.calls.save).toBe(1));
    expect(screen.getByRole('contentinfo').textContent).toMatch(/Guardado/i);
  });

  it('declara un guardado fallido sin fingir éxito', async () => {
    const service = renderApp();
    await createProject('Obra con fallo');
    service.setSaveFailure('disco lleno');
    fireEvent.click(screen.getByRole('button', { name: /^Guardar$/ }));
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toMatch(/disco lleno/i);
    });
    expect(screen.getByRole('banner').textContent).not.toMatch(/Guardado/i);
  });

  it('deshace y rehace un cambio de pista', async () => {
    renderApp();
    await createProject('Obra undo');
    const main = screen.getByRole('main');
    expect(within(main).queryByText('V1')).toBeNull();
    fireEvent.click(within(main).getByRole('button', { name: /Agregar pista/i }));
    await waitFor(() => expect(within(screen.getByRole('main')).getByText('V1')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Deshacer/i }));
    await waitFor(() => expect(within(screen.getByRole('main')).queryByText('V1')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: /Rehacer/i }));
    await waitFor(() => expect(within(screen.getByRole('main')).getByText('V1')).toBeTruthy());
  });

  it('muestra el proveedor simulado y la lista de escenas en Guion', async () => {
    renderApp();
    await createProject('Obra guion');
    nav('Guion');
    await waitFor(() => expect(screen.getByRole('main').textContent).toContain('Brief'));
    await waitFor(() => expect(screen.getByRole('main').textContent).toContain('Simulado'));
    expect(screen.getByRole('main').textContent).toMatch(/No hay escenas|escena/i);
    expect(
      (within(screen.getByRole('main')).getByRole('button', { name: /Generar guion/i }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('Producción muestra el flujo de video automático y sus pasos', async () => {
    renderApp();
    await createProject('Obra producción');
    nav('Producción');
    const main = screen.getByRole('main');
    await waitFor(() => expect(main.textContent).toContain('Guion y escenas'));
    expect(main.textContent).toContain('Generar video automático');
    expect(main.textContent).toMatch(/Faltan escenas de guion/i);
  });

  it('Medios muestra la biblioteca vacía y el consentimiento de derechos', async () => {
    renderApp();
    await createProject('Obra medios');
    nav('Medios');
    const main = screen.getByRole('main');
    await waitFor(() => expect(main.textContent).toContain('No hay assets todavía'));
    expect(main.textContent).toMatch(/Confirmo que tengo derechos/i);
    expect(within(main).getByRole('button', { name: /Importar medios/i })).toBeTruthy();
  });

  it('Ajustes abre una ventana aparte con todas las secciones', async () => {
    renderApp();
    nav('Ajustes');
    const dialog = await screen.findByRole('dialog', { name: 'Configuración' });
    await waitFor(() => expect(dialog.textContent).toContain('FFmpeg'));
    expect(dialog.textContent).toMatch(/Render MP4 H\.264\/AAC/);
    expect(dialog.textContent).toMatch(/Remotion queda fuera/i);
    expect(dialog.textContent).toMatch(/Administrador de credenciales de Windows/i);
    const sections = within(dialog).getByRole('navigation', { name: /Secciones de Ajustes/i });
    expect(within(sections).getByRole('button', { name: /Apariencia/ })).toBeTruthy();
    const tools = within(sections).getByRole('button', { name: /Herramientas/ });
    fireEvent.click(tools);
    expect(tools.getAttribute('aria-current')).toBe('location');
    expect(within(dialog).getByRole('heading', { name: 'Herramientas', level: 2 })).toBeTruthy();
  });

  it('la ventana de Ajustes se cierra con Escape sin cambiar la vista de fondo', async () => {
    renderApp();
    nav('Inicio');
    const main = screen.getByRole('main');
    expect(main.textContent).toContain('Ruta de producción');
    nav('Ajustes');
    const dialog = await screen.findByRole('dialog', { name: 'Configuración' });
    expect(dialog).toBeTruthy();
    // El fondo sigue en Inicio: Ajustes no reemplaza la vista.
    expect(screen.getByRole('main').textContent).toContain('Ruta de producción');
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Configuración' })).toBeNull());
  });

  it('Cumplimiento muestra reglas por red y audita el proyecto', async () => {
    renderApp();
    await createProject('Obra reglas');
    nav('Cumplimiento');
    const main = screen.getByRole('main');
    await waitFor(() => expect(main.textContent).toContain('Auditoría de preflight'));
    expect(main.textContent).toContain('Riesgos de strike');
    expect(main.textContent).toContain('YouTube');
    expect(main.textContent).toContain('Derechos declarados');
    expect(main.textContent).toContain('preflight, no una garantía');
  });

  it('marca los medios de la preview como CORS para poder muestrear scopes', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    const service = createFakeService();
    const base = ensureDelivery(createEmptyProject('Obra scopes CORS', '2025-01-01T00:00:00Z'));
    const asset = readyAsset();
    const seeded = addClipFromAsset(addAsset(base, asset), asset, {}).project;
    const seededOpened = {
      project: seeded,
      label: 'scopes.editoria.json',
      path: 'C:\\tmp\\scopes.editoria.json',
      root: 'C:\\tmp',
    };
    service.createProject = async () => seededOpened;
    service.current = seededOpened;
    render(<App service={service} />);
    await createProject('Obra scopes CORS');
    const media = document.querySelector('.preview-media');
    expect(media?.getAttribute('crossorigin')).toBe('anonymous');
  });

  it('congela el frame en la pista desde el Inspector y corre el resto', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    const service = createFakeService();
    const base = ensureDelivery(createEmptyProject('Obra freeze', '2025-01-01T00:00:00Z'));
    const asset = readyAsset();
    const seeded = addClipFromAsset(addAsset(base, asset), asset, {
      atFrame: 0,
      durationFrames: 90,
    }).project;
    const seededOpened = {
      project: seeded,
      label: 'freeze.editoria.json',
      path: 'C:\\tmp\\freeze.editoria.json',
      root: 'C:\\tmp',
    };
    service.createProject = async () => seededOpened;
    service.current = seededOpened;
    render(<App service={service} />);
    await createProject('Obra freeze');
    const clip = document.querySelector('.timeline-clip.kind-video');
    expect(clip).toBeTruthy();
    fireEvent.keyDown(clip as Element, { key: 'Enter' });
    const button = await screen.findByRole('button', { name: /Congelar en la pista/i });
    fireEvent.click(button);
    await waitFor(() =>
      expect(document.querySelectorAll('.timeline-clip.kind-freeze').length).toBe(1),
    );
    expect(document.querySelector('.timeline-clip.kind-freeze')?.textContent).toContain(
      'Congelado',
    );
  });

  it('etiqueta el clip con color desde el Inspector y lo limpia', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    const service = createFakeService();
    const base = ensureDelivery(createEmptyProject('Obra color', '2025-01-01T00:00:00Z'));
    const asset = readyAsset();
    const seeded = addClipFromAsset(addAsset(base, asset), asset, {
      atFrame: 0,
      durationFrames: 90,
    }).project;
    const seededOpened = {
      project: seeded,
      label: 'color.editoria.json',
      path: 'C:\\tmp\\color.editoria.json',
      root: 'C:\\tmp',
    };
    service.createProject = async () => seededOpened;
    service.current = seededOpened;
    render(<App service={service} />);
    await createProject('Obra color');
    const clip = document.querySelector('.timeline-clip.kind-video');
    expect(clip).toBeTruthy();
    fireEvent.keyDown(clip as Element, { key: 'Enter' });
    const violet = await screen.findByRole('button', { name: 'Color Violeta' });
    fireEvent.click(violet);
    await waitFor(() =>
      expect(document.querySelector('.timeline-clip .clip-color-dot')).toBeTruthy(),
    );
    expect(violet.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Sin color' }));
    await waitFor(() =>
      expect(document.querySelector('.timeline-clip .clip-color-dot')).toBeNull(),
    );
  });

  it('separa el audio del video a su propia pista', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    const service = createFakeService();
    const base = ensureDelivery(createEmptyProject('Obra separar', '2025-01-01T00:00:00Z'));
    const asset = readyAsset();
    const seeded = addClipFromAsset(addAsset(base, asset), asset, {
      atFrame: 0,
      durationFrames: 90,
    }).project;
    const seededOpened = {
      project: seeded,
      label: 'separar.editoria.json',
      path: 'C:\\tmp\\separar.editoria.json',
      root: 'C:\\tmp',
    };
    service.createProject = async () => seededOpened;
    service.current = seededOpened;
    render(<App service={service} />);
    await createProject('Obra separar');
    const clip = document.querySelector('.timeline-clip.kind-video');
    expect(clip).toBeTruthy();
    fireEvent.keyDown(clip as Element, { key: 'Enter' });
    fireEvent.click(await screen.findByRole('button', { name: 'Separar audio' }));
    await waitFor(() =>
      expect(document.querySelectorAll('.timeline-clip.kind-audio').length).toBe(1),
    );
    expect(screen.getByRole('main').textContent).toContain('Audio separado');
  });

  it('ajusta el fade de entrada con el teclado desde la timeline', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    const service = createFakeService();
    const base = ensureDelivery(createEmptyProject('Obra fade', '2025-01-01T00:00:00Z'));
    const asset = readyAsset();
    const seeded = addClipFromAsset(addAsset(base, asset), asset, {
      atFrame: 0,
      durationFrames: 90,
    }).project;
    const seededOpened = {
      project: seeded,
      label: 'fade.editoria.json',
      path: 'C:\\tmp\\fade.editoria.json',
      root: 'C:\\tmp',
    };
    service.createProject = async () => seededOpened;
    service.current = seededOpened;
    render(<App service={service} />);
    await createProject('Obra fade');
    const clip = document.querySelector('.timeline-clip.kind-video');
    expect(clip).toBeTruthy();
    fireEvent.keyDown(clip as Element, { key: 'Enter' });
    const handle = await screen.findByRole('slider', { name: 'Fade de entrada' });
    fireEvent.keyDown(handle, { key: 'ArrowUp' });
    await waitFor(() =>
      expect(
        screen
          .getByRole('slider', { name: 'Fade de entrada' })
          .getAttribute('aria-valuenow'),
      ).toBe('1'),
    );
  });

  it('corta el clip en los marcadores desde el Inspector del proyecto', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    const service = createFakeService();
    const base = ensureDelivery(createEmptyProject('Obra cortes', '2025-01-01T00:00:00Z'));
    const asset = readyAsset();
    const seeded = addClipFromAsset(addAsset(base, asset), asset, {
      atFrame: 0,
      durationFrames: 90,
    }).project;
    const withMarker = addMarker(seeded, 45, { label: 'Mitad' }).project;
    const seededOpened = {
      project: withMarker,
      label: 'cortes.editoria.json',
      path: 'C:\\tmp\\cortes.editoria.json',
      root: 'C:\\tmp',
    };
    service.createProject = async () => seededOpened;
    service.current = seededOpened;
    render(<App service={service} />);
    await createProject('Obra cortes');
    fireEvent.click(
      await screen.findByRole('button', { name: 'Cortar clips en marcadores' }),
    );
    await waitFor(() =>
      expect(document.querySelectorAll('.timeline-clip.kind-video').length).toBe(2),
    );
  });

  it('atenúa los clips que no coinciden con el filtro de color', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    const service = createFakeService();
    const base = ensureDelivery(createEmptyProject('Obra filtro', '2025-01-01T00:00:00Z'));
    const asset = readyAsset();
    const added = addClipFromAsset(addAsset(base, asset), asset, {
      atFrame: 0,
      durationFrames: 90,
    });
    const seeded = updateClip(added.project, added.clipId, { colorTag: 'rose' });
    const seededOpened = {
      project: seeded,
      label: 'filtro.editoria.json',
      path: 'C:\\tmp\\filtro.editoria.json',
      root: 'C:\\tmp',
    };
    service.createProject = async () => seededOpened;
    service.current = seededOpened;
    render(<App service={service} />);
    await createProject('Obra filtro');
    const filter = await screen.findByRole('combobox', {
      name: 'Filtrar clips por color',
    });
    fireEvent.change(filter, { target: { value: 'green' } });
    await waitFor(() =>
      expect(document.querySelectorAll('.timeline-clip.dimmed').length).toBe(1),
    );
    fireEvent.change(filter, { target: { value: 'rose' } });
    await waitFor(() =>
      expect(document.querySelectorAll('.timeline-clip.dimmed').length).toBe(0),
    );
  });

  it('copia y pega atributos entre dos clips desde el menú', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    const service = createFakeService();
    const base = ensureDelivery(createEmptyProject('Obra atributos', '2025-01-01T00:00:00Z'));
    const asset = readyAsset();
    const first = addClipFromAsset(addAsset(base, asset), asset, {
      atFrame: 0,
      durationFrames: 60,
    });
    const second = addClipFromAsset(first.project, asset, {
      atFrame: 120,
      durationFrames: 60,
    });
    const seeded = updateClip(second.project, first.clipId, {
      effects: { brightness: 0.2 },
      colorTag: 'teal',
    });
    const seededOpened = {
      project: seeded,
      label: 'atributos.editoria.json',
      path: 'C:\\tmp\\atributos.editoria.json',
      root: 'C:\\tmp',
    };
    service.createProject = async () => seededOpened;
    service.current = seededOpened;
    render(<App service={service} />);
    await createProject('Obra atributos');
    const clips = document.querySelectorAll('.timeline-clip.kind-video');
    expect(clips).toHaveLength(2);
    fireEvent.contextMenu(clips[0]!, { clientX: 50, clientY: 50 });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copiar atributos' }));
    fireEvent.contextMenu(clips[1]!, { clientX: 80, clientY: 50 });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Pegar atributos' }));
    await waitFor(() =>
      expect(screen.getByText(/Atributos pegados/)).toBeTruthy(),
    );
  });

  it('pega atributos en lote sobre el filtro de color', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    const service = createFakeService();
    const base = ensureDelivery(createEmptyProject('Obra lote', '2025-01-01T00:00:00Z'));
    const asset = readyAsset();
    const first = addClipFromAsset(addAsset(base, asset), asset, {
      atFrame: 0,
      durationFrames: 60,
    });
    const second = addClipFromAsset(first.project, asset, {
      atFrame: 120,
      durationFrames: 60,
    });
    let seeded = updateClip(second.project, first.clipId, {
      effects: { brightness: 0.2 },
      colorTag: 'teal',
    });
    seeded = updateClip(seeded, second.clipId, { colorTag: 'teal' });
    const seededOpened = {
      project: seeded,
      label: 'lote.editoria.json',
      path: 'C:\\tmp\\lote.editoria.json',
      root: 'C:\\tmp',
    };
    service.createProject = async () => seededOpened;
    service.current = seededOpened;
    render(<App service={service} />);
    await createProject('Obra lote');
    const clips = document.querySelectorAll('.timeline-clip.kind-video');
    fireEvent.contextMenu(clips[0]!, { clientX: 50, clientY: 50 });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copiar atributos' }));
    const filter = await screen.findByRole('combobox', {
      name: 'Filtrar clips por color',
    });
    fireEvent.change(filter, { target: { value: 'teal' } });
    fireEvent.click(
      await screen.findByRole('button', { name: 'Pegar atributos al filtro' }),
    );
    await waitFor(() =>
      expect(screen.getByText(/Atributos pegados en 2 clip/)).toBeTruthy(),
    );
  });

  it('sube una pista desde el inspector de pista', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    const service = createFakeService();
    const base = ensureDelivery(createEmptyProject('Obra pistas', '2025-01-01T00:00:00Z'));
    const asset = readyAsset();
    const seeded = addClipFromAsset(addAsset(base, asset), asset, {
      atFrame: 0,
      durationFrames: 60,
    }).project;
    const withTrack = addTrack(seeded, 'video', 'V2').project;
    const seededOpened = {
      project: withTrack,
      label: 'pistas.editoria.json',
      path: 'C:\\tmp\\pistas.editoria.json',
      root: 'C:\\tmp',
    };
    service.createProject = async () => seededOpened;
    service.current = seededOpened;
    render(<App service={service} />);
    await createProject('Obra pistas');
    const names = () =>
      [...document.querySelectorAll('.timeline-row .track-name')].map(
        (element) => element.textContent ?? '',
      );
    expect(names()[0]).toContain('V2');
    const trackButton = [
      ...document.querySelectorAll<HTMLButtonElement>('.timeline-row .track-name'),
    ].find((element) => element.textContent?.includes('V1'));
    fireEvent.click(trackButton!);
    fireEvent.click(await screen.findByRole('button', { name: 'Subir capa' }));
    await waitFor(() => expect(names()[0]).toContain('V1'));
  });

  it('disuelve los cortes contiguos desde el inspector de proyecto', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    const service = createFakeService();
    const base = ensureDelivery(createEmptyProject('Obra cortes', '2025-01-01T00:00:00Z'));
    const asset = readyAsset();
    let seeded = addAsset(base, asset);
    for (const at of [0, 60]) {
      seeded = addClipFromAsset(seeded, asset, {
        atFrame: at,
        durationFrames: 60,
      }).project;
    }
    const seededOpened = {
      project: seeded,
      label: 'disolver.editoria.json',
      path: 'C:\\tmp\\disolver.editoria.json',
      root: 'C:\\tmp',
    };
    service.createProject = async () => seededOpened;
    service.current = seededOpened;
    render(<App service={service} />);
    await createProject('Obra cortes');
    fireEvent.click(
      await screen.findByRole('button', { name: 'Disolver cortes contiguos' }),
    );
    await waitFor(() =>
      expect(screen.getByText(/1 corte\(s\) con disolvencia/)).toBeTruthy(),
    );
  });

  it('aplica voz clara a todos los clips de audio desde el inspector de proyecto', async () => {
    const service = createFakeService();
    const base = ensureDelivery(createEmptyProject('Obra audio', '2025-01-01T00:00:00Z'));
    const audio = {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      label: 'Voz',
      kind: 'audio',
      source: { type: 'local', path: 'media/voz.wav' },
      status: 'ready',
      integrity: { sha256: 'b'.repeat(64), bytes: 5_000 },
      rights: {
        license: { id: 'owned', commercialUse: 'allowed' },
        provenance: { origin: 'user-imported', acquiredAt: '2025-01-01T00:00:00.000Z' },
      },
      media: { sampleRate: 48_000, channels: 1, durationFrames: 60 },
    } as Asset;
    const seeded = addClipFromAsset(addAsset(base, audio), audio, {
      atFrame: 0,
      durationFrames: 60,
    }).project;
    const seededOpened = {
      project: seeded,
      label: 'audio.editoria.json',
      path: 'C:\\tmp\\audio.editoria.json',
      root: 'C:\\tmp',
    };
    service.createProject = async () => seededOpened;
    service.current = seededOpened;
    render(<App service={service} />);
    await createProject('Obra audio');
    fireEvent.click(await screen.findByRole('button', { name: 'Voz clara a todos' }));
    await waitFor(() =>
      expect(screen.getByText(/Voz clara aplicado a 1 clip/)).toBeTruthy(),
    );
  });

  it('aplica un efecto creativo desde el inspector del clip', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    const service = createFakeService();
    const base = ensureDelivery(createEmptyProject('Obra efecto', '2025-01-01T00:00:00Z'));
    const asset = readyAsset();
    const seeded = addClipFromAsset(addAsset(base, asset), asset, {
      atFrame: 0,
      durationFrames: 90,
    }).project;
    const seededOpened = {
      project: seeded,
      label: 'efecto.editoria.json',
      path: 'C:\\tmp\\efecto.editoria.json',
      root: 'C:\\tmp',
    };
    service.createProject = async () => seededOpened;
    service.current = seededOpened;
    render(<App service={service} />);
    await createProject('Obra efecto');
    fireEvent.keyDown(document.querySelector('.timeline-clip.kind-video') as Element, {
      key: 'Enter',
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Noir' }));
    await waitFor(() =>
      expect(screen.getByText('Efecto Noir aplicado.')).toBeTruthy(),
    );
  });

  it('busca clips por nombre, atenúa el resto y salta al coincidente', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    const service = createFakeService();
    const base = ensureDelivery(createEmptyProject('Obra búsqueda', '2025-01-01T00:00:00Z'));
    const asset = readyAsset();
    const first = addClipFromAsset(addAsset(base, asset), asset, {
      atFrame: 0,
      durationFrames: 60,
    });
    const second = addClipFromAsset(first.project, asset, {
      atFrame: 60,
      durationFrames: 60,
    });
    let seeded = updateClip(second.project, first.clipId, { label: 'Intro' });
    seeded = updateClip(seeded, second.clipId, { label: 'Cierre' });
    const seededOpened = {
      project: seeded,
      label: 'busqueda.editoria.json',
      path: 'C:\\tmp\\busqueda.editoria.json',
      root: 'C:\\tmp',
    };
    service.createProject = async () => seededOpened;
    service.current = seededOpened;
    render(<App service={service} />);
    await createProject('Obra búsqueda');
    const search = await screen.findByRole('searchbox', {
      name: 'Buscar clips por nombre',
    });
    fireEvent.change(search, { target: { value: 'cierre' } });
    await waitFor(() =>
      expect(document.querySelectorAll('.timeline-clip.dimmed').length).toBe(1),
    );
    fireEvent.keyDown(search, { key: 'Enter' });
    await waitFor(() =>
      expect(screen.getByText(/Clip Cierre en/)).toBeTruthy(),
    );
  });

  it('crea marcadores desde las escenas del proyecto', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    const service = createFakeService();
    const base = ensureDelivery(createEmptyProject('Obra escenas', '2025-01-01T00:00:00Z'));
    const asset = readyAsset();
    const added = addClipFromAsset(addAsset(base, asset), asset, {
      atFrame: 0,
      durationFrames: 60,
    });
    const scene: Scene = {
      id: '11111111-1111-4111-8111-111111111111',
      order: 0,
      title: 'Intro',
      intent: 'hook',
      status: 'draft',
      narration: { text: 'Hola', estimatedDurationFrames: 30 },
      clipIds: [added.clipId],
    };
    const seeded = { ...added.project, scenes: [scene] };
    const seededOpened = {
      project: seeded,
      label: 'escenas.editoria.json',
      path: 'C:\\tmp\\escenas.editoria.json',
      root: 'C:\\tmp',
    };
    service.createProject = async () => seededOpened;
    service.current = seededOpened;
    render(<App service={service} />);
    await createProject('Obra escenas');
    fireEvent.click(
      await screen.findByRole('button', { name: 'Marcadores desde escenas' }),
    );
    await waitFor(() =>
      expect(screen.getByText(/1 marcador\(es\) desde escenas/)).toBeTruthy(),
    );
  });

  it('desactiva y reactiva un clip desde el menú contextual', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    const service = createFakeService();
    const base = ensureDelivery(createEmptyProject('Obra off', '2025-01-01T00:00:00Z'));
    const asset = readyAsset();
    const seeded = addClipFromAsset(addAsset(base, asset), asset, {
      atFrame: 0,
      durationFrames: 60,
    }).project;
    const seededOpened = {
      project: seeded,
      label: 'off.editoria.json',
      path: 'C:\\tmp\\off.editoria.json',
      root: 'C:\\tmp',
    };
    service.createProject = async () => seededOpened;
    service.current = seededOpened;
    render(<App service={service} />);
    await createProject('Obra off');
    fireEvent.contextMenu(
      document.querySelector('.timeline-clip.kind-video') as Element,
      { clientX: 60, clientY: 60 },
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'Desactivar clip' }));
    await waitFor(() =>
      expect(document.querySelectorAll('.timeline-clip.disabled').length).toBe(1),
    );
    fireEvent.contextMenu(
      document.querySelector('.timeline-clip.kind-video') as Element,
      { clientX: 60, clientY: 60 },
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'Activar clip' }));
    await waitFor(() =>
      expect(document.querySelectorAll('.timeline-clip.disabled').length).toBe(0),
    );
  });

  it('abre el diálogo de exportación con un clip y los perfiles del proyecto', async () => {
    const service = createFakeService();
    const base = ensureDelivery(createEmptyProject('Obra export', '2025-01-01T00:00:00Z'));
    const asset = readyAsset();
    const seeded = addClipFromAsset(addAsset(base, asset), asset, {}).project;
    const seededOpened = {
      project: seeded,
      label: 'export.editoria.json',
      path: 'C:\\tmp\\export.editoria.json',
      root: 'C:\\tmp',
    };
    service.createProject = async () => seededOpened;
    service.current = seededOpened;
    render(<App service={service} />);
    await createProject('Obra export');
    fireEvent.click(screen.getByRole('button', { name: /Exportar MP4/i }));
    const dialog = screen.getByRole('dialog', { name: /Render MP4 verificado/i });
    expect(dialog).toBeTruthy();
    expect(within(dialog).getAllByText(/YouTube 1080p/).length).toBeGreaterThan(0);
    expect(within(dialog).getByRole('button', { name: /Elegir destino y exportar/i })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: /Elegir carpeta y exportar lote/i })).toBeTruthy();
  });
});
