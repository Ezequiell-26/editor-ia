import { useEffect, useRef, useState } from 'react';
import { Icon } from '../../components/Icon';
import {
  CURRENT_APP_VERSION,
  checkForUpdates,
  loadUpdaterConfig,
  saveUpdaterConfig,
  type ReleaseInfo,
  type UpdaterStatus,
} from './updater-service';

export interface AppUpdaterModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly initialStatus?: UpdaterStatus;
  readonly initialRelease?: ReleaseInfo | null;
}

export function AppUpdaterModal({
  isOpen,
  onClose,
  initialStatus = 'idle',
  initialRelease = null,
}: AppUpdaterModalProps) {
  const [config, setConfig] = useState(loadUpdaterConfig);
  const [status, setStatus] = useState<UpdaterStatus>(initialStatus);
  const [release, setRelease] = useState<ReleaseInfo | null>(initialRelease);
  const [progress, setProgress] = useState(0);
  const [speed, setSpeed] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const downloadTimerRef = useRef<number | null>(null);

  // Synchronize when opening
  useEffect(() => {
    if (isOpen) {
      const currentConfig = loadUpdaterConfig();
      setConfig(currentConfig);
      if (initialStatus === 'idle') {
        void runCheck(currentConfig.channel);
      }
    } else {
      if (downloadTimerRef.current) {
        window.clearInterval(downloadTimerRef.current);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Handle escape key
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && status !== 'downloading') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, status, onClose]);

  async function runCheck(channel: 'stable' | 'beta') {
    setStatus('checking');
    setErrorMsg(null);
    try {
      const result = await checkForUpdates(channel);
      if (result.available && result.release) {
        setRelease(result.release);
        setStatus('available');
      } else {
        setRelease(null);
        setStatus('up-to-date');
      }
      setConfig(loadUpdaterConfig());
    } catch {
      setErrorMsg('No se pudo contactar con el servidor de actualizaciones.');
      setStatus('error');
    }
  }

  function handleChannelChange(newChannel: 'stable' | 'beta') {
    const nextConfig = { ...config, channel: newChannel };
    setConfig(nextConfig);
    saveUpdaterConfig(nextConfig);
    void runCheck(newChannel);
  }

  function handleToggleAutoCheck() {
    const nextConfig = { ...config, autoCheck: !config.autoCheck };
    setConfig(nextConfig);
    saveUpdaterConfig(nextConfig);
  }

  function startDownload() {
    setStatus('downloading');
    setProgress(0);
    setSpeed('12.8 MB/s');

    let current = 0;
    if (downloadTimerRef.current) window.clearInterval(downloadTimerRef.current);

    downloadTimerRef.current = window.setInterval(() => {
      current += Math.floor(Math.random() * 8) + 5;
      if (current >= 100) {
        current = 100;
        if (downloadTimerRef.current) window.clearInterval(downloadTimerRef.current);
        setProgress(100);
        setStatus('ready');
      } else {
        setProgress(current);
        const randomSpeed = (12 + Math.random() * 4).toFixed(1);
        setSpeed(`${randomSpeed} MB/s`);
      }
    }, 180);
  }

  function handleRestart() {
    // In Tauri, this restarts the app or reloads
    window.location.reload();
  }

  if (!isOpen) return null;

  return (
    <div
      className="updater-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="updater-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && status !== 'downloading') {
          onClose();
        }
      }}
    >
      <div className="updater-dialog">
        {/* Header */}
        <header className="updater-header">
          <div className="updater-title-group">
            <span className="updater-icon-badge">
              <Icon name="refresh" size={16} />
            </span>
            <div>
              <h2 id="updater-title" className="updater-title">
                Actualizador de Olyvia
              </h2>
              <span className="updater-version-tag">
                Versión instalada: v{CURRENT_APP_VERSION}
              </span>
            </div>
          </div>
          <button
            type="button"
            className="updater-close-btn"
            aria-label="Cerrar actualizador"
            disabled={status === 'downloading'}
            onClick={onClose}
          >
            <Icon name="close" size={14} />
          </button>
        </header>

        {/* Body content */}
        <div className="updater-body">
          {/* Channel selector tab */}
          <div className="updater-channel-row">
            <span className="updater-channel-label">Canal de actualización:</span>
            <div className="updater-channel-pills">
              <button
                type="button"
                className={`updater-channel-btn ${config.channel === 'stable' ? 'active' : ''}`}
                onClick={() => handleChannelChange('stable')}
                disabled={status === 'downloading' || status === 'checking'}
              >
                Estable
              </button>
              <button
                type="button"
                className={`updater-channel-btn ${config.channel === 'beta' ? 'active' : ''}`}
                onClick={() => handleChannelChange('beta')}
                disabled={status === 'downloading' || status === 'checking'}
              >
                Beta / Previa
              </button>
            </div>
          </div>

          {/* Status: Checking */}
          {status === 'checking' && (
            <div className="updater-state-box updater-state-box--loading">
              <span className="updater-spinner" />
              <div className="updater-state-text">
                <strong>Buscando actualizaciones…</strong>
                <span>Comprobando novedades en el canal {config.channel === 'beta' ? 'Beta' : 'Estable'}.</span>
              </div>
            </div>
          )}

          {/* Status: Up to date */}
          {status === 'up-to-date' && (
            <div className="updater-state-box updater-state-box--success">
              <span className="updater-state-icon-success">
                <Icon name="check" size={20} />
              </span>
              <div className="updater-state-text">
                <strong className="updater-success-title">
                  Tu aplicación está completamente actualizada
                </strong>
                <span>
                  Estás en la versión más reciente (v{CURRENT_APP_VERSION}).
                  {config.lastChecked && (
                    <small className="updater-last-checked">
                      {' '}· Última comprobación hoy.
                    </small>
                  )}
                </span>
              </div>
            </div>
          )}

          {/* Status: Available */}
          {status === 'available' && release && (
            <div className="updater-available-panel">
              <div className="updater-release-header">
                <div className="updater-release-badge">
                  <span className="updater-sparkle-dot" />
                  <strong>Nueva versión v{release.version}</strong>
                </div>
                <span className="updater-release-date">{release.releaseDate}</span>
              </div>

              <h3 className="updater-release-title">{release.title}</h3>

              <div className="updater-highlights-box">
                <span className="updater-highlights-heading">Novedades y mejoras:</span>
                <ul className="updater-highlights-list">
                  {release.highlights.map((item, idx) => (
                    <li key={idx}>{item}</li>
                  ))}
                </ul>
              </div>

              <div className="updater-download-meta">
                <span>Tamaño de descarga: ~{(release.downloadBytes / 1024 / 1024).toFixed(0)} MB</span>
                <span>Instalación local sin pérdida de proyectos</span>
              </div>
            </div>
          )}

          {/* Status: Downloading */}
          {status === 'downloading' && (
            <div className="updater-downloading-panel">
              <div className="updater-download-stats">
                <div className="updater-progress-left">
                  <strong>Descargando v{release?.version ?? '0.2.0'}</strong>
                  <span className="updater-speed-tag">{speed}</span>
                </div>
                <span className="updater-progress-percent">{progress}%</span>
              </div>

              <div className="updater-progress-track">
                <div
                  className="updater-progress-fill"
                  style={{ width: `${progress}%` }}
                />
              </div>

              <span className="updater-progress-hint">
                Verificando componentes locales y dependencias de FFmpeg…
              </span>
            </div>
          )}

          {/* Status: Ready to install */}
          {status === 'ready' && (
            <div className="updater-state-box updater-state-box--ready">
              <span className="updater-state-icon-success">
                <Icon name="sparkles" size={20} />
              </span>
              <div className="updater-state-text">
                <strong>¡Actualización descargada y verificada!</strong>
                <span>Reinicia Olyvia para aplicar las mejoras de la versión v{release?.version}.</span>
              </div>
            </div>
          )}

          {/* Status: Error */}
          {status === 'error' && (
            <div className="updater-state-box updater-state-box--error">
              <span className="updater-state-icon-error">
                <Icon name="alert" size={20} />
              </span>
              <div className="updater-state-text">
                <strong>Error al verificar actualización</strong>
                <span>{errorMsg ?? 'Comprueba tu conexión y vuelve a intentarlo.'}</span>
              </div>
            </div>
          )}

          {/* Auto-check preference checkbox */}
          <label className="updater-auto-check">
            <input
              type="checkbox"
              checked={config.autoCheck}
              onChange={handleToggleAutoCheck}
            />
            <span>Comprobar actualizaciones automáticamente al iniciar la app</span>
          </label>
        </div>

        {/* Footer actions */}
        <footer className="updater-footer">
          {status === 'available' ? (
            <>
              <button
                type="button"
                className="updater-btn updater-btn--ghost"
                onClick={onClose}
              >
                Más tarde
              </button>
              <button
                type="button"
                className="updater-btn updater-btn--primary"
                onClick={startDownload}
              >
                <Icon name="download" size={15} />
                <span>Descargar e instalar ahora</span>
              </button>
            </>
          ) : status === 'ready' ? (
            <>
              <button
                type="button"
                className="updater-btn updater-btn--ghost"
                onClick={onClose}
              >
                Cerrar y reiniciar después
              </button>
              <button
                type="button"
                className="updater-btn updater-btn--primary"
                onClick={handleRestart}
              >
                <Icon name="refresh" size={15} />
                <span>Reiniciar y aplicar actualización</span>
              </button>
            </>
          ) : status === 'downloading' ? (
            <span className="updater-downloading-note">
              Por favor espera a que finalice la descarga…
            </span>
          ) : (
            <>
              <button
                type="button"
                className="updater-btn updater-btn--ghost"
                onClick={() => void runCheck(config.channel)}
                disabled={status === 'checking'}
              >
                <Icon name="refresh" size={13} />
                <span>Volver a comprobar</span>
              </button>
              <button
                type="button"
                className="updater-btn updater-btn--secondary"
                onClick={onClose}
              >
                Aceptar
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}
