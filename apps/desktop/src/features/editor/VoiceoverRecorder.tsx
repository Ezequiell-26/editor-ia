import { useEffect, useRef, useState } from 'react';
import { Icon } from '../../components/Icon';
import { useProjectStore } from '../../state/project-store';
import { addAsset, addClipFromAsset, markAssetReady } from '../../state/project-actions';
import {
  blobToWavPcm,
  bytesToBase64,
  formatVoiceoverElapsed,
  pickVoiceoverMimeType,
  VOICEOVER_MAX_SECONDS,
  voiceoverExtensionForMime,
  voiceoverFileName,
} from './voiceover';

export type RecorderPhase = 'idle' | 'requesting' | 'recording' | 'importing';

function mediaErrorMessage(error: unknown): string {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') {
    return 'Permiso de micrófono denegado. Habilitalo en los permisos del sitio y probá de nuevo.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError') {
    return 'No se encontró ningún micrófono en este equipo.';
  }
  return error instanceof Error && error.message
    ? `No se pudo abrir el micrófono: ${error.message}`
    : 'No se pudo abrir el micrófono.';
}

/**
 * Botón «Grabar voz» de la toolbar de la timeline: graba el micrófono con
 * MediaRecorder, convierte a WAV PCM 48 kHz (o importa el contenedor si el
 * decode falla) y monta el clip en la pista de narración del playhead donde
 * empezó la grabación. La misma acción queda disponible en «Más herramientas»
 * y en la barra rápida personalizable (disparan este botón por aria-label).
 */
