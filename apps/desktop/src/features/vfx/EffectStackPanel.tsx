import { ColorSwatch } from '../../components/ColorSwatch';
import { useState } from 'react';
import type { CubicBezier } from '@editor-ia/project-schema';
import { KeyframeCurveEditor } from '../editor/KeyframeCurveEditor';
import { formatTimecode } from '../../state/project-actions';
import {
  clearParamKeyframeCurves,
  duplicateInstance,
  effectRegistry,
  fidelityLabel,
  manifestFidelity,
  manifestNote,
  newInstanceId,
  paramGroups,
  paramKeyframes,
  removeInstance,
  removeParamKeyframe,
  resetInstance,
  sampleKeyframes,
  setInstanceEnabled,
  setInstanceParam,
  setParamKeyframeAt,
  setParamKeyframeBezier,
  setParamKeyframeEasing,
  shiftInstance,
  toggleParamKeyframe,
  clearParamKeyframes,
  type EffectInstance,
  type EffectKeyframe,
  type EffectManifest,
  type EffectStack,
  type ParamSpec,
  type ParamValue,
} from '@editor-ia/effect-kit';

export interface EffectStackPanelProps {
  readonly stack: EffectStack;
  readonly onChange: (next: EffectStack) => void;
  /**
   * Frame local del clip bajo el playhead. Si está presente, los parámetros
   * numéricos ganan el botón de keyframe (◆) y el slider escribe en la clave
   * del frame — la misma semilla que usa el preview GPU.
   */
  readonly keyframeFrame?: number | undefined;
  /**
   * Tasa de frames del proyecto. Si está presente, las claves de la lista se
   * muestran en timecode; si no, conservan el número de frame local.
   */
  readonly frameRate?: number | undefined;
  /**
   * Frame local del clip al que saltar al elegir una clave de la lista del
   * editor de curva. Sin el callback las filas quedan como texto (el panel
   * sigue siendo puro y no inventa un playhead).
   */
  readonly onSeekFrame?: ((localFrame: number) => void) | undefined;
}

function displayValue(spec: ParamSpec, value: ParamValue): string {
  switch (spec.type) {
    case 'float':
      return `${(typeof value === 'number' ? value : spec.default).toFixed(spec.step && spec.step < 0.1 ? 3 : 2)}${spec.unit ? ` ${spec.unit}` : ''}`;
    case 'int':
      return `${Math.round(typeof value === 'number' ? value : spec.default)}${spec.unit ? ` ${spec.unit}` : ''}`;
    case 'enum':
      return spec.options[Math.round(typeof value === 'number' ? value : spec.default)] ?? '';
    case 'vec2':
      return Array.isArray(value) ? `${value[0].toFixed(2)} · ${value[1].toFixed(2)}` : '';
    default:
      return '';
  }
}

const EASING_LABELS: Record<NonNullable<EffectKeyframe['easing']>, string> = {
  linear: 'Lineal',
  'ease-in': 'Acelerar',
  'ease-out': 'Desacelerar',
  'ease-in-out': 'Suave',
  hold: 'Mantener',
};

