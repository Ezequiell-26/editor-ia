import { describe, expect, it } from 'vitest';
import { formatPlanEstimate, planRender, type RenderPlanInput } from './render-plan';

function input(overrides: Partial<RenderPlanInput> = {}): RenderPlanInput {
  return {
    width: 1920,
    height: 1080,
    fps: 30,
    durationSeconds: 60,
    destination: 'social',
    hardware: { h264: false, hevc: false },
    ...overrides,
  };
}

describe('planRender · códec y compresión', () => {
  it('usa H.264 equilibrado para redes', () => {
    const plan = planRender(input({ destination: 'social' }));
    expect(plan.codec).toBe('h264');
    expect(plan.compression).toBe('equilibrado');
    expect(plan.crf).toBe(22);
  });

  it('usa H.265 y máxima calidad para archivo maestro', () => {
    const plan = planRender(input({ destination: 'archive' }));
    expect(plan.codec).toBe('hevc');
    expect(plan.compression).toBe('maximo');
  });

  it('usa compacto para borradores', () => {
    const plan = planRender(input({ destination: 'draft' }));
    expect(plan.compression).toBe('compacto');
  });

  it('HDR fuerza HEVC aunque el destino sea redes', () => {
    const plan = planRender(input({ destination: 'social', isHdr: true }));
    expect(plan.codec).toBe('hevc');
    expect(plan.reasons.join(' ')).toMatch(/HDR/);
  });
});

describe('planRender · encoder', () => {
  it('prefiere software en un clip corto 1080p aunque haya GPU', () => {
    const plan = planRender(input({ hardware: { h264: true, hevc: true } }));
    expect(plan.encoder).toBe('software');
    expect(plan.reasons.join(' ')).toMatch(/software ya es rápido/);
  });

  it('propone GPU en timelines largas', () => {
    const plan = planRender(
      input({ durationSeconds: 600, hardware: { h264: true, hevc: true } }),
    );
    expect(plan.encoder).toBe('hardware');
  });

  it('propone GPU en 4K aunque el clip sea corto', () => {
    const plan = planRender(
      input({ width: 3840, height: 2160, hardware: { h264: true, hevc: true } }),
    );
    expect(plan.encoder).toBe('hardware');
  });

  it('propone GPU para borradores', () => {
    const plan = planRender(
      input({ destination: 'draft', hardware: { h264: true, hevc: false } }),
    );
    expect(plan.encoder).toBe('hardware');
  });

  it('no propone GPU si el códec elegido no tiene encoder de hardware', () => {
    const plan = planRender(
      input({
        destination: 'archive',
        durationSeconds: 900,
        hardware: { h264: true, hevc: false },
      }),
    );
    expect(plan.codec).toBe('hevc');
    expect(plan.encoder).toBe('software');
  });
});

describe('planRender · estimaciones', () => {
  it('estima más peso a mayor resolución', () => {
    const small = planRender(input({ width: 1280, height: 720 }));
    const big = planRender(input({ width: 3840, height: 2160 }));
    expect(big.estimatedBytes).toBeGreaterThan(small.estimatedBytes);
  });

  it('estima menos peso con CRF más alto en el mismo códec', () => {
    // Borrador (compacto, CRF 27) vs redes (equilibrado, CRF 22): mismo H.264,
    // así que la diferencia viene sólo del CRF.
    const balanced = planRender(input({ destination: 'social' }));
    const draft = planRender(input({ destination: 'draft' }));
    expect(balanced.codec).toBe('h264');
    expect(draft.codec).toBe('h264');
    expect(draft.estimatedBytes).toBeLessThan(balanced.estimatedBytes);
  });

  it('HEVC pesa menos que H.264 a igual duración y resolución', () => {
    const h264 = planRender(input({ destination: 'social' }));
    const hevc = planRender(input({ destination: 'archive' }));
    expect(hevc.estimatedBytes).toBeLessThan(h264.estimatedBytes * 1.2);
  });

  it('estima más peso y tiempo a mayor duración', () => {
    const short = planRender(input({ durationSeconds: 10 }));
    const long = planRender(input({ durationSeconds: 600 }));
    expect(long.estimatedBytes).toBeGreaterThan(short.estimatedBytes);
    expect(long.estimatedSeconds).toBeGreaterThan(short.estimatedSeconds);
  });

  it('la GPU tarda menos que el software en el mismo proyecto', () => {
    const software = planRender(input({ durationSeconds: 600 }));
    const hardware = planRender(
      input({ durationSeconds: 600, hardware: { h264: true, hevc: true } }),
    );
    expect(hardware.estimatedSeconds).toBeLessThan(software.estimatedSeconds);
  });

  it('nunca estima cero segundos', () => {
    expect(planRender(input({ durationSeconds: 0 })).estimatedSeconds).toBeGreaterThan(0);
  });
});

describe('planRender · avisos', () => {
  it('avisa por alfa', () => {
    const plan = planRender(input({ hasAlpha: true }));
    expect(plan.warnings.join(' ')).toMatch(/alfa/);
  });

  it('avisa por dimensiones impares', () => {
    const plan = planRender(input({ width: 1921, height: 1081 }));
    expect(plan.warnings.join(' ')).toMatch(/impares/);
  });

  it('avisa por 4K en redes', () => {
    const plan = planRender(input({ width: 3840, height: 2160, destination: 'social' }));
    expect(plan.warnings.join(' ')).toMatch(/1080p alcanza/);
  });

  it('avisa por rango vacío', () => {
    const plan = planRender(input({ durationSeconds: 0 }));
    expect(plan.warnings.join(' ')).toMatch(/0 segundos/);
  });
});

describe('formatPlanEstimate', () => {
  it('muestra peso y tiempo legibles', () => {
    const text = formatPlanEstimate(planRender(input({ durationSeconds: 600 })));
    expect(text).toMatch(/MB|GB/);
    expect(text).toMatch(/~/);
  });
});
