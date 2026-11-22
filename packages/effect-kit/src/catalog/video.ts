import type { EffectManifest, FfmpegRecipe, GpuPass, ParamSpec } from '../types.ts';
import { eqCompat } from './eq.ts';

/**
 * Catálogo de efectos de video.
 *
 * Implementación propia: los shaders están escritos para este motor (GLSL ES
 * 3.00, convención `u_currentTexture` + `p_*`) y no derivan del código GPL de
 * Drift. Cada entrada declara además su receta de export y el nivel de
 * fidelidad, porque el preview corre en WebGL y el export en FFmpeg: prometer
 * paridad exacta donde no la hay sería mentirle al usuario.
 */

type Extra = {
  readonly group?: string;
  readonly groupCollapsed?: boolean;
  readonly hint?: string;
  readonly unit?: string;
  readonly step?: number;
};

function f(
  id: string,
  label: string,
  min: number,
  max: number,
  def: number,
  extra: Extra = {},
): ParamSpec {
  return { type: 'float', id, label, min, max, default: def, ...extra };
}

function i(id: string, label: string, min: number, max: number, def: number): ParamSpec {
  return { type: 'int', id, label, min, max, default: def };
}

function b(id: string, label: string, def: boolean): ParamSpec {
  return { type: 'bool', id, label, default: def };
}

function col(id: string, label: string, def: string): ParamSpec {
  return { type: 'color', id, label, default: def };
}

function v2(id: string, label: string, min: number, max: number, def: readonly [number, number]): ParamSpec {
  return { type: 'vec2', id, label, min, max, default: def };
}

function en(id: string, label: string, options: readonly string[], def: number): ParamSpec {
  return { type: 'enum', id, label, options, default: def };
}

function pass(shader: string, inputs?: GpuPass['inputs']): GpuPass {
  return inputs ? { shader, inputs } : { shader };
}

interface VideoDef {
  readonly id: string;
  readonly name: string;
  readonly category: EffectManifest['category'];
  readonly description: string;
  readonly keywords: readonly string[];
  readonly params: readonly ParamSpec[];
  readonly passes: readonly GpuPass[];
  readonly ffmpeg?: FfmpegRecipe;
  readonly order?: number;
}

function v(def: VideoDef): EffectManifest {
  return {
    id: def.id,
    name: def.name,
    category: def.category,
    kind: 'video',
    description: def.description,
    keywords: def.keywords,
    params: def.params,
    gpu: { passes: def.passes },
    ...(def.ffmpeg ? { ffmpeg: def.ffmpeg } : {}),
    ...(def.order === undefined ? {} : { order: def.order }),
  };
}

// ─────────────────────────────────────────────────────────────── Color ──

const exposure = v({
  id: 'color.exposure',
  name: 'Exposición',
  category: 'color',
  order: 10,
  description: 'Multiplica la luz en pasos fotográficos. Un paso equivale a duplicar la exposición.',
  keywords: ['luz', 'brillo', 'stops', 'exposure'],
  params: [f('exposure', 'Pasos', -2, 2, 0, { step: 0.05, unit: 'EV' })],
  passes: [
    pass(`uniform float p_exposure;
void main() {
  vec3 c = texture(u_currentTexture, v_texCoord).rgb;
  fragColor = vec4(c * pow(2.0, p_exposure), 1.0);
}`),
  ],
  ffmpeg: {
    chain: [eqCompat({ brightness: '{exposure}' })],
    fidelity: 'approximate',
    note: 'El brillo de export aplica un corrimiento lineal, no una escala logarítmica por pasos.',
  },
});

const contrast = v({
  id: 'color.contrast',
  name: 'Contraste',
  category: 'color',
  order: 20,
  description: 'Separa o junta luces y sombras alrededor del gris medio.',
  keywords: ['contraste', 'curva', 'contrast'],
  params: [f('contrast', 'Cantidad', 0, 3, 1, { step: 0.01 })],
  passes: [
    pass(`uniform float p_contrast;
void main() {
  vec3 c = texture(u_currentTexture, v_texCoord).rgb;
  fragColor = vec4((c - 0.5) * p_contrast + 0.5, 1.0);
}`),
  ],
  ffmpeg: { chain: [eqCompat({ contrast: '{contrast}' })], fidelity: 'exact' },
});

const saturation = v({
  id: 'color.saturation',
  name: 'Saturación',
  category: 'color',
  order: 30,
  description: 'Mezcla cada píxel con su luminancia. En 0 el frame queda en gris.',
  keywords: ['color', 'saturacion', 'gris', 'saturation'],
  params: [f('saturation', 'Cantidad', 0, 3, 1, { step: 0.01 })],
  passes: [
    pass(`uniform float p_saturation;
void main() {
  vec3 c = texture(u_currentTexture, v_texCoord).rgb;
  fragColor = vec4(ek_saturate(c, p_saturation), 1.0);
}`),
  ],
  ffmpeg: { chain: [eqCompat({ saturation: '{saturation}' })], fidelity: 'exact' },
});

const temperature = v({
  id: 'color.temperature',
  name: 'Temperatura',
  category: 'color',
  order: 40,
  description: 'Balance de blancos en kelvin. Menos kelvin entibia, más kelvin enfria.',
  keywords: ['balance de blancos', 'kelvin', 'calido', 'frio', 'white balance'],
  params: [
    f('kelvin', 'Temperatura', 2000, 12000, 6500, { step: 50, unit: 'K' }),
    f('tint', 'Matiz', -1, 1, 0, { step: 0.01 }),
  ],
  passes: [
    pass(`uniform float p_kelvin;
uniform float p_tint;
void main() {
  vec3 c = texture(u_currentTexture, v_texCoord).rgb;
  // Aproximación de Planck: el rojo sube al bajar kelvin, el azul al subir.
  float t = clamp((p_kelvin - 6500.0) / 5500.0, -1.0, 1.0);
  c.r *= 1.0 + t * -0.22;
  c.b *= 1.0 + t * 0.28;
  c.g *= 1.0 + p_tint * 0.10;
  c.r *= 1.0 - p_tint * 0.04;
  fragColor = vec4(c, 1.0);
}`),
  ],
  ffmpeg: {
    chain: ['colortemperature=temperature={kelvin}', 'colorbalance=gm={tint}:rm=-0.02:bm=0.02'],
    fidelity: 'approximate',
    note: 'colortemperature usa otra matriz que el shader; el matiz se aplica con colorbalance.',
  },
});

const gamma = v({
  id: 'color.gamma',
  name: 'Gamma',
  category: 'color',
  order: 50,
  description: 'Corrige el punto medio sin mover negro ni blanco.',
  keywords: ['gamma', 'medio', 'curva'],
  params: [f('gamma', 'Gamma', 0.2, 4, 1, { step: 0.01 })],
  passes: [
    pass(`uniform float p_gamma;
void main() {
  vec3 c = texture(u_currentTexture, v_texCoord).rgb;
  fragColor = vec4(pow(max(c, 0.0), vec3(1.0 / max(0.05, p_gamma))), 1.0);
}`),
  ],
  ffmpeg: { chain: [eqCompat({ gamma: '{gamma}' })], fidelity: 'exact' },
});

const hue = v({
  id: 'color.hue',
  name: 'Matiz',
  category: 'color',
  order: 60,
  description: 'Rota el círculo cromático completo sin tocar luminancia ni saturación.',
  keywords: ['hue', 'matiz', 'circulo cromatico'],
  params: [f('degrees', 'Giro', -180, 180, 0, { step: 1, unit: '°' })],
  passes: [
    pass(`uniform float p_degrees;
void main() {
  vec3 c = texture(u_currentTexture, v_texCoord).rgb;
  fragColor = vec4(ek_hue_shift(c, p_degrees / 360.0), 1.0);
}`),
  ],
  ffmpeg: { chain: ['hue=h={degrees}'], fidelity: 'exact' },
});

const vibrance = v({
  id: 'color.vibrance',
  name: 'Vibranza',
  category: 'color',
  order: 70,
  description: 'Sube el color de lo apagado y respeta lo que ya está saturado, sin quemar pieles.',
  keywords: ['vibrance', 'vibranza', 'piel', 'color'],
  params: [f('amount', 'Cantidad', -1, 2, 0.3, { step: 0.01 })],
  passes: [
    pass(`uniform float p_amount;
void main() {
  vec3 c = texture(u_currentTexture, v_texCoord).rgb;
  float spread = max(max(c.r, c.g), c.b) - min(min(c.r, c.g), c.b);
  float weight = 1.0 - clamp(spread, 0.0, 1.0);
  fragColor = vec4(mix(vec3(ek_luma(c)), c, 1.0 + p_amount * weight), 1.0);
}`),
  ],
  ffmpeg: {
    chain: [eqCompat({ saturation: '1+0.5*{amount}' })],
    fidelity: 'approximate',
    note: 'La receta satura parejo; el shader pondera por saturación previa.',
  },
});

const duotone = v({
  id: 'color.duotone',
  name: 'Duotono',
  category: 'color',
  order: 80,
  description: 'Mapea la luminancia a un degradado entre dos colores. Base del look poster.',
  keywords: ['duotone', 'duotono', 'poster', 'dos colores'],
  params: [
    col('shadow', 'Sombra', '#1b2a4a'),
    col('highlight', 'Luz', '#ffd166'),
    f('amount', 'Mezcla', 0, 1, 1, { step: 0.01 }),
  ],
  passes: [
    pass(`uniform vec3 p_shadow;
uniform vec3 p_highlight;
uniform float p_amount;
void main() {
  vec3 c = texture(u_currentTexture, v_texCoord).rgb;
  float l = ek_luma(c);
  vec3 mapped = mix(p_shadow, p_highlight, smoothstep(0.0, 1.0, l));
  fragColor = vec4(mix(c, mapped, p_amount), 1.0);
}`),
  ],
  ffmpeg: {
    graph:
      'hue=s=0,split=2[%A%s][%A%h];[%A%s]colorchannelmixer=rr={shadow.r}:gg={shadow.g}:bb={shadow.b}[%A%sh];' +
      '[%A%h]negate,colorchannelmixer=rr={highlight.r}:gg={highlight.g}:bb={highlight.b}[%A%hl];' +
      '[%A%sh][%A%hl]blend=all_mode=screen',
    fidelity: 'approximate',
    note: 'El degradado se arma con dos ramas multiplicadas; el shader interpola en sRGB.',
  },
});

const grade = v({
  id: 'color.grade',
  name: 'Etalonaje',
  category: 'color',
  order: 90,
  description:
    'Ruedas de sombra, medio y luz con brillo propio, más exposición, contraste y saturación en un solo nodo.',
  keywords: ['grade', 'etalonaje', 'ruedas', 'lift', 'gamma', 'gain', 'color grading'],
  params: [
    f('exposure', 'Exposición', -2, 2, 0, { step: 0.05, group: 'Luz' }),
    f('contrast', 'Contraste', 0, 2, 1, { step: 0.01, group: 'Luz' }),
    f('saturation', 'Saturación', 0, 2, 1, { step: 0.01, group: 'Luz' }),
    v2('lift', 'Sombras', -1, 1, [0, 0]),
    f('liftLuma', 'Sombras · brillo', -1, 1, 0, { step: 0.01 }),
    v2('gammaWheel', 'Medios', -1, 1, [0, 0]),
    f('gammaLuma', 'Medios · brillo', -1, 1, 0, { step: 0.01 }),
    v2('gain', 'Luces', -1, 1, [0, 0]),
    f('gainLuma', 'Luces · brillo', -1, 1, 0, { step: 0.01 }),
  ],
  passes: [
    pass(`uniform float p_exposure;
uniform float p_contrast;
uniform float p_saturation;
uniform vec2 p_lift;
uniform float p_liftLuma;
uniform vec2 p_gammaWheel;
uniform float p_gammaLuma;
uniform vec2 p_gain;
uniform float p_gainLuma;
void main() {
  vec3 c = texture(u_currentTexture, v_texCoord).rgb;
  c *= pow(2.0, p_exposure);
  c = (c - 0.5) * p_contrast + 0.5;
  c = ek_saturate(c, p_saturation);
  float l = ek_luma(c);
  float wShadow = pow(1.0 - l, 2.0);
  float wHigh = pow(l, 2.0);
  float wMid = 1.0 - wShadow - wHigh;
  c += vec3(p_lift.x, p_lift.y * 0.4, -p_lift.x * 0.6) * wShadow * 0.5;
  c += vec3(p_gammaWheel.x, p_gammaWheel.y * 0.4, -p_gammaWheel.x * 0.6) * max(0.0, wMid) * 0.5;
  c += vec3(p_gain.x, p_gain.y * 0.4, -p_gain.x * 0.6) * wHigh * 0.5;
  c += p_liftLuma * wShadow * 0.4 + p_gammaLuma * max(0.0, wMid) * 0.4 + p_gainLuma * wHigh * 0.4;
  fragColor = vec4(c, 1.0);
}`),
  ],
  ffmpeg: {
    chain: [eqCompat({ brightness: '{exposure}', contrast: '{contrast}', saturation: '{saturation}' }),
      'colorbalance=rs={lift.x}:gs={lift.y}:bs={lift.x}:rm={gammaWheel.x}:gm={gammaWheel.y}:bm={gammaWheel.x}:rh={gain.x}:gh={gain.y}:bh={gain.x}'],
    fidelity: 'approximate',
    note: 'Los pesos por zona del shader son cuadráticos; colorbalance usa rampas lineales.',
  },
});

// ─────────────────────────────────────────────────────────────── Luz ──

const bloom = v({
  id: 'light.bloom',
  name: 'Bloom',
  category: 'light',
  order: 10,
  description: 'Extrae las altas luces, las desenfoca y las suma con screen. El brillo rebalsa sin quemar.',
  keywords: ['bloom', 'glow', 'brillo', 'halo', 'luces'],
  params: [
    f('threshold', 'Umbral', 0, 1, 0.6, { step: 0.01 }),
    f('radius', 'Radio', 1, 60, 18, { step: 0.5, unit: 'px' }),
    f('intensity', 'Intensidad', 0, 1, 0.55, { step: 0.01 }),
  ],
  passes: [
    pass(`uniform float p_threshold;
void main() {
  vec3 c = texture(u_currentTexture, v_texCoord).rgb;
  float l = ek_luma(c);
  float keep = smoothstep(p_threshold, min(1.0, p_threshold + 0.25), l);
  fragColor = vec4(c * keep, 1.0);
}`),
    pass(
      `uniform float p_radius;
uniform float p_intensity;
void main() {
  vec2 stepUv = vec2(p_radius / u_resolution.x, 0.0);
  vec3 glow = ek_blur9(v_texCoord, stepUv);
  glow += ek_blur9(v_texCoord, vec2(0.0, p_radius / u_resolution.y));
  glow *= 0.5;
  vec3 base = texture(u_texture1, v_texCoord).rgb;
  fragColor = vec4(1.0 - (1.0 - base) * (1.0 - glow * p_intensity), 1.0);
}`,
      [{ from: 'source' }],
    ),
  ],
  ffmpeg: {
    graph:
      'split=2[%A%b][%A%g];[%A%g]colorlevels=rimin={threshold}:gimin={threshold}:bimin={threshold},' +
      'gblur=sigma={radius}[%A%gb];[%A%b][%A%gb]blend=all_mode=screen:all_opacity={intensity}',
    fidelity: 'approximate',
    note: 'FFmpeg desenfoca con gblur (gaussiano real); el shader usa 9 tomas.',
  },
});

const glow = v({
  id: 'light.glow',
  name: 'Glow con tinte',
  category: 'light',
  order: 20,
  description: 'Como bloom, pero el halo toma un color propio: naranja de tungsteno, cian de neón, lo que pidas.',
  keywords: ['glow', 'tinte', 'neon', 'halo'],
  params: [
    f('threshold', 'Umbral', 0, 1, 0.55, { step: 0.01 }),
    f('radius', 'Radio', 1, 60, 20, { step: 0.5, unit: 'px' }),
    f('intensity', 'Intensidad', 0, 1, 0.6, { step: 0.01 }),
    col('tint', 'Color', '#ffb066'),
  ],
  passes: [
    pass(`uniform float p_threshold;
void main() {
  vec3 c = texture(u_currentTexture, v_texCoord).rgb;
  float keep = smoothstep(p_threshold, min(1.0, p_threshold + 0.3), ek_luma(c));
  fragColor = vec4(c * keep, 1.0);
}`),
    pass(
      `uniform float p_radius;
uniform float p_intensity;
uniform vec3 p_tint;
void main() {
  vec3 glow = ek_blur9(v_texCoord, vec2(p_radius / u_resolution.x, 0.0));
  glow += ek_blur9(v_texCoord, vec2(0.0, p_radius / u_resolution.y));
  glow = glow * 0.5 * p_tint;
  vec3 base = texture(u_texture1, v_texCoord).rgb;
  fragColor = vec4(1.0 - (1.0 - base) * (1.0 - glow * p_intensity), 1.0);
}`,
      [{ from: 'source' }],
    ),
  ],
  ffmpeg: {
    graph:
      'split=2[%A%b][%A%g];[%A%g]colorlevels=rimin={threshold}:gimin={threshold}:bimin={threshold},' +
      'colorchannelmixer=rr={tint.r}:gg={tint.g}:bb={tint.b},gblur=sigma={radius}[%A%gb];' +
      '[%A%b][%A%gb]blend=all_mode=screen:all_opacity={intensity}',
    fidelity: 'approximate',
    note: 'El tinte se aplica antes del desenfoque, igual que en el shader.',
  },
});

