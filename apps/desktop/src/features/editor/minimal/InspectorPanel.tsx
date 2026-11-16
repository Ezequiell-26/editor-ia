import { useState, type CSSProperties, type ReactNode } from 'react';
import type { Clip } from '@editor-ia/project-schema';
import { Icon } from '../../../components/Icon';
import { basename } from '../../../lib/format';
import { useProjectStore } from '../../../state/project-store';
import {
  ASSISTANT_MODELS, COLOR_TABS, FEATURE_CARDS, HSL_COLUMNS, PRODUCT,
  type InspectorTab, type Scene,
} from './model';
import {
  ColorWheel, CurveChart, ModeTabs, NumberField, PillTabs, ScopesChart,
  SectionTitle, SliderRow, Toggle,
} from './controls';

export interface InspectorPanelProps {
  readonly scene: Scene;
  readonly tab: InspectorTab;
  readonly onTab: (tab: InspectorTab) => void;
  readonly projectName: string;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly duration: string;
  readonly onAssistant: () => void;
  readonly onAction?: ((label: string) => void) | undefined;
  /** Transform estático del clip seleccionado; si existe, los campos de
   *  Transformar muestran sus valores reales en vez de la maqueta. */
  readonly clipTransform?: Clip['transform'];
  /** Escritura real del transform (sólo con clipTransform presente). */
  readonly onTransformCommit?: ((patch: Partial<NonNullable<Clip['transform']>>) => void) | undefined;
}

function Details({ projectName, width, height, fps, duration, onAction }: {
  readonly projectName: string;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly duration: string;
  readonly onAction?: ((label: string) => void) | undefined;
}): ReactNode {
  const { state, durationFrames } = useProjectStore();
  const projectPath = state.opened?.path ? basename(state.opened.path) : projectName;
  const frames = durationFrames > 0 ? durationFrames : 0;

  return (
    <>
      <div className="me-proj-card">
        <strong>{projectName}</strong>
        <div className="me-chips">
          <span>16:9</span><span>{width} × {height}</span><span>{Math.round(fps)} fps</span>
          <span>{duration}</span>
        </div>
      </div>
      <h4 className="me-section-title">O QUE O {PRODUCT.toUpperCase()} FAZ POR VOCÊ</h4>
      <div className="me-cards-list">
        {FEATURE_CARDS.map((card) => (
          <button
            type="button"
            className="me-feature"
            key={card.title}
            title={`Abrir ${card.title}`}
            onClick={() => onAction?.(card.title)}
          >
            <span className="me-feature-icon"><Icon name={card.icon} size={14} /></span>
            <span className="me-feature-text"><strong>{card.title}</strong><small>{card.text}</small></span>
            <Icon name="chevron" size={11} />
          </button>
        ))}
      </div>
      <p className="me-details-note">
        {frames > 0 ? `${frames} cuadros en la timeline. ` : ''}
        Clique num clipe da timeline para ajustar só ele.
      </p>
      <p className="me-details-path">{projectPath}</p>
    </>
  );
}

function Assistant({ onAssistant }: { readonly onAssistant: () => void }): ReactNode {
  return (
    <div className="me-assistant-body">
      <button type="button" className="me-assistant-open" onClick={onAssistant}>
        <span className="me-dot" /> Pedir ao assistente <em>▾</em>
      </button>
      <div className="me-assistant-chips">
        <span><i className="me-model-dot green" /> Claude Code (aqui dentro) ·</span>
        <span className="outlined">Opus 5 ·</span>
        <span>força: alta ·</span>
      </div>
      <div className="me-model-list">
        {ASSISTANT_MODELS.map((model) => (
          <div className="me-model-row" key={model.label}>
            <span><i className={`me-model-dot ${model.tone}`} /> {model.label}</span>
            <em>{model.status}</em>
          </div>
        ))}
      </div>
      <p className="me-assistant-meta">Asistente local · cuenta no vinculada</p>
      <p className="me-assistant-meta">usando: instalación local de Olyvia</p>
      <div className="me-chat-bubble">o que você é capaz de fazer dentro do editor? E quantas funções você executa?</div>
      <div className="me-chat-answer">Posso executar <strong>las herramientas disponibles</strong> dentro do {PRODUCT}. Em resumo:</div>
    </div>
  );
}

