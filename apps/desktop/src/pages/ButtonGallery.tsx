import { useState } from 'react';
import { Icon } from '../components/Icon';

export function ButtonGallery() {
  const [loadingStates, setLoadingStates] = useState<{[key: string]: boolean}>({});

  const handleLoad = (id: string) => {
    setLoadingStates(prev => ({...prev, [id]: true}));
    setTimeout(() => {
      setLoadingStates(prev => ({...prev, [id]: false}));
    }, 2000);
  };

  return (
    <div style={{ padding: '40px', background: '#0f1623', minHeight: '100vh' }}>
      <h1 style={{ color: '#eaf3ef', fontSize: '32px', marginBottom: '48px' }}>
        Premium Buttons Gallery - Editor IA
      </h1>

      {/* Primary Buttons */}
      <section style={{ marginBottom: '48px' }}>
        <h2 style={{ color: '#b0c3ba', fontSize: '18px', marginBottom: '24px' }}>
          🌟 Primary Buttons with Glow Effects
        </h2>
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
          <button className="primary">
            <span>Primary Action</span>
          </button>
          
          <button className="primary" onClick={() => handleLoad('btn1')}>
            {loadingStates['btn1'] ? (
              <>
                <span className="spinner"></span>
                <span>Loading...</span>
              </>
            ) : (
              <span>With Loading State</span>
            )}
          </button>

          <button className="primary large">
            <Icon name="download" size={16} />
            <span>Large Primary</span>
          </button>

          <button className="primary btn-sm" disabled>
            <span>Disabled</span>
          </button>
        </div>
      </section>

      {/* Secondary & Outline */}
      <section style={{ marginBottom: '48px' }}>
        <h2 style={{ color: '#b0c3ba', fontSize: '18px', marginBottom: '24px' }}>
          🎨 Secondary & Outline
        </h2>
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
          <button className="secondary">
            Secondary Action
          </button>

          <button className="outline">
            Outline Style
          </button>

          <button className="ghost">
            Ghost Button
          </button>

          <button className="secondary large">
            Large Secondary
          </button>
        </div>
      </section>

      {/* Danger Actions */}
      <section style={{ marginBottom: '48px' }}>
        <h2 style={{ color: '#b0c3ba', fontSize: '18px', marginBottom: '24px' }}>
          ⚠️ Danger Actions
        </h2>
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
          <button className="danger">
            <Icon name="trash" size={16} />
            <span>Delete Item</span>
          </button>

          <button className="danger-ghost">
            Cancel Operation
          </button>
        </div>
      </section>

      {/* Icon Buttons */}
      <section style={{ marginBottom: '48px' }}>
        <h2 style={{ color: '#b0c3ba', fontSize: '18px', marginBottom: '24px' }}>
          🔘 Icon Buttons
        </h2>
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="icon-button active" title="Active state">
            <Icon name="check" size={15} />
          </button>

          <button className="icon-button" title="Normal state">
            <Icon name="play" size={15} />
          </button>

          <button className="icon-button small" title="Small">
            <Icon name="settings" size={13} />
          </button>
        </div>
      </section>

      {/* Size Variants */}
      <section style={{ marginBottom: '48px' }}>
        <h2 style={{ color: '#b0c3ba', fontSize: '18px', marginBottom: '24px' }}>
          📏 Size Variants
        </h2>
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
          <button className="primary btn-xs">XS Small</button>
          <button className="primary btn-sm">Sm Small</button>
          <button className="primary btn-md">Md Medium</button>
          <button className="primary btn-lg">Lg Large</button>
        </div>
      </section>

      {/* Full Width Example */}
      <section>
        <h2 style={{ color: '#b0c3ba', fontSize: '18px', marginBottom: '24px' }}>
          📐 Full Width
        </h2>
        <button className="primary button-full" style={{ width: '100%' }}>
          Full Width Primary Button
        </button>
      </section>
    </div>
  );
}