const halation = v({
  id: 'light.halation',
  name: 'Halación',
  category: 'light',
  order: 30,
  description: 'Halo rojizo alrededor de las luces, como el rebote de la emulsión en el negativo.',
  keywords: ['halation', 'film', 'rojo', 'halo', 'analogico'],
  params: [
    f('threshold', 'Umbral', 0, 1, 0.7, { step: 0.01 }),
    f('radius', 'Radio', 1, 40, 12, { step: 0.5, unit: 'px' }),
    f('intensity', 'Intensidad', 0, 1, 0.45, { step: 0.01 }),
  ],
  passes: [
    pass(`uniform float p_threshold;
void main() {
  vec3 c = texture(u_currentTexture, v_texCoord).rgb;
  float keep = smoothstep(p_threshold, min(1.0, p_threshold + 0.2), ek_luma(c));
  fragColor = vec4(c * keep * vec3(1.0, 0.45, 0.3), 1.0);
}`),
    pass(
      `uniform float p_radius;
uniform float p_intensity;
void main() {
  vec3 glow = ek_blur9(v_texCoord, vec2(p_radius / u_resolution.x, 0.0));
  glow += ek_blur9(v_texCoord, vec2(0.0, p_radius / u_resolution.y));
  vec3 base = texture(u_texture1, v_texCoord).rgb;
  fragColor = vec4(base + glow * 0.5 * p_intensity, 1.0);
}`,
      [{ from: 'source' }],
    ),
  ],
  ffmpeg: {
    graph:
      'split=2[%A%b][%A%g];[%A%g]colorlevels=rimin={threshold}:gimin={threshold}:bimin={threshold},' +
      'colorchannelmixer=rr=1:gg=0.45:bb=0.3,gblur=sigma={radius}[%A%gb];' +
      '[%A%b][%A%gb]blend=all_mode=screen:all_opacity={intensity}',
    fidelity: 'approximate',
    note: 'El shader suma en lineal; FFmpeg mezcla en screen.',
  },
});

const vignette = v({
  id: 'light.vignette',
  name: 'Viñeta',
  category: 'light',
  order: 40,
  description: 'Oscurece las esquinas con caída configurable. El clásico para cerrar la mirada al centro.',
  keywords: ['vignette', 'vineta', 'esquinas', 'foco'],
  params: [
    f('angle', 'Ángulo', 0.15, 1.5, 0.785, { step: 0.005, unit: 'rad' }),
    f('softness', 'Suavidad', 0.05, 1, 0.5, { step: 0.01 }),
    f('roundness', 'Redondez', 0, 1, 0.6, { step: 0.01 }),
  ],
  passes: [
    pass(`uniform float p_angle;
uniform float p_softness;
uniform float p_roundness;
void main() {
  vec3 c = texture(u_currentTexture, v_texCoord).rgb;
  vec2 p = (v_texCoord - 0.5) * 2.0;
  p.x *= mix(ek_aspect(), 1.0, p_roundness);
  float d = length(p) * 0.7071;
  float amount = clamp(p_angle / 1.5708, 0.0, 1.0);
  float edge = smoothstep(1.0 - p_softness, 1.0, d);
  fragColor = vec4(c * (1.0 - edge * amount), 1.0);
}`),
  ],
  ffmpeg: {
    chain: ['vignette=angle={angle}'],
    fidelity: 'approximate',
    note: 'vignette usa una elipse fija; el shader permite redondez y suavidad.',
  },
});

// Tomás del light.leak en export: el shader calcula
// `p = ek_centered(v_texCoord)`, `blob = ek_fbm(p*1.6 + vec2(t, t*0.4), 4)`,
// `edge = smoothstep(0.35, 1.1, length(p))`,
// `mask = smoothstep(0.35, 0.85, blob*0.6 + edge*0.8)` y mezcla screen
// `1-(1-c)(1-tint*mask*amount)`. ek_fbm (4 octavas de ek_noise/hash21) no
// entra en la gramática de geq — cada hash inlinearía ~8 KB y la expresión
// completa pasaría el límite de línea de comandos — así que el blob se
// aproxima con 5 senos incommensurables de frecuencia creciente (la misma
// idea de octavas: cada término duplica ~la frecuencia del anterior),
// renormalizado a [0,1]. Mismas envolventes smoothstep y misma mezcla
// screen vía blend=all_mode=screen. Con PX=(X+0.5-0.5*W)/H y
// PY=(Y+0.5-0.5*H)/H se cumple p=(PX,PY) porque aspect=W/H.
const LEAK_PX = '(X+0.5-0.5*W)/H';
const LEAK_PY = '(Y+0.5-0.5*H)/H';
const LEAK_PD = `sqrt(${LEAK_PX}*${LEAK_PX}+${LEAK_PY}*${LEAK_PY})`;
const LEAK_EDGE_T = `clip((${LEAK_PD}-0.35)/0.75,0,1)`;
const LEAK_EDGE = `(${LEAK_EDGE_T}*${LEAK_EDGE_T}*(3-2*${LEAK_EDGE_T}))`;
const LEAK_QX = `(${LEAK_PX}*1.6+T*{speed})`;
const LEAK_QY = `(${LEAK_PY}*1.6+T*{speed}*0.4)`;
const leakWave = (fx: number, fy: number, amp: number, phase: number) =>
  `${amp}*sin(${LEAK_QX}*${fx}+${LEAK_QY}*${fy}+${phase})`;
const LEAK_N =
  leakWave(4.3, 2.6, 0.3, 0) +
  '+' + leakWave(-7.1, 5.9, 0.24, 1.7) +
  '+' + leakWave(12.5, -9.2, 0.18, 3.9) +
  '+' + leakWave(-23.6, 19.4, 0.12, 0.6) +
  '+' + leakWave(46.7, -41.6, 0.08, 2.4);
const LEAK_BLOB = `(0.5+0.55*(${LEAK_N}))`;
const LEAK_MT = `clip((${LEAK_BLOB}*0.6+${LEAK_EDGE}*0.8-0.35)/0.5,0,1)`;
const LEAK_MASK = `(${LEAK_MT}*${LEAK_MT}*(3-2*${LEAK_MT}))`;
const leakChannel = (axis: 'r' | 'g' | 'b') =>
  `clip({tint.${axis}}*${LEAK_MASK}*{amount}*255,0,255)`;
const leakGraph =
  'split=2[%A%b][%A%l];' +
  '[%A%b]format=gbrp[%A%base];' +
  '[%A%l]format=gbrp,geq=' +
  `r='${leakChannel('r')}':g='${leakChannel('g')}':b='${leakChannel('b')}'[%A%ov];` +
  '[%A%base][%A%ov]blend=all_mode=screen';

const leak = v({
  id: 'light.leak',
  name: 'Fuga de luz',
  category: 'light',
  order: 50,
  description: 'Manchas cálidas que entran por el borde, como una tapa mal cerrada. Se mueven con el tiempo.',
  keywords: ['light leak', 'fuga', 'film', 'analogico', 'calido'],
  params: [
    f('amount', 'Cantidad', 0, 1, 0.5, { step: 0.01 }),
    col('tint', 'Color', '#ff7a3d'),
    f('speed', 'Velocidad', 0, 2, 0.3, { step: 0.01 }),
  ],
  passes: [
    pass(`uniform float p_amount;
uniform vec3 p_tint;
uniform float p_speed;
void main() {
  vec3 c = texture(u_currentTexture, v_texCoord).rgb;
  vec2 p = ek_centered(v_texCoord);
  float t = u_time * p_speed;
  float blob = ek_fbm(p * 1.6 + vec2(t, t * 0.4), 4);
  float edge = smoothstep(0.35, 1.1, length(p));
  float mask = smoothstep(0.35, 0.85, blob * 0.6 + edge * 0.8);
  vec3 light = p_tint * mask * p_amount;
  fragColor = vec4(1.0 - (1.0 - c) * (1.0 - light), 1.0);
}`),
  ],
  ffmpeg: {
    graph: leakGraph,
    fidelity: 'approximate',
    note: 'geq repite por píxel la envolvente del shader (edge radial + mask smoothstep) sobre un blob de 5 senos incommensurables que aproximan ek_fbm — el value-noise de 4 octavas no entra en la gramática de geq — y blend=all_mode=screen reproduce la mezcla; el eje Y puede venir espejado respecto a v_texCoord y el coste es alto en cuadros grandes.',
  },
});

// Tomás del light.flare en export: el shader calcula
// `p = (v_texCoord - position) * (aspect,1)`, `d = length(p)` y suma
// `core = smoothstep(size,0,d)`, `ring = smoothstep(size*1.4,size,|d-size*0.9|)*0.5`
// y `ghost = smoothstep(size*0.6,0,|mirror|)*0.6` con `mirror` en `1-position`,
// todo por `tint*intensity` y mezcla screen `1-(1-c)(1-l)`. geq repite la
// cuenta por píxel sobre fondo negro (smoothstep cúbico escrito a mano) y
// `blend=all_mode=screen` reproduce la mezcla. Con DX=X+0.5-position.x*W y
// DY=Y+0.5-position.y*H se cumple p=(DX,DY)/H porque aspect=W/H.
const FLARE_S = 'max({size},0.000001)';
const FLARE_DX = '(X+0.5-{position.x}*W)';
const FLARE_DY = '(Y+0.5-{position.y}*H)';
const FLARE_DIST = `sqrt(${FLARE_DX}*${FLARE_DX}+${FLARE_DY}*${FLARE_DY})/H`;
const FLARE_CORE_T = `clip(1-${FLARE_DIST}/${FLARE_S},0,1)`;
const FLARE_CORE = `(${FLARE_CORE_T}*${FLARE_CORE_T}*(3-2*${FLARE_CORE_T}))`;
const FLARE_RING_X = `abs(${FLARE_DIST}-${FLARE_S}*0.9)`;
const FLARE_RING_T = `clip((1.4*${FLARE_S}-${FLARE_RING_X})/max(${FLARE_S}*0.4,0.000001),0,1)`;
const FLARE_RING = `(${FLARE_RING_T}*${FLARE_RING_T}*(3-2*${FLARE_RING_T})*0.5)`;
const FLARE_MX = '(X+0.5-(1-{position.x})*W)';
const FLARE_MY = '(Y+0.5-(1-{position.y})*H)';
const FLARE_MDIST = `sqrt(${FLARE_MX}*${FLARE_MX}+${FLARE_MY}*${FLARE_MY})/H`;
const FLARE_GHOST_T = `clip(1-${FLARE_MDIST}/max(${FLARE_S}*0.6,0.000001),0,1)`;
const FLARE_GHOST = `(${FLARE_GHOST_T}*${FLARE_GHOST_T}*(3-2*${FLARE_GHOST_T})*0.6)`;
const FLARE_MASK = `(${FLARE_CORE}+${FLARE_RING}+${FLARE_GHOST})`;
const flareChannel = (axis: 'r' | 'g' | 'b') =>
  `clip({tint.${axis}}*${FLARE_MASK}*{intensity}*255,0,255)`;
const flareGraph =
  'split=2[%A%b][%A%l];' +
  '[%A%b]format=gbrp[%A%base];' +
  '[%A%l]format=gbrp,geq=' +
  `r='${flareChannel('r')}':g='${flareChannel('g')}':b='${flareChannel('b')}'[%A%ov];` +
  '[%A%base][%A%ov]blend=all_mode=screen';

const flare = v({
  id: 'light.flare',
  name: 'Destello de lente',
  category: 'light',
  order: 60,
  description: 'Ghosts circulares alineados al centro, con la firma de un lente real apuntado al sol.',
  keywords: ['flare', 'destello', 'lente', 'sol', 'ghost'],
  params: [
    v2('position', 'Posición', 0, 1, [0.72, 0.28]),
    f('size', 'Tamaño', 0.02, 0.6, 0.18, { step: 0.01 }),
    f('intensity', 'Intensidad', 0, 1, 0.4, { step: 0.01 }),
    col('tint', 'Color', '#ffd9a0'),
  ],
  passes: [
    pass(`uniform vec2 p_position;
uniform float p_size;
uniform float p_intensity;
uniform vec3 p_tint;
void main() {
  vec3 c = texture(u_currentTexture, v_texCoord).rgb;
  vec2 p = (v_texCoord - p_position) * vec2(ek_aspect(), 1.0);
  float d = length(p);
  float core = smoothstep(p_size, 0.0, d);
  float ring = smoothstep(p_size * 1.4, p_size, abs(d - p_size * 0.9));
  vec2 mirror = (v_texCoord - (1.0 - p_position)) * vec2(ek_aspect(), 1.0);
  float ghost = smoothstep(p_size * 0.6, 0.0, length(mirror)) * 0.6;
  vec3 light = p_tint * (core + ring * 0.5 + ghost) * p_intensity;
  fragColor = vec4(1.0 - (1.0 - c) * (1.0 - light), 1.0);
}`),
  ],
  ffmpeg: {
    graph: flareGraph,
    fidelity: 'approximate',
    note: 'geq repite por píxel el core+anillo+ghost especular del shader (smoothstep cúbico manual) sobre fondo negro y blend=all_mode=screen reproduce la mezcla; el eje Y puede venir espejado respecto a v_texCoord (la posición vertical se invierte) y el coste es alto en cuadros grandes.',
  },
});

// Tomás del light.rays en export: el shader hace blur radial hacia
// `position` (16 pasos, peso (1-t)², compuerta por luminancia) y mezcla
// screen. La receta aísla altas luces con colorlevels, las suaviza con
// gblur y les aplica en geq una máscara angular fija de 8 rayos
// (cos^6(4·atan2) × caída radial) antes del screen. geq no puede iterar
// como el shader, así que la forma de los rayos es una aproximación
// angular, no el mismo muestreo radial.
const RAYS_DX = '(X+0.5-{position.x}*W)';
const RAYS_DY = '(Y+0.5-{position.y}*H)';
const RAYS_DIST = `sqrt(${RAYS_DX}*${RAYS_DX}+${RAYS_DY}*${RAYS_DY})/H`;
const RAYS_COS = `cos(atan2(${RAYS_DY},${RAYS_DX})*4)`;
const RAYS_STREAK = `pow(${RAYS_COS}*${RAYS_COS},3)`;
const RAYS_MASK = `(${RAYS_STREAK}*clip(1-${RAYS_DIST}/{length},0,1))`;
const raysChannel = (ch: 'r' | 'g' | 'b') => `clip(${ch}(X,Y)*${RAYS_MASK},0,255)`;
const raysGraph =
  'split=2[%A%b][%A%l];' +
  `[%A%l]colorlevels=rimin={threshold}:gimin={threshold}:bimin={threshold},format=gbrp,` +
  `gblur=sigma={softness},geq=` +
  `r='${raysChannel('r')}':g='${raysChannel('g')}':b='${raysChannel('b')}'[%A%ray];` +
  '[%A%b][%A%ray]blend=all_mode=screen:all_opacity={intensity}';

const rays = v({
  id: 'light.rays',
  name: 'Rayos de luz',
  category: 'light',
  order: 65,
  description: 'Streaks radiales desde una fuente de luz, como un amanecer o un proyector. El clásico de las demos.',
  keywords: ['rays', 'rayos', 'god rays', 'sol', 'amanecer', 'luz'],
  params: [
    v2('position', 'Fuente', 0, 1, [0.5, 0.12]),
    f('intensity', 'Intensidad', 0, 1, 0.6, { step: 0.01 }),
    f('threshold', 'Umbral', 0, 1, 0.55, { step: 0.01 }),
    f('length', 'Alcance', 0.1, 1, 0.6, { step: 0.01 }),
    f('softness', 'Suavidad', 0, 0.5, 0.15, { step: 0.01 }),
  ],
  passes: [
    pass(`uniform vec2 p_position;
uniform float p_intensity;
uniform float p_threshold;
uniform float p_length;
uniform float p_softness;
void main() {
  vec3 base = texture(u_currentTexture, v_texCoord).rgb;
  vec2 toLight = p_position - v_texCoord;
  float gateLo = max(0.0, p_threshold - p_softness);
  vec3 sum = vec3(0.0);
  float wsum = 0.0;
  for (int s = 0; s < 16; s++) {
    float t = float(s) / 15.0;
    float w = (1.0 - t) * (1.0 - t);
    vec3 c = ek_sample(v_texCoord + toLight * t * p_length * 0.2);
    float gate = smoothstep(gateLo, 1.0, ek_luma(c));
    sum += c * w * gate;
    wsum += w * gate;
  }
  vec3 rays = wsum > 0.0001 ? sum / wsum : vec3(0.0);
  float d = length((v_texCoord - p_position) * vec2(ek_aspect(), 1.0));
  float mask = smoothstep(p_length * 1.2, 0.0, d);
  fragColor = vec4(1.0 - (1.0 - base) * (1.0 - rays * p_intensity * mask), 1.0);
}`),
  ],
  ffmpeg: {
    graph: raysGraph,
    fidelity: 'approximate',
    note: 'Export aísla altas luces (colorlevels), las difumina (gblur) y las multiplica por una máscara angular fija de 8 rayos en geq + blend screen; el preview hace blur radial real de 16 pasos. softness es el sigma del gblur en export y el ancho de la compuerta de luminancia en preview.',
  },
});

