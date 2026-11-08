import { useMemo, useState } from 'react';
import {
  addInstance,
  compileStack,
  createInstance,
  effectRegistry,
  fidelityLabel,
  MAX_STACK_EFFECTS,
  type EffectKind,
  type EffectManifest,
  type EffectStack,
} from '@editor-ia/effect-kit';
import { EffectBrowser } from './EffectBrowser';
import { EffectCanvas } from './EffectCanvas';
import { EffectStackPanel } from './EffectStackPanel';
import { EffectTemplates } from './EffectTemplates';

export interface EffectStudioProps {
  readonly stack: EffectStack;
  readonly onChange: (next: EffectStack) => void;
  readonly mediaEl: HTMLVideoElement | HTMLImageElement | null;
  readonly localFrame: number;
  readonly frameRate: number;
  readonly clipLabel: string;
}

/**
 * Estudio de efectos del clip: catálogo, pila ordenada y preview GPU.
 *
 * Es la pieza que faltaba para que los efectos sean editables de verdad: el
 * catálogo alimenta la pila, la pila alimenta el preview y el mismo stack se
 * compila para exportar. Nada de esto toca el schema del clip: sólo escribe
 * `effects.stack`.
 */
export function EffectStudio({
  stack,
  onChange,
  mediaEl,
  localFrame,
  frameRate,
  clipLabel,
}: EffectStudioProps) {
  const [kind, setKind] = useState<EffectKind>('video');
  const [preview, setPreview] = useState(true);

  const compiled = useMemo(() => compileStack(effectRegistry, stack), [stack]);
  const full = stack.length >= MAX_STACK_EFFECTS;

  function add(manifest: EffectManifest): void {
    if (full) return;
    onChange(addInstance(stack, createInstance(manifest)));
  }

  return (
    <section className="effect-studio" aria-label="Estudio de efectos">
      <header className="effect-studio-head">
        <div>
          <h2>Stack de efectos</h2>
          <p className="fine-print">
            {clipLabel} · {stack.length} de {MAX_STACK_EFFECTS} ·{' '}
            <strong className={compiled.fidelity}>{fidelityLabel(compiled.fidelity)}</strong>
          </p>
        </div>
        <div className="effect-studio-actions">
          <button
            type="button"
            className="small"
            aria-pressed={preview}
            onClick={() => setPreview((value) => !value)}
          >
            {preview ? 'Ocultar preview' : 'Ver preview'}
          </button>
          <button
            type="button"
            className="small ghost"
            disabled={stack.length === 0}
            onClick={() => onChange([])}
          >
            Vaciar stack
          </button>
        </div>
      </header>

      <div className="effect-studio-grid">
        <div className="effect-studio-preview">
          {preview ? (
            <div className="effect-preview-frame">
              <EffectCanvas
                source={mediaEl}
                stack={stack}
                frameIndex={localFrame}
                frameRate={frameRate}
                active={preview}
              />
              {stack.length === 0 ? (
                <span className="effect-preview-hint">Sin efectos: se ve el frame original</span>
              ) : null}
            </div>
          ) : null}
          {compiled.notes.length > 0 ? (
            <details className="effect-notes">
              <summary>Notas de export ({compiled.notes.length})</summary>
              <ul>
                {compiled.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>

        <div className="effect-studio-panel">
          <div className="effect-kind-tabs" role="tablist" aria-label="Tipo de efecto">
            {(['video', 'transition'] as const).map((entry) => (
              <button
                key={entry}
                type="button"
                role="tab"
                aria-selected={kind === entry}
                className={`chip${kind === entry ? ' on' : ''}`}
                onClick={() => setKind(entry)}
              >
                {entry === 'video' ? 'Efectos' : 'Transiciones'}
              </button>
            ))}
          </div>
          <EffectBrowser kind={kind} onAdd={add} disabled={full} />
        </div>

        <div className="effect-studio-stack">
          <EffectStackPanel stack={stack} onChange={onChange} keyframeFrame={localFrame} />
          <EffectTemplates kind="video" stack={stack} onApply={(next) => onChange(next)} />
          {full ? (
            <p className="fine-print">
              Llegaste al máximo de {MAX_STACK_EFFECTS} efectos en un clip. Quitá uno para sumar
              otro.
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
