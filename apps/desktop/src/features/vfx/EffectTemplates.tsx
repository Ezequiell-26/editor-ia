import { useRef, useState } from 'react';
import type { EffectStack } from '@editor-ia/effect-kit';
import {
  deleteEffectTemplate,
  loadEffectTemplates,
  parseEffectTemplateFile,
  saveEffectTemplate,
  serializeEffectTemplate,
  stackFromTemplate,
  type EffectTemplate,
  type EffectTemplateKind,
} from '../../state/effect-templates';
import { builtinEffectTemplates } from '../../state/builtin-effect-templates';

export interface EffectTemplatesProps {
  readonly kind: EffectTemplateKind;
  readonly stack: EffectStack;
  /** Reemplaza el stack del clip por el de la plantilla. */
  readonly onApply: (next: EffectStack, skipped: number) => void;
}

function downloadJson(template: EffectTemplate): void {
  const blob = new Blob([serializeEffectTemplate(template)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${template.name.replace(/[^\wáéíóúñü-]+/gi, '-').toLowerCase()}.effect-template.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** jsdom no implementa `Blob.text()`: se lee con FileReader como el navegador. */
function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error ?? new Error('no se pudo leer el archivo'));
    reader.readAsText(file);
  });
}

/**
 * Plantillas del stack de efectos: guardar la pila actual, aplicarla a otro
 * clip, exportar/importar como JSON. Viven en `localStorage` de la app; el
 * archivo `.effect-template.json` es portable entre máquinas.
 */
export function EffectTemplates({ kind, stack, onApply }: EffectTemplatesProps) {
  const [templates, setTemplates] = useState<readonly EffectTemplate[]>(() =>
    loadEffectTemplates().filter((entry) => entry.kind === kind),
  );
  const builtins = builtinEffectTemplates(kind);
  const [name, setName] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function refresh(): void {
    setTemplates(loadEffectTemplates().filter((entry) => entry.kind === kind));
  }

  function save(): void {
    if (stack.length === 0) {
      setNotice('El stack está vacío: no hay nada que guardar.');
      return;
    }
    setTemplates(saveEffectTemplate(name, kind, stack));
    setName('');
    setNotice(`Plantilla «${name.trim() || 'sin nombre'}» guardada.`);
  }

  function apply(template: EffectTemplate): void {
    const { stack: next, skipped } = stackFromTemplate(template);
    if (next.length === 0) {
      setNotice(`«${template.name}» no tiene efectos compatibles con este catálogo.`);
      return;
    }
    onApply(next, skipped);
    setNotice(
      skipped > 0
        ? `«${template.name}» aplicada (${skipped} efecto(s) omitidos por no existir).`
        : `«${template.name}» aplicada.`,
    );
  }

  function remove(id: string): void {
    setTemplates(deleteEffectTemplate(id));
  }

  async function importFile(file: File): Promise<void> {
    const parsed = parseEffectTemplateFile(await readFileText(file));
    if (!parsed.ok) {
      setNotice(parsed.error);
      return;
    }
    if (parsed.template.kind !== kind) {
      setNotice(
        `«${parsed.template.name}» es de ${parsed.template.kind === 'video' ? 'video' : 'audio'}; esta pila es de ${kind === 'video' ? 'video' : 'audio'}.`,
      );
      return;
    }
    setTemplates(saveEffectTemplate(parsed.template.name, kind, parsed.template.stack));
    setNotice(`Plantilla «${parsed.template.name}» importada.`);
  }

  return (
    <details className="effect-templates">
      <summary>Plantillas ({templates.length + builtins.length})</summary>
      <div className="effect-templates-body">
        {builtins.length > 0 ? (
          <>
            <p className="fine-print effect-templates-section">De fábrica</p>
            <ul className="effect-templates-list">
              {builtins.map((template) => (
                <li key={template.id} className="effect-template-row">
                  <span className="effect-template-name">{template.name}</span>
                  <span className="fine-print">
                    {template.stack.length} efecto(s)
                  </span>
                  <span className="effect-template-actions">
                    <button
                      type="button"
                      className="small ghost"
                      onClick={() => apply(template)}
                    >
                      Aplicar
                    </button>
                    <button
                      type="button"
                      className="small ghost"
                      onClick={() => downloadJson(template)}
                    >
                      Exportar
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : null}
        {templates.length === 0 ? (
          <p className="fine-print">
            Todavía no guardaste plantillas propias de {kind === 'video' ? 'video' : 'audio'}.
            Guardá la pila actual para reutilizarla en otros clips.
          </p>
        ) : (
          <>
            {builtins.length > 0 ? (
              <p className="fine-print effect-templates-section">Propias</p>
            ) : null}
            <ul className="effect-templates-list">
              {templates.map((template) => (
                <li key={template.id} className="effect-template-row">
                  <span className="effect-template-name">{template.name}</span>
                  <span className="fine-print">
                    {template.stack.length} efecto(s)
                  </span>
                  <span className="effect-template-actions">
                    <button
                      type="button"
                      className="small ghost"
                      onClick={() => apply(template)}
                    >
                      Aplicar
                    </button>
                    <button
                      type="button"
                      className="small ghost"
                      onClick={() => downloadJson(template)}
                    >
                      Exportar
                    </button>
                    <button
                      type="button"
                      className="small ghost"
                      aria-label={`Quitar plantilla ${template.name}`}
                      onClick={() => remove(template.id)}
                    >
                      Quitar
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
        <div className="effect-templates-save">
          <input
            type="text"
            value={name}
            maxLength={80}
            placeholder="Nombre de la plantilla"
            aria-label="Nombre de la plantilla"
            onChange={(event) => setName(event.target.value)}
          />
          <button
            type="button"
            className="small"
            disabled={stack.length === 0}
            onClick={save}
          >
            Guardar stack actual
          </button>
          <button
            type="button"
            className="small ghost"
            onClick={() => fileRef.current?.click()}
          >
            Importar…
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            hidden
            aria-label="Importar plantilla JSON"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importFile(file);
              event.target.value = '';
            }}
          />
        </div>
        {notice ? <p className="fine-print effect-templates-notice">{notice}</p> : null}
      </div>
    </details>
  );
}
