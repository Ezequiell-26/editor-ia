// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { hasOpenModal } from './modal-guard';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('hasOpenModal', () => {
  it('detecta diálogos modales y no diálogos normales', () => {
    expect(hasOpenModal()).toBe(false);
    document.body.innerHTML = '<div role="dialog"></div>';
    expect(hasOpenModal()).toBe(false);
    document.body.innerHTML = '<div role="dialog" aria-modal="true"></div>';
    expect(hasOpenModal()).toBe(true);
    document.body.innerHTML = '<div role="dialog" aria-modal="false"></div>';
    expect(hasOpenModal()).toBe(false);
  });
});
