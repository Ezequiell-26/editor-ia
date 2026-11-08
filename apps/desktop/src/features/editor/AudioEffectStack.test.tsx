// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { EffectStack } from '@editor-ia/effect-kit';
import { AudioEffectStack } from './AudioEffectStack';

afterEach(cleanup);

function Harness() {
  const [stack, setStack] = useState<EffectStack>([]);
  return <AudioEffectStack stack={stack} onChange={setStack} clipLabel="Voz principal" />;
}

function KeyedHarness({
  frame = 30,
  initial,
  onStack,
}: {
  readonly frame?: number;
  readonly initial?: EffectStack;
  readonly onStack?: (stack: EffectStack) => void;
}) {
  const [stack, setStack] = useState<EffectStack>(initial ?? []);
  return (
    <AudioEffectStack
      stack={stack}
      onChange={(next) => {
        setStack(next);
        onStack?.(next);
      }}
      clipLabel="Voz principal"
      keyframeFrame={frame}
    />
  );
}

function addEffect(name: RegExp) {
  const browser = screen.getByRole('region', { name: 'Catálogo de efectos' });
  const card = within(browser).getAllByRole('button', { name })[0];
  expect(card).toBeTruthy();
  if (card) fireEvent.click(card);
}

describe('cadena de audio del clip', () => {
  it('sólo ofrece efectos de audio', () => {
    render(<Harness />);
    const browser = screen.getByRole('region', { name: 'Catálogo de efectos' });
    const names = within(browser)
      .getAllByRole('button')
      .map((button) => button.textContent ?? '');
    expect(names.some((name) => name.includes('Teléfono'))).toBe(true);
    expect(names.some((name) => name.includes('Exposición'))).toBe(false);
  });

  it('suma un efecto y muestra la cadena compilada', () => {
    render(<Harness />);
    addEffect(/^Teléfono/);
    const stack = screen.getByRole('list', { name: 'Stack de efectos' });
    expect(within(stack).getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByText(/Cadena de filtros \(1\)/)).toBeTruthy();
    expect(screen.getByText(/highpass=f=350/)).toBeTruthy();
  });

  it('declara la fidelidad del conjunto', () => {
    render(<Harness />);
    addEffect(/^Vinilo/);
    expect(screen.getAllByText(/Export aproximado/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/no hay ruido de superficie real/i).length).toBeGreaterThan(0);
  });

  it('busca dentro del catálogo de audio', () => {
    render(<Harness />);
    const search = screen.getByLabelText('Buscar efecto');
    fireEvent.change(search, { target: { value: 'voz' } });
    const browser = screen.getByRole('region', { name: 'Catálogo de efectos' });
    const names = within(browser)
      .getAllByRole('button')
      .map((button) => button.textContent ?? '');
    expect(names.some((name) => name.includes('Voz grave'))).toBe(true);
    expect(names.some((name) => name.includes('Eco'))).toBe(false);
  });

  it('sin frame de playhead no ofrece keyframes', () => {
    render(<Harness />);
    addEffect(/^Teléfono/);
    expect(
      screen.queryByRole('button', { name: /Clave de .* en el frame actual/ }),
    ).toBeNull();
  });

  it('keyframea un parámetro de audio desde el playhead', () => {
    let latest: EffectStack = [];
    render(<KeyedHarness frame={30} onStack={(next) => (latest = next)} />);
    addEffect(/^Teléfono/);
    const diamond = screen.getByRole('button', {
      name: 'Clave de Corte grave en el frame actual',
    });
    fireEvent.click(diamond);
    expect(diamond.getAttribute('aria-pressed')).toBe('true');
    // La primera clave crea la pista con una compañera plana en el frame 0.
    const track = latest[0]?.keyframes?.low ?? [];
    expect(track.map((key) => key.frame)).toEqual([0, 30]);
    // Con la pista activa el slider escribe en la clave del frame.
    const slider = screen.getByRole('slider', { name: 'Corte grave' });
    fireEvent.change(slider, { target: { value: '500' } });
    expect(latest[0]?.keyframes?.low?.find((key) => key.frame === 30)?.value).toBe(500);
    // El botón × quita la animación completa del parámetro.
    fireEvent.click(screen.getByRole('button', { name: 'Quitar la animación de Corte grave' }));
    expect(latest[0]?.keyframes?.low).toBeUndefined();
  });

  it('edita la curva Bézier de un parámetro animado y puede volver a lineal', () => {
    let latest: EffectStack = [];
    render(<KeyedHarness frame={30} onStack={(next) => (latest = next)} />);
    addEffect(/^Teléfono/);
    // Sin pista no hay botón de curva; con la pista (2 claves) aparece.
    expect(screen.queryByRole('button', { name: 'Curva de Corte grave' })).toBeNull();
    fireEvent.click(
      screen.getByRole('button', { name: 'Clave de Corte grave en el frame actual' }),
    );
    expect(screen.queryByRole('button', { name: 'Curva de Corte grave' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Curva de Corte grave' }));
    const canvas = screen.getByRole('application', {
      name: /Editor de curvas Bézier de Corte grave/,
    });
    // Flecha derecha mueve el manejador cp1 del primer segmento (frame 0).
    fireEvent.keyDown(canvas, { key: 'ArrowRight' });
    const first = latest[0]?.keyframes?.low?.find((key) => key.frame === 0);
    expect(first?.bezier?.cp1X).toBeCloseTo(0.01, 5);
    // El botón de reset quita la curva sin borrar la pista.
    fireEvent.click(screen.getByRole('button', { name: 'Quitar curvas' }));
    expect(latest[0]?.keyframes?.low).toHaveLength(2);
    expect(latest[0]?.keyframes?.low?.every((key) => key.bezier === undefined)).toBe(true);
  });

  it('elegir un preset de interpolación escribe el easing del tramo y reemplaza la curva propia', () => {
    let latest: EffectStack = [];
    render(<KeyedHarness frame={30} onStack={(next) => (latest = next)} />);
    addEffect(/^Teléfono/);
    fireEvent.click(
      screen.getByRole('button', { name: 'Clave de Corte grave en el frame actual' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Curva de Corte grave' }));
    // Dos claves → un solo tramo; el último keyframe no abre segmento.
    const select = screen.getByRole('combobox', {
      name: 'Interpolación del tramo 1 de Corte grave',
    });
    expect(
      screen.queryByRole('combobox', {
        name: 'Interpolación del tramo 2 de Corte grave',
      }),
    ).toBeNull();
    fireEvent.change(select, { target: { value: 'ease-in' } });
    expect(
      latest[0]?.keyframes?.low?.find((key) => key.frame === 0)?.easing,
    ).toBe('ease-in');
    // Con curva propia el selector la declara en vez de mostrar un preset que no rige.
    const canvas = screen.getByRole('application', {
      name: /Editor de curvas Bézier de Corte grave/,
    });
    fireEvent.keyDown(canvas, { key: 'ArrowRight' });
    expect((select as HTMLSelectElement).value).toBe('__custom');
    // Elegir un preset reemplaza la curva para que el easing rija de verdad.
    fireEvent.change(select, { target: { value: 'ease-out' } });
    const first = latest[0]?.keyframes?.low?.find((key) => key.frame === 0);
    expect(first?.easing).toBe('ease-out');
    expect(first?.bezier).toBeUndefined();
  });

  it('la lista del editor de curva muestra las claves y permite borrar una suelta', () => {
    let latest: EffectStack = [];
    render(
      <KeyedHarness
        initial={[
          {
            id: 'inst-1',
            effectId: 'audio.telephone',
            enabled: true,
            params: {},
            keyframes: {
              low: [
                { frame: 0, value: 200 },
                { frame: 15, value: 500, easing: 'ease-in' },
                { frame: 30, value: 900 },
              ],
            },
          },
        ]}
        onStack={(next) => (latest = next)}
      />,
    );
    // La fila del efecto arranca abierta (última de la pila) y el catálogo
    // no hace falta: la instancia ya está en el stack.
    fireEvent.click(screen.getByRole('button', { name: 'Curva de Corte grave' }));
    expect(screen.getByText(/frame 15 ·/)).toBeTruthy();
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Quitar la clave del frame 15 de Corte grave',
      }),
    );
    expect(latest[0]?.keyframes?.low?.map((key) => key.frame)).toEqual([0, 30]);
    // Borrar otra clave deja una sola: la pista entera se elimina (mínimo 2).
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Quitar la clave del frame 30 de Corte grave',
      }),
    );
    expect(latest[0]?.keyframes?.low).toBeUndefined();
  });
});
