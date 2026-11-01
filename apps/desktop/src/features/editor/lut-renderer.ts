import { lutTextureData, type CubeLut } from './lut-preview';
import { CURVE_LUT_SIZE, curvesEqual } from './curves-lut';
import type { ChromaKeyUniforms } from './chroma-key-preview';
import type { ColorWheelsUniforms } from './color-wheels-preview';

/**
 * Aplica LUTs 3D en la preview con WebGL2. El shader reproduce el orden del
 * export: la fuente ya viene graduada por CSS (`ctx.filter`), después se
 * mezclan el LUT del clip y el look global por intensidad, y el resto de los
 * efectos CSS (glow, grano, nitidez) sigue encima del canvas.
 */

export interface LutRenderStage {
  readonly lut: CubeLut;
  readonly intensity: number;
}

export interface LutRenderer {
  /** Dibuja el canvas fuente completo. Devuelve false si el frame no se pudo subir. */
  render(
    source: TexImageSource,
    width: number,
    height: number,
    stages: readonly LutRenderStage[],
    denoise?: number,
    vignette?: number,
    previous?: TexImageSource,
    temporal?: number,
    /** Segundo frame anterior para el componente temporal de atadenoise. */
    previous2?: TexImageSource,
  ): boolean;
  /**
   * Curvas del clip (tabla RGBA 256×1). Se aplican antes del LUT, como el
   * export. Pasar null las desactiva.
   */
  setCurve(table: Uint8Array | null): void;
  /**
   * Chroma key del clip: calcula el alfa con el UV de la fuente antes del
   * grade, como el export. Pasar null lo desactiva.
   */
  setChromaKey(key: ChromaKeyUniforms | null): void;
  /**
   * Ruedas de color (colorbalance) y gamma por canal. Pasar null las apaga.
   */
  setColorWheels(wheels: ColorWheelsUniforms | null): void;
  /**
   * Temperatura del clip: `colorbalance=rs=t·0.25:bs=−t·0.25` del export.
   * Se aplica después de las ruedas/gamma y antes de las curvas.
   */
  setTemperature(value: number): void;
  /**
   * Contraste del clip (1 = neutro): `colorlevels` del export, con la misma
   * fórmula lineal que CSS pero en el orden ruedas → gamma → contraste.
   */
  setContrast(value: number): void;
  /**
   * Saturación del clip (1 = neutro): matriz de `hue=s` del export con luma
   * BT.601. Se aplica después del contraste y antes de la temperatura.
   */
  setSaturation(value: number): void;
  /**
   * Giro de tono del clip en grados (`hue=h` del export, rotación Cb/Cr
   * BT.601). Se aplica después de la saturación y antes de la temperatura.
   */
  setHue(degrees: number): void;
  /** Ganancia por canal de `colorchannelmixer` (colorMatch del export). */
  setChannelGain(r: number, g: number, b: number): void;
  /** Matriz 3×3 (filas) de `huesaturation`; null la desactiva. */
  setHslMatrix(rows: readonly number[] | null, colorsMask?: number): void;
  /** Escala de grises del clip (`hue=s=0`, luma BT.601) después de curvas. */
  setGrayscale(value: boolean): void;
  /** Sepia del clip (`colorchannelmixer` del export) después de curvas. */
  setSepia(value: boolean): void;
  dispose(): void;
}

