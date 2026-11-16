import { useEffect, useRef, useState } from 'react';
import type { Clip } from '@editor-ia/project-schema';
import type { ClipFxSpec } from '../mixer/clip-audio-fx';
import {
  createReversedWindowBuffer,
  decodePreviewAudio,
  previewAudioContext,
  startPreviewReversedAudio,
  type PreviewReversedVoice,
} from '../mixer/usePreviewAudio';
import {
  reversedAudioPlan,
  reversedBufferOffsetSeconds,
  reversedBufferRate,
} from '../mixer/reverse-window';

/**
 * Audio de un clip `reverse` en la preview del monitor.
 *
 * Cuando el clip no es `reverse` (o no tiene plan válido) el hook no hace
 * nada: el `<audio>`/`<video>` de la capa sigue sonando por la vía normal.
 * Con `reverse` la capa silencia su elemento y esta voz reproduce la ventana
 * de fuente invertida por Web Audio, sincronizada con el playhead.
 *
 * La decodificación es asíncrona y una sola por archivo mientras el clip
 * esté montado; el buffer decodificado se retiene en un ref para que un
 * re-trim de la ventana no vuelva a decodificar el archivo entero.
 */
export interface ReversedClipAudioOptions {
  readonly clip: Clip;
  /** URL del medio (misma que usa la capa de media). */
  readonly url: string;
  readonly playing: boolean;
  /** Frame local del clip (`playheadFrame - clip.startFrame`). */
  readonly localFrame: number;
  readonly playbackRate: number;
  readonly fps: number;
  readonly trackId: string;
  /** Ganancia del clip en dB (keyframes de volumen incluidos). */
  readonly gainDb: number;
  readonly pan: number;
  readonly fx: readonly ClipFxSpec[];
  /** Mute del clip / lead de transición: la voz queda en silencio. */
  readonly silent: boolean;
}

export function useReversedClipAudio(options: ReversedClipAudioOptions): void {
  const { clip, url, playing, localFrame, playbackRate, fps, trackId, gainDb, pan, fx, silent } =
    options;
  const plan = reversedAudioPlan(clip, fps);
  const voiceRef = useRef<PreviewReversedVoice | null>(null);
  const decodedRef = useRef<{ key: string; buffer: AudioBuffer } | null>(null);
  const windowRef = useRef<AudioBuffer | null>(null);
  // La decodificación es async: este tick fuerza el re-render que arranca la
  // voz apenas la ventana invertida queda lista (sin esperar al próximo frame).
  const [, setWindowReady] = useState(0);

  // Decodifica una vez por archivo y reconstruye la ventana invertida
  // cuando cambia el plan (trim, speed). El buffer decodificado queda en
  // `decodedRef` para re-trims baratos; la ventana es la que suena.
  useEffect(() => {
    windowRef.current = null;
    if (!plan || !url) return;
    const ctx = previewAudioContext();
    if (!ctx) return;
    const decodeKey = `${clip.id}:${url}`;
    let cancelled = false;
    const buildWindow = (decoded: AudioBuffer) => {
      if (cancelled || !plan) return;
      windowRef.current = createReversedWindowBuffer(ctx, decoded, plan);
      setWindowReady((version) => version + 1);
    };
    const cached = decodedRef.current;
    if (cached && cached.key === decodeKey) {
      buildWindow(cached.buffer);
      return;
    }
    void decodePreviewAudio(url).then((decoded) => {
      if (cancelled || !decoded) return;
      decodedRef.current = { key: decodeKey, buffer: decoded };
      buildWindow(decoded);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `plan` se compara por primitivas.
  }, [clip.id, url, plan?.windowStartSec, plan?.windowEndSec, plan?.speed]);

  // Sincronización por frame: ajusta offset/rate/ganancia/paneo/FX y
  // re-posiciona el buffer source sólo cuando el playhead derivó.
  useEffect(() => {
    const canPlay =
      plan !== null &&
      playing &&
      !silent &&
      trackId !== '' &&
      localFrame >= 0 &&
      localFrame < clip.durationFrames;
    const rate = plan ? reversedBufferRate(plan.speed, playbackRate) : 0;
    if (!canPlay || rate <= 0.001 || !windowRef.current) {
      voiceRef.current?.stop();
      voiceRef.current = null;
      return;
    }
    const state = {
      offsetSec: reversedBufferOffsetSeconds(localFrame, plan.speed, fps),
      rate,
      gainDb,
      pan,
      fx,
    };
    const voice = voiceRef.current;
    if (voice) {
      voice.sync(state);
    } else {
      voiceRef.current = startPreviewReversedAudio({
        key: clip.id,
        trackId,
        buffer: windowRef.current,
        ...state,
      });
    }
  });

  // Al desmontar o cambiar de clip, la voz invertida se cierra.
  useEffect(
    () => () => {
      voiceRef.current?.stop();
      voiceRef.current = null;
    },
    [clip.id],
  );
}