// ──────────────────────────────────────────────────────── Desenfoque ──

const gaussian = v({
  id: 'blur.gaussian',
  name: 'Desenfoque gaussiano',
  category: 'blur',
  order: 10,
  description: 'Dos pasadas separables: horizontal y vertical. La misma calidad con la mitad del costo.',
  keywords: ['blur', 'desenfoque', 'gaussiano', 'suave'],
  params: [f('radius', 'Radio', 0, 60, 8, { step: 0.5, unit: 'px' })],
  passes: [
    pass(`uniform float p_radius;
void main() {
  vec3 c = ek_blur9(v_texCoord, vec2(p_radius / u_resolution.x, 0.0));
  fragColor = vec4(c, 1.0);
}`),
    pass(`uniform float p_radius;
void main() {
  vec3 c = ek_blur9(v_texCoord, vec2(0.0, p_radius / u_resolution.y));
  fragColor = vec4(c, 1.0);
}`),
  ],
  ffmpeg: { chain: ['gblur=sigma={radius}'], fidelity: 'exact' },
});

const motionBlur = v({
  id: 'blur.motion',
  name: 'Desenfoque direccional',
  category: 'blur',
  order: 20,
  description: 'Barrido en una dirección y ángulo. Sirve para simular una toma rápida o una transición.',
  keywords: ['motion blur', 'barrido', 'direccional', 'velocidad'],
  params: [
    f('angle', 'Ángulo', -180, 180, 0, { step: 1, unit: '°' }),
    f('length', 'Longitud', 0, 80, 12, { step: 0.5, unit: 'px' }),
    i('samples', 'Muestras', 4, 24, 10),
  ],
  passes: [
    pass(`uniform float p_angle;
uniform float p_length;
uniform int p_samples;
void main() {
  float a = radians(p_angle);
  vec2 dir = vec2(cos(a), sin(a)) * p_length / u_resolution;
  vec3 sum = vec3(0.0);
  int n = max(2, p_samples);
  for (int s = 0; s < 24; s++) {
    if (s >= n) break;
    float t = (float(s) / float(n - 1)) - 0.5;
    sum += ek_sample(v_texCoord + dir * t);
  }
  fragColor = vec4(sum / float(n), 1.0);
}`),
  ],
  ffmpeg: {
    chain: ['tmix=frames={samples}'],
    fidelity: 'approximate',
    note: 'tmix promedia frames en el tiempo, no píxeles en el espacio.',
  },
});

// Blur temporal sobre historia real: el renderer guarda los últimos 4
// frames fuente (`u_hist0..3`, `u_histCount` válidos) y este efecto
// promedia el actual con hasta 4 tomas anteriores con PESO UNIFORME —
// el mismo promedio que `tmix=frames=N` del export, ahora con hasta 5
// tomas reales en vez de 2. `frames` define la ventana (tope honesto en
// 5: actual + 4 de historia); `intensity` escala todos los pesos. El
// orden de la cadena (primero, sobre el fuente crudo) no cambia.
const temporalBlur = v({
  id: 'blur.temporal',
  name: 'Desenfoque de movimiento (tiempo)',
  category: 'blur',
  order: 25,
  description:
    'Promedia los últimos frames reales: el motionBlur del clip, en vivo.',
  keywords: ['motion blur', 'temporal', 'tiempo', 'movimiento', 'tmix'],
  params: [
    // Tope 5 = frame actual + 4 de historia; valores mayores se clampean
    // en el shader (normalizeParams también respeta el max del manifiesto).
    i('frames', 'Frames', 2, 5, 4),
    f('intensity', 'Intensidad', 0, 1, 0.6, { step: 0.01 }),
  ],
  passes: [
    pass(`uniform sampler2D u_hist0;
uniform sampler2D u_hist1;
uniform sampler2D u_hist2;
uniform sampler2D u_hist3;
uniform float u_histCount;
uniform int p_frames;
uniform float p_intensity;
void main() {
  vec3 cur = texture(u_currentTexture, v_texCoord).rgb;
  // taps: ventana pedida (tope 5 = actual + 4 de historia). Cada toma
  // válida pesa igual — promedio honesto tipo tmix.
  int taps = clamp(p_frames, 2, 5);
  vec3 acc = cur;
  float wsum = 0.0;
  vec3 h0 = texture(u_hist0, v_texCoord).rgb;
  float w0 = p_intensity * step(0.5, u_histCount) * step(1.5, float(taps));
  acc += w0 * h0; wsum += w0;
  vec3 h1 = texture(u_hist1, v_texCoord).rgb;
  float w1 = p_intensity * step(1.5, u_histCount) * step(2.5, float(taps));
  acc += w1 * h1; wsum += w1;
  vec3 h2 = texture(u_hist2, v_texCoord).rgb;
  float w2 = p_intensity * step(2.5, u_histCount) * step(3.5, float(taps));
  acc += w2 * h2; wsum += w2;
  vec3 h3 = texture(u_hist3, v_texCoord).rgb;
  float w3 = p_intensity * step(3.5, u_histCount) * step(4.5, float(taps));
  acc += w3 * h3; wsum += w3;
  fragColor = vec4(acc / max(1.0, 1.0 + wsum), 1.0);
}`),
  ],
  ffmpeg: {
    chain: ['tmix=frames={frames}'],
    fidelity: 'approximate',
    note: 'tmix promedia N frames con peso uniforme; el preview promedia hasta 5 tomas reales (actual + 4 de historia) con el mismo peso.',
  },
});

// Denoise temporal sobre historia real: el renderer guarda los últimos 4
// frames fuente (`u_hist0..3`, orden cronológico, `u_histCount` válidos) y
// el shader promedia cada pixel ponderando cada toma por su similitud con
// el actual — ruido promedia en zonas estáticas, movimiento se preserva.
// Es la componente temporal de la reducción de ruido del export (nlmeans:
// el FFmpeg bundled no trae hqdn3d), mucho más cerca que el
// blur de 2 tomas anterior; sigue sin umbrales adaptativos ni estimación
// de sigma, así que es `approximate`, no sample-exacta. En clips estátices
// o pausados (historia idéntica) es no-op por diseño.
const temporalDenoise = v({
  id: 'denoise.temporal',
  name: 'Reducción de ruido (tiempo)',
  category: 'blur',
  order: 26,
  description:
    'Promedia los últimos 4 frames sólo donde la imagen no se movió: baja el ruido sin borrar el movimiento.',
  keywords: ['denoise', 'ruido', 'noise', 'temporal', 'hqdn3d', 'limpieza'],
  params: [
    f('strength', 'Intensidad', 0, 1, 0.6, { step: 0.01 }),
    f('tolerance', 'Tolerancia', 0, 1, 0.35, { step: 0.01 }),
  ],
  passes: [
    pass(`uniform sampler2D u_hist0;
uniform sampler2D u_hist1;
uniform sampler2D u_hist2;
uniform sampler2D u_hist3;
uniform float u_histCount;
uniform float p_strength;
uniform float p_tolerance;
void main() {
  vec3 cur = texture(u_currentTexture, v_texCoord).rgb;
  // k: a mayor tolerancia, más caído el peso (zonas casi iguales promedian
  // menos — conservador). agree≈1 cuando el frame coincide con el actual.
  float k = mix(18.0, 4.0, p_tolerance);
  vec3 acc = cur;
  float wsum = 0.0;
  // Los 4 taps se escriben explícitos (GLSL ES no permite indexar samplers
  // con índice dinámico). El paso i+0.5 <= count deja fuera los slots que
  // aún no tienen historia válida.
  vec3 h0 = texture(u_hist0, v_texCoord).rgb;
  float w0 = p_strength * exp(-distance(cur, h0) * k) * step(0.5, u_histCount);
  acc += w0 * h0; wsum += w0;
  vec3 h1 = texture(u_hist1, v_texCoord).rgb;
  float w1 = p_strength * exp(-distance(cur, h1) * k) * step(1.5, u_histCount);
  acc += w1 * h1; wsum += w1;
  vec3 h2 = texture(u_hist2, v_texCoord).rgb;
  float w2 = p_strength * exp(-distance(cur, h2) * k) * step(2.5, u_histCount);
  acc += w2 * h2; wsum += w2;
  vec3 h3 = texture(u_hist3, v_texCoord).rgb;
  float w3 = p_strength * exp(-distance(cur, h3) * k) * step(3.5, u_histCount);
  acc += w3 * h3; wsum += w3;
  fragColor = vec4(acc / (1.0 + wsum), 1.0);
}`),
  ],
  ffmpeg: {
    chain: ['nlmeans=s=4:p=7:r=15'],
    fidelity: 'approximate',
    note: 'nlmeans suaviza ruido espacial preservando bordes (hqdn3d no está en el FFmpeg bundled); el preview promedia 4 tomas ponderadas sólo en zonas estáticas.',
  },
});

// Debanding: gradfun difumina los escalones de las gradientes (cielos,
// paredes lisas) agregando dithering; el shader lo aproxima con un blur
// suave ligero — el dithering real no se puede previsualizar en GLSL ES.
const deband = v({
  id: 'blur.deband',
  name: 'Desbanding',
  category: 'blur',
  order: 27,
  description: 'Suaviza las bandas de color en gradientes lisos (cielos, fondos) con dithering.',
  keywords: ['deband', 'banding', 'bandas', 'gradiente', 'dither', 'suavizado'],
  params: [
    f('strength', 'Intensidad', 1, 16, 4, { step: 0.5 }),
    f('radius', 'Radio', 4, 32, 16, { step: 1 }),
  ],
  passes: [
    pass(`uniform float p_strength;
uniform float p_radius;
void main() {
  vec2 px = p_radius / u_resolution;
  vec3 c = texture(u_currentTexture, v_texCoord).rgb;
  vec3 blur = (
    texture(u_currentTexture, v_texCoord + vec2(px.x, 0.0)).rgb +
    texture(u_currentTexture, v_texCoord - vec2(px.x, 0.0)).rgb +
    texture(u_currentTexture, v_texCoord + vec2(0.0, px.y)).rgb +
    texture(u_currentTexture, v_texCoord - vec2(0.0, px.y)).rgb
  ) * 0.25;
  float k = clamp(p_strength / 16.0, 0.0, 1.0);
  fragColor = vec4(mix(c, blur, k * 0.35), 1.0);
}`),
  ],
  ffmpeg: {
    chain: ['gradfun=strength={strength}:radius={radius}'],
    fidelity: 'approximate',
    note: 'gradfun aplica dithering ordenado real; el preview sólo difumina las bandas con un blur direccional.',
  },
});

// Bilateral espacial: suaviza ruido sin cruzar bordes — la alternativa
// ligera a nlmeans cuando el material tiene detalle fino. El shader hace
// un bilateral de 4 tomas (peso por distancia de color); el export usa el
// filtro bilateral real con sigmaS/sigmaR.
const bilateral = v({
  id: 'blur.bilateral',
  name: 'Suavizado por bordes',
  category: 'blur',
  order: 29,
  description: 'Reduce ruido y textura conservando los bordes nítidos. Para piel, producto y material fino.',
  keywords: ['bilateral', 'bordes', 'edge', 'suavizado', 'denoise', 'piel'],
  params: [
    f('sigma', 'Alcance', 1, 10, 4, { step: 0.5 }),
    f('range', 'Rango', 0.05, 0.5, 0.15, { step: 0.01 }),
  ],
  passes: [
    pass(`uniform float p_sigma;
uniform float p_range;
void main() {
  vec2 px = vec2(p_sigma / u_resolution.x, p_sigma / u_resolution.y);
  vec3 c = texture(u_currentTexture, v_texCoord).rgb;
  float rs = max(0.001, p_range * 8.0);
  vec3 acc = c;
  float wsum = 1.0;
  vec2 dirs[4];
  dirs[0] = vec2(px.x, 0.0); dirs[1] = vec2(-px.x, 0.0);
  dirs[2] = vec2(0.0, px.y); dirs[3] = vec2(0.0, -px.y);
  for (int i = 0; i < 4; i++) {
    vec3 n = texture(u_currentTexture, v_texCoord + dirs[i]).rgb;
    float w = exp(-distance(c, n) / rs);
    acc += w * n;
    wsum += w;
  }
  fragColor = vec4(acc / wsum, 1.0);
}`),
  ],
  ffmpeg: {
    chain: ['bilateral=sigmaS={sigma}:sigmaR={range}:planes=7'],
    fidelity: 'approximate',
    note: 'El filtro bilateral real promedia una ventana mayor; el shader usa 4 tomas con peso por distancia de color.',
  },
});

// Deinterlace: bwdif reconstruye frames progresivos desde material
// entrelazado (vídeo viejo, captura de captura). El preview no puede
// detectar el entrelazado, así que aproxima con un fundido vertical
// suave entre líneas vecinas — el efecto real lo hace el export.
const deinterlace = v({
  id: 'blur.deinterlace',
  name: 'Deinterlace',
  category: 'blur',
  order: 28,
  description: 'Convierte video entrelazado (dientes de sierra en movimiento) en progresivo.',
  keywords: ['deinterlace', 'interlaced', 'entrelazado', 'bwdif', 'combing', 'tele'],
  params: [],
  passes: [
    pass(`void main() {
  vec3 c = texture(u_currentTexture, v_texCoord).rgb;
  vec2 px = vec2(0.0, 1.0 / u_resolution.y);
  vec3 v = (texture(u_currentTexture, v_texCoord + px).rgb +
            texture(u_currentTexture, v_texCoord - px).rgb) * 0.5;
  fragColor = vec4(mix(c, v, 0.5), 1.0);
}`),
  ],
  ffmpeg: {
    chain: ['bwdif=mode=send_frame:parity=auto'],
    fidelity: 'approximate',
    note: 'El preview siempre aplica el fundido suave; el export de-interlaza de verdad sólo si el material está marcado.',
  },
});

// Tomás del blur.zoom en export: el shader promedia `samples` lecturas con
// factor `1-amount*t` hacia `center`; FFmpeg no itera, así que se fijan 6
// tomas (t = 0..1) y cada rama se promedia con la anterior vía `blend`.
const ZOOM_BLUR_TAPS = [0, 0.2, 0.4, 0.6, 0.8, 1] as const;
const zoomBlurGraph = [
  `split=${ZOOM_BLUR_TAPS.length * 2}${ZOOM_BLUR_TAPS.map((_, i) => `[%A%b${i}]`).join('')}${ZOOM_BLUR_TAPS.map((_, i) => `[%A%s${i}]`).join('')}`,
  ...ZOOM_BLUR_TAPS.map(
    (t, i) =>
      `[%A%s${i}]scale=w='trunc(iw/max(1-{amount}*${t},0.05)/2)*2':h='trunc(ih/max(1-{amount}*${t},0.05)/2)*2'[%A%z${i}]`,
  ),
  ...ZOOM_BLUR_TAPS.map(
    (_, i) =>
      `[%A%b${i}][%A%z${i}]overlay=x='{center.x}*(W-w)':y='{center.y}*(H-h)':format=auto[%A%t${i}]`,
  ),
  ...ZOOM_BLUR_TAPS.slice(1).map((_, i) => {
    const out = i === 0 ? `[%A%m1]` : i < ZOOM_BLUR_TAPS.length - 2 ? `[%A%m${i + 1}]` : '';
    return `[%A%${i === 0 ? 't0' : `m${i}`}][%A%t${i + 1}]blend=all_mode=average${out}`;
  }),
].join(';');

const zoomBlur = v({
  id: 'blur.zoom',
  name: 'Desenfoque radial',
  category: 'blur',
  order: 30,
  description: 'Las muestras se acumulan hacia el centro: sensación de zoom o de mareo.',
  keywords: ['zoom', 'radial', 'mareo', 'velocidad'],
  params: [
    f('amount', 'Cantidad', 0, 1, 0.25, { step: 0.01 }),
    i('samples', 'Muestras', 4, 24, 12),
    v2('center', 'Centro', 0, 1, [0.5, 0.5]),
  ],
  passes: [
    pass(`uniform float p_amount;
uniform int p_samples;
uniform vec2 p_center;
void main() {
  vec2 dir = v_texCoord - p_center;
  vec3 sum = vec3(0.0);
  int n = max(2, p_samples);
  for (int s = 0; s < 24; s++) {
    if (s >= n) break;
    float t = float(s) / float(n - 1);
    sum += ek_sample(p_center + dir * (1.0 - p_amount * t));
  }
  fragColor = vec4(sum / float(n), 1.0);
}`),
  ],
  ffmpeg: {
    graph: zoomBlurGraph,
    fidelity: 'approximate',
    note: 'Export usa 6 tomas fijas (el parámetro Muestras sólo aplica al preview) y promedia con blend; el remuestreo de scale no es el de ek_sample.',
  },
});

