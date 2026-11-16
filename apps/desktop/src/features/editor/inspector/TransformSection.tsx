import { useState } from 'react';
import { ColorSwatch } from '../../../components/ColorSwatch';
import type {
  BlendMode,
  Clip,
  KeyframeEasing,
  PerspectiveCorner,
} from '@editor-ia/project-schema';
import { BEZIER_PRESETS, bezierPresetId } from '@editor-ia/project-schema';
import {
  applyTransformBezierToAllKeyframes,
  captureTransformKeyframe,
  clearTransformKeyframes,
  formatTimecode,
  pasteTransformKeyframes,
  pasteTransformKeyframesAtPlayhead,
  removeTransformKeyframe,
  setTransformKeyframe,
  updateClip,
} from '../../../state/project-actions';
import { useProjectStore } from '../../../state/project-store';
import {
  setSelectedKeyframe as setTimelineKeyframeSelection,
  useSelectedKeyframe,
} from '../../../state/keyframe-selection';
import {
  copyTransformKeyframesAt,
  getTransformKeyframeClipboard,
  hasTransformKeyframeClipboard,
} from '../../../state/keyframe-clipboard';
import { MONITOR_FRAME_PRESETS } from '../monitor-frames';
import { InspectorSection as Section } from '../InspectorSection';
import { NumberField } from './fields';

const DEFAULT_PERSPECTIVE_CORNERS: [
  PerspectiveCorner,
  PerspectiveCorner,
  PerspectiveCorner,
  PerspectiveCorner,
] = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

/**
 * Sección «Transformación» del inspector de clip: campos de transform,
 * corrección de perspectiva a 4 puntos, marco del monitor, mezcla, flips y
 * el panel de keyframes de transformación (con portapapeles de claves y
 * presets Bézier). Extraída de `Inspector.tsx` sin cambiar comportamiento
 * ni textos visibles.
 *
 * La selección de clave sigue viviendo en `state/keyframe-selection` para
 * que la timeline pueda priorizarla en Delete; `localFrame`/`playheadFrame`
 * llegan por props porque el padre ya los calcula para el resto del panel.
 */
