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

const blinds = t({
  id: 'blinds',
  name: 'Persianas',
  order: 62,
  description: 'El clip entrante se revela en diez listones que abren en cascada con borde suave.',
  keywords: ['persiana', 'blinds', 'listones', 'cascada'],
  params: [],
  // `horzopen` de xfade abre en listones horizontales: misma familia que la
  // persiana en cascada del render FFmpeg (`wipe_alpha_expr("blinds")`),
  // sin el retardo por listón — aproximación declarada.
  xfade: 'horzopen',
  // Misma curva que `wipe_alpha_expr("blinds")` del render FFmpeg: 10
  // listones, retardo decreciente hacia abajo y smoothstep de 4 % por listón.
  shader: `void main() {
  vec4 a = texture(u_fromTexture, v_texCoord);
  vec4 b = texture(u_toTexture, v_texCoord);
  float p = clamp(u_progress, 0.0, 1.0);
  float line = floor(v_texCoord.y * 10.0);
  float f = v_texCoord.y * 10.0 - line;
  float t = clamp((p - 0.035 * line) / 0.65, 0.0, 1.0) * 1.05;
  float r = 1.0 - f;
  float u = clamp((r - (t - 0.04)) / 0.04, 0.0, 1.0);
  float s = u * u * (3.0 - 2.0 * u);
  fragColor = mix(a, b, 1.0 - s);
}`,
});

const clockWipe = t({
  id: 'clock-wipe',
  name: 'Reloj',
  order: 63,
  description: 'El clip entrante barre en sentido horario desde el borde superior.',
  keywords: ['reloj', 'clock', 'angular', 'giro'],
  params: [],
  // `radial` de xfade es un barrido circular horario: misma familia que el
  // `relogio` del render FFmpeg (`wipe_alpha_expr("clock-wipe")`).
  xfade: 'radial',
  // Misma curva que el geq: ángulo horario desde el tope, smoothstep ±0.012.
  shader: `void main() {
  vec4 a = texture(u_fromTexture, v_texCoord);
  vec4 b = texture(u_toTexture, v_texCoord);
  float p = clamp(u_progress, 0.0, 1.0);
  vec2 c = v_texCoord - 0.5;
  float ang = atan(c.x, -c.y);
  if (ang < 0.0) ang += 6.28318530718;
  float volta = ang / 6.28318530718;
  float u = clamp((volta - (p - 0.012)) / 0.024, 0.0, 1.0);
  float s = u * u * (3.0 - 2.0 * u);
  fragColor = mix(a, b, 1.0 - s);
}`,
});

const ink = t({
  id: 'ink',
  name: 'Tinta',
  order: 64,
  description: 'El clip entrante se expande desde el centro como una mancha de tinta con borde irregular.',
  keywords: ['tinta', 'ink', 'mancha', 'dissolve'],
  params: [],
  // `dissolve` de xfade es la aproximación más cercana (revelado por ruido);
  // el borde mojado oscuro del shader original no es portable a alfa puro.
  xfade: 'dissolve',
  // Misma curva que `wipe_alpha_expr("ink")` del render FFmpeg: ruido de
  // valor 2 octavas + caída radial, umbral `1-p*1.05` y smoothstep 0.06.
  shader: `float inkHash(vec2 v) {
  return fract(sin(dot(v, vec2(12.9898, 78.233))) * 43758.5453);
}
float inkNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = inkHash(i);
  float b = inkHash(i + vec2(1.0, 0.0));
  float c = inkHash(i + vec2(0.0, 1.0));
  float d = inkHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
void main() {
  vec4 a = texture(u_fromTexture, v_texCoord);
  vec4 b = texture(u_toTexture, v_texCoord);
  float p = clamp(u_progress, 0.0, 1.0);
  vec2 q = v_texCoord * vec2(u_resolution.x / u_resolution.y, 1.0);
  float n = inkNoise(q * 4.0) * 0.6
          + inkNoise(q * 9.0 + vec2(3.7, 1.3)) * 0.4;
  float len = length(v_texCoord - 0.5);
  float campo = n * 0.7 + (1.0 - len * 1.2) * 0.3;
  float limiar = 1.0 - p * 1.05;
  float u = clamp((campo - limiar) / 0.06, 0.0, 1.0);
  float s = u * u * (3.0 - 2.0 * u);
  fragColor = mix(a, b, s);
}`,
});

