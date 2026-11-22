import { hexToRgb, normalizeParams, resolveParamsAt } from './params.ts';
import type { EffectRegistry } from './registry.ts';
import { activeInstances, type EffectStack } from './stack.ts';
import { fragmentHeader, VERTEX_SHADER } from './shaders/prelude.ts';
import type { EffectInstance, EffectManifest, ParamValue } from './types.ts';
import type { Lut3DData } from './lut3d.ts';

/**
 * Renderer WebGL2 del stack.
 *
 * Un solo canvas, un quad, y por cada efecto una cadena de passes con
 * ping-pong de framebuffers. El contrato con los shaders es fijo:
 *
 *   u_currentTexture  salida del pass anterior (o la entrada del efecto)
 *   u_texture1..3     entradas declaradas en `pass.inputs`
 *   p_<param>         un uniform por parámetro del manifiesto
 *
 * Nada de esto conoce FFmpeg: el mismo stack se compila aparte para exportar.
 */

export interface RenderClock {
  readonly timeSeconds: number;
  readonly frameIndex: number;
  readonly frameRate: number;
}

/**
 * LUT 3D lista para el renderer (`effects.lutFile`/`cameraProfile` de la
 * preview). `intensity` mezcla el frame original con el graduado, igual que
 * `apply_lut_to_chain` del export; el export salta intensidades ≤ 0.001.
 */
export interface Lut3DInput {
  readonly data: Lut3DData;
  readonly intensity: number;
  readonly domainMin?: readonly [number, number, number];
  readonly domainMax?: readonly [number, number, number];
}

interface Lut3DEntry {
  readonly texture: WebGLTexture;
  readonly intensity: number;
  readonly domainMin: readonly number[];
  readonly domainMax: readonly number[];
}

interface CompiledProgram {
  readonly program: WebGLProgram;
  readonly uniforms: ReadonlyMap<string, { location: WebGLUniformLocation; type: number }>;
}

type UniformValue = number | readonly number[] | WebGLTexture;

const SAMPLER_UNITS: Readonly<Record<string, number>> = {
  u_currentTexture: 0,
  u_fromTexture: 0,
  u_texture1: 1,
  u_toTexture: 1,
  u_texture2: 2,
  u_texture3: 3,
};

