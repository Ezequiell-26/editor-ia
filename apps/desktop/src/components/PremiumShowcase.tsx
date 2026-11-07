/**
 * Componente de demostración de mejoras visuales premium
 * Muestra todos los nuevos estilos y animaciones implementados
 */

export function PremiumShowcase() {
  return (
    <div style={{ padding: '32px', maxWidth: '1400px', margin: '0 auto'}}>
      {/* Header con gradiente */}
      <div className="animate-in"style={{ marginBottom: '48px', textAlign: 'center'}}>
        <h1 className="text-shine"style={{ fontSize: '48px', marginBottom: '16px'}}>
          Olyvia Premium UI
        </h1>
        <p className="muted"style={{ fontSize: '18px'}}>
          Sistema de diseño profesional con glassmorphism y animaciones fluidas
        </p>
      </div>

      {/* Sección de Botones */}
      <section className="showcase-section">
        <h2 className="showcase-title">Botones Premium</h2>
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap'}}>
          <button className="primary hover-lift">Botón Principal</button>
          <button className="ghost">Botón Ghost</button>
          <button className="small">Botón Pequeño</button>
          <button className="glass-button">Botón Glass</button>
          <button className="primary"disabled>Deshabilitado</button>
        </div>
      </section>

      {/* Sección de Cards */}
      <section className="showcase-section">
        <h2 className="showcase-title">Cards Premium</h2>
        <div className="cards-grid-3">
          <div className="card card-gradient-primary hover-lift animate-in">
            <div className="card-header">
              <h3 className="card-header-title">Card Gradiente</h3>
            </div>
            <div className="card-body">
              <p>Card con gradiente de fondo y efecto hover lift</p>
            </div>
          </div>

          <div className="card glass-card hover-lift animate-in-delay-1">
            <div className="card-header">
              <h3 className="card-header-title">Glass Card</h3>
            </div>
            <div className="card-body">
              <p>Card con efecto glassmorphism y blur</p>
            </div>
          </div>

          <div className="card card-outline hover-lift animate-in-delay-2">
            <div className="card-header">
              <h3 className="card-header-title">Card Outline</h3>
            </div>
            <div className="card-body">
              <p>Card con borde y animación en hover</p>
            </div>
          </div>
        </div>
      </section>

      {/* Sección de Badges */}
      <section className="showcase-section">
        <h2 className="showcase-title">Badges & Tags</h2>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap'}}>
          <span className="badge badge-primary">Primary</span>
          <span className="badge badge-secondary">Secondary</span>
          <span className="badge badge-success">Success</span>
          <span className="badge badge-warning">Warning</span>
          <span className="badge badge-danger">Danger</span>
          <span className="badge badge-gray">Gray</span>
        </div>
      </section>

      {/* Sección de Progress Bars */}
      <section className="showcase-section">
        <h2 className="showcase-title">Barras de Progreso</h2>
        <div style={{ display: 'grid', gap: '16px'}}>
          <div>
            <div className="progress">
              <div className="progress-bar"style={{ width: '70%'}}></div>
            </div>
          </div>
          <div className="progress progress-md">
            <div className="progress-bar"style={{ width: '50%'}}></div>
          </div>
          <div className="progress progress-lg">
            <div className="progress-bar"style={{ width: '90%'}}></div>
          </div>
        </div>
      </section>

      {/* Sección de Loading States */}
      <section className="showcase-section">
        <h2 className="showcase-title">Estados de Carga</h2>
        <div style={{ display: 'flex', gap: '32px', alignItems: 'center', flexWrap: 'wrap'}}>
          <div className="loading-spinner"></div>
          <div className="loading-dots">
            <span></span>
            <span></span>
            <span></span>
          </div>
          <div style={{ width: '200px', height: '100px', borderRadius: '8px'}} className="skeleton-loader"></div>
        </div>
      </section>

      {/* Sección de Alerts */}
      <section className="showcase-section">
        <h2 className="showcase-title">Alertas & Notificaciones</h2>
        <div style={{ display: 'grid', gap: '16px'}}>
          <div className="alert alert-info">
            <div className="alert-content">
              <div className="alert-title">Información</div>
              <div className="alert-description">Este es un mensaje informativo</div>
            </div>
          </div>
          <div className="alert alert-success">
            <div className="alert-content">
              <div className="alert-title">Éxito</div>
              <div className="alert-description">La operación se completó correctamente</div>
            </div>
          </div>
          <div className="alert alert-warning">
            <div className="alert-content">
              <div className="alert-title">Advertencia</div>
              <div className="alert-description">Ten cuidado con esta acción</div>
            </div>
          </div>
          <div className="alert alert-error">
            <div className="alert-content">
              <div className="alert-title">Error</div>
              <div className="alert-description">Algo salió mal</div>
            </div>
          </div>
        </div>
      </section>

      {/* Sección de Inputs */}
      <section className="showcase-section">
        <h2 className="showcase-title">Inputs Premium</h2>
        <div style={{ display: 'grid', gap: '24px', maxWidth: '600px'}}>
          <div className="field">
            <span>Input Normal</span>
            <input type="text"placeholder="Escribe algo..."className="input-md"/>
          </div>
          <div className="field">
            <span>Input con Focus Glow</span>
            <div className="input-glow">
              <input type="text"placeholder="Focus para ver el glow"className="input-md"/>
            </div>
          </div>
          <div className="field">
            <span>Select</span>
            <select className="input-md">
              <option>Opción 1</option>
              <option>Opción 2</option>
              <option>Opción 3</option>
            </select>
          </div>
          <div className="field">
            <span>Textarea</span>
            <textarea placeholder="Escribe un mensaje..."className="input-md"rows={4}></textarea>
          </div>
        </div>
      </section>

      {/* Panel Glass */}
      <section className="showcase-section">
        <h2 className="showcase-title">Panel Glassmorphism</h2>
        <div className="glass-panel"style={{ padding: '32px', borderRadius: '16px'}}>
          <h3 style={{ marginBottom: '16px', fontSize: '24px'}}>Panel con Efecto Glass</h3>
          <p className="muted"style={{ marginBottom: '24px'}}>
            Este panel usa backdrop-filter con blur y saturación para crear un efecto de vidrio esmerilado profesional.
          </p>
          <div style={{ display: 'flex', gap: '12px'}}>
            <button className="primary">Acción Principal</button>
            <button className="ghost">Cancelar</button>
          </div>
        </div>
      </section>

      {/* Tabs Demo */}
      <section className="showcase-section">
        <h2 className="showcase-title">Sistema de Tabs</h2>
        <div className="tabs">
          <button className="tab active">
            <span>Vista 1</span>
          </button>
          <button className="tab">
            <span>Vista 2</span>
          </button>
          <button className="tab">
            <span>Vista 3</span>
          </button>
        </div>
      </section>

      {/* Animaciones */}
      <section className="showcase-section">
        <h2 className="showcase-title">Efectos de Animación</h2>
        <div style={{ display: 'grid', gap: '16px', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))'}}>
          <div className="card hover-lift">
            <div className="card-body">
              <strong>Hover Lift</strong>
              <p className="muted"style={{ fontSize: '13px'}}>Se eleva al pasar el mouse</p>
            </div>
          </div>
          <div className="card pulse-accent">
            <div className="card-body">
              <strong>Pulse</strong>
              <p className="muted"style={{ fontSize: '13px'}}>Animación de pulso</p>
            </div>
          </div>
          <div className="card animated-border">
            <div className="card-body">
              <strong>Border Animado</strong>
              <p className="muted"style={{ fontSize: '13px'}}>Borde giratorio en hover</p>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <div style={{ marginTop: '64px', padding: '32px', textAlign: 'center'}} className="glass-panel">
        <h3 className="animated-gradient"style={{ fontSize: '24px', marginBottom: '16px', display: 'inline-block'}}>
          Sistema de Diseño Premium Implementado 
        </h3>
        <p className="muted">
          Glassmorphism • Gradientes Dinámicos • Animaciones Fluidas • Componentes Modernos
        </p>
      </div>
    </div>
  );
}