const tiltShift = v({
  id: 'blur.tilt_shift',
  name: 'Tilt shift',
  category: 'blur',
  order: 40,
  description: 'Franja nítida en el medio y desenfoque creciente arriba y abajo. El truco de la miniatura.',
  keywords: ['tilt shift', 'miniatura', 'franja', 'foco'],
  params: [
    f('focus', 'Centro del foco', 0, 1, 0.5, { step: 0.01 }),
    f('band', 'Ancho nítido', 0.02, 1, 0.25, { step: 0.01 }),
    f('radius', 'Desenfoque', 0, 40, 12, { step: 0.5, unit: 'px' }),
  ],
  passes: [
    pass(`uniform float p_focus;
uniform float p_band;
uniform float p_radius;
void main() {
  float distanceToFocus = abs(v_texCoord.y - p_focus);
  float weight = smoothstep(p_band * 0.5, p_band * 0.5 + 0.35, distanceToFocus);
  vec3 sharp = texture(u_currentTexture, v_texCoord).rgb;
  vec3 blurred = ek_blur9(v_texCoord, vec2(0.0, p_radius * weight / u_resolution.y));
  fragColor = vec4(mix(sharp, blurred, weight), 1.0);
}`),
  ],
  ffmpeg: {
    chain: ['gblur=sigma={radius}'],
    fidelity: 'approximate',
    note: 'FFmpeg desenfoca todo el cuadro; el shader respeta la franja nítida.',
  },
});

// ─────────────────────────────────────────────────────────── Estilo ──

const sharpen = v({
  id: 'stylize.sharpen',
  name: 'Enfoque',
  category: 'stylize',
  order: 10,
  description: 'Máscara de desenfoque: resta una versión suave para recuperar microdetalle.',
  keywords: ['sharpen', 'enfoque', 'detalle', 'nitidez'],
  params: [
    f('amount', 'Cantidad', 0, 3, 1, { step: 0.01 }),
    f('radius', 'Radio', 0.5, 6, 1, { step: 0.1, unit: 'px' }),
  ],
  passes: [
    pass(`uniform float p_amount;
uniform float p_radius;
void main() {
  vec2 px = p_radius / u_resolution;
  vec3 c = texture(u_currentTexture, v_texCoord).rgb;
  vec3 blur = (
    ek_sample(v_texCoord + vec2(px.x, 0.0)) +
    ek_sample(v_texCoord - vec2(px.x, 0.0)) +
    ek_sample(v_texCoord + vec2(0.0, px.y)) +
    ek_sample(v_texCoord - vec2(0.0, px.y))
  ) * 0.25;
  fragColor = vec4(c + (c - blur) * p_amount, 1.0);
}`),
  ],
  ffmpeg: { chain: ['unsharp=5:5:{amount}:5:5:0'], fidelity: 'exact' },
});

const edge = v({
  id: 'stylize.edge',
  name: 'Detección de bordes',
  category: 'stylize',
  order: 20,
  description: 'Sobel con mezcla sobre el original. Base para looks gráficos y para el contorno.',
  keywords: ['edge', 'bordes', 'sobel', 'lineas'],
  params: [
    f('amount', 'Mezcla', 0, 1, 1, { step: 0.01 }),
    f('gain', 'Ganancia', 0.5, 8, 2, { step: 0.1 }),
    b('color', 'Bordes a color', false),
  ],
  passes: [
    pass(`uniform float p_amount;
uniform float p_gain;
uniform bool p_color;
void main() {
  vec2 px = 1.0 / u_resolution;
  vec3 c = texture(u_currentTexture, v_texCoord).rgb;
  float tl = ek_luma(ek_sample(v_texCoord + vec2(-px.x, -px.y)));
  float tc = ek_luma(ek_sample(v_texCoord + vec2(0.0, -px.y)));
  float tr = ek_luma(ek_sample(v_texCoord + vec2(px.x, -px.y)));
  float ml = ek_luma(ek_sample(v_texCoord + vec2(-px.x, 0.0)));
  float mr = ek_luma(ek_sample(v_texCoord + vec2(px.x, 0.0)));
  float bl = ek_luma(ek_sample(v_texCoord + vec2(-px.x, px.y)));
  float bc = ek_luma(ek_sample(v_texCoord + vec2(0.0, px.y)));
  float br = ek_luma(ek_sample(v_texCoord + vec2(px.x, px.y)));
  float gx = -tl - 2.0 * ml - bl + tr + 2.0 * mr + br;
  float gy = -tl - 2.0 * tc - tr + bl + 2.0 * bc + br;
  float mag = clamp(sqrt(gx * gx + gy * gy) * p_gain, 0.0, 1.0);
  vec3 lines = p_color ? c * mag : vec3(mag);
  fragColor = vec4(mix(c, lines, p_amount), 1.0);
}`),
  ],
  ffmpeg: {
    chain: ['edgedetect=low=0.05:high=0.25'],
    fidelity: 'approximate',
    note: 'edgedetect usa un umbral binario; el shader devuelve magnitud continua.',
  },
});

const sketch = v({
  id: 'stylize.sketch',
  name: 'Lápiz',
  category: 'stylize',
  order: 30,
  description: 'Bordes invertidos sobre papel con grano. Un dibujo a lápiz del frame.',
  keywords: ['sketch', 'lapiz', 'dibujo', 'papel'],
  params: [
    f('strength', 'Trazo', 0, 2, 1, { step: 0.01 }),
    f('paper', 'Papel', 0, 1, 0.3, { step: 0.01 }),
  ],
  passes: [
    pass(`uniform float p_strength;
uniform float p_paper;
void main() {
  vec2 px = 1.0 / u_resolution;
  float tl = ek_luma(ek_sample(v_texCoord + vec2(-px.x, -px.y)));
  float tr = ek_luma(ek_sample(v_texCoord + vec2(px.x, -px.y)));
  float bl = ek_luma(ek_sample(v_texCoord + vec2(-px.x, px.y)));
  float br = ek_luma(ek_sample(v_texCoord + vec2(px.x, px.y)));
  float gx = -tl + tr - bl + br;
  float gy = -tl - tr + bl + br;
  float edge = clamp(sqrt(gx * gx + gy * gy) * p_strength * 3.0, 0.0, 1.0);
  float grain = ek_noise(v_texCoord * u_resolution * 0.6) * p_paper * 0.25;
  float ink = clamp(1.0 - edge * 1.6, 0.0, 1.0);
  fragColor = vec4(vec3(ink) - grain * 0.2, 1.0);
}`),
  ],
  ffmpeg: {
    chain: ['edgedetect=mode=colormix:high=0.2', 'negate'],
    fidelity: 'approximate',
    note: 'El grano de papel no tiene equivalente directo.',
  },
});

const pixelate = v({
  id: 'stylize.pixelate',
  name: 'Pixelado',
  category: 'stylize',
  order: 40,
  description: 'Reduce la imagen a bloques cuadrados. Para ocultar o para estética 8-bit.',
  keywords: ['pixelate', 'pixelado', 'bloques', '8bit'],
  params: [f('size', 'Bloque', 2, 96, 12, { step: 1, unit: 'px' })],
  passes: [
    pass(`uniform float p_size;
void main() {
  vec2 block = p_size / u_resolution;
  vec2 uv = floor(v_texCoord / block) * block + block * 0.5;
  fragColor = vec4(texture(u_currentTexture, uv).rgb, 1.0);
}`),
  ],
  ffmpeg: { chain: ['pixelize=w={size}:h={size}'], fidelity: 'exact' },
});

// Tomás del stylize.halftone en export: el shader evalúa la trama por píxel —
// celda = fract(px rotado) − 0.5, radio = (1−luma)·0.62 y punto = smoothstep
// (borde0 > borde1) del largo de la celda. geq repite la misma cuenta por
// píxel leyendo la luminancia de los tres planos de entrada; el cos/sin del
// ángulo quedan horneados al sustituir {angle}.
function halftoneGraph(): string {
  const px = '(X+0.5)/max({scale},1)';
  const py = '(Y+0.5)/max({scale},1)';
  const cos = 'cos({angle}*0.017453292519943295)';
  const sin = 'sin({angle}*0.017453292519943295)';
  const rx = `(${cos}*${px}-${sin}*${py})`;
  const ry = `(${sin}*${px}+${cos}*${py})`;
  const fx = `(${rx}-floor(${rx})-0.5)`;
  const fy = `(${ry}-floor(${ry})-0.5)`;
  const len = `sqrt(${fx}*${fx}+${fy}*${fy})`;
  const luma =
    'clip(((0.2126*r(X,Y)+0.7152*g(X,Y)+0.0722*b(X,Y))/255-0.5)*{contrast}+0.5,0,1)';
  const radius = `(1-${luma})*0.62`;
  const t = `clip((${radius}-${len})/0.08,0,1)`;
  const dot = `(${t}*${t}*(3-2*${t}))*255`;
  return `format=gbrp,geq=r='${dot}':g='${dot}':b='${dot}'`;
}

const halftone = v({
  id: 'stylize.halftone',
  name: 'Semitono',
  category: 'stylize',
  order: 50,
  description: 'Trama de puntos de imprenta: el tamaño del punto sigue a la luminancia.',
  keywords: ['halftone', 'semitono', 'comic', 'imprenta', 'puntos'],
  params: [
    f('scale', 'Trama', 3, 40, 8, { step: 1, unit: 'px' }),
    f('angle', 'Ángulo', -90, 90, 45, { step: 1, unit: '°' }),
    f('contrast', 'Contraste', 0.5, 3, 1.4, { step: 0.01 }),
  ],
  passes: [
    pass(`uniform float p_scale;
uniform float p_angle;
uniform float p_contrast;
void main() {
  vec3 c = texture(u_currentTexture, v_texCoord).rgb;
  float l = clamp((ek_luma(c) - 0.5) * p_contrast + 0.5, 0.0, 1.0);
  vec2 px = v_texCoord * u_resolution / p_scale;
  px = ek_rotate(px, radians(p_angle));
  vec2 cell = fract(px) - 0.5;
  float radius = (1.0 - l) * 0.62;
  float dot = smoothstep(radius, radius - 0.08, length(cell));
  fragColor = vec4(vec3(dot), 1.0);
}`),
  ],
  ffmpeg: {
    graph: halftoneGraph(),
    fidelity: 'approximate',
    note: 'geq evalúa la misma trama por píxel (luma de los 3 planos, smoothstep cúbico); el muestreo es por centro de píxel y el coste es alto en cuadros grandes.',
  },
});

const posterize = v({
  id: 'stylize.posterize',
  name: 'Posterizar',
  category: 'stylize',
  order: 60,
  description: 'Cuantiza el color en escalones planos. De 2 a 32 niveles por canal.',
  keywords: ['posterize', 'poster', 'niveles', 'cuantizar'],
  params: [i('levels', 'Niveles', 2, 32, 6)],
  passes: [
    pass(`uniform int p_levels;
void main() {
  vec3 c = texture(u_currentTexture, v_texCoord).rgb;
  float n = float(max(2, p_levels) - 1);
  fragColor = vec4(floor(c * n + 0.5) / n, 1.0);
}`),
  ],
  ffmpeg: {
    chain: ['elbg=codebook_length={levels}'],
    fidelity: 'approximate',
    note: 'elbg agrupa por codebook; no es una cuantización uniforme por canal.',
  },
});

const oil = v({
  id: 'stylize.oil',
  name: 'Óleo',
  category: 'stylize',
  order: 70,
  description: 'Acumula el vecindario en la dirección de menor varianza: manchas de pintura.',
  keywords: ['oil', 'oleo', 'pintura', 'artistico'],
  params: [
    f('radius', 'Pincel', 1, 8, 3, { step: 0.5, unit: 'px' }),
    i('levels', 'Planos', 4, 32, 12),
  ],
  passes: [
    pass(`uniform float p_radius;
uniform int p_levels;
void main() {
  vec2 px = p_radius / u_resolution;
  float levels = float(max(4, p_levels));
  vec3 best = texture(u_currentTexture, v_texCoord).rgb;
  float bestCount = -1.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec3 c = ek_sample(v_texCoord + vec2(float(x), float(y)) * px * 1.5);
      vec3 q = floor(c * levels) / levels;
      float count = 0.0;
      for (int j = -1; j <= 1; j++) {
        for (int i2 = -1; i2 <= 1; i2++) {
          vec3 n = ek_sample(v_texCoord + vec2(float(i2), float(j)) * px * 1.5);
          if (length(floor(n * levels) / levels - q) < 0.01) count += 1.0;
        }
      }
      if (count > bestCount) { bestCount = count; best = c; }
    }
  }
  fragColor = vec4(best, 1.0);
}`),
  ],
  ffmpeg: {
    chain: ['bilateral=sigmaS=3:sigmaR=0.5:planes=7'],
    fidelity: 'approximate',
    note: 'bilateral suaviza conservando bordes (smartblur no está en el FFmpeg bundled); no acumula por planos de color.',
  },
});

const outline = v({
  id: 'stylize.outline',
  name: 'Contorno',
  category: 'stylize',
  order: 80,
  description: 'Dibuja el borde de las siluetas sobre el color original. Look de sticker o de dibujo animado.',
  keywords: ['outline', 'contorno', 'sticker', 'linea'],
  params: [
    f('thickness', 'Grosor', 0.5, 4, 1.2, { step: 0.1, unit: 'px' }),
    col('color', 'Color', '#000000'),
    f('opacity', 'Opacidad', 0, 1, 1, { step: 0.01 }),
  ],
  passes: [
    pass(`uniform float p_thickness;
uniform vec3 p_color;
uniform float p_opacity;
void main() {
  vec2 px = p_thickness / u_resolution;
  vec3 c = texture(u_currentTexture, v_texCoord).rgb;
  float center = ek_luma(c);
  float around = 0.0;
  around += ek_luma(ek_sample(v_texCoord + vec2(px.x, 0.0)));
  around += ek_luma(ek_sample(v_texCoord - vec2(px.x, 0.0)));
  around += ek_luma(ek_sample(v_texCoord + vec2(0.0, px.y)));
  around += ek_luma(ek_sample(v_texCoord - vec2(0.0, px.y)));
  around *= 0.25;
  float edge = smoothstep(0.04, 0.12, abs(center - around));
  fragColor = vec4(mix(c, p_color, edge * p_opacity), 1.0);
}`),
  ],
  ffmpeg: {
    graph:
      'split=2[%A%b][%A%e];[%A%e]edgedetect=low=0.04:high=0.12,negate,format=rgb24[%A%mask];' +
      '[%A%b][%A%mask]blend=all_mode=multiply',
    fidelity: 'approximate',
    note: 'El contorno se multiplica sobre el original; el color del trazo queda fijo en negro.',
  },
});

// Grabado a líneas cruzadas (crosshatch): papel + tinta donde la densidad
// sigue la oscuridad del original. El shader mezcla hacia papel con dos
// peines diagonales; el export calcula el mismo patrón en `geq` sobre la
// luma y fija croma neutro (128) para el resultado blanco y negro.
const CROSSHATCH_TONE = 'clip(1-lum(X,Y)/255,0,1)';
const CROSSHATCH_HATCH =
  `min(abs(sin(((X+0.5)/W+(Y+0.5)/H)*{count}*3.14159265)),` +
  `abs(sin(((X+0.5)/W-(Y+0.5)/H)*{count}*3.14159265)))`;
const CROSSHATCH_LUM =
  `clip(242*(1-${CROSSHATCH_TONE}*(0.4+0.6*${CROSSHATCH_HATCH})*{intensity}),0,255)`;

const crosshatch = v({
  id: 'stylize.crosshatch',
  name: 'Trama cruzada',
  category: 'stylize',
  order: 85,
  description: 'Conversión a grabado: papel blanco con líneas de tinta cuya densidad sigue los tonos.',
  keywords: ['crosshatch', 'grabado', 'trama', 'tinta', 'engraving', 'linea'],
  params: [
    i('count', 'Densidad', 10, 200, 60),
    f('intensity', 'Intensidad', 0, 1, 0.7, { step: 0.01 }),
  ],
  passes: [
    pass(`uniform float p_count;
uniform float p_intensity;
void main() {
  vec3 c = texture(u_currentTexture, v_texCoord).rgb;
  float l = ek_luma(c);
  float d1 = (v_texCoord.x + v_texCoord.y) * p_count;
  float d2 = (v_texCoord.x - v_texCoord.y) * p_count;
  float hatch = min(abs(sin(d1 * 3.14159265)), abs(sin(d2 * 3.14159265)));
  float ink = (1.0 - l) * (0.4 + 0.6 * hatch);
  fragColor = vec4(vec3(0.95) * (1.0 - ink * p_intensity), 1.0);
}`),
  ],
  ffmpeg: {
    chain: [
      `geq=lum='${CROSSHATCH_LUM}':cb='128':cr='128'`,
    ],
    fidelity: 'approximate',
    note: 'El resultado es grabado B/N sobre papel; el shader usa el mismo modelo (densidad = oscuridad × trama).',
  },
});

