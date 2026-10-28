import type { KeyframeEasing, Track } from '@editor-ia/project-schema';
import { Icon } from '../../components/Icon';
import { formatTimecode, fpsOf } from '../../state/project-actions';
import { panLabel, trackGainDb, trackPan } from '../../state/audio-mix';
import {
  clearTrackGainKeyframes,
  clearTrackPanKeyframes,
  removeTrackGainKeyframe,
  removeTrackPanKeyframe,
  setTrackGainKeyframe,
  setTrackPanKeyframe,
} from '../../state/track-automation';
import { useProjectStore } from '../../state/project-store';

/**
 * Panel de captura de automatización de una pista de la mesa: fija claves de
 * volumen/paneo en el playhead con el valor actual del fader/knob, lista las
 * claves existentes y permite editar su valor y curva o borrarlas.
 *
 * Las claves son frames absolutos de la timeline; el render Rust las aplica
 * con `volume`/ganancias por canal evaluados por frame, con las mismas curvas
 * que la preview. La pista se resuelve siempre desde el store por id para que
 * capturar con el valor recién movido no dependa de un prop viejo.
 */
export function TrackAutomationPanel({ track }: { readonly track: Track }) {
  const store = useProjectStore();
  const project = store.state.project;
  const live = project?.timeline.tracks.find((item) => item.id === track.id) ?? track;
  if (!project) return null;
  const fps = fpsOf(project);
  const playhead = store.state.playheadFrame;
  const gainKeyframes = live.gainKeyframes ?? [];
  const panKeyframes = live.panKeyframes ?? [];
  const hasAutomation = gainKeyframes.length > 0 || panKeyframes.length > 0;

  function fijarVolumen(): void {
    store.update((current) =>
      setTrackGainKeyframe(current, live.id, playhead, trackGainDb(live)),
    );
  }

  function fijarPaneo(): void {
    store.update((current) => setTrackPanKeyframe(current, live.id, playhead, trackPan(live)));
  }

  function quitarAnimacion(): void {
    store.update((current) =>
      clearTrackGainKeyframes(
        clearTrackPanKeyframes(current, live.id, playhead),
        live.id,
        playhead,
      ),
    );
  }

  return (
    <div className="keyframe-panel">
      <div className="production-card-head">
        <div>
          <p className="eyebrow">Automatización</p>
          <span className="fine-print">
            {gainKeyframes.length + panKeyframes.length} clave(s) · playhead{' '}
            {formatTimecode(playhead, fps)}
          </span>
        </div>
        <div className="actions compact">
          <button
            type="button"
            className="small"
            disabled={live.locked}
            aria-label={`Fijar volumen de ${live.label} en el playhead`}
            title="Guarda el valor actual del fader como clave en el playhead"
            onClick={fijarVolumen}
          >
            <Icon name="audio" size={12} />
            <span>Fijar volumen</span>
          </button>
          <button
            type="button"
            className="small"
            disabled={live.locked}
            aria-label={`Fijar paneo de ${live.label} en el playhead`}
            title="Guarda el valor actual del paneo como clave en el playhead"
            onClick={fijarPaneo}
          >
            <Icon name="audio" size={12} />
            <span>Fijar paneo</span>
          </button>
          <button
            type="button"
            className="small ghost"
            disabled={live.locked || !hasAutomation}
            aria-label={`Quitar la animación de ${live.label}`}
            title="Quita las claves y congela el valor muestreado en el playhead"
            onClick={quitarAnimacion}
          >
            Quitar animación
          </button>
        </div>
      </div>
      {!hasAutomation ? (
        <p className="fine-print">
          El fader y el paneo siguen sus valores estáticos. Fijá claves en distintos puntos del
          playhead para automatizar la pista; el export las aplica por frame.
        </p>
      ) : (
        <div className="keyframe-list">
          {gainKeyframes.map((keyframe) => (
            <div key={`vol-${keyframe.frame}`} className="keyframe-row">
              <span className="fine-print">Vol</span>
              <span className="fine-print">{formatTimecode(keyframe.frame, fps)}</span>
              <input
                type="number"
                aria-label={`Volumen de la clave de ${live.label} en ${formatTimecode(keyframe.frame, fps)}`}
                min={-60}
                max={12}
                step={0.5}
                value={keyframe.gainDb}
                onChange={(event) =>
                  store.update((current) =>
                    setTrackGainKeyframe(
                      current,
                      live.id,
                      keyframe.frame,
                      Number(event.target.value),
                      keyframe.easing ?? 'linear',
                    ),
                  )
                }
              />
              <span className="fine-print">dB</span>
              <select
                value={keyframe.easing ?? 'linear'}
                aria-label={`Curva de volumen de ${live.label} en ${formatTimecode(keyframe.frame, fps)}`}
                onChange={(event) =>
                  store.update((current) =>
                    setTrackGainKeyframe(
                      current,
                      live.id,
                      keyframe.frame,
                      keyframe.gainDb,
                      event.target.value as KeyframeEasing,
                    ),
                  )
                }
              >
                <option value="linear">Lineal</option>
                <option value="ease-in">Acelerar</option>
                <option value="ease-out">Desacelerar</option>
                <option value="ease-in-out">Suave</option>
                <option value="hold">Mantener</option>
              </select>
              <button
                type="button"
                className="small ghost"
                aria-label={`Quitar clave de volumen de ${live.label} en ${formatTimecode(keyframe.frame, fps)}`}
                onClick={() =>
                  store.update((current) =>
                    removeTrackGainKeyframe(current, live.id, keyframe.frame),
                  )
                }
              >
                ×
              </button>
            </div>
          ))}
          {panKeyframes.map((keyframe) => (
            <div key={`pan-${keyframe.frame}`} className="keyframe-row">
              <span className="fine-print">Pan</span>
              <span className="fine-print">{formatTimecode(keyframe.frame, fps)}</span>
              <input
                type="number"
                aria-label={`Paneo de la clave de ${live.label} en ${formatTimecode(keyframe.frame, fps)}`}
                min={-1}
                max={1}
                step={0.05}
                value={keyframe.value}
                onChange={(event) =>
                  store.update((current) =>
                    setTrackPanKeyframe(
                      current,
                      live.id,
                      keyframe.frame,
                      Number(event.target.value),
                      keyframe.easing ?? 'linear',
                    ),
                  )
                }
              />
              <span className="fine-print">{panLabel(keyframe.value)}</span>
              <select
                value={keyframe.easing ?? 'linear'}
                aria-label={`Curva de paneo de ${live.label} en ${formatTimecode(keyframe.frame, fps)}`}
                onChange={(event) =>
                  store.update((current) =>
                    setTrackPanKeyframe(
                      current,
                      live.id,
                      keyframe.frame,
                      keyframe.value,
                      event.target.value as KeyframeEasing,
                    ),
                  )
                }
              >
                <option value="linear">Lineal</option>
                <option value="ease-in">Acelerar</option>
                <option value="ease-out">Desacelerar</option>
                <option value="ease-in-out">Suave</option>
                <option value="hold">Mantener</option>
              </select>
              <button
                type="button"
                className="small ghost"
                aria-label={`Quitar clave de paneo de ${live.label} en ${formatTimecode(keyframe.frame, fps)}`}
                onClick={() =>
                  store.update((current) =>
                    removeTrackPanKeyframe(current, live.id, keyframe.frame),
                  )
                }
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
