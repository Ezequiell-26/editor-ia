// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  assertSafeHyperframe,
  loadHyperframeHtml,
  localizeHyperframeFonts,
} from './hyperframe';
import type { HyperframeEntry } from './open-design';

const entry: HyperframeEntry = {
  id: 'frame-bold-poster',
  title: 'Bold Poster',
  summary: 'Póster editorial en movimiento.',
  category: 'Presentation',
  tags: ['poster'],
  aspect: '16:9',
  width: 1920,
  height: 1080,
  fps: 60,
  durationSec: 15,
  license: 'Apache-2.0',
  author: 'nexu-io',
  sourceUrl: null,
  preview: 'hyperframes/frame-bold-poster/preview.png',
  html: 'hyperframes/frame-bold-poster/source/index.html',
};

describe('HyperFrames locales', () => {
  it('inlinea las fuentes con URLs del catálogo y quita el link relativo', () => {
    const html =
      '<html><head><link rel="stylesheet" href="fonts.css" /><style>body{color:#111}</style></head><body><h1>Hola</h1></body></html>';
    const fonts =
      '@font-face{font-family:X;src:url(fonts/a.woff2) format("woff2")} .x{background:url("fonts/b.woff2")}';
    const output = localizeHyperframeFonts(html, fonts, '/open-design/hyperframes/x/source/fonts/');
    expect(output).not.toContain('href="fonts.css"');
    expect(output).toContain(
      'src:url(/open-design/hyperframes/x/source/fonts/a.woff2)',
    );
    expect(output).toContain(
      'url("/open-design/hyperframes/x/source/fonts/b.woff2")',
    );
    expect(output).toContain('<h1>Hola</h1>');
  });

  it('rechaza scripts y recursos remotos', () => {
    expect(() => assertSafeHyperframe('<script>alert(1)</script>')).toThrow(/scripts/);
    expect(() =>
      assertSafeHyperframe('<img src="https://example.com/a.png">'),
    ).toThrow(/remotos/);
    expect(() =>
      assertSafeHyperframe('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
    ).not.toThrow();
  });

  it('carga el HTML y las fuentes reales del catálogo', async () => {
    const fetcher = vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      text: async () =>
        url.endsWith('fonts.css')
          ? '@font-face{src:url(fonts/a.woff2)}'
          : '<html><head><link rel="stylesheet" href="fonts.css"></head><body></body></html>',
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    })) as unknown as typeof fetch;
    const html = await loadHyperframeHtml(entry, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(html).toContain('data:font/woff2;base64,AQID');
    expect(html).not.toContain('url(fonts/a.woff2)');
  });

  it('informa el error HTTP del catálogo', async () => {
    const fetcher = vi.fn(async () => ({
      ok: false,
      status: 404,
      text: async () => '',
    })) as unknown as typeof fetch;
    await expect(loadHyperframeHtml(entry, fetcher)).rejects.toThrow(/HTTP 404/);
  });
});
