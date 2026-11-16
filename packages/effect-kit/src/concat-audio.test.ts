import { describe, expect, it } from 'vitest';
import {
  CONCAT_AUDIO_EFFECTS,
  CONCAT_AUDIO_FIXTURES,
} from './catalog/concat-audio.ts';
import { CONCAT_PACKAGES } from './catalog/concat-packages.ts';
import {
  compileAudioInstance,
  compileAudioStack,
  createInstance,
  effectRegistry,
} from './index.ts';
import {
  concatFixed,
  formatConcatFloat,
  renderConcatTemplate,
} from './concat-expr.ts';
import type { EffectInstance } from './types.ts';

/**
 * Paridad con `concat-effects` (Rust): los `fixtures.toml` del vendor pinean
 * la cadena FFmpeg exacta en default/min/max. Si el port de `expr.rs`
 * (`concat-expr.ts`) diverge en un solo decimal, estos tests lo detectan.
 */

function instanceAt(
  manifestId: string,
  at: 'default' | 'min' | 'max',
  extra: Readonly<Record<string, number>> = {},
): EffectInstance {
  const manifest = effectRegistry.get(manifestId);
  if (!manifest) throw new Error(`manifiesto desconocido: ${manifestId}`);
  const params: Record<string, number> = {};
  for (const spec of manifest.params) {
    if (spec.type !== 'float' && spec.type !== 'int') continue;
    const value =
      at === 'min' ? spec.min : at === 'max' ? spec.max : spec.default;
    params[spec.id] = value;
  }
  Object.assign(params, extra);
  return { ...createInstance(manifest), params };
}

describe('concat-expr (port de expr.rs)', () => {
  const evalSlot = (slot: string, env: Record<string, number> = {}) =>
    renderConcatTemplate(`{${slot}}`, env);

  it('la precedencia y la aritmética coinciden', () => {
    expect(evalSlot('1 + 2 * 3')).toBe('7');
    expect(evalSlot('(1 + 2) * 3')).toBe('9');
    expect(evalSlot('-2 * -3')).toBe('6');
    expect(evalSlot('10 / 4')).toBe('2.5');
  });

  it('round produce enteros y la división siempre real', () => {
    expect(evalSlot('round(12.4)')).toBe('12');
    expect(evalSlot('round(2.5)')).toBe('3');
    expect(evalSlot('round(12) * 2')).toBe('24');
    expect(evalSlot('round(12) / 2')).toBe('6');
    expect(evalSlot('round(13 * 1.3)')).toBe('17');
  });

  it('fixed formatea como las cadenas siempre lo hicieron', () => {
    expect(evalSlot('fixed(0.5, 2)')).toBe('0.50');
    expect(evalSlot('fixed(-0.0, 3)')).toBe('0.000');
    expect(evalSlot('fixed(48000 * pow(2, 12 / 12), 6)')).toBe('96000.000000');
    expect(evalSlot('fixed(-0.55 * 0.05, 3)')).toBe('-0.028');
    expect(concatFixed(1.5, 0)).toBe('2');
  });

  it('condicionales, clamps y comparaciones', () => {
    expect(evalSlot('if(3 >= 3, 1, 2)')).toBe('1');
    expect(evalSlot('clamp(150, 0, 100) / 100')).toBe('1');
    expect(evalSlot('max(round(1.6), 2)')).toBe('2');
    expect(evalSlot('min(4, 2) + abs(0 - 3)')).toBe('5');
    expect(evalSlot('if(pitch > 0, pitch, 1.2)', { pitch: 0 })).toBe('1.2');
    expect(evalSlot('if(pitch > 0, pitch, 1.2)', { pitch: 2 })).toBe('2');
  });

  it('los nombres desconocidos y el input malo son error, no panic', () => {
    expect(renderConcatTemplate('{foo}', {})).toBeNull();
    expect(renderConcatTemplate('{1 +}', {})).toBeNull();
    expect(renderConcatTemplate('{foo(1)}', {})).toBeNull();
    expect(renderConcatTemplate('{round(1, 2)}', {})).toBeNull();
    expect(renderConcatTemplate('{1 & 2}', {})).toBeNull();
    expect(renderConcatTemplate('{(1}', {})).toBeNull();
    expect(renderConcatTemplate('{1 2}', {})).toBeNull();
    expect(renderConcatTemplate('gblur={radius', {})).toBeNull();
    expect(renderConcatTemplate('gblur=radius}', {})).toBeNull();
    expect(renderConcatTemplate('{clamp(0.5, 1, 0)}', {})).toBeNull();
    expect(renderConcatTemplate('{clamp(0.5, 0, sqrt(0 - 1))}', {})).toBeNull();
    expect(evalSlot('clamp(0.5, 1, 1)')).toBe('1');
  });

  it('los escapes de llaves y el texto literal pasan intactos', () => {
    expect(renderConcatTemplate('x={{literal}},y={1+1}', {})).toBe('x={literal},y=2');
    expect(renderConcatTemplate('plain text', {})).toBe('plain text');
    expect(formatConcatFloat(0.0000001)).toBe('0.0000001');
    expect(formatConcatFloat(123456789012345680000)).toBe('123456789012345680000');
  });
});

