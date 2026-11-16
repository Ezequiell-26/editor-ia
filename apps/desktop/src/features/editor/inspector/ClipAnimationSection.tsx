import type { Clip, ClipAnimation } from '@editor-ia/project-schema';
import {
  applyBreathingLoop,
  applyClickPulse,
  updateClip,
} from '../../../state/project-actions';
import { useProjectStore } from '../../../state/project-store';
import { InspectorSection as Section } from '../InspectorSection';
import { NumberField } from './fields';

/**
 * Sección «Animación de entrada y salida» del inspector de clip.
 * Extraída de `Inspector.tsx` sin cambiar comportamiento ni textos
 * visibles. Las animaciones viven en `animationIn`/`animationOut` del clip
 * y se combinan con el movimiento Ken Burns y la transición de entrada.
 */
export function ClipAnimationSection({ clip }: { readonly clip: Clip }) {
  const store = useProjectStore();
  const animationClip = clip as Clip & {
    animationIn?: ClipAnimation;
    animationOut?: ClipAnimation;
  };
  const canAnimate = clip.kind === 'video' || clip.kind === 'image' || clip.kind === 'freeze';
  const animationIn = canAnimate ? animationClip.animationIn : undefined;
  const animationOut = canAnimate ? animationClip.animationOut : undefined;
  const animationMax = Math.max(1, Math.min(240, clip.durationFrames));
  return (
    <Section title="Animación de entrada y salida" group="animation" subtab="in out combo">
      <div className="inspector-grid">
        <label className="field">
          <span>Entrada</span>
          <select
            value={animationIn?.type ?? 'none'}
            onChange={(event) => {
              const type = event.target.value;
              if (type === 'none') {
                store.update((current) =>
                  updateClip(current, clip.id, { animationIn: undefined }),
                );
              } else {
                store.update((current) =>
                  updateClip(current, clip.id, {
                    animationIn: {
                      type: type as ClipAnimation['type'],
                      durationFrames: Math.min(
                        animationIn?.durationFrames ?? 15,
                        animationMax,
                      ),
                    },
                  }),
                );
              }
            }}
          >
            <option value="none">Sin animación</option>
            <option value="fade">Fundido</option>
            <option value="slide-left">Deslizar a la izquierda</option>
            <option value="slide-right">Deslizar a la derecha</option>
            <option value="slide-up">Deslizar hacia arriba</option>
            <option value="slide-down">Deslizar hacia abajo</option>
            <option value="zoom-in">Zoom de entrada</option>
            <option value="zoom-out">Alejar de entrada</option>
            <option value="spin">Giro de entrada</option>
          </select>
        </label>
        <NumberField
          label="Duración entrada"
          value={animationIn?.durationFrames ?? Math.min(15, animationMax)}
          min={1}
          max={animationMax}
          disabled={!animationIn}
          onCommit={(value) =>
            animationIn
              ? store.update((current) =>
                  updateClip(current, clip.id, {
                    animationIn: {
                      type: animationIn.type,
                      durationFrames: Math.max(
                        1,
                        Math.min(animationMax, Math.round(value)),
                      ),
                    },
                  }),
                )
              : undefined
          }
        />
      </div>
      <div className="inspector-grid">
        <label className="field">
          <span>Salida</span>
          <select
            value={animationOut?.type ?? 'none'}
            onChange={(event) => {
              const type = event.target.value;
              if (type === 'none') {
                store.update((current) =>
                  updateClip(current, clip.id, { animationOut: undefined }),
                );
              } else {
                store.update((current) =>
                  updateClip(current, clip.id, {
                    animationOut: {
                      type: type as ClipAnimation['type'],
                      durationFrames: Math.min(
                        animationOut?.durationFrames ?? 15,
                        animationMax,
                      ),
                    },
                  }),
                );
              }
            }}
          >
            <option value="none">Sin animación</option>
            <option value="fade">Fundido</option>
            <option value="slide-left">Deslizar a la izquierda</option>
            <option value="slide-right">Deslizar a la derecha</option>
            <option value="slide-up">Deslizar hacia arriba</option>
            <option value="slide-down">Deslizar hacia abajo</option>
            <option value="zoom-in">Zoom de salida</option>
            <option value="zoom-out">Alejar de salida</option>
            <option value="spin">Giro de salida</option>
          </select>
        </label>
        <NumberField
          label="Duración salida"
          value={animationOut?.durationFrames ?? Math.min(15, animationMax)}
          min={1}
          max={animationMax}
          disabled={!animationOut}
          onCommit={(value) =>
            animationOut
              ? store.update((current) =>
                  updateClip(current, clip.id, {
                    animationOut: {
                      type: animationOut.type,
                      durationFrames: Math.max(
                        1,
                        Math.min(animationMax, Math.round(value)),
                      ),
                    },
                  }),
                )
              : undefined
          }
        />
      </div>
      <div className="actions compact">
        <button
          type="button"
          className="small"
          onClick={() =>
            store.update((current) =>
              updateClip(current, clip.id, {
                animationIn: {
                  type: 'fade',
                  durationFrames: Math.min(12, animationMax),
                },
                animationOut: {
                  type: 'fade',
                  durationFrames: Math.min(12, animationMax),
                },
              }),
            )
          }
        >
          Suave
        </button>
        <button
          type="button"
          className="small"
          onClick={() =>
            store.update((current) =>
              updateClip(current, clip.id, {
                animationIn: {
                  type: 'slide-down',
                  durationFrames: Math.min(10, animationMax),
                },
                animationOut: {
                  type: 'slide-up',
                  durationFrames: Math.min(10, animationMax),
                },
              }),
            )
          }
        >
          Dinámica
        </button>
        <button
          type="button"
          className="small"
          onClick={() =>
            store.update((current) =>
              updateClip(current, clip.id, {
                animationIn: {
                  type: 'slide-left',
                  durationFrames: Math.min(12, animationMax),
                },
                animationOut: {
                  type: 'slide-left',
                  durationFrames: Math.min(12, animationMax),
                },
              }),
            )
          }
        >
          Deslizar
        </button>
        <button
          type="button"
          className="small"
          disabled={Boolean(clip.transform?.keyframes?.length)}
          title={
            clip.transform?.keyframes?.length
              ? 'Quitá primero los keyframes de transformación (sección Curvas)'
              : 'Idle «respiración»: keyframes de escala en loop suave, editables en Curvas'
          }
          onClick={() => {
            try {
              store.update((current) => applyBreathingLoop(current, clip.id));
              store.setNotice(
                'Respiración aplicada: keyframes de escala en loop (editables en Curvas).',
              );
            } catch (error) {
              store.setNotice(
                error instanceof Error ? error.message : 'no se pudo aplicar la respiración',
              );
            }
          }}
        >
          Respirar
        </button>
        <button
          type="button"
          className="small"
          disabled={Boolean(clip.transform?.keyframes?.length)}
          title={
            clip.transform?.keyframes?.length
              ? 'Quitá primero los keyframes de transformación (sección Curvas)'
              : 'Gesto de clic del manito: pulsación de escala rápida (~60 % del clip), editable en Curvas'
          }
          onClick={() => {
            try {
              store.update((current) => applyClickPulse(current, clip.id));
              store.setNotice(
                'Clic aplicado: pulsación de escala en keyframes (editable en Curvas).',
              );
            } catch (error) {
              store.setNotice(
                error instanceof Error ? error.message : 'no se pudo aplicar el clic',
              );
            }
          }}
        >
          Clic
        </button>
        <button
          type="button"
          className="small ghost"
          onClick={() =>
            store.update((current) =>
              updateClip(current, clip.id, {
                animationIn: undefined,
                animationOut: undefined,
              }),
            )
          }
        >
          Quitar
        </button>
      </div>
      <p className="fine-print">
        Las animaciones se reproducen dentro del clip, no mueven a los vecinos ni cambian
        la duración. Se combinan con el movimiento Ken Burns y con la transición de entrada.
      </p>
    </Section>
  );
}
