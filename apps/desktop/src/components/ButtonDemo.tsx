import './styles.css';

// Demo component showing all button variants and effects
export function ButtonDemo() {
  return (
    <div style={{ 
      padding: '40px', 
      background: 'var(--color-bg)', 
      borderRadius: '12px',
      maxWidth: '800px'
    }}>
      <h2 style={{ color: 'var(--color-text)', marginBottom: '24px' }}>Premium Buttons</h2>
      
      {/* Primary Buttons */}
      <div style={{ marginBottom: '32px' }}>
        <h3 style={{ color: 'var(--color-text-secondary)', fontSize: '14px', marginBottom: '12px' }}>Primary Variants</h3>
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="primary">Primary Button</button>
          <button className="primary" disabled>Disabled</button>
          <button className="primary large">Large Primary</button>
        </div>
      </div>

      {/* Secondary & Outline Buttons */}
      <div style={{ marginBottom: '32px' }}>
        <h3 style={{ color: 'var(--color-text-secondary)', fontSize: '14px', marginBottom: '12px' }}>Secondary & Outline</h3>
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="secondary">Secondary</button>
          <button className="outline">Outline</button>
          <button className="ghost">Ghost</button>
        </div>
      </div>

      {/* Danger & Ghost Danger */}
      <div style={{ marginBottom: '32px' }}>
        <h3 style={{ color: 'var(--color-text-secondary)', fontSize: '14px', marginBottom: '12px' }}>Danger Actions</h3>
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="danger">Delete</button>
          <button className="danger-ghost">Cancel</button>
        </div>
      </div>

      {/* Icon Buttons */}
      <div style={{ marginBottom: '32px' }}>
        <h3 style={{ color: 'var(--color-text-secondary)', fontSize: '14px', marginBottom: '12px' }}>Icon Buttons</h3>
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="icon-button active" title="Active">✓</button>
          <button className="icon-button" title="Normal">○</button>
          <button className="icon-button small" title="Small">S</button>
        </div>
      </div>

      {/* Small Buttons */}
      <div style={{ marginBottom: '32px' }}>
        <h3 style={{ color: 'var(--color-text-secondary)', fontSize: '14px', marginBottom: '12px' }}>Small Buttons</h3>
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="small btn-xs">Extra Small</button>
          <button className="small btn-sm">Small</button>
          <button className="small btn-md">Medium</button>
        </div>
      </div>

      {/* Full Width Button */}
      <div>
        <h3 style={{ color: 'var(--color-text-secondary)', fontSize: '14px', marginBottom: '12px' }}>Full Width</h3>
        <button className="primary button-full" style={{ width: '100%' }}>Full Width Button</button>
      </div>
    </div>
  );
}
