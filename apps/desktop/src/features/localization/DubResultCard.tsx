import { Icon } from '../../components/Icon';
import type { DubResult } from '../../services/project-service';
import { formatLocalizationBytes } from './localization';

interface DubResultCardProps {
  readonly result: DubResult;
  readonly importing: boolean;
  readonly imported: boolean;
  readonly onImport: () => void;
  readonly onReveal: () => void;
  readonly onOpenMedia: () => void;
}

/** Resultado del doblaje con sus acciones: importar al proyecto o abrir la carpeta. */
export function DubResultCard({
  result,
  importing,
  imported,
  onImport,
  onReveal,
  onOpenMedia,
}: DubResultCardProps) {
  return (
    <div className="localization-dub-result">
      <div className="localization-dub-summary" role="status">
        <p className="compress-numbers">
          MP4 {result.width}×{result.height} ·{' '}
          <strong>{formatLocalizationBytes(result.bytes)}</strong> ·{' '}
          {result.durationSeconds.toFixed(1)} s · {result.cues} subtítulos
        </p>
        <p className="compress-path">{result.path}</p>
        <p className="fine-print">
          Voz: {result.voice}.{' '}
          {result.replacedOriginalAudio
            ? 'Audio original reemplazado.'
            : `Audio original al ${Math.round(result.originalAudioVolume * 100)}%.`}
        </p>
        {result.warnings.length > 0 ? (
          <ul className="fine-print">
            {result.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className="localization-dub-actions">
        <button type="button" className="ghost" onClick={onReveal}>
          Mostrar en carpeta
        </button>
        <button
          type="button"
          className="primary icon-text"
          onClick={onImport}
          disabled={importing || imported}
        >
          <Icon name={imported ? 'check' : 'plus'} size={14} />
          <span>
            {imported ? 'Importado al proyecto' : importing ? 'Importando…' : 'Importar al proyecto'}
          </span>
        </button>
        {imported ? (
          <button type="button" className="ghost" onClick={onOpenMedia}>
            Ver en Medios
          </button>
        ) : null}
      </div>
    </div>
  );
}