function isTexture(value: UniformValue): value is WebGLTexture {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class EffectRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly gl: WebGL2RenderingContext;
  private readonly vao: WebGLVertexArrayObject;
  private readonly programs = new Map<string, CompiledProgram>();
  private readonly sourceTexture: WebGLTexture;
  // Historial de frames fuente para efectos temporales: hasta HISTORY_SIZE
  // texturas en orden cronológico (índice 0 = más viejo, último = más
  // reciente). `blur.temporal` usa el más reciente (`u_prevTexture`) y
  // `denoise.temporal` pondera los 4 (`u_hist0..3` + `u_histCount`).
  private static readonly HISTORY_SIZE = 4;
  private readonly historyTextures: WebGLTexture[] = [];
  private readonly historyFramebuffers: (WebGLFramebuffer | null)[] = [];
  private historyCount = 0;
  // Storage real de las texturas de historial: se asigna perezosa en
  // `ensureHistoryStorage` (sólo cuando un efecto temporal las usa) y no en
  // `uploadSource` — reservar 4×W×H×4B por renderer sin necesidad costaba
  // ~132 MiB en 4K para el caso común sin efectos temporales (AUD-140).
  private historyStorageWidth = 0;
  private historyStorageHeight = 0;
  private lastSource: TexImageSource | null = null;
  private lastFrameIndex = -1;
  private readonly targets: WebGLTexture[];
  private readonly framebuffers: WebGLFramebuffer[];
  private readonly passthrough: CompiledProgram;
  private lutProgram: CompiledProgram | null = null;
  private readonly lutTextureCache = new WeakMap<Lut3DData, WebGLTexture>();
  private readonly lutTextureSet = new Set<WebGLTexture>();
  private readonly lutIdMap = new WeakMap<Lut3DData, number>();
  private lutIdCounter = 0;
  private lutSignature = '';
  private lutEntries: Lut3DEntry[] = [];
  private width = 1;
  private height = 1;
  private sourceWidth = 0;
  private sourceHeight = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
      alpha: true,
      antialias: false,
    });
    if (!gl) throw new Error('WebGL2 no está disponible en este equipo.');
    this.gl = gl;
    this.sourceTexture = this.createTexture();
    for (let i = 0; i < EffectRenderer.HISTORY_SIZE; i += 1) {
      const texture = this.createTexture();
      this.historyTextures.push(texture);
      const framebuffer = gl.createFramebuffer();
      if (framebuffer) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
        gl.framebufferTexture2D(
          gl.FRAMEBUFFER,
          gl.COLOR_ATTACHMENT0,
          gl.TEXTURE_2D,
          texture,
          0,
        );
      }
      this.historyFramebuffers.push(framebuffer);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.targets = [this.createTexture(), this.createTexture()];
    this.framebuffers = this.targets.map((texture) => {
      const framebuffer = gl.createFramebuffer();
      if (!framebuffer) throw new Error('No se pudo crear el framebuffer del preview.');
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return framebuffer;
    });
    const vao = gl.createVertexArray();
    const buffer = gl.createBuffer();
    if (!vao || !buffer) throw new Error('No se pudo crear el quad del preview.');
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW,
    );
    // El vertex shader declara `layout(location = 0)`, así que el índice es fijo
    // y no depende de lo que el linker asigne en cada programa.
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.vao = vao;
    this.passthrough = this.compileRaw(
      '__passthrough',
      `void main() { fragColor = texture(u_currentTexture, v_texCoord); }`,
    );
  }

  private compileRaw(
    key: string,
    body: string,
    kind: 'video' | 'transition' = 'video',
  ): CompiledProgram {
    const gl = this.gl;
    const vertex = this.compileShader(gl.VERTEX_SHADER, VERTEX_SHADER, `${key} vertex`);
    const fragment = this.compileShader(
      gl.FRAGMENT_SHADER,
      `${fragmentHeader(kind)}\n${body}`,
      key,
    );
    const program = gl.createProgram();
    if (!program) throw new Error(`No se pudo crear el programa ${key}.`);
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program) ?? 'sin log';
      throw new Error(`El programa ${key} no enlaza: ${log}`);
    }
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    const uniforms = new Map<string, { location: WebGLUniformLocation; type: number }>();
    const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number;
    for (let index = 0; index < count; index += 1) {
      const info = gl.getActiveUniform(program, index);
      if (!info) continue;
      const location = gl.getUniformLocation(program, info.name);
      if (!location) continue;
      uniforms.set(info.name, { location, type: info.type });
    }
    return { program, uniforms };
  }

  private compileShader(type: number, source: string, label: string): WebGLShader {
    const gl = this.gl;
    const shader = gl.createShader(type);
    if (!shader) throw new Error(`No se pudo crear el shader ${label}.`);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader) ?? 'sin log';
      gl.deleteShader(shader);
      throw new Error(`Shader ${label} no compila: ${log}`);
    }
    return shader;
  }

  private createTexture(): WebGLTexture {
    const gl = this.gl;
    const texture = gl.createTexture();
    if (!texture) throw new Error('No se pudo crear la textura del preview.');
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  }

  private programFor(manifest: EffectManifest, passIndex: number): CompiledProgram {
    const key = `${manifest.id}#${passIndex}`;
    const cached = this.programs.get(key);
    if (cached) return cached;
    const pass = manifest.gpu?.passes[passIndex];
    if (!pass) throw new Error(`${manifest.name} no tiene el pass ${passIndex}.`);
    const compiled = this.compileRaw(
      key,
      pass.shader,
      manifest.kind === 'transition' ? 'transition' : 'video',
    );
    this.programs.set(key, compiled);
    return compiled;
  }

  resize(width: number, height: number): void {
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    this.canvas.width = w;
    this.canvas.height = h;
    const gl = this.gl;
    for (const texture of this.targets) {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }
  }

  uploadSource(source: TexImageSource): void {
    const gl = this.gl;
    // Cambio de clip/fuente: el frame previo pertenece a otro clip y no debe
    // mezclarse (evita el ghost de un frame al entrar a un clip nuevo).
    if (source !== this.lastSource) {
      this.lastSource = source;
      this.historyCount = 0;
    }
    gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
    // FLIP_Y: sin él la fila superior de la fuente cae en t=0, que el quad
    // samplea en la base de pantalla → el frame se veía invertido (verificado
    // con readPixels en Chromium: el cuadrante inferior aparecía arriba).
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    // `texSubImage2D` evita reasignar la textura en cada frame de video: sólo
    // se reserva de nuevo cuando cambia el tamaño del frame.
    const isVideo = typeof HTMLVideoElement !== 'undefined' && source instanceof HTMLVideoElement;
    const isImage = typeof HTMLImageElement !== 'undefined' && source instanceof HTMLImageElement;
    // Canvas/ImageBitmap/OffscreenCanvas exponen width/height propios; sin
    // este branch caían en texSubImage2D sobre una textura sin storage.
    const intrinsic = source as { width?: number; height?: number };
    const width = isVideo
      ? source.videoWidth
      : isImage
        ? source.naturalWidth
        : (intrinsic.width ?? this.sourceWidth);
    const height = isVideo
      ? source.videoHeight
      : isImage
        ? source.naturalHeight
        : (intrinsic.height ?? this.sourceHeight);
    if (width !== this.sourceWidth || height !== this.sourceHeight) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source);
      this.sourceWidth = width;
      this.sourceHeight = height;
      // El historial NO se reasigna acá: su storage es perezoso
      // (`ensureHistoryStorage`) y `historyCount = 0` ya invalida el
      // contenido viejo; si un efecto temporal vuelve a pedirlo, el
      // ensure detecta el cambio de tamaño y re-aloca.
      this.historyCount = 0;
      return;
    }
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, source);
  }

  /**
   * Asigna el storage RGBA8 de las HISTORY_SIZE texturas al tamaño de la
   * fuente, sólo cuando un efecto temporal las va a samplear. Idempotente:
   * si el tamaño no cambió no toca la GPU. Al re-alojar invalida el
   * historial (el contenido viejo no corresponde al nuevo tamaño).
   */
  private ensureHistoryStorage(): void {
    if (
      this.historyStorageWidth === this.sourceWidth &&
      this.historyStorageHeight === this.sourceHeight
    ) {
      return;
    }
    const gl = this.gl;
    for (const texture of this.historyTextures) {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA8,
        this.sourceWidth,
        this.sourceHeight,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        null,
      );
    }
    this.historyStorageWidth = this.sourceWidth;
    this.historyStorageHeight = this.sourceHeight;
    this.historyCount = 0;
  }

  private paramValues(
    manifest: EffectManifest,
    instance: EffectInstance,
    frameIndex: number,
  ): Record<string, ParamValue> {
    const params = normalizeParams(manifest, instance.params);
    return resolveParamsAt(manifest, params, instance.keyframes, frameIndex);
  }

  private uniformValues(
    manifest: EffectManifest,
    params: Readonly<Record<string, ParamValue>>,
    clock: RenderClock,
    extra: Readonly<Record<string, UniformValue>>,
  ): Map<string, UniformValue> {
    const values = new Map<string, UniformValue>(Object.entries(extra));
    values.set('u_resolution', [this.width, this.height]);
    values.set('u_time', clock.timeSeconds);
    values.set('u_timeUs', clock.timeSeconds * 1_000_000);
    values.set('u_frameIndex', clock.frameIndex);
    values.set('u_frameRate', clock.frameRate);
    for (const spec of manifest.params) {
      const value = params[spec.id];
      if (value === undefined) continue;
      const name = `p_${spec.id}`;
      switch (spec.type) {
        case 'color':
          values.set(name, hexToRgb(typeof value === 'string' ? value : spec.default));
          break;
        case 'vec2':
          values.set(name, Array.isArray(value) ? [value[0], value[1]] : spec.default);
          break;
        case 'bool':
          values.set(name, value === true ? 1 : 0);
          break;
        case 'float':
        case 'int':
        case 'enum':
          values.set(name, typeof value === 'number' ? value : spec.default);
          break;
        default:
          break;
      }
    }
    return values;
  }

  private drawProgram(compiled: CompiledProgram, values: Map<string, UniformValue>): void {
    const gl = this.gl;
    gl.useProgram(compiled.program);
    let unit = 0;
    for (const [name, meta] of compiled.uniforms) {
      const value = values.get(name);
      if (value === undefined) continue;
      if (meta.type === gl.SAMPLER_3D) {
        if (!isTexture(value)) continue;
        const preferred = SAMPLER_UNITS[name] ?? unit;
        gl.activeTexture(gl.TEXTURE0 + preferred);
        gl.bindTexture(gl.TEXTURE_3D, value);
        gl.uniform1i(meta.location, preferred);
        unit = Math.max(unit, preferred + 1);
        continue;
      }
      if (meta.type === gl.SAMPLER_2D) {
        if (!isTexture(value)) continue;
        const preferred = SAMPLER_UNITS[name] ?? unit;
        gl.activeTexture(gl.TEXTURE0 + preferred);
        gl.bindTexture(gl.TEXTURE_2D, value);
        gl.uniform1i(meta.location, preferred);
        unit = Math.max(unit, preferred + 1);
        continue;
      }
      if (typeof value === 'number') {
        if (meta.type === gl.INT || meta.type === gl.BOOL) {
          gl.uniform1i(meta.location, Math.round(value));
        } else {
          gl.uniform1f(meta.location, value);
        }
        continue;
      }
      const array = value as readonly number[];
      if (meta.type === gl.FLOAT_VEC2) gl.uniform2f(meta.location, array[0] ?? 0, array[1] ?? 0);
      else if (meta.type === gl.FLOAT_VEC3) {
        gl.uniform3f(meta.location, array[0] ?? 0, array[1] ?? 0, array[2] ?? 0);
      } else if (meta.type === gl.FLOAT_VEC4) {
        gl.uniform4f(meta.location, array[0] ?? 0, array[1] ?? 0, array[2] ?? 0, array[3] ?? 1);
      }
    }
  }

  private bindTarget(index: number | null): void {
    const gl = this.gl;
    if (index === null) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers[index] ?? null);
    }
    gl.viewport(0, 0, this.width, this.height);
  }

  /**
   * Declara las LUTs 3D del frame (cameraProfile + lutFile, en el orden del
   * export). La firma evita recrear las texturas `TEXTURE_3D` en cada frame:
   * sólo se reconstruye cuando cambia el set de datos o las intensidades.
   */
  setLuts(inputs: readonly Lut3DInput[] | null): void {
    const list = (inputs ?? []).filter(
      (input) => input.intensity > 0.001 && input.data.size >= 2,
    );
    const signature = list
      .map((input) => {
        let id = this.lutIdMap.get(input.data);
        if (id === undefined) {
          this.lutIdCounter += 1;
          id = this.lutIdCounter;
          this.lutIdMap.set(input.data, id);
        }
        const domainMin = input.domainMin ?? [0, 0, 0];
        const domainMax = input.domainMax ?? [1, 1, 1];
        return `${id}:${input.intensity}:${domainMin.join(',')}:${domainMax.join(',')}`;
      })
      .join('|');
    if (signature === this.lutSignature) return;
    this.lutSignature = signature;
    this.lutEntries = list.map((input) => ({
      texture: this.lutTextureFor(input.data),
      intensity: Math.min(1, Math.max(0, input.intensity)),
      domainMin: input.domainMin ?? [0, 0, 0],
      domainMax: input.domainMax ?? [1, 1, 1],
    }));
  }

  private lutTextureFor(data: Lut3DData): WebGLTexture {
    const cached = this.lutTextureCache.get(data);
    if (cached) return cached;
    const gl = this.gl;
    const texture = gl.createTexture();
    if (!texture) throw new Error('No se pudo crear la textura LUT del preview.');
    gl.bindTexture(gl.TEXTURE_3D, texture);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
    // Chromium devuelve INVALID_OPERATION si UNPACK_FLIP_Y quedó en true
    // (lo deja uploadSource para las texturas 2D): el flag aplica a uploads
    // DOM y no a TypedArray, pero el driver igual lo valida.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage3D(
      gl.TEXTURE_3D,
      0,
      gl.RGBA8,
      data.size,
      data.size,
      data.size,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      data.data,
    );
    this.lutTextureCache.set(data, texture);
    this.lutTextureSet.add(texture);
    return texture;
  }

  private lutProgramFor(): CompiledProgram {
    if (this.lutProgram) return this.lutProgram;
    this.lutProgram = this.compileRaw(
      '__lut3d',
      `uniform highp sampler3D u_lut;
       uniform float u_lutIntensity;
       uniform vec3 u_lutDomainMin;
       uniform vec3 u_lutDomainMax;
       void main() {
         vec4 c = texture(u_currentTexture, v_texCoord);
         vec3 span = max(u_lutDomainMax - u_lutDomainMin, vec3(1e-5));
         vec3 coord = clamp((c.rgb - u_lutDomainMin) / span, 0.0, 1.0);
         vec3 graded = texture(u_lut, coord).rgb;
         fragColor = vec4(mix(c.rgb, graded, clamp(u_lutIntensity, 0.0, 1.0)), c.a);
       }`,
    );
    return this.lutProgram;
  }

  /** Dibuja el stack completo. Sin efectos, el frame pasa tal cual. */
  render(registry: EffectRegistry, stack: EffectStack, clock: RenderClock): void {
    const gl = this.gl;
    // Seek/salto: cualquier retroceso (aunque sea de 1 frame — el historial
    // pasaría a contener frames del "futuro" del punto de seek) o salto de
    // más de 4 posiciones invalida el historial: el blur temporal no debe
    // arrastrar frames de otro momento del clip.
    if (
      this.lastFrameIndex >= 0 &&
      (clock.frameIndex < this.lastFrameIndex ||
        clock.frameIndex - this.lastFrameIndex > 4)
    ) {
      this.historyCount = 0;
    }
    this.lastFrameIndex = clock.frameIndex;
    const instances = activeInstances(stack).filter((instance) => {
      const manifest = registry.get(instance.effectId);
      return manifest?.gpu?.passes.length;
    });
    // La copia al historial cuesta un draw por frame: sólo se paga cuando
    // algún efecto activo declara uniforms temporales (`u_hist*`/`u_prevTexture`).
    // Sin ellos (p.ej. clip con sólo LUT o stack espacial) el ring buffer
    // queda vacío y no consume GPU.
    const needsHistory = instances.some((instance) => {
      const manifest = registry.get(instance.effectId);
      return (
        manifest?.gpu?.passes.some(
          (pass) => pass.shader.includes('u_hist') || pass.shader.includes('u_prevTexture'),
        ) ?? false
      );
    });
    // Las texturas de historial se samplean como uniforms en los passes de
    // abajo: el storage perezoso tiene que existir ANTES del primer draw,
    // no al final cuando ya se copiaría el frame.
    if (needsHistory && this.sourceWidth > 0 && this.sourceHeight > 0) {
      this.ensureHistoryStorage();
    }

    let input: WebGLTexture = this.sourceTexture;
    let targetIndex = 0;

    // LUTs 3D antes del stack: el export aplica `lut3d` dentro de la cadena
    // del clip y el stack después (`plan/range.rs`), así que el orden interno
    // se respeta. La preview lee frames crudos (sin los filtros CSS), misma
    // aproximación documentada que `clipPreviewStack`.
    for (let lutIndex = 0; lutIndex < this.lutEntries.length; lutIndex += 1) {
      const lut = this.lutEntries[lutIndex];
      if (!lut) continue;
      const toScreen = instances.length === 0 && lutIndex === this.lutEntries.length - 1;
      let target = toScreen ? null : targetIndex % 2;
      let targetTexture = target === null ? null : this.targets[target] ?? null;
      if (target !== null && targetTexture === input) {
        target = (target + 1) % 2;
        targetTexture = this.targets[target] ?? null;
      }
      const compiled = this.lutProgramFor();
      this.bindTarget(target);
      const values = new Map<string, UniformValue>([
        ['u_currentTexture', input],
        ['u_lut', lut.texture],
        ['u_lutIntensity', lut.intensity],
        ['u_lutDomainMin', lut.domainMin],
        ['u_lutDomainMax', lut.domainMax],
        ['u_resolution', [this.width, this.height]],
        ['u_time', clock.timeSeconds],
        ['u_timeUs', clock.timeSeconds * 1_000_000],
        ['u_frameIndex', clock.frameIndex],
        ['u_frameRate', clock.frameRate],
      ]);
      this.drawProgram(compiled, values);
      gl.bindVertexArray(this.vao);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      if (!toScreen && targetTexture) input = targetTexture;
      targetIndex += 1;
    }

    for (let effectIndex = 0; effectIndex < instances.length; effectIndex += 1) {
      const instance = instances[effectIndex];
      if (!instance) continue;
      const manifest = registry.get(instance.effectId);
      if (!manifest?.gpu) continue;
      const params = this.paramValues(manifest, instance, clock.frameIndex);
      const outputs: WebGLTexture[] = [];
      const passes = manifest.gpu.passes;

      for (let passIndex = 0; passIndex < passes.length; passIndex += 1) {
        const pass = passes[passIndex];
        if (!pass) continue;
        const isLastEffect = effectIndex === instances.length - 1;
        const isLastPass = passIndex === passes.length - 1;
        const toScreen = isLastEffect && isLastPass;

        const current = passIndex === 0 ? input : outputs[passIndex - 1] ?? input;
        // Nunca escribir en la textura que se está leyendo: si el ping-pong
        // cae sobre la entrada, se elige el otro buffer.
        let target = toScreen ? null : targetIndex % 2;
        let targetTexture = target === null ? null : this.targets[target] ?? null;
        if (target !== null && targetTexture === current) {
          target = (target + 1) % 2;
          targetTexture = this.targets[target] ?? null;
        }

        const newest = this.historyTextures[this.historyCount - 1];
        const extra: Record<string, UniformValue> = {
          u_currentTexture: current,
          u_prevTexture: newest ?? this.sourceTexture,
          u_hist0: this.historyTextures[0] ?? this.sourceTexture,
          u_hist1: this.historyTextures[1] ?? this.sourceTexture,
          u_hist2: this.historyTextures[2] ?? this.sourceTexture,
          u_hist3: this.historyTextures[3] ?? this.sourceTexture,
          u_histCount: this.historyCount,
        };
        const declared = pass.inputs ?? [];
        declared.forEach((declaration, index) => {
          const name = `u_texture${index + 1}`;
          if (declaration.from === 'source') extra[name] = input;
          else extra[name] = outputs[declaration.index] ?? input;
        });

        const compiled = this.programFor(manifest, passIndex);
        this.bindTarget(target);
        this.drawProgram(compiled, this.uniformValues(manifest, params, clock, extra));
        gl.bindVertexArray(this.vao);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        if (!toScreen && targetTexture) outputs.push(targetTexture);
        targetIndex += 1;
      }
      const last = outputs[outputs.length - 1];
      if (last) input = last;
    }

    if (instances.length === 0 && this.lutEntries.length === 0) {
      // Sin stack ni LUT: copiar la fuente a pantalla con el programa trivial.
      this.bindTarget(null);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      this.drawProgram(this.passthrough, new Map<string, UniformValue>([
        ['u_currentTexture', this.sourceTexture],
      ]));
      gl.bindVertexArray(this.vao);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    // Historial para efectos temporales: guarda el frame fuente de ESTE
    // render para los próximos. sourceTexture no la tocan los passes
    // (escriben en targets o pantalla), así que la copia es exacta. El slot
    // se elige en orden cronológico: mientras haya lugar se agrega al final;
    // lleno, se reusa el más viejo y el array rota para mantener el orden.
    // En el primer frame o tras un cambio de tamaño no hay previo válido.
    // Si ningún efecto usa el historial este frame, no se copia nada.
    if (needsHistory && this.sourceWidth > 0 && this.sourceHeight > 0) {
      const slot = this.historyCount < EffectRenderer.HISTORY_SIZE
        ? this.historyCount
        : 0;
      const framebuffer = this.historyFramebuffers[slot];
      const texture = this.historyTextures[slot];
      if (framebuffer && texture) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
        gl.viewport(0, 0, this.sourceWidth, this.sourceHeight);
        this.drawProgram(this.passthrough, new Map<string, UniformValue>([
          ['u_currentTexture', this.sourceTexture],
        ]));
        gl.bindVertexArray(this.vao);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        if (this.historyCount < EffectRenderer.HISTORY_SIZE) {
          this.historyCount += 1;
        } else {
          // El slot reusado era el más viejo: pasa a ser el más nuevo.
          this.historyTextures.push(this.historyTextures.shift() as WebGLTexture);
          this.historyFramebuffers.push(
            this.historyFramebuffers.shift() as WebGLFramebuffer | null,
          );
        }
      }
    } else {
      // Sin efectos temporales la historia no se alimenta: si después se
      // activa uno, arranca limpio en vez de heredar frames viejos.
      this.historyCount = 0;
    }
  }

  /** Dibuja una transición entre dos frames ya subidos a texturas. */
  renderTransition(
    manifest: EffectManifest,
    from: TexImageSource,
    to: TexImageSource,
    progress: number,
    clock: RenderClock,
    instanceParams?: Readonly<Record<string, ParamValue>>,
  ): void {
    const gl = this.gl;
    this.uploadSource(from);
    const fromTexture = this.sourceTexture;
    const toTexture = this.targets[0];
    if (!toTexture) return;
    gl.bindTexture(gl.TEXTURE_2D, toTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, to);
    const params = normalizeParams(manifest, instanceParams ?? {});
    const compiled = this.programFor(manifest, 0);
    this.bindTarget(null);
    this.drawProgram(
      compiled,
      this.uniformValues(manifest, params, clock, {
        u_fromTexture: fromTexture,
        u_toTexture: toTexture,
        u_progress: Math.max(0, Math.min(1, progress)),
      }),
    );
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  dispose(): void {
    const gl = this.gl;
    for (const compiled of this.programs.values()) gl.deleteProgram(compiled.program);
    if (this.lutProgram) gl.deleteProgram(this.lutProgram.program);
    this.programs.clear();
    this.lutProgram = null;
    for (const texture of this.lutTextureSet) gl.deleteTexture(texture);
    this.lutTextureSet.clear();
    for (const texture of [this.sourceTexture, ...this.historyTextures, ...this.targets]) gl.deleteTexture(texture);
    for (const framebuffer of this.framebuffers) gl.deleteFramebuffer(framebuffer);
    for (const framebuffer of this.historyFramebuffers) {
      if (framebuffer) gl.deleteFramebuffer(framebuffer);
    }
    gl.deleteVertexArray(this.vao);
  }
}
