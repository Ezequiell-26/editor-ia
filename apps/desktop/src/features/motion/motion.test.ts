import { describe, expect, it } from 'vitest';
import { createEmptyProject } from '@editor-ia/project-schema';
import {
  badgeTemplate,
  buildMotionPlan,
  contornoTemplate,
  buildProjectMotionPlans,
  faixaLetreiroTemplate,
  faixaCidadeTemplate,
  faixaEsporteTemplate,
  faixaJornalTemplate,
  faixaAovivoTemplate,
  faixaPlantaoTemplate,
  faixaLimpoTemplate,
  faixaDegradeTemplate,
  faixaNomeTemplate,
  freeTextTemplate,
  layerVisual,
  lowerThirdTemplate,
  molduraTemplate,
  MotionPlanError,
  shapeTemplate,
  solidFrameTemplate,
  titleCardTemplate,
} from '../../state/motion-plan';
import { templateById } from '../../state/motion-templates';

const NOW = '2026-01-01T00:00:00.000Z';
const context = {
  width: 1920,
  height: 1080,
  fpsNum: 30,
  fpsDen: 1,
  durationFrames: 90,
};

describe('motion plan', () => {
  it('construye un lower third con fondo y dos textos', () => {
    const plan = buildMotionPlan(
      lowerThirdTemplate,
      {
        name: 'Ana Pérez',
        role: 'Editora',
        accent: '#7dd3c0',
        side: 'left',
        animation: 'slide-left',
      },
      context,
    );
    expect(plan.layers.filter((layer) => layer.kind === 'text')).toHaveLength(2);
    expect(plan.layers.some((layer) => layer.kind === 'rect')).toBe(true);
    for (const layer of plan.layers) {
      expect(layer.x).toBeGreaterThanOrEqual(0);
      expect(layer.x + layer.width).toBeLessThanOrEqual(1.0001);
      expect(layer.y).toBeGreaterThanOrEqual(0);
      expect(layer.y + layer.height).toBeLessThanOrEqual(1.0001);
    }
  });

  it('rechaza un color inválido sin inventar una plantilla', () => {
    expect(() =>
      buildMotionPlan(
        lowerThirdTemplate,
        { name: 'Ana', role: '', accent: 'rojo', side: 'left', animation: 'fade' },
        context,
      ),
    ).toThrow(MotionPlanError);
  });

  it('envuelve un título largo en varias líneas y respeta el límite', () => {
    const plan = buildMotionPlan(
      titleCardTemplate,
      {
        title:
          'Una historia larga sobre edición de video que necesita varias líneas para entrar bien',
        subtitle: 'Prueba',
        background: '#0f172a',
        accent: '#7dd3c0',
        align: 'left',
        animation: 'slide-up',
      },
      context,
    );
    const texts = plan.layers.filter((layer) => layer.kind === 'text');
    expect(texts.length).toBeGreaterThan(2);
    expect(texts.length).toBeLessThanOrEqual(8);
  });

  it('calcula fade y slide sin salir de rango', () => {
    const layer = {
      kind: 'text' as const,
      x: 0.1,
      y: 0.1,
      width: 0.5,
      height: 0.1,
      text: 'Hola',
      fontFamily: 'Segoe UI',
      fontSizePx: 48,
      weight: 600,
      color: '#ffffff',
      align: 'left' as const,
      animation: { kind: 'fade' as const, inFrames: 10, outFrames: 10 },
    };
    const mid = layerVisual(layer, 0.5, 60);
    expect(mid.opacity).toBeGreaterThan(0.9);
    expect(mid.opacity).toBeLessThanOrEqual(1);
    const slide = layerVisual(
      { ...layer, animation: { kind: 'slide-up', distance: 0.1 } },
      0.1,
      60,
    );
    expect(slide.transform).toContain('translateY');
  });

  it('la animación write revela el texto con clip-path progresivo', () => {
    const layer = {
      kind: 'text' as const,
      x: 0.1,
      y: 0.5,
      width: 0.5,
      height: 0.1,
      text: 'Se escribe',
      fontFamily: 'Segoe UI',
      fontSizePx: 48,
      weight: 600,
      color: '#ffffff',
      align: 'left' as const,
      animation: { kind: 'write' as const, inFrames: 30, outFrames: 0 },
    };
    // Al inicio el clip-path deja ver ~0 %; a mitad de la entrada ~la
    // mitad; al final de la entrada el 100 %.
    const start = layerVisual(layer, 0, 60);
    expect(start.clipPath).toContain('inset(0 100.00% 0 0)');
    const mid = layerVisual(layer, 0.25, 60);
    const midPct = Number(/inset\(0 ([\d.]+)%/.exec(mid.clipPath ?? '')?.[1]);
    expect(midPct).toBeGreaterThan(0);
    expect(midPct).toBeLessThan(100);
    const end = layerVisual(layer, 0.75, 60);
    expect(end.clipPath).toContain('inset(0 0.00% 0 0)');
    // La opacidad no se desvanece durante la escritura (fade in corto).
    expect(end.opacity).toBeGreaterThan(0.9);
  });

  it('la animación wipe revela cualquier capa con el mismo clip-path', () => {
    // Paridad de los clip-paths de entrada de `faixas.js`: el barrido
    // aplica a rect/texto por igual (en el export es `\clip` + `\t`).
    const rect = {
      kind: 'rect' as const,
      x: 0.05,
      y: 0.7,
      width: 0.6,
      height: 0.15,
      color: '#1f2937',
      opacity: 0.96,
      animation: { kind: 'wipe' as const, inFrames: 20, outFrames: 0 },
    };
    const start = layerVisual(rect, 0, 60);
    expect(start.clipPath).toContain('inset(0 100.00% 0 0)');
    const end = layerVisual(rect, 0.5, 60);
    expect(end.clipPath).toContain('inset(0 0.00% 0 0)');
    // Fuera de la entrada el clip queda abierto al 100 %.
    const after = layerVisual(rect, 0.9, 60);
    expect(after.clipPath).toContain('inset(0 0.00% 0 0)');
  });

  it('la animación back sobresale y asienta en escala 1', () => {
    // easeOutBack de `faixas.js`: crece, supera 1 (~1.04) y vuelve a 1.
    const layer = {
      kind: 'rect' as const,
      x: 0.1,
      y: 0.1,
      width: 0.3,
      height: 0.3,
      color: '#ffffff',
      opacity: 1,
      animation: { kind: 'back' as const, inFrames: 20, outFrames: 0 },
    };
    const scaleOf = (progress: number) =>
      Number(/scale\(([\d.]+)\)/.exec(layerVisual(layer, progress, 60).transform)?.[1]);
    expect(scaleOf(0)).toBeLessThan(0.7);
    // Pico del sobreimpulso (~58 % de la entrada de 20 frames → frame ~12
    // de 60 → progress 0.2).
    const peak = scaleOf(0.2);
    expect(peak).toBeGreaterThan(1);
    const settled = scaleOf(0.5);
    expect(settled).toBeCloseTo(1, 2);
  });

  it('indexa planes por clip y reporta un motion faltante', () => {
    const project = createEmptyProject('Motion', NOW);
    const track = {
      id: '00000000-0000-4000-8000-000000000001',
      kind: 'graphic' as const,
      label: 'G1',
      order: 0,
      muted: false,
      hidden: false,
      locked: false,
    };
    project.timeline.tracks.push(track);
    project.motion.push({
      id: '00000000-0000-4000-8000-000000000002',
      template: { id: 'lower-third', version: '1.0.0', source: 'bundled' },
      props: { name: 'Ana', role: '', accent: '#7dd3c0', side: 'left', animation: 'fade' },
    });
    project.timeline.clips.push({
      id: '00000000-0000-4000-8000-000000000003',
      trackId: track.id,
      kind: 'graphic',
      label: 'Placa',
      startFrame: 0,
      durationFrames: 90,
      source: { type: 'graphic', motionId: project.motion[0]!.id },
    });
    const bundle = buildProjectMotionPlans(project);
    expect(bundle.plans['00000000-0000-4000-8000-000000000003']).toBeDefined();
    expect(bundle.errors).toEqual([]);

    project.timeline.clips[0]!.source = {
      type: 'graphic',
      motionId: '00000000-0000-4000-8000-000000000099',
    };
    const broken = buildProjectMotionPlans(project);
    expect(broken.errors[0]).toMatch(/no existe/i);
  });

  it('el contorno produce una capa stroke que cubre el frame', () => {
    const plan = buildMotionPlan(
      contornoTemplate,
      { color: '#ff2233', thickness: 0.02, radius: 0.12, drawSeconds: 0.8, animation: 'none' },
      context,
    );
    expect(plan.layers).toHaveLength(1);
    const layer = plan.layers[0]!;
    expect(layer.kind).toBe('stroke');
    if (layer.kind === 'stroke') {
      expect(layer.color).toBe('#ff2233');
      expect(layer.thickness).toBeCloseTo(0.02);
      expect(layer.drawSeconds).toBeCloseTo(0.8);
      // La caja deja margen de medio grosor en cada eje.
      const minSide = Math.min(context.width, context.height);
      const marginX = (0.02 * minSide) / 2 / context.width;
      expect(layer.x).toBeCloseTo(marginX);
      expect(layer.width).toBeCloseTo(1 - 2 * marginX);
    }
  });

  it('el letreiro produce una banda paralelogramo con texto contrastado', () => {
    const plan = buildMotionPlan(
      faixaLetreiroTemplate,
      {
        name: 'Ana Pérez',
        role: 'Editora',
        bandColor: '#1f2937',
        slant: 0.1,
        side: 'left',
        animation: 'slide-left',
      },
      context,
    );
    const band = plan.layers.find((layer) => layer.kind === 'rect');
    expect(band).toBeDefined();
    if (band?.kind === 'rect') {
      expect(band.shape).toBe('custom');
      expect(band.points).toHaveLength(4);
      // Shear: el borde superior arranca corrido hacia la derecha.
      expect(band.points![0]!.x).toBeCloseTo(0.1);
      expect(band.points![3]!.x).toBeCloseTo(0);
    }
    const texts = plan.layers.filter((layer) => layer.kind === 'text');
    expect(texts.length).toBeGreaterThanOrEqual(2);
    // Banda oscura → tinta clara (réplica de `sobre()` de faixas.js).
    for (const layer of texts) {
      if (layer.kind === 'text') expect(layer.color).toBe('#ffffff');
    }
    // Banda clara → tinta oscura.
    const light = buildMotionPlan(
      faixaLetreiroTemplate,
      {
        name: 'Ana',
        role: '',
        bandColor: '#fbbf24',
        slant: 0,
        side: 'right',
        animation: 'fade',
      },
      context,
    );
    const lightTexts = light.layers.filter((layer) => layer.kind === 'text');
    expect(lightTexts.length).toBeGreaterThanOrEqual(1);
    for (const layer of lightTexts) {
      if (layer.kind === 'text') expect(layer.color).toBe('#101318');
    }
    for (const layer of plan.layers) {
      expect(layer.x).toBeGreaterThanOrEqual(0);
      expect(layer.x + layer.width).toBeLessThanOrEqual(1.0001);
      expect(layer.y).toBeGreaterThanOrEqual(0);
      expect(layer.y + layer.height).toBeLessThanOrEqual(1.0001);
    }
  });

  it('el letreiro con ícono dibuja la figura junto al nombre', () => {
    const base = {
      name: 'Ana Pérez',
      role: 'Editora',
      bandColor: '#1f2937',
      slant: 0.1,
      animation: 'fade' as const,
    };
    // «Cierto» = polilínea abierta con trazo.
    const check = buildMotionPlan(
      faixaLetreiroTemplate,
      { ...base, side: 'left', icon: 'check' },
      context,
    );
    const checkIcon = check.layers.find(
      (layer) => layer.kind === 'rect' && layer.shape === 'line',
    );
    expect(checkIcon).toBeDefined();
    if (checkIcon?.kind === 'rect') {
      expect(checkIcon.points).toHaveLength(3);
      expect(checkIcon.strokeWidth).toBeGreaterThan(0);
      // El texto arranca después del ícono (corre a la derecha).
      const name = check.layers.find(
        (layer) => layer.kind === 'text' && layer.text === 'Ana Pérez',
      );
      expect(name && name.kind === 'text' ? name.x : 0).toBeGreaterThan(
        checkIcon.x + checkIcon.width,
      );
    }
    // «Persona» y «pulgar» = polígonos propios de 15 y 12 puntos.
    for (const [icon, points] of [
      ['person', 15],
      ['thumb', 12],
    ] as const) {
      const plan = buildMotionPlan(
        faixaLetreiroTemplate,
        { ...base, side: 'left', icon },
        context,
      );
      const iconLayer = plan.layers.find(
        (layer) =>
          layer.kind === 'rect' &&
          layer.shape === 'custom' &&
          layer.width < 0.2,
      );
      expect(iconLayer?.kind === 'rect' ? iconLayer.points : []).toHaveLength(points);
    }
    // «Estrella» reusa la forma `star` del catálogo.
    const star = buildMotionPlan(
      faixaLetreiroTemplate,
      { ...base, side: 'right', icon: 'star' },
      context,
    );
    expect(
      star.layers.some(
        (layer) => layer.kind === 'rect' && layer.shape === 'star',
      ),
    ).toBe(true);
    // Sin ícono no hay capa extra.
    const none = buildMotionPlan(
      faixaLetreiroTemplate,
      { ...base, side: 'left', icon: 'none' },
      context,
    );
    expect(none.layers.filter((layer) => layer.kind === 'rect')).toHaveLength(1);
  });

  it('la banda degradado apila slices con colores interpolados', () => {
    const plan = buildMotionPlan(
      faixaDegradeTemplate,
      {
        name: 'Ana Pérez',
        role: 'Editora',
        colorFrom: '#000000',
        colorTo: '#ffffff',
        animation: 'fade',
      },
      context,
    );
    const bands = plan.layers.filter((layer) => layer.kind === 'rect');
    // 6 slices del degradado + sin otras formas.
    expect(bands).toHaveLength(6);
    expect(bands[0]).toMatchObject({ color: '#000000', width: 1 });
    expect(bands[5]).toMatchObject({ color: '#ffffff' });
    // Interpolación: índice 2 de 6 → t=0,4 → 102/255.
    expect(bands[2]!.kind === 'rect' && bands[2]!.color).toBe('#666666');
    // Los slices cubren la banda de forma contigua (ordenados por y).
    const sorted = [...bands].sort((a, b) => a.y - b.y);
    for (let i = 1; i < sorted.length; i += 1) {
      const prev = sorted[i - 1]!;
      const curr = sorted[i]!;
      expect(curr.y).toBeLessThanOrEqual(prev.y + prev.height + 0.001);
    }
    const last = sorted[sorted.length - 1]!;
    expect(last.y + last.height).toBeLessThanOrEqual(0.87);
    expect(last.y + last.height).toBeGreaterThan(0.8);
    for (const layer of plan.layers) {
      expect(layer.x).toBeGreaterThanOrEqual(0);
      expect(layer.x + layer.width).toBeLessThanOrEqual(1.0001);
      expect(layer.y).toBeGreaterThanOrEqual(0);
      expect(layer.y + layer.height).toBeLessThanOrEqual(1.0001);
    }
    const texts = plan.layers.filter((layer) => layer.kind === 'text');
    expect(texts.length).toBeGreaterThanOrEqual(2);
    // Degradado oscuro→claro: el medio es gris medio → tinta clara.
    for (const layer of texts) {
      if (layer.kind === 'text') expect(layer.color).toBe('#ffffff');
    }
  });

  it('expone las cinco plantillas con versión', () => {
    for (const id of [
      'title-card',
      'free-text',
      'lower-third',
      'end-card',
      'stat-callout',
    ]) {
      expect(templateById(id)?.version).toBe('1.0.0');
    }
  });

  it('la insignia usa la primera forma no rectangular (elipse)', () => {
    const plan = buildMotionPlan(
      badgeTemplate,
      { text: 'NUEVO', color: '#7c3aed', textColor: '#ffffff', animation: 'pop' },
      context,
    );
    const shapes = plan.layers.filter((layer) => layer.kind === 'rect');
    expect(shapes).toHaveLength(1);
    expect(shapes[0]).toMatchObject({ shape: 'ellipse', color: '#7c3aed' });
    const texts = plan.layers.filter((layer) => layer.kind === 'text');
    expect(texts).toHaveLength(1);
    expect(texts[0]).toMatchObject({ text: 'NUEVO', color: '#ffffff', align: 'center' });
    for (const layer of plan.layers) {
      expect(layer.x).toBeGreaterThanOrEqual(0);
      expect(layer.x + layer.width).toBeLessThanOrEqual(1.0001);
      expect(layer.y).toBeGreaterThanOrEqual(0);
      expect(layer.y + layer.height).toBeLessThanOrEqual(1.0001);
    }
  });

  it('la insignia cambia de forma con el campo shape', () => {
    for (const [shape, expected] of [
      ['triangle', 'triangle'],
      ['diamond', 'diamond'],
      ['ellipse', 'ellipse'],
      ['star', 'star'],
      ['pentagon', 'pentagon'],
      ['hexagon', 'hexagon'],
      ['arrow', 'arrow'],
      ['parallelogram', 'parallelogram'],
      ['trapezoid', 'trapezoid'],
      ['heart', 'heart'],
    ] as const) {
      const plan = buildMotionPlan(
        badgeTemplate,
        { text: 'NUEVO', shape },
        context,
      );
      const badge = plan.layers.find((layer) => layer.kind === 'rect');
      expect(badge).toMatchObject({ shape: expected });
    }
    // Sin shape en props cae al default de la plantilla.
    const plan = buildMotionPlan(badgeTemplate, { text: 'NUEVO' }, context);
    expect(plan.layers.find((layer) => layer.kind === 'rect')).toMatchObject({
      shape: 'ellipse',
    });
  });

  it('la insignia personalizada dibuja el polígono de points', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0.5, y: 1 },
    ];
    const plan = buildMotionPlan(
      badgeTemplate,
      { text: 'NUEVO', shape: 'custom', points },
      context,
    );
    const badge = plan.layers.find((layer) => layer.kind === 'rect');
    expect(badge).toMatchObject({ shape: 'custom', points });
    // Las formas con nombre ignoran los puntos aunque vengan en props.
    const named = buildMotionPlan(
      badgeTemplate,
      { text: 'NUEVO', shape: 'star', points },
      context,
    );
    const star = named.layers.find((layer) => layer.kind === 'rect');
    expect(star).toMatchObject({ shape: 'star' });
    expect(star && 'points' in star ? star.points : undefined).toBeUndefined();
  });

  it('la insignia personalizada sin points usa el polígono por defecto', () => {
    const plan = buildMotionPlan(badgeTemplate, { text: 'NUEVO', shape: 'custom' }, context);
    const badge = plan.layers.find((layer) => layer.kind === 'rect');
    expect(badge).toMatchObject({
      shape: 'custom',
      points: [
        { x: 0.12, y: 0.2 },
        { x: 0.5, y: 0.8 },
        { x: 0.88, y: 0.2 },
      ],
    });
  });

  it('rechaza puntos de forma inválidos', () => {
    for (const points of [
      [{ x: 0, y: 0 }, { x: 1, y: 0 }],
      [{ x: -0.1, y: 0 }, { x: 1, y: 0 }, { x: 0.5, y: 1 }],
      [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0.5, y: 1.5 }],
    ]) {
      expect(() =>
        buildMotionPlan(badgeTemplate, { text: 'NUEVO', shape: 'custom', points }, context),
      ).toThrow(MotionPlanError);
    }
  });

  it('rechaza props inválidas de la insignia', () => {
    expect(() =>
      buildMotionPlan(badgeTemplate, { text: '', color: '#fff', textColor: '#fff' }, context),
    ).toThrow(MotionPlanError);
  });

  it('acota el texto libre en 4K vertical y no desborda las líneas', () => {
    const plan = buildMotionPlan(
      freeTextTemplate,
      {
        ...freeTextTemplate.defaults,
        text: 'uno\ndos\ntres\ncuatro\ncinco\nseis',
        size: 200,
        y: 0.1,
        width: 0.9,
      },
      { width: 2160, height: 3840, fpsNum: 30, fpsDen: 1, durationFrames: 90 },
    );
    const texts = plan.layers.filter((layer) => layer.kind === 'text');
    expect(texts.length).toBeGreaterThan(0);
    for (const layer of texts) {
      expect(layer.fontSizePx).toBeLessThanOrEqual(400);
      expect(layer.y).toBeLessThanOrEqual(1);
      expect(layer.y + layer.height).toBeLessThanOrEqual(1.001);
    }
  });

  it('la plantilla Forma centra la figura y respeta size/shape/custom', () => {
    const plan = buildMotionPlan(
      shapeTemplate,
      { shape: 'star', color: '#ff5500', size: 0.5, animation: 'pop' },
      context,
    );
    expect(plan.layers).toHaveLength(1);
    const layer = plan.layers[0];
    expect(layer?.kind).toBe('rect');
    if (layer?.kind !== 'rect') return;
    expect(layer.shape).toBe('star');
    expect(layer.color).toBe('#ff5500');
    // size 0.5 del lado menor (1080) → caja de 540px centrada en 1920×1080.
    expect(layer.width).toBeCloseTo(540 / 1920, 5);
    expect(layer.height).toBeCloseTo(540 / 1080, 5);
    expect(layer.x + layer.width / 2).toBeCloseTo(0.5, 5);
    expect(layer.y + layer.height / 2).toBeCloseTo(0.5, 5);

    const custom = buildMotionPlan(
      shapeTemplate,
      {
        ...shapeTemplate.defaults,
        shape: 'custom',
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 0.5, y: 1 },
        ],
      },
      context,
    );
    const customLayer = custom.layers[0];
    expect(customLayer?.kind === 'rect' && customLayer.shape).toBe('custom');
    expect(customLayer?.kind === 'rect' && customLayer.points).toHaveLength(3);
  });

  it('la plantilla Forma acepta paralelogramo, trapecio, corazón y mano', () => {
    // Paridad `formas.js` de AlaukCut: las 10 figuras del editor de formas
    // más la mano señaladora de `maozinha`.
    for (const shape of ['parallelogram', 'trapezoid', 'heart', 'hand'] as const) {
      const plan = buildMotionPlan(
        shapeTemplate,
        { shape, animation: 'none' },
        context,
      );
      const layer = plan.layers[0];
      expect(layer?.kind === 'rect' && layer.shape).toBe(shape);
    }
  });

  it('la plantilla Forma emite trazo cuando strokeWidth > 0', () => {
    const stroked = buildMotionPlan(
      shapeTemplate,
      {
        shape: 'triangle',
        color: '#112233',
        strokeColor: '#ff0000',
        strokeWidth: 0.05,
        animation: 'none',
      },
      context,
    );
    const layer = stroked.layers[0];
    expect(layer?.kind).toBe('rect');
    if (layer?.kind !== 'rect') return;
    expect(layer.strokeColor).toBe('#ff0000');
    expect(layer.strokeWidth).toBeCloseTo(0.05, 5);

    // strokeWidth 0 (default) no emite campos de trazo.
    const plain = buildMotionPlan(shapeTemplate, { shape: 'rect' }, context);
    const plainLayer = plain.layers[0];
    expect(plainLayer?.kind === 'rect' && plainLayer.strokeWidth).toBeUndefined();
  });

  it('la forma line emite polilínea con puntos y trazo mínimo', () => {
    const plan = buildMotionPlan(
      shapeTemplate,
      {
        shape: 'line',
        strokeColor: '#ff0000',
        strokeWidth: 0,
        points: [
          { x: 0.1, y: 0.5 },
          { x: 0.9, y: 0.5 },
        ],
        animation: 'none',
      },
      context,
    );
    const layer = plan.layers[0];
    expect(layer?.kind).toBe('rect');
    if (layer?.kind !== 'rect') return;
    expect(layer.shape).toBe('line');
    expect(layer.points).toHaveLength(2);
    // Sin strokeWidth el template fuerza un grosor mínimo visible.
    expect(layer.strokeWidth).toBeCloseTo(0.015, 5);
    expect(layer.strokeColor).toBe('#ff0000');
  });

  it('la forma emite sombra cuando shadowDistance > 0', () => {
    const plan = buildMotionPlan(
      shapeTemplate,
      {
        shape: 'ellipse',
        shadowColor: '#112233',
        shadowDistance: 0.02,
        shadowAngle: 180,
        shadowOpacity: 0.4,
        animation: 'none',
      },
      context,
    );
    const layer = plan.layers[0];
    expect(layer?.kind).toBe('rect');
    if (layer?.kind !== 'rect') return;
    // shadowDistance es fracción del lado menor del frame (1080) → px.
    expect(layer.shadow?.color).toBe('#112233');
    expect(layer.shadow?.offsetPx).toBeCloseTo(0.02 * 1080, 5);
    expect(layer.shadow?.angleDeg).toBe(180);
    expect(layer.shadow?.opacity).toBe(0.4);

    const plain = buildMotionPlan(shapeTemplate, { shape: 'rect' }, context);
    const plainLayer = plain.layers[0];
    expect(plainLayer?.kind === 'rect' && plainLayer.shadow).toBeUndefined();
  });

  it('la forma acepta una caja libre (trazos manuscritos)', () => {
    const plan = buildMotionPlan(
      shapeTemplate,
      {
        shape: 'line',
        strokeColor: '#ffd23f',
        strokeWidth: 0.018,
        boxX: 0.2,
        boxY: 0.3,
        boxWidth: 0.5,
        boxHeight: 0.4,
        points: [
          { x: 0, y: 0 },
          { x: 0.5, y: 1 },
          { x: 1, y: 0.2 },
        ],
        animation: 'none',
      },
      context,
    );
    const layer = plan.layers[0];
    expect(layer?.kind).toBe('rect');
    if (layer?.kind !== 'rect') return;
    expect(layer.x).toBeCloseTo(0.2, 5);
    expect(layer.y).toBeCloseTo(0.3, 5);
    expect(layer.width).toBeCloseTo(0.5, 5);
    expect(layer.height).toBeCloseTo(0.4, 5);
    expect(layer.shape).toBe('line');
    expect(layer.points).toHaveLength(3);
    // Sin box → caja cuadrada centrada de `size` (comportamiento previo).
    const centered = buildMotionPlan(shapeTemplate, { shape: 'rect', size: 0.5 }, context);
    const centeredLayer = centered.layers[0];
    if (centeredLayer?.kind !== 'rect') return;
    // Caja cuadrada en píxeles centrada en el frame (frame no cuadrado:
    // las fracciones x/y no son iguales).
    expect(centeredLayer.x + centeredLayer.width / 2).toBeCloseTo(0.5, 5);
    expect(centeredLayer.y + centeredLayer.height / 2).toBeCloseTo(0.5, 5);
  });

  it('el cuadro sólido cubre el frame completo con el color pedido', () => {
    const plan = buildMotionPlan(solidFrameTemplate, { color: '#123456' }, context);
    expect(plan.layers).toHaveLength(1);
    const layer = plan.layers[0];
    expect(layer?.kind).toBe('rect');
    if (layer?.kind !== 'rect') return;
    expect(layer.x).toBe(0);
    expect(layer.y).toBe(0);
    expect(layer.width).toBe(1);
    expect(layer.height).toBe(1);
    expect(layer.color).toBe('#123456');
    expect(layer.opacity).toBe(1);
    // El esquema completa los defaults: sin `animation` en props el plan
    // igual construye (lo valida propsSchema antes de llegar acá).
    const byDefault = buildMotionPlan(solidFrameTemplate, {}, context);
    expect(byDefault.layers[0]?.kind).toBe('rect');
  });

  it('la moldura borde arma 4 barras en los bordes del frame', () => {
    const plan = buildMotionPlan(
      molduraTemplate,
      { style: 'borde', color: '#ff0000', thickness: 0.01, margin: 0.02, opacity: 0.8 },
      context,
    );
    expect(plan.layers).toHaveLength(4);
    const rects = plan.layers.filter((l) => l.kind === 'rect');
    expect(rects).toHaveLength(4);
    // minSide=1080 → tPx=10.8, tY=10/1080≈0.00926, tX=10.8/1920=0.005625.
    const top = rects[0];
    const bottom = rects[1];
    const left = rects[2];
    const right = rects[3];
    if (top?.kind !== 'rect' || bottom?.kind !== 'rect' || left?.kind !== 'rect' || right?.kind !== 'rect') return;
    // Barras horizontales: ancho interior completo, alto = grosor.
    expect(top.height).toBeCloseTo(10.8 / 1080, 5);
    expect(top.width).toBeCloseTo(1 - 2 * (0.02 * 1080) / 1920, 5);
    expect(top.y).toBeCloseTo((0.02 * 1080) / 1080, 5);
    expect(bottom.y + bottom.height).toBeCloseTo(1 - (0.02 * 1080) / 1080, 5);
    // Barras verticales: angostas y entre las horizontales.
    expect(left.width).toBeCloseTo(10.8 / 1920, 5);
    expect(left.x).toBeCloseTo((0.02 * 1080) / 1920, 5);
    expect(left.y).toBeCloseTo((0.02 * 1080 + 10.8) / 1080, 5);
    expect(left.height).toBeCloseTo(1 - 2 * ((0.02 * 1080 + 10.8) / 1080), 5);
    expect(right.x + right.width).toBeCloseTo(1 - (0.02 * 1080) / 1920, 5);
    for (const r of rects) {
      if (r.kind === 'rect') {
        expect(r.color).toBe('#ff0000');
        expect(r.opacity).toBe(0.8);
      }
    }
  });

  it('la moldura esquinas arma 8 tramos y la doble 8 barras', () => {
    const esquinas = buildMotionPlan(molduraTemplate, { style: 'esquinas' }, context);
    expect(esquinas.layers).toHaveLength(8);
    const doble = buildMotionPlan(molduraTemplate, { style: 'doble' }, context);
    expect(doble.layers).toHaveLength(8);
    // El borde interior de la doble queda más adentro que el exterior.
    const outer = doble.layers[0];
    const inner = doble.layers[4];
    if (outer?.kind === 'rect' && inner?.kind === 'rect') {
      expect(inner.y).toBeGreaterThan(outer.y);
    }
  });

  it('las tarjetas nome apilan nombre sobre rol con barra de acento', () => {
    const plan = buildMotionPlan(
      faixaNomeTemplate,
      {
        name: 'Ana Pérez',
        role: 'Editora',
        nameCardColor: '#ffffff',
        roleCardColor: '#16181d',
        accentColor: '#e2001a',
        animation: 'slide-left',
      },
      context,
    );
    const rects = plan.layers.filter((layer) => layer.kind === 'rect');
    const texts = plan.layers.filter((layer) => layer.kind === 'text');
    // Barra + tarjeta nombre + tarjeta rol.
    expect(rects).toHaveLength(3);
    expect(texts).toHaveLength(2);
    const [bar, nameCard, roleCard] = rects;
    expect(bar?.color).toBe('#e2001a');
    // La barra abarca ambas tarjetas (más alta que cada una).
    expect(bar!.height).toBeGreaterThan(nameCard!.height);
    expect(nameCard!.y).toBeLessThan(roleCard!.y);
    // Tarjetas a la derecha de la barra.
    expect(nameCard!.x).toBeGreaterThan(bar!.x);
    // Tinta automática por luminancia (réplica de `sobre()` de faixas.js).
    const nameText = texts.find((layer) => layer.kind === 'text' && layer.text === 'Ana Pérez');
    const roleText = texts.find((layer) => layer.kind === 'text' && layer.text === 'Editora');
    expect(nameText?.kind === 'text' && nameText.color).toBe('#101318');
    expect(roleText?.kind === 'text' && roleText.color).toBe('#ffffff');
    // Sin rol: sólo barra + tarjeta de nombre + texto.
    const noRole = buildMotionPlan(
      faixaNomeTemplate,
      { name: 'Ana', role: '', nameCardColor: '#ffffff', roleCardColor: '#16181d', accentColor: '#e2001a', animation: 'none' },
      context,
    );
    expect(noRole.layers.filter((layer) => layer.kind === 'rect')).toHaveLength(2);
    expect(noRole.layers.filter((layer) => layer.kind === 'text')).toHaveLength(1);
  });

  it('el estilo limpo pone texto con sombra y línea de acento', () => {
    const plan = buildMotionPlan(
      faixaLimpoTemplate,
      {
        name: 'Ana Pérez',
        role: 'Editora',
        nameColor: '#ffffff',
        roleColor: '#e9edf2',
        accentColor: '#3fe4ff',
        shadowBlur: 0.02,
        skewDeg: 14,
        animation: 'fade',
      },
      context,
    );
    const texts = plan.layers.filter((layer) => layer.kind === 'text');
    expect(texts).toHaveLength(2);
    const name = texts[0];
    const role = texts[1];
    expect(name?.kind === 'text' && name.weight).toBe(800);
    expect(name?.kind === 'text' && name.shadow?.offsetPx).toBeGreaterThan(0);
    expect(role?.kind === 'text' && role.weight).toBe(500);
    expect(role?.kind === 'text' && role.shadow?.offsetPx).toBeGreaterThan(0);
    // Ángulo/opacidad de la sombra llegan a las capas de texto.
    expect(name?.kind === 'text' && name.shadow?.angleDeg).toBe(90);
    expect(name?.kind === 'text' && name.shadow?.opacity).toBe(1);
    // shadowBlur (fracción del lado menor) → blurPx en px del plano.
    expect(name?.kind === 'text' && name.shadow?.blurPx).toBeCloseTo(21.6, 5);
    expect(role?.kind === 'text' && role.shadow?.blurPx).toBeCloseTo(21.6, 5);
    // skewDeg → oblicuidad ASS \fax en ambas capas de texto.
    expect(name?.kind === 'text' && name.skewXDeg).toBe(14);
    expect(role?.kind === 'text' && role.skewXDeg).toBe(14);
    // La línea de acento es el único rect y usa el color de acento.
    const rects = plan.layers.filter((layer) => layer.kind === 'rect');
    expect(rects).toHaveLength(1);
    expect(rects[0]?.kind === 'rect' && rects[0].color).toBe('#3fe4ff');
    // Nombre arriba del rol.
    expect(name!.y).toBeLessThan(role!.y);
  });

  it('la banda jornal apila banda, pastilla, titular y bajada', () => {
    const plan = buildMotionPlan(
      faixaJornalTemplate,
      {
        tag: 'política',
        headline: 'congreso vota reforma',
        subtitle: 'la sesión empieza a las 14 h',
        bandColor: '#0d47a8',
        subtitleColor: '#f4f6fa',
        accentColor: '#ffd400',
        animation: 'slide-up',
      },
      context,
    );
    const rects = plan.layers.filter((layer) => layer.kind === 'rect');
    const texts = plan.layers.filter((layer) => layer.kind === 'text');
    // Banda + barra de acento + pastilla + bajada.
    expect(rects).toHaveLength(4);
    expect(texts).toHaveLength(3);
    const [band, accent, tagChip, subBand] = rects;
    expect(band?.color).toBe('#0d47a8');
    expect(accent?.color).toBe('#ffd400');
    expect(tagChip?.color).toBe('#ffd400');
    expect(subBand?.color).toBe('#f4f6fa');
    // La barra de acento es la franja inferior de la banda.
    expect(accent!.y).toBeGreaterThan(band!.y);
    expect(accent!.y + accent!.height).toBeLessThanOrEqual(band!.y + band!.height + 1e-6);
    // La pastilla queda encima de la banda; la bajada debajo.
    expect(tagChip!.y + tagChip!.height).toBeLessThanOrEqual(band!.y + 1e-6);
    expect(subBand!.y).toBeGreaterThanOrEqual(band!.y + band!.height - 1e-6);
    // Titular en mayúsculas dentro de la banda.
    const head = texts.find(
      (layer) => layer.kind === 'text' && layer.text === 'CONGRESO VOTA REFORMA',
    );
    expect(head).toBeDefined();
    expect(head!.y).toBeGreaterThan(band!.y);
    expect(head!.y).toBeLessThan(band!.y + band!.height);
    // Sin pastilla ni bajada: sólo banda + acento + titular.
    const bare = buildMotionPlan(
      faixaJornalTemplate,
      {
        tag: '',
        headline: 'titular',
        subtitle: '',
        bandColor: '#0d47a8',
        subtitleColor: '#f4f6fa',
        accentColor: '#ffd400',
        animation: 'none',
      },
      context,
    );
    expect(bare.layers.filter((layer) => layer.kind === 'rect')).toHaveLength(2);
    expect(bare.layers.filter((layer) => layer.kind === 'text')).toHaveLength(1);
  });

  it('la banda cidade usa paralelogramos custom y apila pastilla+banda+bajada', () => {
    const plan = buildMotionPlan(
      faixaCidadeTemplate,
      {
        tag: 'ciudad',
        headline: 'tránsito cortado',
        subtitle: 'accidente en avenida',
        bandColor: '#0c1a3a',
        tagColor: '#e30613',
        subtitleColor: '#d9dde4',
        animation: 'slide-left',
      },
      context,
    );
    const rects = plan.layers.filter((layer) => layer.kind === 'rect');
    const texts = plan.layers.filter((layer) => layer.kind === 'text');
    // Pastilla + filo + banda + bajada.
    expect(rects).toHaveLength(4);
    expect(texts).toHaveLength(3);
    // Todos los rects son paralelogramos custom de 4 puntos.
    for (const layer of rects) {
      expect(layer.kind).toBe('rect');
      if (layer.kind === 'rect') {
        expect(layer.shape).toBe('custom');
        expect(layer.points).toHaveLength(4);
      }
    }
    const [, , band, subBand] = rects;
    expect(band?.color).toBe('#0c1a3a');
    expect(subBand?.color).toBe('#d9dde4');
    // La pastilla y la banda comparten la misma altura y están en la misma
    // fila vertical (el tag va a la izquierda de la banda).
    const [tagChip] = rects;
    expect(tagChip!.y).toBeCloseTo(band!.y, 5);
    expect(tagChip!.height).toBeCloseTo(band!.height, 5);
    expect(tagChip!.x).toBeLessThan(band!.x);
    // La bajada queda debajo de la banda.
    expect(subBand!.y).toBeGreaterThan(band!.y);
    // Titular en mayúsculas dentro de la banda.
    const head = texts.find(
      (layer) => layer.kind === 'text' && layer.text === 'TRÁNSITO CORTADO',
    );
    expect(head).toBeDefined();
    // Sin pastilla ni bajada: filo + banda + titular.
    const bare = buildMotionPlan(
      faixaCidadeTemplate,
      {
        tag: '',
        headline: 'titular',
        subtitle: '',
        bandColor: '#0c1a3a',
        tagColor: '#e30613',
        subtitleColor: '#d9dde4',
        animation: 'none',
      },
      context,
    );
    expect(bare.layers.filter((layer) => layer.kind === 'rect')).toHaveLength(2);
    expect(bare.layers.filter((layer) => layer.kind === 'text')).toHaveLength(1);
  });

  it('la banda esporte usa paralelogramos de ancho compacto por texto', () => {
    const plan = buildMotionPlan(
      faixaEsporteTemplate,
      {
        tag: 'fútbol',
        headline: 'final del campeonato',
        subtitle: 'decisión el domingo',
        bandColor: '#11151c',
        tagColor: '#ffd000',
        subtitleColor: '#e8002d',
        animation: 'slide-left',
      },
      context,
    );
    const rects = plan.layers.filter((layer) => layer.kind === 'rect');
    const texts = plan.layers.filter((layer) => layer.kind === 'text');
    // Pastilla + banda + bajada (sin filo: esporte no lo tiene).
    expect(rects).toHaveLength(3);
    expect(texts).toHaveLength(3);
    for (const layer of rects) {
      expect(layer.kind).toBe('rect');
      if (layer.kind === 'rect') {
        expect(layer.shape).toBe('custom');
        expect(layer.points).toHaveLength(4);
      }
    }
    const [tagChip, band, subBand] = rects;
    expect(tagChip?.color).toBe('#ffd000');
    expect(band?.color).toBe('#11151c');
    expect(subBand?.color).toBe('#e8002d');
    // Misma fila vertical entre pastilla y banda; la bajada debajo.
    expect(tagChip!.y).toBeCloseTo(band!.y, 5);
    expect(tagChip!.height).toBeCloseTo(band!.height, 5);
    expect(tagChip!.x).toBeLessThan(band!.x);
    expect(subBand!.y).toBeGreaterThan(band!.y);
    // Anchos compactos: la banda no ocupa el 86 % del cuadro como jornal.
    expect(band!.width).toBeLessThan(0.8);
    // Titular en mayúsculas dentro de la banda.
    const head = texts.find(
      (layer) => layer.kind === 'text' && layer.text === 'FINAL DEL CAMPEONATO',
    );
    expect(head).toBeDefined();
    // Sin pastilla ni bajada: sólo banda + titular.
    const bare = buildMotionPlan(
      faixaEsporteTemplate,
      {
        tag: '',
        headline: 'titular',
        subtitle: '',
        bandColor: '#11151c',
        tagColor: '#ffd000',
        subtitleColor: '#e8002d',
        animation: 'none',
      },
      context,
    );
    expect(bare.layers.filter((layer) => layer.kind === 'rect')).toHaveLength(1);
    expect(bare.layers.filter((layer) => layer.kind === 'text')).toHaveLength(1);
  });

  it('la banda plantao apila pastilla, banda con franja y bajada', () => {
    const plan = buildMotionPlan(
      faixaPlantaoTemplate,
      {
        tag: 'urgente',
        headline: 'lluvia fuerte alaga calles',
        subtitle: 'defensa civil pide precaución',
        bandColor: '#ffffff',
        subtitleColor: '#0b1f3f',
        accentColor: '#d8101a',
        animation: 'slide-left',
      },
      context,
    );
    const rects = plan.layers.filter((layer) => layer.kind === 'rect');
    const texts = plan.layers.filter((layer) => layer.kind === 'text');
    // Pastilla + franja acento + banda + bajada = 4 rects.
    expect(rects).toHaveLength(4);
    expect(texts).toHaveLength(3);
    const [tagChip, accentStrip, band, subBand] = rects;
    expect(tagChip!.color).toBe('#d8101a');
    expect(accentStrip!.color).toBe('#d8101a');
    expect(band!.color).toBe('#ffffff');
    expect(subBand!.color).toBe('#0b1f3f');
    // Orden vertical: pastilla arriba de la banda, bajada debajo.
    expect(tagChip!.y).toBeLessThan(band!.y);
    expect(subBand!.y).toBeGreaterThan(band!.y);
    // La franja de acento es la franja superior de la banda (mismo x/y,
    // alto de 4u).
    expect(accentStrip!.x).toBeCloseTo(band!.x, 5);
    expect(accentStrip!.y).toBeCloseTo(band!.y, 5);
    expect(accentStrip!.height).toBeLessThan(band!.height / 4);
    // Titular en mayúsculas.
    const head = texts.find(
      (layer) => layer.kind === 'text' && layer.text === 'LLUVIA FUERTE ALAGA CALLES',
    );
    expect(head).toBeDefined();
    // Sin pastilla ni bajada: banda + franja + titular.
    const bare = buildMotionPlan(
      faixaPlantaoTemplate,
      {
        tag: '',
        headline: 'titular',
        subtitle: '',
        bandColor: '#ffffff',
        subtitleColor: '#0b1f3f',
        accentColor: '#d8101a',
        animation: 'none',
      },
      context,
    );
    expect(bare.layers.filter((layer) => layer.kind === 'rect')).toHaveLength(2);
    expect(bare.layers.filter((layer) => layer.kind === 'text')).toHaveLength(1);
  });

  it('la banda aovivo usa cápsulas custom con píldora y punto', () => {
    const plan = buildMotionPlan(
      faixaAovivoTemplate,
      {
        tag: 'ao vivo',
        headline: 'São Paulo',
        subtitle: 'Avenida Paulista · 19h42',
        bandColor: '#10141b',
        textColor: '#ffffff',
        accentColor: '#e2001a',
        animation: 'slide-left',
      },
      context,
    );
    const rects = plan.layers.filter((layer) => layer.kind === 'rect');
    const texts = plan.layers.filter((layer) => layer.kind === 'text');
    // Banda cápsula + píldora cápsula + punto elipse = 3 rects.
    expect(rects).toHaveLength(3);
    expect(texts).toHaveLength(3);
    const [band, pill, dot] = rects;
    // Banda y píldora son polígonos custom de 16 puntos (cápsula).
    for (const layer of [band!, pill!]) {
      expect(layer.shape).toBe('custom');
      expect(layer.points).toHaveLength(16);
    }
    expect(band!.color).toBe('#10141b');
    expect(band!.opacity).toBeCloseTo(0.86, 5);
    expect(pill!.color).toBe('#e2001a');
    expect(dot!.shape).toBe('ellipse');
    // La píldora queda dentro de la banda, a la izquierda.
    expect(pill!.x).toBeCloseTo(band!.x, 5);
    expect(pill!.y).toBeGreaterThan(band!.y);
    expect(pill!.height).toBeLessThan(band!.height);
    // Textos: píldora + línea 1 + línea 2.
    const pillText = texts.find((layer) => layer.kind === 'text' && layer.text === 'AO VIVO');
    expect(pillText).toBeDefined();
    // Sin textos extra: banda + píldora + punto + etiqueta.
    const bare = buildMotionPlan(
      faixaAovivoTemplate,
      {
        tag: 'ao vivo',
        headline: '',
        subtitle: '',
        bandColor: '#10141b',
        textColor: '#ffffff',
        accentColor: '#e2001a',
        animation: 'none',
      },
      context,
    );
    expect(bare.layers.filter((layer) => layer.kind === 'rect')).toHaveLength(3);
    expect(bare.layers.filter((layer) => layer.kind === 'text')).toHaveLength(1);
  });
});
