import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { parseLottieArchive } from './lottie-archive';

const ANIMATION = {
  v: '5.7.4',
  fr: 30,
  ip: 0,
  op: 30,
  w: 32,
  h: 32,
  layers: [{ ty: 4, nm: 'box' }],
};

function withImage(animation: Record<string, unknown> = ANIMATION): Record<string, unknown> {
  return {
    ...animation,
    assets: [{ id: 'image_0', w: 1, h: 1, u: 'images/', p: 'img.png', e: 0 }],
  };
}

describe('parseLottieArchive', () => {
  it('extrae animaciones, themes y state machines, y embebe imágenes', async () => {
    const bytes = zipSync({
      'manifest.json': strToU8(
        JSON.stringify({
          version: '2',
          animations: [{ id: 'anim_1', initialTheme: 'theme_1' }],
          themes: [{ id: 'theme_1', name: 'Tema' }],
          stateMachines: [{ id: 'sm_1', name: 'Máquina' }],
        }),
      ),
      'animations/anim_1.json': strToU8(JSON.stringify(withImage())),
      'animations/otra.json': strToU8(JSON.stringify(ANIMATION)),
      'images/img.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      't/theme_1.json': strToU8(
        JSON.stringify({ rules: [{ id: 'fill', type: 'Color', value: [1, 0, 0] }] }),
      ),
      's/sm_1.json': strToU8(
        JSON.stringify({
          initial: 'idle',
          states: [
            { name: 'idle', type: 'PlaybackState', animation: 'anim_1', transitions: [] },
          ],
          inputs: [],
        }),
      ),
      'audio/track.mp3': new Uint8Array([1, 2, 3]),
    });
    const result = await parseLottieArchive(bytes);
    expect(result.animationId).toBe('anim_1');
    expect(result.animations.size).toBe(2);
    expect(result.embeddedAssets).toBe(1);
    const assets = result.raw.assets as Record<string, unknown>[];
    expect(assets[0]).toMatchObject({ e: 1, u: '' });
    expect(String(assets[0]!.p)).toMatch(/^data:image\/png;base64,/);
    expect(result.themes.get('theme_1')?.rules).toHaveLength(1);
    expect(result.stateMachines.get('sm_1')?.initial).toBe('idle');
    expect(result.initialTheme).toBe('theme_1');
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/audio/);
  });

  it('funciona sin manifest y elige la primera animación ordenada', async () => {
    const bytes = zipSync({
      'animations/b.json': strToU8(JSON.stringify(ANIMATION)),
      'animations/a.json': strToU8(JSON.stringify(ANIMATION)),
    });
    const result = await parseLottieArchive(bytes);
    expect(result.animationId).toBe('a');
    expect(result.embeddedAssets).toBe(0);
    expect(result.warnings).toEqual([]);
  });

  it('rechaza rutas con escape del ZIP', async () => {
    const bytes = zipSync({
      'animations/a.json': strToU8(JSON.stringify(ANIMATION)),
      '../evil.json': strToU8('{}'),
    });
    await expect(parseLottieArchive(bytes)).rejects.toThrow(/ruta no permitida/i);
  });

  it('rechaza una imagen faltante o remota en vez de renderizar incompleto', async () => {
    const missing = zipSync({
      'animations/a.json': strToU8(JSON.stringify(withImage())),
    });
    await expect(parseLottieArchive(missing)).rejects.toThrow(/no está incluida/i);

    const remote = zipSync({
      'animations/a.json': strToU8(
        JSON.stringify({
          ...ANIMATION,
          assets: [{ id: 'image_0', u: 'https://evil.example/', p: 'x.png', e: 0 }],
        }),
      ),
    });
    await expect(parseLottieArchive(remote)).rejects.toThrow(/remota/i);
  });

  it('respeta el tope de bytes descomprimidos', async () => {
    const bytes = zipSync({
      'animations/a.json': strToU8(JSON.stringify(ANIMATION)),
      'big.bin': new Uint8Array(4096),
    });
    await expect(
      parseLottieArchive(bytes, { maxUncompressedBytes: 1024 }),
    ).rejects.toThrow(/tamaño descomprimido/i);
  });

  it('rechaza archivos vacíos, ZIP inválidos y packs sin animaciones', async () => {
    await expect(parseLottieArchive(new Uint8Array())).rejects.toThrow(/vacío/i);
    await expect(parseLottieArchive(new Uint8Array([1, 2, 3]))).rejects.toThrow(/ZIP/i);
    const empty = zipSync({ 'images/only.png': new Uint8Array([1]) });
    await expect(parseLottieArchive(empty)).rejects.toThrow(/animations\/\*\.json/i);
  });
});
