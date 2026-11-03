// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Asset } from '@editor-ia/project-schema';
import { createEmptyProject } from '@editor-ia/project-schema';
import { App } from '../../App';
import { ProjectProvider } from '../../state/project-store';
import { addAsset, addCaptionCue, addClipFromAsset, ensureDelivery, newId } from '../../state/project-actions';
import { createFakeService, readyAsset } from '../../test/fake-service';
import { AssistantDock } from './AssistantDock';
import { MCP_TOOLS } from '../../state/mcp-catalog';

const NOW = '2025-01-01T00:00:00.000Z';

function readyImage(label: string): Asset {
  return {
    id: newId(),
    label,
    kind: 'image',
    source: { type: 'local', path: `media/${label}` },
    status: 'ready',
    integrity: { sha256: 'a'.repeat(64), bytes: 1_000 },
    rights: {
      license: { id: 'owned', commercialUse: 'allowed' },
      provenance: { origin: 'user-imported', acquiredAt: NOW },
    },
    media: { width: 1920, height: 1080 },
  } as Asset;
}

function readyAudio(label: string): Asset {
  return {
    id: newId(),
    label,
    kind: 'audio',
    source: { type: 'local', path: `media/${label}` },
    status: 'ready',
    integrity: { sha256: 'b'.repeat(64), bytes: 1_000 },
    rights: {
      license: { id: 'owned', commercialUse: 'allowed' },
      provenance: { origin: 'user-imported', acquiredAt: NOW },
    },
    media: { sampleRate: 48_000, channels: 2, durationFrames: 1_800 },
  } as Asset;
}

afterEach(cleanup);

function openAssistant(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Abrir asistente Olyvia' }));
}

