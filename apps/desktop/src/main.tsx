import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { DualMonitorView, useDualMonitorMode } from './features/editor/DualMonitorView';
import { applyAppearance, loadAppearance } from './state/appearance';
import './styles/tokens.css';
import './styles/app.css';
import './styles/premium-animations.css';
import './styles/dopamine-ux.css';
import './styles/chrome.css';
import './styles/flat.css';
import './styles/panda.css';
// scopes.css y compliance.css ya no son críticos: viven en
// `styles/entries/{editor,content}.css` (segunda fase del CSS splitting,
// ver docs/CSS-PERF-NOTES.md §5 y la cola de mejora). settings.css sigue
// crítico: premium/shell.css y filmora.css tienen reglas `.settings-window`
// de igual especificidad que dependen de cargar DESPUÉS de ella.
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
// Capa visual del preset «CapCut»: sólo actúa con `data-preset="capcut"`.
// Va última para ganar por especificidad a las capas anteriores.
import './styles/capcut.css';
// Layouts alternativos del editor (`layout-shorts`): debe ir DESPUÉS de
// todas las capas porque los presets fijan la grilla con `!important`.
import './styles/layouts.css';
// HY4 · Lenguaje visual CapCut medido sobre las capturas de referencia.
// ADDITIVA y última del cascade: sobreescribe tokens y geometría sin tocar
// ninguna hoja existente. Sólo actúa con el tema oscuro; el preset opcional
// «CapCut» y el tema claro conservan sus propias capas.
import './styles/capcut-ui.css';
// HY4 · Editor claro: proporciones del monitor, pestañas rotuladas y
// legibilidad. Va después de capcut-ui.css porque fija la grilla del editor.
import './styles/capcut-editor.css';
// HY4 · Edición fácil: todas las pestañas del inspector visibles y el mismo
// patrón de control (etiqueta · valor · reset) en Color y en el resto de
// apartados. Última del cascade; no añade lógica ni contratos.
import './styles/capcut-inspector.css';
// Auditoría visual 2026-11-11: cero etiquetas cortadas, pestañas completas,
// zoom continuo del timeline y acceso A/B. Última del cascade, sólo tema oscuro.
import './styles/editor-clarity.css';

// Pulido visual medido con REA + Playwright: aviso de modo navegador sin
// recortes y controles deshabilitados legibles.
import './styles/visual-polish.css';

// Chrome AlaukCut del editor unificado: variables --alauk-*/--color-*,
// barra superior/pie (`.alauk-*`) y retirada del cromo clásico del AppShell.
// Se aplica en TODOS los modos; «Vista completa» (data-editor-skin='full')
// lo desactiva en caliente. Última del cascade.
import './styles/alauk-chrome.css';
// Composición de referencia (capturas 146–160) sobre el editor productivo.
// ADDITIVA y ÚLTIMA de la cascada: sólo actúa en modo timeline con proyecto
// y se desactiva en caliente con «Vista completa» (data-editor-skin='full').
import './styles/alaukcut-reference.css';
// Refino final «quiet premium»: resta decoración acumulada y unifica el chat
// con la paleta cobalt aprobada. Va DESPUÉS de todas las capas visuales.
import './styles/refinement.css';

// Apply the saved chrome before the first paint so the window never flashes
// the default palette when a custom one is stored.
applyAppearance(loadAppearance());

const container = document.getElementById('root');
if (!container) {
  throw new Error('index.html no trae el elemento #root');
}

/** Raíz dual-aware: la ventana `dual-monitor` (`?dual=1` o label Tauri)
 *  monta sólo el monitor; cualquier otra ventana monta la app completa.
 *  Mientras se resuelve el modo se muestra un splash mínimo para no
 *  flashear el editor en la ventana dual. */
function Root() {
  const dual = useDualMonitorMode();
  if (dual === null) {
    return <div className="dual-monitor-boot">Olyvia</div>;
  }
  if (dual) return <DualMonitorView />;
  return <App />;
}

createRoot(container).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
