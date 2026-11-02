import { useState } from 'react';
import {
  duplicateInstance,
  effectRegistry,
  fidelityLabel,
  manifestFidelity,
  manifestNote,
  newInstanceId,
  paramGroups,
  removeInstance,
  resetInstance,
  setInstanceEnabled,
  setInstanceParam,
  shiftInstance,
  type EffectInstance,
  type EffectManifest,
  type EffectStack,
  type ParamSpec,
  type ParamValue,
} from '@editor-ia/effect-kit';

export interface EffectStackPanelProps {
  readonly stack: EffectStack;
  readonly onChange: (next: EffectStack) => void;
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

function ParamControl({
  spec,
  value,
  onChange,
}: {
  readonly spec: ParamSpec;
  readonly value: ParamValue;
  readonly onChange: (next: ParamValue) => void;
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
        <input
          type="color"
          value={typeof value === 'string' ? value : spec.default}
          onChange={(event) => onChange(event.target.value)}
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
  return (
    <label className="effect-param">
      <span>
        {spec.label} <em>{displayValue(spec, value)}</em>
      </span>
      <input
        type="range"
        min={spec.min}
        max={spec.max}
        step={spec.type === 'int' ? 1 : spec.step ?? 0.01}
        value={numeric}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function StackRow({
  instance,
  manifest,
  index,
  total,
  stack,
  onChange,
}: {
  readonly instance: EffectInstance;
  readonly manifest: EffectManifest;
  readonly index: number;
  readonly total: number;
  readonly stack: EffectStack;
  readonly onChange: (next: EffectStack) => void;
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
              {group.params.map((spec) => (
                <ParamControl
                  key={spec.id}
                  spec={spec}
                  value={instance.params[spec.id] ?? spec.default}
                  onChange={(next) =>
                    onChange(setInstanceParam(stack, manifest, instance.id, spec.id, next))
                  }
                />
              ))}
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
export function EffectStackPanel({ stack, onChange }: EffectStackPanelProps) {
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
        />
      ))}
    </ol>
  );
}
