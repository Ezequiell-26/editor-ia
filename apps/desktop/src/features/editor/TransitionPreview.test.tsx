// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ClipTransition } from '@editor-ia/project-schema';
import { TransitionPreview } from './TransitionPreview';

const TYPES: ClipTransition['type'][] = [
  'dissolve',
  'fade-black',
  'fade-white',
  'dip-color',
  'slide-left',
  'slide-right',
  'slide-up',
  'slide-down',
  'slide-3d-left',
  'slide-3d-right',
  'slide-3d-up',
  'slide-3d-down',
  'wipe-left',
  'wipe-right',
  'wipe-up',
  'wipe-down',
  'iris',
  'blinds',
  'clock-wipe',
  'ink',
  'bolhas',
  'colmeia',
  'chuva',
  'vento',
  'triangulos',
  'persiana',
  'reflexo',
  'pixelar',
  'interferencia',
  'liquido',
  'caleidoscopio',
  'desenfoque-lineal',
  'warp-direccional',
  'glitch-digital',
  'zoom-suave',
  'zoom-rapido',
  'barrido-diagonal',
  'luma-wipe',
  'textura-luz',
  'textura-celular',
  'textura-fractal',
  'textura-vida',
];

describe('TransitionPreview', () => {
  it.each(TYPES)('renderiza la escena de %s con sus tres capas', (type) => {
    const { container } = render(<TransitionPreview type={type} />);
    const root = container.querySelector('.tp');
    expect(root).not.toBeNull();
    expect(root?.getAttribute('data-tp')).toBe(type);
    expect(container.querySelectorAll('.tp > i')).toHaveLength(3);
  });
});