const bolhas = t({
  id: 'bolhas',
  name: 'Burbujas',
  order: 65,
  description: 'El clip entrante nace en burbujas que crecen desde el centro de cada celda con retardo.',
  keywords: ['burbujas', 'bolhas', 'celdas', 'dissolve'],
  params: [],
  // `dissolve` de xfade es la aproximación declarada: el revelado real es
  // por grilla de burbujas, sin equivalente en xfade.
  xfade: 'dissolve',
  // Misma máscara que `wipe_alpha_expr("bolhas")` del render FFmpeg: grilla
  // 7×7 en píxeles, retardo hasheado por celda, radio² escalado por t².
  shader: `float bhHash(vec2 v) {
  return fract(sin(dot(v, vec2(12.9898, 78.233))) * 43758.5453);
}
void main() {
  vec4 a = texture(u_fromTexture, v_texCoord);
  vec4 b = texture(u_toTexture, v_texCoord);
  float p = clamp(u_progress, 0.0, 1.0);
  vec2 px = v_texCoord * u_resolution;
  vec2 cell = floor(px / u_resolution * 7.0);
  vec2 center = (cell + 0.5) / 7.0 * u_resolution;
  float dly = bhHash(cell) * 0.5;
  float t = clamp((p - dly) / 0.45, 0.0, 1.0);
  vec2 d = px - center;
  float r2 = dot(d, d);
  float maxd2 = dot(u_resolution / 14.0, u_resolution / 14.0);
  float rad2 = t * t * 1.32 * maxd2;
  float u = clamp((rad2 - r2) / (maxd2 * 0.04 + 1.0), 0.0, 1.0);
  float s = u * u * (3.0 - 2.0 * u);
  fragColor = mix(a, b, s);
}`,
});

const colmeia = t({
  id: 'colmeia',
  name: 'Colmena',
  order: 66,
  description: 'Los favos hexagonales se revelan del centro hacia los bordes, cada uno con su retardo.',
  keywords: ['colmena', 'colmeia', 'hex', 'panal', 'honeycomb'],
  params: [],
  // `dissolve` de xfade es la aproximación declarada: el revelado real es
  // por grilla hexagonal, sin equivalente en xfade.
  xfade: 'dissolve',
  // Misma máscara que `wipe_alpha_expr("colmeia")` del render FFmpeg:
  // distancia hexagonal por voronoi de dos redes, retardo por proximidad
  // al centro + hash de celda, borde smoothstep de 0.03.
  shader: `float cmHash(vec2 v) {
  return fract(sin(dot(v, vec2(12.9898, 78.233))) * 43758.5453);
}
void main() {
  vec4 a = texture(u_fromTexture, v_texCoord);
  vec4 b = texture(u_toTexture, v_texCoord);
  float p = clamp(u_progress, 0.0, 1.0);
  // Coordenadas en unidades de hexágono (equivale a q*vec2(ratio*9,9)).
  vec2 q = v_texCoord * vec2(u_resolution.x / u_resolution.y, 1.0) * 9.0;
  vec2 s = vec2(1.0, 1.7320508);
  vec2 h = s * 0.5;
  vec2 ra = mod(q, s) - h;
  vec2 rb = mod(q - h, s) - h;
  vec2 g = dot(ra, ra) < dot(rb, rb) ? ra : rb;
  vec2 id = q - g;
  vec2 meio = vec2((u_resolution.x / u_resolution.y) * 4.5, 4.5);
  float atraso = min(length(id - meio) / length(meio), 1.0) * 0.5
               + cmHash(floor(id * 2.0 + 0.5)) * 0.15;
  float t = clamp((p - atraso) / 0.3, 0.0, 1.0);
  vec2 ag = abs(g);
  float hexd = max(dot(ag, vec2(0.5, 0.8660254)), ag.x);
  float u = clamp((hexd - (t * 0.62 - 0.03)) / 0.03, 0.0, 1.0);
  float sm = u * u * (3.0 - 2.0 * u);
  fragColor = mix(a, b, 1.0 - sm);
}`,
});

