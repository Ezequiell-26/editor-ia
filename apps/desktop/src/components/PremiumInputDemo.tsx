import { useState } from 'react';
import { Icon } from './Icon';

export function PremiumInputDemo() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);

  return (
    <div style={{ padding: '40px', background: '#0f1623', minHeight: '100vh' }}>
      <h1 style={{ color: '#eaf3ef', fontSize: '32px', marginBottom: '48px' }}>
        Premium Inputs Gallery - Editor IA
      </h1>

      {/* Basic Input Types */}
      <section style={{ marginBottom: '48px' }}>
        <h2 style={{ color: '#b0c3ba', fontSize: '18px', marginBottom: '24px' }}>
          📝 Basic Input Types
        </h2>
        <div className="form-row">
          <div className="form-group">
            <label className="form-group-label">Email Address</label>
            <input
              type="email"
              placeholder="tu@email.com"
              className="input-md"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          
          <div className="form-group">
            <label className="form-group-label">Password</label>
            <input
              type="password"
              placeholder="••••••••"
              className="input-md"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
        </div>
      </section>

      {/* Floating Labels */}
      <section style={{ marginBottom: '48px' }}>
        <h2 style={{ color: '#b0c3ba', fontSize: '18px', marginBottom: '24px' }}>
          ✨ Floating Labels
        </h2>
        <div className="cards-grid-3">
          <div className="input-floating-label form-group">
            <input
              type="text"
              placeholder=" "
              className="input-md"
              id="name-input"
            />
            <label className="floating-label" htmlFor="name-input">Full Name</label>
          </div>

          <div className="input-floating-label form-group">
            <textarea
              placeholder=" "
              rows={3}
              className="input-md"
              id="bio-input"
            />
            <label className="floating-label" htmlFor="bio-input">Bio</label>
          </div>

          <div className="input-floating-label form-group">
            <input
              type="url"
              placeholder=" "
              className="input-md"
              id="website-input"
            />
            <label className="floating-label" htmlFor="website-input">Website URL</label>
          </div>
        </div>
      </section>

      {/* Icon Inputs */}
      <section style={{ marginBottom: '48px' }}>
        <h2 style={{ color: '#b0c3ba', fontSize: '18px', marginBottom: '24px' }}>
          🔍 Input with Icons
        </h2>
        <div className="cards-grid">
          <div className="input-with-icon form-group">
            <Icon name="search" size={15} className="input-icon-left" />
            <input
              type="search"
              placeholder="Search..."
              className="input-md"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="input-with-right-icon form-group">
            <input
              type="text"
              placeholder="@username"
              className="input-md"
            />
            <Icon name="at-sign" size={15} className="input-icon-right" />
          </div>

          <div className="input-loading form-group">
            <Icon name="user" size={15} className="input-icon-left" />
            <input
              type="text"
              placeholder="Loading..."
              className="input-md"
              disabled
            />
          </div>
        </div>
      </section>

      {/* Size Variants */}
      <section style={{ marginBottom: '48px' }}>
        <h2 style={{ color: '#b0c3ba', fontSize: '18px', marginBottom: '24px' }}>
          📏 Size Variants
        </h2>
        <div className="cards-grid">
          <input type="text" placeholder="Extra Small" className="input-xs" />
          <input type="text" placeholder="Small" className="input-sm" />
          <input type="text" placeholder="Medium" className="input-md" />
          <input type="text" placeholder="Large" className="input-lg" />
          <input type="text" placeholder="Extra Large" className="input-xl" />
        </div>
      </section>

      {/* States */}
      <section style={{ marginBottom: '48px' }}>
        <h2 style={{ color: '#b0c3ba', fontSize: '18px', marginBottom: '24px' }}>
          ⚠️ Input States
        </h2>
        <div className="form-row">
          <div className="form-group">
            <label className="form-group-label">Error State</label>
            <input
              type="text"
              placeholder="Invalid input"
              className="input-md error"
            />
            <span className="form-group-error">This field is required</span>
          </div>

          <div className="form-group">
            <label className="form-group-label">Success State</label>
            <input
              type="text"
              placeholder="Valid input"
              className="input-md success"
            />
            <span className="form-group-hint" style={{ color: '#10b981' }}>✓ Available</span>
          </div>
        </div>
      </section>

      {/* Custom Checkboxes */}
      <section style={{ marginBottom: '48px' }}>
        <h2 style={{ color: '#b0c3ba', fontSize: '18px', marginBottom: '24px' }}>
          ☑️ Custom Checkboxes & Switches
        </h2>
        <div style={{ display: 'flex', gap: '32px', flexWrap: 'wrap' }}>
          <div>
            <label className="checkbox-label">
              <input type="checkbox" className="checkbox-custom" />
              <span>Custom Checkbox</span>
            </label>
          </div>

          <div>
            <label className="switch">
              <input type="checkbox" className="switch-input" defaultChecked />
              <span className="switch-slider"></span>
            </label>
            <small style={{ color: '#b0c3ba', marginLeft: '12px' }}>Switch Toggle</small>
          </div>
        </div>
      </section>

      {/* Glow Effect Inputs */}
      <section>
        <h2 style={{ color: '#b0c3ba', fontSize: '18px', marginBottom: '24px' }}>
          🌟 Glow Effect Inputs
        </h2>
        <div className="cards-grid">
          <div className="input-glow form-group">
            <input
              type="email"
              placeholder="Focus me!"
              className="input-md"
            />
          </div>

          <div className="input-glow form-group">
            <input
              type="password"
              placeholder="See the glow..."
              className="input-md"
            />
          </div>
        </div>
      </section>
    </div>
  );
}
