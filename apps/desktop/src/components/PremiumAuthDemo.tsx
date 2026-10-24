import { useState } from 'react';
import { Icon } from './Icon';

export function PremiumAuthDemo() {
  const [isLogin, setIsLogin] = useState(true);
  const [showPassword, setShowPassword] = useState(false);

  return (
    <div style={{ 
      padding: '48px', 
      background: '#0a0d17',
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    }}>
      {/* Hero Background */}
      <div style={{
        position: 'fixed',
        inset: 0,
        background: `
          radial-gradient(circle at 20% 30%, rgba(94, 234, 212, 0.15), transparent 50%),
          radial-gradient(circle at 80% 70%, rgba(139, 92, 246, 0.1), transparent 50%)
        `,
        zIndex: -1
      }} />

      {/* Auth Card */}
      <div className="card card-glow" style={{ width: '100%', maxWidth: '480px' }}>
        {/* Gradient Header */}
        <div style={{
          background: 'linear-gradient(135deg, var(--color-accent), #8b5cf6)',
          padding: '32px 24px',
          borderRadius: '16px 16px 0 0',
          textAlign: 'center'
        }}>
          <h1 style={{ color: '#fff', fontSize: '28px', fontWeight: '800', marginBottom: '8px' }}>
            {isLogin ? 'Welcome Back' : 'Create Account'}
          </h1>
          <p style={{ color: 'rgba(255,255,255,0.8)', fontSize: '14px' }}>
            {isLogin ? 'Sign in to continue to Olyvia' : 'Get started with your free account'}
          </p>
        </div>

        {/* Form */}
        <form onSubmit={(e) => e.preventDefault()} style={{ padding: '32px' }}>
          {!isLogin && (
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600', color: '#eaf3ef' }}>
                Full Name
              </label>
              <input
                type="text"
                placeholder="John Doe"
                className="input-md input-glow"
                style={{ width: '100%' }}
              />
            </div>
          )}

          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600', color: '#eaf3ef' }}>
              Email Address
            </label>
            <input
              type="email"
              placeholder="your@email.com"
              className="input-md input-glow"
              style={{ width: '100%' }}
            />
          </div>

          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600', color: '#eaf3ef' }}>
              Password
            </label>
            <div className="input-with-icon">
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder="••••••••"
                className="input-md input-glow"
                style={{ paddingRight: '44px' }}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="input-icon-right"
                style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
              >
                <Icon name={showPassword ? 'eye-off' : 'eye'} size={18} />
              </button>
            </div>
          </div>

          {isLogin && (
            <div style={{ marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input type="checkbox" className="checkbox-custom" id="remember" />
              <label htmlFor="remember" style={{ color: '#b0c3ba', fontSize: '14px' }}>
                Remember me for 30 days
              </label>
            </div>
          )}

          {/* Progress Example */}
          {!isLogin && (
            <div style={{ marginBottom: '24px' }}>
              <label style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '13px', color: '#b0c3ba' }}>
                <span>Password Strength</span>
                <span style={{ color: '#f59e0b' }}>Medium</span>
              </label>
              <div className="progress" style={{ height: '4px', marginBottom: '8px' }}>
                <div className="progress-bar" style={{ width: '50%', background: 'linear-gradient(90deg, #f59e0b, #d97706)' }} />
              </div>
            </div>
          )}

          {/* Main Action Button */}
          <button className="primary button-full btn-lg" style={{ marginBottom: '16px' }}>
            {isLogin ? 'Sign In' : 'Create Account'}
          </button>

          {/* Divider */}
          <div style={{ display: 'flex', alignItems: 'center', margin: '24px 0' }}>
            <div style={{ flex: 1, height: '1px', background: '#5b3038' }} />
            <span style={{ padding: '0 16px', color: '#b0c3ba', fontSize: '13px' }}>OR CONTINUE WITH</span>
            <div style={{ flex: 1, height: '1px', background: '#5b3038' }} />
          </div>

          {/* Social Login Buttons */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginBottom: '24px' }}>
            <button className="secondary" style={{ padding: '12px' }}>
              <Icon name="globe" size={20} />
            </button>
            <button className="secondary" style={{ padding: '12px' }}>
              <Icon name="mail" size={20} />
            </button>
            <button className="secondary" style={{ padding: '12px' }}>
              <Icon name="github" size={20} />
            </button>
          </div>

          {/* Terms */}
          <p style={{ textAlign: 'center', color: '#b0c3ba', fontSize: '13px' }}>
            By continuing, you agree to our{' '}
            <a href="#" style={{ color: 'var(--color-accent)', textDecoration: 'none' }}>Terms of Service</a>{' '}
            and{' '}
            <a href="#" style={{ color: 'var(--color-accent)', textDecoration: 'none' }}>Privacy Policy</a>
          </p>

          {/* Toggle Mode */}
          <div style={{ textAlign: 'center', marginTop: '24px' }}>
            <span style={{ color: '#b0c3ba', fontSize: '14px' }}>
              {isLogin ? "Don't have an account?" : 'Already have an account?'}
            </span>{' '}
            <button
              type="button"
              onClick={() => setIsLogin(!isLogin)}
              className="ghost"
              style={{ fontWeight: '600' }}
            >
              {isLogin ? 'Sign Up' : 'Sign In'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
