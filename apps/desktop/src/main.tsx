import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { applyAppearance, loadAppearance } from './state/appearance';
import './styles/tokens.css';
import './styles/app.css';
import './styles/chrome.css';
import './styles/flat.css';
import './styles/panda.css';
import './styles/compliance.css';
import './styles/scopes.css';
import './styles/settings.css';
import './styles/home.css';
import './styles/start-screen.css';
import './styles/resolve-theme.css';
import './styles/olyvia.css';
import './styles/effect-studio.css';
import './styles/brain.css';
import './styles/commercial.css';
import './styles/shortcuts-and-tour.css';

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