const chuva = t({
  id: 'chuva',
  name: 'Lluvia digital',
  order: 67,
  description: 'Columnas de lluvia revelan el clip entrante de abajo hacia arriba, cada una a su velocidad.',
  keywords: ['lluvia', 'chuva', 'digital', 'matrix', 'columnas'],
  params: [],
  // `dissolve` de xfade es la aproximación declarada: el revelado real es
  // por columnas con cabeza de lluvia, sin equivalente en xfade.
  xfade: 'dissolve',
  // Misma máscara que `wipe_alpha_expr("chuva")` del render FFmpeg: 48
  // columnas con velocidad/fase hasheadas y cabeza `(p*1.9-fase)*vel`.
  // La estela verde del shader original no es portable a alfa puro.
  shader: `float chHash(vec2 v) {
  return fract(sin(dot(v, vec2(12.9898, 78.233))) * 43758.5453);
}
void main() {
  vec4 a = texture(u_fromTexture, v_texCoord);
  vec4 b = texture(u_toTexture, v_texCoord);
  float p = clamp(u_progress, 0.0, 1.0);
  float col = floor(v_texCoord.x * 48.0);
  float vel = 0.7 + chHash(vec2(col, 1.0)) * 0.6;
  float fase = chHash(vec2(col, 2.0)) * 0.35;
  float cabeca = (p * 1.9 - fase) * vel;
  float y = 1.0 - v_texCoord.y;
  float u = clamp((y - (cabeca - 0.02)) / 0.02, 0.0, 1.0);
  float sm = u * u * (3.0 - 2.0 * u);
  fragColor = mix(a, b, 1.0 - sm);
}`,
});

const vento = t({
  id: 'vento',
  name: 'Viento',
  order: 68,
  description: 'Los granos del clip saliente son arrastrados por el viento y el entrante aparece detrás.',
  keywords: ['viento', 'vento', 'grain', 'viento', 'rafaga'],
  params: [],
  // `dissolve` de xfade es la aproximación declarada: el shader además
  // desplaza el muestreo del clip saliente, no portable a alfa puro.
  xfade: 'dissolve',
  // Misma máscara que `wipe_alpha_expr("vento")` del render FFmpeg: grano
  // hasheado por celda 320×180, frente `p*1.7-0.35` y reveal
  // `smoothstep(0.5,1,t)`.
  shader: `float veHash(vec2 v) {
  return fract(sin(dot(v, vec2(12.9898, 78.233))) * 43758.5453);
}
void main() {
  vec4 a = texture(u_fromTexture, v_texCoord);
  vec4 b = texture(u_toTexture, v_texCoord);
  float p = clamp(u_progress, 0.0, 1.0);
  vec2 grain = floor(v_texCoord * vec2(320.0, 180.0));
  float g = veHash(grain);
  float frente = p * 1.7 - 0.35;
  float t = clamp((frente - v_texCoord.x * 0.6 - g * 0.4) / 0.25, 0.0, 1.0);
  float u = clamp((t - 0.5) / 0.5, 0.0, 1.0);
  float sm = u * u * (3.0 - 2.0 * u);
  fragColor = mix(a, b, sm);
}`,
});

