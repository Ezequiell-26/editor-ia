import { ColorSwatch } from '../../../components/ColorSwatch';
import type { ChromaKey } from '@editor-ia/project-schema';
import { InspectorSection as Section } from '../InspectorSection';
import { NumberField } from './fields';

/**
 * Sección «Fondo / chroma key» del inspector de clip. Extraída de
 * `Inspector.tsx` sin cambiar comportamiento ni textos visibles.
 */
export function ChromaKeySection({
  chromaKey,
  setChromaKey,
}: {
  readonly chromaKey: ChromaKey | undefined;
  readonly setChromaKey: (next: ChromaKey | undefined) => void;
}) {
  return (
    <Section title="Fondo / chroma key" group="video" subtab="mask">
      <div className="inspector-grid">
        <label className="field">
          <span>Color a remover</span>
          <ColorSwatch
            label="Color a remover"
            value={chromaKey?.color ?? '#00ff00'}
            onChange={(hex) =>
              setChromaKey({
                color: hex,
                similarity: chromaKey?.similarity ?? 0.3,
                blend: chromaKey?.blend ?? 0.1,
              })
            }
          />
        </label>
        <NumberField
          label="Similitud (%)"
          value={Math.round((chromaKey?.similarity ?? 0.3) * 100)}
          min={1}
          max={100}
          disabled={chromaKey === undefined}
          onCommit={(value) =>
            setChromaKey({
              color: chromaKey?.color ?? '#00ff00',
              similarity: value / 100,
              blend: chromaKey?.blend ?? 0.1,
            })
          }
        />
        <NumberField
          label="Mezcla (%)"
          value={Math.round((chromaKey?.blend ?? 0.1) * 100)}
          min={0}
          max={100}
          disabled={chromaKey === undefined}
          onCommit={(value) =>
            setChromaKey({
              color: chromaKey?.color ?? '#00ff00',
              similarity: chromaKey?.similarity ?? 0.3,
              blend: value / 100,
            })
          }
        />
      </div>
      <div className="actions compact">
        <button
          type="button"
          className="small"
          onClick={() => setChromaKey({ color: '#00ff00', similarity: 0.3, blend: 0.1 })}
        >
          Fondo verde
        </button>
        <button
          type="button"
          className="small"
          onClick={() => setChromaKey({ color: '#0000ff', similarity: 0.3, blend: 0.1 })}
        >
          Fondo azul
        </button>
        <button
          type="button"
          className="small ghost"
          onClick={() => setChromaKey(undefined)}
          disabled={chromaKey === undefined}
        >
          Quitar
        </button>
      </div>
      <p className="fine-print">
        El render remueve el color con FFmpeg y deja el canal alfa para la capa inferior. La
        vista previa no simula el recorte; revisá el MP4. Para fondos reales sin croma hace
        falta un modelo de segmentación, que no está incluido.
      </p>
    </Section>
  );
}