const VERTEX_SHADER = `#version 300 es
in vec2 a_position;
out vec2 v_uv;
void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp sampler3D;

uniform sampler2D u_source;
uniform sampler2D u_previous;
uniform bool u_hasPrevious;
uniform sampler2D u_previous2;
uniform bool u_hasPrevious2;
uniform float u_temporal;
uniform sampler2D u_curve;
uniform bool u_hasCurve;
uniform bool u_hasKey;
uniform vec2 u_keyUv;
uniform float u_keySimilarity;
uniform float u_keyBlend;
uniform bool u_hasWheels;
uniform vec3 u_lift;
uniform vec3 u_offset;
uniform vec3 u_gain;
uniform sampler2D u_gamma;
uniform bool u_hasGamma;
uniform float u_temperature;
uniform float u_contrast;
uniform float u_saturation;
uniform float u_hue;
uniform vec3 u_channelGain;
uniform mat3 u_hsl;
uniform bool u_hasHsl;
uniform int u_hslColors;
uniform float u_grayscale;
uniform float u_sepia;
uniform sampler3D u_lutA;
uniform sampler3D u_lutB;
uniform sampler2D u_lutA2d;
uniform sampler2D u_lutB2d;
uniform bool u_hasA;
uniform bool u_hasB;
uniform bool u_lutA1d;
uniform bool u_lutB1d;
uniform float u_intensityA;
uniform float u_intensityB;
uniform vec3 u_minA;
uniform vec3 u_maxA;
uniform vec3 u_minB;
uniform vec3 u_maxB;
uniform vec2 u_texel;
uniform float u_denoise;
uniform float u_vignette;

in vec2 v_uv;
out vec4 outColor;

vec3 applyLut3d(sampler3D lut, vec3 color, vec3 lo, vec3 hi, float intensity) {
  vec3 t = clamp((color - lo) / max(hi - lo, vec3(1e-6)), 0.0, 1.0);
  float size = float(textureSize(lut, 0).x);
  vec3 coord = (t * (size - 1.0) + 0.5) / size;
  vec3 graded = texture(lut, coord).rgb;
  return mix(color, graded, clamp(intensity, 0.0, 1.0));
}

vec3 applyLut2d(sampler2D lut, vec3 color, vec3 lo, vec3 hi, float intensity) {
  vec3 t = clamp((color - lo) / max(hi - lo, vec3(1e-6)), 0.0, 1.0);
  float size = float(textureSize(lut, 0).x);
  vec3 x = (t * (size - 1.0) + 0.5) / size;
  vec3 graded = vec3(
    texture(lut, vec2(x.r, 0.5)).r,
    texture(lut, vec2(x.g, 0.5)).g,
    texture(lut, vec2(x.b, 0.5)).b
  );
  return mix(color, graded, clamp(intensity, 0.0, 1.0));
}

/**
 * Curvas del clip: tabla de 256 entradas por canal (ya combina la curva
 * maestra después de la de cada canal, como el export).
 */
vec3 applyCurve(sampler2D curve, vec3 color) {
  vec3 x = (clamp(color, 0.0, 1.0) * 255.0 + 0.5) / 256.0;
  return vec3(
    texture(curve, vec2(x.r, 0.5)).r,
    texture(curve, vec2(x.g, 0.5)).g,
    texture(curve, vec2(x.b, 0.5)).b
  );
}

/**
 * Ruedas de color: fórmula de colorbalance de FFmpeg con ligereza max+min.
 * Sombras, medios y luces se ponderan y suman con escala 0.7.
 */
vec3 colorBalanceWith(vec3 lift, vec3 offset, vec3 gain, vec3 color) {
  float l = max(max(color.r, color.g), color.b) + min(min(color.r, color.g), color.b);
  const float a = 4.0;
  const float b = 0.333;
  const float scale = 0.7;
  float shadows = clamp((b - l) * a + 0.5, 0.0, 1.0);
  float mids = clamp((l - b) * a + 0.5, 0.0, 1.0) * clamp((1.0 - l - b) * a + 0.5, 0.0, 1.0);
  float highlights = clamp((l + b - 1.0) * a + 0.5, 0.0, 1.0);
  return clamp(
    color + (lift * shadows + offset * mids + gain * highlights) * scale,
    0.0,
    1.0
  );
}

vec3 colorBalance(vec3 color) {
  return colorBalanceWith(u_lift, u_offset, u_gain, color);
}

/**
 * Grade del clip en el orden del export: colorbalance (ruedas + brillo) →
 * gamma → curvas. Se usa también para graduar los vecinos del denoise y el
 * frame anterior del temporal, porque el export filtra la imagen ya graduada.
 */
vec3 gradeColor(vec3 color) {
  if (u_hasWheels) color = colorBalance(color);
  if (u_hasGamma) color = applyCurve(u_gamma, color);
  if (abs(u_contrast - 1.0) > 0.001) {
    // colorlevels del export: entrada o salida según c ≥ 1; equivalente a
    // 0.5 + c·(x−0.5), pero aplicado después de ruedas/gamma como el MP4.
    float c = clamp(u_contrast, 0.0, 3.0);
    if (c >= 1.0) {
      float low = clamp(0.5 - 0.5 / c, 0.0, 0.5);
      float high = clamp(0.5 + 0.5 / c, 0.5, 1.0);
      color = clamp((color - low) / max(0.0001, high - low), 0.0, 1.0);
    } else {
      float low = clamp(0.5 - 0.5 * c, 0.0, 0.5);
      float high = clamp(0.5 + 0.5 * c, 0.5, 1.0);
      color = clamp(low + color * (high - low), 0.0, 1.0);
    }
  }
  if (abs(u_saturation - 1.0) > 0.001) {
    // hue=s del export: luma BT.601 y escala de la diferencia por canal.
    float luma = dot(color, vec3(0.299, 0.587, 0.114));
    color = clamp(vec3(luma) + (color - vec3(luma)) * u_saturation, 0.0, 1.0);
  }
  if (abs(u_hue) > 0.0001) {
    // hue=h del export: rotación de Cb/Cr BT.601 alrededor de la luma.
    float luma = dot(color, vec3(0.299, 0.587, 0.114));
    float cb = -0.168736 * color.r - 0.331264 * color.g + 0.5 * color.b;
    float cr = 0.5 * color.r - 0.418688 * color.g - 0.081312 * color.b;
    float cosHue = cos(u_hue);
    float sinHue = sin(u_hue);
    float rotatedCb = cb * cosHue - cr * sinHue;
    float rotatedCr = cb * sinHue + cr * cosHue;
    color = clamp(
      vec3(
        luma + 1.402 * rotatedCr,
        luma - 0.344136 * rotatedCb - 0.714136 * rotatedCr,
        luma + 1.772 * rotatedCb
      ),
      0.0,
      1.0
    );
  }
  if (u_hasHsl) {
    // huesaturation del export: camino completo o selectivo por colores.
    vec3 mapped = clamp(u_hsl * color, 0.0, 1.0);
    if (u_hslColors == 63) {
      color = mapped;
    } else {
      vec3 q = color;
      float mx = max(max(q.r, q.g), q.b);
      float mn = min(min(q.r, q.g), q.b);
      int flags = (q.r >= mx ? 1 : 0) |
                  (q.r <= mn ? 8 : 0) |
                  (q.g >= mx ? 4 : 0) |
                  (q.g <= mn ? 32 : 0) |
                  (q.b >= mx ? 16 : 0) |
                  (q.b <= mn ? 2 : 0);
      if ((u_hslColors & flags) != 0) {
        float f = 0.0;
        if ((u_hslColors & 1) != 0) f = max(f, q.r - max(q.g, q.b));
        if ((u_hslColors & 2) != 0) f = max(f, min(q.r, q.g) - q.b);
        if ((u_hslColors & 4) != 0) f = max(f, q.g - max(q.r, q.b));
        if ((u_hslColors & 8) != 0) f = max(f, min(q.g, q.b) - q.r);
        if ((u_hslColors & 16) != 0) f = max(f, q.b - max(q.r, q.g));
        if ((u_hslColors & 32) != 0) f = max(f, min(q.r, q.b) - q.g);
        f = clamp(f * 100.0, 0.0, 1.0);
        color = mix(color, mapped, f);
      }
    }
  }
  if (any(greaterThan(abs(u_channelGain - vec3(1.0)), vec3(0.0005)))) {
    // colorchannelmixer=rr:gg:bb del colorMatch.
    color = clamp(color * u_channelGain, 0.0, 1.0);
  }
  if (abs(u_temperature) > 0.0001) {
    // La temperatura del export es un colorbalance sólo de sombras.
    color = colorBalanceWith(
      vec3(u_temperature * 0.25, 0.0, -u_temperature * 0.25),
      vec3(0.0),
      vec3(0.0),
      color
    );
  }
  if (u_hasCurve) color = applyCurve(u_curve, color);
  // Escala de grises y sepia del export van después de las curvas.
  if (u_grayscale > 0.5) {
    color = vec3(dot(color, vec3(0.299, 0.587, 0.114)));
  }
  if (u_sepia > 0.5) {
    color = clamp(
      vec3(
        dot(color, vec3(0.393, 0.769, 0.189)),
        dot(color, vec3(0.349, 0.686, 0.168)),
        dot(color, vec3(0.272, 0.534, 0.131))
      ),
      0.0,
      1.0
    );
  }
  return color;
}

/**
 * UV del píxel: FFmpeg recibe el frame en YUV limitado y lo compara contra el
 * UV de la clave en rango completo; el shader replica esa mezcla. El alfa se
 * calcula sobre la fuente sin graduar, porque el export hace el keying antes
 * de los efectos.
 */
vec2 chromaPixelUv(vec3 color) {
  float r = color.r * 255.0;
  float g = color.g * 255.0;
  float b = color.b * 255.0;
  float u = (128.0 - 0.148223 * r - 0.290993 * g + 0.439216 * b) / 255.0;
  float v = (128.0 + 0.439216 * r - 0.367788 * g - 0.071427 * b) / 255.0;
  return vec2(clamp(u, 0.0, 1.0), clamp(v, 0.0, 1.0));
}

float chromaAlpha(vec2 uv) {
  float diff = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      // FFmpeg replica el borde en las muestras fuera de cuadro.
      vec2 sampleUv = clamp(uv + vec2(float(x), float(y)) * u_texel, 0.0, 1.0);
      vec2 delta = chromaPixelUv(texture(u_source, sampleUv).rgb) - u_keyUv;
      diff += sqrt(dot(delta, delta) / 2.0);
    }
  }
  diff /= 9.0;
  if (u_keyBlend > 0.0001) {
    return clamp((diff - u_keySimilarity) / u_keyBlend, 0.0, 1.0);
  }
  return diff > u_keySimilarity ? 1.0 : 0.0;
}

/**
 * Denoise tipo sigma 5×5: promedia sólo vecinos parecidos al centro, así baja
 * el ruido en zonas planas y conserva los bordes. Aproxima removegrain del
 * export; atadenoise es temporal y acá se aproxima con dos frames anteriores.
 */
vec3 denoise(vec3 center, vec2 uv, float strength) {
  float threshold = mix(0.04, 0.25, strength);
  vec3 sum = center;
  float count = 1.0;
  for (int y = -2; y <= 2; y++) {
    for (int x = -2; x <= 2; x++) {
      if (x == 0 && y == 0) continue;
      vec2 offset = vec2(float(x), float(y)) * u_texel;
      vec2 sampleUv = clamp(uv + offset, u_texel * 0.5, vec2(1.0) - u_texel * 0.5);
      // El export aplica removegrain después del grade: los vecinos también
      // se gradúan antes de compararlos con el centro.
      vec3 sampleColor = gradeColor(texture(u_source, sampleUv).rgb);
      if (distance(sampleColor, center) <= threshold) {
        sum += sampleColor;
        count += 1.0;
      }
    }
  }
  vec3 filtered = sum / count;
  return mix(center, filtered, clamp(strength, 0.0, 1.0));
}

void main() {
  vec4 source = texture(u_source, v_uv);
  // Orden del export: grade → denoise (temporal + espacial) → viñeta → LUT.
  vec3 color = gradeColor(source.rgb);
  vec3 baseColor = color;
  if (u_hasPrevious && u_temporal > 0.001) {
    // Aproximación al componente temporal de atadenoise con dos frames previos:
    // sólo se mezcla si el píxel cambió menos que el umbral, para no dejar
    // estelas en movimiento. Los frames anteriores también se gradúan.
    vec3 previous = gradeColor(texture(u_previous, v_uv).rgb);
    float threshold = mix(0.03, 0.12, u_temporal);
    if (distance(previous, color) <= threshold) {
      color = mix(color, (color + previous) * 0.5, u_temporal * 0.8);
    }
    if (u_hasPrevious2 && u_temporal > 0.001) {
      vec3 previous2 = gradeColor(texture(u_previous2, v_uv).rgb);
      float threshold2 = mix(0.03, 0.12, u_temporal);
      if (distance(previous2, baseColor) <= threshold2) {
        color = mix(color, (color + previous2) * 0.5, u_temporal * 0.4);
      }
    }
  }
  if (u_denoise > 0.001) color = denoise(color, v_uv, u_denoise);
  if (u_vignette > 0.001) {
    // Fórmula de vf_vignette: factor = cos(angle·dnorm)^4 con dnorm la
    // distancia al centro dividida por hypot(w/2, h/2); ángulo PI/(5−4s)
    // acotado a PI/2, como el filtro del export.
    vec2 resolution = 1.0 / u_texel;
    vec2 pixel = floor(v_uv * resolution);
    vec2 delta = pixel - resolution * 0.5;
    float dnorm = length(delta) / max(0.0001, length(resolution * 0.5));
    float angle = min(
      3.141592653589793 / max(1.0, 5.0 - clamp(u_vignette, 0.0, 1.0) * 4.0),
      1.5707963267948966
    );
    float factor = dnorm > 1.0 ? 0.0 : pow(cos(angle * dnorm), 4.0);
    color *= factor;
  }
  if (u_hasA) {
    color = u_lutA1d
      ? applyLut2d(u_lutA2d, color, u_minA, u_maxA, u_intensityA)
      : applyLut3d(u_lutA, color, u_minA, u_maxA, u_intensityA);
  }
  if (u_hasB) {
    color = u_lutB1d
      ? applyLut2d(u_lutB2d, color, u_minB, u_maxB, u_intensityB)
      : applyLut3d(u_lutB, color, u_minB, u_maxB, u_intensityB);
  }
  // El canvas usa premultipliedAlpha: el alfa de los videos VP9 se conserva,
  // pero el color debe premultiplicarse para componer sin halos. El chroma
  // key multiplica el alfa de la fuente.
  float alpha = source.a;
  if (u_hasKey) alpha *= chromaAlpha(v_uv);
  outColor = vec4(color * alpha, alpha);
}`;

