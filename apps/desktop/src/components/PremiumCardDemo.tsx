import { Icon } from './Icon';

export function PremiumCardDemo() {
  return (
    <div style={{ padding: '40px', background: '#0f1623', minHeight: '100vh' }}>
      <h1 style={{ color: '#eaf3ef', fontSize: '32px', marginBottom: '48px' }}>
        Premium Cards Gallery - Editor IA
      </h1>

      {/* Gradient Cards */}
      <section style={{ marginBottom: '64px' }}>
        <h2 style={{ color: '#b0c3ba', fontSize: '20px', marginBottom: '24px' }}>
          🌟 Gradient Background Cards
        </h2>
        <div className="cards-grid">
          {/* Primary Gradient Card */}
          <div className="card card-gradient-primary">
            <div className="card-header">
              <div className="card-header-title">
                <div className="card-header-icon">
                  <Icon name="sparkles" size={15} />
                </div>
                <span>AI Assistant</span>
              </div>
            </div>
            <div className="card-body">
              <p>Asistente inteligente con capacidades avanzadas de generación y edición automatizada.</p>
              <button className="primary btn-sm">Activar AI</button>
            </div>
            <div className="card-footer">
              <small style={{ color: '#b0c3ba' }}>Versión 2.0</small>
            </div>
          </div>

          {/* Glow Effect Card */}
          <div className="card card-glow">
            <div className="card-header">
              <div className="card-header-title">
                <div className="card-header-icon" style={{ background: 'linear-gradient(135deg, #f59e0b, #d97706)' }}>
                  <Icon name="film" size={15} />
                </div>
                <span>Video Editor</span>
              </div>
            </div>
            <div className="card-body">
              <p>Editor profesional multipista con timeline avanzado y efectos visuales cinematográficos.</p>
              <button className="secondary btn-sm">Abrir Editor</button>
            </div>
          </div>

          {/* Outline Card */}
          <div className="card card-outline">
            <div className="card-header">
              <div className="card-header-title">
                <div className="card-header-icon" style={{ background: 'linear-gradient(135deg, #8b5cf6, #6366f1)' }}>
                  <Icon name="layers" size={15} />
                </div>
                <span>Asset Library</span>
              </div>
            </div>
            <div className="card-body">
              <p>Biblioteca organizada de assets, imágenes, audio y plantillas para tus proyectos.</p>
              <button className="ghost btn-sm">Explorar</button>
            </div>
          </div>
        </div>
      </section>

      {/* Card Variants */}
      <section style={{ marginBottom: '64px' }}>
        <h2 style={{ color: '#b0c3ba', fontSize: '20px', marginBottom: '24px' }}>
          🎨 Card Variants
        </h2>
        <div className="cards-grid-3">
          {/* Primary Variant */}
          <div className="card card-primary">
            <div className="card-header">
              <div className="card-header-title">
                <div className="card-header-icon" style={{ background: 'var(--color-accent)', color: '#07110e' }}>
                  <Icon name="download" size={15} />
                </div>
                <span>Downloads</span>
              </div>
            </div>
            <div className="card-body">
              <p>Gestiona tus descargas sociales organizadas por plataforma.</p>
            </div>
          </div>

          {/* Secondary Variant */}
          <div className="card card-secondary">
            <div className="card-header">
              <div className="card-header-title">
                <div className="card-header-icon">
                  <Icon name="settings" size={15} />
                </div>
                <span>Settings</span>
              </div>
            </div>
            <div className="card-body">
              <p>Configuración avanzada del editor, preferencias y opciones.</p>
            </div>
          </div>

          {/* Danger Variant */}
          <div className="card card-danger">
            <div className="card-header">
              <div className="card-header-title">
                <div className="card-header-icon" style={{ background: '#ef4444' }}>
                  <Icon name="alert" size={15} />
                </div>
                <span>Warning</span>
              </div>
            </div>
            <div className="card-body">
              <p>Algunos archivos requieren verificación antes de continuar.</p>
              <button className="danger btn-sm">Verificar Archivos</button>
            </div>
          </div>
        </div>
      </section>

      {/* Mini & Large Cards */}
      <section style={{ marginBottom: '64px' }}>
        <h2 style={{ color: '#b0c3ba', fontSize: '20px', marginBottom: '24px' }}>
          📏 Size Variants
        </h2>
        <div className="cards-grid">
          {/* Mini Card */}
          <div className="card card-mini card-gradient-primary">
            <div className="card-header">
              <div className="card-header-title" style={{ fontSize: '16px' }}>
                <div className="card-header-icon" style={{ width: '24px', height: '24px', fontSize: '12px' }}>
                  <Icon name="check" size={12} />
                </div>
                <span>Ready</span>
              </div>
            </div>
            <div className="card-body">
              <small style={{ color: '#b0c3ba' }}>Todos los sistemas operativos correctamente</small>
            </div>
          </div>

          {/* Regular Card */}
          <div className="card card-gradient-primary">
            <div className="card-header">
              <div className="card-header-title">
                <div className="card-header-icon">
                  <Icon name="sparkles" size={15} />
                </div>
                <span>Quick Actions</span>
              </div>
            </div>
            <div className="card-body">
              <p>Acciones rápidas comunes en el flujo de trabajo diario.</p>
            </div>
            <div className="card-footer">
              <button className="primary btn-sm">Ver Todas</button>
            </div>
          </div>

          {/* Large Card */}
          <div className="card card-large card-glow">
            <div className="card-header">
              <div className="card-header-title" style={{ fontSize: '22px' }}>
                <div className="card-header-icon" style={{ width: '48px', height: '48px', fontSize: '20px' }}>
                  <Icon name="sparkles" size={20} />
                </div>
                <span>Premium Features</span>
              </div>
            </div>
            <div className="card-body">
              <p style={{ fontSize: '16px' }}>
                Accede a todas las funciones premium incluidas en tu licencia. 
                Edición avanzada, exportación ilimitada y soporte prioritario.
              </p>
            </div>
            <div className="card-footer">
              <button className="primary btn-lg">
                Explorar Premium
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Animated Cards */}
      <section>
        <h2 style={{ color: '#b0c3ba', fontSize: '20px', marginBottom: '24px' }}>
          ✨ Hover Animations
        </h2>
        <div className="cards-grid">
          <div className="card card-gradient-primary card-animated">
            <div className="card-header">
              <div className="card-header-title">
                <div className="card-header-icon">
                  <Icon name="star" size={15} />
                </div>
                <span>Favorites</span>
              </div>
            </div>
            <div className="card-body">
              <p>Tus clips y presets favoritos siempre al alcance.</p>
            </div>
          </div>

          <div className="card card-gradient-primary card-animated">
            <div className="card-header">
              <div className="card-header-title">
                <div className="card-header-icon">
                  <Icon name="undo" size={15} />
                </div>
                <span>Recent</span>
              </div>
            </div>
            <div className="card-body">
              <p>Últimos proyectos abiertos para acceso rápido.</p>
            </div>
          </div>

          <div className="card card-gradient-primary card-animated">
            <div className="card-header">
              <div className="card-header-title">
                <div className="card-header-icon">
                  <Icon name="export" size={15} />
                </div>
                <span>Share</span>
              </div>
            </div>
            <div className="card-body">
              <p>Comparte tu contenido fácilmente con la comunidad.</p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
