import { describe, expect, it } from 'vitest';
import type { ImageContent } from './visual-intelligence';
import {
  describeImage,
  desiredTraits,
  deriveTraits,
  normalizeToken,
  planImageAssignments,
  scoreImage,
} from './visual-intelligence';

function content(overrides: Partial<ImageContent> = {}): ImageContent {
  return {
    assetId: 'asset',
    width: 1920,
    height: 1080,
    aspect: 1.778,
    orientation: 'landscape',
    lumaMean: 128,
    lumaStd: 40,
    saturationMean: 90,
    colorfulness: 30,
    dominantHue: 200,
    hueConcentration: 0.3,
    temperature: 'neutral',
    edgeDensity: 0.2,
    sharpness: 0.5,
    skyBias: 0,
    faceCount: 0,
    faceCenterX: null,
    faceCenterY: null,
    faceSize: null,
    palette: ['#808080'],
    warnings: [],
    ...overrides,
  };
}

const darkImage = content({
  assetId: 'noche',
  lumaMean: 38,
  temperature: 'cool',
  colorfulness: 8,
  orientation: 'landscape',
  skyBias: 0.05,
});

const sunsetImage = content({
  assetId: 'atardecer',
  lumaMean: 150,
  temperature: 'warm',
  colorfulness: 48,
  dominantHue: 25,
  hueConcentration: 0.7,
  orientation: 'landscape',
  skyBias: 0.5,
  edgeDensity: 0.12,
});

const portraitImage = content({
  assetId: 'retrato',
  width: 1080,
  height: 1920,
  aspect: 0.563,
  orientation: 'portrait',
  lumaMean: 120,
  faceCount: 1,
  faceSize: 0.4,
  faceCenterX: 0.5,
  faceCenterY: 0.4,
  skyBias: 0,
});

const crowdImage = content({
  assetId: 'multitud',
  lumaMean: 110,
  edgeDensity: 0.44,
  colorfulness: 40,
  faceCount: 1,
  faceSize: 0.15,
});

describe('normalizeToken', () => {
  it('quita acentos, mayúsculas y puntuación', () => {
    expect(normalizeToken('Atardecer, en el MAR.')).toBe('atardecer en el mar');
    expect(normalizeToken('  NIÑO  ')).toBe('nino');
  });
});

describe('desiredTraits', () => {
  it('traduce palabras visuales a atributos', () => {
    const traits = desiredTraits('Un atardecer cálido sobre el mar');
    expect(traits.warm).toBeGreaterThan(0.5);
    expect(traits.bright).toBeGreaterThan(0);
    expect(traits.wide).toBeGreaterThan(0);
  });

  it('devuelve vacío cuando no hay pistas visuales', () => {
    expect(desiredTraits('y entonces dijimos que sí')).toEqual({});
  });

  it('no duplica el peso de un atributo repetido', () => {
    const once = desiredTraits('noche');
    const twice = desiredTraits('noche oscuro medianoche');
    expect(twice.dark).toBeLessThanOrEqual(1);
    expect(once.dark).toBe(1);
  });
});

describe('deriveTraits', () => {
  it('marca como oscura una imagen de baja luminancia', () => {
    const traits = deriveTraits(darkImage);
    expect(traits.dark).toBeGreaterThan(0.5);
    expect(traits.bright).toBeLessThan(0.3);
  });

  it('marca personas cuando hay rostro detectado', () => {
    expect(deriveTraits(portraitImage).people).toBeGreaterThan(0.5);
    expect(deriveTraits(content()).people).toBe(0);
  });

  it('distingue vertical de horizontal', () => {
    expect(deriveTraits(portraitImage).tall).toBe(1);
    expect(deriveTraits(portraitImage).wide).toBe(0);
    expect(deriveTraits(sunsetImage).wide).toBe(1);
  });
});

