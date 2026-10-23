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
