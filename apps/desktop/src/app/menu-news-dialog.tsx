import { useEffect, useState, type ReactNode } from 'react';
import type { ViewId } from './navigation';
import { CURRENT_APP_VERSION } from './version';
import { LIVE_UPDATE_FEATURES, LiveUpdateFeatureList } from '../features/editor/FilmoraStates';

/** Disponibilidad real de cada entrada visible en la captura 99. Las que ya
 *  existen en Editor IA permiten abrir su superficie; las demás se declaran
 *  pendientes en lugar de simular que funcionan. */
const NEWS_AVAILABILITY: Record<string, { detail: string; view?: ViewId; pending?: boolean }> = {
  'Seguimiento de cámara': {
    detail:
      'Seguimiento de rostro sobre el clip: en el inspector, pestaña Vídeo → Seguimiento → «Centrar rostro» detecta el rostro en el tramo y crea keyframes de posición y escala (camera tracking). Requiere el modelo de rostros descargado en Ajustes → Capacidades; sigue rostros, no objetos genéricos.',
    view: 'editor',
  },
  'Máscara de color': {
    detail: 'Pestaña del inspector con capas de gradación, Básico, HSL, Curvas, Ruedas cromáticas y HDR. Los controles tienen estado real de capa.',
    view: 'editor',
  },
  'Recuadre de vídeo inteligente': {
    detail: 'Reencuadre automático por sujeto. Editor IA ofrece variantes de formato 9:16 / 16:9 / 1:1 en el Creador.',
    view: 'creator',
  },
  'Análisis multimedia con IA': {
    detail: 'Análisis medido de clips, cortes con motivo y shorts. Disponible en el Director local y como modo dentro del editor.',
    view: 'director',
  },
  'Corrección inteligente de color': {
    detail: 'Corrección automática asistida. Los ajustes manuales de Color y Máscara de color funcionan; el automático requiere motor de color.',
    pending: true,
  },
  'Grabación de varias fuentes': {
    detail: 'Captura multipantalla/multicámara con conmutación en vivo. La superficie Multicámara está preparada, la captura requiere backend.',
    pending: true,
  },
  'Atajos de teclado': {
    detail: 'Atajos configurables del estudio, disponibles desde el menú Ayuda y desde Ajustes.',
    view: 'settings',
  },
  'Contenedor multimedia': {
    detail: 'Biblioteca local de vídeo, imagen y audio con importación, metadatos y estados de verificación.',
    view: 'assets',
  },
  'Exportación por lotes': {
    detail: 'Cola de renders múltiples. La exportación individual verificada con FFmpeg funciona; el lote requiere integración.',
    pending: true,
  },
  'Color automático': {
    detail: 'Balance de blancos y color automáticos. Los controles manuales están activos; el cálculo automático requiere motor de color.',
    pending: true,
  },
  'Animación combinada': {
    detail: 'Presets de entrada, salida y combinados sobre el clip. Disponible en la pestaña Animación del inspector.',
    view: 'editor',
  },
};

/** Ilustración real de seguimiento de cámara (referencia 99): plano,
 *  sujeto, reticle de tracking y trayectoria. No es un icono genérico. */
