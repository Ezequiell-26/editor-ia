import { hexToRgb, normalizeParams, resolveParamsAt } from './params.ts';
import type { EffectRegistry } from './registry.ts';
import { activeInstances, type EffectStack } from './stack.ts';
import { fragmentHeader, VERTEX_SHADER } from './shaders/prelude.ts';
import type { EffectInstance, EffectManifest, ParamValue } from './types.ts';

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
  private readonly targets: WebGLTexture[];
  private readonly framebuffers: WebGLFramebuffer[];
  private readonly passthrough: CompiledProgram;
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
    gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    // `texSubImage2D` evita reasignar la textura en cada frame de video: sólo
    // se reserva de nuevo cuando cambia el tamaño del frame.
    const isVideo = typeof HTMLVideoElement !== 'undefined' && source instanceof HTMLVideoElement;
    const isImage = typeof HTMLImageElement !== 'undefined' && source instanceof HTMLImageElement;
    const width = isVideo ? source.videoWidth : isImage ? source.naturalWidth : this.sourceWidth;
    const height = isVideo ? source.videoHeight : isImage ? source.naturalHeight : this.sourceHeight;
    if (width !== this.sourceWidth || height !== this.sourceHeight) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source);
      this.sourceWidth = width;
      this.sourceHeight = height;
      return;
    }
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, source);
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

  /** Dibuja el stack completo. Sin efectos, el frame pasa tal cual. */
  render(registry: EffectRegistry, stack: EffectStack, clock: RenderClock): void {
    const gl = this.gl;
    const instances = activeInstances(stack).filter((instance) => {
      const manifest = registry.get(instance.effectId);
      return manifest?.gpu?.passes.length;
    });

    let input: WebGLTexture = this.sourceTexture;
    let targetIndex = 0;

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

        const extra: Record<string, UniformValue> = { u_currentTexture: current };
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

    if (instances.length === 0) {
      // Sin stack: copiar la fuente a pantalla con el programa trivial.
      this.bindTarget(null);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      this.drawProgram(this.passthrough, new Map<string, UniformValue>([
        ['u_currentTexture', this.sourceTexture],
      ]));
      gl.bindVertexArray(this.vao);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
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
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
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
    this.programs.clear();
    for (const texture of [this.sourceTexture, ...this.targets]) gl.deleteTexture(texture);
    for (const framebuffer of this.framebuffers) gl.deleteFramebuffer(framebuffer);
    gl.deleteVertexArray(this.vao);
  }
}