export function VoiceoverRecorder({
  onPhaseChange,
}: {
  /** Aviso de fase para hosts que sincronizan UI (p. ej. el teleprompter
   *  arranca el scroll cuando la grabación empieza de verdad). */
  readonly onPhaseChange?: ((phase: RecorderPhase) => void) | undefined;
} = {}) {
  const store = useProjectStore();
  const [phase, setPhase] = useState<RecorderPhase>('idle');
  const [elapsed, setElapsed] = useState(0);
  const phaseRef = useRef<RecorderPhase>('idle');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeRef = useRef('');
  const startedAtRef = useRef(0);
  const atFrameRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  // Token de la solicitud de micrófono en curso: se incrementa al iniciar y
  // al desmontar; si `getUserMedia` resuelve con un token viejo, el stream
  // se libera sin grabar (la vista que lo pidió ya no existe).
  const startTokenRef = useRef(0);
  // Proyecto que recibió la grabación: la conversión y la importación son
  // async; si el usuario cambia de proyecto a mitad de camino, la toma no
  // debe aterrizar en el proyecto equivocado.
  const projectIdRef = useRef<string | null>(null);

  const setPhaseBoth = (next: RecorderPhase) => {
    phaseRef.current = next;
    setPhase(next);
    onPhaseChange?.(next);
  };

  const releaseStream = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  /** Detiene tracks y limpia el recorder una vez que `onstop` ya corrió. */
  const cleanup = () => {
    clearTimer();
    recorderRef.current = null;
    chunksRef.current = [];
    projectIdRef.current = null;
    releaseStream();
  };

  useEffect(
    () => () => {
      // Al desmontar la timeline: no dejar el micrófono tomado ni aceptar
      // una respuesta de `getUserMedia` que llegue tarde.
      startTokenRef.current += 1;
      clearTimer();
      try {
        recorderRef.current?.stop();
      } catch {
        // Ya estaba detenido.
      }
      releaseStream();
    },
    [],
  );

  const finalizeRecording = async () => {
    const blob = new Blob(chunksRef.current, { type: mimeRef.current || 'audio/webm' });
    const recordedAt = new Date();
    let fileName = voiceoverFileName(recordedAt, voiceoverExtensionForMime(mimeRef.current));
    let bytes: Uint8Array;
    try {
      // Camino preferido: WAV PCM 48 kHz, igual que la narración TTS.
      const wav = await blobToWavPcm(blob);
      if (wav) {
        bytes = wav.bytes;
        fileName = voiceoverFileName(recordedAt, 'wav');
      } else {
        // Fallback honesto: el contenedor que grabó MediaRecorder
        // (webm/opus, mp4/aac…); ffprobe/FFmpeg del proyecto lo leen igual.
        const raw = new Uint8Array(await blob.arrayBuffer());
        if (raw.byteLength === 0) {
          store.setNotice('La grabación quedó vacía; probá de nuevo.');
          setPhaseBoth('idle');
          cleanup();
          return;
        }
        bytes = raw;
      }
    } catch {
      store.setNotice('No se pudo procesar el audio grabado.');
      setPhaseBoth('idle');
      cleanup();
      return;
    }

    // `getProject()` lee el store vivo: `state.project` sería la foto del
    // render que creó este closure y no vería un cambio de proyecto hecho
    // mientras la conversión async estaba en vuelo.
    const project = store.getProject();
    const expectedProjectId = projectIdRef.current;
    if (!project || project.id !== expectedProjectId) {
      store.setNotice(
        project
          ? 'El proyecto cambió durante la grabación; la voz no se importó.'
          : 'No hay proyecto abierto para recibir la voz grabada.',
      );
      setPhaseBoth('idle');
      setElapsed(0);
      cleanup();
      return;
    }
    const frameRate = project.video.frameRate;
    try {
      const outcome = await store.service.importMediaBytes({
        fileName,
        dataBase64: bytesToBase64(bytes),
        fpsNum: frameRate.num,
        fpsDen: frameRate.den,
      });
      const asset = outcome.assets[0];
      if (!asset) {
        store.setNotice(
          outcome.warnings[0] ?? 'No se pudo importar la voz grabada.',
        );
        return;
      }
      // La importación también es async: si el proyecto volvió a cambiar,
      // el asset ya quedó en disco pero no se monta en el proyecto nuevo.
      const liveProject = store.getProject();
      if (!liveProject || liveProject.id !== expectedProjectId) {
        store.setNotice(
          'El proyecto cambió durante la importación; la voz quedó en Medios sin montar.',
        );
        return;
      }
      // El audio lo grabó el usuario: se declara la licencia como en el
      // resto de imports declarados y se monta en la pista de narración.
      let clipId: string | null = null;
      const mounted = store.mutate((current) => {
        let next = addAsset(current, asset);
        next = markAssetReady(next, asset.id, 'allowed');
        const ready = next.assets.find((item) => item.id === asset.id) ?? asset;
        const result = addClipFromAsset(next, ready, {
          atFrame: atFrameRef.current,
          narration: true,
        });
        clipId = result.clipId;
        return { project: result.project };
      });
      if (mounted && clipId) {
        store.setSelection({ kind: 'clip', id: clipId });
        store.setNotice(
          `«${asset.label}» grabada y montada en la pista de narración.`,
        );
      } else {
        store.setNotice('La voz quedó en Medios pero no se pudo montar en la timeline.');
      }
    } catch (error) {
      store.setNotice(
        `No se pudo importar la voz grabada: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setPhaseBoth('idle');
      setElapsed(0);
      cleanup();
    }
  };

  const startRecording = async () => {
    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === 'undefined' ||
      typeof MediaRecorder.isTypeSupported !== 'function'
    ) {
      store.setNotice('Este entorno no soporta grabación de micrófono.');
      return;
    }
    if (!store.state.project || !store.state.opened) {
      store.setNotice(
        'Abrí o guardá el proyecto primero: la voz se graba dentro de la carpeta del proyecto.',
      );
      return;
    }
    projectIdRef.current = store.getProject()?.id ?? store.state.project.id;
    const mime = pickVoiceoverMimeType((candidate) =>
      MediaRecorder.isTypeSupported(candidate),
    );
    if (!mime) {
      store.setNotice('Este equipo no tiene un formato de audio grabable compatible.');
      return;
    }
    store.setPlaying(false);
    const token = ++startTokenRef.current;
    setPhaseBoth('requesting');
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (error) {
      if (token === startTokenRef.current) {
        setPhaseBoth('idle');
        store.setNotice(mediaErrorMessage(error));
      }
      return;
    }
    if (token !== startTokenRef.current) {
      // Se desmontó (o arrancó otra solicitud) mientras se pedía el permiso:
      // soltar el stream sin crear el recorder ni tocar el estado.
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    streamRef.current = stream;
    chunksRef.current = [];
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType: mime });
    } catch {
      releaseStream();
      setPhaseBoth('idle');
      store.setNotice('No se pudo iniciar la grabación de audio.');
      return;
    }
    mimeRef.current = recorder.mimeType || mime;
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      void finalizeRecording();
    };
    recorderRef.current = recorder;
    atFrameRef.current = store.getPlayhead();
    startedAtRef.current = performance.now();
    recorder.start(250);
    setPhaseBoth('recording');
    setElapsed(0);
    timerRef.current = window.setInterval(() => {
      const seconds = (performance.now() - startedAtRef.current) / 1000;
      setElapsed(seconds);
      if (seconds >= VOICEOVER_MAX_SECONDS) {
        // Tope honesto: una voz de más de 10 minutos se corta sola.
        store.setNotice('Grabación detenida: se alcanzó el máximo de 10 minutos.');
        clearTimer();
        setPhaseBoth('importing');
        recorderRef.current?.stop();
      }
    }, 500);
  };

  const onClick = () => {
    if (phaseRef.current === 'recording') {
      // `onstop` dispara finalizeRecording: pasar a importing explícito
      // evita que el botón quede "idle" durante la importación.
      try {
        recorderRef.current?.stop();
      } catch {
        // Ya detenido.
      }
      clearTimer();
      setPhaseBoth('importing');
      return;
    }
    if (phaseRef.current !== 'idle') return;
    void startRecording();
  };

  const recording = phase === 'recording';
  const requesting = phase === 'requesting';
  const importing = phase === 'importing';
  return (
    <button
      type="button"
      className={recording ? 'small ghost voiceover-toggle recording' : 'small ghost voiceover-toggle'}
      aria-label="Grabar voz"
      aria-pressed={recording}
      disabled={importing || requesting}
      title={
        recording
          ? `Grabando voz · ${formatVoiceoverElapsed(elapsed)} · clic para detener y montar en la pista de narración`
          : requesting
            ? 'Pidiendo permiso de micrófono…'
            : importing
              ? 'Importando la voz grabada al proyecto…'
              : 'Grabar voz con el micrófono y montarla en la pista de narración del playhead'
      }
      onClick={onClick}
    >
      <Icon name={recording ? 'stop' : 'mic'} size={13} />
      <span className="tool-label">
        {recording
          ? formatVoiceoverElapsed(elapsed)
          : requesting
            ? 'Pidiendo…'
            : importing
              ? 'Importando…'
              : 'Voz'}
      </span>
    </button>
  );
}