function VideoInspector({ scene, onAction, clipTransform, onTransformCommit }: {
  readonly scene: Scene;
  readonly onAction?: ((label: string) => void) | undefined;
  readonly clipTransform?: Clip['transform'];
  readonly onTransformCommit?: ((patch: Partial<NonNullable<Clip['transform']>>) => void) | undefined;
}): ReactNode {
  const isStudio = scene === 'studio';
  const editable = Boolean(clipTransform && onTransformCommit);
  const commit = (patch: Partial<NonNullable<Clip['transform']>>) => onTransformCommit?.(patch);
  // «Escala uniforme»: con el toggle activo (default, como la réplica) el
  // campo Escala escribe scaleX Y scaleY juntos; apagado sólo scaleX.
  const [uniformScale, setUniformScale] = useState(true);
  // UI-002: con clip seleccionado los campos reflejan su transform real
  // (scaleX/offset/rotation/opacity del schema); sin clip queda la maqueta.
  const scaleX = clipTransform?.scaleX ?? 1;
  const offsetX = clipTransform?.offsetX ?? 0;
  const offsetY = clipTransform?.offsetY ?? 0;
  const rotationDeg = clipTransform?.rotationDeg ?? 0;
  const opacity = clipTransform?.opacity ?? 1;
  return (
    <div className="me-insp-body">
      <PillTabs
        tabs={isStudio ? ['Básico', 'Remover plano de...', 'Máscara'] : ['Básico', 'Remover plano de fundo']}
        active="Básico"
      />
      <SectionTitle action={<span className="me-help">?</span>}>Câmera inteligente</SectionTitle>
      <button
        type="button"
        className="me-violet"
        onClick={() => onAction?.('Aplicar câmera neste trecho')}
        title="Abrir las herramientas de cámara y movimiento"
      >≡ Aplicar câmera neste trecho</button>
      <SectionTitle reset>Transformar</SectionTitle>
      <div className="me-transform">
        <span className="me-transform-label">Escala</span>
        <SliderRow
          value={clipTransform ? `${Math.round(scaleX * 100)}` : '100'}
          percent={clipTransform ? Math.min(100, scaleX * 100) : 22}
          suffix="%"
          {...(editable ? {
            onCommit: (n: number) => {
              const scale = Math.min(100, Math.max(0.01, n / 100));
              commit(uniformScale ? { scaleX: scale, scaleY: scale } : { scaleX: scale });
            },
            min: 1, max: 10000, step: 1,
          } : {})}
          ariaLabel="Escala"
        />
        <div className="me-uniform">
          <span>Escala uniforme</span>
          <Toggle
            on={uniformScale}
            {...(editable ? { onToggle: () => setUniformScale((value) => !value), label: 'Escala uniforme' } : {})}
          />
        </div>
        <div className="me-transform-row">
          <span className="me-ctrl-label">Posição</span>
          <span className="me-num-pair">
            <NumberField
              value={clipTransform ? `${offsetX}` : '0'}
              ariaLabel="Posição X"
              {...(editable ? { onCommit: (n: number) => commit({ offsetX: Math.round(n) }), min: -100000, max: 100000 } : {})}
            />
            <NumberField
              value={clipTransform ? `${offsetY}` : '0'}
              ariaLabel="Posição Y"
              {...(editable ? { onCommit: (n: number) => commit({ offsetY: Math.round(n) }), min: -100000, max: 100000 } : {})}
            />
          </span>
          <span className="me-kf" aria-hidden="true"><span>‹</span><span>◇</span><span>›</span></span>
        </div>
        <div className="me-transform-row">
          <span className="me-ctrl-label">Girar</span>
          <NumberField
            value={clipTransform ? `${rotationDeg}` : '0'}
            suffix="°"
            ariaLabel="Girar"
            {...(editable ? { onCommit: (n: number) => commit({ rotationDeg: Math.min(360, Math.max(-360, n)) }), min: -360, max: 360 } : {})}
          />
          <span className="me-kf" aria-hidden="true"><span>‹</span><span>◇</span><span>›</span></span>
        </div>
        {isStudio ? (
          <>
            <span className="me-transform-label">Opacidade</span>
            <SliderRow
              value={clipTransform ? `${Math.round(opacity * 100)}` : '100'}
              percent={clipTransform ? opacity * 100 : 62}
              suffix="%"
              {...(editable ? {
                onCommit: (n: number) => commit({ opacity: Math.min(1, Math.max(0, n / 100)) }),
                min: 0, max: 100, step: 1,
              } : {})}
              ariaLabel="Opacidade"
            />
          </>
        ) : (
          <>
            <p className="me-ctrl-sub">Curva dos quadros-chave <span className="me-help">?</span></p>
            <div className="me-select">Linear (velocidade constante) <Icon name="chevron-down" size={11} /></div>
          </>
        )}
      </div>
    </div>
  );
}

