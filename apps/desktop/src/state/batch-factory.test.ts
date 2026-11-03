import { describe, expect, it } from 'vitest';
import { createFakeService } from '../test/fake-service';
import {
  assembleVariant,
  generateVariant,
  planVariants,
  type FactoryBrief,
} from './batch-factory';

const BRIEF: FactoryBrief = {
  topic: 'Cómo ordenar una timeline',
  variants: 2,
  scenes: 3,
  language: 'es',
  width: 1920,
  height: 1080,
  fpsNum: 30,
  fpsDen: 1,
};

const IMAGE = {
  id: 'image-1',
  label: 'Card verde',
  path: 'media/card.png',
  hash: 'a'.repeat(64),
  bytes: 1000,
  width: 1920,
  height: 1080,
};

/** El fake devuelve un guion `simulated: true`; para el camino real se marca
 * como generado por un proveedor para que la Fábrica pueda escribir. */
function fakeWithRealProvider() {
  const service = createFakeService();
  const generate = service.generateScript.bind(service);
  service.generateScript = async (request) => ({
    ...(await generate(request)),
    providerId: 'openai-compatible',
    model: 'llama3.1',
    simulated: false,
  });
  return service;
}

describe('fábrica de contenido', () => {
  it('planifica variantes con ángulos distintos', () => {
    const plans = planVariants(BRIEF);
    expect(plans).toHaveLength(2);
    expect(plans[0]?.brief).not.toBe(plans[1]?.brief);
    expect(plans[0]?.name).toContain('v1');
    expect(plans[1]?.name).toContain('v2');
  });

  it('genera y ensambla una variante desde el brief con proveedor real', async () => {
    const service = fakeWithRealProvider();
    const plans = planVariants(BRIEF);
    const plan = plans[0]!;
    const generated = await generateVariant(service, BRIEF, plan, [IMAGE], {
      photoMotion: 'auto',
      transitionFrames: 8,
      confirmRights: true,
      approveCost: false,
    });
    expect(generated.project.scenes).toHaveLength(3);
    expect(generated.narrations).toHaveLength(3);
    const assembled = assembleVariant(generated.project, generated.narrations, {
      photoMotion: 'auto',
      transitionFrames: 8,
      confirmRights: true,
    });
    expect(assembled.timeline.clips.length).toBeGreaterThan(0);
    expect(assembled.captions.cues.length).toBeGreaterThan(0);
    expect(assembled.assets.every((asset) => asset.status === 'ready')).toBe(true);
  });

  it('rechaza el guion simulado antes de escribir o narrar nada', async () => {
    const service = createFakeService();
    const written: string[] = [];
    let narrations = 0;
    service.writeProjectVariant = async (input) => {
      written.push(input.fileName);
      return {
        path: `${input.directory}\\${input.fileName}.editoria.json`,
        bytes: 2048,
        copiedAssets: 1,
      };
    };
    service.synthesizeNarration = async () => {
      narrations += 1;
      throw new Error('no se debe narrar un guion simulado');
    };

    const plan = planVariants(BRIEF)[0]!;
    await expect(
      generateVariant(service, BRIEF, plan, [IMAGE], {
        photoMotion: 'auto',
        transitionFrames: 8,
        confirmRights: true,
        approveCost: false,
      }),
    ).rejects.toThrow(/proveedor de guion está en modo simulado/i);

    // Cero archivos escritos y cero narraciones: la validación ocurre antes de
    // cualquier efecto, no después de generar la variante.
    expect(written).toHaveLength(0);
    expect(narrations).toBe(0);
  });
});
