// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { readPreviewFill } from './Preview';

const FIT_KEY = 'editoria.preview-fit.v1';
const FIX_KEY = 'editoria.preview-fit.crop-fixed.v1';

afterEach(() => window.localStorage.clear());

describe('modo del monitor · fotograma completo por defecto', () => {
  it('migra una sola vez el «Llenar» heredado que recortaba el fotograma', () => {
    window.localStorage.setItem(FIT_KEY, 'fill');
    expect(readPreviewFill()).toBe(false);
    expect(window.localStorage.getItem(FIT_KEY)).toBe('fit');
    expect(window.localStorage.getItem(FIX_KEY)).toBe('1');
  });

  it('respeta una elección explícita posterior de «Llenar»', () => {
    window.localStorage.setItem(FIX_KEY, '1');
    window.localStorage.setItem(FIT_KEY, 'fill');
    expect(readPreviewFill()).toBe(true);
    expect(window.localStorage.getItem(FIT_KEY)).toBe('fill');
  });

  it('sin preferencia guardada usa «Ajustar»', () => {
    expect(readPreviewFill()).toBe(false);
  });
});
