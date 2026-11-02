import type { EffectManifest, GpuPass, ParamSpec } from '../types.ts';

/**
 * Transiciones.
 *
 * El preview interpola dos texturas en un shader (`u_fromTexture`,
 * `u_toTexture`, `u_progress`); el export usa `xfade`, que ya trae las mismas
 * curvas. Cuando el nombre coincide, la fidelidad es exacta; cuando no, se
 * declara la aproximación.
 */

function f(
  id: string,
  label: string,
  min: number,
  max: number,
  def: number,
  step = 0.01,
): ParamSpec {
  return { type: 'float', id, label, min, max, default: def, step };
}

interface TransitionDef {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly keywords: readonly string[];
  readonly params: readonly ParamSpec[];
  readonly shader: string;
  readonly xfade?: string;
  readonly order?: number;
}

function t(def: TransitionDef): EffectManifest {
  return {
    id: `transition.${def.id}`,
    name: def.name,
    category: 'stylize',
    kind: 'transition',
    description: def.description,
    keywords: def.keywords,
    params: def.params,
    gpu: { passes: [{ shader: def.shader } satisfies GpuPass] },
    ...(def.xfade ? { xfade: def.xfade } : {}),
    ...(def.order === undefined ? {} : { order: def.order }),
  };
}

const crossfade = t({
  id: 'crossfade',
  name: 'Disolvencia',
  order: 10,
  description: 'Mezcla lineal entre los dos clips. La transición base de cualquier montaje.',
  keywords: ['crossfade', 'disolvencia', 'fundido', 'mezcla'],
  params: [f('curve', 'Curva', 0.2, 4, 1, 0.05)],
  xfade: 'fade',
  shader: `uniform float p_curve;
void main() {
  vec4 a = texture(u_fromTexture, v_texCoord);
  vec4 b = texture(u_toTexture, v_texCoord);
  float p = clamp(u_progress, 0.0, 1.0);
  p = pow(p, p_curve);
  fragColor = mix(a, b, p);
}`,
});

const dipBlack = t({
  id: 'dip-black',
  name: 'Fundido a negro',
  order: 20,
  description: 'Baja a negro y vuelve a subir. Separa escenas sin mezclarlas.',
  keywords: ['fade', 'negro', 'fundido', 'escena'],
  params: [],
  xfade: 'fadeblack',
  shader: `void main() {
  vec4 a = texture(u_fromTexture, v_texCoord);
  vec4 b = texture(u_toTexture, v_texCoord);
  float p = clamp(u_progress, 0.0, 1.0);
  float k = 1.0 - abs(p * 2.0 - 1.0);
  vec4 mixed = mix(a, b, step(0.5, p));
  fragColor = vec4(mixed.rgb * (1.0 - k), 1.0);
}`,
});

const dipWhite = t({
  id: 'dip-white',
  name: 'Fundido a blanco',
  order: 30,
  description: 'Igual que el fundido a negro pero con un flash blanco en el medio.',
  keywords: ['fade', 'blanco', 'flash', 'fundido'],
  params: [],
  xfade: 'fadewhite',
  shader: `void main() {
  vec4 a = texture(u_fromTexture, v_texCoord);
  vec4 b = texture(u_toTexture, v_texCoord);
  float p = clamp(u_progress, 0.0, 1.0);
  float k = 1.0 - abs(p * 2.0 - 1.0);
  vec4 mixed = mix(a, b, step(0.5, p));
  fragColor = vec4(mix(mixed.rgb, vec3(1.0), k), 1.0);
}`,
});

