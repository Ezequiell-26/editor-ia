// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyProject } from '@editor-ia/project-schema';
import { ProjectProvider } from '../../state/project-store';
import { addAsset, ensureDelivery } from '../../state/project-actions';
import { createFakeService, readyAsset } from '../../test/fake-service';
import { AutoEditView } from './AutoEditView';

const NOW = '2026-10-27T00:00:00.000Z';

afterEach(cleanup);

function renderView(withVideo = true) {
  const base = ensureDelivery(createEmptyProject('Auto', NOW));
  const project = withVideo ? addAsset(base, readyAsset({ kind: 'video' })) : base;
  const onNavigate = vi.fn();
  const service = createFakeService();
  render(
    <ProjectProvider
      service={service}
      initial={{
        project,
        opened: {
          project,
          label: 'auto.editoria.json',
          path: 'C:\\tester\\auto.editoria.json',
          root: 'C:\\tester',
        },
      }}
    >
      <AutoEditView onNavigate={onNavigate} />
    </ProjectProvider>,
  );
  return { onNavigate, service };
}

async function analyze() {
  fireEvent.click(screen.getByRole('button', { name: /Analizar material/i }));
  await screen.findByText('Pulso rápido');
}

describe('editor automático', () => {
  it('analiza el material y arma cuatro variantes', async () => {
    renderView();
    expect(screen.getByRole('heading', { name: /Editor automático/i })).toBeTruthy();
    await analyze();
    expect(screen.getByText('Tu receta')).toBeTruthy();
    expect(screen.getByText('Pulso rápido')).toBeTruthy();
    expect(screen.getByText('Historia')).toBeTruthy();
    expect(screen.getByText('Impacto')).toBeTruthy();
    expect(screen.getAllByText(/escenas/i).length).toBeGreaterThan(0);
  });

  it('la receta reconstruye las variantes sin volver a medir', async () => {
    renderView();
    await analyze();
    const before = screen.getAllByRole('group', { name: /Cortes de/i }).length;
    expect(before).toBeGreaterThan(0);

    const slider = screen.getByRole('slider', { name: /Duración media del corte/i });
    fireEvent.change(slider, { target: { value: '6' } });
    await waitFor(() =>
      expect(screen.getByRole('slider', { name: /Duración media del corte/i })).toHaveProperty(
        'value',
        '6',
      ),
    );
    // Sigue habiendo variantes: se recalcularon en memoria.
    expect(screen.getAllByRole('group', { name: /Cortes de/i }).length).toBe(before);
  });

  it('permite deseleccionar cortes desde la timeline', async () => {
    renderView();
    await analyze();
    const groups = screen.getAllByRole('group', { name: /Cortes de/i });
    const first = within(groups[0]!);
    const cuts = first.getAllByRole('button');
    expect(cuts.length).toBeGreaterThan(1);
    const before = screen.getAllByText(/de \d+ cortes/)[0]!.textContent ?? '';
    fireEvent.click(cuts[0]!);
    await waitFor(() => {
      const after = screen.getAllByText(/de \d+ cortes/)[0]!.textContent ?? '';
      expect(after).not.toBe(before);
    });
  });

  it('aplica una variante a la timeline y navega al editor', async () => {
    const { onNavigate } = renderView();
    await analyze();
    const apply = screen.getAllByRole('button', { name: /Reemplazar timeline/i })[0]!;
    fireEvent.click(apply);
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith('editor'));
  });

  it('importa un SRT y lo usa para subtitular las variantes', async () => {
    renderView();
    await analyze();
    fireEvent.click(screen.getByRole('button', { name: /Importar SRT\/VTT/i }));
    expect(await screen.findByText(/subtítulos cargados/i)).toBeTruthy();
    expect(screen.getAllByText(/1 subtítulo/i).length).toBeGreaterThan(0);
  });

  it('sin videos ofrece ir a Medios', () => {
    renderView(false);
    expect(screen.getByText(/No hay videos listos/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Ir a Medios/i })).toBeTruthy();
  });
});

describe('criterio de la IA', () => {
  it('no consulta sin autorización de cuota', async () => {
    const { service } = renderView();
    await analyze();
    const spy = vi.spyOn(service, 'assistantChat');
    const button = screen.getAllByRole('button', { name: /Criterio IA/i })[0]!;
    expect(button.hasAttribute('disabled')).toBe(true);
    fireEvent.click(button);
    expect(spy).not.toHaveBeenCalled();
  });

  it('avisa cuando el proveedor está simulado y no toca los cortes', async () => {
    const { service } = renderView();
    await analyze();
    fireEvent.click(
      screen.getByRole('checkbox', { name: /Autorizo el consumo de cuota/i }),
    );
    const before = screen.getAllByText(/de \d+ cortes/)[0]!.textContent;
    fireEvent.click(screen.getAllByRole('button', { name: /Criterio IA/i })[0]!);
    expect(await screen.findByText(/modo simulado/i)).toBeTruthy();
    expect(screen.getAllByText(/de \d+ cortes/)[0]!.textContent).toBe(before);
    expect(service.calls.sharpenRenders).toBe(0);
  });

  it('aplica el orden propuesto cuando la respuesta es válida', async () => {
    const { service } = renderView();
    await analyze();
    fireEvent.click(
      screen.getByRole('checkbox', { name: /Autorizo el consumo de cuota/i }),
    );
    // El proveedor simulado no sirve para esto: se responde como uno real.
    const cutsCount = within(
      screen.getAllByRole('group', { name: /Cortes de/i })[0]!,
    ).getAllByRole('button').length;
    const order = Array.from({ length: cutsCount }, (_, index) => cutsCount - 1 - index);
    vi.spyOn(service, 'assistantChat').mockResolvedValue({
      reply: JSON.stringify({
        title: 'Apertura medida',
        hook: 'Arrancamos por lo mejor.',
        notes: 'El gancho primero.',
        order,
      }),
      action: null,
      providerId: 'real',
      model: 'modelo-real',
      simulated: false,
    });

    fireEvent.click(screen.getAllByRole('button', { name: /Criterio IA/i })[0]!);
    expect(await screen.findByText('Apertura medida')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Aplicar orden/i }));
    expect(await screen.findByText(/reordenado por la IA/i)).toBeTruthy();
  });
});