const triangulos = t({
  id: 'triangulos',
  name: 'Triángulos',
  order: 69,
  description: 'Los triángulos del clip saliente se encogen de izquierda a derecha revelando el entrante.',
  keywords: ['triangulos', 'triangles', 'shrink', 'geo'],
  params: [],
  // `dissolve` de xfade es la aproximación declarada: el revelado real es
  // por SDF de triángulos, sin equivalente en xfade.
  xfade: 'dissolve',
  // Misma máscara que `wipe_alpha_expr("triangulos")` del render FFmpeg:
  // grilla 6×6 corregida por aspecto, dos triángulos por celda, retardo por
  // columna + hash, escala `1-k` y SDF de tres lados con smoothstep -0.03.
  shader: `float trHash(vec2 v) {
  return fract(sin(dot(v, vec2(12.9898, 78.233))) * 43758.5453);
}
void main() {
  vec4 a = texture(u_fromTexture, v_texCoord);
  vec4 b = texture(u_toTexture, v_texCoord);
  float p = clamp(u_progress, 0.0, 1.0);
  float ratio = u_resolution.x / u_resolution.y;
  vec2 q = v_texCoord * vec2(ratio * 6.0, 6.0);
  vec2 cel = floor(q);
  vec2 f = q - cel;
  float lado = step(f.x, f.y);
  vec2 cen = mix(vec2(0.6666667, 0.3333333), vec2(0.3333333, 0.6666667), lado);
  float atraso = cel.x / (ratio * 6.0) * 0.55
               + trHash(cel + vec2(lado * 17.0, lado * 31.0)) * 0.25;
  float k = clamp((p - atraso) / 0.2, 0.0, 1.0);
  float sc = max(1.0 - k, 0.001);
  vec2 fl = cen + (f - cen) / sc;
  float d1 = mix(fl.y, fl.x, lado);
  float d2 = mix(1.0 - fl.x, 1.0 - fl.y, lado);
  float d3 = mix(fl.x - fl.y, fl.y - fl.x, lado) * 0.7071068;
  float dmin = min(d1, min(d2, d3));
  float dentro = smoothstep(-0.03, 0.0, dmin) * step(k, 0.999);
  fragColor = mix(b, a, dentro);
}`,
});

const persiana = t({
  id: 'persiana',
  name: 'Cortina de listones',
  order: 70,
  description: 'Diez listones horizontales abren en cascada sobre el clip entrante.',
  keywords: ['persiana', 'blinds', 'slats', 'cortina', 'listones'],
  params: [],
  // `dissolve` de xfade es la aproximación declarada: el revelado real es
  // por cascada de listones con borde suave, sin equivalente en xfade.
  xfade: 'dissolve',
  // Misma máscara que `wipe_alpha_expr("persiana")` del render FFmpeg:
  // `linha=floor(y*10)`, retardo `(1-(linha+1)/10)*0.35`,
  // `t=clip((p-atraso)/0.65)*1.05` y reveal `1-smoothstep(t-0.04,t,1-f)`.
  shader: `void main() {
  vec4 a = texture(u_fromTexture, v_texCoord);
  vec4 b = texture(u_toTexture, v_texCoord);
  float p = clamp(u_progress, 0.0, 1.0);
  float ripas = 10.0;
  float linha = floor(v_texCoord.y * ripas);
  float f = fract(v_texCoord.y * ripas);
  float atraso = (1.0 - (linha + 1.0) / ripas) * 0.35;
  float t = clamp((p - atraso) / 0.65, 0.0, 1.0) * 1.05;
  float u = clamp((1.04 - f - t) / 0.04, 0.0, 1.0);
  float sm = u * u * (3.0 - 2.0 * u);
  fragColor = mix(a, b, 1.0 - sm);
}`,
});

const reflexo = t({
  id: 'reflexo',
  name: 'Reflejo',
  order: 71,
  description: 'Un frente de luz diagonal cruza el cuadro revelando el clip entrante.',
  keywords: ['reflejo', 'reflex', 'luz', 'diagonal', 'shine'],
  params: [],
  // `dissolve` de xfade es la aproximación declarada: el frente diagonal
  // con estela luminosa no tiene equivalente en xfade.
  xfade: 'dissolve',
  // Misma máscara que `wipe_alpha_expr("reflexo")` del render FFmpeg:
  // `x = X/H*0.75 + (1-Y/H)*0.25`, `frente = p*(ratio*0.75+0.75)-0.25`
  // y reveal `1-smoothstep(frente±0.015)`. La estela de luz cálida del
  // shader original no es portable a alfa puro.
  shader: `void main() {
  vec4 a = texture(u_fromTexture, v_texCoord);
  vec4 b = texture(u_toTexture, v_texCoord);
  float p = clamp(u_progress, 0.0, 1.0);
  float ratio = u_resolution.x / u_resolution.y;
  float x = v_texCoord.x * ratio * 0.75 + (1.0 - v_texCoord.y) * 0.25;
  float frente = p * (ratio * 0.75 + 0.75) - 0.25;
  float u = clamp((x - (frente - 0.015)) / 0.03, 0.0, 1.0);
  float sm = u * u * (3.0 - 2.0 * u);
  fragColor = mix(a, b, 1.0 - sm);
}`,
});