// ─────────────────────────────────────────────────────────── Glitch ──

const rgbSplit = v({
  id: 'glitch.rgb_split',
  name: 'Separación RGB',
  category: 'glitch',
  order: 10,
  description: 'Desplaza los canales rojo y azul en direcciones opuestas. Aberración cromática de manual.',
  keywords: ['rgb split', 'aberracion', 'cromatico', 'canales'],
  params: [
    f('amount', 'Separación', 0, 40, 4, { step: 0.5, unit: 'px' }),
    f('angle', 'Ángulo', -180, 180, 0, { step: 1, unit: '°' }),
  ],
  passes: [
    pass(`uniform float p_amount;
uniform float p_angle;
void main() {
  vec2 dir = vec2(cos(radians(p_angle)), sin(radians(p_angle))) * p_amount / u_resolution;
  float r = ek_sample(v_texCoord + dir).r;
  float g = ek_sample(v_texCoord).g;
  float b = ek_sample(v_texCoord - dir).b;
  fragColor = vec4(r, g, b, 1.0);
}`),
  ],
  ffmpeg: {
    chain: ['rgbashift=rh={amount}:bh=-{amount}'],
    fidelity: 'approximate',
    note: 'rgbashift sólo desplaza en horizontal.',
  },
});

const blockGlitch = v({
  id: 'glitch.block',
  name: 'Glitch de bloques',
  category: 'glitch',
  order: 20,
  description: 'Franjas horizontales que se corren de golpe, con refresco temporal. Fallo de códec controlado.',
  keywords: ['glitch', 'bloques', 'codec', 'falla', 'datamosh'],
  params: [
    f('amount', 'Desplazamiento', 0, 0.3, 0.06, { step: 0.005 }),
    i('rows', 'Filas', 4, 64, 18),
    f('rate', 'Refresco', 0.5, 30, 8, { step: 0.5, unit: 'Hz' }),
    f('density', 'Densidad', 0, 1, 0.35, { step: 0.01 }),
  ],
  passes: [
    pass(`uniform float p_amount;
uniform int p_rows;
uniform float p_rate;
uniform float p_density;
void main() {
  vec2 uv = v_texCoord;
  float row = floor(uv.y * float(max(2, p_rows)));
  float tick = floor(u_time * p_rate);
  float n = ek_hash21(vec2(row, tick));
  if (n > 1.0 - p_density) {
    uv.x = fract(uv.x + (n - 0.5) * 2.0 * p_amount);
  }
  fragColor = vec4(texture(u_currentTexture, uv).rgb, 1.0);
}`),
  ],
  ffmpeg: {
    chain: ['noise=alls=14:allf=t+u', 'rgbashift=rh=3:bh=-3'],
    fidelity: 'approximate',
    note: 'FFmpeg no desplaza franjas; se aproxima con ruido temporal y separación de canales.',
  },
});

const scanline = v({
  id: 'glitch.scanline',
  name: 'Líneas de barrido',
  category: 'glitch',
  order: 30,
  description: 'Oscurece líneas alternas y suma ruido fino. La textura de un monitor viejo.',
  keywords: ['scanline', 'barrido', 'monitor', 'crt', 'tv'],
  params: [
    f('density', 'Densidad', 60, 1200, 320, { step: 10, unit: 'líneas' }),
    f('strength', 'Profundidad', 0, 1, 0.35, { step: 0.01 }),
    f('noise', 'Ruido', 0, 1, 0.15, { step: 0.01 }),
  ],
  passes: [
    pass(`uniform float p_density;
uniform float p_strength;
uniform float p_noise;
void main() {
  vec3 c = texture(u_currentTexture, v_texCoord).rgb;
  float line = sin(v_texCoord.y * p_density * EK_PI) * 0.5 + 0.5;
  c *= 1.0 - (1.0 - line) * p_strength;
  c += (ek_frame_noise(v_texCoord * u_resolution) - 0.5) * p_noise * 0.25;
  fragColor = vec4(c, 1.0);
}`),
  ],
  ffmpeg: {
    chain: ['drawgrid=w=iw:h=3:t=1:c=black@0.25', 'noise=alls=10:allf=t'],
    fidelity: 'approximate',
    note: 'drawgrid pinta líneas de 1 px cada 3; el shader usa una sinusoide continua.',
  },
});

const digitalGlitch = v({
  id: 'glitch.digital',
  name: 'Glitch digital',
  category: 'glitch',
  order: 40,
  description: 'Bloques, ruido y desplazamiento de canal combinados, con intensidad y cadencia propias.',
  keywords: ['glitch', 'digital', 'ruido', 'corrupcion'],
  params: [
    f('intensity', 'Intensidad', 0, 1, 0.5, { step: 0.01 }),
    f('speed', 'Velocidad', 0, 20, 6, { step: 0.5 }),
    f('blocks', 'Bloques', 4, 80, 24),
  ],
  passes: [
    pass(`uniform float p_intensity;
uniform float p_speed;
uniform float p_blocks;
void main() {
  vec2 uv = v_texCoord;
  float t = floor(u_time * p_speed);
  float band = floor(uv.y * p_blocks);
  float n = ek_hash21(vec2(band, t));
  uv.x = fract(uv.x + (n - 0.5) * p_intensity * 0.25);
  float split = p_intensity * 0.02;
  vec3 c;
  c.r = ek_sample(uv + vec2(split, 0.0)).r;
  c.g = ek_sample(uv).g;
  c.b = ek_sample(uv - vec2(split, 0.0)).b;
  float staticNoise = ek_frame_noise(uv * u_resolution) * p_intensity * 0.2;
  fragColor = vec4(c + staticNoise, 1.0);
}`),
  ],
  ffmpeg: {
    chain: ['rgbashift=rh=4:bh=-4', 'noise=alls=18:allf=t+u'],
    fidelity: 'approximate',
    note: 'Sin desplazamiento por bandas: sólo separación de canales y ruido.',
  },
});

const kaleidoscope = v({
  id: 'glitch.kaleidoscope',
  name: 'Caleidoscopio',
  category: 'glitch',
  order: 50,
  description: 'Repite el frame en sectores espejados alrededor del centro.',
  keywords: ['kaleidoscope', 'caleidoscopio', 'espejo', 'simetria'],
  params: [
    i('segments', 'Segmentos', 2, 16, 6),
    f('rotation', 'Rotación', 0, 1, 0, { step: 0.01 }),
    f('zoom', 'Zoom', 0.3, 3, 1, { step: 0.01 }),
  ],
  passes: [
    pass(`uniform int p_segments;
uniform float p_rotation;
uniform float p_zoom;
void main() {
  vec2 p = ek_centered(v_texCoord);
  p = ek_rotate(p, p_rotation * EK_TAU);
  float r = length(p);
  float a = atan(p.y, p.x);
  float seg = EK_TAU / float(max(2, p_segments));
  a = mod(a, seg);
  a = abs(a - seg * 0.5);
  vec2 q = vec2(cos(a), sin(a)) * r / max(0.05, p_zoom);
  vec2 uv = q / vec2(ek_aspect(), 1.0) + 0.5;
  fragColor = vec4(texture(u_currentTexture, clamp(uv, 0.0, 1.0)).rgb, 1.0);
}`),
  ],
  ffmpeg: {
    graph: 'crop=iw/2:ih:0:0,split=2[%A%l][%A%r];[%A%r]hflip[%A%rf];[%A%l][%A%rf]hstack',
    fidelity: 'approximate',
    note: 'FFmpeg sólo puede espejar una mitad; los sectores polares no tienen equivalente.',
  },
});

const mirror = v({
  id: 'glitch.mirror',
  name: 'Espejo',
  category: 'glitch',
  order: 60,
  description: 'Duplica una mitad sobre la otra. Horizontal, vertical o las dos.',
  keywords: ['mirror', 'espejo', 'simetria', 'flip'],
  params: [en('mode', 'Eje', ['Horizontal', 'Vertical', 'Ambos'], 0)],
  passes: [
    pass(`uniform float p_mode;
void main() {
  vec2 uv = v_texCoord;
  int mode = int(p_mode + 0.5);
  if (mode == 0 || mode == 2) { if (uv.x > 0.5) uv.x = 1.0 - uv.x; }
  if (mode == 1 || mode == 2) { if (uv.y > 0.5) uv.y = 1.0 - uv.y; }
  fragColor = vec4(texture(u_currentTexture, uv).rgb, 1.0);
}`),
  ],
  ffmpeg: {
    graph: 'crop=iw/2:ih:0:0,split=2[%A%l][%A%r];[%A%r]hflip[%A%rf];[%A%l][%A%rf]hstack',
    fidelity: 'approximate',
    note: 'Sólo eje horizontal; vertical y ambos quedan en preview.',
  },
});

const snow = v({
  id: 'glitch.snow',
  name: 'Estática',
  category: 'glitch',
  order: 70,
  description: 'Nieve de televisión: motas blancas que cambian en cada frame, como una señal sin imagen.',
  keywords: ['snow', 'estatica', 'nieve', 'tv', 'static', 'ruido'],
  params: [
    f('amount', 'Intensidad', 0, 100, 50, { step: 1 }),
    f('size', 'Tamaño de grano', 1, 16, 3, { step: 1, unit: 'px' }),
  ],
  passes: [
    pass(`uniform float p_amount;
uniform float p_size;
void main() {
  vec3 base = texture(u_currentTexture, v_texCoord).rgb;
  vec2 cell = floor(v_texCoord * u_resolution / max(1.0, p_size));
  float n = ek_frame_noise(cell);
  float density = p_amount / 100.0 * 0.9;
  float speck = step(1.0 - density, n);
  fragColor = vec4(mix(base, vec3(speck), speck * density * 0.95), 1.0);
}`),
  ],
  ffmpeg: {
    chain: ['noise=alls={amount}:allf=t+u'],
    fidelity: 'approximate',
    note: 'El filtro noise genera estática uniforme gaussiana por canal; el shader dibuja motas blancas por celda con densidad controlada.',
  },
});

// Tomás del glitch.wave en export: el shader desplaza uv.x por fila con
// `sin(uv.y*freq*TAU + t*speed)*amp`; geq evalúa una expresión por píxel y
// `r/g/b(x,y)` remuestrean la entrada en el píxel desplazado. `format=gbrp`
// pasa a RGB planar full-res (el desplazamiento es idéntico por canal y no
// hay que pelear con la resolución de los planos de croma). `T` es el
// timestamp en segundos del frame, igual que `u_time` del shader.
const WAVE_GEQ_X =
  'clip(X+sin(Y/H*{frequency}*6.28318530718+T*{speed})*{amplitude}*W,0,W-1)';
const waveGraph =
  'format=gbrp,geq=' +
  `r='r(${WAVE_GEQ_X},Y)':g='g(${WAVE_GEQ_X},Y)':b='b(${WAVE_GEQ_X},Y)'`;

const wave = v({
  id: 'glitch.wave',
  name: 'Onda',
  category: 'glitch',
  order: 70,
  description: 'Desplaza las filas con una sinusoide viajera. Deformación líquida suave.',
  keywords: ['wave', 'onda', 'deformacion', 'liquido'],
  params: [
    f('amplitude', 'Amplitud', 0, 0.2, 0.02, { step: 0.002 }),
    f('frequency', 'Frecuencia', 1, 30, 8, { step: 0.5 }),
    f('speed', 'Velocidad', -5, 5, 1.5, { step: 0.1 }),
  ],
  passes: [
    pass(`uniform float p_amplitude;
uniform float p_frequency;
uniform float p_speed;
void main() {
  vec2 uv = v_texCoord;
  uv.x += sin(uv.y * p_frequency * EK_TAU + u_time * p_speed) * p_amplitude;
  fragColor = vec4(texture(u_currentTexture, clamp(uv, 0.0, 1.0)).rgb, 1.0);
}`),
  ],
  ffmpeg: {
    graph: waveGraph,
    fidelity: 'approximate',
    note: 'geq remuestrea por píxel con interpolación bilineal (como texture() del shader); el eje Y puede venir espejado y el coste es alto en cuadros grandes.',
  },
});

// ──────────────────────────────────────────────────────────── Retro ──

const vhs = v({
  id: 'retro.vhs',
  name: 'VHS',
  category: 'retro',
  order: 10,
  description: 'Cinta gastada: croma desplazado, ruido, líneas y una banda de tracking que sube.',
  keywords: ['vhs', 'cinta', 'retro', 'analogico', 'noventa'],
  params: [
    f('amount', 'Intensidad', 0, 1, 0.6, { step: 0.01 }),
    f('noise', 'Ruido', 0, 1, 0.3, { step: 0.01 }),
    f('tracking', 'Tracking', 0, 1, 0.4, { step: 0.01 }),
    f('speed', 'Velocidad', 0, 3, 0.6, { step: 0.05 }),
  ],
  passes: [
    pass(`uniform float p_amount;
uniform float p_noise;
uniform float p_tracking;
uniform float p_speed;
void main() {
  vec2 uv = v_texCoord;
  float band = fract(uv.y + u_time * p_speed * 0.15);
  float tear = smoothstep(0.02, 0.0, abs(band - 0.5)) * p_tracking * 0.05;
  uv.x += tear;
  float shift = p_amount * 0.006;
  vec3 c;
  c.r = ek_sample(uv + vec2(shift, 0.0)).r;
  c.g = ek_sample(uv).g;
  c.b = ek_sample(uv - vec2(shift, 0.0)).b;
  c = ek_saturate(c, 1.0 - p_amount * 0.25);
  float line = sin(uv.y * u_resolution.y * 1.2) * 0.5 + 0.5;
  c *= 1.0 - (1.0 - line) * p_amount * 0.25;
  c += (ek_frame_noise(uv * u_resolution) - 0.5) * p_noise * 0.3;
  c += vec3(0.02, 0.01, 0.0) * p_amount;
  fragColor = vec4(c, 1.0);
}`),
  ],
  ffmpeg: {
    chain: [
      'rgbashift=rh=4:bh=-4',
      'noise=alls=16:allf=t+u',
      'drawgrid=w=iw:h=3:t=1:c=black@0.2',
      eqCompat({ saturation: '0.85', contrast: '1.05' }),
    ],
    fidelity: 'approximate',
    note: 'La banda de tracking y el desgarro no se reproducen en FFmpeg.',
  },
});

const sepia = v({
  id: 'retro.sepia',
  name: 'Sepia',
  category: 'retro',
  order: 20,
  description: 'Viraje a marrón de imprenta, con intensidad regulable.',
  keywords: ['sepia', 'marron', 'vintage', 'antiguo'],
  params: [f('amount', 'Mezcla', 0, 1, 1, { step: 0.01 })],
  passes: [
    pass(`uniform float p_amount;
void main() {
  vec3 c = texture(u_currentTexture, v_texCoord).rgb;
  float l = ek_luma(c);
  vec3 toned = vec3(l * 1.07, l * 0.86, l * 0.62);
  fragColor = vec4(mix(c, toned, p_amount), 1.0);
}`),
  ],
  ffmpeg: {
    chain: [
      'colorchannelmixer=rr=0.393:rg=0.769:rb=0.189:gr=0.349:gg=0.686:gb=0.168:br=0.272:bg=0.534:bb=0.131',
    ],
    fidelity: 'approximate',
    note: 'La matriz clásica de sepia no respeta la mezcla parcial.',
  },
});

const grayscale = v({
  id: 'retro.grayscale',
  name: 'Blanco y negro',
  category: 'retro',
  order: 30,
  description: 'Luminancia Rec.709 con mezcla parcial y tinte opcional.',
  keywords: ['grayscale', 'blanco y negro', 'monocromo', 'bw'],
  params: [
    f('amount', 'Mezcla', 0, 1, 1, { step: 0.01 }),
    col('tint', 'Tinte', '#ffffff'),
  ],
  passes: [
    pass(`uniform float p_amount;
uniform vec3 p_tint;
void main() {
  vec3 c = texture(u_currentTexture, v_texCoord).rgb;
  vec3 mono = vec3(ek_luma(c)) * p_tint;
  fragColor = vec4(mix(c, mono, p_amount), 1.0);
}`),
  ],
  ffmpeg: { chain: ['hue=s=0'], fidelity: 'exact' },
});

