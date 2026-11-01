import { describe, expect, it } from 'vitest';
import { bufferToBase64, canvasVideoSize } from './encode-canvas';

describe('encode canvas · dimensiones efectivas', () => {
  it('usa 720p 24 fps y 4 s por defecto', () => {
    expect(canvasVideoSize({})).toEqual({
      width: 1280,
      height: 720,
      fps: 24,
      durationSeconds: 4,
    });
  });

  it('acota y redondea a dimensiones pares', () => {
    expect(canvasVideoSize({ width: 100, height: 100 }).width).toBe(320);
    expect(canvasVideoSize({ width: 100, height: 100 }).height).toBe(180);
    expect(canvasVideoSize({ width: 5000, height: 5000 })).toMatchObject({
      width: 1920,
      height: 1080,
    });
    expect(canvasVideoSize({ width: 333, height: 181 })).toMatchObject({
      width: 332,
      height: 180,
    });
    expect(canvasVideoSize({ width: 640, height: 360 })).toMatchObject({
      width: 640,
      height: 360,
    });
  });

  it('acota fps y duración al rango soportado', () => {
    expect(canvasVideoSize({ fps: 5, durationSeconds: 0.1 })).toMatchObject({
      fps: 10,
      durationSeconds: 1,
    });
    expect(canvasVideoSize({ fps: 60, durationSeconds: 60 })).toMatchObject({
      fps: 30,
      durationSeconds: 10,
    });
    expect(canvasVideoSize({ fps: 12, durationSeconds: 1 })).toMatchObject({
      fps: 12,
      durationSeconds: 1,
    });
  });
});

describe('encode canvas · base64', () => {
  it('convierte bytes a base64 sin truncar', () => {
    const buffer = new TextEncoder().encode('olyvia-rig').buffer;
    expect(bufferToBase64(buffer)).toBe('b2x5dmlhLXJpZw==');
  });

  it('soporta buffers grandes por bloques', () => {
    const bytes = new Uint8Array(70_000);
    bytes.fill(65);
    const base64 = bufferToBase64(bytes.buffer);
    expect(base64.startsWith('QUFBQUFB')).toBe(true);
    expect(Math.round((base64.length * 3) / 4)).toBeLessThanOrEqual(70_002);
  });
});
