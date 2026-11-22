import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { ViewId } from '../../app/navigation';
import { Icon } from '../../components/Icon';
import { ViewToolbar } from '../../components/ViewToolbar';
import { useProjectStore } from '../../state/project-store';
import { VoiceoverRecorder, type RecorderPhase } from './VoiceoverRecorder';
import {
  TELEPROMPTER_DEFAULT_FONT,
  TELEPROMPTER_DEFAULT_WPM,
  TELEPROMPTER_MAX_FONT,
  TELEPROMPTER_MAX_WPM,
  TELEPROMPTER_MIN_FONT,
  TELEPROMPTER_MIN_WPM,
  clampTeleprompterFontSize,
  clampTeleprompterWpm,
  loadTeleprompterPrefs,
  loadTeleprompterScript,
  saveTeleprompterPrefs,
  saveTeleprompterScript,
  scriptFromProject,
  splitTeleprompterLines,
  teleprompterLineAt,
  teleprompterLineDurationMs,
  teleprompterTotalDurationMs,
} from './teleprompter';

/** Ritmo del motor de scroll: se recalcula la línea activa cada 100 ms. */
const SCROLL_TICK_MS = 100;

function formatMinutes(totalMs: number): string {
  const minutes = totalMs / 60_000;
  if (minutes < 1) return `${Math.max(1, Math.round(minutes * 60))} s`;
  return `${minutes.toFixed(1).replace('.', ',')} min`;
}

/**
 * Teleprompter del editor: guion editable con scroll automático por WPM,
 * línea actual resaltada, tamaño de fuente y wrap ajustables. El botón
 * «Grabar voz» es el MISMO `VoiceoverRecorder` de la timeline: cuando la
 * grabación arranca de verdad el scroll empieza junto a ella.
 */