interface ParamAnimation {
  /** Hay una clave exactamente en el frame del playhead. */
  readonly active: boolean;
  /** La pista existe (aunque el playhead no caiga sobre una clave). */
  readonly animated: boolean;
  readonly onToggle: () => void;
  readonly onClear: () => void;
  /** Escribe/crea la clave del frame (auto-key del slider). */
  readonly onKeyedValue: (next: number) => void;
  /** Pista del parámetro (≥2 claves) para el editor de curvas Bézier. */
  readonly track?: readonly EffectKeyframe[] | undefined;
  /** Alguna clave ya tiene curva propia (no la del preset/lineal). */
  readonly hasCurve?: boolean | undefined;
  /** Id único del texto de ayuda del editor (varios paneles por clip). */
  readonly curveHelpId?: string | undefined;
  /** Escribe la curva del segmento que empieza en la clave `index` (ordenada). */
  readonly onEditCurve?: ((index: number, bezier: CubicBezier) => boolean) | undefined;
  /** Escribe el preset de interpolación de la clave del `frame` dado. */
  readonly onSetEasing?:
    | ((frame: number, easing: NonNullable<EffectKeyframe['easing']>) => void)
    | undefined;
  /** Quita las curvas de todas las claves (vuelven a easing/lineal). */
  readonly onClearCurves?: (() => void) | undefined;
  /** Quita una clave suelta del frame dado (lista del editor de curva). */
  readonly onRemoveKey?: ((frame: number) => void) | undefined;
  /** Salta el playhead a una clave de la lista (frame local del clip). */
  readonly onSeek?: ((frame: number) => void) | undefined;
  /** Frame local del playhead: marca la fila activa de la lista. */
  readonly activeFrame?: number | undefined;
  /** Tasa de frames para mostrar la clave en timecode; sin ella se usa frame. */
  readonly frameRate?: number | undefined;
}

