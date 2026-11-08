import { describe, expect, it } from 'vitest';
import { ALL_EFFECTS } from './catalog/index.ts';
import { AUDIO_EFFECTS } from './catalog/audio.ts';
import { compileAudioInstance, compileAudioStack, compileInstance, compileStack } from './ffmpeg.ts';
import { createInstance } from './stack.ts';
import { createRegistry, effectRegistry } from './index.ts';

function paramUniforms(manifest: (typeof ALL_EFFECTS)[number]): string[] {
  const names = new Set<string>();
  for (const pass of manifest.gpu?.passes ?? []) {
    for (const match of pass.shader.matchAll(/\buniform\s+\w+\s+p_(\w+)\s*;/g)) {
      if (match[1]) names.add(match[1]);
    }
  }
  return [...names].sort();
}

describe('catálogo', () => {
  it('tiene ids únicos', () => {
    const ids = ALL_EFFECTS.map((manifest) => manifest.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('todo efecto declara al menos un pass o una cadena de audio, y una descripción', () => {
    for (const manifest of ALL_EFFECTS) {
      if (manifest.kind === 'audio') {
        expect(manifest.audio?.chain.length ?? 0, manifest.id).toBeGreaterThan(0);
      } else {
        expect(manifest.gpu?.passes.length ?? 0, manifest.id).toBeGreaterThan(0);
      }
      expect(manifest.description.length, manifest.id).toBeGreaterThan(10);
      expect(manifest.keywords.length, manifest.id).toBeGreaterThan(0);
    }
  });

  it('los parámetros del manifiesto y los uniforms del shader coinciden', () => {
    for (const manifest of ALL_EFFECTS) {
      if (manifest.kind === 'audio') continue;
      const declared = manifest.params.map((param) => param.id).sort();
      const used = paramUniforms(manifest);
      expect(used, `${manifest.id}: uniform sin parámetro`).toEqual(declared);
    }
  });

  it('no repite ids de parámetro dentro de un efecto', () => {
    for (const manifest of ALL_EFFECTS) {
      const ids = manifest.params.map((param) => param.id);
      expect(new Set(ids).size, manifest.id).toBe(ids.length);
    }
  });

  it('ningún shader redeclara uniforms que ya pone el encabezado', () => {
    const reserved = [
      'u_currentTexture',
      'u_texture1',
      'u_texture2',
      'u_resolution',
      'u_time',
      'u_timeUs',
      'u_frameIndex',
      'u_frameRate',
      'u_fromTexture',
      'u_toTexture',
      'u_progress',
      'v_texCoord',
      'fragColor',
    ];
    for (const manifest of ALL_EFFECTS) {
      for (const [index, pass] of (manifest.gpu?.passes ?? []).entries()) {
        for (const name of reserved) {
          const pattern = new RegExp(`\\b(uniform\\s+\\w+\\s+|in\\s+\\w+\\s+|out\\s+\\w+\\s+)${name}\\b`);
          expect(pattern.test(pass.shader), `${manifest.id} pass ${index} redeclara ${name}`).toBe(
            false,
          );
        }
      }
    }
  });

  it('los shaders usan GLSL ES 3.00 y cierran sus bloques', () => {
    for (const manifest of ALL_EFFECTS) {
      for (const pass of manifest.gpu?.passes ?? []) {
        expect(pass.shader).toContain('void main');
        expect(pass.shader).not.toContain('texture2D(');
        expect(pass.shader).not.toContain('gl_FragColor');
        const open = (pass.shader.match(/\{/g) ?? []).length;
        const close = (pass.shader.match(/\}/g) ?? []).length;
        expect(open, `${manifest.id}: llaves desbalanceadas`).toBe(close);
      }
    }
  });

  it('los rangos de los sliders son coherentes', () => {
    for (const manifest of ALL_EFFECTS) {
      for (const param of manifest.params) {
        if (param.type === 'float' || param.type === 'int' || param.type === 'vec2') {
          expect(param.max, `${manifest.id}.${param.id}`).toBeGreaterThan(param.min);
        }
        if (param.type === 'float' || param.type === 'int') {
          expect(param.default, `${manifest.id}.${param.id}`).toBeGreaterThanOrEqual(param.min);
          expect(param.default, `${manifest.id}.${param.id}`).toBeLessThanOrEqual(param.max);
        }
        if (param.type === 'enum') {
          expect(param.options.length, `${manifest.id}.${param.id}`).toBeGreaterThan(1);
          expect(param.default).toBeLessThan(param.options.length);
        }
        if (param.type === 'color') {
          expect(param.default, `${manifest.id}.${param.id}`).toMatch(/^#[0-9a-f]{6}$/);
        }
      }
    }
  });

  it('el registro encuentra por nombre, categoría y texto', () => {
    const registry = createRegistry(ALL_EFFECTS);
    expect(registry.get('color.grade')?.name).toBe('Etalonaje');
    expect(registry.byCategory('glitch').length).toBeGreaterThan(3);
    expect(registry.search('desenfoque').length).toBeGreaterThan(0);
    expect(registry.search('VHS').some((manifest) => manifest.id === 'retro.vhs')).toBe(true);
    expect(registry.categories('video').length).toBeGreaterThan(5);
  });

  it('las transiciones declaran su xfade o quedan en preview', () => {
    const transitions = ALL_EFFECTS.filter((manifest) => manifest.kind === 'transition');
    expect(transitions.length).toBeGreaterThan(15);
    for (const transition of transitions) {
      const hasXfade = typeof transition.xfade === 'string';
      const isGlitch = transition.id.includes('glitch') || transition.id.includes('rgb');
      expect(hasXfade || isGlitch, transition.id).toBe(true);
    }
  });
});

describe('compilación a FFmpeg', () => {
  it('todo efecto con receta compila sin marcadores sin resolver', () => {
    for (const manifest of ALL_EFFECTS) {
      const instance = createInstance(manifest);
      const compiled = compileInstance(effectRegistry, instance);
      if (manifest.ffmpeg) {
        expect(compiled.steps.length, manifest.id).toBeGreaterThan(0);
        for (const step of compiled.steps) {
          if (step.kind === 'filters') {
            for (const filter of step.filters) {
              expect(filter, manifest.id).not.toMatch(/\{[a-zA-Z0-9_]/);
              expect(filter.length, manifest.id).toBeGreaterThan(2);
            }
          } else {
            expect(step.template, manifest.id).not.toMatch(/\{[a-zA-Z0-9_]/);
          }
        }
      } else {
        expect(compiled.fidelity, manifest.id).toBe('preview-only');
      }
    }
  });

  it('distort.ripple exporta con geq radial y parámetros resueltos', () => {
    const manifest = effectRegistry.get('distort.ripple');
    expect(manifest).toBeTruthy();
    if (!manifest) return;
    const compiled = compileInstance(
      effectRegistry,
      createInstance(manifest, {
        params: { amplitude: 0.05, frequency: 40, speed: 0, center: [0.5, 0.5] },
      }),
    );
    const graph = compiled.steps.find((step) => step.kind === 'graph');
    expect(graph?.kind).toBe('graph');
    if (graph?.kind !== 'graph') return;
    expect(compiled.fidelity).toBe('approximate');
    expect(graph.template).toContain('format=gbrp,geq=');
    expect(graph.template).toContain("r='r(clip(X+");
    expect(graph.template).toContain('*40');
    expect(graph.template).toContain('*0.05');
    expect(graph.template).not.toMatch(/\{[a-zA-Z0-9_]/);
  });

  it('distort.twirl exporta con geq de remolino y parámetros resueltos', () => {
    const manifest = effectRegistry.get('distort.twirl');
    expect(manifest).toBeTruthy();
    if (!manifest) return;
    const compiled = compileInstance(
      effectRegistry,
      createInstance(manifest, {
        params: { angle: 90, radius: 0.5, center: [0.5, 0.5] },
      }),
    );
    const graph = compiled.steps.find((step) => step.kind === 'graph');
    expect(graph?.kind).toBe('graph');
    if (graph?.kind !== 'graph') return;
    expect(compiled.fidelity).toBe('approximate');
    expect(graph.template).toContain('format=gbrp,geq=');
    expect(graph.template).toContain('r(clip(cos(');
    expect(graph.template).toContain('(90*0.017453292519943295)');
    expect(graph.template).toContain('+0.5*W-0.5');
    expect(graph.template).not.toMatch(/\{[a-zA-Z0-9_]/);
  });

  it('light.flare exporta con geq especular + blend screen y parámetros resueltos', () => {
    const manifest = effectRegistry.get('light.flare');
    expect(manifest).toBeTruthy();
    if (!manifest) return;
    const compiled = compileInstance(
      effectRegistry,
      createInstance(manifest, {
        params: {
          position: [0.72, 0.28],
          size: 0.18,
          intensity: 0.4,
          tint: '#ffd9a0',
        },
      }),
    );
    const graph = compiled.steps.find((step) => step.kind === 'graph');
    expect(graph?.kind).toBe('graph');
    if (graph?.kind !== 'graph') return;
    expect(compiled.fidelity).toBe('approximate');
    expect(graph.template).toContain('split=2[%A%b][%A%l]');
    expect(graph.template).toContain('format=gbrp,geq=');
    expect(graph.template).toContain("r='clip(1*((clip(1-sqrt(");
    expect(graph.template).toContain('(1-0.72)*W');
    expect(graph.template).toContain('*0.4*255,0,255)');
    expect(graph.template).toContain('blend=all_mode=screen');
    expect(graph.template).not.toMatch(/\{[a-zA-Z0-9_]/);
  });

  it('el stack compila en orden y reporta la peor fidelidad', () => {
    const grade = effectRegistry.get('color.grade');
    const vignette = effectRegistry.get('light.vignette');
    const leak = effectRegistry.get('light.leak');
    expect(grade && vignette && leak).toBeTruthy();
    if (!grade || !vignette || !leak) return;
    const stack = [
      createInstance(grade),
      createInstance(vignette),
      createInstance(leak),
    ];
    const compiled = compileStack(effectRegistry, stack);
    expect(compiled.effects).toBe(3);
    expect(compiled.fidelity).toBe('preview-only');
    expect(compiled.previewOnly).toEqual(['light.leak']);
    expect(compiled.steps.length).toBeGreaterThanOrEqual(2);
  });

  it('un efecto apagado no llega al render', () => {
    const manifest = effectRegistry.get('color.exposure');
    expect(manifest).toBeTruthy();
    if (!manifest) return;
    const instance = { ...createInstance(manifest), enabled: false };
    const compiled = compileStack(effectRegistry, [instance]);
    expect(compiled.steps).toHaveLength(0);
    expect(compiled.effects).toBe(0);
  });
});

/** Filtros de audio que el FFmpeg empaquetado tiene de verdad (verificado con -filters). */
const AUDIO_FILTERS = new Set([
  'acompressor',
  'acrusher',
  'aecho',
  'aexciter',
  'agate',
  'alimiter',
  'aphaser',
  'apulsator',
  'aresample',
  'asetrate',
  'atempo',
  'bass',
  'chorus',
  'deesser',
  'dynaudnorm',
  'equalizer',
  'extrastereo',
  'flanger',
  'highpass',
  'lowpass',
  'tremolo',
  'treble',
  'vibrato',
  'volume',
]);

describe('catálogo de audio', () => {
  it('cubre las cinco familias con 30 efectos', () => {
    expect(AUDIO_EFFECTS).toHaveLength(30);
    const families = new Set(AUDIO_EFFECTS.map((manifest) => manifest.category));
    expect([...families].sort()).toEqual(['space', 'texture', 'transmission', 'utility', 'voice']);
    for (const family of families) {
      const count = AUDIO_EFFECTS.filter((manifest) => manifest.category === family).length;
      expect(count, family).toBeGreaterThanOrEqual(5);
    }
  });

  it('cada receta compila sin marcadores y sólo usa filtros existentes', () => {
    for (const manifest of AUDIO_EFFECTS) {
      const instance = createInstance(manifest);
      const compiled = compileAudioInstance(effectRegistry, instance);
      expect(compiled.filters.length, manifest.id).toBeGreaterThan(0);
      expect(compiled.fidelity, manifest.id).not.toBe('preview-only');
      for (const filter of compiled.filters) {
        expect(filter, manifest.id).not.toMatch(/\{[a-zA-Z0-9_]/);
        expect(filter, manifest.id).not.toContain('%');
        for (const segment of filter.split(',')) {
          const name = segment.split('=')[0]?.trim() ?? '';
          expect(AUDIO_FILTERS.has(name), `${manifest.id}: filtro desconocido ${name}`).toBe(true);
        }
      }
    }
  });

  it('el tono se compensa con atempo inverso para conservar la duración', () => {
    const deep = effectRegistry.get('audio.voice_deep');
    expect(deep).toBeTruthy();
    if (!deep) return;
    const compiled = compileAudioInstance(effectRegistry, {
      ...createInstance(deep),
      params: { pitch: 0.8 },
    });
    expect(compiled.filters.join(',')).toContain('asetrate=48000*0.8');
    expect(compiled.filters.join(',')).toContain('atempo=1.25');
  });

  it('el stack de audio respeta el orden, el sample rate y los apagados', () => {
    const eq = effectRegistry.get('audio.eq');
    const limiter = effectRegistry.get('audio.limiter');
    expect(eq && limiter).toBeTruthy();
    if (!eq || !limiter) return;
    const stack = [
      { ...createInstance(eq), params: { low: 3, high: 2 } },
      { ...createInstance(limiter), enabled: false },
      { ...createInstance(eq), params: { low: -2, high: 1 } },
    ];
    const compiled = compileAudioStack(effectRegistry, stack, 44_100);
    expect(compiled.effects).toBe(2);
    expect(compiled.filters).toHaveLength(2);
    expect(compiled.filters[0]).toContain('bass=g=3');
    expect(compiled.filters[1]).toContain('bass=g=-2');
    expect(compiled.fidelity).toBe('exact');
  });

  it('un efecto de video dentro del stack de audio no se inventa', () => {
    const grade = effectRegistry.get('color.grade');
    expect(grade).toBeTruthy();
    if (!grade) return;
    const compiled = compileAudioStack(effectRegistry, [createInstance(grade)]);
    expect(compiled.filters).toHaveLength(0);
    expect(compiled.previewOnly).toEqual(['color.grade']);
    expect(compiled.fidelity).toBe('preview-only');
  });
});