const wipe = (
  id: string,
  name: string,
  axis: 'x' | 'y',
  invert: boolean,
  xfade: string,
  order: number,
) =>
  t({
    id,
    name,
    order,
    description: `Barrido ${axis === 'x' ? 'horizontal' : 'vertical'} con borde duro.`,
    keywords: ['wipe', 'barrido', 'cortina'],
    params: [f('softness', 'Borde', 0, 0.2, 0.01, 0.005)],
    xfade,
    shader: `uniform float p_softness;
void main() {
  vec4 a = texture(u_fromTexture, v_texCoord);
  vec4 b = texture(u_toTexture, v_texCoord);
  float p = clamp(u_progress, 0.0, 1.0);
  float coord = ${axis === 'x' ? 'v_texCoord.x' : 'v_texCoord.y'};
  ${invert ? 'coord = 1.0 - coord;' : ''}
  float edge = smoothstep(p - p_softness - 0.001, p + p_softness + 0.001, coord);
  fragColor = mix(b, a, edge);
}`,
  });

const slide = (id: string, name: string, dx: number, dy: number, xfade: string, order: number) =>
  t({
    id,
    name,
    order,
    description: 'El clip entrante empuja al saliente fuera del cuadro.',
    keywords: ['slide', 'deslizar', 'empujar', 'push'],
    params: [],
    xfade,
    shader: `void main() {
  float p = clamp(u_progress, 0.0, 1.0);
  vec2 offset = vec2(${dx.toFixed(1)}, ${dy.toFixed(1)}) * p;
  vec2 uvA = v_texCoord + offset;
  vec2 uvB = v_texCoord + offset - vec2(${dx.toFixed(1)}, ${dy.toFixed(1)});
  vec4 a = texture(u_fromTexture, uvA);
  vec4 b = texture(u_toTexture, uvB);
  float insideA = step(0.0, uvA.x) * step(uvA.x, 1.0) * step(0.0, uvA.y) * step(uvA.y, 1.0);
  float insideB = step(0.0, uvB.x) * step(uvB.x, 1.0) * step(0.0, uvB.y) * step(uvB.y, 1.0);
  fragColor = insideB > 0.5 ? b : (insideA > 0.5 ? a : vec4(0.0));
}`,
  });

const circle = (id: string, name: string, open: boolean, xfade: string, order: number) =>
  t({
    id,
    name,
    order,
    description: open
      ? 'Un círculo crece desde el centro y descubre el clip entrante.'
      : 'El clip saliente se cierra en un círculo hasta desaparecer.',
    keywords: ['circle', 'circulo', 'iris'],
    params: [f('feather', 'Borde', 0.005, 0.3, 0.05, 0.005)],
    xfade,
    shader: `uniform float p_feather;
void main() {
  vec4 a = texture(u_fromTexture, v_texCoord);
  vec4 b = texture(u_toTexture, v_texCoord);
  float p = clamp(u_progress, 0.0, 1.0);
  vec2 d = (v_texCoord - 0.5) * vec2(${open ? '1.0' : '-1.0'}, 1.0);
  float radius = length(d) * 1.4142;
  float limit = ${open ? 'p' : '1.0 - p'};
  float mask = smoothstep(limit + p_feather, limit - p_feather, radius);
  fragColor = mix(a, b, mask);
}`,
  });

const radial = t({
  id: 'radial',
  name: 'Barrido radial',
  order: 80,
  description: 'Un reloj gira desde el centro. El recurso de los compilados de anime.',
  keywords: ['radial', 'reloj', 'giro', 'barrido'],
  params: [],
  xfade: 'radial',
  shader: `void main() {
  vec4 a = texture(u_fromTexture, v_texCoord);
  vec4 b = texture(u_toTexture, v_texCoord);
  float p = clamp(u_progress, 0.0, 1.0);
  vec2 d = v_texCoord - 0.5;
  float angle = atan(d.y, d.x) / 6.2831853 + 0.5;
  float mask = step(angle, p);
  fragColor = mix(a, b, mask);
}`,
});