function HslColumn({ index, compact = false, cut = false }: {
  readonly index: number; readonly compact?: boolean; readonly cut?: boolean;
}): ReactNode {
  const column = HSL_COLUMNS[index] ?? { label: '', hue: 0, gradient: 'linear-gradient(90deg,#333,#666)' };
  const hue = compact && index === 1 ? 11 : column.hue;
  return (
    <div className={`me-hsl-col${cut ? ' cut' : ''}`}>
      {!cut ? (
        <>
          <strong>{column.label}</strong>
          <ColorWheel dot={[50, 50]} radius={22} />
        </>
      ) : null}
      <span className="me-hsl-center">Centro <b>0</b></span>
      <span className="me-hsl-slider"><i style={{ '--me-grad': column.gradient } as CSSProperties} /><b /></span>
      <span className="me-hsl-matiz">Matiz <b>{hue}</b></span>
      <span className="me-hsl-sat"><i /><i /></span>
      <span className="me-hsl-nums"><b>0</b><b>0</b></span>
    </div>
  );
}

function ColorInspector({ tab }: { readonly tab: InspectorTab }): ReactNode {
  return (
    <div className="me-insp-body me-color">
      {tab === 'color-scopes' ? (
        <>
          <div className="me-color-toolbar">
            <span className="me-eye on"><Icon name="eye" size={12} /></span>
            <span className="me-ghost">Antes</span>
            <span className="me-tool-pill"><Icon name="sparkles" size={11} /> Automático</span>
            <span className="me-tool-spacer" />
            <span className="me-ghost"><Icon name="copy" size={11} /></span>
            <span className="me-ghost"><Icon name="copy" size={11} /></span>
            <span className="me-ghost"><Icon name="refresh" size={11} /></span>
          </div>
          <SectionTitle action={<span className="me-help">?</span>}><span className="me-caret">▾</span> Monitor de cor</SectionTitle>
          <PillTabs tabs={['Parade RGB', 'Forma de onda', 'Histograma', 'Vetoroscópio']} active="Parade RGB" />
          <ScopesChart />
          <SectionTitle action={<span className="me-help">? <Icon name="refresh" size={11} /></span>}>LUT</SectionTitle>
          <div className="me-lut-row">
            <span className="me-select wide">Nenhum <Icon name="chevron-down" size={11} /></span>
            <span className="me-ghost-btn">Adicionar</span>
            <Icon name="trash" size={11} />
          </div>
          <SliderRow label="Força" value="100" percent={78} suffix="%" gradient="linear-gradient(90deg,#1c8c7d,#2adaba)" kf={false} />
          <SectionTitle reset>Cor</SectionTitle>
        </>
      ) : null}

      {tab === 'color-basic' ? (
        <>
          <SliderRow label="Força" value="100" percent={78} suffix="%" gradient="linear-gradient(90deg,#1c8c7d,#2adaba)" kf={false} />
          <SectionTitle reset>Cor</SectionTitle>
          <SliderRow label="Temperatura" value="27" percent={62} gradient="linear-gradient(90deg,#3b7bff,#e6e6ee,#ff9a2e)" />
          <SliderRow label="Tint" value="-4" percent={48} gradient="linear-gradient(90deg,#25c25a,#c9c9d2,#d744c9)" />
          <SliderRow label="Intensificar cor" value="0" percent={50} gradient="linear-gradient(90deg,#4b4a52,#e3c532,#3b7bff)" />
          <SliderRow label="Saturação" value="50" percent={50} gradient="linear-gradient(90deg,#4b4a52,#f2c53d,#f25c3d,#3ecb6a,#4b78ff)" />
          <SliderRow label="Matiz" value="50" percent={50} gradient="linear-gradient(90deg,#f2453d,#e8d23b,#3ecb6a,#3b7bff,#d744c9)" />
          <SectionTitle reset>Luz</SectionTitle>
          <SliderRow label="Exposição" value="0" percent={50} muted />
          <SliderRow label="Brilho" value="-24" percent={38} muted />
          <SliderRow label="Contraste" value="1,00" percent={50} muted />
        </>
      ) : null}

      {tab === 'color-wheels' ? (
        <>
          <SliderRow label="Sombras" value="0" percent={50} muted />
          <SliderRow label="Brancos" value="-1" percent={50} muted />
          <SliderRow label="Pretos" value="-11" percent={44} muted />
          <SectionTitle>Rodas de cor</SectionTitle>
          <div className="me-wheels-grid">
            {[
              { name: 'Lift', dot: [48, 55] as const, nums: ['0,00', '0,00', '0,00', '0,00'] },
              { name: 'Gamma', dot: [50, 50] as const, nums: ['0,00', '0,03', '-0,00', '-0,03'] },
              { name: 'Gain', dot: [50, 50] as const, nums: ['0,00', '0,00', '0,00', '0,00'] },
              { name: 'Offset', dot: [50, 50] as const, nums: ['0,00', '0,00', '0,00', '0,00'] },
            ].map((wheel) => (
              <div className="me-wheel-cell" key={wheel.name}>
                <div className="me-wheel-head"><strong>{wheel.name}</strong><Icon name="refresh" size={10} /></div>
                <ColorWheel dot={wheel.dot} radius={46} />
                <span className="me-wheel-slider"><i /><b /></span>
                <div className="me-wheel-nums">
                  {wheel.nums.map((n, i) => <span key={i}><b>{n}</b><em>{['Y', 'R', 'G', 'B'][i]}</em></span>)}
                </div>
              </div>
            ))}
          </div>
        </>
      ) : null}

      {tab === 'color-hsl' ? (
        <>
          <CurveChart />
          <SectionTitle action={<span className="me-help">? <Icon name="refresh" size={11} /></span>}>HSL por cor</SectionTitle>
          <div className="me-hsl-intro">
            <span className="me-ghost-btn"><Icon name="pencil" size={10} /> Pegar na prévia</span>
            <p>Clique em Pegar na prévia e depois numa cor do vídeo para saber em qual coluna ela cai.</p>
          </div>
          <div className="me-hsl-grid">
            {[0, 1, 2, 3, 4].map((i) => <HslColumn key={i} index={i} />)}
            <div className="me-hsl-peek"><b>Azul</b><b>Magenta</b></div>
          </div>
        </>
      ) : null}

      {tab === 'color-hsl2' ? (
        <>
          <div className="me-hsl-grid me-hsl-grid-top">
            {[0, 1, 2, 3, 4].map((i) => <HslColumn key={i} index={i} cut compact />)}
          </div>
          <div className="me-hsl-grid me-hsl-grid-bottom">
            {[5, 6].map((i) => <HslColumn key={i} index={i} />)}
          </div>
        </>
      ) : null}
    </div>
  );
}