function ParamControl({
  spec,
  value,
  onChange,
  animation,
}: {
  readonly spec: ParamSpec;
  readonly value: ParamValue;
  readonly onChange: (next: ParamValue) => void;
  readonly animation?: ParamAnimation | undefined;
}) {
  const [curveOpen, setCurveOpen] = useState(false);
  if (spec.type === 'bool') {
    return (
      <label className="effect-param switch">
        <span>{spec.label}</span>
        <input
          type="checkbox"
          checked={value === true}
          onChange={(event) => onChange(event.target.checked)}
        />
      </label>
    );
  }
  if (spec.type === 'color') {
    return (
      <label className="effect-param">
        <span>{spec.label}</span>
        <ColorSwatch
          label={spec.label}
          value={typeof value === 'string' ? value : spec.default}
          onChange={onChange}
        />
      </label>
    );
  }
  if (spec.type === 'enum') {
    const index = typeof value === 'number' ? Math.round(value) : spec.default;
    return (
      <label className="effect-param">
        <span>{spec.label}</span>
        <select value={index} onChange={(event) => onChange(Number(event.target.value))}>
          {spec.options.map((option, position) => (
            <option key={option} value={position}>
              {option}
            </option>
          ))}
        </select>
      </label>
    );
  }
  if (spec.type === 'vec2') {
    const pair = Array.isArray(value) ? value : spec.default;
    return (
      <div className="effect-param pair">
        <span>
          {spec.label} <em>{displayValue(spec, value)}</em>
        </span>
        <div className="effect-param-axes">
          {(['x', 'y'] as const).map((axis, index) => (
            <input
              key={axis}
              type="range"
              min={spec.min}
              max={spec.max}
              step={0.01}
              value={pair[index] ?? 0}
              aria-label={`${spec.label} ${axis.toUpperCase()}`}
              onChange={(event) => {
                const next: [number, number] = [pair[0] ?? 0, pair[1] ?? 0];
                next[index] = Number(event.target.value);
                onChange(next);
              }}
            />
          ))}
        </div>
      </div>
    );
  }
  const numeric = typeof value === 'number' ? value : spec.default;
  const keyed = animation?.animated === true;
  // Con keyframes los botones viven dentro del <label> y rompen el nombre
  // accesible del slider (queda vacío): ahí el control pasa a <div> con
  // aria-label explícito. Sin animación se conserva el <label> de siempre.
  const ParamTag = animation ? 'div' : 'label';
  return (
    <ParamTag className="effect-param">
      <span>
        {spec.label} <em>{displayValue(spec, value)}</em>
        {animation ? (
          <span className="effect-param-keyframes">
            <button
              type="button"
              className={`icon-button effect-keyframe-toggle${animation.active ? ' on' : ''}`}
              aria-pressed={animation.active}
              aria-label={`Clave de ${spec.label} en el frame actual`}
              title={
                animation.active
                  ? 'Quitar la clave de este frame'
                  : keyed
                    ? 'Agregar clave en este frame'
                    : 'Animar este parámetro (crea la primera clave)'
              }
              onClick={animation.onToggle}
            >
              ◆
            </button>
            {keyed ? (
              <button
                type="button"
                className="icon-button"
                aria-label={`Quitar la animación de ${spec.label}`}
                title="Quitar todas las claves de este parámetro"
                onClick={animation.onClear}
              >
                ×
              </button>
            ) : null}
            {animation.track && animation.track.length >= 2 ? (
              <button
                type="button"
                className={`icon-button${curveOpen ? ' on' : ''}`}
                aria-pressed={curveOpen}
                aria-label={`Curva de ${spec.label}`}
                title="Editar la curva de interpolación entre claves"
                onClick={() => setCurveOpen((value) => !value)}
              >
                ∿
              </button>
            ) : null}
          </span>
        ) : null}
      </span>
      <input
        type="range"
        min={spec.min}
        max={spec.max}
        step={spec.type === 'int' ? 1 : spec.step ?? 0.01}
        value={numeric}
        aria-label={animation ? spec.label : undefined}
        onChange={(event) => {
          const next = Number(event.target.value);
          // Con pista de keyframes el slider auto-keya en el frame del
          // playhead; sin ella edita el valor estático de siempre.
          if (keyed) animation?.onKeyedValue(next);
          else onChange(next);
        }}
      />
      {curveOpen && animation?.track && animation.track.length >= 2 ? (
        <span className="effect-param-curve">
          {animation.onRemoveKey ? (
            <span className="keyframe-list effect-param-keys">
              {[...animation.track]
                .sort((a, b) => a.frame - b.frame)
                .map((key) => {
                  const position =
                    animation?.frameRate && animation.frameRate > 0
                      ? formatTimecode(key.frame, animation.frameRate)
                      : `frame ${key.frame}`;
                  const label = `${position} · ${displayValue(spec, key.value)}${
                    key.bezier
                      ? ' · curva propia'
                      : key.easing && key.easing !== 'linear'
                        ? ` · ${EASING_LABELS[key.easing]}`
                        : ''
                  }`;
                  return (
                    <span
                      key={key.frame}
                      className={`keyframe-row${
                        key.frame === animation.activeFrame ? ' active' : ''
                      }`}
                    >
                      {animation.onSeek ? (
                        <button
                          type="button"
                          className="small ghost"
                          aria-label={`Ir al frame ${key.frame} de ${spec.label}`}
                          title="Llevar el playhead a esta clave"
                          onClick={() => animation.onSeek?.(key.frame)}
                        >
                          {label}
                        </button>
                      ) : (
                        <span className="fine-print">{label}</span>
                      )}
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`Quitar la clave del frame ${key.frame} de ${spec.label}`}
                        title="Quitar esta clave"
                        onClick={() => animation.onRemoveKey?.(key.frame)}
                      >
                        ×
                      </button>
                    </span>
                  );
                })}
            </span>
          ) : null}
          <KeyframeCurveEditor
            keyframes={animation.track}
            property={spec.label}
            helpId={animation.curveHelpId}
            onEditBezier={animation.onEditCurve}
          />
          {animation.onSetEasing ? (
            <span className="effect-param-easings">
              {[...animation.track]
                .sort((a, b) => a.frame - b.frame)
                .slice(0, -1)
                .map((key, index, sorted) => {
                  const next = sorted[index + 1];
                  const custom = key.bezier !== undefined;
                  return (
                    <label key={key.frame} className="effect-easing-field">
                      <span
                        className="fine-print"
                        title={`Del frame ${key.frame} al ${next?.frame ?? '…'}`}
                      >
                        Tramo {index + 1}
                      </span>
                      <select
                        value={custom ? '__custom' : (key.easing ?? 'linear')}
                        aria-label={`Interpolación del tramo ${index + 1} de ${spec.label}`}
                        onChange={(event) => {
                          const picked = event.target.value;
                          if (picked === '__custom') return;
                          animation.onSetEasing?.(
                            key.frame,
                            picked as NonNullable<EffectKeyframe['easing']>,
                          );
                        }}
                      >
                        <option value="linear">Lineal</option>
                        <option value="ease-in">Acelerar</option>
                        <option value="ease-out">Desacelerar</option>
                        <option value="ease-in-out">Suave</option>
                        <option value="hold">Mantener</option>
                        {custom ? (
                          <option value="__custom" disabled>
                            Curva propia
                          </option>
                        ) : null}
                      </select>
                    </label>
                  );
                })}
            </span>
          ) : null}
          {animation.hasCurve && animation.onClearCurves ? (
            <button
              type="button"
              className="small"
              onClick={animation.onClearCurves}
            >
              Quitar curvas
            </button>
          ) : null}
        </span>
      ) : null}
    </ParamTag>
  );
}

