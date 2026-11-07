// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyProject } from '@editor-ia/project-schema';
import { ProjectProvider } from '../../state/project-store';
import { createFakeService } from '../../test/fake-service';
import { SubtitlePipelineCard } from './SubtitlePipelineCard';

const NOW = '2026-11-07T00:00:00.000Z';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

function renderCard(patch?: (service: ReturnType<typeof createFakeService>) => void) {
  const project = createEmptyProject('Localización', NOW);
  const service = createFakeService();
  patch?.(service);
  render(
    <ProjectProvider
      service={service}
      initial={{
        project,
        opened: {
          project,
          label: 'local.editoria.json',
          path: 'C:\\tester\\local.editoria.json',
          root: 'C:\\tester',
        },
      }}
    >
      <SubtitlePipelineCard />
    </ProjectProvider>,
  );
  return service;
}

describe('SubtitlePipelineCard', () => {
  it('ejecuta el pipeline sobre el video elegido', async () => {
    const service = renderCard((svc) => {
      svc.chooseVideoFile = async () => 'C:\\media\\charla.mp4';
    });
    const spy = vi.spyOn(service, 'subtitlesPipeline');
    fireEvent.click(screen.getByRole('button', { name: /Elegir video/ }));
    await waitFor(() => expect(screen.getByText('charla.mp4')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Generar subtítulos/ }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    const input = spy.mock.calls[0]?.[0] as { inputPath: string; targetLanguage: string };
    expect(input.inputPath).toContain('charla.mp4');
    expect(input.targetLanguage).toBe('en');
    await waitFor(() => expect(screen.getByText(/subtítulos · idioma/)).toBeTruthy());
  });

  it('avisa si no hay video elegido', async () => {
    renderCard();
    const button = screen.getByRole('button', { name: /Generar subtítulos/ });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });
});