const super8 = v({
  id: 'retro.super8',
  name: 'Súper 8',
  category: 'retro',
  order: 40,
  description: 'Cálido, con grano, parpadeo de exposición y bamboleo de compuerta.',
  keywords: ['super 8', 'pelicula', 'granо', 'parpadeo', 'film'],
  params: [
    f('amount', 'Intensidad', 0, 1, 0.7, { step: 0.01 }),
    f('flicker', 'Parpadeo', 0, 1, 0.35, { step: 0.01 }),
    f('weave', 'Bamboleo', 0, 1, 0.4, { step: 0.01 }),
  ],
  passes: [
    pass(`uniform float p_amount;
uniform float p_flicker;
uniform float p_weave;
void main() {
  vec2 uv = v_texCoord;
  float t = u_time;
  uv += vec2(ek_noise(vec2(t * 3.0, 0.0)) - 0.5, ek_noise(vec2(0.0, t * 2.4)) - 0.5) * p_weave * 0.004;
  vec3 c = ek_sample(uv);
  c *= vec3(1.06, 1.0, 0.9);
  c += vec3(0.03, 0.01, -0.01) * p_amount;
  float flick = 1.0 + (ek_hash11(floor(t * 18.0)) - 0.5) * p_flicker * 0.25;
  c *= flick;
  c += (ek_frame_noise(uv * u_resolution) - 0.5) * p_amount * 0.18;
  c *= ek_vignette(uv, p_amount * 0.6, 0.6);
  fragColor = vec4(c, 1.0);
}`),
  ],
  ffmpeg: {
    chain: [
      'colorbalance=rs=0.06:gs=0.01:bs=-0.05',
      'noise=alls=22:allf=t',
      'vignette=PI/4.5',
      eqCompat({ saturation: '0.9', contrast: '1.08' }),
    ],
    fidelity: 'approximate',
    note: 'El parpadeo y el bamboleo de compuerta son temporales y no se reproducen.',
  },
});

const grain = v({
  id: 'retro.grain',
  name: 'Grano',
  category: 'retro',
  order: 50,
  description: 'Ruido fotográfico con tamaño de grano y animación temporal.',
  keywords: ['grain', 'grano', 'ruido', 'film'],
  params: [
    f('amount', 'Cantidad', 0, 100, 25, { step: 1 }),
    f('size', 'Tamaño', 0.5, 4, 1.4, { step: 0.1 }),
    b('animate', 'Animar', true),
  ],
  passes: [
    pass(`uniform float p_amount;
uniform float p_size;
uniform bool p_animate;
void main() {
  vec3 c = texture(u_currentTexture, v_texCoord).rgb;
  vec2 p = v_texCoord * u_resolution / max(0.2, p_size);
  float n = p_animate ? ek_frame_noise(p) : ek_noise(p);
  c += (n - 0.5) * (p_amount / 100.0) * 0.5;
  fragColor = vec4(c, 1.0);
}`),
  ],
  ffmpeg: { chain: ['noise=alls={amount}:allf=t'], fidelity: 'approximate' },
});

const crt = v({
  id: 'retro.crt',
  name: 'CRT',
  category: 'retro',
  order: 60,
  description: 'Tubo de rayos catódicos: curvatura, líneas, halo de fósforo y esquinas oscuras.',
  keywords: ['crt', 'tubo', 'monitor', 'retro', 'arcade'],
  params: [
    f('curve', 'Curvatura', 0, 0.5, 0.12, { step: 0.01 }),
    f('scanlines', 'Líneas', 0, 1, 0.4, { step: 0.01 }),
    f('glow', 'Halo', 0, 1, 0.35, { step: 0.01 }),
  ],
  passes: [
    pass(`uniform float p_curve;
uniform float p_scanlines;
uniform float p_glow;
void main() {
  vec2 uv = v_texCoord;
  vec2 c = (uv - 0.5) * 2.0;
  c *= 1.0 + p_curve * dot(c, c) * 0.35;
  vec2 warped = c * 0.5 + 0.5;
  vec3 color;
  if (warped.x < 0.0 || warped.x > 1.0 || warped.y < 0.0 || warped.y > 1.0) {
    color = vec3(0.0);
  } else {
    color = ek_sample(warped);
    vec3 halo = ek_blur9(warped, vec2(1.5 / u_resolution.x, 0.0));
    color = 1.0 - (1.0 - color) * (1.0 - halo * p_glow * 0.5);
  }
  float line = sin(warped.y * u_resolution.y * EK_PI) * 0.5 + 0.5;
  color *= 1.0 - (1.0 - line) * p_scanlines * 0.5;
  color *= ek_vignette(warped, 0.5, 0.55);
  fragColor = vec4(color, 1.0);
}`),
  ],
  ffmpeg: {
    chain: ['lenscorrection=k1=-0.08:k2=0', 'drawgrid=w=iw:h=2:t=1:c=black@0.2', 'vignette=PI/4.2'],
    fidelity: 'approximate',
    note: 'El halo de fósforo requiere un blend que la cadena simple no expresa.',
  },
});

// Parpadeo de proyector: el shader mezcla una senoide de `speed` Hz con un
// componente irregular por frame; el export reproduce sólo la parte
// determinista con dos armónicos en geq (T = segundos del frame).
const FLICKER_GEQ_LUM =
  `clip(lum(X,Y)*(1+({amount})*(0.6*sin(T*{speed}*6.28318530718)` +
  `+0.4*sin(T*{speed}*6.28318530718*2.7+1.3))),0,255)`;

const flicker = v({
  id: 'retro.flicker',
  name: 'Parpadeo',
  category: 'retro',
  order: 70,
  description: 'Parpadeo irregular de proyector de cine viejo: ideal para look vintage y FOUND footage.',
  keywords: ['flicker', 'parpadeo', 'cine', 'proyector', 'vintage', 'found footage'],
  params: [
    f('amount', 'Intensidad', 0, 0.5, 0.15, { step: 0.01 }),
    f('speed', 'Velocidad', 1, 24, 12, { step: 0.5, unit: 'Hz' }),
  ],
  passes: [
    pass(`uniform float p_amount;
uniform float p_speed;
void main() {
  float t = u_time * p_speed * 6.28318530718;
  float wave = 0.6 * sin(t) + 0.4 * sin(t * 2.7 + 1.3);
  float jitter = (ek_noise(vec2(u_time * p_speed * 13.7, 4.2)) - 0.5) * 0.8;
  vec3 c = texture(u_currentTexture, v_texCoord).rgb;
  fragColor = vec4(c * (1.0 + p_amount * (wave + jitter)), 1.0);
}`),
  ],
  ffmpeg: {
    chain: [`geq=lum='${FLICKER_GEQ_LUM}':cb='cb(X,Y)':cr='cr(X,Y)'`],
    fidelity: 'approximate',
    note: 'El shader suma un jitter irregular por frame; el export queda con los dos armónicos deterministas (T en segundos).',
  },
});

// Polvo y rayaduras de película: el shader dibuja líneas verticales
// brillantes en columnas pseudoaleatorias por frame + motas; el export
// combina `noise` (polvo) con un `geq` que suma líneas en columnas con
// hash determinista por frame (`N` = número de frame de entrada).
// `random(X+N*7919)` da un hash por (columna, frame): líneas que aparecen
// y desaparecen, como las rayaduras reales de una copia de película.
const DUST_GEQ_LUM =
  `clip(lum(X,Y)+if(gt(random(X+N*7919),0.996),{scratches}*170,0),0,255)`;

const dust = v({
  id: 'retro.dust',
  name: 'Polvo y rayas',
  category: 'retro',
  order: 80,
  description: 'Artefactos de película vieja: polvo, motas y rayaduras verticales que cambian en cada frame.',
  keywords: ['dust', 'polvo', 'rayas', 'rayaduras', 'film', 'pelicula', 'scratches'],
  params: [
    f('scratches', 'Rayaduras', 0, 1, 0.4, { step: 0.01 }),
    f('dust', 'Polvo', 0, 100, 30, { step: 1 }),
  ],
  passes: [
    pass(`uniform float p_scratches;
uniform float p_dust;
void main() {
  vec3 c = texture(u_currentTexture, v_texCoord).rgb;
  float col = floor(v_texCoord.x * u_resolution.x);
  float scratch = step(0.994, ek_frame_noise(vec2(col * 13.7, 3.1))) * p_scratches;
  c += vec3(scratch * 0.65);
  vec2 cell = floor(v_texCoord * u_resolution / 2.0);
  float mote = step(0.985, ek_frame_noise(cell)) * (p_dust / 100.0);
  c = mix(c, vec3(0.85, 0.8, 0.7), mote * 0.6);
  fragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`),
  ],
  ffmpeg: {
    chain: [
      'noise=alls={dust}:allf=t+u',
      `geq=lum='${DUST_GEQ_LUM}':cb='cb(X,Y)':cr='cr(X,Y)'`,
    ],
    fidelity: 'approximate',
    note: 'El polvo usa el ruido uniforme del filtro noise (multicanal) y las rayas un hash por columna; el shader dibuja motas cálidas.',
  },
});

// Bleach bypass: look de post-proceso químico que salta la etapa de color —
// desatura fuerte, contraste alto y dominancia plateada. El tinte cálido/
// frío del preview no tiene equivalente simple en la cadena, así que el
// export escala saturación y contraste con `amount` vía lutyuv.
const bleach = v({
  id: 'retro.bleach',
  name: 'Bleach bypass',
  category: 'retro',
  order: 90,
  description: 'Efecto de laboratorio fotográfico: colores lavados a plata, contraste alto, look épico.',
  keywords: ['bleach', 'bypass', 'blanqueo', 'film', 'plateado', 'desaturado'],
  params: [f('amount', 'Intensidad', 0, 1, 0.7, { step: 0.01 })],
  passes: [
    pass(`uniform float p_amount;
void main() {
  vec3 c = texture(u_currentTexture, v_texCoord).rgb;
  float l = ek_luma(c);
  vec3 g = vec3(l * vec3(1.06, 1.0, 0.9));
  c = mix(c, g, p_amount * 0.75);
  c = (c - 0.5) * (1.0 + p_amount * 0.2) + 0.5;
  fragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`),
  ],
  ffmpeg: {
    chain: [
      eqCompat({ saturation: '0.1+{amount}*0.5', contrast: '1.0+{amount}*0.15' }),
    ],
    fidelity: 'approximate',
    note: 'El export reproduce la desaturación y el contraste; el tinte plateado cálido del shader no se exporta.',
  },
});

// ─────────────────────────────────────────────────────────── Impacto ──

const shake = v({
  id: 'impact.shake',
  name: 'Sacudida',
  category: 'impact',
  order: 10,
  description: 'Cámara que tiembla con ruido de baja frecuencia. Para golpes y bajadas de beat.',
  keywords: ['shake', 'sacudida', 'camara', 'golpe', 'beat'],
  params: [
    f('amount', 'Fuerza', 0, 40, 8, { step: 0.5, unit: 'px' }),
    f('speed', 'Velocidad', 0.5, 30, 8, { step: 0.5 }),
  ],
  passes: [
    pass(`uniform float p_amount;
uniform float p_speed;
void main() {
  float t = u_time * p_speed;
  vec2 offset = vec2(ek_noise(vec2(t, 0.0)), ek_noise(vec2(0.0, t + 17.0))) - 0.5;
  vec2 uv = v_texCoord + offset * 2.0 * p_amount / u_resolution;
  fragColor = vec4(texture(u_currentTexture, clamp(uv, 0.0, 1.0)).rgb, 1.0);
}`),
  ],
  ffmpeg: {
    chain: [
      'crop=iw-40:ih-40:20+12*sin(t*7):20+8*cos(t*5)',
      'scale=w=iw+40:h=ih+40',
    ],
    fidelity: 'approximate',
    note: 'FFmpeg usa senos fijos; el shader usa ruido.',
  },
});

const strobe = v({
  id: 'impact.strobe',
  name: 'Estrobo',
  category: 'impact',
  order: 20,
  description: 'Pulsos de exposición a una frecuencia dada, con profundidad regulable.',
  keywords: ['strobe', 'estrobo', 'flash', 'pulso', 'beat'],
  params: [
    f('rate', 'Frecuencia', 0.5, 20, 4, { step: 0.5, unit: 'Hz' }),
    f('depth', 'Profundidad', 0, 1, 0.7, { step: 0.01 }),
    f('duty', 'Duración', 0.05, 0.9, 0.35, { step: 0.01 }),
  ],
  passes: [
    pass(`uniform float p_rate;
uniform float p_depth;
uniform float p_duty;
void main() {
  vec3 c = texture(u_currentTexture, v_texCoord).rgb;
  float phase = fract(u_time * p_rate);
  float on = step(phase, p_duty);
  c *= mix(1.0 - p_depth, 1.0 + p_depth * 0.6, on);
  fragColor = vec4(c, 1.0);
}`),
  ],
  ffmpeg: {
    chain: [eqCompat({ brightness: '0.3', enable: 'lt(mod(t*{rate},1),{duty})' })],
    fidelity: 'approximate',
    note: 'El pulso se aplica como corrimiento de brillo, no como escala.',
  },
});

const zoomPulse = v({
  id: 'impact.zoom_pulse',
  name: 'Zoom punch',
  category: 'impact',
  order: 30,
  description: 'Golpe de zoom periódico alrededor del centro. El recurso de los edits con beat.',
  keywords: ['zoom', 'punch', 'beat', 'pulso'],
  params: [
    f('amount', 'Fuerza', 0, 0.4, 0.08, { step: 0.005 }),
    f('rate', 'Frecuencia', 0.25, 8, 2, { step: 0.25, unit: 'Hz' }),
    v2('center', 'Centro', 0, 1, [0.5, 0.5]),
  ],
  passes: [
    pass(`uniform float p_amount;
uniform float p_rate;
uniform vec2 p_center;
void main() {
  float phase = fract(u_time * p_rate);
  float punch = exp(-phase * 6.0) * p_amount;
  vec2 uv = p_center + (v_texCoord - p_center) / (1.0 + punch);
  fragColor = vec4(texture(u_currentTexture, clamp(uv, 0.0, 1.0)).rgb, 1.0);
}`),
  ],
  ffmpeg: {
    graph:
      'split=2[%A%o][%A%z];' +
      "[%A%z]scale=w='trunc(iw*(1+{amount}*exp(-6*(t*{rate}-floor(t*{rate}))))/2)*2':" +
      "h='trunc(ih*(1+{amount}*exp(-6*(t*{rate}-floor(t*{rate}))))/2)*2':eval=frame[%A%zs];" +
      "[%A%o][%A%zs]overlay=x='{center.x}*(W-w)':y='{center.y}*(H-h)':eval=frame:format=auto",
    fidelity: 'approximate',
    note: 'El punch se aproxima escalando una copia del frame y centrándola sobre el original; el muestreo no es bilineal como el shader.',
  },
});

const trail = v({
  id: 'impact.trail',
  name: 'Estela',
  category: 'impact',
  order: 40,
  description: 'Arrastra los últimos frames reales sobre el actual. Motion trail de verdad.',
  keywords: ['trail', 'estela', 'motion', 'retention'],
  params: [
    i('frames', 'Frames', 2, 12, 5),
    f('intensity', 'Intensidad', 0, 1, 0.6, { step: 0.01 }),
  ],
  passes: [
    // Estela temporal real: mezcla el frame actual con los hasta 4 frames
    // fuente anteriores (`u_hist0..3`, cronológicos). `frames` estira la
    // cola de decaimiento (tope honesto en 5 porque la historia guarda 4);
    // `intensity` escala todos los pesos. Reemplaza al smear espacial
    // anterior — ahora es el mismo concepto que tmix del export.
    pass(`uniform sampler2D u_hist0;
uniform sampler2D u_hist1;
uniform sampler2D u_hist2;
uniform sampler2D u_hist3;
uniform float u_histCount;
uniform float p_intensity;
uniform int p_frames;
void main() {
  vec3 cur = texture(u_currentTexture, v_texCoord).rgb;
  // span: la cola de la estela. frames>5 no agrega tomas (historia=4) pero
  // sí afloja el decaimiento — se documenta en la nota del manifiesto.
  float span = clamp(float(p_frames), 2.0, 5.0);
  vec3 acc = cur;
  float wsum = 0.0;
  vec3 h0 = texture(u_hist0, v_texCoord).rgb;
  float w0 = p_intensity * (1.0 - 1.0 / span) * step(0.5, u_histCount);
  acc += w0 * h0; wsum += w0;
  vec3 h1 = texture(u_hist1, v_texCoord).rgb;
  float w1 = p_intensity * (1.0 - 2.0 / span) * step(1.5, u_histCount);
  acc += w1 * h1; wsum += w1;
  vec3 h2 = texture(u_hist2, v_texCoord).rgb;
  float w2 = p_intensity * (1.0 - 3.0 / span) * step(2.5, u_histCount);
  acc += w2 * h2; wsum += w2;
  vec3 h3 = texture(u_hist3, v_texCoord).rgb;
  float w3 = p_intensity * (1.0 - 4.0 / span) * step(3.5, u_histCount);
  acc += w3 * h3; wsum += w3;
  fragColor = vec4(acc / max(1.0, 1.0 + wsum), 1.0);
}`),
  ],
  ffmpeg: {
    chain: ['tmix=frames={frames}:weights=1'],
    fidelity: 'approximate',
    note: 'tmix promedia N frames con peso 1; el preview mezcla hasta 4 tomas reales con decaimiento lineal (historia=4).',
  },
});

