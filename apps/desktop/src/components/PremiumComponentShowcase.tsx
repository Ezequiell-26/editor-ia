import { useState } from 'react';
import { Icon } from './Icon';

export function PremiumComponentShowcase() {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [activeTab, setActiveTab] = useState(0);
  const [progressValue, setProgressValue] = useState(45);
  const [email, setEmail] = useState('');

  return (
    <div style={{ padding: '48px', background: '#0f1623', minHeight: '100vh' }}>
      {/* Hero */}
      <div style={{ 
        textAlign: 'center', 
        marginBottom: '64px',
        padding: '64px 24px',
        background: 'linear-gradient(135deg, rgba(94, 234, 212, 0.1), rgba(139, 92, 246, 0.05))',
        borderRadius: '24px',
        border: '1px solid rgba(94, 234, 212, 0.2)'
      }}>
        <h1 style={{ 
          fontSize: '48px', 
          fontWeight: '900', 
          marginBottom: '16px',
          background: 'linear-gradient(135deg, #fff, #5eead4)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent'
        }}>
          Editor IA — Component System
        </h1>
        <p style={{ fontSize: '20px', color: '#b0c3ba', maxWidth: '640px', margin: '0 auto' }}>
          Sistema de componentes premium inspirado en Linear, Stripe y CapCut
        </p>
      </div>

      {/* Buttons Section */}
      <section className="showcase-section">
        <h2 className="showcase-title">🎨 Botones Premium</h2>
        <div className="component-grid">
          <div className="card card-gradient-primary">
            <div className="card-header">
              <div className="card-header-title">Primary Actions</div>
            </div>
            <div className="card-body">
              <button className="primary">Primary Action</button>
              <br /><br />
              <button className="secondary">Secondary</button>
              <button className="outline">Outline</button>
              <button className="ghost">Ghost</button>
            </div>
          </div>

          <div className="card card-glow">
            <div className="card-header">
              <div className="card-header-title">Danger Actions</div>
            </div>
            <div className="card-body">
              <button className="danger">Delete</button>
              <button className="danger-ghost">Cancel</button>
            </div>
          </div>

          <div className="card card-outline">
            <div className="card-header">
              <div className="card-header-title">Icon Buttons</div>
            </div>
            <div className="card-body">
              <button className="icon-button" title="Settings">
                <Icon name="settings" size={15} />
              </button>
              <button className="icon-button active" title="Active">
                <Icon name="check" size={15} />
              </button>
              <button className="icon-button" title="Play">
                <Icon name="play" size={15} />
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Inputs Section */}
      <section className="showcase-section">
        <h2 className="showcase-title">📝 Inputs & Forms</h2>
        <div className="component-grid">
          <div className="card card-gradient-primary">
            <div className="card-header">
              <div className="card-header-title">Floating Labels</div>
            </div>
            <div className="card-body">
              <div className="input-floating-label">
                <input
                  type="email"
                  placeholder=" "
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="input-md"
                />
                <label className="floating-label">Email Address</label>
              </div>
              <br />
              <div className="input-floating-label">
                <input type="password" placeholder=" " className="input-md" />
                <label className="floating-label">Password</label>
              </div>
            </div>
          </div>

          <div className="card card-glow">
            <div className="card-header">
              <div className="card-header-title">Input with Icons</div>
            </div>
            <div className="card-body">
              <div className="input-with-icon">
                <Icon name="search" size={15} className="input-icon-left" />
                <input type="search" placeholder="Search..." className="input-md" />
              </div>
            </div>
          </div>

          <div className="card card-outline">
            <div className="card-header">
              <div className="card-header-title">Size Variants</div>
            </div>
            <div className="card-body">
              <input type="text" placeholder="XS" className="input-xs" style={{ marginBottom: '8px' }} />
              <input type="text" placeholder="SM" className="input-sm" style={{ marginBottom: '8px' }} />
              <input type="text" placeholder="MD" className="input-md" style={{ marginBottom: '8px' }} />
              <input type="text" placeholder="LG" className="input-lg" />
            </div>
          </div>
        </div>
      </section>

      {/* Cards & Badges Section */}
      <section className="showcase-section">
        <h2 className="showcase-title">✨ Cards & Badges</h2>
        <div className="component-grid">
          <div className="card card-gradient-primary">
            <div className="card-header">
              <div className="card-header-title">Gradient Cards</div>
            </div>
            <div className="card-body">
              <div style={{ marginBottom: '16px' }}>
                <span className="badge badge-primary">
                  <Icon name="sparkles" size={14} />
                  AI Ready
                </span>
                <span className="badge badge-success" style={{ marginLeft: '8px' }}>
                  <Icon name="check" size={14} />
                  Verified
                </span>
              </div>
              <div>
                <span className="tag tag-sm">Small Tag</span>
                <span className="tag">Regular Tag</span>
                <span className="tag tag-lg" style={{ background: '#8b5cf6', borderColor: '#8b5cf6' }}>
                  Large Tag
                </span>
              </div>
            </div>
          </div>

          <div className="card card-glow">
            <div className="card-header">
              <div className="card-header-title">Alerts</div>
            </div>
            <div className="card-body">
              <div className="alert alert-info">
                <Icon name="info" size={20} className="alert-icon" />
                <div className="alert-content">
                  <div className="alert-title">Information</div>
                  <div className="alert-description">This is an info alert message</div>
                </div>
              </div>
              <br />
              <div className="alert alert-warning">
                <Icon name="alert-triangle" size={20} className="alert-icon" />
                <div className="alert-content">
                  <div className="alert-title">Warning</div>
                  <div className="alert-description">Be careful with this action</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Interactive Components */}
      <section className="showcase-section">
        <h2 className="showcase-title">⚡ Interactive Elements</h2>
        <div className="component-grid">
          <div className="card card-gradient-primary">
            <div className="card-header">
              <div className="card-header-title">Tabs</div>
            </div>
            <div className="card-body">
              <div className="tabs">
                <div className="tab active">All</div>
                <div className="tab">Popular</div>
                <div className="tab">New</div>
              </div>
            </div>
          </div>

          <div className="card card-glow">
            <div className="card-header">
              <div className="card-header-title">Progress Bar</div>
            </div>
            <div className="card-body">
              <div className="progress" style={{ height: '8px' }}>
                <div className="progress-bar" style={{ width: `${progressValue}%` }} />
              </div>
              <br />
              <button onClick={() => setProgressValue(Math.min(progressValue + 10, 100))}>
                +10%
              </button>
              <button onClick={() => setProgressValue(Math.max(progressValue - 10, 0))}>
                -10%
              </button>
            </div>
          </div>

          <div className="card card-outline">
            <div className="card-header">
              <div className="card-header-title">Toggle Switch</div>
            </div>
            <div className="card-body">
              <label className="switch">
                <input type="checkbox" defaultChecked className="switch-input" />
                <span className="switch-slider"></span>
              </label>
            </div>
          </div>
        </div>
      </section>

      {/* Dropdown & Tooltip Section */}
      <section className="showcase-section">
        <h2 className="showcase-title">💫 Dropdowns & Tooltips</h2>
        <div className="component-grid">
          <div className="card card-gradient-primary">
            <div className="card-header">
              <div className="card-header-title">Interactive Menu</div>
            </div>
            <div className="card-body">
              <div className="dropdown" onMouseEnter={() => setDropdownOpen(true)} onMouseLeave={() => setDropdownOpen(false)}>
                <button className="dropdown-button">
                  Open Menu
                  <Icon name="chevron-down" size={14} />
                </button>
                {dropdownOpen && (
                  <div className="dropdown-menu">
                    <div className="dropdown-item">
                      <Icon name="user" size={15} /> Edit Profile
                    </div>
                    <div className="dropdown-item">
                      <Icon name="settings" size={15} /> Settings
                    </div>
                    <div className="dropdown-separator" />
                    <div className="dropdown-item danger">
                      <Icon name="log-out" size={15} /> Sign Out
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="card card-glow">
            <div className="card-header">
              <div className="card-header-title">Tooltips</div>
            </div>
            <div className="card-body">
              <div className="tooltip" data-tooltip="This is a tooltip">
                <button className="primary">Hover Me</button>
              </div>
              <br /><br />
              <div className="tooltip" data-tooltip="Danger action">
                <button className="danger-ghost">Delete Item</button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Avatars Section */}
      <section className="showcase-section">
        <h2 className="showcase-title">👤 Avatars</h2>
        <div className="component-grid">
          <div className="card card-gradient-primary">
            <div className="card-header">
              <div className="card-header-title">Avatar Sizes</div>
            </div>
            <div className="card-body">
              <div className="avatar avatar-xl" style={{ margin: '0 auto 16px' }}>
                <img src="/placeholder-avatar.jpg" alt="User" />
              </div>
              <div className="avatar-group">
                <div className="avatar avatar-sm"><div style={{ background: '#5eead4', borderRadius: '50%' }} /></div>
                <div className="avatar avatar-sm"><div style={{ background: '#8b5cf6', borderRadius: '50%' }} /></div>
                <div className="avatar avatar-sm"><div style={{ background: '#f59e0b', borderRadius: '50%' }} /></div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
