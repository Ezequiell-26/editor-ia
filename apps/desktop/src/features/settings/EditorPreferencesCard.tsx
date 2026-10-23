import { useEffect, useState } from 'react';
import {
  EDITOR_PREFERENCE_BOUNDS,
  resetEditorPreferences,
  updateEditorPreferences,
  type EditorPreferences,
} from '../../state/editor-preferences';
import { useEditorPreferences } from '../../state/useEditorPreferences';

interface RangeFieldProps {
  readonly label: string;
  readonly hint: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly format: (value: number) => string;
  readonly onChange: (value: number) => void;
}

/**
 * Slider con espejo local: el pulgar avanza mientras se arrastra y el cambio
 * se persiste al soltar, igual que en Apariencia. Evita una escritura por
 * evento y el consecuente re-render del editor completo.
 */
function RangeField({
  label,
  hint,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: RangeFieldProps) {
  const [local, setLocal] = useState(value);

  useEffect(() => {
    setLocal(value);
  }, [value]);

  function commit(element: HTMLInputElement): void {
    onChange(Number(element.value));
  }

  return (
    <label className="appearance-field">
      <span className="appearance-label">
        {label} <output>{format(local)}</output>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={local}
        aria-label={label}
        onChange={(event) => setLocal(Number(event.target.value))}
        onPointerUp={(event) => commit(event.currentTarget)}
        onKeyUp={(event) => commit(event.currentTarget)}
        onBlur={() => onChange(local)}
      />
      <small className="prefs-hint">{hint}</small>
    </label>
  );
}

export function EditorPreferencesCard() {
  const preferences = useEditorPreferences();

  function patch(next: Partial<Omit<EditorPreferences, 'version'>>): void {
    updateEditorPreferences(next);
  }

  const bounds = EDITOR_PREFERENCE_BOUNDS;

  return (
    <article className="card prefs-card">
      <header className="appearance-top">
        <div>
          <h3>Comportamiento del editor</h3>
          <p className="muted">
            Cambian cómo responde la timeline, el guardado y la reproducción. Se guardan en este
            equipo y se aplican en el acto.
          </p>
        </div>
        <button
          type="button"
          className="ghost appearance-reset"
          onClick={() => resetEditorPreferences()}
        >
          Restablecer
        </button>
      </header>

      <div className="prefs-grid">
        <RangeField
          label="Autoguardado"
          hint="Espera desde el último cambio antes de escribir en disco."
          value={preferences.autosaveDelayMs}
          min={bounds.autosaveDelayMs.min}
          max={bounds.autosaveDelayMs.max}
          step={bounds.autosaveDelayMs.step}
          format={(value) => `${(value / 1000).toFixed(1)} s`}
          onChange={(value) => patch({ autosaveDelayMs: value })}
        />
        <RangeField
          label="Historial de deshacer"
          hint="Cuántos pasos se conservan; más pasos usan más memoria."
          value={preferences.historyLimit}
          min={bounds.historyLimit.min}
          max={bounds.historyLimit.max}
          step={bounds.historyLimit.step}
          format={(value) => `${value} pasos`}
          onChange={(value) => patch({ historyLimit: value })}
        />
        <RangeField
          label="Zoom inicial"
          hint="Con qué escala abre la timeline al entrar al editor."
          value={preferences.defaultZoom}
          min={bounds.defaultZoom.min}
          max={bounds.defaultZoom.max}
          step={bounds.defaultZoom.step}
          format={(value) => `${value.toFixed(1)} px/frame`}
          onChange={(value) => patch({ defaultZoom: value })}
        />
        <RangeField
          label="Tolerancia del imán"
          hint="Distancia en píxeles a la que el imán atrae un borde."
          value={preferences.snapPixels}
          min={bounds.snapPixels.min}
          max={bounds.snapPixels.max}
          step={bounds.snapPixels.step}
          format={(value) => `${value} px`}
          onChange={(value) => patch({ snapPixels: value })}
        />
        <RangeField
          label="Paso de las flechas"
          hint="Con Shift se multiplica por diez para saltos largos."
          value={preferences.jumpStepFrames}
          min={bounds.jumpStepFrames.min}
          max={bounds.jumpStepFrames.max}
          step={bounds.jumpStepFrames.step}
          format={(value) => `${value} frame${value === 1 ? '' : 's'}`}
          onChange={(value) => patch({ jumpStepFrames: value })}
        />
      </div>

      <div className="appearance-checks prefs-checks">
        <label className="check">
          <input
            type="checkbox"
            checked={preferences.snapEnabled}
            onChange={(event) => patch({ snapEnabled: event.target.checked })}
          />
          Imán activo al abrir la timeline
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={preferences.followPlayhead}
            onChange={(event) => patch({ followPlayhead: event.target.checked })}
          />
          Seguir al playhead al reproducir
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={preferences.showWaveforms}
            onChange={(event) => patch({ showWaveforms: event.target.checked })}
          />
          Formas de onda en los clips
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={preferences.showThumbnails}
            onChange={(event) => patch({ showThumbnails: event.target.checked })}
          />
          Miniaturas en los clips
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={preferences.loopPlayback}
            onChange={(event) => patch({ loopPlayback: event.target.checked })}
          />
          Reproducción en bucle
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={preferences.safeMargins}
            onChange={(event) => patch({ safeMargins: event.target.checked })}
          />
          Guías de acción y título visibles
        </label>
      </div>

      <p className="fine-print">
        Las formas de onda y las miniaturas se pueden apagar para aliviar equipos modestos: al
        apagarlas, la timeline deja de pedir archivos al disco.
      </p>
    </article>
  );
}
