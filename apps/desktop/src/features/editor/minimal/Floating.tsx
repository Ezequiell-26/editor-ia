import type { ReactNode } from 'react';
import { Icon } from '../../../components/Icon';
import { asset, type Scene } from './model';

const SCENES: readonly { readonly id: Scene; readonly label: string }[] = [
  { id: 'empty', label: 'Vazio' },
  { id: 'media', label: 'Mídia' },
  { id: 'captions', label: 'Legendas' },
  { id: 'studio', label: 'Estúdio' },
];

export function TutorialBanner(): ReactNode {
  return (
    <div className="me-tutorial-banner">
      <span className="me-tutorial-mark" aria-hidden="true">AC</span>
      <strong>Tutorial AlaukCut: edição com IA, Hyperframes e animação estilo Vídeo-Scribe</strong>
    </div>
  );
}

export function ProgressDialog({ onCancel }: { readonly onCancel: () => void }): ReactNode {
  return (
    <div className="me-modal-layer">
      <div className="me-progress-dialog" role="dialog" aria-label="Gerando legendas">
        <strong><Icon name="sparkles" size={13} /> Gerando legendas...</strong>
        <span className="me-progress-bar"><i /></span>
        <span className="me-progress-text">78% · ouvindo... 131s de 177s</span>
        <button type="button" onClick={onCancel}>Cancelar</button>
      </div>
    </div>
  );
}

export function PlaybackBar(): ReactNode {
  return (
    <div className="me-playback-bar" aria-hidden="true">
      <span className="me-playback-track"><i /></span>
      <span className="me-playback-left">
        <Icon name="play" size={13} />
        <Icon name="skipBack" size={13} />
        <em>1:39 / 9:31</em>
      </span>
      <span className="me-playback-center">⌃</span>
      <span className="me-playback-right">
        <i className="me-switch"><b /></i>
        <i className="me-cc">CC<sup>10</sup></i>
        <Icon name="settings" size={13} />
        <b className="me-kappa">K</b>
      </span>
    </div>
  );
}

export function FeedbackBar(): ReactNode {
  return (
    <div className="me-feedback-bar" aria-hidden="true">
      <span>👍</span><span>👎</span><span>💬</span><span>↗</span><span>✦</span><span>⋯</span>
    </div>
  );
}

export function AvatarMeter(): ReactNode {
  return (
    <div className="me-avatar-meter" aria-hidden="true">
      <img className="me-avatar" src={asset('avatar.png')} alt="" draggable={false} />
      <div className="me-meter">
        <div className="me-meter-top"><span>0.0</span><span>0.0</span></div>
        <div className="me-meter-scale">
          {['6', '0', '-6', '-12', '-20', '-30', '-40', '-60'].map((n) => <span key={n}>{n}</span>)}
        </div>
        <div className="me-meter-bars"><i /><i /></div>
      </div>
    </div>
  );
}

export function SceneNav({ scene, onScene }: {
  readonly scene: Scene;
  readonly onScene: (scene: Scene) => void;
}): ReactNode {
  return (
    <div className="me-scene-nav" title="Estados de referencia (sólo arnés local)">
      {SCENES.map((item, index) => (
        <button
          key={item.id}
          type="button"
          className={scene === item.id ? 'active' : ''}
          onClick={() => onScene(item.id)}
        >
          {index + 1} · {item.label}
        </button>
      ))}
    </div>
  );
}