describe('scoreImage', () => {
  it('prefiere una imagen cálida y luminosa para un atardecer', () => {
    const sunset = scoreImage('el atardecer sobre el mar', deriveTraits(sunsetImage));
    const dark = scoreImage('el atardecer sobre el mar', deriveTraits(darkImage));
    expect(sunset.score).toBeGreaterThan(dark.score);
    expect(sunset.reasons).toContain('cálida');
  });

  it('prefiere un retrato para una frase sobre una persona', () => {
    const portrait = scoreImage('ella mira a cámara', deriveTraits(portraitImage));
    const empty = scoreImage('ella mira a cámara', deriveTraits(content()));
    expect(portrait.score).toBeGreaterThan(empty.score);
  });

  it('devuelve cero sin pistas en el texto', () => {
    const scored = scoreImage('bueno, entonces seguimos', deriveTraits(sunsetImage));
    expect(scored.score).toBe(0);
    expect(scored.reasons).toEqual([]);
  });
});

describe('planImageAssignments', () => {
  it('no repite la misma imagen de forma inmediata', () => {
    const images = [sunsetImage, portraitImage];
    const sentences = ['atardecer', 'retrato', 'atardecer', 'retrato'];
    const plan = planImageAssignments(sentences, images);
    for (let index = 1; index < plan.length; index += 1) {
      expect(plan[index]!.imageIndex).not.toBe(plan[index - 1]!.imageIndex);
    }
  });

  it('asigna la imagen correcta por contenido', () => {
    const images = [darkImage, sunsetImage, portraitImage];
    const sentences = ['el atardecer dorado', 'la noche cerrada', 'el retrato de ella'];
    const plan = planImageAssignments(sentences, images);
    expect(plan[0]!.imageIndex).toBe(1);
    expect(plan[1]!.imageIndex).toBe(0);
    expect(plan[2]!.imageIndex).toBe(2);
  });

  it('abre con un plano amplio de exterior cuando hay material', () => {
    const wideOpen = content({ assetId: 'paisaje', orientation: 'landscape', skyBias: 0.6 });
    const closeUp = content({ assetId: 'detalle', edgeDensity: 0.5, orientation: 'portrait' });
    const plan = planImageAssignments(['empezamos el viaje'], [closeUp, wideOpen]);
    expect(plan[0]!.imageIndex).toBe(1);
  });

  it('reparte el material en vez de agotar las mejores fotos', () => {
    const images = [sunsetImage, portraitImage, crowdImage];
    const sentences = Array.from({ length: 9 }, () => 'una escena cualquiera');
    const plan = planImageAssignments(sentences, images);
    const used = new Set(plan.map((item) => item.imageIndex));
    expect(used.size).toBe(3);
  });

  it('con una sola imagen la usa siempre', () => {
    const plan = planImageAssignments(['a', 'b', 'c'], [sunsetImage]);
    expect(plan.map((item) => item.imageIndex)).toEqual([0, 0, 0]);
  });

  it('devuelve vacío sin frases o sin imágenes', () => {
    expect(planImageAssignments([], [sunsetImage])).toEqual([]);
    expect(planImageAssignments(['algo'], [])).toEqual([]);
  });

  it('es determinista', () => {
    const images = [sunsetImage, portraitImage, crowdImage, darkImage];
    const sentences = ['atardecer', 'gente', 'noche', 'retrato', 'mar'];
    const first = planImageAssignments(sentences, images);
    const second = planImageAssignments(sentences, images);
    expect(first).toEqual(second);
  });

  it('penaliza dos fotos casi idénticas seguidas', () => {
    const twinA = content({ assetId: 'a', lumaMean: 140, edgeDensity: 0.2 });
    const twinB = content({ assetId: 'b', lumaMean: 142, edgeDensity: 0.21 });
    const other = content({ assetId: 'c', lumaMean: 60, edgeDensity: 0.6 });
    const plan = planImageAssignments(['algo neutro', 'algo neutro', 'algo neutro'], [
      twinA,
      twinB,
      other,
    ]);
    // La primera y la segunda no deberían ser el par casi idéntico.
    expect(plan[0]!.imageIndex).not.toBe(1);
  });
});

describe('describeImage', () => {
  it('resume rasgos legibles', () => {
    expect(describeImage(sunsetImage)).toContain('cálida');
    expect(describeImage(darkImage)).toContain('muy oscura');
    expect(describeImage(portraitImage)).toContain('vertical');
    expect(describeImage(portraitImage)).toContain('con una persona');
  });

  it('no inventa rasgos cuando la imagen es neutra', () => {
    const neutral = content({ lumaMean: 130, colorfulness: 25, edgeDensity: 0.2, temperature: 'neutral' });
    expect(describeImage(neutral)).toContain('horizontal');
  });
});