export function TeleprompterView({
  onNavigate,
}: {
  readonly onNavigate?: ((id: ViewId) => void) | undefined;
} = {}) {
  const store = useProjectStore();
  const project = store.state.project;
  const projectId = project?.id ?? null;

  const [script, setScript] = useState('');
  const [wpm, setWpm] = useState(TELEPROMPTER_DEFAULT_WPM);
  const [fontSize, setFontSize] = useState(TELEPROMPTER_DEFAULT_FONT);
  const [wrap, setWrap] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [activeLine, setActiveLine] = useState(0);

  const lines = useMemo(() => splitTeleprompterLines(script), [script]);
  const durations = useMemo(
    () => lines.map((line) => teleprompterLineDurationMs(line, wpm)),
    [lines, wpm],
  );
  const totalMs = teleprompterTotalDurationMs(durations);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const lineRefs = useRef<Array<HTMLElement | null>>([]);
  const timerRef = useRef<number | null>(null);
  const positionRef = useRef(0);
  const lastTickRef = useRef(0);
  const durationsRef = useRef<readonly number[]>(durations);
  const totalRef = useRef(totalMs);
  const playingRef = useRef(false);
  durationsRef.current = durations;
  totalRef.current = totalMs;
  playingRef.current = playing;

  // Carga por proyecto: el guion pegado queda guardado por documento.
  useEffect(() => {
    try {
      setScript(loadTeleprompterScript(window.localStorage, projectId));
    } catch {
      setScript('');
    }
    setPlaying(false);
    setActiveLine(0);
    positionRef.current = 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sólo reacciona al proyecto.
  }, [projectId]);

  // Preferencias globales del teleprompter (velocidad, letra, wrap).
  useEffect(() => {
    try {
      const prefs = loadTeleprompterPrefs(window.localStorage);
      setWpm(prefs.wpm);
      setFontSize(prefs.fontSize);
      setWrap(prefs.wrap);
    } catch {
      // Sin storage: defaults.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sólo al montar.
  }, []);

  useEffect(() => {
    try {
      saveTeleprompterScript(window.localStorage, script, projectId);
    } catch {
      // Storage bloqueado: el texto sigue en memoria.
    }
  }, [script, projectId]);

  useEffect(() => {
    try {
      saveTeleprompterPrefs(window.localStorage, { wpm, fontSize, wrap });
    } catch {
      // Sin persistencia las preferencias valen para la sesión.
    }
  }, [wpm, fontSize, wrap]);

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const scrollLineIntoCenter = (index: number) => {
    const box = scrollRef.current;
    const line = lineRefs.current[index];
    if (!box || !line) return;
    // offsetTop es relativo a `.teleprompter-lines` (position: relative):
    // centra la línea en el alto visible del escenario.
    const target = line.offsetTop - box.clientHeight / 2 + line.offsetHeight / 2;
    box.scrollTop = Math.max(0, target);
  };

  const stopScroll = () => {
    clearTimer();
    playingRef.current = false;
    setPlaying(false);
  };

  // Al desmontar (cambio de modo, cierre) no dejar el timer corriendo.
  useEffect(() => clearTimer, []);

  // Si el guion cambia con el scroll en marcha, frena: los tiempos ya no
  // describen lo que se está leyendo.
  useEffect(() => {
    if (playing) stopScroll();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sólo reacciona a lines/totalMs.
  }, [lines, totalMs]);

  const tick = () => {
    const now = performance.now();
    const delta = lastTickRef.current > 0 ? now - lastTickRef.current : SCROLL_TICK_MS;
    lastTickRef.current = now;
    positionRef.current += delta;
    const index = teleprompterLineAt(positionRef.current, durationsRef.current);
    if (index >= durationsRef.current.length) {
      // Fin del guion: frena solo y avisa una vez.
      stopScroll();
      store.setNotice('Fin del guion: el teleprompter llegó al final.');
      return;
    }
    setActiveLine(index);
    scrollLineIntoCenter(index);
  };

  const startScroll = () => {
    if (durationsRef.current.length === 0) {
      store.setNotice('Escribí o pegá el guion antes de empezar a leer.');
      return;
    }
    if (timerRef.current !== null) return;
    positionRef.current = 0;
    lastTickRef.current = performance.now();
    setActiveLine(0);
    scrollLineIntoCenter(0);
    playingRef.current = true;
    setPlaying(true);
    timerRef.current = window.setInterval(tick, SCROLL_TICK_MS);
  };

  const togglePlay = () => {
    if (playingRef.current) stopScroll();
    else startScroll();
  };

  /** «Grabar voz» del teleprompter: el mismo flujo de la timeline; cuando la
   *  grabación arranca de verdad (fase recording) el scroll acompaña. */
  const handleVoicePhase = (phase: RecorderPhase) => {
    if (phase === 'recording') {
      if (!playingRef.current) startScroll();
      return;
    }
    stopScroll();
  };

  const useProjectScript = () => {
    const text = scriptFromProject(project);
    if (!text) {
      store.setNotice(
        project
          ? 'El proyecto no tiene narración escrita en sus escenas.'
          : 'No hay un proyecto abierto con guion.',
      );
      return;
    }
    setScript(text);
    store.setNotice('Guion del proyecto cargado en el teleprompter.');
  };

  const onScriptChange = (value: string) => {
    setScript(value);
    stopScroll();
    positionRef.current = 0;
    setActiveLine(0);
    scrollLineIntoCenter(0);
  };

  const onStageKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Espacio reproduce/detiene cuando el foco está en el escenario (no en un
    // control). Es el atajo documentado del teleprompter.
    if (event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault();
      togglePlay();
    }
  };

  const estimated = formatMinutes(totalMs);

  return (
    <section className="view teleprompter-view" aria-label="Teleprompter">
      <ViewToolbar
        label="Teleprompter"
        actions={
          <>
            <button
              type="button"
              className="primary small"
              aria-pressed={playing}
              aria-label={playing ? 'Detener teleprompter' : 'Reproducir teleprompter'}
              title={
                playing
                  ? 'Detener el scroll (Espacio)'
                  : 'Empezar el scroll automático (Espacio con el foco en el texto)'
              }
              onClick={togglePlay}
            >
              <Icon name={playing ? 'stop' : 'play'} size={13} />
              <span>{playing ? 'Detener' : 'Leer'}</span>
            </button>
            <label className="teleprompter-wpm fine-print">
              Velocidad
              <input
                type="number"
                min={TELEPROMPTER_MIN_WPM}
                max={TELEPROMPTER_MAX_WPM}
                step={10}
                value={wpm}
                aria-label="Velocidad del teleprompter en palabras por minuto"
                onChange={(event) =>
                  setWpm(clampTeleprompterWpm(Number(event.target.value)))
                }
              />
              <span>palabras/min</span>
            </label>
            <div className="teleprompter-font" role="group" aria-label="Tamaño de letra">
              <button
                type="button"
                className="small ghost icon-button"
                aria-label="Reducir tamaño de letra"
                disabled={fontSize <= TELEPROMPTER_MIN_FONT}
                onClick={() => setFontSize(clampTeleprompterFontSize(fontSize - 2))}
              >
                A−
              </button>
              <span className="fine-print" aria-hidden="true">
                {fontSize}px
              </span>
              <button
                type="button"
                className="small ghost icon-button"
                aria-label="Agrandar tamaño de letra"
                disabled={fontSize >= TELEPROMPTER_MAX_FONT}
                onClick={() => setFontSize(clampTeleprompterFontSize(fontSize + 2))}
              >
                A+
              </button>
            </div>
            <button
              type="button"
              className="small ghost"
              aria-pressed={wrap}
              aria-label={wrap ? 'Desactivar ajuste de texto' : 'Activar ajuste de texto'}
              title="Ajustar el texto al ancho del escenario"
              onClick={() => setWrap((value) => !value)}
            >
              <Icon name="text" size={13} />
              <span>Ajustar texto</span>
            </button>
            <button
              type="button"
              className="small ghost"
              disabled={!project}
              title={
                project
                  ? 'Cargar la narración de las escenas del proyecto'
                  : 'Abrí un proyecto para usar su guion'
              }
              onClick={useProjectScript}
            >
              <Icon name="script" size={13} />
              <span>Usar guion del proyecto</span>
            </button>
            {onNavigate ? (
              <button
                type="button"
                className="small ghost"
                onClick={() => onNavigate('script')}
                title="Abrir la vista Guion para editar las escenas"
              >
                <Icon name="editor" size={13} />
                <span>Editar guion</span>
              </button>
            ) : null}
            <VoiceoverRecorder onPhaseChange={handleVoicePhase} />
          </>
        }
      >
        <span className="view-count">
          {lines.length} {lines.length === 1 ? 'línea' : 'líneas'} · ~{estimated} a {wpm} palabras/min
        </span>
      </ViewToolbar>

      <div className="teleprompter-body">
        <label className="field teleprompter-script">
          <span>Guion para locutar</span>
          <textarea
            rows={4}
            value={script}
            maxLength={20_000}
            placeholder="Pegá acá el texto que vas a narrar. Una línea por renglón: el scroll avanza según la velocidad en palabras/min."
            aria-label="Guion del teleprompter"
            onChange={(event) => onScriptChange(event.target.value)}
          />
        </label>
        <div
          className={`teleprompter-stage${wrap ? '' : ' nowrap'}`}
          style={{ fontSize: `${fontSize}px` }}
        >
          <div
            className="teleprompter-lines"
            ref={scrollRef}
            role="region"
            aria-label="Texto del teleprompter"
            tabIndex={0}
            onKeyDown={onStageKeyDown}
          >
            {lines.length === 0 ? (
              <p className="teleprompter-empty">
                El teleprompter está vacío. Pegá el guion arriba o usá «Usar guion del
                proyecto» si el proyecto tiene narración escrita.
              </p>
            ) : (
              lines.map((line, index) => (
                <p
                  key={`${index}-${line.slice(0, 24)}`}
                  ref={(element) => {
                    lineRefs.current[index] = element;
                  }}
                  className={
                    index === activeLine ? 'active' : index < activeLine ? 'read' : ''
                  }
                  aria-current={index === activeLine ? 'true' : undefined}
                >
                  {line}
                </p>
              ))
            )}
          </div>
        </div>
      </div>
      <p className="fine-print teleprompter-hint">
        Atajos: <kbd>Espacio</kbd> con el foco en el texto inicia o detiene el scroll ·{' '}
        <kbd>Grabar voz</kbd> arranca la lectura junto con la grabación del micrófono.
      </p>
    </section>
  );
}