export function TransformSection({
  clip,
  fps,
  localFrame,
  playheadFrame,
}: {
  readonly clip: Clip;
  readonly fps: number;
  readonly localFrame: number;
  readonly playheadFrame: number;
}) {
  const store = useProjectStore();
  const visual =
    clip.kind === 'video' || clip.kind === 'image' || clip.kind === 'freeze';
  const transform = clip.transform ?? {};
  const blendMode =
    'blendMode' in clip
      ? (clip as Clip & { blendMode?: BlendMode }).blendMode
      : undefined;
  const perspectiveCorners =
    transform.perspective?.corners ?? DEFAULT_PERSPECTIVE_CORNERS;
  function patchPerspectiveCorner(
    index: 0 | 1 | 2 | 3,
    axis: 'x' | 'y',
    value: number,
  ): void {
    const next = perspectiveCorners.map((corner) => ({ ...corner })) as [
      PerspectiveCorner,
      PerspectiveCorner,
      PerspectiveCorner,
      PerspectiveCorner,
    ];
    next[index] = { ...next[index]!, [axis]: Math.max(0, Math.min(1, value)) };
    store.update((current) =>
      updateClip(current, clip.id, {
        transform: { ...transform, perspective: { corners: next } },
      }),
    );
  }
  const transformKeyframes = transform.keyframes ?? [];
  const sharedKeyframe = useSelectedKeyframe();
  const selectedKeyframe =
    sharedKeyframe && sharedKeyframe.clipId === clip.id
      ? sharedKeyframe.frame
      : null;
  const setSelectedKeyframe = (frame: number | null): void => {
    setTimelineKeyframeSelection(
      frame === null ? null : { clipId: clip.id, frame },
    );
  };
  const [, bumpKfClipboard] = useState(0);
  // «Preset a todas las claves»: cuando está tildado, elegir un preset
  // Bézier lo aplica a todos los keyframes del clip en vez de sólo al
  // seleccionado.
  const [bezierToAll, setBezierToAll] = useState(false);
  const selectedTransformKeyframe =
    selectedKeyframe === null
      ? null
      : transformKeyframes.find((keyframe) => keyframe.frame === selectedKeyframe) ?? null;
  return (
      <Section title="Transformación" group="video" subtab="basic">
        <div className="inspector-grid">
          <NumberField
            label="Desplaz. X"
            value={transform.offsetX ?? 0}
            onCommit={(value) =>
              store.update((current) =>
                updateClip(current, clip.id, { transform: { ...transform, offsetX: Math.round(value) } }),
              )
            }
          />
          <NumberField
            label="Desplaz. Y"
            value={transform.offsetY ?? 0}
            onCommit={(value) =>
              store.update((current) =>
                updateClip(current, clip.id, { transform: { ...transform, offsetY: Math.round(value) } }),
              )
            }
          />
          <NumberField
            label="Escala X"
            value={transform.scaleX ?? 1}
            min={0.01}
            max={100}
            step={0.05}
            onCommit={(value) =>
              store.update((current) => updateClip(current, clip.id, { transform: { ...transform, scaleX: value } }))
            }
          />
          <NumberField
            label="Escala Y"
            value={transform.scaleY ?? 1}
            min={0.01}
            max={100}
            step={0.05}
            onCommit={(value) =>
              store.update((current) => updateClip(current, clip.id, { transform: { ...transform, scaleY: value } }))
            }
          />
          <NumberField
            label="Rotación"
            value={transform.rotationDeg ?? 0}
            min={-360}
            max={360}
            onCommit={(value) =>
              store.update((current) => updateClip(current, clip.id, { transform: { ...transform, rotationDeg: value } }))
            }
          />
          <NumberField
            label="Opacidad"
            value={transform.opacity ?? 1}
            min={0}
            max={1}
            step={0.05}
            onCommit={(value) =>
              store.update((current) => updateClip(current, clip.id, { transform: { ...transform, opacity: value } }))
            }
          />
          {([
            ['P. sup. izq. X', 0, 'x'],
            ['P. sup. izq. Y', 0, 'y'],
            ['P. sup. der. X', 1, 'x'],
            ['P. sup. der. Y', 1, 'y'],
            ['P. inf. der. X', 2, 'x'],
            ['P. inf. der. Y', 2, 'y'],
            ['P. inf. izq. X', 3, 'x'],
            ['P. inf. izq. Y', 3, 'y'],
          ] as const).map(([label, cornerIndex, axis]) => (
            <NumberField
              key={label}
              label={label}
              value={perspectiveCorners[cornerIndex][axis]}
              min={0}
              max={1}
              step={0.01}
              onCommit={(value) => patchPerspectiveCorner(cornerIndex, axis, value)}
            />
          ))}
        </div>
        <div className="actions compact">
          <button
            type="button"
            className="small ghost"
            disabled={!transform.perspective}
            onClick={() => {
              const { perspective: _perspective, ...rest } = transform;
              store.update((current) =>
                updateClip(current, clip.id, { transform: rest }),
              );
            }}
          >
            Restablecer perspectiva
          </button>
        </div>
        <p className="fine-print">
          Corrección de perspectiva a 4 puntos: el cuadrilátero de origen se endereza al cuadro.
          Se aplica en la preview, en <strong>Frame real</strong> y en el MP4. La preview usa la
          misma homografía y recorta al cuadro; el MP4 sigue siendo la referencia.
        </p>
        {visual ? (
          <div className="inspector-grid">
            <label className="field">
              <span>Marco del monitor</span>
              <select
                value={clip.monitorFrame?.preset ?? ''}
                onChange={(event) => {
                  const value = event.target.value;
                  store.update((current) =>
                    updateClip(current, clip.id, {
                      monitorFrame:
                        value === ''
                          ? undefined
                          : {
                              preset: value as NonNullable<
                                Clip['monitorFrame']
                              >['preset'],
                              ...(clip.monitorFrame?.color
                                ? { color: clip.monitorFrame.color }
                                : {}),
                              ...(clip.monitorFrame?.color2
                                ? { color2: clip.monitorFrame.color2 }
                                : {}),
                            },
                    }),
                  );
                }}
              >
                <option value="">Sin marco</option>
                {MONITOR_FRAME_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.id.replace(/-/g, ' ')}
                  </option>
                ))}
              </select>
            </label>
            {clip.monitorFrame ? (
              <>
                <label className="field">
                  <span>Color del marco</span>
                  <ColorSwatch
                    label="Color del marco"
                    value={clip.monitorFrame.color ?? '#ffffff'}
                    onChange={(hex) =>
                      store.update((current) =>
                        updateClip(current, clip.id, {
                          monitorFrame: {
                            ...clip.monitorFrame!,
                            color: hex,
                          },
                        }),
                      )
                    }
                  />
                </label>
                <label className="field">
                  <span>Color secundario</span>
                  <ColorSwatch
                    label="Color secundario del marco"
                    value={clip.monitorFrame.color2 ?? '#ffffff'}
                    onChange={(hex) =>
                      store.update((current) =>
                        updateClip(current, clip.id, {
                          monitorFrame: {
                            ...clip.monitorFrame!,
                            color2: hex,
                          },
                        }),
                      )
                    }
                  />
                </label>
              </>
            ) : null}
          </div>
        ) : null}
        <label className="field">
          <span>Mezcla</span>
          <select
            value={blendMode ?? 'normal'}
            onChange={(event) =>
              store.update((current) =>
                updateClip(current, clip.id, {
                  blendMode:
                    event.target.value === 'normal'
                      ? undefined
                      : (event.target.value as BlendMode),
                }),
              )
            }
          >
            <option value="normal">Normal</option>
            <option value="multiply">Multiplicar</option>
            <option value="screen">Trama / aclarar</option>
            <option value="overlay">Superponer</option>
            <option value="soft-light">Luz suave</option>
            <option value="darken">Oscurecer</option>
            <option value="lighten">Aclarar</option>
            <option value="color-dodge">Sobreexponer color</option>
            <option value="color-burn">Subexponer color</option>
            <option value="hard-light">Luz fuerte</option>
          </select>
        </label>
        <p className="fine-print">
          La mezcla se calcula contra las capas inferiores. Rinde mejor cuando el clip llena el
          cuadro; en la preview usa `mix-blend-mode` y en el MP4 `blend`.
        </p>
        <div className="actions compact">
          <label className="check">
            <input
              type="checkbox"
              checked={transform.flipH ?? false}
              onChange={(event) =>
                store.update((current) =>
                  updateClip(current, clip.id, {
                    transform: { ...transform, flipH: event.target.checked || undefined },
                  }),
                )
              }
            />
            <span>Voltear horizontal</span>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={transform.flipV ?? false}
              onChange={(event) =>
                store.update((current) =>
                  updateClip(current, clip.id, {
                    transform: { ...transform, flipV: event.target.checked || undefined },
                  }),
                )
              }
            />
            <span>Voltear vertical</span>
          </label>
          {[90, 180, 270].map((degrees) => (
            <button
              key={degrees}
              type="button"
              className="small"
              onClick={() =>
                store.update((current) =>
                  updateClip(current, clip.id, {
                    transform: { ...transform, rotationDeg: degrees },
                  }),
                )
              }
            >
              {degrees}°
            </button>
          ))}
          <button
            type="button"
            className="small ghost"
            onClick={() => store.update((current) => updateClip(current, clip.id, { transform: {} }))}
            disabled={Object.keys(transform).length === 0}
          >
            Limpiar transformación
          </button>
        </div>

        {visual ? (
          <div className="keyframe-panel">
            <div className="production-card-head">
              <div>
                <p className="eyebrow">Keyframes de transformación</p>
                <span className="fine-print">
                  {transformKeyframes.length} clave(s) · playhead{' '}
                  {formatTimecode(localFrame, fps)}
                </span>
              </div>
              <div className="actions compact">
                <button
                  type="button"
                  className="small"
                  onClick={() => {
                    store.update((current) =>
                      setTransformKeyframe(
                        current,
                        clip.id,
                        localFrame,
                        captureTransformKeyframe(clip, localFrame),
                      ),
                    );
                    setSelectedKeyframe(localFrame);
                  }}
                >
                  Fijar en playhead
                </button>
                <button
                  type="button"
                  className="small ghost"
                  disabled={transformKeyframes.length === 0}
                  onClick={() => {
                    store.update((current) =>
                      clearTransformKeyframes(current, clip.id, localFrame),
                    );
                    setSelectedKeyframe(null);
                  }}
                >
                  Quitar animación
                </button>
                <button
                  type="button"
                  className="small ghost"
                  disabled={
                    !transformKeyframes.some((keyframe) => keyframe.frame === localFrame) &&
                    selectedTransformKeyframe === null
                  }
                  title="Copia las propiedades animadas de la clave del playhead (o la seleccionada)"
                  onClick={() => {
                    const source =
                      transformKeyframes.find((keyframe) => keyframe.frame === localFrame) ??
                      selectedTransformKeyframe;
                    if (!source) return;
                    copyTransformKeyframesAt(clip, source.frame);
                    bumpKfClipboard((tick) => tick + 1);
                  }}
                >
                  Copiar clave
                </button>
                <button
                  type="button"
                  className="small ghost"
                  disabled={!hasTransformKeyframeClipboard()}
                  title="Pega la clave copiada en el playhead de este clip"
                  onClick={() => {
                    const clipboardPatch = getTransformKeyframeClipboard();
                    if (!clipboardPatch) return;
                    store.update((current) =>
                      pasteTransformKeyframes(current, clip.id, localFrame, clipboardPatch),
                    );
                    setSelectedKeyframe(localFrame);
                  }}
                >
                  Pegar
                </button>
                <button
                  type="button"
                  className="small ghost"
                  disabled={!hasTransformKeyframeClipboard()}
                  title="Pega la clave copiada en todos los clips visuales bajo el playhead"
                  onClick={() => {
                    const clipboardPatch = getTransformKeyframeClipboard();
                    if (!clipboardPatch) return;
                    store.update((current) => {
                      const result = pasteTransformKeyframesAtPlayhead(
                        current,
                        playheadFrame,
                        clipboardPatch,
                      );
                      return result.project;
                    });
                  }}
                >
                  Pegar en todos
                </button>
              </div>
            </div>
            {transformKeyframes.length === 0 ? (
              <p className="fine-print">
                Fijá una clave, mové el playhead, cambiá escala/posición/opacidad y fijá otra. La
                vista previa y el MP4 interpolan entre claves.
              </p>
            ) : (
              <div className="keyframe-list">
                {transformKeyframes.map((keyframe) => (
                  <div
                    key={keyframe.frame}
                    className={`keyframe-row ${
                      selectedKeyframe === keyframe.frame ? 'active' : ''
                    }`}
                  >
                    <button
                      type="button"
                      className="small ghost"
                      onClick={() => setSelectedKeyframe(keyframe.frame)}
                    >
                      {formatTimecode(keyframe.frame, fps)}
                    </button>
                    <span className="fine-print">
                      {[
                        keyframe.offsetX !== undefined ? `X ${keyframe.offsetX}` : '',
                        keyframe.offsetY !== undefined ? `Y ${keyframe.offsetY}` : '',
                        keyframe.scale !== undefined ? `×${keyframe.scale.toFixed(2)}` : '',
                        keyframe.rotationDeg !== undefined ? `${keyframe.rotationDeg}°` : '',
                        keyframe.opacity !== undefined
                          ? `α ${keyframe.opacity.toFixed(2)}`
                          : '',
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                    <button
                      type="button"
                      className="small ghost"
                      aria-label={`Quitar clave en ${formatTimecode(keyframe.frame, fps)}`}
                      onClick={() => {
                        store.update((current) =>
                          removeTransformKeyframe(current, clip.id, keyframe.frame),
                        );
                        if (selectedKeyframe === keyframe.frame) setSelectedKeyframe(null);
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
            {selectedTransformKeyframe ? (
              <div className="inspector-grid">
                <NumberField
                  label="KF desplaz. X"
                  value={selectedTransformKeyframe.offsetX ?? 0}
                  onCommit={(value) =>
                    store.update((current) =>
                      setTransformKeyframe(current, clip.id, selectedTransformKeyframe.frame, {
                        offsetX: Math.round(value),
                      }),
                    )
                  }
                />
                <NumberField
                  label="KF desplaz. Y"
                  value={selectedTransformKeyframe.offsetY ?? 0}
                  onCommit={(value) =>
                    store.update((current) =>
                      setTransformKeyframe(current, clip.id, selectedTransformKeyframe.frame, {
                        offsetY: Math.round(value),
                      }),
                    )
                  }
                />
                <NumberField
                  label="KF escala"
                  value={selectedTransformKeyframe.scale ?? 1}
                  min={0.5}
                  max={4}
                  step={0.05}
                  onCommit={(value) =>
                    store.update((current) =>
                      setTransformKeyframe(current, clip.id, selectedTransformKeyframe.frame, {
                        scale: value,
                      }),
                    )
                  }
                />
                <NumberField
                  label="KF rotación"
                  value={selectedTransformKeyframe.rotationDeg ?? 0}
                  min={-360}
                  max={360}
                  onCommit={(value) =>
                    store.update((current) =>
                      setTransformKeyframe(current, clip.id, selectedTransformKeyframe.frame, {
                        rotationDeg: value,
                      }),
                    )
                  }
                />
                <NumberField
                  label="KF opacidad"
                  value={selectedTransformKeyframe.opacity ?? 1}
                  min={0}
                  max={1}
                  step={0.05}
                  onCommit={(value) =>
                    store.update((current) =>
                      setTransformKeyframe(current, clip.id, selectedTransformKeyframe.frame, {
                        opacity: value,
                      }),
                    )
                  }
                />
                <label className="field">
                  <span>Curva</span>
                  <select
                    value={selectedTransformKeyframe.easing ?? 'linear'}
                    onChange={(event) =>
                      store.update((current) =>
                        setTransformKeyframe(current, clip.id, selectedTransformKeyframe.frame, {
                          easing: event.target.value as KeyframeEasing,
                          // Un preset de easing vuelve a regir el segmento:
                          // se descarta la curva Bézier guardada si la había.
                          bezier: null,
                        }),
                      )
                    }
                  >
                    <option value="linear">Lineal</option>
                    <option value="ease-in">Acelerar</option>
                    <option value="ease-out">Desacelerar</option>
                    <option value="ease-in-out">Suave</option>
                    <option value="hold">Mantener</option>
                  </select>
                </label>
                <label className="field">
                  <span>Preset Bézier</span>
                  <select
                    value={bezierPresetId(selectedTransformKeyframe.bezier) ?? 'personalizada'}
                    onChange={(event) => {
                      const preset = BEZIER_PRESETS.find(
                        (item) => item.id === event.target.value,
                      );
                      if (!preset) return;
                      if (bezierToAll) {
                        store.update((current) =>
                          applyTransformBezierToAllKeyframes(
                            current,
                            clip.id,
                            preset.bezier,
                          ),
                        );
                      } else {
                        store.update((current) =>
                          setTransformKeyframe(current, clip.id, selectedTransformKeyframe.frame, {
                            bezier: { ...preset.bezier },
                            easing: 'linear',
                          }),
                        );
                      }
                    }}
                  >
                    <option value="personalizada" disabled>
                      {selectedTransformKeyframe.bezier ? 'Personalizada' : '—'}
                    </option>
                    {BEZIER_PRESETS.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.label}
                      </option>
                    ))}
                  </select>
                  {transformKeyframes.length > 1 ? (
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={bezierToAll}
                        onChange={(event) => setBezierToAll(event.target.checked)}
                      />
                      <span>A todas las claves</span>
                    </label>
                  ) : null}
                </label>
              </div>
            ) : null}
          </div>
        ) : null}
      </Section>
  );
}
