import { describe, expect, it } from 'vitest';
import {
  LottieParseError,
  lottieFrameAt,
  parseLottieDocument,
  planLottieExport,
  LOTTIE_MAX_FRAMES,
} from './lottie';

function sample(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    v: '5.7.4',
    fr: 30,
    ip: 0,
    op: 60,
    w: 200,
    h: 200,
    layers: [{ ty: 4, nm: 'box' }],
    ...overrides,
  };
}

describe('parseLottieDocument', () => {
  it('acepta un Lottie con capas y calcula duración', () => {
    const document = parseLottieDocument(sample());
    expect(document.width).toBe(200);
    expect(document.height).toBe(200);
    expect(document.fps).toBe(30);
    expect(document.inFrame).toBe(0);
    expect(document.outFrame).toBe(60);
    expect(document.durationSeconds).toBeCloseTo(2, 6);
    expect(document.layerCount).toBe(1);
  });

  it('usa ip=0 cuando falta y respeta un ip distinto de cero', () => {
    expect(parseLottieDocument(sample({ ip: undefined })).inFrame).toBe(0);
    expect(parseLottieDocument(sample({ ip: 15, op: 45 })).inFrame).toBe(15);
  });

  it('rechaza archivos que no son objetos o no traen capas', () => {
    expect(() => parseLottieDocument(null)).toThrow(LottieParseError);
    expect(() => parseLottieDocument([])).toThrow(/no es un Lottie JSON válido/i);
    expect(() => parseLottieDocument(sample({ layers: [] }))).toThrow(/layers/i);
    expect(() => parseLottieDocument(sample({ layers: 'x' }))).toThrow(/layers/i);
  });

  it('rechaza tamaño, tasa y rango inválidos', () => {
    expect(() => parseLottieDocument(sample({ w: 0 }))).toThrow(/ancho/i);
    expect(() => parseLottieDocument(sample({ h: -10 }))).toThrow(/alto/i);
    expect(() => parseLottieDocument(sample({ w: 9000 }))).toThrow(/8192/);
    expect(() => parseLottieDocument(sample({ fr: 0 }))).toThrow(/tasa/i);
    expect(() => parseLottieDocument(sample({ fr: 200 }))).toThrow(/120 fps/i);
    expect(() => parseLottieDocument(sample({ op: 0 }))).toThrow(/frame final/i);
    expect(() => parseLottieDocument(sample({ ip: 60, op: 60 }))).toThrow(/mayor que el inicial/i);
  });

  it('rechaza duraciones y capas fuera del tope', () => {
    expect(() => parseLottieDocument(sample({ op: 30 * 301 }))).toThrow(/300 s/);
    expect(() =>
      parseLottieDocument(sample({ layers: Array.from({ length: 2001 }, () => ({ ty: 4 })) })),
    ).toThrow(/demasiadas capas/i);
  });

  it('rechaza expresiones porque la CSP no permite eval', () => {
    const conExpresion = sample({
      layers: [{ ty: 4, ks: { p: { a: 0, k: [0, 0, 0], x: 'time * 30' } } }],
    });
    expect(() => parseLottieDocument(conExpresion)).toThrow(/expresiones/i);
    const sinExpresion = sample({
      layers: [{ ty: 4, ks: { p: { a: 0, k: [0, 0, 0] } } }],
    });
    expect(parseLottieDocument(sinExpresion).layerCount).toBe(1);
  });
});

describe('planLottieExport', () => {
  it('conserva el tamaño y la tasa nativos', () => {
    const plan = planLottieExport(parseLottieDocument(sample()));
    expect(plan.width).toBe(200);
    expect(plan.height).toBe(200);
    expect(plan.fpsNum).toBe(30);
    expect(plan.fpsDen).toBe(1);
    expect(plan.frameCount).toBe(60);
    expect(plan.durationSeconds).toBeCloseTo(2, 6);
    expect(plan.trimmed).toBe(false);
  });

  it('muestrea a la tasa pedida sin cambiar la duración', () => {
    const document = parseLottieDocument(sample());
    expect(planLottieExport(document, { fps: 60 }).frameCount).toBe(120);
    expect(planLottieExport(document, { fps: 7 }).frameCount).toBe(14);
    expect(planLottieExport(document, { fps: 7 }).durationSeconds).toBeCloseTo(2, 6);
  });

  it('recorta la tasa al rango 1..60', () => {
    const document = parseLottieDocument(sample());
    expect(planLottieExport(document, { fps: 0 }).fpsNum).toBe(1);
    expect(planLottieExport(document, { fps: 240 }).fpsNum).toBe(60);
  });

  it('ajusta a 1920×1080 con lados pares', () => {
    const large = parseLottieDocument(sample({ w: 4000, h: 3000, op: 30 }));
    const plan = planLottieExport(large);
    expect(plan.width).toBe(1440);
    expect(plan.height).toBe(1080);
    const odd = parseLottieDocument(sample({ w: 201, h: 101 }));
    expect(planLottieExport(odd).width).toBe(200);
    expect(planLottieExport(odd).height).toBe(100);
  });

  it('limita frames y avisa cuando recorta el final', () => {
    const document = parseLottieDocument(sample({ fr: 30, op: 3000 })); // 100 s
    const plan = planLottieExport(document, { maxFrames: 10 });
    expect(plan.frameCount).toBe(10);
    expect(plan.trimmed).toBe(true);
    const capped = planLottieExport(parseLottieDocument(sample({ op: 30 * 300 })));
    expect(capped.frameCount).toBe(LOTTIE_MAX_FRAMES);
    expect(capped.trimmed).toBe(true);
  });
});

describe('lottieFrameAt', () => {
  it('mapea el frame de salida al tiempo de la animación', () => {
    const document = parseLottieDocument(sample({ ip: 10, op: 70 }));
    const plan = planLottieExport(document, { fps: 60 });
    expect(lottieFrameAt(document, plan, 0)).toBe(10);
    expect(lottieFrameAt(document, plan, 1)).toBeCloseTo(10.5, 6);
    expect(lottieFrameAt(document, plan, 59)).toBeCloseTo(39.5, 6);
  });

  it('recorta índices fuera de rango', () => {
    const document = parseLottieDocument(sample());
    const plan = planLottieExport(document);
    expect(lottieFrameAt(document, plan, -5)).toBe(0);
    expect(lottieFrameAt(document, plan, 999)).toBeCloseTo(59, 6);
  });
});
