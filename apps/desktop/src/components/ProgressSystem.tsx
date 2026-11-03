/**
 * Sistema de progreso y dopamina para mantener al usuario comprometido
 * Inspirado en Linear, Notion y principios de gamificación sutil
 */

import { useEffect, useState } from 'react';

interface ProgressRingProps {
  progress: number; // 0-100
  size?: number;
  strokeWidth?: number;
}

export function ProgressRing({ progress, size = 40, strokeWidth = 3 }: ProgressRingProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (progress / 100) * circumference;

  return (
    <div className="progress-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <defs>
          <linearGradient id="progressGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#3dd6ff" />
            <stop offset="50%" stopColor="#8563ff" />
            <stop offset="100%" stopColor="#c44eff" />
          </linearGradient>
        </defs>
        <circle
          className="progress-ring-circle"
          cx={size / 2}
          cy={size / 2}
          r={radius}
        />
        <circle
          className="progress-ring-progress"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={offset}
        />
      </svg>
      <span style={{
        position: 'absolute',
        inset: 0,
        display: 'grid',
        placeItems: 'center',
        fontSize: size > 60 ? '16px' : '11px',
        fontWeight: 700,
        color: 'var(--color-text)',
      }}>
        {Math.round(progress)}%
      </span>
    </div>
  );
}

interface AchievementToastProps {
  title: string;
  description?: string;
  icon?: string;
  onClose?: () => void;
  duration?: number;
}

export function AchievementToast({ 
  title, 
  description, 
  icon = '🎉', 
  onClose,
  duration = 3000 
}: AchievementToastProps) {
  useEffect(() => {
    if (duration > 0) {
      const timer = setTimeout(() => {
        onClose?.();
      }, duration);
      return () => clearTimeout(timer);
    }
  }, [duration, onClose]);

  return (
    <div className="achievement-toast">
      <div className="achievement-icon">{icon}</div>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>{title}</div>
        {description && (
          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
            {description}
          </div>
        )}
      </div>
      {onClose && (
        <button
          onClick={onClose}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--color-text-secondary)',
            cursor: 'pointer',
            padding: '4px',
          }}
        >
          ✕
        </button>
      )}
    </div>
  );
}

interface StreakIndicatorProps {
  days: number;
  lastActive?: string;
}

export function StreakIndicator({ days, lastActive }: StreakIndicatorProps) {
  return (
    <div className="streak-indicator">
      <span className="streak-flame">🔥</span>
      <span>{days} {days === 1 ? 'día' : 'días'}</span>
      {lastActive && (
        <span style={{ fontSize: 'var(--text-xs)', opacity: 0.7 }}>
          · {lastActive}
        </span>
      )}
    </div>
  );
}

interface SessionTimerProps {
  startTime: Date;
}

export function SessionTimer({ startTime }: SessionTimerProps) {
  const [elapsed, setElapsed] = useState('00:00');

  useEffect(() => {
    const interval = setInterval(() => {
      const now = new Date();
      const diff = now.getTime() - startTime.getTime();
      const minutes = Math.floor(diff / 60000);
      const seconds = Math.floor((diff % 60000) / 1000);
      setElapsed(`${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`);
    }, 1000);

    return () => clearInterval(interval);
  }, [startTime]);

  return (
    <div className="session-timer">
      <span className="session-timer-pulse"></span>
      <span>{elapsed}</span>
    </div>
  );
}

interface UndoToastProps {
  message: string;
  onUndo?: () => void;
  onClose?: () => void;
}

