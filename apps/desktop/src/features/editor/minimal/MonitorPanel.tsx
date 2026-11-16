import type { ReactNode } from 'react';
import { Icon } from '../../../components/Icon';
import type { Scene } from './model';

export interface MonitorPanelProps {
  readonly scene: Scene;
  readonly monitorSrc: string | null;
  /** UI-001: <video> en vivo del clip bajo el playhead (opaca el frame estático). */
  readonly liveVideo?: ReactNode | null;
  readonly playing: boolean;
  readonly onTogglePlay: () => void;
  readonly onStop: () => void;
  readonly timecode: string;
  readonly duration: string;
  readonly aspect: string;
  readonly onTool?: (label: string) => void;
}

function SelectionFrame(): ReactNode {
  return (
    <span className="me-selection" aria-hidden="true">
      {['tl', 'tm', 'tr', 'ml', 'mr', 'bl', 'bm', 'br'].map((pos) => <i key={pos} className={`me-handle ${pos}`} />)}
    </span>
  );
}

export function MonitorPanel({
  scene, monitorSrc, liveVideo, playing, onTogglePlay, onStop, timecode, duration, aspect, onTool,
}: MonitorPanelProps): ReactNode {
  const isStudio = scene === 'studio';
  const isCaptions = scene === 'captions';

  return (
    <section className="me-center" aria-label="Monitor">
      <div className="me-center-head">
        <span>Reprodutor - Linha do tempo 01</span>
        {isStudio ? (
          <span className="me-center-head-tools" aria-hidden="true">
            <i className="on"><Icon name="chat" size={11} /></i>
            <i><Icon name="captions" size={11} /></i>
          </span>
        ) : null}
      </div>

      <div className="me-monitor-wrap">
        <div className="me-ruler-top" aria-hidden="true">
          {[-800, -400, 0, 400, 800].map((n) => <span key={n}>{n}</span>)}
        </div>
        <div className="me-ruler-left" aria-hidden="true">
          <span>400</span><span>0</span><span>-400</span>
        </div>

        <div className={`me-monitor me-monitor-view-${scene}`}>
          {monitorSrc ? <img className="me-monitor-media" src={monitorSrc} alt="" draggable={false} /> : null}
          {liveVideo}
          {isStudio ? (
            <span className="me-monitor-stage" aria-hidden="true">
              <img src="./alaukcut/media-vertical.png" alt="" draggable={false} />
              <SelectionFrame />
            </span>
          ) : null}
          {scene === 'media' && monitorSrc ? <SelectionFrame /> : null}
          {isCaptions ? <span className="me-monitor-dim" aria-hidden="true" /> : null}
        </div>

        {isStudio ? (
          <div className="me-monitor-progress" aria-hidden="true"><span /><i /></div>
        ) : null}
      </div>

      <div className="me-monitor-foot">
        <span className="me-timecode">
          {timecode} <span className="me-timecode-sep">/</span> {duration}
          {isStudio ? <i className="me-playing-dot" /> : null}
        </span>
        <div className="me-transport">
          <button type="button" aria-label="Capturar quadro" title="Capturar quadro" onClick={() => onTool?.('Capturar quadro')}>
            <Icon name="camera" size={11} />
          </button>
          {isStudio ? (
            <button type="button" aria-label="Quadro anterior" title="Quadro anterior" onClick={() => onTool?.('Quadro anterior')}>
              <Icon name="frameBack" size={11} />
            </button>
          ) : null}
          <button
            type="button"
            aria-label={playing ? 'Pausar modo simple' : 'Reproduzir modo simple'}
            onClick={onTogglePlay}
          >
            <Icon name={playing ? 'pause' : 'play'} size={11} />
          </button>
          {isStudio ? (
            <button type="button" aria-label="Quadro seguinte" title="Quadro seguinte" onClick={() => onTool?.('Quadro seguinte')}>
              <Icon name="frameForward" size={11} />
            </button>
          ) : null}
          <button type="button" aria-label="Parar" onClick={onStop}><Icon name="stop" size={11} /></button>
        </div>
        <span className="me-monitor-meta">
          {isStudio ? (
            <span className="me-monitor-extra" aria-hidden="true"><i>⌛</i><i>◫</i><i>✕</i></span>
          ) : null}
          Predefinição <b>{aspect}</b> <Icon name="fullscreen" size={11} />
        </span>
      </div>
    </section>
  );
}