function StackRow({
  instance,
  manifest,
  index,
  total,
  stack,
  onChange,
  keyframeFrame,
  frameRate,
  onSeekFrame,
}: {
  readonly instance: EffectInstance;
  readonly manifest: EffectManifest;
  readonly index: number;
  readonly total: number;
  readonly stack: EffectStack;
  readonly onChange: (next: EffectStack) => void;
  readonly keyframeFrame?: number | undefined;
  readonly frameRate?: number | undefined;
  readonly onSeekFrame?: ((localFrame: number) => void) | undefined;
}) {
  const [open, setOpen] = useState(index === total - 1);
  const groups = paramGroups(manifest);
  const fidelity = manifestFidelity(manifest);
  const note = manifestNote(manifest);

  return (
    <li className={`effect-row${instance.enabled ? '' : ' off'}`}>
      <header className="effect-row-head">
        <span className="effect-row-index">{String(index + 1).padStart(2, '0')}</span>
        <button
          type="button"
          className="effect-row-title"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {manifest.name}
        </button>
        <span className={`effect-card-badge ${fidelity}`}>{fidelityLabel(fidelity)}</span>
        <label className="effect-row-toggle">
          <input
            type="checkbox"
            checked={instance.enabled}
            aria-label={`Activar ${manifest.name}`}
            onChange={(event) => onChange(setInstanceEnabled(stack, instance.id, event.target.checked))}
          />
          <span>{instance.enabled ? 'on' : 'off'}</span>
        </label>
        <div className="effect-row-actions">
          <button
            type="button"
            className="icon-button"
            aria-label="Subir"
            disabled={index === 0}
            onClick={() => onChange(shiftInstance(stack, instance.id, -1))}
          >
            ↑
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Bajar"
            disabled={index === total - 1}
            onClick={() => onChange(shiftInstance(stack, instance.id, 1))}
          >
            ↓
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Duplicar"
            onClick={() =>
              onChange(duplicateInstance(stack, instance.id, newInstanceId(manifest.id)))
            }
          >
            ⧉
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Restablecer"
            onClick={() => onChange(resetInstance(stack, manifest, instance.id))}
          >
            ↺
          </button>
          <button
            type="button"
            className="icon-button danger"
            aria-label="Quitar"
            onClick={() => onChange(removeInstance(stack, instance.id))}
          >
            ×
          </button>
        </div>
      </header>
      {open ? (
        <div className="effect-row-body">
          {groups.map((group) => (
            <fieldset key={group.name ?? 'base'} className="effect-group">
              {group.name ? <legend>{group.name}</legend> : null}
              {group.params.map((spec) => {
                const baseValue = instance.params[spec.id] ?? spec.default;
                const track =
                  keyframeFrame !== undefined && (spec.type === 'float' || spec.type === 'int')
                    ? paramKeyframes(instance, spec.id)
                    : undefined;
                const animated = (track?.length ?? 0) > 0;
                // Con pista, el slider muestra el valor que la preview
                // renderiza en este frame (muestreado), no el estático.
                const value = animated
                  ? (sampleKeyframes(track, keyframeFrame ?? 0) ?? baseValue)
                  : baseValue;
                const animation =
                  keyframeFrame !== undefined && (spec.type === 'float' || spec.type === 'int')
                    ? {
                        active: track?.some((key) => key.frame === keyframeFrame) ?? false,
                        animated,
                        track,
                        hasCurve: track?.some((key) => key.bezier !== undefined) ?? false,
                        curveHelpId: `effect-curve-help-${instance.id}-${spec.id}`,
                        onEditCurve: (index: number, bezier: CubicBezier) => {
                          const sorted = [...(track ?? [])].sort((a, b) => a.frame - b.frame);
                          const key = sorted[index];
                          if (!key) return false;
                          onChange(
                            setParamKeyframeBezier(stack, instance.id, spec.id, key.frame, bezier),
                          );
                          return true;
                        },
                        onSetEasing: (
                          frame: number,
                          easing: NonNullable<EffectKeyframe['easing']>,
                        ) =>
                          onChange(
                            setParamKeyframeEasing(stack, instance.id, spec.id, frame, easing),
                          ),
                        onClearCurves: () =>
                          onChange(clearParamKeyframeCurves(stack, instance.id, spec.id)),
                        onRemoveKey: (frame: number) =>
                          onChange(removeParamKeyframe(stack, instance.id, spec.id, frame)),
                        onSeek: onSeekFrame,
                        activeFrame: keyframeFrame,
                        frameRate,
                        onToggle: () =>
                          onChange(
                            toggleParamKeyframe(
                              stack,
                              manifest,
                              instance.id,
                              spec.id,
                              keyframeFrame,
                            ),
                          ),
                        onClear: () =>
                          onChange(clearParamKeyframes(stack, instance.id, spec.id)),
                        onKeyedValue: (next: number) =>
                          onChange(
                            setParamKeyframeAt(
                              stack,
                              manifest,
                              instance.id,
                              spec.id,
                              keyframeFrame,
                              next,
                            ),
                          ),
                      }
                    : undefined;
                return (
                  <ParamControl
                    key={spec.id}
                    spec={spec}
                    value={value}
                    animation={animation}
                    onChange={(next) =>
                      onChange(setInstanceParam(stack, manifest, instance.id, spec.id, next))
                    }
                  />
                );
              })}
            </fieldset>
          ))}
          {note ? <p className="fine-print">{note}</p> : null}
          {!manifest.ffmpeg && !manifest.audio ? (
            <p className="fine-print">
              Este efecto no tiene receta de export: se ve en el preview y no se escribe en el
              MP4.
            </p>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/** Pila ordenada de efectos del clip, con parámetros y orden de aplicación. */
export function EffectStackPanel({
  stack,
  onChange,
  keyframeFrame,
  frameRate,
  onSeekFrame,
}: EffectStackPanelProps) {
  const resolved = stack
    .map((instance) => ({ instance, manifest: effectRegistry.get(instance.effectId) }))
    .filter((entry): entry is { instance: EffectInstance; manifest: EffectManifest } =>
      Boolean(entry.manifest),
    );

  if (resolved.length === 0) {
    return (
      <div className="effect-stack-empty">
        <p>Este clip no tiene efectos en el stack.</p>
        <p className="fine-print">
          Los efectos se aplican de arriba hacia abajo. Sumá uno desde el catálogo y ajustá sus
          parámetros acá.
        </p>
      </div>
    );
  }

  return (
    <ol className="effect-stack" aria-label="Stack de efectos">
      {resolved.map((entry, index) => (
        <StackRow
          key={entry.instance.id}
          instance={entry.instance}
          manifest={entry.manifest}
          index={index}
          total={resolved.length}
          stack={stack}
          onChange={onChange}
          keyframeFrame={keyframeFrame}
          frameRate={frameRate}
          onSeekFrame={onSeekFrame}
        />
      ))}
    </ol>
  );
}
