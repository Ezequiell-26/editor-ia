// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyProject } from '@editor-ia/project-schema';
import { AudioProviderCard } from './AudioProviderCard';
import { ProjectProvider } from '../../state/project-store';
import { ensureDelivery } from '../../state/project-actions';
import { createFakeService } from '../../test/fake-service';

const NOW = '2026-10-19T00:00:00.000Z';

function renderCard() {
  const project = ensureDelivery(createEmptyProject('Audio', NOW));
  const service = createFakeService();
  const spy = vi.spyOn(service, 'saveAudioProvider');
  render(
    <ProjectProvider
      service={service}
      initial={{
        project,
        opened: {
          project,
          label: 'audio.editoria.json',
          path: 'C:\\tester\\audio.editoria.json',
          root: 'C:\\tester',
        },
      }}
    >
      <AudioProviderCard />
    </ProjectProvider>,
  );
  return { service, spy };
}

afterEach(() => cleanup());

describe('AudioProviderCard', () => {
  it('no manda una URL externa cuando el proveedor es SAPI', async () => {
    const { spy } = renderCard();
    await waitFor(() => expect(screen.getByLabelText('Voz instalada')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Guardar proveedor de audio/i }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(spy.mock.calls[0]?.[0]).toMatchObject({
      kind: 'windows-sapi',
      externalUrl: '',
    });
  });

  it('manda la URL HTTPS solo con el proveedor web manual', async () => {
    const { spy } = renderCard();
    const select = screen.getByLabelText('Proveedor');
    fireEvent.change(select, { target: { value: 'external-web' } });
    const url = screen.getByLabelText(/URL de la web/i);
    fireEvent.change(url, { target: { value: 'https://example.com/tts' } });
    fireEvent.click(screen.getByRole('button', { name: /Guardar proveedor de audio/i }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(spy.mock.calls[0]?.[0]).toMatchObject({
      kind: 'external-web',
      externalUrl: 'https://example.com/tts',
    });
  });
});
