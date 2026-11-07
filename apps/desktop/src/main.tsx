import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { applyAppearance, loadAppearance } from './state/appearance';
import './styles/tokens.css';
import './styles/app.css';
import './styles/premium-animations.css';
import './styles/dopamine-ux.css';
import './styles/chrome.css';
import './styles/flat.css';
import './styles/panda.css';
import './styles/compliance.css';
import './styles/scopes.css';
import './styles/settings.css';
import './styles/start-screen.css';
import './styles/resolve-theme.css';
import './styles/olyvia.css';
import './styles/commercial.css';
import './styles/shortcuts-and-tour.css';

// ── Capa de rediseño premium (última: gana la cascada) ─────────────────────
// Tokens y base primero, luego shell/launcher. La capa de editor
// (premium/workspace) y la de contenido (premium/views) NO se importan acá:
// viven en `styles/entries/{editor,content}.css` y `App.tsx` las carga en un
// entry dinámico antes de montar la primera vista, para que el launcher no
// pague ~145 KB de CSS que no usa. Ver docs/CSS-PERF-NOTES.md §5.
import './styles/premium/tokens.css';
import './styles/premium/base.css';
import './styles/premium/components.css';
import './styles/premium/shell.css';
import './styles/premium/launcher.css';

// Capa visual Filmora 12: SIEMPRE al final del CSS crítico. Los entries de
// editor/contenido se inyectan después por import() dinámico, pero la capa
// no se repite: sus reglas usan la especificidad y !important necesarios
// para ganar igual (verificado con SSIM 1.0 en 10 vistas).
import './styles/filmora/filmora.css';
// Estados/overlays de las capturas 93–128 que se añadieron después de la capa
// base. Debe ir DESPUÉS de filmora.css: sus reglas complementan (no repiten)
// la cascada y usan la misma especificidad `.app-shell … !important`.
import './styles/filmora/filmora-states.css';
// Pulido final medido (tipografía, iconos, contraste, áreas de clic y detalles).
// Debe ir DESPUÉS de states: corrige sus reglas sin reemplazarlas.
import './styles/filmora/filmora-polish.css';

// Apply the saved chrome before the first paint so the window never flashes
// the default palette when a custom one is stored.
applyAppearance(loadAppearance());

const container = document.getElementById('root');
if (!container) {
  throw new Error('index.html no trae el elemento #root');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