// Barrido suavizado: la frontera se mueve con easing smoothstep en vez
// de lineal (equivalente visual de los `smooth*` de xfade).
const smoothWipe = (
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
    description: 'Barrido con movimiento suavizado: la frontera acelera y frena.',
    keywords: ['smooth', 'suave', 'barrido', 'wipe'],
    params: [f('softness', 'Borde', 0, 0.2, 0.01, 0.005)],
    xfade,
    shader: `uniform float p_softness;
void main() {
  vec4 a = texture(u_fromTexture, v_texCoord);
  vec4 b = texture(u_toTexture, v_texCoord);
  float p = clamp(u_progress, 0.0, 1.0);
  p = p * p * (3.0 - 2.0 * p);
  float coord = ${axis === 'x' ? 'v_texCoord.x' : 'v_texCoord.y'};
  ${invert ? 'coord = 1.0 - coord;' : ''}
  float edge = smoothstep(p - p_softness - 0.001, p + p_softness + 0.001, coord);
  fragColor = mix(b, a, edge);
}`,
  });

// Barrido diagonal: la frontera es la recta que une dos esquinas
// opuestas; `coordExpr` la parametriza (0 en la esquina de origen,
// 2 en la opuesta).
const diagWipe = (
  id: string,
  name: string,
  coordExpr: string,
  xfade: string,
  order: number,
) =>
  t({
    id,
    name,
    order,
    description: 'Barrido en diagonal de esquina a esquina.',
    keywords: ['diagonal', 'diag', 'barrido'],
    params: [f('softness', 'Borde', 0, 0.2, 0.01, 0.005)],
    xfade,
    shader: `uniform float p_softness;
void main() {
  vec4 a = texture(u_fromTexture, v_texCoord);
  vec4 b = texture(u_toTexture, v_texCoord);
  float p = clamp(u_progress, 0.0, 1.0);
  float coord = ${coordExpr};
  float edge = smoothstep(p * 2.0 - p_softness - 0.001, p * 2.0 + p_softness + 0.001, coord);
  fragColor = mix(b, a, edge);
}`,
  });

// Tiras: la imagen entrante aparece en bandas escalonadas (cada tira
// arranca un poco después que la anterior). `axis` elige si las bandas
// son horizontales (recorrido vertical interno) o verticales.
const sliceWipe = (
  id: string,
  name: string,
  axis: 'x' | 'y',
  slices: number,
  flip: boolean,
  xfade: string,
  order: number,
) =>
  t({
    id,
    name,
    order,
    description: 'El clip entrante aparece en tiras escalonadas.',
    keywords: ['slice', 'tiras', 'bandas', 'escalonado'],
    params: [f('softness', 'Borde', 0, 0.2, 0.01, 0.005)],
    xfade,
    shader: `uniform float p_softness;
void main() {
  vec4 a = texture(u_fromTexture, v_texCoord);
  vec4 b = texture(u_toTexture, v_texCoord);
  float p = clamp(u_progress, 0.0, 1.0);
  const float N = ${slices.toFixed(1)};
  float along = ${axis === 'x' ? 'v_texCoord.y' : 'v_texCoord.x'};
  float across = ${axis === 'x' ? 'v_texCoord.x' : 'v_texCoord.y'};
  float idx = floor(along * N);
  ${flip ? 'idx = (N - 1.0) - idx;' : ''}
  float local = fract(along * N);
  // Cada banda revela con barrido a lo largo de across, arrancando
  // escalonada: el frente global es p*(N+1) - idx.
  float front = clamp(p * (N + 1.0) - idx, 0.0, N + 1.0);
  float edge = smoothstep(front - p_softness - 0.001, front + p_softness + 0.001, across * (N + 1.0));
  fragColor = mix(b, a, edge);
}`,
  });

