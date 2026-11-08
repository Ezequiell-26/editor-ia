// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createInstance, effectRegistry, type EffectStack } from '@editor-ia/effect-kit';
import { loadEffectTemplates } from '../../state/effect-templates';
import { EffectTemplates } from './EffectTemplates';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

// jsdom no implementa createObjectURL/revokeObjectURL.
beforeAll(() => {
  Object.defineProperty(URL, 'createObjectURL', {
    value: vi.fn(() => 'blob:fake'),
    configurable: true,
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    value: vi.fn(),
    configurable: true,
  });
});

const EXPOSURE = effectRegistry.get('color.exposure');
if (!EXPOSURE) throw new Error('falta color.exposure en el catálogo');

const STACK: EffectStack = [createInstance(EXPOSURE)];

function renderPanel(onApply = vi.fn()) {
  render(<EffectTemplates kind="video" stack={STACK} onApply={onApply} />);
  return onApply;
}

describe('plantillas de efectos en la UI', () => {
  it('guarda el stack actual y permite aplicarlo de nuevo', () => {
    const onApply = renderPanel();
    fireEvent.click(screen.getByText(/^Plantillas \(/));
    fireEvent.change(screen.getByLabelText('Nombre de la plantilla'), {
      target: { value: 'Mi look' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar stack actual' }));

    expect(loadEffectTemplates().some((entry) => entry.name === 'Mi look')).toBe(true);
    expect(screen.getByText(/Plantilla «Mi look» guardada/)).toBeTruthy();

    const row = screen.getByText('Mi look').closest('li');
    expect(row).toBeTruthy();
    fireEvent.click(within(row as HTMLElement).getByRole('button', { name: 'Aplicar' }));
    expect(onApply).toHaveBeenCalledTimes(1);
    const applied = onApply.mock.calls[0]?.[0] as EffectStack;
    expect(applied).toHaveLength(1);
    expect(applied[0]?.effectId).toBe('color.exposure');
    // Id nuevo: no colisiona con la instancia original del clip.
    expect(applied[0]?.id).not.toBe(STACK[0]?.id);
  });

  it('exporta la plantilla como JSON descargable', () => {
    renderPanel();
    fireEvent.click(screen.getByText(/^Plantillas \(/));
    fireEvent.change(screen.getByLabelText('Nombre de la plantilla'), {
      target: { value: 'Descargable' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar stack actual' }));
    const row = screen.getByText('Descargable').closest('li') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Exportar' }));
    expect(URL.createObjectURL).toHaveBeenCalled();
  });

  it('aplica una plantilla de fábrica con su stack completo', () => {
    const onApply = renderPanel();
    fireEvent.click(screen.getByText(/^Plantillas \(/));
    const row = screen.getByText('Look cine').closest('li') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Aplicar' }));
    expect(onApply).toHaveBeenCalledTimes(1);
    const applied = onApply.mock.calls[0]?.[0] as EffectStack;
    expect(applied.map((i) => i.effectId)).toEqual([
      'color.saturation',
      'color.contrast',
      'color.temperature',
      'light.vignette',
    ]);
    // Parámetros de la receta, no los defaults del manifiesto.
    expect(applied[0]?.params.saturation).toBeCloseTo(0.85);
    expect(applied[3]?.params.angle).toBeCloseTo(0.55);
  });

  it('aplica una plantilla de fábrica animada con sus keyframes', () => {
    const onApply = renderPanel();
    fireEvent.click(screen.getByText(/^Plantillas \(/));
    const row = screen.getByText('Golpe que se apaga').closest('li') as HTMLElement;
    expect(within(row).getByText(/· animada/)).toBeTruthy();
    fireEvent.click(within(row).getByRole('button', { name: 'Aplicar' }));
    const applied = onApply.mock.calls[0]?.[0] as EffectStack;
    const track = applied[0]?.keyframes?.amount;
    expect(track).toHaveLength(3);
    expect(track?.map((key) => key.frame)).toEqual([0, 10, 28]);
    expect(track?.[1]?.easing).toBe('ease-out');
  });

  it('lista las plantillas de fábrica separadas de las propias', () => {
    renderPanel();
    fireEvent.click(screen.getByText(/^Plantillas \(/));
    expect(screen.getByText('De fábrica')).toBeTruthy();
    expect(screen.getByText('Blanco y negro')).toBeTruthy();
    // Sin plantillas del usuario no hay sección «Propias».
    expect(screen.queryByText('Propias')).toBeNull();
    expect(screen.getByText(/Todavía no guardaste plantillas propias/)).toBeTruthy();
  });

  it('importa un JSON válido y rechaza uno corrupto', async () => {
    renderPanel();
    fireEvent.click(screen.getByText(/^Plantillas \(/));
    const input = screen.getByLabelText('Importar plantilla JSON') as HTMLInputElement;

    const bad = new File(['{no json'], 'mala.json', { type: 'application/json' });
    fireEvent.change(input, { target: { files: [bad] } });
    await waitFor(() =>
      expect(screen.getByText(/no es JSON válido/i)).toBeTruthy(),
    );

    const good = new File(
      [
        JSON.stringify({
          kind: 'olyvia-effect-template',
          version: 1,
          name: 'Importada',
          effectKind: 'video',
          stack: [
            { id: 'x-1', effectId: 'color.exposure', enabled: true, params: {} },
          ],
        }),
      ],
      'buena.json',
      { type: 'application/json' },
    );
    fireEvent.change(input, { target: { files: [good] } });
    await waitFor(() =>
      expect(screen.getByText(/Plantilla «Importada» importada/)).toBeTruthy(),
    );
    expect(loadEffectTemplates().some((entry) => entry.name === 'Importada')).toBe(true);
  });

  it('avisa cuando la plantilla es del otro tipo de pila', async () => {
    renderPanel();
    fireEvent.click(screen.getByText(/^Plantillas \(/));
    const input = screen.getByLabelText('Importar plantilla JSON') as HTMLInputElement;
    const audioFile = new File(
      [
        JSON.stringify({
          kind: 'olyvia-effect-template',
          version: 1,
          name: 'Solo audio',
          effectKind: 'audio',
          stack: [
            { id: 'a-1', effectId: 'audio.echo', enabled: true, params: {} },
          ],
        }),
      ],
      'audio.json',
      { type: 'application/json' },
    );
    fireEvent.change(input, { target: { files: [audioFile] } });
    await waitFor(() =>
      expect(screen.getByText(/es de audio/)).toBeTruthy(),
    );
    expect(loadEffectTemplates().filter((entry) => entry.kind === 'video')).toHaveLength(0);
  });
});