export function UndoToast({ message, onUndo, onClose }: UndoToastProps) {
  useEffect(() => {
    const timer = setTimeout(() => {
      onClose?.();
    }, 5000);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <div className="undo-toast">
      <span>{message}</span>
      {onUndo && (
        <button
          onClick={() => {
            onUndo();
            onClose?.();
          }}
          className="ghost small"
          style={{ padding: '4px 12px' }}
        >
          Deshacer
        </button>
      )}
    </div>
  );
}

interface SmartHintProps {
  text: string;
  position: { x: number; y: number };
  visible: boolean;
}

export function SmartHint({ text, position, visible }: SmartHintProps) {
  if (!visible) return null;

  return (
    <div
      className="smart-hint"
      style={{
        left: position.x,
        top: position.y,
      }}
    >
      {text}
    </div>
  );
}

interface EmptyStateProps {
  icon?: string;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyStateEnhanced({ 
  icon = '📦', 
  title, 
  description, 
  actionLabel, 
  onAction 
}: EmptyStateProps) {
  return (
    <div className="empty-state-enhanced animate-in">
      <div className="empty-state-icon" style={{ fontSize: '64px' }}>
        {icon}
      </div>
      <h3 className="empty-state-title">{title}</h3>
      <p className="empty-state-description">{description}</p>
      {actionLabel && onAction && (
        <button onClick={onAction} className="primary hover-lift">
          {actionLabel}
        </button>
      )}
    </div>
  );
}

interface SuggestionChipProps {
  label: string;
  onClick?: () => void;
}

export function SuggestionChip({ label, onClick }: SuggestionChipProps) {
  return (
    <button className="suggestion-chip" onClick={onClick}>
      <span>✨</span>
      <span>{label}</span>
    </button>
  );
}

interface TopProgressBarProps {
  loading: boolean;
}

export function TopProgressBar({ loading }: TopProgressBarProps) {
  if (!loading) return null;
  return <div className="top-progress-bar" />;
}

interface QuickAddFABProps {
  onClick?: () => void;
  icon?: string;
}

export function QuickAddFAB({ onClick, icon = '+' }: QuickAddFABProps) {
  return (
    <button 
      className="quick-add-fab interactive-ripple"
      onClick={onClick}
      aria-label="Agregar rápido"
    >
      <span style={{ fontSize: '28px', fontWeight: 300 }}>{icon}</span>
    </button>
  );
}

interface ProductivityRingProps {
  score: number; // 0-100
}

export function ProductivityRing({ score }: ProductivityRingProps) {
  const getColor = (score: number) => {
    if (score >= 80) return '#22c55e';
    if (score >= 60) return '#3dd6ff';
    if (score >= 40) return '#f5c76a';
    return '#ff9a9a';
  };

  const radius = 36;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (score / 100) * circumference;

  return (
    <div className="productivity-ring">
      <svg width="80" height="80">
        <circle
          cx="40"
          cy="40"
          r={radius}
          fill="none"
          stroke="var(--color-border)"
          strokeWidth="6"
        />
        <circle
          cx="40"
          cy="40"
          r={radius}
          fill="none"
          stroke={getColor(score)}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={offset}
          style={{
            transform: 'rotate(-90deg)',
            transformOrigin: '50% 50%',
            transition: 'stroke-dashoffset 0.5s ease',
          }}
        />
      </svg>
      <div className="productivity-score">{score}</div>
    </div>
  );
}

// Hook para manejar achievements
export function useAchievements() {
  const [achievements, setAchievements] = useState<Array<{
    id: string;
    title: string;
    description: string;
    icon: string;
  }>>([]);

  const unlockAchievement = (achievement: {
    id: string;
    title: string;
    description: string;
    icon?: string;
  }) => {
    setAchievements(prev => [...prev, {
      ...achievement,
      icon: achievement.icon || '🎉',
    }]);

    // Auto-remove después de 4 segundos
    setTimeout(() => {
      setAchievements(prev => prev.filter(a => a.id !== achievement.id));
    }, 4000);
  };

  return { achievements, unlockAchievement };
}

// Hook para tracking de progreso
export function useProgressTracking() {
  const [progress, setProgress] = useState(0);
  const [isComplete, setIsComplete] = useState(false);

  const updateProgress = (newProgress: number) => {
    setProgress(Math.min(100, Math.max(0, newProgress)));
    if (newProgress >= 100) {
      setIsComplete(true);
    }
  };

  const reset = () => {
    setProgress(0);
    setIsComplete(false);
  };

  return { progress, isComplete, updateProgress, reset };
}
