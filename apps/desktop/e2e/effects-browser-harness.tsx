import '../src/styles/tokens.css';
import '../src/styles/app.css';
import '../src/styles/chrome.css';
import '../src/styles/flat.css';
import { createRoot } from 'react-dom/client';
import { EffectBrowser } from '../src/features/effects/EffectBrowser';
import { FALLBACK_VISUAL_CATALOG } from '../src/features/visuals/visuals';

const root = document.getElementById('root')!;
createRoot(root).render(
  <div style={{ width: 760, padding: 14 }}>
    <EffectBrowser
      catalog={FALLBACK_VISUAL_CATALOG}
      disabled={false}
      onApply={() => {}}
    />
  </div>,
);