function send(text: string): void {
  fireEvent.change(screen.getByLabelText('Mensaje para Olyvia'), {
    target: { value: text },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Enviar mensaje' }));
}

describe('Olyvia Assistant', () => {
  it('abre el chat flotante y ejecuta un comando local sin tokens', async () => {
    render(<App service={createFakeService()} />);
    openAssistant();
    expect(screen.getByRole('dialog', { name: 'Asistente Olyvia' })).toBeTruthy();
    send('abrir editor');
    expect(await screen.findByText('Abriendo Editor.')).toBeTruthy();
  });

  it('muestra el modelo en uso con su marca y su estado', async () => {
    const service = createFakeService();
    service.getProvider = async () => ({
      kind: 'openai-compatible',
      baseUrl: 'http://127.0.0.1:11434/v1',
      model: 'llama3.1',
      hasKey: false,
      keyringAvailable: true,
    });
    render(<App service={service} />);
    openAssistant();
    // El nombre del modelo y el endpoint aparecen en la barra y en el pie.
    expect((await screen.findAllByText('Ollama')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('llama3.1').length).toBeGreaterThan(0);
    expect(screen.getByText('local')).toBeTruthy();
    // La marca de la familia del modelo está en el documento.
    expect(document.querySelectorAll('.ai-brand-mark').length).toBeGreaterThan(0);
    expect(screen.getByTitle('Modelo en uso: llama3.1')).toBeTruthy();
  });

  it('un modelo de OpenRouter de otra familia muestra la marca de esa familia', async () => {
    const service = createFakeService();
    service.getProvider = async () => ({
      kind: 'openai-compatible',
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'anthropic/claude-sonnet-4.5',
      hasKey: true,
      keyringAvailable: true,
    });
    render(<App service={service} />);
    openAssistant();
    expect((await screen.findAllByText('OpenRouter')).length).toBeGreaterThan(0);
    expect(screen.getByText('remoto')).toBeTruthy();
    expect(
      screen.getByTitle('Modelo en uso: anthropic/claude-sonnet-4.5'),
    ).toBeTruthy();
  });

  it('cambia de modelo desde el propio chat', async () => {
    const service = createFakeService();
    let saved: { model: string; baseUrl: string } | null = null;
    service.getProvider = async () => ({
      kind: 'openai-compatible',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4.1-mini',
      hasKey: true,
      keyringAvailable: true,
    });
    service.saveProvider = async (input) => {
      saved = { model: input.model, baseUrl: input.baseUrl };
      return {
        kind: 'openai-compatible',
        baseUrl: input.baseUrl,
        model: input.model,
        hasKey: true,
        keyringAvailable: true,
      };
    };
    render(<App service={service} />);
    openAssistant();
    const select = await screen.findByLabelText('Modelo en uso');
    fireEvent.change(select, { target: { value: 'gpt-4o' } });
    await waitFor(() => expect(saved).toEqual({ model: 'gpt-4o', baseUrl: 'https://api.openai.com/v1' }));
  });

  it('monta una carpeta de Descargas sin proveedor', async () => {
    const service = createFakeService();
    const imagePath = 'C:\\Users\\tester\\Downloads\\video 1\\Escena 1.jpg';
    const audioPath = 'C:\\Users\\tester\\Downloads\\video 1\\Tema.wav';
    service.listMediaFolder = async () => ({
      directory: 'C:\\Users\\tester\\Downloads\\video 1',
      files: [
        { path: imagePath, name: 'Escena 1.jpg', kind: 'image', bytes: 1_000 },
        { path: audioPath, name: 'Tema.wav', kind: 'audio', bytes: 1_000 },
      ],
    });
    service.importMediaPaths = async () => ({
      assets: [readyImage('Escena 1.jpg'), readyAudio('Tema.wav')],
      warnings: [],
    });
    render(<App service={service} />);
    openAssistant();
    send('usá los archivos de descargas de la carpeta video 1');
    await new Promise((resolve) => setTimeout(resolve, 600));
    // Con transcripción disponible manda la narración: una imagen por frase,
    // subtítulos y audio normalizado. Antes caía al montaje por carpeta porque
    // los clips quedaban apuntando a assets que el store todavía no tenía.
    expect(await screen.findByText(/Monté 1 imagen sobre 1 frase/)).toBeTruthy();
    expect(screen.getByText(/con 1 subtítulo/)).toBeTruthy();
    expect(screen.queryByText(/Soy Olyvia en modo simulado/i)).toBeNull();
  });

  it('monta una ruta absoluta del equipo', async () => {
    const service = createFakeService();
    let listedFolder = '';
    service.listMediaFolder = async ({ folder }) => {
      listedFolder = folder;
      return {
        directory: folder,
        files: [
          { path: `${folder}\\foto.jpg`, name: 'foto.jpg', kind: 'image', bytes: 1_000 },
          { path: `${folder}\\voz.wav`, name: 'voz.wav', kind: 'audio', bytes: 1_000 },
        ],
      };
    };
    service.importMediaPaths = async () => ({
      assets: [readyImage('foto.jpg'), readyAudio('voz.wav')],
      warnings: [],
    });
    render(<App service={service} />);
    openAssistant();
    send('usá los archivos de D:\\Videos\\Clips');
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(listedFolder).toBe('D:\\Videos\\Clips');
    expect(await screen.findByText(/Monté 1 imagen sobre 1 frase/)).toBeTruthy();
  });

  it('consulta al proveedor cuando el comando no es local', async () => {
    render(<App service={createFakeService()} />);
    openAssistant();
    send('contame algo');
    expect(await screen.findByText(/Soy Olyvia en modo simulado/i)).toBeTruthy();
  });

  it('ejecuta una secuencia de acciones del proveedor en el orden recibido', async () => {
    const service = createFakeService();
    service.assistantChat = async () => ({
      reply: 'Abro primero el Editor y después Motion.',
      action: null,
      actions: [
        { kind: 'navigate', view: 'editor' },
        { kind: 'navigate', view: 'motion' },
      ],
      providerId: 'real',
      model: 'modelo-real',
      simulated: false,
    });
    const onNavigate = vi.fn();
    render(
      <ProjectProvider service={service}>
        <AssistantDock activeId="home" onSelect={onNavigate} />
      </ProjectProvider>,
    );
    openAssistant();
    send('abrí editor y luego motion');
    expect(await screen.findByText('Abro primero el Editor y después Motion.')).toBeTruthy();
    await waitFor(() => {
      expect(onNavigate).toHaveBeenNthCalledWith(1, 'editor');
      expect(onNavigate).toHaveBeenNthCalledWith(2, 'motion');
    });
  });

  it('detiene un plan multiacción cuando el borrado queda pendiente de confirmación', async () => {
    const base = ensureDelivery(createEmptyProject('Plan', NOW));
    const project = addAsset(base, readyAsset({ label: 'Toma' }));
    const service = createFakeService();
    const onNavigate = vi.fn();
    render(
      <ProjectProvider service={service} initial={{ project, opened: null }}>
        <AssistantDock activeId="home" onSelect={onNavigate} />
      </ProjectProvider>,
    );
    openAssistant();

    // Selecciona un clip real: el plan debe detenerse ante la confirmación,
    // no por falta de selección.
    send('agregá el clip de toma');
    expect(await screen.findByText(/Toma agregado a la timeline al final/)).toBeTruthy();
    onNavigate.mockClear();

    service.assistantChat = async () => ({
      reply: 'Borro la selección y luego abro Motion.',
      action: { kind: 'delete_selected' },
      actions: [
        { kind: 'delete_selected' },
        { kind: 'navigate', view: 'motion' },
      ],
      providerId: 'real',
      model: 'modelo-real',
      simulated: false,
    });
    send('borralo');
    expect(await screen.findByRole('alertdialog', { name: 'Confirmar borrado' })).toBeTruthy();
    expect(screen.getByText(/Detuve el resto del plan/)).toBeTruthy();
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('muestra la respuesta si el proveedor no devuelve acciones', async () => {
    const service = createFakeService();
    service.assistantChat = async () => ({
      reply: 'El proyecto está listo para revisar.',
      action: null,
      actions: [],
      providerId: 'real',
      model: 'modelo-real',
      simulated: false,
    });
    render(<App service={service} />);
    openAssistant();
    send('¿cómo está?');
    expect(await screen.findByText('El proyecto está listo para revisar.')).toBeTruthy();
  });

  it('invoca una herramienta MCP de lectura sin pedir confirmación', async () => {
    const service = createFakeService();
    service.assistantChat = async () => ({
      reply: 'Consulté el estado de Olyvia.',
      action: null,
      actions: [{ kind: 'mcp_call', tool: 'app_status', arguments: {} }],
      providerId: 'real',
      model: 'modelo-real',
      simulated: false,
    });
    render(<App service={service} />);
    openAssistant();
    send('invocá app_status usando el catálogo MCP');
    expect(await screen.findByText('Consulté el estado de Olyvia.')).toBeTruthy();
    expect(await screen.findByText(/"app":"olyvia".*"open":false/)).toBeTruthy();
    expect(screen.queryByRole('alertdialog', { name: 'Confirmar acción MCP' })).toBeNull();
  });

  it('exige confirmación antes de una escritura MCP y la ejecuta al autorizar', async () => {
    const service = createFakeService();
    const setPaths = vi.spyOn(service, 'setToolPaths');
    service.assistantChat = async () => ({
      reply: 'Voy a configurar la ruta de FFmpeg.',
      action: null,
      actions: [{
        kind: 'mcp_call',
        tool: 'settings_set_tools',
        arguments: { ffmpeg: 'C:\\Tools\\ffmpeg.exe' },
      }],
      providerId: 'real',
      model: 'modelo-real',
      simulated: false,
    });
    render(<App service={service} />);
    openAssistant();
    send('configurá la ruta de FFmpeg mediante MCP');
    expect(await screen.findByRole('alertdialog', { name: 'Confirmar acción MCP' })).toBeTruthy();
    expect(screen.getByText(/no se ejecutó todavía/i)).toBeTruthy();
    expect(setPaths).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Sí, ejecutar' }));
    await waitFor(() => expect(setPaths).toHaveBeenCalledWith({ ffmpeg: 'C:\\Tools\\ffmpeg.exe' }));
    await waitFor(() =>
      expect(screen.queryByRole('alertdialog', { name: 'Confirmar acción MCP' })).toBeNull(),
    );
  });

  it('no ejecuta una escritura MCP cuando la persona cancela la confirmación', async () => {
    const service = createFakeService();
    const setPaths = vi.spyOn(service, 'setToolPaths');
    service.assistantChat = async () => ({
      reply: 'Voy a configurar FFmpeg.',
      action: null,
      actions: [{
        kind: 'mcp_call',
        tool: 'settings_set_tools',
        arguments: { ffmpeg: 'C:\\Tools\\ffmpeg.exe' },
      }],
      providerId: 'real',
      model: 'modelo-real',
      simulated: false,
    });
    render(<App service={service} />);
    openAssistant();
    send('configurá FFmpeg con MCP');
    expect(await screen.findByRole('alertdialog', { name: 'Confirmar acción MCP' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'No, cancelar' }));
    expect(screen.queryByRole('alertdialog', { name: 'Confirmar acción MCP' })).toBeNull();
    expect(setPaths).not.toHaveBeenCalled();
  });

  it('muestra el peluche dentro del chat y reacciona al foco', () => {
    render(<App service={createFakeService()} />);
    expect(document.querySelector('.pet-avatar')).toBeNull();

    const launcher = screen.getByRole('button', { name: 'Abrir asistente Olyvia' });
    fireEvent.click(launcher);

    const pet = document.querySelector('.pet-avatar');
    expect(pet).toBeTruthy();
    expect(pet?.querySelector('img')?.getAttribute('src')).toBe('/olyvia-pet.webp');

    const input = screen.getByLabelText('Mensaje para Olyvia');
    fireEvent.blur(input);
    expect(pet?.className).toContain('is-awake');
    fireEvent.focus(input);
    expect(pet?.className).toContain('is-listening');

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar asistente Olyvia' }));
    expect(document.querySelector('.pet-avatar')).toBeNull();
  });

  it('agrega material a la timeline por su nombre', async () => {
    const base = ensureDelivery(createEmptyProject('Auto', NOW));
    const project = addAsset(base, readyAsset({ label: 'B-roll ciudad' }));
    const service = createFakeService();
    const onNavigate = vi.fn();
    render(
      <ProjectProvider
        service={service}
        initial={{ project, opened: null }}
      >
        <AssistantDock activeId="home" onSelect={onNavigate} />
      </ProjectProvider>,
    );
    openAssistant();
    send('agregá el clip de b-roll ciudad');
    expect(await screen.findByText(/B-roll ciudad agregado a la timeline al final/)).toBeTruthy();
    expect(onNavigate).toHaveBeenCalledWith('editor');
  });

  it('agrega un subtítulo y avisa si no puede cortar', async () => {
    const base = ensureDelivery(createEmptyProject('Auto', NOW));
    const project = addAsset(base, readyAsset({ label: 'Toma' }));
    const service = createFakeService();
    render(
      <ProjectProvider
        service={service}
        initial={{ project, opened: null }}
      >
        <AssistantDock activeId="home" onSelect={() => {}} />
      </ProjectProvider>,
    );
    openAssistant();

    send('subtítulo Hola mundo durante 4 segundos');
    expect(await screen.findByText(/Subtítulo agregado en el playhead \(4\.0 s\)/)).toBeTruthy();

    // Sin clip seleccionado, el corte se explica en lugar de fallar en silencio.
    send('cortá acá');
    expect(
      await screen.findByText(/Elegí un clip en la timeline y volvé a pedirme el corte/),
    ).toBeTruthy();
  });
});

describe('contexto del cerebro de edición', () => {
  it('manda el brief medido de la timeline al proveedor', async () => {
    const base = ensureDelivery(createEmptyProject('Cerebro', NOW));
    const asset = readyAsset({ label: 'Toma larga' });
    let project = addAsset(base, asset);
    project = addClipFromAsset(project, asset, { atFrame: 0, durationFrames: 240 }).project;
    const service = createFakeService();
    const spy = vi.spyOn(service, 'assistantChat');
    render(
      <ProjectProvider service={service} initial={{ project, opened: null }}>
        <AssistantDock activeId="home" onSelect={() => {}} />
      </ProjectProvider>,
    );
    openAssistant();
    send('¿cómo viene el ritmo del video?');
    await waitFor(() => expect(spy).toHaveBeenCalled());
    const request = spy.mock.calls[0]?.[0] as { context?: Record<string, unknown> } | undefined;
    expect(request?.context?.brain).toEqual(expect.stringContaining('CEREBRO DE EDICIÓN'));
    expect(request?.context?.brain).toEqual(expect.stringContaining('salud'));

    const tools = request?.context?.mcpTools as
      | readonly { name: string; inputSchema: Record<string, unknown> }[]
      | undefined;
    expect(tools).toHaveLength(MCP_TOOLS.length);
    expect(new TextEncoder().encode(JSON.stringify(tools)).byteLength).toBeLessThan(48 * 1024);
    expect(tools?.find((tool) => tool.name === 'clip_add')?.inputSchema).toEqual(
      expect.objectContaining({
        type: 'object',
        properties: expect.objectContaining({
          assetId: expect.objectContaining({ type: 'string' }),
        }),
      }),
    );
  });

  it('no borra nada si lo pide el modelo sin confirmación', async () => {
    const base = ensureDelivery(createEmptyProject('Auto', NOW));
    const asset = readyAsset({ label: 'Toma' });
    const withClip = addAsset(base, asset);
    const service = createFakeService();
    const onNavigate = vi.fn();
    render(
      <ProjectProvider service={service} initial={{ project: withClip, opened: null }}>
        <AssistantDock activeId="home" onSelect={onNavigate} />
      </ProjectProvider>,
    );
    openAssistant();
    send('agregá el clip de toma');
    await screen.findByText(/Toma agregado a la timeline al final/);

    // El modelo dice que hizo algo pero no devuelve acción: el dock lo admite.
    service.assistantChat = async () => ({
      reply: 'Listo, ya lo hice.',
      action: null,
      providerId: 'mock',
      model: 'modelo',
      simulated: true,
    });
    send('contame un chiste');
    expect(await screen.findByText(/no ejecuté ningún cambio/)).toBeTruthy();

    // El modelo pide borrar: el dock muestra la confirmación en vez de ejecutar.
    service.assistantChat = async () => ({
      reply: 'Borro el clip.',
      action: { kind: 'delete_selected' },
      providerId: 'real',
      model: 'modelo-real',
      simulated: false,
    });
    send('borralo');
    expect(await screen.findByRole('alertdialog', { name: 'Confirmar borrado' })).toBeTruthy();
    expect(screen.getByText(/Quiero borrar el clip seleccionado/)).toBeTruthy();
    const clipsBefore = window.document.querySelectorAll('.assistant-confirm').length;
    expect(clipsBefore).toBe(1);

    // Confirmar ejecuta el borrado y limpia el panel.
    fireEvent.click(screen.getByRole('button', { name: 'Sí, borrar' }));
    expect(await screen.findByText('Clip eliminado. Podés deshacer.')).toBeTruthy();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('el operador local borra directo porque lo escribió el usuario', async () => {
    const base = ensureDelivery(createEmptyProject('Auto', NOW));
    const project = addAsset(base, readyAsset({ label: 'Toma' }));
    const service = createFakeService();
    render(
      <ProjectProvider service={service} initial={{ project, opened: null }}>
        <AssistantDock activeId="home" onSelect={() => {}} />
      </ProjectProvider>,
    );
    openAssistant();
    send('agregá el clip de toma');
    await screen.findByText(/Toma agregado a la timeline al final/);
    send('borrá lo seleccionado');
    expect(await screen.findByText('Clip eliminado. Podés deshacer.')).toBeTruthy();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});

describe('corte de silencios del asistente', () => {
  /** 10 s: voz 0–3 s, silencio 3–5 s, voz 5–8 s, silencio 8–10 s. */
  function narrationPeaks(assetId: string) {
    const pattern = [
      ...Array.from({ length: 30 }, () => 'voz' as const),
      ...Array.from({ length: 20 }, () => 'silencio' as const),
      ...Array.from({ length: 30 }, () => 'voz' as const),
      ...Array.from({ length: 20 }, () => 'silencio' as const),
    ];
    return {
      assetId,
      durationSeconds: 10,
      buckets: pattern.length,
      peaks: pattern.map((kind) =>
        kind === 'voz' ? { min: -0.6, max: 0.6 } : { min: -0.001, max: 0.001 },
      ),
    };
  }

  function projectWithNarration() {
    const asset = readyAsset({
      kind: 'audio',
      label: 'Narración',
      source: { type: 'local', path: 'media/narracion.wav' },
      media: { sampleRate: 48_000, channels: 1, durationFrames: 300 },
    });
    let project = addAsset(ensureDelivery(createEmptyProject('Silencios', NOW)), asset);
    const added = addClipFromAsset(project, asset, { atFrame: 0, durationFrames: 300 });
    project = added.project;
    return { project, clipId: added.clipId, assetId: asset.id };
  }

  it('un comando local recorta los silencios medidos', async () => {
    const { project, clipId } = projectWithNarration();
    const service = createFakeService();
    service.audioPeaks = async (assetId: string) => narrationPeaks(assetId);
    render(
      <ProjectProvider service={service} initial={{ project, opened: null }}>
        <AssistantDock activeId="home" onSelect={() => {}} />
      </ProjectProvider>,
    );
    openAssistant();
    send(`cortá los silencios del clip`);
    expect(await screen.findByText(/Recorté 2 silencio\(s\) en 1 clip\(s\)/)).toBeTruthy();
    expect(screen.getByText(/Podés deshacer con Ctrl\+Z/)).toBeTruthy();
    expect(clipId).toBeTruthy();
  });

  it('el modelo puede pedir el corte con alcance de proyecto', async () => {
    const { project } = projectWithNarration();
    const service = createFakeService();
    service.audioPeaks = async (assetId: string) => narrationPeaks(assetId);
    service.assistantChat = async () => ({
      reply: 'Limpio los silencios.',
      action: {
        kind: 'cut_silences',
        thresholdDb: -45,
        minSilenceSeconds: 0.35,
        paddingSeconds: 0.15,
        scope: 'project',
      },
      providerId: 'real',
      model: 'modelo-real',
      simulated: false,
    });
    render(
      <ProjectProvider service={service} initial={{ project, opened: null }}>
        <AssistantDock activeId="home" onSelect={() => {}} />
      </ProjectProvider>,
    );
    openAssistant();
    send('limpiá los silencios del proyecto');
    expect(await screen.findByText(/Recorté 2 silencio\(s\) en 1 clip\(s\)/)).toBeTruthy();
  });

  it('sin picos medibles lo dice en vez de fingir el corte', async () => {
    const { project } = projectWithNarration();
    const service = createFakeService();
    service.audioPeaks = async () => {
      throw new Error('sin audio');
    };
    render(
      <ProjectProvider service={service} initial={{ project, opened: null }}>
        <AssistantDock activeId="home" onSelect={() => {}} />
      </ProjectProvider>,
    );
    openAssistant();
    send('cortá los silencios');
    expect(
      await screen.findByText(/No pude medir los picos de esos clips/),
    ).toBeTruthy();
  });
});

describe('servidor MCP del asistente', () => {
  it('lo arranca y devuelve la configuración para el cliente externo', async () => {
    const asset = readyAsset({ label: 'Toma', source: { type: 'local', path: 'media/toma.mp4' } });
    let project = addAsset(ensureDelivery(createEmptyProject('MCP', NOW)), asset);
    project = addClipFromAsset(project, asset, { atFrame: 0, durationFrames: 90 }).project;
    render(
      <ProjectProvider
        service={createFakeService()}
        initial={{
          project,
          opened: {
            project,
            label: 'mcp.editoria.json',
            path: 'C:////tester////mcp.editoria.json',
            root: 'C:////tester',
          },
        }}
      >
        <AssistantDock activeId="home" onSelect={() => {}} />
      </ProjectProvider>,
    );
    openAssistant();
    send('servidor mcp');
    expect(await screen.findByText(/Servidor MCP escuchando en/)).toBeTruthy();
    expect(screen.getByText(/token-de-prueba/)).toBeTruthy();
  });
});

describe('limpieza automática del asistente', () => {
  it('limpia el video en un solo paso y lo resume', async () => {
    const asset = readyAsset({ label: 'Toma', source: { type: 'local', path: 'media/toma.mp4' } });
    let project = addAsset(ensureDelivery(createEmptyProject('Limpieza', NOW)), asset);
    const added = addClipFromAsset(project, asset, { atFrame: 0, durationFrames: 150 });
    project = added.project;
    const service = createFakeService();
    render(
      <ProjectProvider
        service={service}
        initial={{
          project,
          opened: {
            project,
            label: 'limpieza.editoria.json',
            path: 'C:\\tester\\limpieza.editoria.json',
            root: 'C:\\tester',
          },
        }}
      >
        <AssistantDock activeId="home" onSelect={() => {}} />
      </ProjectProvider>,
    );
    openAssistant();
    send('limpiá el video');
    expect(await screen.findByText(/Limpieza automática:/)).toBeTruthy();
    expect(screen.getByText(/volumen nivelado/)).toBeTruthy();
    expect(screen.getByText(/zoom\(s\)/)).toBeTruthy();
  });
});

describe('cortes por pausas de voz del asistente', () => {
  function voiceProject(withCues: boolean) {
    const asset = readyAsset({
      kind: 'audio',
      label: 'Voz',
      source: { type: 'local', path: 'media/voz.wav' },
      media: { sampleRate: 48_000, channels: 1, durationFrames: 300 },
    });
    let project = addAsset(ensureDelivery(createEmptyProject('Pausas', NOW)), asset);
    const added = addClipFromAsset(project, asset, { atFrame: 0, durationFrames: 150 });
    project = added.project;
    if (withCues) {
      const seeded = addCaptionCue(project, { text: 'base', startFrame: 0, durationFrames: 1 });
      project = {
        ...seeded.project,
        captions: {
          ...seeded.project.captions,
          cues: [
            {
              id: '00000000-0000-4000-8000-00000000000c',
              trackId: seeded.trackId,
              text: 'Primera frase',
              language: 'es',
              startFrame: 0,
              endFrame: 30,
              words: [
                { text: 'Primera', startFrame: 0, endFrame: 15 },
                { text: 'frase', startFrame: 15, endFrame: 30 },
              ],
            },
            {
              id: '00000000-0000-4000-8000-00000000000d',
              trackId: seeded.trackId,
              text: 'Segunda frase',
              language: 'es',
              startFrame: 60,
              endFrame: 90,
              words: [
                { text: 'Segunda', startFrame: 60, endFrame: 75 },
                { text: 'frase', startFrame: 75, endFrame: 90 },
              ],
            },
          ],
        },
      } as typeof project;
    }
    return {
      project,
      opened: {
        project,
        label: 'pausas.editoria.json',
        path: 'C:\\tester\\pausas.editoria.json',
        root: 'C:\\tester',
      },
    };
  }

  it('corta las pausas de los subtítulos existentes', async () => {
    const { project, opened } = voiceProject(true);
    const service = createFakeService();
    render(
      <ProjectProvider service={service} initial={{ project, opened }}>
        <AssistantDock activeId="home" onSelect={() => {}} />
      </ProjectProvider>,
    );
    openAssistant();
    send('cortá las pausas');
    expect(await screen.findByText(/Recorté 1 pausa\(s\) en 1 clip\(s\)/)).toBeTruthy();
  });

  it('sin subtítulos transcribe primero y lo dice', async () => {
    const { project, opened } = voiceProject(false);
    const service = createFakeService();
    service.transcribeAsset = async () => ({
      language: 'es',
      languageProbability: 0.98,
      durationSeconds: 3,
      model: 'small',
      segments: [
        {
          start: 0,
          end: 1,
          text: 'Primera frase.',
          words: [
            { start: 0, end: 0.5, word: 'Primera', probability: 0.9 },
            { start: 0.5, end: 1, word: 'frase.', probability: 0.9 },
          ],
        },
        {
          start: 2,
          end: 3,
          text: 'Segunda frase.',
          words: [
            { start: 2, end: 2.5, word: 'Segunda', probability: 0.9 },
            { start: 2.5, end: 3, word: 'frase.', probability: 0.9 },
          ],
        },
      ],
    });
    render(
      <ProjectProvider service={service} initial={{ project, opened }}>
        <AssistantDock activeId="home" onSelect={() => {}} />
      </ProjectProvider>,
    );
    openAssistant();
    send('cortá las pausas');
    expect(
      await screen.findByText(/Generé 2 subtítulo\(s\) para medir las frases/),
    ).toBeTruthy();
    expect(screen.getByText(/Recorté 1 pausa\(s\) en 1 clip\(s\)/)).toBeTruthy();
  });
});

describe('subtítulos automáticos del asistente', () => {
  function projectWithVoice() {
    const asset = readyAsset({
      kind: 'audio',
      label: 'Voz',
      source: { type: 'local', path: 'media/voz.wav' },
      media: { sampleRate: 48_000, channels: 1, durationFrames: 300 },
    });
    let project = addAsset(ensureDelivery(createEmptyProject('Subtítulos', NOW)), asset);
    const added = addClipFromAsset(project, asset, { atFrame: 0, durationFrames: 300 });
    project = added.project;
    return {
      project,
      opened: {
        project,
        label: 'subtitulos.editoria.json',
        path: 'C:\\tester\\subtitulos.editoria.json',
        root: 'C:\\tester',
      },
    };
  }

  it('transcribe la voz y crea los cues en un solo paso', async () => {
    const { project, opened } = projectWithVoice();
    const service = createFakeService();
    render(
      <ProjectProvider service={service} initial={{ project, opened }}>
        <AssistantDock activeId="home" onSelect={() => {}} />
      </ProjectProvider>,
    );
    openAssistant();
    send('subtitulá el clip');
    expect(await screen.findByText(/Generé 2 subtítulo\(s\)/)).toBeTruthy();
    expect(screen.getByText(/Whisper small/)).toBeTruthy();
  });

  it('sin texto que transcribir lo explica sin tocar la timeline', async () => {
    const base = ensureDelivery(createEmptyProject('Sin voz', NOW));
    const image = readyAsset({ label: 'Foto' });
    const project = addAsset(base, image);
    const service = createFakeService();
    render(
      <ProjectProvider
        service={service}
        initial={{
          project,
          opened: { project, label: 'p.json', path: 'C:\\tester\\p.json', root: 'C:\\tester' },
        }}
      >
        <AssistantDock activeId="home" onSelect={() => {}} />
      </ProjectProvider>,
    );
    openAssistant();
    send('subtitulá el clip');
    expect(
      await screen.findByText(/No hay clips con audio en pistas desbloqueadas/),
    ).toBeTruthy();
  });
});

describe('acciones rápidas del asistente', () => {
  it('ejecutan sin llamar al modelo', async () => {
    const service = createFakeService();
    const spy = vi.spyOn(service, 'assistantChat');
    const asset = readyImage('Toma');
    let project = addAsset(ensureDelivery(createEmptyProject('Rápidas', NOW)), asset);
    project = addClipFromAsset(project, asset, { atFrame: 0, durationFrames: 90 }).project;
    render(
      <ProjectProvider service={service} initial={{ project, opened: null }}>
        <AssistantDock activeId="home" onSelect={() => {}} />
      </ProjectProvider>,
    );
    openAssistant();
    fireEvent.click(screen.getByRole('button', { name: 'Silencios' }));
    await screen.findByText(/No hay clips con audio/);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('recuperación del proveedor desde el estado de error', () => {
  function failingService() {
    const service = createFakeService();
    service.getProvider = async () => ({
      kind: 'openai-compatible',
      baseUrl: 'http://127.0.0.1:11434/v1',
      model: 'llama3.1',
      hasKey: false,
      keyringAvailable: true,
    });
    service.assistantChat = async () => {
      throw new Error(
        'no se pudo conectar con el proveedor; revisá la URL y que el servicio esté encendido',
      );
    };
    return service;
  }

  async function renderErrorState(service: ReturnType<typeof createFakeService>, onSelect = vi.fn()) {
    render(
      <ProjectProvider service={service}>
        <AssistantDock activeId="home" onSelect={onSelect} />
      </ProjectProvider>,
    );
    openAssistant();
    send('contame algo');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('no se pudo conectar con el proveedor');
    return onSelect;
  }

  it('ofrece probar el proveedor y muestra el resultado tipado', async () => {
    const service = failingService();
    let probes = 0;
    service.testProvider = async () => {
      probes += 1;
      return {
        status: 'ok',
        ok: true,
        httpStatus: 200,
        latencyMs: 12,
        model: 'llama3.1',
        detail:
          'conexión correcta: el modelo configurado «llama3.1» está disponible en el proveedor',
        baseUrl: 'http://127.0.0.1:11434/v1',
      };
    };
    const onSelect = await renderErrorState(service);

    const group = screen.getByRole('group', { name: 'Recuperar proveedor' });
    fireEvent.click(within(group).getByRole('button', { name: 'Probar proveedor' }));

    const notice = await screen.findByText(/Conexión correcta en 12 ms/);
    expect(notice.textContent).toContain('llama3.1');
    expect(probes).toBe(1);

    fireEvent.click(screen.getByRole('button', { name: 'Abrir Ajustes' }));
    expect(onSelect).toHaveBeenCalledWith('settings');
  });

  it('si el sondeo falla muestra el motivo del backend, no un éxito', async () => {
    const service = failingService();
    service.testProvider = async () => {
      throw new Error(
        'no se pudo conectar: el servicio está apagado, la URL es incorrecta o un firewall bloquea el puerto',
      );
    };
    await renderErrorState(service);
    fireEvent.click(screen.getByRole('button', { name: 'Probar proveedor' }));
    expect(
      await screen.findByText(/el servicio está apagado, la URL es incorrecta/),
    ).toBeTruthy();
    expect(screen.queryByText(/Conexión correcta/)).toBeNull();
  });

  it('muestra el estado busy mientras el sondeo está en curso', async () => {
    const service = failingService();
    let resolveProbe: (result: {
      status: string;
      ok: boolean;
      httpStatus: number | null;
      latencyMs: number;
      model: string | null;
      detail: string;
      baseUrl: string;
    }) => void = () => {};
    service.testProvider = () =>
      new Promise((resolve) => {
        resolveProbe = resolve;
      });
    await renderErrorState(service);

    fireEvent.click(screen.getByRole('button', { name: 'Probar proveedor' }));
    const probing = await screen.findByRole('button', { name: 'Probando…' });
    expect((probing as HTMLButtonElement).disabled).toBe(true);

    resolveProbe({
      status: 'timeout',
      ok: false,
      httpStatus: null,
      latencyMs: 8_000,
      model: null,
      detail: 'el proveedor no respondió en 8 segundos; revisá que Ollama esté encendido',
      baseUrl: 'http://127.0.0.1:11434/v1',
    });
    expect(await screen.findByText(/no respondió en 8 segundos/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Probando…' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Probar proveedor' })).toBeTruthy();
  });

  it('sin error no muestra acciones de recuperación', async () => {
    render(<App service={createFakeService()} />);
    openAssistant();
    expect(screen.queryByRole('button', { name: 'Probar proveedor' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Abrir Ajustes' })).toBeNull();
  });
});
