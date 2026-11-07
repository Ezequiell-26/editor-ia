import { useState } from 'react';
import type { ColorGradeLayer } from '@editor-ia/project-schema';
import {
  EffectsPanel, HdrPanel, PrimariesPanel, QualifierPanel, WindowsPanel,
  type LayerChange,
} from './GradeControls';
import { CurvesPanel, type GradeCurveTool } from './GradeCurves';

export type StudioToolId = 'primaries' | 'hdr' | 'curves' | 'masks' | 'effects' | 'scopes' | 'gallery';

const CURVE_TOOLS: readonly { id: GradeCurveTool; label: string }[] = [
  { id: 'custom', label: 'Custom' },
  { id: 'rgb', label: 'RGB' },
  { id: 'selective', label: 'Hue / Luma' },
];

export function GradeControlsPanel({
  tool, layer, onChange, onImportLut, lutLabel,
}: {
  readonly tool: StudioToolId;
  readonly layer: ColorGradeLayer;
  readonly onChange: LayerChange;
  readonly onImportLut: () => void;
  readonly lutLabel: string;
}) {
  const [curveTool, setCurveTool] = useState<GradeCurveTool>('custom');
  const [maskTab, setMaskTab] = useState<'qualifier' | 'windows'>('qualifier');

  if (tool === 'primaries') return <PrimariesPanel layer={layer} onChange={onChange} />;
  if (tool === 'hdr') return <HdrPanel layer={layer} onChange={onChange} />;
  if (tool === 'effects') {
    return <EffectsPanel layer={layer} onChange={onChange} onImportLut={onImportLut} lutLabel={lutLabel} />;
  }
  if (tool === 'masks') {
    return (
      <div className="cg-panel">
        <div className="cg-subtabs" role="tablist" aria-label="Tipo de máscara">
          <button type="button" role="tab" aria-selected={maskTab === 'qualifier'} className={maskTab === 'qualifier' ? 'active' : ''}
            onClick={() => setMaskTab('qualifier')}>Qualifier</button>
          <button type="button" role="tab" aria-selected={maskTab === 'windows'} className={maskTab === 'windows' ? 'active' : ''}
            onClick={() => setMaskTab('windows')}>Power Windows</button>
        </div>
        {maskTab === 'qualifier'
          ? <QualifierPanel layer={layer} onChange={onChange} />
          : <WindowsPanel layer={layer} onChange={onChange} />}
      </div>
    );
  }
  if (tool === 'curves') {
    return (
      <div className="cg-panel">
        <div className="cg-subtabs" role="tablist" aria-label="Tipo de curva">
          {CURVE_TOOLS.map((entry) => (
            <button key={entry.id} type="button" role="tab" aria-selected={curveTool === entry.id}
              className={curveTool === entry.id ? 'active' : ''} onClick={() => setCurveTool(entry.id)}>
              {entry.label}
            </button>
          ))}
        </div>
        <CurvesPanel layer={layer} onChange={onChange} tool={curveTool} />
      </div>
    );
  }
  return null;
}