const pixelize = t({
  id: 'pixelize',
  name: 'Pixelado',
  order: 90,
  description: 'El cuadro se rompe en bloques cada vez más grandes y vuelve a armarse.',
  keywords: ['pixel', 'bloques', 'glitch'],
  params: [f('maxSize', 'Bloque máximo', 4, 128, 48, 1)],
  xfade: 'pixelize',
  shader: `uniform float p_maxSize;
void main() {
  float p = clamp(u_progress, 0.0, 1.0);
  float size = mix(1.0, p_maxSize, sin(p * 3.14159));
  vec2 block = size / u_resolution;
  vec2 uv = floor(v_texCoord / block) * block + block * 0.5;
  vec4 a = texture(u_fromTexture, uv);
  vec4 b = texture(u_toTexture, uv);
  fragColor = mix(a, b, step(0.5, p));
}`,
});

const dissolve = t({
  id: 'dissolve',
  name: 'Disolvencia con ruido',
  order: 100,
  description: 'Los píxeles cambian en orden aleatorio, no todos a la vez. Más orgánico que el crossfade.',
  keywords: ['dissolve', 'ruido', 'organico', 'granulado'],
  params: [f('grain', 'Grano', 1, 40, 12, 1)],
  xfade: 'dissolve',
  shader: `uniform float p_grain;
void main() {
  vec4 a = texture(u_fromTexture, v_texCoord);
  vec4 b = texture(u_toTexture, v_texCoord);
  float p = clamp(u_progress, 0.0, 1.0);
  float n = ek_noise(v_texCoord * p_grain * 20.0);
  float mask = smoothstep(n - 0.08, n + 0.08, p);
  fragColor = mix(a, b, mask);
}`,
});

const zoomIn = t({
  id: 'zoom-in',
  name: 'Zoom de entrada',
  order: 110,
  description: 'El clip saliente se acerca mientras el entrante aparece desde el fondo.',
  keywords: ['zoom', 'acercar', 'profundidad'],
  params: [],
  xfade: 'zoomin',
  shader: `void main() {
  float p = clamp(u_progress, 0.0, 1.0);
  vec2 uvA = 0.5 + (v_texCoord - 0.5) * (1.0 + p * 0.8);
  vec2 uvB = 0.5 + (v_texCoord - 0.5) * mix(1.4, 1.0, p);
  vec4 a = texture(u_fromTexture, clamp(uvA, 0.0, 1.0));
  vec4 b = texture(u_toTexture, clamp(uvB, 0.0, 1.0));
  fragColor = mix(a, b, p);
}`,
});

const lumaFade = t({
  id: 'luma-fade',
  name: 'Fundido por luminancia',
  order: 120,
  description: 'Las zonas claras cambian primero y las sombras quedan hasta el final.',
  keywords: ['luma', 'luminancia', 'fundido', 'curva'],
  params: [f('bias', 'Sesgo', 0.2, 1.8, 1, 0.05)],
  xfade: 'fadegrays',
  shader: `uniform float p_bias;
void main() {
  vec4 a = texture(u_fromTexture, v_texCoord);
  vec4 b = texture(u_toTexture, v_texCoord);
  float p = clamp(u_progress, 0.0, 1.0);
  float l = ek_luma(b.rgb);
  float mask = smoothstep(l - 0.25, l + 0.25, p * p_bias);
  fragColor = mix(a, b, mask);
}`,
});

const squeeze = (id: string, name: string, horizontal: boolean, xfade: string, order: number) =>
  t({
    id,
    name,
    order,
    description: 'El clip saliente se comprime hasta desaparecer y libera el lugar.',
    keywords: ['squeeze', 'comprimir', 'escala'],
    params: [],
    xfade,
    shader: `void main() {
  float p = clamp(u_progress, 0.0, 1.0);
  vec2 uv = v_texCoord;
  ${horizontal ? 'uv.x = (uv.x - 0.5) / max(0.001, 1.0 - p) + 0.5;' : 'uv.y = (uv.y - 0.5) / max(0.001, 1.0 - p) + 0.5;'}
  vec4 a = texture(u_fromTexture, uv);
  vec4 b = texture(u_toTexture, v_texCoord);
  float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
  fragColor = inside > 0.5 ? a : b;
}`,
  });

