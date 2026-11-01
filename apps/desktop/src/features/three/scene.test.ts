import { describe, expect, it } from 'vitest';
import {
  THREE_PRESETS,
  animationIndex,
  cameraPosition,
  modelPlacement,
  objectRotation,
  presetById,
} from './scene';

describe('escenas 3D', () => {
  it('registra cuatro presets con geometría y color', () => {
    expect(THREE_PRESETS).toHaveLength(4);
    expect(THREE_PRESETS.every((preset) => preset.accent.startsWith('#'))).toBe(true);
    expect(presetById('torus-dolly').label).toMatch(/toroide/i);
    expect(presetById('no-existe' as never)).toBe(THREE_PRESETS[0]);
  });

  it('la cámara avanza de forma determinista y acotada', () => {
    for (const preset of THREE_PRESETS) {
      const start = cameraPosition(preset.id, 0);
      const end = cameraPosition(preset.id, 1);
      expect(Number.isFinite(start.x + start.y + start.z)).toBe(true);
      expect(Number.isFinite(end.x + end.y + end.z)).toBe(true);
      const clamped = cameraPosition(preset.id, 9);
      expect(clamped).toEqual(end);
      expect(cameraPosition(preset.id, -3)).toEqual(start);
    }
    const orbitStart = cameraPosition('orbit-cube', 0);
    const orbitEnd = cameraPosition('orbit-cube', 1);
    expect(Math.abs(orbitEnd.x - orbitStart.x)).toBeGreaterThan(0.2);
  });

  it('encaja un modelo importado centrado y apoyado en el piso', () => {
    const placement = modelPlacement({
      min: { x: -2, y: -1, z: 1 },
      max: { x: 4, y: 3, z: 5 },
    });
    expect(placement.scale).toBeCloseTo(2 / 6, 5);
    expect(placement.offset.x).toBeCloseTo(-1 * placement.scale, 5);
    expect(placement.offset.z).toBeCloseTo(-3 * placement.scale, 5);
    expect(placement.offset.y + -1 * placement.scale).toBeCloseTo(-1, 5);
    expect(() =>
      modelPlacement({ min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } }),
    ).toThrow(/geometría visible/);
  });

  it('elige el clip de animación por nombre o índice y rechaza fuera de rango', () => {
    const names = ['Giro', 'Pulso'];
    expect(animationIndex(names)).toBe(0);
    expect(animationIndex(names, 'Pulso')).toBe(1);
    expect(animationIndex(names, '1')).toBe(1);
    expect(animationIndex(names, '9')).toBe(-1);
    expect(animationIndex(names, 'Nada')).toBe(-1);
    expect(animationIndex([], 'Giro')).toBe(-1);
  });

  it('el objeto rota y las posiciones son finitas', () => {
    for (const preset of THREE_PRESETS) {
      const start = objectRotation(preset.id, 0);
      const end = objectRotation(preset.id, 1);
      expect(Number.isFinite(start.x + start.y)).toBe(true);
      expect(Number.isFinite(end.x + end.y)).toBe(true);
      expect(end.y).toBeGreaterThanOrEqual(start.y);
    }
  });
});