// Apertura vertical: una banda horizontal crece desde el centro hacia
// arriba y abajo (equivalente de `vertopen`/`vertclose` de xfade).
const vertBar = (id: string, name: string, open: boolean, xfade: string, order: number) =>
  t({
    id,
    name,
    order,
    description: open
      ? 'Una franja horizontal se abre desde el centro hacia los bordes.'
      : 'El clip entrante se divide desde el centro hacia arriba y abajo.',
    keywords: ['vert', 'vertical', 'apertura', 'banda'],
    params: [f('softness', 'Borde', 0, 0.2, 0.01, 0.005)],
    xfade,
    shader: `uniform float p_softness;
void main() {
  vec4 a = texture(u_fromTexture, v_texCoord);
  vec4 b = texture(u_toTexture, v_texCoord);
  float p = clamp(u_progress, 0.0, 1.0);
  float limit = ${open ? 'p' : '1.0 - p'};
  float d = abs(v_texCoord.y - 0.5) * 2.0;
  float edge = smoothstep(limit + p_softness + 0.001, limit - p_softness - 0.001, d);
  fragColor = mix(b, a, edge);
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
  smoothWipe('smooth-left', 'Barrido suave a la izquierda', 'x', false, 'smoothleft', 44),
  smoothWipe('smooth-right', 'Barrido suave a la derecha', 'x', true, 'smoothright', 45),
  smoothWipe('smooth-up', 'Barrido suave hacia arriba', 'y', true, 'smoothup', 46),
  smoothWipe('smooth-down', 'Barrido suave hacia abajo', 'y', false, 'smoothdown', 47),
  slide('slide-left', 'Deslizar a la izquierda', -1, 0, 'slideleft', 50),
  slide('slide-right', 'Deslizar a la derecha', 1, 0, 'slideright', 51),
  slide('slide-up', 'Deslizar hacia arriba', 0, -1, 'slideup', 52),
  slide('slide-down', 'Deslizar hacia abajo', 0, 1, 'slidedown', 53),
  circle('circle-open', 'Círculo que abre', true, 'circleopen', 60),
  circle('circle-close', 'Círculo que cierra', false, 'circleclose', 61),
  blinds,
  clockWipe,
  ink,
  bolhas,
  colmeia,
  chuva,
  vento,
  triangulos,
  persiana,
  reflexo,
  vertBar('vert-open', 'Apertura vertical', true, 'vertopen', 72),
  vertBar('vert-close', 'Cierre vertical', false, 'vertclose', 73),
  diagWipe('diag-tl', 'Diagonal sup. izq.', 'v_texCoord.x + v_texCoord.y', 'diagtl', 75),
  diagWipe('diag-tr', 'Diagonal sup. der.', '(1.0 - v_texCoord.x) + v_texCoord.y', 'diagtr', 76),
  diagWipe('diag-bl', 'Diagonal inf. izq.', 'v_texCoord.x + (1.0 - v_texCoord.y)', 'diagbl', 77),
  diagWipe('diag-br', 'Diagonal inf. der.', '2.0 - v_texCoord.x - v_texCoord.y', 'diagbr', 78),
  radial,
  pixelize,
  dissolve,
  zoomIn,
  lumaFade,
  squeeze('squeeze-h', 'Compresión horizontal', true, 'squeezeh', 150),
  squeeze('squeeze-v', 'Compresión vertical', false, 'squeezev', 151),
  sliceWipe('slice-h', 'Tiras horizontales', 'x', 8, false, 'hlslice', 152),
  sliceWipe('slice-h2', 'Tiras horizontales inversas', 'x', 8, true, 'hrslice', 153),
  sliceWipe('slice-v', 'Tiras verticales', 'y', 8, false, 'vuslice', 154),
  sliceWipe('slice-v2', 'Tiras verticales inversas', 'y', 8, true, 'vdslice', 155),
  glitchBlocks,
  rgbDisplace,
];
