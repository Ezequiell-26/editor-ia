// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  clearPreviewMedia,
  previewMediaPendingCount,
  reportPreviewMedia,
  trackPreviewFonts,
} from './preview-readiness';

// El store es un singleton de módulo: cada test usa claves únicas para
// no interferir con otros ni con renders en curso.

describe('preview-readiness', () => {
  it('counts pending media and releases them', () => {
    const before = previewMediaPendingCount();
    reportPreviewMedia('test:a', false);
    reportPreviewMedia('test:b', false);
    expect(previewMediaPendingCount()).toBe(before + 2);
    reportPreviewMedia('test:a', true);
    expect(previewMediaPendingCount()).toBe(before + 1);
    reportPreviewMedia('test:b', true);
    expect(previewMediaPendingCount()).toBe(before);
  });

  it('does not double-count the same key', () => {
    const before = previewMediaPendingCount();
    reportPreviewMedia('test:c', false);
    reportPreviewMedia('test:c', false);
    expect(previewMediaPendingCount()).toBe(before + 1);
    clearPreviewMedia('test:c');
    expect(previewMediaPendingCount()).toBe(before);
  });

  it('clear releases a pending key idempotently', () => {
    const before = previewMediaPendingCount();
    reportPreviewMedia('test:d', false);
    clearPreviewMedia('test:d');
    clearPreviewMedia('test:d');
    expect(previewMediaPendingCount()).toBe(before);
  });

  // Último test del archivo: `trackPreviewFonts` es singleton de módulo
  // (fontsTracked) y necesita un `document.fonts` inyectado.
  it('trackPreviewFonts marca pendiente mientras status=loading', () => {
    const handlers = new Map<string, Set<() => void>>();
    const fakeFonts = {
      status: 'loading',
      addEventListener: (type: string, fn: () => void) => {
        const set = handlers.get(type) ?? new Set<() => void>();
        set.add(fn);
        handlers.set(type, set);
      },
      removeEventListener: (type: string, fn: () => void) => {
        handlers.get(type)?.delete(fn);
      },
    };
    Object.defineProperty(document, 'fonts', {
      value: fakeFonts,
      configurable: true,
    });
    try {
      const before = previewMediaPendingCount();
      trackPreviewFonts();
      expect(previewMediaPendingCount()).toBe(before + 1);
      fakeFonts.status = 'loaded';
      for (const fn of handlers.get('loadingdone') ?? []) fn();
      expect(previewMediaPendingCount()).toBe(before);
      // Idempotente: una segunda llamada no duplica listeners ni claves.
      trackPreviewFonts();
      expect(previewMediaPendingCount()).toBe(before);
    } finally {
      delete (document as { fonts?: unknown }).fonts;
    }
  });
});