const glitchBlocks = t({
  id: 'glitch-blocks',
  name: 'Glitch de bloques',
  order: 130,
  description: 'El corte se rompe en franjas desplazadas con separación de canales. Sin equivalente en xfade.',
  keywords: ['glitch', 'corte', 'bloques', 'datamosh'],
  params: [f('amount', 'Fuerza', 0, 1, 0.5, 0.01)],
  shader: `uniform float p_amount;
void main() {
  float p = clamp(u_progress, 0.0, 1.0);
  float band = floor(v_texCoord.y * 24.0);
  float n = ek_hash21(vec2(band, floor(p * 12.0)));
  vec2 uv = v_texCoord;
  uv.x = fract(uv.x + (n - 0.5) * 0.15 * p_amount * sin(p * 3.14159));
  vec4 a = texture(u_fromTexture, uv);
  vec4 b = texture(u_toTexture, uv);
  vec3 mixed;
  mixed.r = mix(a.r, b.r, p) + (n - 0.5) * 0.1 * p_amount;
  mixed.g = mix(a.g, b.g, p);
  mixed.b = mix(a.b, b.b, p) - (n - 0.5) * 0.1 * p_amount;
  fragColor = vec4(mixed, 1.0);
}`,
});

const rgbDisplace = t({
  id: 'rgb-displace',
  name: 'Desplazamiento RGB',
  order: 140,
  description: 'Los canales se separan al cortar y vuelven a alinearse. Tensión digital.',
  keywords: ['rgb', 'aberracion', 'corte', 'glitch'],
  params: [f('amount', 'Separación', 0, 60, 18, 1)],
  shader: `uniform float p_amount;
void main() {
  float p = clamp(u_progress, 0.0, 1.0);
  float split = sin(p * 3.14159) * p_amount / u_resolution.x;
  vec4 a = texture(u_fromTexture, v_texCoord);
  vec4 b = texture(u_toTexture, v_texCoord);
  vec4 mixed = mix(a, b, p);
  mixed.r = mix(texture(u_fromTexture, v_texCoord + vec2(split, 0.0)).r,
                texture(u_toTexture, v_texCoord + vec2(split, 0.0)).r, p);
  mixed.b = mix(texture(u_fromTexture, v_texCoord - vec2(split, 0.0)).b,
                texture(u_toTexture, v_texCoord - vec2(split, 0.0)).b, p);
  fragColor = mixed;
}`,
});

export const TRANSITIONS: readonly EffectManifest[] = [
  crossfade,
  dipBlack,
  dipWhite,
  wipe('wipe-left', 'Barrido a la izquierda', 'x', false, 'wipeleft', 40),
  wipe('wipe-right', 'Barrido a la derecha', 'x', true, 'wiperight', 41),
  wipe('wipe-up', 'Barrido hacia arriba', 'y', true, 'wipeup', 42),
  wipe('wipe-down', 'Barrido hacia abajo', 'y', false, 'wipedown', 43),
  slide('slide-left', 'Deslizar a la izquierda', -1, 0, 'slideleft', 50),
  slide('slide-right', 'Deslizar a la derecha', 1, 0, 'slideright', 51),
  slide('slide-up', 'Deslizar hacia arriba', 0, -1, 'slideup', 52),
  slide('slide-down', 'Deslizar hacia abajo', 0, 1, 'slidedown', 53),
  circle('circle-open', 'Círculo que abre', true, 'circleopen', 60),
  circle('circle-close', 'Círculo que cierra', false, 'circleclose', 61),
  radial,
  pixelize,
  dissolve,
  zoomIn,
  lumaFade,
  squeeze('squeeze-h', 'Compresión horizontal', true, 'squeezeh', 150),
  squeeze('squeeze-v', 'Compresión vertical', false, 'squeezev', 151),
  glitchBlocks,
  rgbDisplace,
];
