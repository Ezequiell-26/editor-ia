// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createEmptyProject } from '@editor-ia/project-schema';
import { FlowQueueProvider } from '../../state/FlowQueueProvider';
import { ProjectProvider } from '../../state/project-store';
import { createFakeService } from '../../test/fake-service';
import { FlowQueueCard } from './FlowQueueCard';

function renderCard() {
  const service = createFakeService();
  render(
    <ProjectProvider
      service={service}
      initial={{ project: createEmptyProject('Flow', '2025-01-01T00:00:00Z') }}
    >
      <FlowQueueProvider>
        <FlowQueueCard serverId="flow" outputFolder={'C:\\media'} />
      </FlowQueueProvider>
    </ProjectProvider>,
  );
  return service;
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('cola de generación de Flow', () => {
  it('no deja iniciar sin autorizar créditos', () => {
    renderCard();
    fireEvent.change(screen.getByLabelText(/Prompts/), {
      target: { value: 'un faro al atardecer' },
    });
    const start = screen.getByRole('button', { name: /Iniciar lote/i }) as HTMLButtonElement;
    expect(start.disabled).toBe(true);

    fireEvent.click(screen.getByLabelText(/Autorizo consumir créditos/i));
    expect(start.disabled).toBe(false);
  });

  it('genera una imagen por prompt, las importa y deja el registro', async () => {
    const service = renderCard();
    fireEvent.change(screen.getByLabelText(/Prompts/), {
      target: { value: 'un faro al atardecer\nun bosque nevado' },
    });
    // Sin espera para que el test no dependa del reloj.
    fireEvent.change(screen.getByRole('slider', { name: 'Espera entre imágenes' }), {
      target: { value: '0' },
    });
    fireEvent.click(screen.getByLabelText(/Autorizo consumir créditos/i));
    fireEvent.click(screen.getByRole('button', { name: /Iniciar lote/i }));

    await waitFor(() => {
      const numbers = document.querySelector('.flow-queue-numbers')?.textContent ?? '';
      expect(numbers).toMatch(/2 imág/);
    });

    expect(service.calls.import).toBe(2);
    const log = document.querySelectorAll('.flow-queue-log li');
    expect(log.length).toBe(2);
    expect(document.querySelector('.flow-queue-state')?.textContent).toMatch(/completado/i);
  });

  it('rota de cuenta cuando la primera se queda sin créditos', async () => {
    const service = createFakeService();
    const generateCalls: unknown[] = [];
    const original = service.callMcpTool.bind(service);
    service.callMcpTool = async (id: string, tool: string, args: unknown) => {
      if (tool === 'flow_list_accounts') {
        return {
          serverId: id,
          toolName: tool,
          isError: false,
          elapsedMs: 1,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  accounts: [
                    { id: 'acc-a', label: 'Cuenta A', connectionStatus: 'connected' },
                    { id: 'acc-b', label: 'Cuenta B', connectionStatus: 'connected' },
                  ],
                  defaultAccountId: 'acc-a',
                }),
              },
            ],
          },
        };
      }
      if (tool === 'flow_generate_image') {
        generateCalls.push(args);
        const accountId = (args as { accountId?: string } | null)?.accountId;
        if (accountId === 'acc-a') {
          return {
            serverId: id,
            toolName: tool,
            isError: true,
            elapsedMs: 1,
            result: {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    error: { code: 'insufficient_credits', message: 'not enough credits' },
                  }),
                },
              ],
            },
          };
        }
      }
      return original(id, tool, args);
    };

    render(
      <ProjectProvider
        service={service}
        initial={{ project: createEmptyProject('Flow', '2025-01-01T00:00:00Z') }}
      >
        <FlowQueueProvider>
          <FlowQueueCard serverId="flow" outputFolder={'C:\\media'} />
        </FlowQueueProvider>
      </ProjectProvider>,
    );
    fireEvent.change(screen.getByLabelText(/Prompts/), {
      target: { value: 'un faro al atardecer' },
    });
    fireEvent.change(screen.getByRole('slider', { name: 'Espera entre imágenes' }), {
      target: { value: '0' },
    });
    fireEvent.click(screen.getByLabelText(/Autorizo consumir créditos/i));
    fireEvent.click(screen.getByRole('button', { name: /Iniciar lote/i }));

    await waitFor(() => {
      expect(document.querySelector('.flow-queue-state')?.textContent).toMatch(/completado/i);
    });
    // La cola probó la cuenta sin créditos y siguió con la siguiente.
    const accounts = generateCalls.map(
      (args) => (args as { accountId?: string } | null)?.accountId,
    );
    expect(accounts).toEqual(['acc-a', 'acc-b']);
    expect(service.calls.import).toBe(1);
  });

  it('guarda el borrador de prompts entre montajes', () => {
    const { unmount } = render(
      <ProjectProvider
        service={createFakeService()}
        initial={{ project: createEmptyProject('Flow', '2025-01-01T00:00:00Z') }}
      >
        <FlowQueueProvider>
          <FlowQueueCard serverId="flow" outputFolder={'C:\\media'} />
        </FlowQueueProvider>
      </ProjectProvider>,
    );
    fireEvent.change(screen.getByLabelText(/Prompts/), {
      target: { value: 'prompt persistente' },
    });
    unmount();

    render(
      <ProjectProvider
        service={createFakeService()}
        initial={{ project: createEmptyProject('Flow', '2025-01-01T00:00:00Z') }}
      >
        <FlowQueueProvider>
          <FlowQueueCard serverId="flow" outputFolder={'C:\\media'} />
        </FlowQueueProvider>
      </ProjectProvider>,
    );
    const textarea = screen.getByLabelText(/Prompts/) as HTMLTextAreaElement;
    expect(textarea.value).toBe('prompt persistente');
  });
});
