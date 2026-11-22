/**
 * «Grabar voz»: lógica pura de la captura de voz del micrófono hacia la
 * timeline (paridad con la grabación de voz de CapCut).
 *
 * El webview (WebView2/Chromium) graba con `getUserMedia` + `MediaRecorder`.
 * Al detener se prefiere decodificar el contenedor (webm/opus, mp4/aac) con
 * Web Audio y re-encodear a **WAV PCM16 48 kHz**: es el formato que ya usa la
 * narración TTS del proyecto y el más compatible con ffprobe/FFmpeg del
 * pipeline de render. Si la decodificación falla (codec sin soporte), se
 * importa el contenedor original — FFmpeg lo lee igual— con su extensión.
 */

/** Candidatos en orden de preferencia; el primero soportado gana. */
export const VOICEOVER_MIME_CANDIDATES: readonly string[] = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
  'audio/ogg',
];

/** Extensiones aceptadas por `import_media_bytes` en el backend. */
const CONTAINER_EXTENSIONS = new Set([
  'wav',
  'mp3',
  'm4a',
  'aac',
  'flac',
  'ogg',
  'opus',
  'webm',
]);

/** Tope de grabación: voz para video raramente pasa de unos minutos y el
 *  WAV PCM crece ~11,5 MB/min en estéreo; cortamos a los 10 minutos. */
export const VOICEOVER_MAX_SECONDS = 600;

/** Sample rate del WAV entregado al proyecto (el mismo de la narración TTS). */
export const VOICEOVER_WAV_SAMPLE_RATE = 48_000;

/**
 * Primer MIME que `MediaRecorder` sabe producir, o `null` si ninguno.
 * `isSupported` se inyecta para testear sin DOM.
 */
export function pickVoiceoverMimeType(
  isSupported?: (mimeType: string) => boolean,
): string | null {
  if (!isSupported) {
    // Sin `MediaRecorder.isTypeSupported` (entorno raro) se asume webm/opus,
    // el default de Chromium/WebView2.
    return VOICEOVER_MIME_CANDIDATES[0] ?? null;
  }
  for (const mime of VOICEOVER_MIME_CANDIDATES) {
    try {
      if (isSupported(mime)) return mime;
    } catch {
      // Un probe que explota no invalida al resto de candidatos.
    }
  }
  return null;
}

/** Extensión de archivo para un MIME de audio grabado. */
export function voiceoverExtensionForMime(mimeType: string): string {
  const mime = mimeType.toLowerCase();
  if (mime.includes('wav')) return 'wav';
  // `audio/webm;codecs=opus` contiene "opus": webm va antes que ogg/opus.
  if (mime.includes('webm')) return 'webm';
  if (mime.includes('mp4') || mime.includes('m4a') || mime.includes('aac')) return 'm4a';
  if (mime.includes('mpeg') || mime.includes('mp3')) return 'mp3';
  if (mime.includes('flac')) return 'flac';
  if (mime.includes('ogg') || mime.includes('opus')) return 'ogg';
  return 'webm';
}

/** `voz-AAAAMMDD-HHMMSS.wav` en hora local; sirve de nombre y de etiqueta. */
export function voiceoverFileName(date: Date, extension: string): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  const stamp =
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  const ext = extension.toLowerCase().replace(/[^a-z0-9]/g, '') || 'webm';
  const safe = CONTAINER_EXTENSIONS.has(ext) ? ext : 'webm';
  return `voz-${stamp}.${safe}`;
}

/** Subconjunto de `AudioBuffer` que necesita el encoder (testeable sin DOM). */
export interface PcmAudioSource {
  readonly numberOfChannels: number;
  readonly length: number;
  readonly sampleRate: number;
  getChannelData(channel: number): Float32Array;
}

/**
 * PCM float32 → WAV PCM16 (formato canónico de la narración del proyecto).
 * Intercala canales, clampea a [-1, 1] y escribe la cabecera RIFF estándar.
 */
export function encodeWavPcm16(source: PcmAudioSource): ArrayBuffer {
  const channels = Math.max(1, Math.min(2, source.numberOfChannels));
  const frames = Math.max(0, source.length);
  const bytesPerSample = 2;
  const blockAlign = channels * bytesPerSample;
  const dataSize = frames * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  };

  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true); // bloque fmt PCM
  view.setUint16(20, 1, true); // audio format = PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, source.sampleRate, true);
  view.setUint32(28, source.sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // bits por sample
  writeAscii(36, 'data');
  view.setUint32(40, dataSize, true);

  const channelData = Array.from({ length: channels }, (_, index) =>
    source.getChannelData(index),
  );
  let offset = 44;
  for (let frame = 0; frame < frames; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const sample = channelData[channel]![frame] ?? 0;
      const clamped = Math.max(-1, Math.min(1, sample));
      const int16 =
        clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff);
      view.setInt16(offset, int16, true);
      offset += 2;
    }
  }
  return buffer;
}

/**
 * Blob grabado → WAV PCM 48 kHz (máx. 2 canales) listo para importar.
 * Devuelve `null` cuando Web Audio no está disponible o la decodificación
 * falla: el llamador cae al contenedor original.
 */
export async function blobToWavPcm(
  blob: Blob,
): Promise<{ readonly bytes: Uint8Array; readonly durationSeconds: number } | null> {
  if (
    typeof OfflineAudioContext === 'undefined' ||
    typeof Blob === 'undefined' ||
    blob.size === 0
  ) {
    return null;
  }
  try {
    const encoded = await blob.arrayBuffer();
    // `decodeAudioData` vive en BaseAudioContext: un contexto offline de 1
    // frame alcanza para decodificar sin reproducir.
    const decoder = new OfflineAudioContext(1, 1, VOICEOVER_WAV_SAMPLE_RATE);
    const decoded = await decoder.decodeAudioData(encoded);
    if (
      decoded.numberOfChannels === 0 ||
      decoded.length === 0 ||
      !Number.isFinite(decoded.duration) ||
      decoded.duration <= 0
    ) {
      return null;
    }
    const channels = Math.min(2, decoded.numberOfChannels);
    const frames = Math.max(1, Math.ceil(decoded.duration * VOICEOVER_WAV_SAMPLE_RATE));
    const renderer = new OfflineAudioContext(channels, frames, VOICEOVER_WAV_SAMPLE_RATE);
    const source = renderer.createBufferSource();
    source.buffer = decoded;
    source.connect(renderer.destination);
    source.start(0);
    const rendered = await renderer.startRendering();
    const wav = encodeWavPcm16(rendered);
    if (wav.byteLength <= 44) return null;
    return {
      bytes: new Uint8Array(wav),
      durationSeconds: rendered.duration,
    };
  } catch {
    return null;
  }
}

/** Uint8Array → base64 para el comando IPC (viaja como string JSON). */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
}

/** `m:ss` para el tiempo transcurrido de la grabación. */
export function formatVoiceoverElapsed(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
