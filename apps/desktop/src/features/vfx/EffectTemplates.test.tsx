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
    fireEvent.click(screen.getByText('Plantillas (0)'));
    fireEvent.change(screen.getByLabelText('Nombre de la plantilla'), {
      target: { value: 'Mi look' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar stack actual' }));

    expect(loadEffectTemplates().some((entry) => entry.name === 'Mi look')).toBe(true);
    expect(screen.getByText(/Plantilla «Mi look» guardada/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Aplicar' }));
    expect(onApply).toHaveBeenCalledTimes(1);
    const applied = onApply.mock.calls[0]?.[0] as EffectStack;
    expect(applied).toHaveLength(1);
    expect(applied[0]?.effectId).toBe('color.exposure');
    // Id nuevo: no colisiona con la instancia original del clip.
    expect(applied[0]?.id).not.toBe(STACK[0]?.id);
  });

  it('exporta la plantilla como JSON descargable', () => {
    renderPanel();
    fireEvent.click(screen.getByText('Plantillas (0)'));
    fireEvent.change(screen.getByLabelText('Nombre de la plantilla'), {
      target: { value: 'Descargable' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar stack actual' }));
    fireEvent.click(screen.getByRole('button', { name: 'Exportar' }));
    expect(URL.createObjectURL).toHaveBeenCalled();
  });

  it('importa un JSON válido y rechaza uno corrupto', async () => {
    renderPanel();
    fireEvent.click(screen.getByText('Plantillas (0)'));
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
    fireEvent.click(screen.getByText('Plantillas (0)'));
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
