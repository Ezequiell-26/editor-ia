// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createEmptyProject, type ProjectDocument } from '@editor-ia/project-schema';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeService } from '../../test/fake-service';
import { addCaptionCue } from '../../state/project-actions';
import { addMarker } from '../../state/markers';
import { ProjectProvider, useProjectStore } from '../../state/project-store';
import { MarkersPanel } from './MarkersPanel';

const NOW = '2026-01-01T00:00:00.000Z';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/**
 * El playhead se recorta a la duración del proyecto (`store.setPlayhead`), así
 * que los proyectos de prueba necesitan contenido: un subtítulo largo basta.
 */
function withDuration(project: ProjectDocument): ProjectDocument {
  return addCaptionCue(project, { text: 'demo', startFrame: 0, durationFrames: 900 })
    .project;
}

function buildProject(): ProjectDocument {
  const base = createEmptyProject('Panel de marcadores', NOW);
  const first = addMarker(base, 90, { label: 'Intro', color: 'amber' });
  const second = addMarker(first.project, 300, {
    label: 'Entrevista',
    note: 'Revisar el audio de la segunda pregunta',
  });
  return withDuration(second.project);
}

function PlayheadProbe() {
  const store = useProjectStore();
  const project = store.state.project;
  const marker = project?.markers.find(
    (item) => item.frame === store.state.playheadFrame,
  );
  const intro = project?.markers.find((item) => item.label === 'Intro');
  return (
    <div>
      <span data-testid="playhead">{String(store.state.playheadFrame)}</span>
      <span data-testid="marcador-en-playhead">{marker ? marker.label : 'ninguno'}</span>
      <span data-testid="nota-entrevista">
        {project?.markers.find((item) => item.label === 'Entrevista')?.note ?? 'sin nota'}
      </span>
      <span data-testid="color-intro">{intro?.color ?? 'sin color'}</span>
      <span data-testid="total-marcadores">{String(project?.markers.length ?? 0)}</span>
      <span data-testid="error">{store.state.error ?? 'sin error'}</span>
    </div>
  );
}

function renderPanel(project: ProjectDocument) {
  const service = createFakeService();
  const opened = {
    project,
    label: 'marcadores.editoria.json',
    path: 'C:\\tmp\\marcadores.editoria.json',
    root: 'C:\\tmp',
  };
  service.current = opened;
  return render(
    <ProjectProvider service={service} initial={{ project, opened }}>
      <MarkersPanel />
      <PlayheadProbe />
    </ProjectProvider>,
  );
}

describe('Panel de marcadores', () => {
  it('lista los marcadores ordenados por tiempo aunque se hayan creado desordenados', () => {
    const base = createEmptyProject('Desorden', NOW);
    const late = addMarker(base, 300, { label: 'Tarde' });
    const both = addMarker(late.project, 30, { label: 'Temprano' });
    renderPanel(withDuration(both.project));

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]?.textContent).toContain('Temprano');
    expect(items[1]?.textContent).toContain('Tarde');
    expect(screen.getByRole('button', { name: /ir al marcador temprano/i })).toBeTruthy();
  });

  it('salta el playhead al hacer clic en un marcador', () => {
    renderPanel(buildProject());

    fireEvent.click(screen.getByRole('button', { name: /ir al marcador intro/i }));
    expect(screen.getByTestId('playhead').textContent).toBe('90');
    expect(screen.getByTestId('marcador-en-playhead').textContent).toBe('Intro');
  });

  it('muestra la nota guardada en cada fila', () => {
    renderPanel(buildProject());

    // La nota aparece en la fila del panel y en el sondeo de estado.
    expect(screen.getAllByText('Revisar el audio de la segunda pregunta').length).toBeGreaterThanOrEqual(1);
  });

  it('edita la nota de un marcador y la guarda en el proyecto', () => {
    renderPanel(buildProject());

    fireEvent.click(screen.getByRole('button', { name: /editar marcador entrevista/i }));
    const noteField = screen.getByRole('textbox', { name: /nota de entrevista/i });
    expect((noteField as HTMLTextAreaElement).value).toBe(
      'Revisar el audio de la segunda pregunta',
    );
    fireEvent.change(noteField, { target: { value: 'Cortar la pausa del minuto dos' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar nota' }));

    expect(screen.getByTestId('nota-entrevista').textContent).toBe(
      'Cortar la pausa del minuto dos',
    );
  });

  it('cambia el color de un marcador desde las muestras de color', () => {
    renderPanel(buildProject());
    expect(screen.getByTestId('color-intro').textContent).toBe('amber');

    fireEvent.click(screen.getByRole('button', { name: /editar marcador intro/i }));
    fireEvent.click(screen.getByRole('button', { name: /color rosa/i }));

    expect(screen.getByTestId('color-intro').textContent).toBe('rose');
  });

  it('quita el color al pulsar de nuevo la muestra activa', () => {
    renderPanel(buildProject());

    fireEvent.click(screen.getByRole('button', { name: /editar marcador intro/i }));
    const swatch = screen.getByRole('button', { name: /color ámbar/i });
    expect(swatch.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(swatch);
    expect(swatch.getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByTestId('color-intro').textContent).toBe('sin color');
  });

  it('elimina un marcador desde su editor', () => {
    renderPanel(buildProject());

    fireEvent.click(screen.getByRole('button', { name: /editar marcador intro/i }));
    fireEvent.click(screen.getByRole('button', { name: /eliminar marcador/i }));

    expect(screen.queryByRole('button', { name: /ir al marcador intro/i })).toBeNull();
    expect(screen.getByTestId('total-marcadores').textContent).toBe('1');
  });

  it('los botones de cabecera saltan al marcador anterior y siguiente', () => {
    renderPanel(buildProject());

    // El playhead arranca en 0: "siguiente" lleva a Intro (frame 90).
    fireEvent.click(screen.getByRole('button', { name: /ir al marcador siguiente/i }));
    expect(screen.getByTestId('marcador-en-playhead').textContent).toBe('Intro');
    // Sobre Intro, "siguiente" lleva a Entrevista (frame 300).
    fireEvent.click(screen.getByRole('button', { name: /ir al marcador siguiente/i }));
    expect(screen.getByTestId('marcador-en-playhead').textContent).toBe('Entrevista');
    // Y "anterior" vuelve a Intro.
    fireEvent.click(screen.getByRole('button', { name: /ir al marcador anterior/i }));
    expect(screen.getByTestId('marcador-en-playhead').textContent).toBe('Intro');
    // Desde el primer marcador, "anterior" queda deshabilitado.
    const previousButton = screen.getByRole('button', { name: /ir al marcador anterior/i });
    expect(previousButton.hasAttribute('disabled')).toBe(true);
  });

  it('muestra el estado vacío cuando el proyecto no tiene marcadores', () => {
    renderPanel(createEmptyProject('Vacío', NOW));

    expect(screen.getByText(/sin marcadores todavía/i)).toBeTruthy();
    expect(screen.getByTestId('total-marcadores').textContent).toBe('0');
  });

  it('resalta el marcador bajo el playhead con aria-current', () => {
    renderPanel(buildProject());

    const intro = screen.getByRole('button', { name: /ir al marcador intro/i });
    fireEvent.click(intro);
    expect(intro.getAttribute('aria-current')).toBe('true');
  });
});
