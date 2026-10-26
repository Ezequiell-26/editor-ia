// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

// jsdom no implementa WebGL: se reemplaza el canvas de R3F por uno vacío para
// poder montar el componente y verificar el contenedor y sus dimensiones.
vi.mock('@react-three/fiber', () => ({
  Canvas: () => <canvas data-testid="r3f-canvas" />,
  useFrame: () => undefined,
}));
vi.mock('@react-three/drei', () => ({
  OrbitControls: () => null,
  PerspectiveCamera: () => null,
}));

import { ThreeSceneRenderer } from './ThreeSceneRenderer';

describe('ThreeSceneRenderer', () => {
  it('monta el lienzo con las dimensiones por defecto', () => {
    const { container, getByTestId } = render(<ThreeSceneRenderer />);
    expect(getByTestId('r3f-canvas')).toBeTruthy();
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.style.width).toBe('400px');
    expect(wrapper.style.height).toBe('400px');
  });

  it('respeta width y height personalizados', () => {
    const { container } = render(<ThreeSceneRenderer width={800} height={600} />);
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.style.width).toBe('800px');
    expect(wrapper.style.height).toBe('600px');
  });
});
