// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  GPU_FAILURE_WINDOW_MS,
  GPU_FAILURE_WARN_THRESHOLD,
  gpuFailuresInWindow,
  recordGpuRenderFailure,
  shouldWarnGpuFailures,
} from './gpu-failures';

const T0 = 1_800_000_000_000;

describe('gpu-failures', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('cuenta caídas dentro de la ventana de 10 minutos', () => {
    expect(recordGpuRenderFailure(T0)).toBe(1);
    expect(recordGpuRenderFailure(T0 + 60_000)).toBe(2);
    expect(recordGpuRenderFailure(T0 + 120_000)).toBe(3);
    expect(gpuFailuresInWindow(T0 + 120_000)).toHaveLength(3);
  });

  it('podar caídas más viejas que la ventana', () => {
    recordGpuRenderFailure(T0);
    recordGpuRenderFailure(T0 + GPU_FAILURE_WINDOW_MS + 1);
    // La primera ya expiró: queda sólo la nueva.
    expect(gpuFailuresInWindow(T0 + GPU_FAILURE_WINDOW_MS + 1)).toHaveLength(1);
    expect(recordGpuRenderFailure(T0 + GPU_FAILURE_WINDOW_MS + 2)).toBe(2);
  });

  it('el umbral de aviso es 2 caídas en ventana', () => {
    expect(shouldWarnGpuFailures(1)).toBe(false);
    expect(shouldWarnGpuFailures(GPU_FAILURE_WARN_THRESHOLD)).toBe(true);
    expect(shouldWarnGpuFailures(5)).toBe(true);
  });

  it('persiste en sessionStorage entre lecturas', () => {
    recordGpuRenderFailure(T0);
    recordGpuRenderFailure(T0 + 1);
    // Simula reabrir el diálogo: el storage sobrevive al estado React.
    expect(gpuFailuresInWindow(T0 + 2)).toHaveLength(2);
    expect(sessionStorage.getItem('editoria.gpuFailures')).toContain(String(T0));
  });
});