// Líneas de velocidad radiales (look anime/manga de impacto): el shader
// dibuja `count` rayos desde el centro con caída por distancia y
// parpadeo temporal; el export reproduce el patrón en el plano de luma
// con `geq` (`atan2`/`hypot`/`pow`/`abs` — coordenadas normalizadas por
// alto para que el abanico sea isotrópico).
const SPEED_NX = '((X+0.5)/W-0.5)';
const SPEED_NY = '((Y+0.5)/H-0.5)';
const SPEED_ANG = `atan2(${SPEED_NY},${SPEED_NX}*(W/H))`;
const SPEED_DIST = `hypot(${SPEED_NY},${SPEED_NX}*(W/H))`;
const SPEED_LINES = `pow(abs(sin(${SPEED_ANG}*{count}*0.5)),6)`;
const SPEED_MASK =
  `clip(({reach}-${SPEED_DIST})/({reach}*0.45),0,1)*clip((${SPEED_DIST}-0.03)/0.12,0,1)`;
const SPEED_LUM = `clip(lum(X,Y)+{intensity}*200*${SPEED_LINES}*${SPEED_MASK},0,255)`;

const speedLines = v({
  id: 'impact.speed_lines',
  name: 'Líneas de velocidad',
  category: 'impact',
  order: 50,
  description: 'Líneas radiales blancas desde el centro: el golpe visual de los impactos anime y manga.',
  keywords: ['speed', 'lines', 'velocidad', 'radial', 'anime', 'manga', 'impacto'],
  params: [
    i('count', 'Líneas', 8, 64, 24),
    f('intensity', 'Intensidad', 0, 1, 0.6, { step: 0.01 }),
    f('reach', 'Alcance', 0.4, 1.5, 1.0, { step: 0.05 }),
  ],
  passes: [
    pass(`uniform float p_count;
uniform float p_intensity;
uniform float p_reach;
void main() {
  vec3 c = texture(u_currentTexture, v_texCoord).rgb;
  vec2 d = (v_texCoord - 0.5) * vec2(ek_aspect(), 1.0);
  float r = length(d) / max(0.001, 0.5 * ek_aspect());
  float ang = atan(d.y, d.x);
  float lines = pow(abs(sin(ang * p_count * 0.5)), 6.0);
  float mask = smoothstep(p_reach, p_reach * 0.55, r) * smoothstep(0.02, 0.12, r);
  float flick = 0.7 + 0.3 * sin(u_time * 24.0 + ang * 2.0);
  fragColor = vec4(c + vec3(lines * mask * flick * p_intensity * 0.8), 1.0);
}`),
  ],
  ffmpeg: {
    chain: [`geq=lum='${SPEED_LUM}':cb='cb(X,Y)':cr='cr(X,Y)'`],
    fidelity: 'approximate',
    note: 'El export suma las líneas sólo al plano de luma (streaks blanquecinos); el shader las suma en RGB con parpadeo temporal.',
  },
});

// ─────────────────────────────────────────────────────────── Croma ──

const chroma = v({
  id: 'keying.chroma',
  name: 'Croma',
  category: 'keying',
  order: 10,
  description: 'Quita un color de fondo con tolerancia, suavizado de borde y supresión de derrame.',
  keywords: ['chroma', 'green screen', 'fondo', 'keying', 'pantalla'],
  params: [
    col('key', 'Color clave', '#00ff00'),
    f('similarity', 'Similitud', 0, 1, 0.3, { step: 0.01 }),
    f('smoothness', 'Suavizado', 0, 1, 0.1, { step: 0.01 }),
    f('spill', 'Derrame', 0, 1, 0.6, { step: 0.01 }),
  ],
  passes: [
    pass(`uniform vec3 p_key;
uniform float p_similarity;
uniform float p_smoothness;
uniform float p_spill;
void main() {
  vec4 src = texture(u_currentTexture, v_texCoord);
  vec3 c = src.rgb;
  float distanceToKey = length(c - p_key);
  float alpha = smoothstep(p_similarity, p_similarity + max(0.001, p_smoothness), distanceToKey);
  float greenExcess = max(0.0, c.g - max(c.r, c.b));
  c.g -= greenExcess * p_spill;
  fragColor = vec4(c, src.a * alpha);
}`),
  ],
  ffmpeg: {
    chain: ['chromakey=color={key}:similarity={similarity}:blend={smoothness}'],
    fidelity: 'approximate',
    note: 'chromakey trabaja en YUV; la supresión de derrame se omite.',
  },
});

// Clave por luminancia: recorta fondos blancos/negros por brillo, no por
// color. El shader hace smoothstep sobre la luma; el export usa `geq` con
// plano alpha en yuva420p — la rampa del export es lineal (aproximación
// del smoothstep cúbico del shader).
const luma = v({
  id: 'keying.luma',
  name: 'Clave por brillo',
  category: 'keying',
  order: 20,
  description: 'Quita un fondo por luminancia (blanco o negro) con banda de transición suave.',
  keywords: ['luma', 'key', 'clave', 'blanco', 'negro', 'fondo', 'luminancia'],
  params: [
    f('level', 'Umbral', 0.4, 1, 0.85, { step: 0.01 }),
    f('softness', 'Suavizado', 0, 0.4, 0.1, { step: 0.01 }),
  ],
  passes: [
    pass(`uniform float p_level;
uniform float p_softness;
void main() {
  vec4 src = texture(u_currentTexture, v_texCoord);
  float l = ek_luma(src.rgb);
  float a = 1.0 - smoothstep(p_level - p_softness, p_level + p_softness, l);
  fragColor = vec4(src.rgb, src.a * a);
}`),
  ],
  ffmpeg: {
    chain: [
      `format=yuva420p,geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='clip(({level}+{softness}-lum(X,Y)/255)/({softness}*2+0.001)*255,0,255)'`,
    ],
    fidelity: 'approximate',
    note: 'Clave sólo por luma alta (fondos claros); la rampa es lineal, no la smoothstep del shader.',
  },
});

// Refino de matte: erosionar (choke) o dilatar la máscara alfa un pixel
// por vecindad en cruz. En export se hace con geq sobre el plano alpha en
// yuva420p (`alpha(X,Y)` lee el alfa de entrada); `choke` positivo dilata,
// negativo erosiona, cero deja la máscara intacta.
const REFINE_DILATE =
  'max(max(alpha(X-1,Y),alpha(X+1,Y)),max(alpha(X,Y-1),alpha(X,Y+1)))';
const REFINE_ERODE =
  'min(min(alpha(X-1,Y),alpha(X+1,Y)),min(alpha(X,Y-1),alpha(X,Y+1)))';
const refine = v({
  id: 'keying.refine',
  name: 'Refinar máscara',
  category: 'keying',
  order: 30,
  description: 'Engrosa o adelgaza la máscara de croma/luma un pixel: limpia bordes duros del recorte.',
  keywords: ['refine', 'matte', 'choke', 'mascara', 'borde', 'keying', 'alpha'],
  params: [f('choke', 'Expansión', -1, 1, 0, { step: 0.05 })],
  passes: [
    pass(`uniform float p_choke;
void main() {
  vec2 px = 1.0 / u_resolution;
  vec4 c = texture(u_currentTexture, v_texCoord);
  float n0 = texture(u_currentTexture, v_texCoord + vec2(px.x, 0.0)).a;
  float n1 = texture(u_currentTexture, v_texCoord - vec2(px.x, 0.0)).a;
  float n2 = texture(u_currentTexture, v_texCoord + vec2(0.0, px.y)).a;
  float n3 = texture(u_currentTexture, v_texCoord - vec2(0.0, px.y)).a;
  float lo = min(min(n0, n1), min(n2, n3));
  float hi = max(max(n0, n1), max(n2, n3));
  float a = p_choke > 0.0 ? hi : p_choke < 0.0 ? lo : c.a;
  fragColor = vec4(c.rgb, a);
}`),
  ],
  ffmpeg: {
    chain: [
      `format=yuva420p,geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='if(eq({choke},0),alpha(X,Y),if(gt({choke},0),${REFINE_DILATE},${REFINE_ERODE}))'`,
    ],
    fidelity: 'approximate',
    note: 'Un pixel por lado en cruz (no 3x3 completo); el signo de choke decide dilatar o erosionar.',
  },
});

// ──────────────────────────────────────────────────────── Distorsión ──

// Tomás del distort.ripple en export: el shader calcula
// `uv = v_texCoord + normalize(p) * sin(length(p) * frequency - time * speed) * amplitude`;
// geq evalúa la misma cuenta por píxel y `r/g/b(x,y)` remuestrean la entrada.
// `format=gbrp` evita la resolución dual de los planos de croma y `T` es el
// timestamp en segundos del frame, igual que `u_time` del shader.
const RIPPLE_NX = '((X+0.5)/W-{center.x})';
const RIPPLE_NY = '((Y+0.5)/H-{center.y})';
const RIPPLE_D = `sqrt(${RIPPLE_NX}*${RIPPLE_NX}+${RIPPLE_NY}*${RIPPLE_NY})`;
const RIPPLE_WAVE = `sin(${RIPPLE_D}*{frequency}-T*{speed})*{amplitude}`;
const RIPPLE_SX = `clip(X+(${RIPPLE_NX}/(${RIPPLE_D}+0.000001))*${RIPPLE_WAVE}*W,0,W-1)`;
const RIPPLE_SY = `clip(Y+(${RIPPLE_NY}/(${RIPPLE_D}+0.000001))*${RIPPLE_WAVE}*H,0,H-1)`;
const rippleGraph =
  'format=gbrp,geq=' +
  `r='r(${RIPPLE_SX},${RIPPLE_SY})':g='g(${RIPPLE_SX},${RIPPLE_SY})':b='b(${RIPPLE_SX},${RIPPLE_SY})'`;

const ripple = v({
  id: 'distort.ripple',
  name: 'Ondulación',
  category: 'distort',
  order: 10,
  description: 'Anillos concéntricos que se expanden desde el centro, como una gota en el agua.',
  keywords: ['ripple', 'onda', 'agua', 'gota'],
  params: [
    f('amplitude', 'Amplitud', 0, 0.1, 0.015, { step: 0.001 }),
    f('frequency', 'Frecuencia', 5, 80, 30, { step: 1 }),
    f('speed', 'Velocidad', -10, 10, 3, { step: 0.5 }),
    v2('center', 'Centro', 0, 1, [0.5, 0.5]),
  ],
  passes: [
    pass(`uniform float p_amplitude;
uniform float p_frequency;
uniform float p_speed;
uniform vec2 p_center;
void main() {
  vec2 p = v_texCoord - p_center;
  float d = length(p);
  float wave = sin(d * p_frequency - u_time * p_speed) * p_amplitude;
  vec2 uv = v_texCoord + normalize(p + 1e-6) * wave;
  fragColor = vec4(texture(u_currentTexture, clamp(uv, 0.0, 1.0)).rgb, 1.0);
}`),
  ],
  ffmpeg: {
    graph: rippleGraph,
    fidelity: 'approximate',
    note: 'geq evalúa la misma ondulación radial por píxel y remuestrea con bilineal; el mapeo a v_texCoord puede diferir medio píxel y el coste es alto en cuadros grandes.',
  },
});

// Tomás del distort.twirl en export: el shader calcula
// `p = (v_texCoord - center) * (aspect,1)`, `d = length(p)`,
// `falloff = 1 - smoothstep(0, radius, d)` y remuestrea en
// `rotate(p, radians(angle)*falloff)/(aspect,1) + center`. geq repite la
// misma cuenta por píxel; con DX=X+0.5-center.x*W y DY=Y+0.5-center.y*H
// (p=(DX,DY)/H) las coordenadas de muestreo quedan
// `clip(c*DX - s*DY + center.x*W - 0.5, 0, W-1)` y la análoga en Y.
const TWIRL_DX = '(X+0.5-{center.x}*W)';
const TWIRL_DY = '(Y+0.5-{center.y}*H)';
const TWIRL_DIST = `sqrt(${TWIRL_DX}*${TWIRL_DX}+${TWIRL_DY}*${TWIRL_DY})/H`;
const TWIRL_T = `clip(${TWIRL_DIST}/max({radius},0.000001),0,1)`;
const TWIRL_FALLOFF = `(1-${TWIRL_T}*${TWIRL_T}*(3-2*${TWIRL_T}))`;
const TWIRL_ANG = `({angle}*0.017453292519943295)*${TWIRL_FALLOFF}`;
const TWIRL_CS = `cos(${TWIRL_ANG})`;
const TWIRL_SN = `sin(${TWIRL_ANG})`;
const TWIRL_SX = `clip(${TWIRL_CS}*${TWIRL_DX}-${TWIRL_SN}*${TWIRL_DY}+{center.x}*W-0.5,0,W-1)`;
const TWIRL_SY = `clip(${TWIRL_SN}*${TWIRL_DX}+${TWIRL_CS}*${TWIRL_DY}+{center.y}*H-0.5,0,H-1)`;
const twirlGraph =
  'format=gbrp,geq=' +
  `r='r(${TWIRL_SX},${TWIRL_SY})':g='g(${TWIRL_SX},${TWIRL_SY})':b='b(${TWIRL_SX},${TWIRL_SY})'`;

const twirl = v({
  id: 'distort.twirl',
  name: 'Remolino',
  category: 'distort',
  order: 20,
  description: 'Rota el frame con fuerza decreciente hacia el borde.',
  keywords: ['twirl', 'remolino', 'vortice', 'rotar'],
  params: [
    f('angle', 'Ángulo', -360, 360, 120, { step: 1, unit: '°' }),
    f('radius', 'Radio', 0.1, 1, 0.5, { step: 0.01 }),
    v2('center', 'Centro', 0, 1, [0.5, 0.5]),
  ],
  passes: [
    pass(`uniform float p_angle;
uniform float p_radius;
uniform vec2 p_center;
void main() {
  vec2 p = (v_texCoord - p_center) * vec2(ek_aspect(), 1.0);
  float d = length(p);
  float falloff = 1.0 - smoothstep(0.0, p_radius, d);
  vec2 rotated = ek_rotate(p, radians(p_angle) * falloff);
  vec2 uv = rotated / vec2(ek_aspect(), 1.0) + p_center;
  fragColor = vec4(texture(u_currentTexture, clamp(uv, 0.0, 1.0)).rgb, 1.0);
}`),
  ],
  ffmpeg: {
    graph: twirlGraph,
    fidelity: 'approximate',
    note: 'geq evalúa la misma rotación radial por píxel (smoothstep cúbico del radio) y remuestrea con bilineal; el mapeo a v_texCoord puede diferir medio píxel y el coste es alto en cuadros grandes.',
  },
});

const fisheye = v({
  id: 'distort.fisheye',
  name: 'Ojo de pez',
  category: 'distort',
  order: 30,
  description: 'Distorsión de barril con corrección opcional. Sirve para ojo de pez y para enderezar.',
  keywords: ['fisheye', 'barril', 'lente', 'distorsion'],
  params: [
    f('strength', 'Fuerza', -1, 1, 0.35, { step: 0.01 }),
    f('zoom', 'Zoom', 0.5, 2, 1, { step: 0.01 }),
  ],
  passes: [
    pass(`uniform float p_strength;
uniform float p_zoom;
void main() {
  vec2 p = ek_centered(v_texCoord);
  float r2 = dot(p, p);
  vec2 distorted = p * (1.0 + p_strength * r2) / max(0.05, p_zoom);
  vec2 uv = distorted / vec2(ek_aspect(), 1.0) + 0.5;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    fragColor = vec4(0.0, 0.0, 0.0, 1.0);
  } else {
    fragColor = vec4(texture(u_currentTexture, uv).rgb, 1.0);
  }
}`),
  ],
  ffmpeg: {
    chain: ['lenscorrection=k1={strength}:k2=0:i=bilinear'],
    fidelity: 'approximate',
    note: 'lenscorrection corrige el barril con su propio modelo; el zoom no aplica.',
  },
});

const lensCorrect = v({
  id: 'lens.correct',
  name: 'Corrección de lente',
  category: 'distort',
  order: 40,
  description:
    'Distorsión radial cuadrática (barril/almohadilla) con centro configurable. Es la misma familia que el lenscorrection del clip.',
  keywords: ['lente', 'lens', 'barril', 'almohadilla', 'distorsion', 'lenscorrection'],
  params: [
    f('k1', 'K1', -1, 1, 0, { step: 0.005 }),
    f('k2', 'K2', -1, 1, 0, { step: 0.005 }),
    f('cx', 'Centro X', 0, 1, 0.5, { step: 0.01 }),
    f('cy', 'Centro Y', 0, 1, 0.5, { step: 0.01 }),
  ],
  passes: [
    pass(`uniform float p_k1;
uniform float p_k2;
uniform float p_cx;
uniform float p_cy;
void main() {
  // Mismo modelo que distort.fisheye pero con centro propio y término k2.
  vec2 d = (v_texCoord - vec2(p_cx, p_cy)) * vec2(ek_aspect(), 1.0);
  float r2 = dot(d, d);
  float factor = 1.0 + p_k1 * r2 + p_k2 * r2 * r2;
  vec2 distorted = d * factor;
  vec2 uv = distorted / vec2(ek_aspect(), 1.0) + vec2(p_cx, p_cy);
  fragColor = vec4(ek_sample(uv), 1.0);
}`),
  ],
  ffmpeg: {
    chain: ['lenscorrection=k1={k1}:k2={k2}:cx={cx}:cy={cy}:i=bilinear'],
    fidelity: 'approximate',
    note: 'El shader aplica el polinomio radial directo; FFmpeg lo invierte. Con k1/k2 chicos la diferencia es leve.',
  },
});