function NewsTrackingArt(): ReactNode {
  return (
    <svg className="fm-news-art-svg" viewBox="0 0 560 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <rect x="0" y="0" width="560" height="200" fill="#121a21" />
      <path d="M0 156 L560 156" stroke="currentColor" strokeOpacity="0.18" strokeWidth="1" />
      <path d="M0 40 L560 40" stroke="currentColor" strokeOpacity="0.1" strokeWidth="1" />
      <rect x="26" y="22" width="508" height="156" rx="3" fill="#18232c" stroke="currentColor" strokeOpacity="0.16" strokeWidth="1" />
      <path d="M26 138 L150 82 L226 118 L318 62 L410 112 L534 70 L534 178 L26 178 Z" fill="#1d2c36" />
      <path d="M26 158 L128 122 L226 150 L330 108 L430 146 L534 116 L534 178 L26 178 Z" fill="#233844" />
      <circle cx="452" cy="58" r="20" fill="#2e5b6b" fillOpacity="0.65" />
      <g fill="#314b5a">
        <rect x="58" y="96" width="20" height="62" />
        <rect x="84" y="112" width="14" height="46" />
        <rect x="486" y="104" width="18" height="54" />
      </g>
      <g fill="#0e1a22" stroke="currentColor" strokeOpacity="0.28" strokeWidth="1">
        <circle cx="278" cy="72" r="13" />
        <path d="M265 88 q13 -7 26 0 l7 46 l-13 4 l-7 -28 l-7 28 l-13 -4 Z" />
        <path d="M266 92 l-16 24 M290 92 l16 24" stroke="currentColor" strokeOpacity="0.28" strokeWidth="7" strokeLinecap="round" fill="none" />
      </g>
      <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M238 52 v-12 h12 M318 52 v-12 h-12 M238 148 v12 h12 M318 148 v12 h-12" />
        <rect x="238" y="52" width="80" height="96" rx="2" strokeDasharray="6 5" strokeOpacity="0.7" />
      </g>
      <path d="M120 128 C170 108 196 96 238 92" fill="none" stroke="currentColor" strokeOpacity="0.5" strokeWidth="1.5" strokeDasharray="3 6" />
      <circle cx="120" cy="128" r="4" fill="currentColor" fillOpacity="0.8" />
      <circle cx="238" cy="92" r="4" fill="currentColor" fillOpacity="0.8" />
      <g fill="none" stroke="currentColor" strokeOpacity="0.42" strokeWidth="1.5">
        <rect x="404" y="126" width="92" height="36" rx="3" />
        <path d="M414 144 h18 M440 144 h18 M466 144 h20" strokeLinecap="round" />
      </g>
    </svg>
  );
}

export function MenuNewsDialog({
  onSelect,
  onClose,
}: {
  readonly onSelect: (id: ViewId) => void;
  readonly onClose: () => void;
}): ReactNode {
  const [loading, setLoading] = useState(true);
  const [index, setIndex] = useState(0);
  const [showHistory, setShowHistory] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setLoading(false), 500);
    return () => window.clearTimeout(timer);
  }, []);
  if (loading) {
    return (
      <div className="app-modal-body news-dialog">
        <div className="news-loading">Actualización en vivo · Cargando…</div>
      </div>
    );
  }
  const label = LIVE_UPDATE_FEATURES[index] ?? LIVE_UPDATE_FEATURES[0]!;
  const availability = NEWS_AVAILABILITY[label];
  return (
    <div className="app-modal-body news-dialog fm-news-dialog">
      <p className="news-version">Novedades de Editor IA {CURRENT_APP_VERSION}</p>
      <div className="fm-news-layout">
        <div className="fm-news-stage">
          <div className="fm-news-art" aria-hidden="true">
            <NewsTrackingArt />
            <span className="fm-news-art-index">
              {String(index + 1).padStart(2, '0')} / {LIVE_UPDATE_FEATURES.length}
            </span>
          </div>
          <h3>{label}</h3>
          <p className="news-detail">{availability?.detail ?? ''}</p>
          {availability?.pending ? (
            <span className="fm-news-pending">
              Estructura preparada · requiere integración de backend (pendiente)
            </span>
          ) : availability?.view ? (
            <button
              type="button"
              className="small primary"
              onClick={() => {
                onSelect(availability.view!);
                onClose();
              }}
            >
              Abrir en Editor IA
            </button>
          ) : null}
        </div>
        <div className="fm-news-index">
          <LiveUpdateFeatureList activeIndex={index} onSelect={setIndex} />
        </div>
      </div>
      <div className="news-actions">
        <button type="button" className="small ghost" onClick={() => setShowHistory((value) => !value)}>
          {showHistory ? 'Ocultar historial' : 'Ver historial de actualizaciones de versión'}
        </button>
        <button
          type="button"
          className="small ghost"
          onClick={() => setIndex((i) => (i + 1) % LIVE_UPDATE_FEATURES.length)}
        >
          Siguiente función
        </button>
      </div>
      {showHistory ? (
        <ol className="fm-news-history" aria-label="Historial de actualizaciones de versión">
          <li><strong>Editor IA {CURRENT_APP_VERSION}</strong> · Máscara de color, rueda HDR y estados de la interfaz.</li>
          <li><strong>Editor IA 0.2.0</strong> · Timeline multicapa, exportación verificada con FFmpeg y servicios locales.</li>
          <li><strong>Editor IA 0.1.0</strong> · Proyectos, importación de medios y vista previa.</li>
        </ol>
      ) : null}
    </div>
  );
}
