import { describe, expect, it } from 'vitest';
import { parseEffectPackage, validateShaderSource } from './package-import.ts';
import { effectRegistry } from './index.ts';

const VALID_SHADER = `
void main() {
  vec4 c = texture(u_currentTexture, v_texCoord);
  fragColor = vec4(c.rgb * 0.5, c.a);
}
`;

function validPackage() {
  return {
    id: 'mi_efecto',
    name: 'Mi Efecto',
    category: 'stylize',
    kind: 'video',
    description: 'baja la mitad del brillo',
    keywords: ['custom'],
    params: [
      { id: 'amount', label: 'Cantidad', type: 'float', min: 0, max: 1, default: 0.5, step: 0.01 },
    ],
    gpu: { passes: [{ shader: VALID_SHADER }] },
  };
}

describe('parseEffectPackage', () => {
  it('acepta un manifiesto válido y lo namespaced bajo custom.', () => {
    const result = parseEffectPackage(validPackage());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.id).toBe('custom.mi_efecto');
    expect(result.manifest.params).toHaveLength(1);
    expect(result.manifest.gpu?.passes[0]?.shader).toContain('void main');
  });

  it('desenvuelve { manifest, fragment } y { effect.json, main.frag }', () => {
    const wrapped = parseEffectPackage({
      manifest: { ...validPackage(), gpu: undefined, params: validPackage().params },
      fragment: VALID_SHADER,
    });
    expect(wrapped.ok).toBe(true);
    if (wrapped.ok) {
      expect(wrapped.manifest.gpu?.passes).toHaveLength(1);
    }
    const drift = parseEffectPackage({
      'effect.json': { ...validPackage(), gpu: undefined },
      'main.frag': VALID_SHADER,
    });
    expect(drift.ok).toBe(true);
  });

  it('rechaza JSON que no es objeto y campos faltantes', () => {
    expect(parseEffectPackage('texto').ok).toBe(false);
    expect(parseEffectPackage({}).ok).toBe(false);
    expect(parseEffectPackage({ ...validPackage(), name: '' }).ok).toBe(false);
    expect(parseEffectPackage({ ...validPackage(), category: 'inventada' }).ok).toBe(false);
    expect(parseEffectPackage({ ...validPackage(), kind: 'raro' }).ok).toBe(false);
    expect(parseEffectPackage({ ...validPackage(), params: [] }).ok).toBe(false);
  });

  it('rechaza params mal formados', () => {
    const badDefault = parseEffectPackage({
      ...validPackage(),
      params: [{ id: 'x', label: 'X', type: 'float', min: 0, max: 1, default: 9 }],
    });
    expect(badDefault.ok).toBe(false);
    const badType = parseEffectPackage({
      ...validPackage(),
      params: [{ id: 'x', label: 'X', type: 'matrix' }],
    });
    expect(badType.ok).toBe(false);
  });

  it('valida la forma de audio y ffmpeg recipes', () => {
    const badFidelity = parseEffectPackage({
      ...validPackage(),
      ffmpeg: { chain: ['eq=g=1'], fidelity: 'preview-only' },
    });
    expect(badFidelity.ok).toBe(false);
    const goodAudio = parseEffectPackage({
      ...validPackage(),
      kind: 'audio',
      category: 'utility',
      gpu: undefined,
      audio: { chain: ['volume=1'], fidelity: 'exact' },
    });
    expect(goodAudio.ok).toBe(true);
  });
});

describe('validateShaderSource', () => {
  it('acepta un shader del contrato', () => {
    expect(validateShaderSource(VALID_SHADER)).toBeNull();
  });

  it('rechaza directivas y bucles no acotados', () => {
    expect(validateShaderSource('#version 300 es\nvoid main(){}')).toContain('#version');
    expect(validateShaderSource('#include <x>\nvoid main(){}')).toContain('#include');
    expect(validateShaderSource('void main(){ while(true){} }')).toContain('while');
    expect(validateShaderSource('void main(){ for(;;){} }')).toContain('for');
    expect(validateShaderSource('vec4 x = 1;')).toContain('void main');
    expect(validateShaderSource('x'.repeat(70 * 1024) + 'void main(){}')).toContain('grande');
  });
});

describe('registry con efectos de terceros', () => {
  it('registerCustomEffects los expone en el catálogo sin pisar built-ins', async () => {
    const { registerCustomEffects, clearCustomEffects, customEffectIds } = await import('./index.ts');
    const before = effectRegistry.get('custom.mi_efecto');
    expect(before).toBeUndefined();
    const result = parseEffectPackage(validPackage());
    if (!result.ok) throw new Error('fixture inválido');
    registerCustomEffects([result.manifest]);
    try {
      expect(effectRegistry.get('custom.mi_efecto')?.name).toBe('Mi Efecto');
      expect(effectRegistry.byKind('video').some((m) => m.id === 'custom.mi_efecto')).toBe(true);
      expect(customEffectIds()).toContain('custom.mi_efecto');
      // Un id que ya existe en el catálogo no puede pisarlo.
      registerCustomEffects([{ ...result.manifest, id: 'audio.eq', name: 'sabotaje' }]);
      expect(effectRegistry.get('audio.eq')?.name).not.toBe('sabotaje');
    } finally {
      clearCustomEffects();
    }
    expect(effectRegistry.get('custom.mi_efecto')).toBeUndefined();
  });
});