const emboss = v({
  id: 'stylize.emboss',
  name: 'Relieve',
  category: 'stylize',
  order: 45,
  description: 'Bisel direccional: bordes en bajo relieve sobre fondo neutro, estilo moneda o piedra.',
  keywords: ['emboss', 'relieve', 'bisel', 'grabado'],
  params: [
    f('amount', 'Intensidad', 0, 4, 1, { step: 0.01 }),
    f('angle', 'Dirección', -180, 180, 45, { step: 1, unit: '°' }),
  ],
  passes: [
    pass(`uniform float p_amount;
uniform float p_angle;
void main() {
  vec2 dir = vec2(cos(radians(p_angle)), sin(radians(p_angle)));
  vec2 u = dir / u_resolution;
  vec2 v = vec2(-dir.y, dir.x) / u_resolution;
  float l00 = ek_luma(ek_sample(v_texCoord - u - v));
  float l10 = ek_luma(ek_sample(v_texCoord - u));
  float l20 = ek_luma(ek_sample(v_texCoord + u - v));
  float l01 = ek_luma(ek_sample(v_texCoord - v));
  float l21 = ek_luma(ek_sample(v_texCoord + v));
  float l02 = ek_luma(ek_sample(v_texCoord - u + v));
  float l12 = ek_luma(ek_sample(v_texCoord + u + v));
  float l22 = ek_luma(ek_sample(v_texCoord + u + v));
  // Sobel a lo largo de la dirección de luz (u) y perpendicular (v).
  float gx = -l00 - 2.0 * l10 - l20 + l02 + 2.0 * l12 + l22;
  float gy = -l00 - 2.0 * l01 - l02 + l20 + 2.0 * l21 + l22;
  float light = gx * dir.x + gy * dir.y;
  fragColor = vec4(vec3(clamp(0.5 + light * p_amount * 0.125, 0.0, 1.0)), 1.0);
}`),
  ],
  ffmpeg: {
    chain: ["convolution=0m='0 -1 -2 -1 1 1 2 1 0':1m='0 -1 -2 -1 1 1 2 1 0':2m='0 -1 -2 -1 1 1 2 1 0':0bias=0.5:1bias=0.5:2bias=0.5"],
    fidelity: 'approximate',
    note: 'El kernel de FFmpeg es fijo (luz desde arriba-izquierda); el shader permite rotar la dirección.',
  },
});

const matrix = v({
  id: 'color.matrix',
  name: 'Matrix',
  category: 'color',
  order: 45,
  description: 'Look digital verdoso de las películas Matrix: tinte verde sobre la imagen.',
  keywords: ['matrix', 'verde', 'digital', 'look'],
  params: [
    f('tint', 'Tinte', 0, 1, 0.7, { step: 0.01 }),
    f('contrast', 'Contraste', 0.5, 2, 1.15, { step: 0.01 }),
  ],
  passes: [
    pass(`uniform float p_tint;
uniform float p_contrast;
void main() {
  vec3 c = ek_sample(v_texCoord);
  vec3 green = vec3(c.r * 0.35, c.g * 1.25, c.b * 0.55);
  c = mix(c, green, p_tint * 0.75);
  fragColor = vec4((c - 0.5) * p_contrast + 0.5, 1.0);
}`),
  ],
  ffmpeg: {
    chain: ['colorchannelmixer=rr=0.4:gg=1.1:bb=0.5:gr=0:gb=0:br=0:bg=0:rg=0:rb=0', eqCompat({ contrast: '{contrast}' })],
    fidelity: 'approximate',
    note: 'FFmpeg aplica una matriz de canales fija + contraste; el shader mezcla el tinte por píxel.',
  },
});

const faded = v({
  id: 'color.faded',
  name: 'Mate / desvaído',
  category: 'color',
  order: 46,
  description: 'Look cinematográfico lavando negros y bajando contraste, como película vencida.',
  keywords: ['faded', 'mate', 'vintage', 'lavado', 'cine'],
  params: [
    f('lift', 'Elevación de negros', 0, 0.25, 0.08, { step: 0.005 }),
    f('contrast', 'Contraste', 0.4, 1.2, 0.85, { step: 0.01 }),
    f('saturation', 'Saturación', 0, 1.5, 0.9, { step: 0.01 }),
  ],
  passes: [
    pass(`uniform float p_lift;
uniform float p_contrast;
uniform float p_saturation;
void main() {
  vec3 c = ek_sample(v_texCoord);
  c = ek_saturate(c, p_saturation);
  fragColor = vec4((c - 0.5) * p_contrast + 0.5 + p_lift, 1.0);
}`),
  ],
  ffmpeg: {
    chain: [eqCompat({ contrast: '{contrast}', brightness: '{lift}', saturation: '{saturation}' })],
    fidelity: 'approximate',
    note: 'El brillo de la receta sube todo el histograma; el shader añade lift sólo a los negros.',
  },
});

const bulge = v({
  id: 'distort.bulge',
  name: 'Abombado',
  category: 'distort',
  order: 45,
  description: 'Abomba (positivo) o pellizca (negativo) el centro de la imagen, como una lente de aumento.',
  keywords: ['bulge', 'abombado', 'pincel', 'lente', 'zoom'],
  params: [
    f('strength', 'Fuerza', -1, 1, 0.4, { step: 0.01 }),
    f('radius', 'Radio', 0.1, 1, 0.6, { step: 0.01 }),
    v2('center', 'Centro', 0, 1, [0.5, 0.5]),
  ],
  passes: [
    pass(`uniform float p_strength;
uniform float p_radius;
uniform vec2 p_center;
void main() {
  vec2 d = (v_texCoord - p_center) * vec2(ek_aspect(), 1.0);
  float dist = length(d);
  float falloff = 1.0 - smoothstep(0.0, p_radius, dist);
  vec2 distorted = d * (1.0 + p_strength * falloff);
  vec2 uv = distorted / vec2(ek_aspect(), 1.0) + p_center;
  fragColor = vec4(ek_sample(uv), 1.0);
}`),
  ],
  ffmpeg: {
    chain: ['lenscorrection=k1={strength}:k2=0:i=bilinear'],
    fidelity: 'approximate',
    note: 'lenscorrection aplica su propio modelo de barril/almohadilla sobre todo el cuadro; el shader limita el efecto al radio elegido.',
  },
});

// Umbral en B/N: el shader hace smoothstep sobre luminancia; la receta
// lutyuv reproduce la rampa con la misma forma (t*t*(3-2*t)) y fija los
// planos de croma en 128 para que el resultado sea gris real, no una
// imagen en color con menos detalle.
const THRESHOLD_T = `clip((val-{level}*255)/({softness}*510)+0.5,0,1)`;
const THRESHOLD_Y = `clip(${THRESHOLD_T}*${THRESHOLD_T}*(3-2*${THRESHOLD_T})*255,0,255)`;

const threshold = v({
  id: 'stylize.threshold',
  name: 'Umbral B/N',
  category: 'stylize',
  order: 90,
  description: 'Corte binario de la imagen en blanco y negro: look de grabado, manga o documental duro.',
  keywords: ['threshold', 'umbral', 'blanco y negro', 'binario', 'grabado'],
  params: [
    f('level', 'Umbral', 0, 1, 0.5, { step: 0.01 }),
    f('softness', 'Suavidad', 0.01, 0.5, 0.06, { step: 0.005 }),
  ],
  passes: [
    pass(`uniform float p_level;
uniform float p_softness;
void main() {
  float l = ek_luma(texture(u_currentTexture, v_texCoord).rgb);
  float t = smoothstep(p_level - p_softness, p_level + p_softness, l);
  fragColor = vec4(vec3(t), 1.0);
}`),
  ],
  ffmpeg: {
    chain: [`lutyuv=y='${THRESHOLD_Y}':u='128':v='128'`],
    fidelity: 'approximate',
    note: 'La rampa es la misma cubic smoothstep, pero el plano Y de FFmpeg usa luma BT.601 y el shader Rec.709.',
  },
});

const cinemaBars = v({
  id: 'stylize.cinema_bars',
  name: 'Barras de cine',
  category: 'stylize',
  order: 95,
  description: 'Enmarca el cuadro con bandas negras arriba y abajo, formato cinemascope sin recortar.',
  keywords: ['letterbox', 'barras', 'cine', 'cinemascope', 'formato'],
  params: [f('bar', 'Altura', 0, 0.35, 0.12, { step: 0.005 })],
  passes: [
    pass(`uniform float p_bar;
void main() {
  vec3 c = texture(u_currentTexture, v_texCoord).rgb;
  float inside = step(p_bar, v_texCoord.y) * step(v_texCoord.y, 1.0 - p_bar);
  fragColor = vec4(c * inside, 1.0);
}`),
  ],
  ffmpeg: {
    chain: [
      `drawbox=x=0:y=0:w=iw:h='{bar}*ih':color=black:t=fill`,
      `drawbox=x=0:y='ih-{bar}*ih':w=iw:h='{bar}*ih':color=black:t=fill`,
    ],
    fidelity: 'exact',
  },
});

// Curvas de color: el enum replica los 11 presets del filtro `curves` de
// FFmpeg (0=none … 10=vintage) así `{preset}` sustituye el índice directo.
// El shader aproxima cada familia con operaciones tonales simples.
const curves = v({
  id: 'color.curves',
  name: 'Curvas',
  category: 'color',
  order: 95,
  description: 'Once curvas tonales estilo etalonaje: vintage, cruce de película, contrastes y negativos.',
  keywords: ['curvas', 'curves', 'etalonaje', 'vintage', 'color', 'preset'],
  params: [
    en('preset', 'Curva', [
      'Ninguna',
      'Negativo color',
      'Procesado cruzado',
      'Más oscuro',
      'Más contraste',
      'Más claro',
      'Contraste lineal',
      'Contraste medio',
      'Negativo B/N',
      'Contraste fuerte',
      'Vintage',
    ], 0),
  ],
  passes: [
    pass(`uniform float p_preset;
void main() {
  vec3 c = texture(u_currentTexture, v_texCoord).rgb;
  float l = ek_luma(c);
  float sc = l * l * (3.0 - 2.0 * l);
  int p = int(p_preset + 0.5);
  if (p == 1) {
    c = 1.0 - c;
    c = mix(c, vec3(dot(c, vec3(0.299, 0.587, 0.114))), 0.12);
    c = mix(c, vec3(l), 0.08);
  } else if (p == 2) {
    c *= vec3(1.06, 1.0, 0.9);
    c = mix(vec3(l), c, 1.15);
    c = (c - 0.5) * 1.1 + 0.5;
  } else if (p == 3) {
    c *= vec3(0.9, 0.88, 0.86);
    c = c * c * 0.85;
  } else if (p == 4 || p == 6 || p == 7 || p == 9) {
    float k = p == 9 ? 2.4 : p == 4 ? 1.5 : p == 7 ? 1.8 : 1.15;
    c = mix(c, sc, k * 0.45);
    c = (c - 0.5) * (1.0 + k * 0.18) + 0.5;
  } else if (p == 5) {
    c = 1.0 - (1.0 - c) * 0.88;
  } else if (p == 8) {
    c = vec3(1.0 - l);
  } else if (p == 10) {
    c = mix(vec3(l * 0.92 + 0.07), c * vec3(1.04, 0.99, 0.88), 0.55);
    c = (c - 0.5) * 0.9 + 0.5;
  }
  fragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`),
  ],
  ffmpeg: {
    chain: ['curves=preset={preset}'],
    fidelity: 'approximate',
    note: 'El export aplica la curva real del preset de FFmpeg; el shader aproxima cada familia con operaciones tonales simples.',
  },
});

// Balance de color por rangos: colorbalance de FFmpeg mueve R/G/B en
// sombras, medios y luceros por separado — el control de etalonaje que
// usa todo colorista. El shader pondera cada offset por una máscara de
// luminancia suave (sombras/medios/luceros).
const balance = v({
  id: 'color.balance',
  name: 'Balance de color',
  category: 'color',
  order: 96,
  description: 'Ajusta rojo, verde y azul por separado en sombras, medios y luceros.',
  keywords: ['balance', 'color', 'sombras', 'medios', 'luceros', 'etalonaje', 'split'],
  params: [
    f('rs', 'Sombras R', -1, 1, 0, { step: 0.01, group: 'Sombras' }),
    f('gs', 'Sombras G', -1, 1, 0, { step: 0.01, group: 'Sombras' }),
    f('bs', 'Sombras B', -1, 1, 0, { step: 0.01, group: 'Sombras' }),
    f('rm', 'Medios R', -1, 1, 0, { step: 0.01, group: 'Medios' }),
    f('gm', 'Medios G', -1, 1, 0, { step: 0.01, group: 'Medios' }),
    f('bm', 'Medios B', -1, 1, 0, { step: 0.01, group: 'Medios' }),
    f('rh', 'Luceros R', -1, 1, 0, { step: 0.01, group: 'Luceros' }),
    f('gh', 'Luceros G', -1, 1, 0, { step: 0.01, group: 'Luceros' }),
    f('bh', 'Luceros B', -1, 1, 0, { step: 0.01, group: 'Luceros' }),
  ],
  passes: [
    pass(`uniform float p_rs; uniform float p_gs; uniform float p_bs;
uniform float p_rm; uniform float p_gm; uniform float p_bm;
uniform float p_rh; uniform float p_gh; uniform float p_bh;
void main() {
  vec3 c = texture(u_currentTexture, v_texCoord).rgb;
  float l = ek_luma(c);
  float sh = 1.0 - smoothstep(0.0, 0.5, l);
  float hi = smoothstep(0.5, 1.0, l);
  float mid = max(0.0, 1.0 - sh - hi);
  c.r += p_rs * sh + p_rm * mid + p_rh * hi;
  c.g += p_gs * sh + p_gm * mid + p_gh * hi;
  c.b += p_bs * sh + p_bm * mid + p_bh * hi;
  fragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`),
  ],
  ffmpeg: {
    chain: [
      'colorbalance=rs={rs}:gs={gs}:bs={bs}:rm={rm}:gm={gm}:bm={bm}:rh={rh}:gh={gh}:bh={bh}',
    ],
    fidelity: 'approximate',
    note: 'Las máscaras de rango difieren: FFmpeg usa curvas de luminancia propias; el shader pondera con smoothstep.',
  },
});

// Ganancia por canal: colorchannelmixer con las ganancias diagonales
// (rr/gg/bb) — el ajuste más simple para empujar o contener un canal.
// El shader multiplica en RGB; el filtro trabaja sobre la matriz YUV.
const mixer = v({
  id: 'color.mixer',
  name: 'Ganancia por canal',
  category: 'color',
  order: 97,
  description: 'Amplifica o atenúa el rojo, verde y azul por separado, sin tocar la matiz.',
  keywords: ['mixer', 'canales', 'channel', 'rgb', 'ganancia', 'color'],
  params: [
    f('red', 'Rojo', 0, 2, 1, { step: 0.01 }),
    f('green', 'Verde', 0, 2, 1, { step: 0.01 }),
    f('blue', 'Azul', 0, 2, 1, { step: 0.01 }),
  ],
  passes: [
    pass(`uniform float p_red;
uniform float p_green;
uniform float p_blue;
void main() {
  vec3 c = texture(u_currentTexture, v_texCoord).rgb;
  fragColor = vec4(c * vec3(p_red, p_green, p_blue), 1.0);
}`),
  ],
  ffmpeg: {
    chain: ['colorchannelmixer=rr={red}:gg={green}:bb={blue}'],
    fidelity: 'approximate',
    note: 'El filtro opera sobre la matriz YUV (no es multiplicación RGB pura); el shader multiplica canal a canal.',
  },
});

export const VIDEO_EFFECTS: readonly EffectManifest[] = [
  exposure,
  contrast,
  saturation,
  temperature,
  gamma,
  hue,
  vibrance,
  duotone,
  grade,
  bloom,
  glow,
  halation,
  vignette,
  leak,
  flare,
  rays,
  gaussian,
  motionBlur,
  temporalBlur,
  zoomBlur,
  tiltShift,
  sharpen,
  edge,
  sketch,
  pixelate,
  halftone,
  posterize,
  oil,
  outline,
  rgbSplit,
  blockGlitch,
  scanline,
  digitalGlitch,
  kaleidoscope,
  mirror,
  snow,
  wave,
  vhs,
  sepia,
  grayscale,
  super8,
  grain,
  crt,
  flicker,
  dust,
  bleach,
  shake,
  strobe,
  zoomPulse,
  trail,
  speedLines,
  chroma,
  luma,
  refine,
  ripple,
  twirl,
  fisheye,
  lensCorrect,
  temporalDenoise,
  deband,
  bilateral,
  deinterlace,
  emboss,
  matrix,
  faded,
  bulge,
  threshold,
  cinemaBars,
  crosshatch,
  curves,
  balance,
  mixer,
];
