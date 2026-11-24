import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { hideMediaSpy, useMediaSpy } from '../../state/media-spy';
import { useProjectStore } from '../../state/project-store';
import { addClipFromAsset, fpsOf, totalFrames } from '../../state/project-actions';
import { useWaveform } from '../../hooks/useWaveform';
import { createRafCoalescer } from './timeline-raf';

function mmss(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

/**
 * Espía de medios sobre el monitor (paridad `espiada_midia.js`): mientras
 * el puntero recorre la tarjeta de un medio en la biblioteca, muestra el
 * frame del instante bajo el cursor con su timecode.
 *
 * Un solo <video> por medio visible: `currentTime` se actualiza
 * coalescido por frame (el puntero puede emitir 100+ eventos/segundo).
 *
 * Con `pinned` (clic en la tarjeta) el overlay se vuelve un source
 * monitor: controles nativos de <video> (play/pausa/seek/volumen),
 * marcas I/O sobre el tiempo actual e «Insertar» que monta el rango en
 * la timeline del proyecto en el playhead. Escape o el clic de nuevo
 * sueltan el pin.
 */
export function MediaSpyOverlay() {
  const spy = useMediaSpy();
  const store = useProjectStore();
  const mediaRef = useRef<HTMLMediaElement | null>(null);
  const coalescerRef = useRef<ReturnType<typeof createRafCoalescer<number>> | null>(null);
  const [liveTime, setLiveTime] = useState<number | null>(null);
  const [markIn, setMarkIn] = useState<number | null>(null);
  const [markOut, setMarkOut] = useState<number | null>(null);
  const [loopRange, setLoopRange] = useState(false);
  const [targetTrackId, setTargetTrackId] = useState('');
  const boxRef = useRef<HTMLDivElement | null>(null);
  // Content-box del video dentro del overlay (object-fit: contain puede
  // dejar letterbox): {left, width} en px, null hasta conocer metadata.
  const [contentBox, setContentBox] = useState<{ left: number; width: number } | null>(
    null,
  );

  const interactive = Boolean(
    spy?.pinned && (spy.kind === 'video' || spy.kind === 'audio'),
  );

  // Las marcas son del medio: al cambiar de asset vuelven a cero.
  useEffect(() => {
    setMarkIn(null);
    setMarkOut(null);
    setLoopRange(false);
    setTargetTrackId('');
  }, [spy?.assetId]);

  // Alta/baja del medio (video o audio): sólo cuando cambia el espiado.
  useEffect(() => {
    const media = mediaRef.current;
    setLiveTime(null);
    if (!media || !spy || spy.kind === 'image') return;
    media.src = spy.url;
    media.muted = true;
    media.preload = 'auto';
    media.load();
  }, [spy?.assetId, spy?.url, spy?.kind]); // eslint-disable-line react-hooks/exhaustive-deps

  // El video del espía va siempre muteado; el audio sólo suena con el
  // pin puesto (el hover nunca reproduce, pero si el usuario le da play
  // desde los controles quiere escuchar).
  useEffect(() => {
    const media = mediaRef.current;
    if (!media || !spy || spy.kind === 'image') return;
    media.muted = spy.kind === 'video' || !interactive;
  }, [interactive, spy?.assetId, spy?.kind]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cambio de asset: descarta el seek pendiente del medio anterior — un
  // flush acá aplicaría el timestamp viejo sobre el <src> nuevo (AUD-151).
  const spyKey = `${spy?.assetId ?? ''}:${spy?.kind ?? ''}`;
  const prevSpyKey = useRef(spyKey);
  useEffect(() => {
    if (prevSpyKey.current !== spyKey) {
      prevSpyKey.current = spyKey;
      coalescerRef.current?.cancel();
    }
  }, [spyKey]);

  // Seek coalescido por frame hacia el instante bajo el cursor. Sin
  // cleanup con flush: el efecto se re-ejecuta en CADA pointer-move
  // (spy.timeSeconds) y flushear ahí anulaba el coalescing — un seek por
  // evento en vez de uno por frame (AUD-151). El pendiente sólo se
  // descarta al cambiar de asset (efecto de arriba) o al desmontar.
  useEffect(() => {
    const media = mediaRef.current;
    if (!media || !spy || spy.kind === 'image') return;
    if (!coalescerRef.current) {
      coalescerRef.current = createRafCoalescer<number>((t) => {
        const m = mediaRef.current;
        if (m && Number.isFinite(t)) m.currentTime = t;
      });
    }
    coalescerRef.current.push(spy.timeSeconds);
  }, [spy?.timeSeconds, spy?.assetId, spy?.kind]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pin activado: el video reproduce muteado (autoplay permitido). El
  // audio NO autoarranca con sonido — el autoplay con audio es rechazado
  // por el navegador; el usuario le da play desde los controles nativos.
  useEffect(() => {
    const media = mediaRef.current;
    if (!interactive || !media || spy?.kind !== 'video') return;
    if (media.paused) void Promise.resolve(media.play()).catch(() => {});
  }, [interactive, spy?.assetId, spy?.kind]); // eslint-disable-line react-hooks/exhaustive-deps

  // Al soltar el pin el medio queda en pausa: si siguiera corriendo, el
  // hover-scrub pelearía con currentTime avanzando solo.
  useEffect(() => {
    const media = mediaRef.current;
    if (media && !interactive && !media.paused) media.pause();
  }, [interactive]);

  useEffect(
    () => () => {
      coalescerRef.current?.cancel();
      coalescerRef.current = null;
    },
    [],
  );

  const shownTimeRef = useRef(0);
  // Espejo de las marcas para los handlers estables (teclado/drag): el
  // listener de keydown se registra una sola vez y no puede cerrar sobre
  // el estado del render en que nació.
  const marksRef = useRef({ in: null as number | null, out: null as number | null });
  marksRef.current = { in: markIn, out: markOut };

  // Marcar entrada/salida nunca invierte el rango: in se clampa a <= out
  // y viceversa (AUD-152 — antes un O posterior a un I lejano insertaba
  // un clip de 1 frame forzado por Math.max).
  function markSourceIn(t: number): void {
    const out = marksRef.current.out;
    setMarkIn(out === null ? t : Math.min(t, out));
  }
  function markSourceOut(t: number): void {
    const inn = marksRef.current.in;
    setMarkOut(inn === null ? t : Math.max(t, inn));
  }

  // Geometría del content-box: las líneas de marcas/playhead se posicionan
  // sobre el medio real, no sobre el overlay. Video: letterbox-safe con
  // object-fit contain. Audio: el "medio" es todo el ancho del monitor.
  useEffect(() => {
    if (!interactive) {
      setContentBox(null);
      return;
    }
    const box = boxRef.current;
    const media = mediaRef.current;
    if (!box || !media) return;
    const compute = () => {
      const cw = box.clientWidth;
      if (spy?.kind === 'audio') {
        setContentBox(cw > 0 ? { left: 0, width: cw } : null);
        return;
      }
      const video = media as HTMLVideoElement;
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      const ch = box.clientHeight;
      if (!vw || !vh || !cw || !ch) {
        setContentBox(null);
        return;
      }
      const scale = Math.min(cw / vw, ch / vh);
      const width = vw * scale;
      setContentBox({ left: (cw - width) / 2, width });
    };
    compute();
    media.addEventListener('loadedmetadata', compute);
    // jsdom no implementa ResizeObserver; el webview de Tauri sí.
    const observer =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(compute) : null;
    observer?.observe(box);
    return () => {
      media.removeEventListener('loadedmetadata', compute);
      observer?.disconnect();
    };
  }, [interactive, spy?.assetId, spy?.kind]); // eslint-disable-line react-hooks/exhaustive-deps

  // Escape suelta el pin; con pin interactivo, I/O marcan el rango en el
  // tiempo mostrado y ,/. avanzan/retrasan un frame (Shift: un segundo).
  // El listener va en FASE CAPTURE: las mismas teclas (I/O de secuencia,
  // ,/. del playhead) también las escuchan Timeline/EditorWorkspace en
  // bubble — sin stopPropagation el pin marcaría el source Y movería el
  // playhead/setearía el in-point de la secuencia a la vez.
  useEffect(() => {
    if (!spy?.pinned) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (event.key === 'Escape') {
        hideMediaSpy();
        return;
      }
      if (!interactive) return;
      const bare = !event.ctrlKey && !event.metaKey && !event.altKey;
      if (!bare) return;
      if (event.key === 'i' || event.key === 'I') {
        event.stopPropagation();
        markSourceIn(shownTimeRef.current);
      } else if (event.key === 'o' || event.key === 'O') {
        event.stopPropagation();
        markSourceOut(shownTimeRef.current);
      } else if (
        event.key === ',' ||
        event.key === '.' ||
        event.key === '<' ||
        event.key === '>'
      ) {
        event.stopPropagation();
        stepSourceMedia(event.key === ',' || event.key === '<' ? -1 : 1, event.shiftKey);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [spy?.pinned, interactive, store]); // eslint-disable-line react-hooks/exhaustive-deps

  // Waveform real del medio pineado (video o audio): picos decodificados
  // por FFmpeg con cache — sólo se pide con pin activo para no disparar
  // un decode por cada hover sobre la biblioteca.
  const spyAsset =
    store.state.project?.assets.find((item) => item.id === spy?.assetId) ?? null;
  const spyWaveform = useWaveform(
    store.service,
    store.state.opened?.root ?? null,
    interactive ? spyAsset : null,
    480,
    store.state.project ? fpsOf(store.state.project) : undefined,
  );

  if (!spy) return null;

  const shownTime = spy.pinned && liveTime !== null ? liveTime : spy.timeSeconds;
  shownTimeRef.current = shownTime;
  const hasMarks = markIn !== null || markOut !== null;
  // Rango degenerado (in == out tras el clamp): no hay nada que insertar.
  const rangeInvalid =
    markIn !== null && markOut !== null && markOut <= markIn;
  // Pistas compatibles con el medio espiado: video → pistas video;
  // audio → pistas audio/narration (misma regla que addClipFromAsset).
  const spyTrackKinds =
    spy?.kind === 'audio' ? (['audio', 'narration'] as const) : (['video'] as const);
  const targetTracks = (store.state.project?.timeline.tracks ?? []).filter(
    (track) =>
      (spyTrackKinds as readonly string[]).includes(track.kind) && !track.locked,
  );

  // `atEnd` inserta al final de la timeline (append) en vez del playhead.
  function insertMarkedRange(atEnd = false): void {
    if (!spy || !interactive) return;
    const project = store.state.project;
    const asset = project?.assets.find((item) => item.id === spy.assetId);
    if (!project || !asset || (asset.kind !== 'video' && asset.kind !== 'audio')) {
      store.setNotice('El material espiado ya no está en el proyecto.');
      return;
    }
    const media = asset.media;
    // Video: frames a su frameRate propio. Audio: frames a la cadencia
    // del proyecto (así se midió durationFrames al importar, AUD-039).
    const fps =
      asset.kind === 'audio'
        ? fpsOf(project)
        : media && 'frameRate' in media && media.frameRate.den > 0
          ? media.frameRate.num / media.frameRate.den
          : 30;
    const inFrame = Math.max(0, Math.round((markIn ?? 0) * fps));
    const outFrame = Math.max(
      inFrame + 1,
      Math.round((markOut ?? spy.durationSeconds) * fps),
    );
    const result = store.mutate((current) =>
      addClipFromAsset(current, asset, {
        atFrame: atEnd ? totalFrames(current) : store.getPlayhead(),
        inFrame,
        outFrame,
        ...(targetTrackId ? { trackId: targetTrackId } : {}),
      }),
    );
    if (result) {
      store.setNotice(
        `${asset.label}: rango ${mmss(markIn ?? 0)}–${mmss(markOut ?? spy.durationSeconds)} insertado ${atEnd ? 'al final' : 'en el playhead'}.`,
      );
      // El pin queda activo (flujo de source monitor: encadenar varios
      // rangos del mismo medio sin re-pinear) y las marcas se limpian
      // para el siguiente rango. Escape o clic sueltan el pin.
      setMarkIn(null);
      setMarkOut(null);
      setLoopRange(false);
    }
  }

  // Imagen fijada: no hay rango que marcar — inserta el still completo.
  function insertWholeAsset(atEnd = false): void {
    if (!spy?.pinned) return;
    const project = store.state.project;
    const asset = project?.assets.find((item) => item.id === spy.assetId);
    if (!project || !asset) {
      store.setNotice('El material espiado ya no está en el proyecto.');
      return;
    }
    const result = store.mutate((current) =>
      addClipFromAsset(current, asset, {
        atFrame: atEnd ? totalFrames(current) : store.getPlayhead(),
      }),
    );
    if (result) {
      store.setNotice(
        `${asset.label} insertado ${atEnd ? 'al final' : 'en el playhead'}.`,
      );
    }
  }

  // Frame-step del source (teclas ,/.): un frame = 1/fps del medio
  // (video: su frameRate; audio: cadencia del proyecto — AUD-039).
  // Shift convierte el paso a 1 segundo.
  function stepSourceMedia(direction: -1 | 1, wholeSecond: boolean): void {
    const media = mediaRef.current;
    if (!media || !spy) return;
    const project = store.state.project;
    const asset = project?.assets.find((item) => item.id === spy.assetId);
    const mediaInfo =
      asset?.kind === 'video' && 'media' in asset ? asset.media : undefined;
    const fps =
      asset?.kind === 'audio'
        ? project
          ? fpsOf(project)
          : 30
        : mediaInfo && 'frameRate' in mediaInfo && mediaInfo.frameRate.den > 0
          ? mediaInfo.frameRate.num / mediaInfo.frameRate.den
          : project
            ? fpsOf(project)
            : 30;
    const delta = wholeSecond ? direction : direction / Math.max(1, fps);
    const base = Number.isFinite(media.currentTime)
      ? media.currentTime
      : shownTimeRef.current;
    const next = Math.min(
      spy.durationSeconds,
      Math.max(0, base + delta),
    );
    media.currentTime = next;
    setLiveTime(next);
  }

  const markX = (seconds: number): number | null => {
    if (!contentBox || !(spy.durationSeconds > 0)) return null;
    const ratio = Math.min(1, Math.max(0, seconds / spy.durationSeconds));
    return contentBox.left + ratio * contentBox.width;
  };

  // Arrastre de ticks: pointerdown sobre in/out mueve la marca siguiendo
  // el puntero. Las marcas no pueden cruzarse: in se clampa a <= out y
  // viceversa (si la otra no existe, el límite es el borde del medio).
  function startMarkDrag(kind: 'in' | 'out', event: ReactPointerEvent<HTMLElement>): void {
    event.preventDefault();
    event.stopPropagation();
    const box = boxRef.current;
    const duration = spy?.durationSeconds ?? 0;
    if (!box || !contentBox || !(duration > 0)) return;
    const applyX = (clientX: number) => {
      const rect = box.getBoundingClientRect();
      const x = clientX - rect.left;
      const ratio = Math.min(
        1,
        Math.max(0, (x - contentBox.left) / contentBox.width),
      );
      const seconds = ratio * duration;
      if (kind === 'in') {
        const limit = markOut ?? duration;
        const value = Math.min(seconds, limit);
        setMarkIn(value);
      } else {
        const floor = markIn ?? 0;
        const value = Math.max(seconds, floor);
        setMarkOut(value);
      }
    };
    applyX(event.clientX);
    const onMove = (move: PointerEvent) => applyX(move.clientX);
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  // timeupdate compartido por <video> y <audio>: actualiza el timecode
  // vivo y, con loop activo, reinicia el rango marcado al llegar a out.
  function handleMediaTimeUpdate(media: HTMLMediaElement): void {
    if (!interactive || !spy) return;
    const out = markOut !== null ? Math.min(markOut, spy.durationSeconds) : null;
    if (loopRange && out !== null && media.currentTime >= out) {
      media.currentTime = markIn ?? 0;
      setLiveTime(media.currentTime);
      return;
    }
    setLiveTime(media.currentTime);
  }

  return (
    <div
      ref={boxRef}
      className={`media-spy${interactive ? ' media-spy-interactive' : ''}`}
      aria-hidden={!interactive}
    >
      {spy.kind === 'image' ? (
        <img className="media-spy-media" src={spy.url} alt="" draggable={false} />
      ) : spy.kind === 'audio' ? (
        <audio
          ref={(el) => {
            mediaRef.current = el;
          }}
          className="media-spy-media media-spy-audio"
          preload="auto"
          controls={interactive}
          onTimeUpdate={(event) => handleMediaTimeUpdate(event.currentTarget)}
        />
      ) : (
        <video
          ref={(el) => {
            mediaRef.current = el;
          }}
          className="media-spy-media"
          muted
          playsInline
          preload="auto"
          controls={interactive}
          onTimeUpdate={(event) => handleMediaTimeUpdate(event.currentTarget)}
        />
      )}
      <span className="media-spy-time">{mmss(shownTime)}</span>
      {interactive && spyWaveform && spyWaveform.length > 0 ? (
        <div className="media-spy-wave" aria-hidden="true">
          <svg
            viewBox={`0 0 ${spyWaveform.length} 100`}
            preserveAspectRatio="none"
          >
            {hasMarks && spy.durationSeconds > 0
              ? (() => {
                  // La onda cubre el asset entero: las marcas en segundos
                  // se proyectan a buckets (mismo criterio que los ticks).
                  const n = spyWaveform.length;
                  const x0 =
                    ((markIn ?? 0) / spy.durationSeconds) * n;
                  const x1 =
                    ((markOut ?? spy.durationSeconds) / spy.durationSeconds) * n;
                  return (
                    <>
                      <rect
                        className="media-spy-wave-dim"
                        x={0}
                        y={0}
                        width={Math.max(0, x0)}
                        height={100}
                      />
                      <rect
                        className="media-spy-wave-dim"
                        x={x1}
                        y={0}
                        width={Math.max(0, n - x1)}
                        height={100}
                      />
                      <rect
                        className="media-spy-wave-sel"
                        x={x0}
                        y={0}
                        width={Math.max(0, x1 - x0)}
                        height={100}
                      />
                    </>
                  );
                })()
              : null}
            {spyWaveform.map((peak, index) => {
              const v = Math.min(1, peak);
              const h = Math.max(1, v * 96);
              return (
                <rect
                  key={index}
                  x={index}
                  y={50 - h / 2}
                  width={1}
                  height={h}
                />
              );
            })}
          </svg>
        </div>
      ) : null}
      {interactive && contentBox ? (
        <div className="media-spy-ruler" aria-hidden="true">
          {markIn !== null && markX(markIn) !== null ? (
            <i
              className="media-spy-tick media-spy-tick-in"
              style={{ left: markX(markIn)! }}
              onPointerDown={(event) => startMarkDrag('in', event)}
            />
          ) : null}
          {markOut !== null && markX(markOut) !== null ? (
            <i
              className="media-spy-tick media-spy-tick-out"
              style={{ left: markX(markOut)! }}
              onPointerDown={(event) => startMarkDrag('out', event)}
            />
          ) : null}
          {markX(shownTime) !== null ? (
            <i className="media-spy-tick media-spy-tick-play" style={{ left: markX(shownTime)! }} />
          ) : null}
        </div>
      ) : null}
      {spy.pinned ? (
        <span className="media-spy-pin" title="Preview fijada — clic en la tarjeta o Escape para soltar">
          fijado
        </span>
      ) : null}
      {spy.pinned && spy.kind === 'image' ? (
        <div className="media-spy-marks">
          <button
            type="button"
            className="media-spy-insert"
            onClick={() => insertWholeAsset(false)}
            title="Insertar la imagen en la timeline, en el playhead"
          >
            Insertar
          </button>
          <button
            type="button"
            className="media-spy-insert"
            onClick={() => insertWholeAsset(true)}
            title="Insertar la imagen al final de la timeline"
          >
            ＋Fin
          </button>
        </div>
      ) : null}
      {interactive ? (
        <div className="media-spy-marks">
          <button
            type="button"
            className="media-spy-mark"
            onClick={() => markSourceIn(shownTime)}
            title="Marcar entrada del rango en el tiempo actual (tecla I)"
          >
            I
          </button>
          <button
            type="button"
            className="media-spy-mark"
            onClick={() => markSourceOut(shownTime)}
            title="Marcar salida del rango en el tiempo actual (tecla O)"
          >
            O
          </button>
          {hasMarks ? (
            <>
              <span
                className={`media-spy-range${rangeInvalid ? ' media-spy-range-invalid' : ''}`}
              >
                {mmss(markIn ?? 0)}–{mmss(markOut ?? spy.durationSeconds)}
              </span>
              <button
                type="button"
                className="media-spy-mark"
                onClick={() => {
                  setMarkIn(null);
                  setMarkOut(null);
                }}
                title="Quitar las marcas del rango"
              >
                ✕
              </button>
            </>
          ) : null}
          <button
            type="button"
            className={`media-spy-loop${loopRange ? ' media-spy-loop-on' : ''}`}
            disabled={markOut === null || rangeInvalid}
            aria-pressed={loopRange}
            onClick={() => setLoopRange((value) => !value)}
            title={
              rangeInvalid
                ? 'El rango está vacío: entrada y salida coinciden'
                : hasMarks
                  ? 'Reproducir en loop sólo el rango marcado'
                  : 'Marcá primero la entrada (I) o la salida (O)'
            }
          >
            Loop
          </button>
          {targetTracks.length > 0 ? (
            <select
              className="media-spy-track"
              value={targetTrackId}
              onChange={(event) => setTargetTrackId(event.target.value)}
              title="Pista destino del insert (vacío = automática)"
            >
              <option value="">Auto</option>
              {targetTracks.map((track) => (
                <option key={track.id} value={track.id}>
                  {track.label}
                </option>
              ))}
            </select>
          ) : null}
          <button
            type="button"
            className="media-spy-insert"
            disabled={!hasMarks || rangeInvalid}
            onClick={() => insertMarkedRange(false)}
            title={
              rangeInvalid
                ? 'El rango está vacío: entrada y salida coinciden'
                : hasMarks
                  ? 'Insertar el rango marcado en la timeline, en el playhead'
                  : 'Marcá primero la entrada (I) o la salida (O)'
            }
          >
            Insertar
          </button>
          <button
            type="button"
            className="media-spy-insert"
            disabled={!hasMarks || rangeInvalid}
            onClick={() => insertMarkedRange(true)}
            title={
              rangeInvalid
                ? 'El rango está vacío: entrada y salida coinciden'
                : hasMarks
                  ? 'Insertar el rango marcado al final de la timeline'
                  : 'Marcá primero la entrada (I) o la salida (O)'
            }
          >
            ＋Fin
          </button>
        </div>
      ) : null}
    </div>
  );
}