export function InspectorPanel({
  scene, tab, onTab, projectName, width, height, fps, duration, onAssistant, onAction,
  clipTransform, onTransformCommit,
}: InspectorPanelProps): ReactNode {
  const isStudio = scene === 'studio';
  const isColor = COLOR_TABS.includes(tab);
  const isAssistant = tab === 'assistant';
  const isDetails = tab === 'detalhes';

  const mainTabs = isStudio
    ? ['Vídeo', 'Áudio', 'Cor', 'Velocidade', 'Animação', 'Rastreamento']
    : ['Vídeo', 'Animação'];
  const activeMain = isColor ? 'Cor' : isDetails || isAssistant ? 'Detalhes' : 'Vídeo';

  const cycleColor = (): void => {
    const index = Math.max(0, COLOR_TABS.indexOf(tab));
    const next: InspectorTab = COLOR_TABS[(index + 1) % COLOR_TABS.length] ?? 'color-scopes';
    onTab(next);
  };

  return (
    <aside className={`me-right me-right-${scene}`} role="complementary" aria-label="Detalhes">
      {isColor ? (
        <ModeTabs
          tabs={['Vídeo', 'Cor', 'Animação']}
          active="Cor"
          onSelect={(name) => {
            if (name === 'Cor') cycleColor();
            else if (name === 'Vídeo') onTab('video');
            else onTab('detalhes');
          }}
        />
      ) : isDetails || isAssistant ? (
        <div className="me-right-head"><span>Detalhes</span>{isDetails ? <span className="me-right-head-caret">▾</span> : null}</div>
      ) : (
        <ModeTabs
          tabs={mainTabs}
          active={activeMain}
          compact={isStudio}
          onSelect={(name) => {
            if (name === 'Cor') onTab('color-scopes');
            else if (name === 'Vídeo') onTab('video');
            else onTab('detalhes');
          }}
        />
      )}

      <div className="me-right-scroll">
        {/* UI-002: los controles de Vídeo/Cor son spans de la réplica — no
            editan el clip. Se declara en vez de simular interactividad. En
            Vídeo con clip seleccionado los campos de Transformar ya escriben
            (updateClip), así que el aviso sólo aplica al resto de controles. */}
        {!isDetails && !isAssistant ? (
          <p className="me-details-note">
            {tab === 'video' && clipTransform && onTransformCommit
              ? 'Transformar edita el clip — los demás controles ainda não alteran o clipe.'
              : 'Prévia visual — estes controles ainda não alteram o clipe.'}
          </p>
        ) : null}
        {isDetails ? (
          <Details
            projectName={projectName}
            width={width}
            height={height}
            fps={fps}
            duration={duration}
            onAction={onAction}
          />
        ) : null}
        {isAssistant ? <Assistant onAssistant={onAssistant} /> : null}
        {tab === 'video' ? <VideoInspector scene={scene} onAction={onAction} clipTransform={clipTransform} onTransformCommit={onTransformCommit} /> : null}
        {isColor ? <ColorInspector tab={tab} /> : null}
      </div>

      {!isAssistant ? (
        <button type="button" className="me-assistant" onClick={onAssistant}><span className="me-dot" /> Pedir ao assistente</button>
      ) : null}
    </aside>
  );
}
