import { describe, expect, it } from 'vitest';
import { detectQueueCapabilities, queueCapabilityTitle } from './queue-capabilities';

describe('capacidades de cola de render', () => {
  it('detecta backend sin pausa/reanudar/reordenar y explica el motivo', () => {
    const capabilities = detectQueueCapabilities({ available: true, startRender: () => Promise.resolve() });
    expect(capabilities).toEqual({
      pause: false,
      resume: false,
      reorder: false,
      reason:
        'la cola persistente del backend llega en una próxima fase (pausa/reanudar/reordenar no disponibles); no se simula',
    });
    expect(queueCapabilityTitle(capabilities, 'pause')).toContain('no soportada');
    expect(queueCapabilityTitle(capabilities, 'resume')).toContain('no soportado');
    expect(queueCapabilityTitle(capabilities, 'reorder')).toContain('no soportado');
  });

  it('habilita sólo las operaciones presentes', () => {
    const capabilities = detectQueueCapabilities({
      pauseRender: async () => undefined,
      resumeRender: async () => undefined,
    });
    expect(capabilities.pause).toBe(true);
    expect(capabilities.resume).toBe(true);
    expect(capabilities.reorder).toBe(false);
    expect(capabilities.reason).toContain('reordenar');
    expect(queueCapabilityTitle(capabilities, 'pause')).toBe('');
  });

  it('todas presentes → sin motivo', () => {
    const capabilities = detectQueueCapabilities({
      pauseRender: async () => undefined,
      resumeRender: async () => undefined,
      moveRenderQueueEntry: async () => undefined,
    });
    expect(capabilities).toEqual({ pause: true, resume: true, reorder: true, reason: null });
  });

  it('servicio ausente no rompe', () => {
    expect(detectQueueCapabilities(null).pause).toBe(false);
    expect(detectQueueCapabilities(undefined).reason).toContain('no está disponible');
  });
});
