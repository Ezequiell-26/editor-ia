// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createEmptyProject } from '@editor-ia/project-schema';
import { addScene } from '../../state/project-actions';
import { ProjectProvider } from '../../state/project-store';
import { createFakeService } from '../../test/fake-service';
import { TeleprompterView } from './TeleprompterView';

const NOW = '2026-10-20T00:00:00.000Z';

function renderView() {
  const project = createEmptyProject('Tele', NOW);
  const service = createFakeService();
  render(
    <ProjectProvider
      service={service}
      initial={{
        project,
        opened: {
          project,
          label: 'tele.editoria.json',
          path: 'C:\\tester\\tele.editoria.json',
          root: 'C:\\tester',
        },
      }}
    >
      <TeleprompterView />
    </ProjectProvider>,
  );
  return { project, service };
}

function projectWithScript() {
  const project = createEmptyProject('Tele', NOW);
  const added = addScene(project, {
    title: 'Intro',
    intent: 'hook',
    narration: 'Hola, esto es una prueba del teleprompter.',
  });
  return added.project;
}

describe('TeleprompterView', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it('muestra el estado vacío y el textarea para pegar el guion', () => {
    renderView();
    expect(screen.getByText(/El teleprompter está vacío/)).toBeTruthy();
    expect(screen.getByLabelText('Guion del teleprompter')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reproducir teleprompter' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Grabar voz' })).toBeTruthy();
  });

  it('divide el guion en líneas y resalta la activa al leer', () => {
    renderView();
    fireEvent.change(screen.getByLabelText('Guion del teleprompter'), {
      target: { value: 'primera línea\n\nsegunda línea' },
    });
    const region = screen.getByRole('region', { name: 'Texto del teleprompter' });
    const paragraphs = region.querySelectorAll('p');
    expect(paragraphs).toHaveLength(2);

    const play = screen.getByRole('button', { name: 'Reproducir teleprompter' });
    fireEvent.click(play);
    expect(screen.getByRole('button', { name: 'Detener teleprompter' })).toBeTruthy();
    const active = region.querySelector('p.active');
    expect(active?.textContent).toBe('primera línea');
    expect(active?.getAttribute('aria-current')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Detener teleprompter' }));
    // Al detener se conserva la línea activa: marca dónde quedó la lectura.
    expect(screen.getByRole('button', { name: 'Reproducir teleprompter' })).toBeTruthy();
    expect(region.querySelector('p.active')?.textContent).toBe('primera línea');
  });

  it('Espacio en el escenario alterna el scroll', () => {
    renderView();
    fireEvent.change(screen.getByLabelText('Guion del teleprompter'), {
      target: { value: 'una línea para leer' },
    });
    const region = screen.getByRole('region', { name: 'Texto del teleprompter' });
    fireEvent.keyDown(region, { key: ' ' });
    expect(region.querySelector('p.active')).toBeTruthy();
    fireEvent.keyDown(region, { key: ' ' });
    expect(screen.getByRole('button', { name: 'Reproducir teleprompter' })).toBeTruthy();
  });

  it('sin guion, Leer avisa en vez de arrancar', () => {
    renderView();
    fireEvent.click(screen.getByRole('button', { name: 'Reproducir teleprompter' }));
    // El botón vuelve a «Reproducir»: no quedó en estado de lectura.
    expect(screen.getByRole('button', { name: 'Reproducir teleprompter' })).toBeTruthy();
  });

  it('«Usar guion del proyecto» carga la narración de las escenas', () => {
    const project = projectWithScript();
    const service = createFakeService();
    render(
      <ProjectProvider
        service={service}
        initial={{
          project,
          opened: { project, label: 't.editoria.json', path: 'C:\\t\\t.editoria.json', root: 'C:\\t' },
        }}
      >
        <TeleprompterView />
      </ProjectProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Usar guion del proyecto' }));
    expect(
      (screen.getByLabelText('Guion del teleprompter') as HTMLTextAreaElement).value,
    ).toContain('teleprompter');
    expect(window.localStorage.getItem(`editoria.teleprompter.script.${project.id}`)).toContain(
      'teleprompter',
    );
  });

  it('el botón de guion del proyecto está deshabilitado sin proyecto', () => {
    render(
      <ProjectProvider service={createFakeService()}>
        <TeleprompterView />
      </ProjectProvider>,
    );
    expect(
      (screen.getByRole('button', { name: 'Usar guion del proyecto' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});
