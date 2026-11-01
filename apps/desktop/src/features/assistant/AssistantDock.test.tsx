// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../../App';
import { createFakeService } from '../../test/fake-service';

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

  it('consulta al proveedor cuando el comando no es local', async () => {
    render(<App service={createFakeService()} />);
    openAssistant();
    send('contame algo');
    expect(await screen.findByText(/Respuesta del proveedor de prueba/i)).toBeTruthy();
  });

  it('ejecuta herramientas del agente cuando se habilitan', async () => {
    const service = createFakeService();
    const calls: unknown[] = [];
    let round = 0;
    service.assistantAgent = async (request) => {
      calls.push(request);
      round += 1;
      if (round === 1) {
        return {
          reply: '',
          toolCalls: [
            { id: 'call_1', name: 'navigate', arguments: { view: 'editor' } },
          ],
          finishReason: 'tool_calls',
          providerId: 'test',
          model: 'test',
        };
      }
      return {
        reply: 'Listo.',
        toolCalls: [],
        finishReason: 'stop',
        providerId: 'test',
        model: 'test',
      };
    };
    render(<App service={service} />);
    openAssistant();
    fireEvent.click(
      screen.getByLabelText('Herramientas del agente (buscar archivos, importar y editar el proyecto)'),
    );
    send('abrí el editor');
    expect(
      await screen.findByText(/Vista abierta: editor/, {}, { timeout: 3_000 }),
    ).toBeTruthy();
    expect(calls.length).toBe(2);
  });

  it('usa herramientas automáticamente cuando el agente es Anthropic', async () => {
    const service = createFakeService();
    service.getProvider = async () => ({
      kind: 'openai-compatible',
      agentKind: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
      model: 'claude-test',
      hasKey: true,
      keyringAvailable: true,
    });
    let agentCalls = 0;
    service.assistantAgent = async () => {
      agentCalls += 1;
      return {
        reply: 'Hola desde Anthropic.',
        toolCalls: [],
        finishReason: 'end_turn',
        providerId: 'anthropic',
        model: 'claude-test',
      };
    };
    service.assistantChat = async () => {
      throw new Error('el modo Anthropic no debe usar el chat OpenAI');
    };
    render(<App service={service} />);
    openAssistant();
    const toggle = (await screen.findByLabelText(
      /Herramientas del agente/,
    )) as HTMLInputElement;
    await waitFor(() => expect(toggle.disabled).toBe(true));
    fireEvent.click(screen.getByLabelText(/Permitir llamada remota/i));
    send('contame algo');
    expect(await screen.findByText(/Hola desde Anthropic/i)).toBeTruthy();
    expect(agentCalls).toBe(1);
    expect(toggle.disabled).toBe(true);
    expect(toggle.checked).toBe(true);
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
});