function compile(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function buildProgram(gl: WebGL2RenderingContext): WebGLProgram | null {
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  if (!vertex || !fragment) {
    if (vertex) gl.deleteShader(vertex);
    if (fragment) gl.deleteShader(fragment);
    return null;
  }
  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    return null;
  }
  return program;
}

function uniform(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  name: string,
): WebGLUniformLocation | null {
  return gl.getUniformLocation(program, name);
}

let webgl2Support: boolean | null = null;

/**
 * Sondea una sola vez si el WebView puede crear un contexto WebGL2. La capa
 * de efectos lo usa para no quitar la aproximación CSS de un video cuando no
 * hay shader disponible.
 */
export function canUseWebGL2(): boolean {
  if (webgl2Support !== null) return webgl2Support;
  try {
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl2');
    webgl2Support = gl !== null;
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    webgl2Support = false;
  }
  return webgl2Support;
}

export function createLutRenderer(canvas: HTMLCanvasElement): LutRenderer | null {
  let gl: WebGL2RenderingContext | null = null;
  try {
    gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      // El panel de scopes y las capturas leen este canvas fuera del frame de
      // dibujo; sin preservar el buffer WebGL lo entrega vacío.
      preserveDrawingBuffer: true,
    });
  } catch {
    gl = null;
  }
  if (!gl) return null;
  const context = gl;

  const program = buildProgram(context);
  if (!program) return null;

  const buffer = context.createBuffer();
  const vao = context.createVertexArray();
  const sourceTexture = context.createTexture();
  const dummyTexture = context.createTexture();
  const dummyTexture2d = context.createTexture();
  const previousTexture = context.createTexture();
  const previousTexture2 = context.createTexture();
  if (
    !buffer ||
    !vao ||
    !sourceTexture ||
    !dummyTexture ||
    !dummyTexture2d ||
    !previousTexture ||
    !previousTexture2
  )
    return null;

  context.bindVertexArray(vao);
  context.bindBuffer(context.ARRAY_BUFFER, buffer);
  context.bufferData(
    context.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    context.STATIC_DRAW,
  );
  const position = context.getAttribLocation(program, 'a_position');
  context.enableVertexAttribArray(position);
  context.vertexAttribPointer(position, 2, context.FLOAT, false, 0, 0);
  context.bindVertexArray(null);

  context.bindTexture(context.TEXTURE_2D, sourceTexture);
  context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MIN_FILTER, context.LINEAR);
  context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MAG_FILTER, context.LINEAR);
  context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_S, context.CLAMP_TO_EDGE);
  context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_T, context.CLAMP_TO_EDGE);

  context.bindTexture(context.TEXTURE_2D, previousTexture);
  context.texImage2D(
    context.TEXTURE_2D,
    0,
    context.RGBA8,
    1,
    1,
    0,
    context.RGBA,
    context.UNSIGNED_BYTE,
    new Uint8Array([0, 0, 0, 255]),
  );
  context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MIN_FILTER, context.LINEAR);
  context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MAG_FILTER, context.LINEAR);
  context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_S, context.CLAMP_TO_EDGE);
  context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_T, context.CLAMP_TO_EDGE);
  context.bindTexture(context.TEXTURE_2D, previousTexture2);
  context.texImage2D(
    context.TEXTURE_2D,
    0,
    context.RGBA8,
    1,
    1,
    0,
    context.RGBA,
    context.UNSIGNED_BYTE,
    new Uint8Array([0, 0, 0, 255]),
  );
  context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MIN_FILTER, context.LINEAR);
  context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MAG_FILTER, context.LINEAR);
  context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_S, context.CLAMP_TO_EDGE);
  context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_T, context.CLAMP_TO_EDGE);

  context.bindTexture(context.TEXTURE_3D, dummyTexture);
  context.texImage3D(
    context.TEXTURE_3D,
    0,
    context.RGBA8,
    1,
    1,
    1,
    0,
    context.RGBA,
    context.UNSIGNED_BYTE,
    new Uint8Array([0, 0, 0, 255]),
  );

  context.bindTexture(context.TEXTURE_2D, dummyTexture2d);
  context.texImage2D(
    context.TEXTURE_2D,
    0,
    context.RGBA,
    1,
    1,
    0,
    context.RGBA,
    context.UNSIGNED_BYTE,
    new Uint8Array([0, 0, 0, 255]),
  );
  context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MIN_FILTER, context.LINEAR);
  context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MAG_FILTER, context.LINEAR);

  const textureCache = new WeakMap<CubeLut, { texture: WebGLTexture; target: number }>();
  const ownedTextures = new Set<WebGLTexture>();
  let curveTexture: WebGLTexture | null = null;
  let curveData: Uint8Array | null = null;
  const maxTextureSize = context.getParameter(context.MAX_TEXTURE_SIZE) as number;
  const maxTexture3dSize = context.getParameter(context.MAX_3D_TEXTURE_SIZE) as number;
  const uniforms = {
    hasA: uniform(context, program, 'u_hasA'),
    hasB: uniform(context, program, 'u_hasB'),
    lutA1d: uniform(context, program, 'u_lutA1d'),
    lutB1d: uniform(context, program, 'u_lutB1d'),
    intensityA: uniform(context, program, 'u_intensityA'),
    intensityB: uniform(context, program, 'u_intensityB'),
    minA: uniform(context, program, 'u_minA'),
    maxA: uniform(context, program, 'u_maxA'),
    minB: uniform(context, program, 'u_minB'),
    maxB: uniform(context, program, 'u_maxB'),
    source: uniform(context, program, 'u_source'),
    lutA: uniform(context, program, 'u_lutA'),
    lutB: uniform(context, program, 'u_lutB'),
    lutA2d: uniform(context, program, 'u_lutA2d'),
    lutB2d: uniform(context, program, 'u_lutB2d'),
    texel: uniform(context, program, 'u_texel'),
    denoise: uniform(context, program, 'u_denoise'),
    vignette: uniform(context, program, 'u_vignette'),
    previous: uniform(context, program, 'u_previous'),
    hasPrevious: uniform(context, program, 'u_hasPrevious'),
    previous2: uniform(context, program, 'u_previous2'),
    hasPrevious2: uniform(context, program, 'u_hasPrevious2'),
    temporal: uniform(context, program, 'u_temporal'),
    curve: uniform(context, program, 'u_curve'),
    hasCurve: uniform(context, program, 'u_hasCurve'),
    hasKey: uniform(context, program, 'u_hasKey'),
    keyUv: uniform(context, program, 'u_keyUv'),
    keySimilarity: uniform(context, program, 'u_keySimilarity'),
    keyBlend: uniform(context, program, 'u_keyBlend'),
    hasWheels: uniform(context, program, 'u_hasWheels'),
    lift: uniform(context, program, 'u_lift'),
    offset: uniform(context, program, 'u_offset'),
    gain: uniform(context, program, 'u_gain'),
    gamma: uniform(context, program, 'u_gamma'),
    hasGamma: uniform(context, program, 'u_hasGamma'),
    temperature: uniform(context, program, 'u_temperature'),
    contrast: uniform(context, program, 'u_contrast'),
    saturation: uniform(context, program, 'u_saturation'),
    hue: uniform(context, program, 'u_hue'),
    channelGain: uniform(context, program, 'u_channelGain'),
    hsl: uniform(context, program, 'u_hsl'),
    hasHsl: uniform(context, program, 'u_hasHsl'),
    hslColors: uniform(context, program, 'u_hslColors'),
    grayscale: uniform(context, program, 'u_grayscale'),
    sepia: uniform(context, program, 'u_sepia'),
  };
  let keyData: ChromaKeyUniforms | null = null;
  let wheelsData: ColorWheelsUniforms | null = null;
  let gammaTexture: WebGLTexture | null = null;
  let gammaData: Uint8Array | null = null;
  let temperatureData = 0;
  let contrastData = 1;
  let saturationData = 1;
  let hueData = 0;
  let channelGainData: [number, number, number] = [1, 1, 1];
  let hslData: Float32Array | null = null;
  let hslColorsData = 0x3f;
  let grayscaleData = false;
  let sepiaData = false;

  function lutTexture(
    lut: CubeLut,
  ): { texture: WebGLTexture; target: number } | null {
    const cached = textureCache.get(lut);
    if (cached) return cached;
    const texture = context.createTexture();
    if (!texture) return null;
    const size = lut.size;
    const oneDimensional = lut.dimension === 1;
    if (oneDimensional && size > maxTextureSize) return null;
    if (!oneDimensional && size > maxTexture3dSize) return null;
    const target = oneDimensional ? context.TEXTURE_2D : context.TEXTURE_3D;
    context.bindTexture(target, texture);
    context.pixelStorei(context.UNPACK_FLIP_Y_WEBGL, false);
    if (oneDimensional) {
      context.texImage2D(
        target,
        0,
        context.RGBA8,
        size,
        1,
        0,
        context.RGBA,
        context.UNSIGNED_BYTE,
        lutTextureData(lut),
      );
      context.texParameteri(target, context.TEXTURE_WRAP_T, context.CLAMP_TO_EDGE);
    } else {
      context.texImage3D(
        target,
        0,
        context.RGBA8,
        size,
        size,
        size,
        0,
        context.RGBA,
        context.UNSIGNED_BYTE,
        lutTextureData(lut),
      );
      context.texParameteri(target, context.TEXTURE_WRAP_R, context.CLAMP_TO_EDGE);
    }
    context.texParameteri(target, context.TEXTURE_MIN_FILTER, context.LINEAR);
    context.texParameteri(target, context.TEXTURE_MAG_FILTER, context.LINEAR);
    context.texParameteri(target, context.TEXTURE_WRAP_S, context.CLAMP_TO_EDGE);
    textureCache.set(lut, { texture, target });
    ownedTextures.add(texture);
    return { texture, target };
  }

  let disposed = false;

  return {
    render(
      source,
      width,
      height,
      stages,
      denoise = 0,
      vignette = 0,
      previous,
      temporal = 0,
      previous2,
    ) {
      if (disposed) return false;
      const strength = Number.isFinite(denoise)
        ? Math.min(1, Math.max(0, denoise))
        : 0;
      const vignetteStrength = Number.isFinite(vignette)
        ? Math.min(1, Math.max(0, vignette))
        : 0;
      const temporalStrength = Number.isFinite(temporal)
        ? Math.min(1, Math.max(0, temporal))
        : 0;
      const temporalActive = Boolean(previous) && temporalStrength > 0.001;
      const temporalActive2 = temporalActive && Boolean(previous2);
      let scale = Math.min(
        1,
        maxTextureSize / Math.max(1, width),
        maxTextureSize / Math.max(1, height),
      );
      if (strength > 0.001) {
        // 9 muestras por píxel: se acota a 1920 px para que el filtro siga
        // siendo interactivo en 4K con la GPU integrada.
        scale = Math.min(scale, 1920 / Math.max(1, width));
      }
      const drawWidth = Math.max(1, Math.round(width * scale));
      const drawHeight = Math.max(1, Math.round(height * scale));
      if (canvas.width !== drawWidth) canvas.width = drawWidth;
      if (canvas.height !== drawHeight) canvas.height = drawHeight;
      try {
        context.bindTexture(context.TEXTURE_2D, sourceTexture);
        context.pixelStorei(context.UNPACK_FLIP_Y_WEBGL, true);
        context.texImage2D(
          context.TEXTURE_2D,
          0,
          context.RGBA,
          context.RGBA,
          context.UNSIGNED_BYTE,
          source,
        );
        if (temporalActive) {
          context.bindTexture(context.TEXTURE_2D, previousTexture);
          context.pixelStorei(context.UNPACK_FLIP_Y_WEBGL, true);
          context.texImage2D(
            context.TEXTURE_2D,
            0,
            context.RGBA,
            context.RGBA,
            context.UNSIGNED_BYTE,
            previous!,
          );
        }
        if (temporalActive2) {
          context.bindTexture(context.TEXTURE_2D, previousTexture2);
          context.pixelStorei(context.UNPACK_FLIP_Y_WEBGL, true);
          context.texImage2D(
            context.TEXTURE_2D,
            0,
            context.RGBA,
            context.RGBA,
            context.UNSIGNED_BYTE,
            previous2!,
          );
        }

        const active = stages.filter((stage) => stage.intensity > 0.001);
        const stageA = active[0];
        const stageB = active[1];
        const textureA = stageA ? lutTexture(stageA.lut) : null;
        const textureB = stageB ? lutTexture(stageB.lut) : null;
        if ((stageA && !textureA) || (stageB && !textureB)) return false;

        context.activeTexture(context.TEXTURE1);
        context.bindTexture(
          context.TEXTURE_3D,
          textureA?.target === context.TEXTURE_3D ? textureA.texture : dummyTexture,
        );
        context.activeTexture(context.TEXTURE2);
        context.bindTexture(
          context.TEXTURE_3D,
          textureB?.target === context.TEXTURE_3D ? textureB.texture : dummyTexture,
        );
        context.activeTexture(context.TEXTURE3);
        context.bindTexture(
          context.TEXTURE_2D,
          textureA?.target === context.TEXTURE_2D ? textureA.texture : dummyTexture2d,
        );
        context.activeTexture(context.TEXTURE4);
        context.bindTexture(
          context.TEXTURE_2D,
          textureB?.target === context.TEXTURE_2D ? textureB.texture : dummyTexture2d,
        );
        context.activeTexture(context.TEXTURE5);
        context.bindTexture(
          context.TEXTURE_2D,
          temporalActive ? previousTexture : dummyTexture2d,
        );
        context.activeTexture(context.TEXTURE6);
        context.bindTexture(context.TEXTURE_2D, curveTexture ?? dummyTexture2d);
        context.activeTexture(context.TEXTURE7);
        context.bindTexture(context.TEXTURE_2D, gammaTexture ?? dummyTexture2d);
        context.activeTexture(context.TEXTURE8);
        context.bindTexture(
          context.TEXTURE_2D,
          temporalActive2 ? previousTexture2 : dummyTexture2d,
        );
        context.activeTexture(context.TEXTURE0);
        context.bindTexture(context.TEXTURE_2D, sourceTexture);

        context.viewport(0, 0, drawWidth, drawHeight);
        context.clearColor(0, 0, 0, 0);
        context.clear(context.COLOR_BUFFER_BIT);
        context.useProgram(program);
        context.bindVertexArray(vao);
        context.uniform1i(uniforms.source, 0);
        context.uniform1i(uniforms.lutA, 1);
        context.uniform1i(uniforms.lutB, 2);
        context.uniform1i(uniforms.lutA2d, 3);
        context.uniform1i(uniforms.lutB2d, 4);
        context.uniform1i(uniforms.previous, 5);
        context.uniform1i(uniforms.previous2, 8);
        context.uniform1i(uniforms.curve, 6);
        context.uniform1i(uniforms.hasCurve, curveData ? 1 : 0);
        context.uniform1i(uniforms.hasKey, keyData ? 1 : 0);
        context.uniform2f(uniforms.keyUv, keyData?.u ?? 0, keyData?.v ?? 0);
        context.uniform1f(uniforms.keySimilarity, keyData?.similarity ?? 0.3);
        context.uniform1f(uniforms.keyBlend, keyData?.blend ?? 0.1);
        context.uniform1i(uniforms.gamma, 7);
        context.uniform1i(uniforms.hasGamma, gammaData ? 1 : 0);
        context.uniform1f(uniforms.temperature, temperatureData);
        context.uniform1f(uniforms.contrast, contrastData);
        context.uniform1f(uniforms.saturation, saturationData);
        context.uniform1f(uniforms.hue, hueData);
        context.uniform3fv(uniforms.channelGain, channelGainData);
        context.uniform1i(uniforms.hasHsl, hslData ? 1 : 0);
        context.uniform1i(uniforms.hslColors, hslColorsData);
        if (hslData) {
          context.uniformMatrix3fv(uniforms.hsl, false, hslData);
        }
        context.uniform1f(uniforms.grayscale, grayscaleData ? 1 : 0);
        context.uniform1f(uniforms.sepia, sepiaData ? 1 : 0);
        context.uniform1i(uniforms.hasWheels, wheelsData ? 1 : 0);
        context.uniform3fv(uniforms.lift, wheelsData ? [...wheelsData.lift] : [0, 0, 0]);
        context.uniform3fv(uniforms.offset, wheelsData ? [...wheelsData.offset] : [0, 0, 0]);
        context.uniform3fv(uniforms.gain, wheelsData ? [...wheelsData.gain] : [0, 0, 0]);
        context.uniform1i(uniforms.hasPrevious, temporalActive ? 1 : 0);
        context.uniform1i(uniforms.hasPrevious2, temporalActive2 ? 1 : 0);
        context.uniform1f(uniforms.temporal, temporalStrength);
        context.uniform1i(uniforms.hasA, stageA ? 1 : 0);
        context.uniform1i(uniforms.hasB, stageB ? 1 : 0);
        context.uniform1i(uniforms.lutA1d, stageA?.lut.dimension === 1 ? 1 : 0);
        context.uniform1i(uniforms.lutB1d, stageB?.lut.dimension === 1 ? 1 : 0);
        context.uniform1f(uniforms.intensityA, stageA?.intensity ?? 0);
        context.uniform1f(uniforms.intensityB, stageB?.intensity ?? 0);
        context.uniform3fv(uniforms.minA, stageA ? [...stageA.lut.domainMin] : [0, 0, 0]);
        context.uniform3fv(uniforms.maxA, stageA ? [...stageA.lut.domainMax] : [1, 1, 1]);
        context.uniform3fv(uniforms.minB, stageB ? [...stageB.lut.domainMin] : [0, 0, 0]);
        context.uniform3fv(uniforms.maxB, stageB ? [...stageB.lut.domainMax] : [1, 1, 1]);
        context.uniform2f(uniforms.texel, 1 / drawWidth, 1 / drawHeight);
        context.uniform1f(uniforms.denoise, strength);
        context.uniform1f(uniforms.vignette, vignetteStrength);
        context.drawArrays(context.TRIANGLES, 0, 6);
        context.bindVertexArray(null);
        return true;
      } catch {
        return false;
      }
    },
    setCurve(table) {
      if (disposed) return;
      if (curvesEqual(curveData, table)) return;
      if (!table || table.length !== CURVE_LUT_SIZE * 4) {
        curveData = null;
        return;
      }
      if (!curveTexture) {
        curveTexture = context.createTexture();
        if (!curveTexture) return;
      }
      context.bindTexture(context.TEXTURE_2D, curveTexture);
      context.pixelStorei(context.UNPACK_FLIP_Y_WEBGL, false);
      context.texImage2D(
        context.TEXTURE_2D,
        0,
        context.RGBA8,
        CURVE_LUT_SIZE,
        1,
        0,
        context.RGBA,
        context.UNSIGNED_BYTE,
        table,
      );
      context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MIN_FILTER, context.LINEAR);
      context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MAG_FILTER, context.LINEAR);
      context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_S, context.CLAMP_TO_EDGE);
      context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_T, context.CLAMP_TO_EDGE);
      curveData = Uint8Array.from(table);
    },
    setChromaKey(key) {
      if (disposed) return;
      keyData = key ? { ...key } : null;
    },
    setTemperature(value) {
      if (disposed) return;
      temperatureData = Number.isFinite(value) ? Math.min(1, Math.max(-1, value)) : 0;
    },
    setContrast(value) {
      if (disposed) return;
      contrastData = Number.isFinite(value) ? Math.min(3, Math.max(0, value)) : 1;
    },
    setSaturation(value) {
      if (disposed) return;
      saturationData = Number.isFinite(value) ? Math.min(3, Math.max(0, value)) : 1;
    },
    setHue(degrees) {
      if (disposed) return;
      const clamped = Number.isFinite(degrees) ? Math.min(180, Math.max(-180, degrees)) : 0;
      hueData = (clamped * Math.PI) / 180;
    },
    setChannelGain(r, g, b) {
      if (disposed) return;
      const clamp = (value: number): number =>
        Number.isFinite(value) ? Math.min(4, Math.max(0.25, value)) : 1;
      channelGainData = [clamp(r), clamp(g), clamp(b)];
    },
    setHslMatrix(rows, colorsMask = 0x3f) {
      if (disposed) return;
      if (!rows || rows.length !== 9 || rows.some((value) => !Number.isFinite(value))) {
        hslData = null;
        hslColorsData = 0x3f;
        return;
      }
      // `rows[j*3+i]` ya es la columna j que espera uniformMatrix3fv para
      // reproducir out_i = Σ_j rows[j][i]·v_j.
      hslData = new Float32Array(rows);
      const mask = Number.isFinite(colorsMask)
        ? Math.min(0x3f, Math.max(1, Math.round(colorsMask)))
        : 0x3f;
      hslColorsData = mask;
    },
    setGrayscale(value) {
      if (disposed) return;
      grayscaleData = value;
    },
    setSepia(value) {
      if (disposed) return;
      sepiaData = value;
    },
    setColorWheels(wheels) {
      if (disposed) return;
      if (!wheels) {
        wheelsData = null;
        gammaData = null;
        return;
      }
      wheelsData = {
        lift: [...wheels.lift],
        offset: [...wheels.offset],
        gain: [...wheels.gain],
        gamma: wheels.gamma,
      };
      const table = wheels.gamma;
      if (curvesEqual(gammaData, table)) return;
      if (!table || table.length !== CURVE_LUT_SIZE * 4) {
        gammaData = null;
        return;
      }
      if (!gammaTexture) {
        gammaTexture = context.createTexture();
        if (!gammaTexture) {
          gammaData = null;
          return;
        }
      }
      context.bindTexture(context.TEXTURE_2D, gammaTexture);
      context.pixelStorei(context.UNPACK_FLIP_Y_WEBGL, false);
      context.texImage2D(
        context.TEXTURE_2D,
        0,
        context.RGBA8,
        CURVE_LUT_SIZE,
        1,
        0,
        context.RGBA,
        context.UNSIGNED_BYTE,
        table,
      );
      context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MIN_FILTER, context.LINEAR);
      context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MAG_FILTER, context.LINEAR);
      context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_S, context.CLAMP_TO_EDGE);
      context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_T, context.CLAMP_TO_EDGE);
      gammaData = Uint8Array.from(table);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const texture of ownedTextures) context.deleteTexture(texture);
      ownedTextures.clear();
      if (curveTexture) context.deleteTexture(curveTexture);
      if (gammaTexture) context.deleteTexture(gammaTexture);
      context.deleteTexture(sourceTexture);
      context.deleteTexture(dummyTexture);
      context.deleteTexture(dummyTexture2d);
      context.deleteTexture(previousTexture);
      context.deleteTexture(previousTexture2);
      context.deleteBuffer(buffer);
      context.deleteVertexArray(vao);
      context.deleteProgram(program);
    },
  };
}
