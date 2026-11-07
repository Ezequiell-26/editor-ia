import type { EffectManifest, FfmpegRecipe, GpuPass, ParamSpec } from '../types.ts';

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
    chain: ['eq=brightness={exposure}'],
    fidelity: 'approximate',
    note: 'eq aplica un corrimiento lineal, no una escala logarítmica por pasos.',
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
  ffmpeg: { chain: ['eq=contrast={contrast}'], fidelity: 'exact' },
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
  ffmpeg: { chain: ['eq=saturation={saturation}'], fidelity: 'exact' },
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
  ffmpeg: { chain: ['eq=gamma={gamma}'], fidelity: 'exact' },
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
    chain: ['eq=saturation=1+0.5*{amount}'],
    fidelity: 'approximate',
    note: 'eq satura parejo; el shader pondera por saturación previa.',
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
    chain: ['eq=brightness={exposure}:contrast={contrast}:saturation={saturation}',
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
});

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
    chain: ['smartblur=lr=3:ls=-0.6:lt=8'],
    fidelity: 'approximate',
    note: 'smartblur suaviza bordes; no acumula por planos de color.',
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
      'eq=saturation=0.85:contrast=1.05',
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
      'eq=saturation=0.9:contrast=1.08',
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
    chain: ["eq=brightness=0.3:enable='lt(mod(t*{rate},1),{duty})'"],
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
  description: 'Arrastra frames anteriores sobre el actual. Motion trail de toda la vida.',
  keywords: ['trail', 'estela', 'motion', 'retention'],
  params: [
    i('frames', 'Frames', 2, 12, 5),
    f('intensity', 'Intensidad', 0, 1, 0.6, { step: 0.01 }),
  ],
  passes: [
    pass(`uniform float p_intensity;
uniform int p_frames;
void main() {
  vec3 c = texture(u_currentTexture, v_texCoord).rgb;
  vec2 dir = vec2(p_intensity * 0.02, 0.0);
  int taps = clamp(p_frames, 2, 12);
  vec3 sum = c;
  float weight = 1.0;
  for (int i = 1; i < 12; i++) {
    if (i >= taps) break;
    float decay = 1.0 - float(i) / float(taps);
    sum += ek_sample(v_texCoord - dir * float(i)) * decay;
    weight += decay;
  }
  fragColor = vec4(sum / max(1.0, weight), 1.0);
}`),
  ],
  ffmpeg: {
    chain: ['tmix=frames={frames}:weights=1'],
    fidelity: 'approximate',
    note: 'El shader aproxima la estela en el espacio; tmix la acumula en el tiempo.',
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

// ──────────────────────────────────────────────────────── Distorsión ──

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
});

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
  vec2 p = ek_centered(v_texCoord - p_center);
  float d = length(p);
  float falloff = 1.0 - smoothstep(0.0, p_radius, d);
  vec2 rotated = ek_rotate(p, radians(p_angle) * falloff);
  vec2 uv = rotated / vec2(ek_aspect(), 1.0) + p_center;
  fragColor = vec4(texture(u_currentTexture, clamp(uv, 0.0, 1.0)).rgb, 1.0);
}`),
  ],
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
  gaussian,
  motionBlur,
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
  wave,
  vhs,
  sepia,
  grayscale,
  super8,
  grain,
  crt,
  shake,
  strobe,
  zoomPulse,
  trail,
  chroma,
  ripple,
  twirl,
  fisheye,
];