describe('catálogo concat-effects', () => {
  it('los 25 efectos de audio están en el catálogo con recetas exactas', () => {
    expect(CONCAT_AUDIO_EFFECTS).toHaveLength(25);
    for (const manifest of CONCAT_AUDIO_EFFECTS) {
      expect(manifest.id).toMatch(/^concat\./);
      expect(manifest.kind).toBe('audio');
      expect(manifest.audio?.concatTemplate).toBe(true);
      expect(manifest.audio?.fidelity).toBe('exact');
      expect(manifest.description.length).toBeGreaterThan(10);
      expect(manifest.keywords.length).toBeGreaterThan(0);
      expect(effectRegistry.get(manifest.id)?.id).toBe(manifest.id);
    }
  });

  it('el inventario cubre los 132 paquetes vendorados', () => {
    expect(CONCAT_PACKAGES).toHaveLength(132);
    const kinds = new Map<string, number>();
    for (const pkg of CONCAT_PACKAGES) {
      kinds.set(pkg.kind, (kinds.get(pkg.kind) ?? 0) + 1);
    }
    expect(kinds.get('audio')).toBe(25);
    expect(kinds.get('effect')).toBe(28);
    expect(kinds.get('filter')).toBe(57);
    expect(kinds.get('transition')).toBe(22);
  });

  it('cada fixture pineado reproduce la cadena FFmpeg exacta', () => {
    let checked = 0;
    for (const manifest of CONCAT_AUDIO_EFFECTS) {
      const fixtures = CONCAT_AUDIO_FIXTURES[manifest.id] ?? [];
      expect(fixtures.length, manifest.id).toBeGreaterThanOrEqual(3);
      for (const fixture of fixtures) {
        const instance = instanceAt(manifest.id, fixture.at, fixture.params);
        const compiled = compileAudioInstance(effectRegistry, instance);
        expect(compiled.fidelity, `${manifest.id}/${fixture.name}`).toBe('exact');
        expect(compiled.filters.join(','), `${manifest.id}/${fixture.name}`).toBe(
          fixture.chain,
        );
        checked += 1;
      }
    }
    expect(checked).toBe(75);
  });

  it('un efecto concat compila dentro del stack de audio', () => {
    const hall = effectRegistry.get('concat.hall');
    const echo = effectRegistry.get('audio.echo');
    expect(hall && echo).toBeTruthy();
    if (!hall || !echo) return;
    const stack = [createInstance(hall), createInstance(echo)];
    const compiled = compileAudioStack(effectRegistry, stack);
    expect(compiled.effects).toBe(2);
    expect(compiled.fidelity).toBe('exact');
    expect(compiled.filters.join(',')).toContain('aecho=0.8:0.85:');
    expect(compiled.filters.join(',')).toContain('aecho=0.8:0.9:');
  });

  it('los parámetros numéricos de concat admiten keyframes como el resto', () => {
    // La animación la resuelve `resolveParamsAt` (params.ts) antes de llegar
    // al compilador; acá sólo se verifica que el manifiesto los declare.
    const manifest = effectRegistry.get('concat.echo');
    expect(manifest).toBeTruthy();
    if (!manifest) return;
    for (const spec of manifest.params) {
      expect(['float', 'int']).toContain(spec.type);
    }
  });
});
