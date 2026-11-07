import { useMemo } from 'react';
import {
  addInstance,
  compileAudioStack,
  createInstance,
  effectRegistry,
  fidelityLabel,
  MAX_STACK_EFFECTS,
  type EffectManifest,
  type EffectStack,
} from '@editor-ia/effect-kit';
import { EffectBrowser } from '../vfx/EffectBrowser';
import { EffectStackPanel } from '../vfx/EffectStackPanel';
import { EffectTemplates } from '../vfx/EffectTemplates';

export interface AudioEffectStackProps {
  readonly stack: EffectStack;
  readonly onChange: (next: EffectStack) => void;
  readonly clipLabel?: string | undefined;
}

/**
 * Cadena de efectos de audio del clip.
 *
 * Reutiliza el navegador y el panel de pila del estudio de video: el catálogo
 * es el mismo registro, filtrado por `kind: 'audio'`. La diferencia es que acá
 * no hay preview GPU; lo que sí se muestra es la cadena de filtros compilada,
 * para que se vea exactamente qué va a hacer el render.
 */
export function AudioEffectStack({ stack, onChange, clipLabel }: AudioEffectStackProps) {
  const compiled = useMemo(() => compileAudioStack(effectRegistry, stack), [stack]);
  const full = stack.length >= MAX_STACK_EFFECTS;

  function add(manifest: EffectManifest): void {
    if (full) return;
    onChange(addInstance(stack, createInstance(manifest)));
  }

  return (
    <section className="effect-studio audio-effect-stack" aria-label="Cadena de audio del clip">
      <header className="effect-studio-head">
        <div>
          <h2>Cadena de audio</h2>
          <p className="fine-print">
            {clipLabel ? `${clipLabel} · ` : ''}
            {stack.length} de {MAX_STACK_EFFECTS} ·{' '}
            <strong className={compiled.fidelity}>{fidelityLabel(compiled.fidelity)}</strong>
          </p>
        </div>
      </header>
      <p className="fine-print">
        Los efectos se aplican en el export, en el orden de la pila y antes del fader del clip.
        La preview reproduce el audio original.
      </p>
      <EffectBrowser kind="audio" onAdd={add} disabled={full} />
      <EffectStackPanel stack={stack} onChange={onChange} />
      <EffectTemplates kind="audio" stack={stack} onApply={(next) => onChange(next)} />
      {compiled.filters.length > 0 ? (
        <details className="audio-chain">
          <summary>Cadena de filtros ({compiled.filters.length})</summary>
          <ol>
            {compiled.filters.map((filter, index) => (
              <li key={`${index}-${filter}`}>
                <code>{filter}</code>
              </li>
            ))}
          </ol>
        </details>
      ) : null}
      {compiled.notes.length > 0 ? (
        <ul className="fine-print audio-chain-notes">
          {compiled.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
