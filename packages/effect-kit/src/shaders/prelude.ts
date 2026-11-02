/**
 * Piezas GLSL compartidas por todo el catálogo.
 *
 * El renderer arma cada programa como: encabezado + preludio + cuerpo del pass.
 * El preludio sólo expone funciones con prefijo `ek_` para no chocar nunca con
 * los nombres que declara un manifiesto (propio o importado).
 */

/** Quad de pantalla completa en coordenadas de clip space. */
export const VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec2 a_position;
out vec2 v_texCoord;
void main() {
  v_texCoord = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

const UNIFORMS = `uniform sampler2D u_currentTexture;
uniform sampler2D u_texture1;
uniform sampler2D u_texture2;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_timeUs;
uniform int u_frameIndex;
uniform float u_frameRate;`;

const TRANSITION_UNIFORMS = `uniform sampler2D u_fromTexture;
uniform sampler2D u_toTexture;
uniform float u_progress;`;

/**
 * Utilidades numéricas y de color. Se mantienen sin dependencias para que el
 * mismo preludio sirva a efectos y transiciones.
 */
export const COMMON_GLSL = `
const float EK_PI = 3.14159265359;
const float EK_TAU = 6.28318530718;

float ek_luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

vec3 ek_saturate(vec3 c, float amount) {
  return mix(vec3(ek_luma(c)), c, amount);
}

vec3 ek_rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

vec3 ek_hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

vec3 ek_hue_shift(vec3 c, float turns) {
  vec3 hsv = ek_rgb2hsv(c);
  hsv.x = fract(hsv.x + turns);
  return ek_hsv2rgb(hsv);
}

float ek_hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

float ek_hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float ek_noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = ek_hash21(i);
  float b = ek_hash21(i + vec2(1.0, 0.0));
  float c = ek_hash21(i + vec2(0.0, 1.0));
  float d = ek_hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float ek_fbm(vec2 p, int octaves) {
  float total = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 8; i++) {
    if (i >= octaves) break;
    total += ek_noise(p) * amplitude;
    p *= 2.02;
    amplitude *= 0.5;
  }
  return total;
}

vec2 ek_rotate(vec2 p, float angle) {
  float s = sin(angle);
  float c = cos(angle);
  return mat2(c, -s, s, c) * p;
}

float ek_aspect() { return u_resolution.x / max(1.0, u_resolution.y); }

/** Coordenada centrada y corregida por aspecto, útil para lentes y patrones. */
vec2 ek_centered(vec2 uv) {
  return (uv - 0.5) * vec2(ek_aspect(), 1.0);
}

float ek_vignette(vec2 uv, float amount, float softness) {
  float d = length(ek_centered(uv)) * 1.4142;
  float edge = smoothstep(1.0 - clamp(softness, 0.01, 1.0), 1.0, d);
  return 1.0 - edge * clamp(amount, 0.0, 1.0);
}

vec3 ek_sample(vec2 uv) {
  return texture(u_currentTexture, clamp(uv, vec2(0.0), vec2(1.0))).rgb;
}

/** Desenfoque gaussiano de 9 tomas a lo largo de dir (en UV). */
vec3 ek_blur9(vec2 uv, vec2 dir) {
  vec3 sum = ek_sample(uv) * 0.2270270270;
  sum += ek_sample(uv + dir * 1.3846153846) * 0.3162162162;
  sum += ek_sample(uv - dir * 1.3846153846) * 0.3162162162;
  sum += ek_sample(uv + dir * 3.2307692308) * 0.0702702703;
  sum += ek_sample(uv - dir * 3.2307692308) * 0.0702702703;
  return sum;
}

/** Ruido temporal reproducible: cambia por frame pero no parpadea al pausar. */
float ek_frame_noise(vec2 p) {
  return ek_hash21(p + vec2(float(u_frameIndex) * 17.31, float(u_frameIndex) * 7.77));
}

float ek_soft_clip(float x) { return clamp(x, 0.0, 1.0); }

vec3 ek_soft_clip3(vec3 c) { return clamp(c, 0.0, 1.0); }
`;

export function fragmentHeader(kind: 'video' | 'transition'): string {
  const uniforms = kind === 'transition' ? `${UNIFORMS}\n${TRANSITION_UNIFORMS}` : UNIFORMS;
  return `#version 300 es
precision highp float;
precision highp int;
in vec2 v_texCoord;
out vec4 fragColor;
${uniforms}
${COMMON_GLSL}`;
}
