import { ColorSwatch } from '../../components/ColorSwatch';
import { useState } from 'react';
import {
  duplicateInstance,
  effectRegistry,
  fidelityLabel,
  manifestFidelity,
  manifestNote,
  newInstanceId,
  paramGroups,
  paramKeyframes,
  removeInstance,
  resetInstance,
  sampleKeyframes,
  setInstanceEnabled,
  setInstanceParam,
  setParamKeyframeAt,
  shiftInstance,
  toggleParamKeyframe,
  clearParamKeyframes,
  type EffectInstance,
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

interface ParamAnimation {
  /** Hay una clave exactamente en el frame del playhead. */
  readonly active: boolean;
  /** La pista existe (aunque el playhead no caiga sobre una clave). */
  readonly animated: boolean;
  readonly onToggle: () => void;
  readonly onClear: () => void;
  /** Escribe/crea la clave del frame (auto-key del slider). */
  readonly onKeyedValue: (next: number) => void;
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
}: {
  readonly instance: EffectInstance;
  readonly manifest: EffectManifest;
  readonly index: number;
  readonly total: number;
  readonly stack: EffectStack;
  readonly onChange: (next: EffectStack) => void;
  readonly keyframeFrame?: number | undefined;
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
export function EffectStackPanel({ stack, onChange, keyframeFrame }: EffectStackPanelProps) {
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
        />
      ))}
    </ol>
  );
}
