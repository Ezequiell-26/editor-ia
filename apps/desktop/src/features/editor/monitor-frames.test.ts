import { describe, expect, it } from 'vitest';
import type { ContentBox } from './perspective';
import {
  MONITOR_FRAME_PRESETS,
  frameBox,
  frameColors,
  frameShape,
  hexToRgb,
  monitorFramePreset,
  rgbToHex,
} from './monitor-frames';

// Content-box 16:9 que llena un lienzo 960×540.
const content: ContentBox = { x: 0, y: 0, width: 960, height: 540 };

describe('monitor-frames', () => {
  it('tiene los 19 presets con ids únicos y estilos válidos', () => {
    expect(MONITOR_FRAME_PRESETS).toHaveLength(19);
    const ids = new Set(MONITOR_FRAME_PRESETS.map((preset) => preset.id));
    expect(ids.size).toBe(19);
    for (const preset of MONITOR_FRAME_PRESETS) {
      expect(preset.prop).toBeGreaterThan(0);
      expect(preset.thickness).toBeGreaterThan(0);
      expect([1, 2, 3, 4, 5, 6]).toContain(preset.style);
      expect(preset.radii).toHaveLength(4);
    }
  });

  it('frameBox centra la caja con el aspecto del preset', () => {
    const circle = monitorFramePreset('circle-thin');
    const box = frameBox(circle, content);
    // prop=1 en lienzo 16:9 → caja cuadrada centrada.
    expect(box.width).toBeCloseTo(540, 3);
    expect(box.height).toBeCloseTo(540, 3);
    expect(box.x).toBeCloseTo(210, 3);
    expect(box.y).toBeCloseTo(0, 3);

    const wide = monitorFramePreset('landscape-soft'); // prop 16/9
    const wideBox = frameBox(wide, content);
    expect(wideBox.width / wideBox.height).toBeCloseTo(16 / 9, 3);
    expect(wideBox.width).toBeCloseTo(960, 3);
  });

  it('el margen achica la caja', () => {
    const neon = monitorFramePreset('circle-neon');
    const plain = monitorFramePreset('circle-thin');
    const neonBox = frameBox(neon, content);
    const plainBox = frameBox(plain, content);
    expect(neonBox.width).toBeLessThan(plainBox.width);
  });

  it('frameShape genera un path cerrado con stroke proporcional', () => {
    const preset = monitorFramePreset('rounded-soft');
    const shape = frameShape(preset, frameBox(preset, content));
    expect(shape.path.startsWith('M')).toBe(true);
    expect(shape.path.endsWith('Z')).toBe(true);
    expect(shape.strokeWidth).toBeGreaterThan(0);
  });

  it('el hexágono usa path de 6 lados', () => {
    const preset = monitorFramePreset('hexagon');
    const shape = frameShape(preset, frameBox(preset, content));
    expect(shape.path).toContain('L');
    expect(shape.path).not.toContain('A');
  });

  it('frameColors aplica overrides hex y detecta degradado', () => {
    const aurora = monitorFramePreset('circle-aurora');
    const defaults = frameColors(aurora);
    expect(defaults.gradient).toBe(true);
    expect(defaults.color).toMatch(/^#[0-9a-f]{6}$/i);

    const custom = frameColors(aurora, {
      preset: 'circle-aurora',
      color: '#ff0000',
    });
    expect(custom.color).toBe('#ff0000');

    const plain = frameColors(monitorFramePreset('circle-thin'));
    expect(plain.gradient).toBe(false);
  });

  it('hexToRgb/rgbToHex son inversas', () => {
    expect(rgbToHex(hexToRgb('#35e0ff')!)).toBe('#35e0ff');
    expect(hexToRgb('no-es-color')).toBeNull();
  });
});
