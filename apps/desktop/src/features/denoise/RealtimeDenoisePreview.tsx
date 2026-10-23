import { useEffect, useRef, useState } from 'react';

const VERTEX_SHADER = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = vec2(a_pos.x * 0.5 + 0.5, 0.5 - a_pos.y * 0.5);
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const FRAGMENT_SHADER = `#version 300 es
precision mediump float;
in vec2 v_uv;
out vec4 out_color;
uniform sampler2D u_texture;
uniform vec2 u_texel;
uniform float u_strength;

void main() {
  vec3 center = texture(u_texture, v_uv).rgb;
  vec3 sum = center;
  float weight_sum = 1.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      if (x == 0 && y == 0) continue;
      vec2 offset = vec2(float(x), float(y)) * u_texel;
      vec3 sample_color = texture(u_texture, v_uv + offset).rgb;
      vec3 delta = sample_color - center;
      float distance_sq = dot(delta, delta);
      float weight = exp(-distance_sq * 40.0);
      sum += sample_color * weight;
      weight_sum += weight;
    }
  }
  vec3 filtered = sum / weight_sum;
  out_color = vec4(mix(center, filtered, u_strength), 1.0);
}`;

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
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

function createProgram(gl: WebGL2RenderingContext): WebGLProgram | null {
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  if (!vertex || !fragment) return null;
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

interface RealtimeDenoisePreviewProps {
  readonly src: string;
  readonly kind: 'video' | 'image';
  readonly strength: number;
  readonly enabled: boolean;
  readonly onError?: (message: string) => void;
}

/**
 * Preview aproximado en tiempo real con WebGL2.
 *
 * No es el render: aplica un filtro bilateral 3×3 sobre un canvas. El render
 * definitivo corre en FFmpeg con hqdn3d/atadenoise/nlmeans.
 */
export function RealtimeDenoisePreview({
  src,
  kind,
  strength,
  enabled,
  onError,
}: RealtimeDenoisePreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const glRef = useRef<WebGL2RenderingContext | null>(null);
  const programRef = useRef<WebGLProgram | null>(null);
  const textureRef = useRef<WebGLTexture | null>(null);
  const drawRef = useRef<() => void>(() => {});
  const onErrorRef = useRef(onError);
  const strengthRef = useRef(strength);
  const enabledRef = useRef(enabled);
  const frameRef = useRef<number | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [time, setTime] = useState(0);

  onErrorRef.current = onError;
  strengthRef.current = strength;
  enabledRef.current = enabled;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      preserveDrawingBuffer: false,
    });
    if (!gl) {
      const message = 'Este WebView no expone WebGL2: el preview en tiempo real no está disponible.';
      setFailed(message);
      onErrorRef.current?.(message);
      return;
    }
    const program = createProgram(gl);
    if (!program) {
      const message = 'No se pudo compilar el shader de denoise.';
      setFailed(message);
      onErrorRef.current?.(message);
      return;
    }
    glRef.current = gl;
    programRef.current = program;
    const texture = gl.createTexture();
    textureRef.current = texture;
    if (texture) {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW,
    );
    const position = gl.getAttribLocation(program, 'a_pos');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    gl.useProgram(program);
    gl.uniform1i(gl.getUniformLocation(program, 'u_texture'), 0);
    setReady(true);
    setFailed(null);

    return () => {
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
      if (texture) gl.deleteTexture(texture);
      gl.deleteProgram(program);
      glRef.current = null;
      programRef.current = null;
      textureRef.current = null;
      setReady(false);
    };
  }, [src, kind]);

  useEffect(() => {
    if (!ready) return;
    const draw = () => {
      const gl = glRef.current;
      const program = programRef.current;
      const canvas = canvasRef.current;
      if (!gl || !program || !canvas) return;
      const source = kind === 'video' ? videoRef.current : imageRef.current;
      if (!source) return;
      const width =
        kind === 'video'
          ? (source as HTMLVideoElement).videoWidth
          : (source as HTMLImageElement).naturalWidth;
      const height =
        kind === 'video'
          ? (source as HTMLVideoElement).videoHeight
          : (source as HTMLImageElement).naturalHeight;
      if (!width || !height) return;
      const maxWidth = 1280;
      const scale = Math.min(1, maxWidth / width);
      const nextWidth = Math.max(1, Math.round(width * scale));
      const nextHeight = Math.max(1, Math.round(height * scale));
      if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
        canvas.width = nextWidth;
        canvas.height = nextHeight;
      }
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, textureRef.current);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      gl.uniform2f(
        gl.getUniformLocation(program, 'u_texel'),
        1 / Math.max(1, canvas.width),
        1 / Math.max(1, canvas.height),
      );
      gl.uniform1f(
        gl.getUniformLocation(program, 'u_strength'),
        enabledRef.current ? Math.max(0, Math.min(1, strengthRef.current / 100)) : 0,
      );
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    drawRef.current = draw;
    draw();
    const video = videoRef.current;
    if (kind === 'video' && video) {
      const schedule = () => {
        if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
        drawRef.current();
        if (!video.paused && !video.ended) {
          const withFrameCallback = video as HTMLVideoElement & {
            requestVideoFrameCallback?: (callback: () => void) => number;
          };
          if (typeof withFrameCallback.requestVideoFrameCallback === 'function') {
            withFrameCallback.requestVideoFrameCallback(schedule);
          } else {
            frameRef.current = requestAnimationFrame(schedule);
          }
        }
      };
      const onPlay = () => {
        setPlaying(true);
        schedule();
      };
      const onPause = () => setPlaying(false);
      const onSeeked = () => drawRef.current();
      const onLoaded = () => drawRef.current();
      video.addEventListener('play', onPlay);
      video.addEventListener('pause', onPause);
      video.addEventListener('seeked', onSeeked);
      video.addEventListener('loadeddata', onLoaded);
      return () => {
        video.removeEventListener('play', onPlay);
        video.removeEventListener('pause', onPause);
        video.removeEventListener('seeked', onSeeked);
        video.removeEventListener('loadeddata', onLoaded);
        if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
      };
    }
    if (kind === 'image') {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.onload = () => drawRef.current();
      image.onerror = () => {
        const message = 'No se pudo cargar la imagen para el preview.';
        setFailed(message);
        onErrorRef.current?.(message);
      };
      image.src = src;
      imageRef.current = image;
      return () => {
        image.onload = null;
        image.onerror = null;
        imageRef.current = null;
      };
    }
    return undefined;
  }, [ready, src, kind]);

  useEffect(() => {
    if (!ready) return;
    drawRef.current();
  }, [strength, enabled, ready]);

  if (failed) {
    return (
      <div className="denoise-preview-error" role="status">
        <p>{failed}</p>
        {kind === 'video' ? (
          <video className="denoise-fallback-video" src={src} controls playsInline />
        ) : (
          <img className="denoise-fallback-image" src={src} alt="Original" />
        )}
      </div>
    );
  }

  return (
    <div className="denoise-preview-block">
      <div className="denoise-preview-frame">
        {kind === 'video' ? (
          <video
            ref={videoRef}
            className="denoise-source-video"
            src={src}
            crossOrigin="anonymous"
            playsInline
            preload="auto"
            onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || 0)}
            onTimeUpdate={(event) => setTime(event.currentTarget.currentTime || 0)}
            onEnded={() => setPlaying(false)}
          />
        ) : null}
        <canvas ref={canvasRef} className="denoise-canvas" aria-label="Vista previa con reducción de ruido" />
      </div>
      {kind === 'video' ? (
        <div className="denoise-player">
          <button
            type="button"
            className="ghost icon-button"
            onClick={() => {
              const video = videoRef.current;
              if (!video) return;
              if (video.paused) void video.play();
              else video.pause();
            }}
            aria-label={playing ? 'Pausar preview' : 'Reproducir preview'}
            title={playing ? 'Pausar' : 'Reproducir'}
          >
            {playing ? '❚❚' : '▶'}
          </button>
          <input
            type="range"
            min={0}
            max={Math.max(0.1, duration)}
            step={0.05}
            value={Math.min(time, duration || 0)}
            aria-label="Posición del preview"
            onChange={(event) => {
              const video = videoRef.current;
              if (video) video.currentTime = Number(event.target.value);
            }}
          />
          <span className="denoise-time">
            {time.toFixed(1)} / {duration.toFixed(1)} s
          </span>
        </div>
      ) : null}
    </div>
  );
}
