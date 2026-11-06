import { useMemo, useRef, useState } from 'react';
import type { Asset, ClipEffects, ClipTransition } from '@editor-ia/project-schema';
import type { ViewId } from '../../app/navigation';
import { Icon, type IconName } from '../../components/Icon';
import { useThumbnail } from '../../hooks/useThumbnail';
import { friendlyAssetLabel } from '../../state/asset-labels';
import {
  addAdjustmentLayer,
  addClipFromAsset,
  addTitleFromTemplate,
  applyTransitionToCuts,
  fpsOf,
  toggleAssetFavorite,
  updateClip,
} from '../../state/project-actions';
import { assetBins, filterAssets, type AssetKindFilter } from '../../state/asset-organization';
import {
  EFFECT_PRESETS,
  applyEffectPreset,
  type EffectPreset,
} from '../../state/effect-presets';
import { TITLE_TEMPLATES, type TitleTemplate } from '../../state/title-templates';
import { COLOR_LOOKS } from './color-looks';
import { useProjectStore } from '../../state/project-store';
import { EmojiPickerButton } from '../emoji/EmojiPicker';
import { insertEmoji } from '../emoji/emoji';
import { ProxyToolsPanel } from './ProxyToolsPanel';
import { SPLIT_SCREEN_TEMPLATES, SplitScreenTemplates } from './FilmoraStates';

type AssetFilter = AssetKindFilter;

export type RailView =
  | 'media'
  | 'audio'
  | 'titles'
  | 'stickers'
  | 'effects'
  | 'transitions'
  | 'filters'
  | 'adjustments'
  | 'templates';

/** Barra de herramientas CapCut Pro: iconos y pestañas de creación y edición. */
const RAIL_VIEWS: readonly { readonly id: RailView; readonly label: string; readonly icon: IconName }[] = [
  { id: 'media', label: 'Medios', icon: 'film' },
  { id: 'audio', label: 'Audio', icon: 'audio' },
  { id: 'titles', label: 'Texto', icon: 'text' },
  { id: 'stickers', label: 'Stickers', icon: 'sparkles' },
  { id: 'effects', label: 'Efectos', icon: 'effects' },
  { id: 'transitions', label: 'Transiciones', icon: 'refresh' },
  { id: 'filters', label: 'Filtros', icon: 'filters' },
  { id: 'adjustments', label: 'Ajustes', icon: 'layers' },
  { id: 'templates', label: 'Plantillas', icon: 'grid' },
];

/** Biblioteca de stickers estilo CapCut */
interface StickerItem {
  readonly id: string;
  readonly name: string;
  readonly category: 'trending' | 'social' | 'arrows' | 'emojis';
  readonly emoji: string;
  readonly text: string;
  readonly animation: 'pop' | 'fade' | 'slide-up';
  readonly color: string;
}

const STICKER_LIBRARY: readonly StickerItem[] = [
  // Trending
  { id: 'fuego', name: 'Fuego', category: 'trending', emoji: '🔥', text: '🔥 FUEGO', animation: 'pop', color: '#ff4d4f' },
  { id: 'estrella', name: 'Top', category: 'trending', emoji: '⭐', text: '⭐ TOP', animation: 'pop', color: '#faad14' },
  { id: 'boom', name: 'Boom', category: 'trending', emoji: '💥', text: '💥 BOOM', animation: 'pop', color: '#f5222d' },
  { id: 'cohete', name: 'Nivel Up', category: 'trending', emoji: '🚀', text: '🚀 NIVEL UP', animation: 'slide-up', color: '#722ed1' },
  { id: 'cien', name: '100% Real', category: 'trending', emoji: '💯', text: '💯 REAL', animation: 'pop', color: '#f5222d' },
  { id: 'rayo', name: 'Rayo Fast', category: 'trending', emoji: '⚡', text: '⚡ FAST', animation: 'pop', color: '#faad14' },
  // Social
  { id: 'subscribe', name: 'Suscríbete', category: 'social', emoji: '🔔', text: 'SUSCRÍBETE 🔔', animation: 'slide-up', color: '#ff0000' },
  { id: 'like', name: 'Dale Like', category: 'social', emoji: '👍', text: 'DALE LIKE 👍', animation: 'pop', color: '#1890ff' },
  { id: 'share', name: 'Compartir', category: 'social', emoji: '📲', text: 'COMPARTÍ 📲', animation: 'slide-up', color: '#52c41a' },
  { id: 'live', name: 'En Vivo', category: 'social', emoji: '🔴', text: '🔴 EN VIVO', animation: 'fade', color: '#ff4d4f' },
  // Flechas & Indicadores
  { id: 'arrow-right', name: 'Mirá Aquí', category: 'arrows', emoji: '👉', text: '👉 MIRÁ AQUÍ', animation: 'pop', color: '#faad14' },
  { id: 'arrow-down', name: 'Link Abajo', category: 'arrows', emoji: '👇', text: '👇 LINK ABAJO', animation: 'slide-up', color: '#faad14' },
  { id: 'check', name: 'Verificado', category: 'arrows', emoji: '✔️', text: '✔️ VERIFICADO', animation: 'pop', color: '#52c41a' },
  { id: 'alert', name: 'Atención', category: 'arrows', emoji: '⚠️', text: '⚠️ ATENCIÓN', animation: 'pop', color: '#faad14' },
  // Emojis
  { id: 'cool', name: 'Cool', category: 'emojis', emoji: '😎', text: '😎', animation: 'pop', color: '#ffffff' },
  { id: 'mindblown', name: 'Shock', category: 'emojis', emoji: '🤯', text: '🤯 WOW', animation: 'pop', color: '#ffffff' },
  { id: 'laugh', name: 'Risas', category: 'emojis', emoji: '😂', text: '😂😂😂', animation: 'pop', color: '#ffffff' },
  { id: 'party', name: 'Fiesta', category: 'emojis', emoji: '🎉', text: '🎉 PARTY', animation: 'pop', color: '#faad14' },
];

/** Efectos de sonido SFX predeterminados */
interface SoundEffectPreset {
  readonly id: string;
  readonly label: string;
  readonly duration: string;
  readonly description: string;
}

const SFX_PRESETS: readonly SoundEffectPreset[] = [
  { id: 'sfx-woosh', label: 'Woosh Rápido', duration: '0.4s', description: 'Transición dinámica de aire' },
  { id: 'sfx-boom', label: 'Impacto Boom', duration: '1.2s', description: 'Golpe grave cinematográfico' },
  { id: 'sfx-ding', label: 'Ding Campana', duration: '0.6s', description: 'Notificación de atención' },
  { id: 'sfx-click', label: 'Click Táctil', duration: '0.1s', description: 'Pulsación de interfaz' },
  { id: 'sfx-riser', label: 'Riser Tensión', duration: '2.0s', description: 'Crescendo para anticipación' },
  { id: 'sfx-pop', label: 'Pop Burbuja', duration: '0.2s', description: 'Aparición de sticker o texto' },
  { id: 'sfx-glitch', label: 'Glitch Digital', duration: '0.5s', description: 'Interferencia cibernética' },
  { id: 'sfx-subdrop', label: 'Sub-Drop', duration: '1.8s', description: 'Bajo envolvente para clímax' },
];

/** Transiciones estilo CapCut */
interface TransitionPreset {
  readonly id: ClipTransition['type'];
  readonly label: string;
  readonly description: string;
  readonly iconSymbol: string;
}

const TRANSITION_PRESETS: readonly TransitionPreset[] = [
  { id: 'dissolve', label: 'Disolución', description: 'Fundido cruzado clásico suave', iconSymbol: '░' },
  { id: 'fade-black', label: 'Fundido a Negro', description: 'Cierre y apertura cinematográfica', iconSymbol: '⬛' },
  { id: 'fade-white', label: 'Fundido a Blanco', description: 'Apertura luminosa desde blanco', iconSymbol: '⬜' },
  { id: 'slide-left', label: 'Deslizar Izq.', description: 'Empuje lateral hacia la izquierda', iconSymbol: '◀' },
  { id: 'slide-right', label: 'Deslizar Der.', description: 'Empuje lateral hacia la derecha', iconSymbol: '▶' },
  { id: 'slide-up', label: 'Deslizar Arriba', description: 'El clip sube desde abajo', iconSymbol: '▲' },
  { id: 'slide-down', label: 'Deslizar Abajo', description: 'El clip baja desde arriba', iconSymbol: '▼' },
];

/* ── Árbol por módulo (capturas 100, 102–111, 114) ─────────────────────────
   Cada entrada filtra datos REALES del proyecto o navega a una vista que ya
   existe. Las funciones de IA/stock que las capturas muestran pero que
   requieren backend se declaran `pending`: se ven, están deshabilitadas y no
   simulan estar implementadas. */
interface RailTreeItem {
  readonly id: string;
  readonly label: string;
  readonly pending?: boolean;
  readonly target?: ViewId;
  readonly action?: 'add-text';
  readonly badge?: string;
}
interface RailTreeGroup {
  readonly label: string;
  readonly items: readonly RailTreeItem[];
}
const RAIL_TREES: Record<RailView, readonly RailTreeGroup[]> = {
  media: [{ label: 'Medios del proyecto', items: [{ id: 'all', label: 'Todos los medios' }] }],
  audio: [
    {
      label: 'Audio',
      items: [
        { id: 'all', label: 'My File' },
        { id: 'sfx', label: 'Efectos de sonido' },
        { id: 'assets', label: 'Audios del proyecto' },
        { id: 'tts', label: 'Texto a voz', target: 'production' },
        { id: 'audio-ai', label: 'Audio de IA', pending: true },
        { id: 'music-ai', label: 'Música con IA', pending: true },
        { id: 'sfx-ai', label: 'Efecto de sonido con IA', pending: true },
      ],
    },
    { label: 'Mis elementos', items: [{ id: 'downloads', label: 'Descargas', target: 'download' }] },
  ],
  titles: [
    {
      label: 'Añadir texto',
      items: [
        { id: 'add-text', label: 'Añadir texto', action: 'add-text' },
        { id: 'all', label: 'Plantilla de texto' },
        { id: 'subtitles', label: 'Mis subtítulos', target: 'localization' },
      ],
    },
    {
      label: 'Texto con IA',
      items: [
        { id: 'ai-text', label: 'Texto con IA', target: 'ai-hub' },
        { id: 'trending', label: 'Tendencias' },
        { id: 'effects', label: 'Efectos' },
      ],
    },
  ],
  stickers: [
    {
      label: 'Stickers',
      items: [
        { id: 'all', label: 'Todos' },
        { id: 'trending', label: 'Tendencias' },
        { id: 'social', label: 'Redes sociales' },
        { id: 'arrows', label: 'Flechas' },
        { id: 'emojis', label: 'Emoji' },
        { id: 'sticker-ai', label: 'Sticker de IA', pending: true },
        { id: 'premium', label: 'Premium', pending: true },
      ],
    },
    { label: 'Mis elementos', items: [{ id: 'downloads', label: 'Descargas', target: 'download' }] },
  ],
  effects: [
    {
      label: 'Efectos',
      items: [
        { id: 'all', label: 'Efectos de video' },
        { id: 'color', label: 'Color' },
        { id: 'blur', label: 'Desenfoque' },
        { id: 'bw', label: 'Blanco y negro' },
        { id: 'vignette', label: 'Viñeta' },
        { id: 'sharpen', label: 'Nitidez' },
        { id: 'body', label: 'Efectos corporales', pending: true },
        { id: 'audio-fx', label: 'Efectos de audio', pending: true },
        { id: 'plugins', label: 'Complementos', pending: true },
        { id: 'ai', label: 'Efectos de IA', pending: true },
      ],
    },
    { label: 'Mis elementos', items: [{ id: 'downloads', label: 'Descargas', target: 'download' }] },
  ],
  transitions: [
    {
      label: 'Transiciones',
      items: [
        { id: 'all', label: 'Tendencias' },
        { id: 'fade', label: 'Desvanecimiento y disolución' },
        { id: 'slide', label: 'Deslizar' },
        { id: 'zoom', label: 'Zoom', pending: true },
        { id: '3d', label: 'Efectos 3D', pending: true },
        { id: 'premium', label: 'Premium', pending: true },
      ],
    },
    { label: 'Mis elementos', items: [{ id: 'downloads', label: 'Descargas', target: 'download' }] },
  ],
  filters: [
    {
      label: 'Filtros',
      items: [
        { id: 'all', label: 'Básico' },
        { id: 'cinematic', label: 'Cinemático' },
        { id: 'bw', label: 'Blanco y negro' },
        { id: 'vintage', label: 'Retro' },
        { id: 'lifestyle', label: 'Estilo de Vida' },
        { id: 'warm', label: 'Cálidos' },
        { id: 'cool', label: 'Fríos' },
        { id: 'premium', label: 'Premium', pending: true },
      ],
    },
    { label: 'Mis elementos', items: [{ id: 'downloads', label: 'Descargas', target: 'download' }] },
  ],
  adjustments: [
    {
      label: 'Ajustes',
      items: [
        { id: 'all', label: 'Capas de ajuste' },
        { id: 'basic', label: 'Básico' },
        { id: 'color', label: 'Color' },
        { id: 'looks', label: 'Looks rápidos' },
        { id: 'wheels', label: 'Ruedas cromáticas', pending: true },
        { id: 'hdr', label: 'HDR', pending: true },
      ],
    },
  ],
  // Capturas 114–117: árbol «Plantilla» con el grupo «Split Screen». Las
  // entradas de diseño/colección siguen la convención de pendiente de backend.
  templates: [
    {
      label: 'Plantilla',
      items: [
        { id: 'all', label: 'Todas las plantillas' },
        { id: 'variants', label: 'Diseño de variantes', pending: true },
        { id: 'collections', label: 'Selecciones de colección', pending: true },
      ],
    },
    {
      label: 'Split Screen',
      items: [{ id: 'split', label: 'Pantalla dividida' }],
    },
  ],
};

function effectMatchesSetting(preset: (typeof EFFECT_PRESETS)[number], id: string): boolean {
  const s = preset.settings;
  switch (id) {
    case 'color':
      return s.saturation !== undefined || s.hueRotateDeg !== undefined || s.brightness !== undefined;
    case 'blur':
      return (s.blur ?? 0) > 0;
    case 'bw':
      return s.grayscale === true;
    case 'vignette':
      return (s.vignette ?? 0) > 0;
    case 'sharpen':
      return (s.sharpen ?? 0) > 0;
    default:
      return true;
  }
}
function transitionMatchesPreset(preset: (typeof TRANSITION_PRESETS)[number], id: string): boolean {
  if (id === 'fade') return preset.id === 'dissolve' || preset.id.startsWith('fade-');
  if (id === 'slide') return preset.id.startsWith('slide-');
  return true;
}
function lookMatchesPreset(look: (typeof COLOR_LOOKS)[number], id: string): boolean {
  switch (id) {
    case 'cinematic':
      return look.id === 'cinema';
    case 'bw':
      return look.id === 'mono' || look.effects.grayscale === true;
    case 'vintage':
      return look.id === 'vintage' || look.effects.sepia === true;
    case 'lifestyle':
      return look.id === 'warm' || look.id === 'neutral';
    case 'warm':
      return (look.effects.temperature ?? 0) > 0;
    case 'cool':
      return (look.effects.temperature ?? 0) < 0;
    default:
      return true;
  }
}
function templateMatchesPreset(template: (typeof TITLE_TEMPLATES)[number], id: string): boolean {
  if (id === 'trending') return template.animation === 'pop' || template.animation === 'slide-up';
  if (id === 'effects') return template.animation !== 'pop' && template.animation !== 'slide-up';
  return true;
}

/* ── Facetas por módulo (capturas 103–105, 100, 106–111) ─────────────────
   Cada módulo tiene facetas de contenido local y facetas de IA. Las de IA
   muestran el formulario de las referencias con estado local REAL (prompt,
   chips, contador, archivo elegido) pero el botón de generación queda
   deshabilitado: no hay backend de IA de video/audio y no se simula. */
interface RailFacet {
  readonly id: string;
  readonly label: string;
  readonly ai?: boolean;
}
const FACETS: Record<RailView, readonly RailFacet[]> = {
  media: [
    { id: 'files', label: 'Archivos multimedia' },
    { id: 'stock', label: 'Media de stock', ai: true },
    { id: 'image-to-video', label: 'Imagen a video', ai: true },
  ],
  audio: [
    { id: 'files', label: 'Mis archivos' },
    { id: 'sfx', label: 'Efectos de sonido' },
    { id: 'ai', label: 'Audio de IA', ai: true },
  ],
  titles: [
    { id: 'text', label: 'Añadir texto' },
    { id: 'ai', label: 'Texto con IA', ai: true },
    { id: 'subs', label: 'Subtítulos por IA', ai: true },
  ],
  stickers: [
    { id: 'all', label: 'Todos' },
    { id: 'mine', label: 'Mis elementos' },
    { id: 'ai', label: 'Sticker de IA', ai: true },
  ],
  effects: [
    { id: 'all', label: 'Efectos de video' },
    { id: 'plugins', label: 'Complementos' },
    { id: 'ai', label: 'Efectos de IA', ai: true },
  ],
  transitions: [
    { id: 'trending', label: 'Tendencias' },
    { id: 'premium', label: 'Premium' },
    { id: 'downloads', label: 'Descargas' },
  ],
  filters: [
    { id: 'basic', label: 'Básico' },
    { id: 'premium', label: 'Premium' },
    { id: 'downloads', label: 'Descargas' },
  ],
  adjustments: [
    { id: 'all', label: 'Capas de ajuste' },
    { id: 'wheels', label: 'Ruedas cromáticas' },
    { id: 'hdr', label: 'HDR' },
  ],
  templates: [
    { id: 'basic', label: 'BÁSICO' },
    { id: 'split', label: 'Split Screen' },
  ],
};

function AiFacetPanel({ view, facet }: { readonly view: RailView; readonly facet: string }) {
  const [prompt, setPrompt] = useState('');
  const [chip, setChip] = useState('Objeto');
  const [duration, setDuration] = useState('00:05');
  const [file, setFile] = useState<string | null>(null);
  const [tab, setTab] = useState('Imagen a video');
  const isVideo = view === 'media' && facet === 'image-to-video';
  const isAudio = view === 'audio' && facet === 'ai';
  const isTitles = view === 'titles';
  const model = isVideo ? 'Estándar-4.0' : isAudio ? 'Estándar 1.5' : 'Estándar 1.0';
  const modelTag = isVideo ? 'NEW' : isAudio ? 'SALE' : 'IA';
  const tabs = isVideo
    ? ['Imagen a video', 'Referencia a video', 'Edición de elementos de video']
    : isAudio
      ? ['Efecto de sonido', 'Música', 'Texto a voz']
      : isTitles
        ? ['Texto con IA', 'Subtítulos por IA']
        : ['Generación', 'Edición'];
  const chips = isAudio
    ? ['Objeto', 'Abstracto', 'Animal', 'Fondo']
    : ['Realista', 'Cinemático', 'Animado', 'Blanco y negro'];
  return (
    <div className="ai-facet-panel" data-view={view}>
      <div className="ai-facet-tabs" role="tablist" aria-label="Variantes de IA">
        {tabs.map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={tab === item}
            className={tab === item ? 'active' : ''}
            onClick={() => setTab(item)}
          >
            {item}
          </button>
        ))}
      </div>
      <div className="ai-facet-model">
        <span className="ai-facet-model-name">{model}</span>
        <span className="ai-facet-model-tag">{modelTag}</span>
        <span className="ai-facet-model-pending">Requiere backend de IA local</span>
      </div>
      <h4 className="ai-facet-title">
        {isVideo
          ? tab
          : isAudio
            ? 'Generar efectos de sonido de IA'
            : isTitles
              ? 'Escribí con IA'
              : 'Generar contenido con IA'}
      </h4>
      <label className="ai-facet-field">
        <span>Indicación (necesaria)</span>
        <textarea
          value={prompt}
          maxLength={100}
          rows={3}
          placeholder={
            isAudio
              ? 'Describí el efecto de sonido que querés crear…'
              : 'Describí el video que querés generar…'
          }
          onChange={(event) => setPrompt(event.target.value)}
        />
        <span className="ai-facet-counter">{prompt.length}/100</span>
      </label>
      {isVideo ? (
        <label className="ai-facet-dropzone">
          <Icon name="thumbnails" size={18} />
          <span>{file ?? 'Arrastrá o elegí una imagen inicial'}</span>
          <input
            type="file"
            accept="image/*"
            onChange={(event) => setFile(event.target.files?.[0]?.name ?? null)}
          />
        </label>
      ) : null}
      <div className="ai-facet-chips" role="group" aria-label="Estilo">
        {chips.map((item) => (
          <button
            key={item}
            type="button"
            className={chip === item ? 'active' : ''}
            aria-pressed={chip === item}
            onClick={() => setChip(item)}
          >
            {item}
          </button>
        ))}
      </div>
      <label className="ai-facet-duration">
        <span>Duración</span>
        <select value={duration} onChange={(event) => setDuration(event.target.value)}>
          {['00:05', '00:10', '00:15', '00:30'].map((value) => (
            <option key={value} value={value}>{value}</option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="ai-facet-generate"
        disabled
        title="Estructura preparada · requiere integración de backend de IA (pendiente)"
      >
        Generar
      </button>
      <p className="rail-pending-note">
        Formulario de las capturas 103–105. El estado local es real; la
        generación está declarada pendiente y no se simula.
      </p>
    </div>
  );
}

function ModuleTree({
  view,
  active,
  downloads,
  onSelect,
  onNavigate,
  onAddText,
}: {
  readonly view: RailView;
  readonly active: string;
  readonly downloads: number;
  readonly onSelect: (id: string) => void;
  readonly onNavigate: (id: ViewId) => void;
  readonly onAddText: () => void;
}) {
  return (
    <nav className="rail-categories rail-tree" aria-label="Categorías del módulo">
      {RAIL_TREES[view].map((group) => (
        <details key={group.label} className="rail-tree-group" open>
          <summary className="rail-category-group">
            <Icon name="chevron-down" size={11} />
            <span>{group.label}</span>
          </summary>
          <div className="rail-category-items">
            {group.items.map((item) => (
              <button
                key={item.id}
                type="button"
                className={active === item.id ? 'active' : ''}
                disabled={item.pending}
                title={
                  item.pending
                    ? 'Estructura preparada · requiere integración de backend (pendiente)'
                    : item.label
                }
                onClick={() => {
                  if (item.target) {
                    onNavigate(item.target);
                    return;
                  }
                  if (item.action === 'add-text') {
                    onAddText();
                    return;
                  }
                  onSelect(item.id);
                }}
              >
                <span>{item.label}</span>
                {item.id === 'downloads' ? (
                  <span className="rail-category-badge">{downloads}</span>
                ) : null}
                {item.badge ? <span className="rail-category-badge">{item.badge}</span> : null}
                {item.pending ? (
                  <span className="rail-category-badge is-pending">Pendiente</span>
                ) : null}
              </button>
            ))}
          </div>
        </details>
      ))}
    </nav>
  );
}

function kindLabel(kind: Asset['kind']): string {
  switch (kind) {
    case 'video':
      return 'Video';
    case 'image':
      return 'Imagen';
    case 'audio':
      return 'Audio';
    case 'font':
      return 'Fuente';
    case 'text':
      return 'Texto';
  }
}

function kindIcon(kind: Asset['kind']): IconName {
  switch (kind) {
    case 'video':
      return 'film';
    case 'image':
      return 'assets';
    case 'audio':
      return 'audio';
    default:
      return 'script';
  }
}

function durationLabel(asset: Asset, fps: number): string | null {
  const media = 'media' in asset ? asset.media : undefined;
  const frames = media && 'durationFrames' in media ? media.durationFrames : 0;
  if (frames <= 0) return null;
  const seconds = frames / Math.max(1, fps);
  if (seconds >= 60) {
    const minutes = Math.floor(seconds / 60);
    const rest = Math.floor(seconds % 60);
    return `${minutes}:${String(rest).padStart(2, '0')}`;
  }
  return `${seconds.toFixed(1)} s`;
}

function RailAsset({
  asset,
  fps,
  onMount,
}: {
  readonly asset: Asset;
  readonly fps: number;
  readonly onMount: (asset: Asset, narration: boolean) => void;
}) {
  const store = useProjectStore();
  const root = store.state.opened?.root ?? '';
  const thumbnail = useThumbnail(store.service, asset, root || null);
  const canMount =
    asset.status === 'ready' && (asset.kind === 'video' || asset.kind === 'image' || asset.kind === 'audio');
  const label = friendlyAssetLabel(asset.label);
  const duration = durationLabel(asset, fps);
  const status = asset.status === 'ready' ? 'listo' : asset.status;
  const inUse = store.state.project?.timeline.clips.some(
    (clip) => clip.source.type === 'asset' && clip.source.assetId === asset.id,
  );
  const selected =
    store.state.selection.kind === 'asset' && store.state.selection.id === asset.id;

  return (
    <div className={`rail-asset${selected ? ' selected' : ''}`}>
      <div className={`rail-thumb kind-${asset.kind}`}>
        {thumbnail ? (
          <img src={thumbnail} alt="" draggable={false} />
        ) : (
          <span className="rail-thumb-fallback">
            <Icon name={kindIcon(asset.kind)} size={16} />
          </span>
        )}
        <span className="rail-thumb-kind" aria-hidden="true">
          <Icon name={kindIcon(asset.kind)} size={9} />
        </span>
        {duration ? <span className="rail-thumb-time">{duration}</span> : null}
        <button
          type="button"
          className={asset.favorite ? 'rail-fav active' : 'rail-fav'}
          aria-pressed={asset.favorite ?? false}
          aria-label={
            asset.favorite
              ? `Quitar ${label} de favoritos`
              : `Marcar ${label} como favorito`
          }
          title={asset.favorite ? 'Quitar de favoritos' : 'Agregar a favoritos'}
          onClick={(event) => {
            event.stopPropagation();
            store.update((current) => toggleAssetFavorite(current, asset.id));
          }}
        >
          <Icon name="star" size={10} />
        </button>
      </div>
      <div className="rail-info">
        <strong title={asset.label}>
          {label}
          {inUse ? (
            <span
              className="rail-in-use-dot"
              title="En la timeline"
              aria-label="En la timeline"
            />
          ) : null}
        </strong>
        <span>
          {kindLabel(asset.kind)} · {status}
          {asset.bin ? ` · ${asset.bin}` : ''}
        </span>
        {asset.tags?.length ? (
          <span className="rail-tags">
            {asset.tags.slice(0, 3).join(' · ')}
            {asset.tags.length > 3 ? ` +${asset.tags.length - 3}` : ''}
          </span>
        ) : null}
        <div className="rail-actions">
          <button
            type="button"
            className="small"
            disabled={!canMount}
            onClick={() => onMount(asset, false)}
            aria-label={`Montar ${label} en el playhead`}
            title={canMount ? 'Montar en el playhead' : 'Confirmá los derechos en Medios'}
          >
            + Montar
          </button>
          {asset.kind === 'audio' ? (
            <button
              type="button"
              className="small ghost"
              disabled={!canMount}
              onClick={() => onMount(asset, true)}
              aria-label={`Montar ${label} como narración`}
              title="Montar como narración"
            >
              Voz
            </button>
          ) : null}
          <button
            type="button"
            className="small ghost"
            onClick={() => store.setSelection({ kind: 'asset', id: asset.id })}
            aria-label={`Ver detalles de ${label}`}
            title="Ver licencia, procedencia y proxy de este material"
          >
            Detalles
          </button>
        </div>
      </div>
    </div>
  );
}

/** Color representativo de cada filtro, para el swatch de la grilla. */
function lookSwatch(id: string): string {
  switch (id) {
    case 'warm':
      return '#e8a06a';
    case 'cool':
      return '#6aa8e8';
    case 'cinema':
      return '#d4a24c';
    case 'vintage':
      return '#c98f5f';
    case 'mono':
      return '#b9c0c8';
    default:
      return '#9aa5b1';
  }
}

export function EditorAssets({ onNavigate }: { readonly onNavigate: (id: ViewId) => void }) {
  const store = useProjectStore();
  const project = store.state.project;
  const [filter, setFilter] = useState<AssetFilter>('all');
  const [query, setQuery] = useState('');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [activeBin, setActiveBin] = useState<string | null>(null);
  const [mineOpen, setMineOpen] = useState(true);
  const [typesOpen, setTypesOpen] = useState(true);
  const [libraryOpen, setLibraryOpen] = useState(true);
  const [view, setView] = useState<RailView>('media');
  const [splitTemplate, setSplitTemplate] = useState<string | null>(null);
  const [treeFilter, setTreeFilter] = useState('all');
  const [facet, setFacet] = useState('files');
  const [titleText, setTitleText] = useState('Tu título aquí');
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const [stickerCategory, setStickerCategory] = useState<'all' | 'trending' | 'social' | 'arrows' | 'emojis'>('all');
  const [transitionFrames, setTransitionFrames] = useState(12);
  const fps = project ? fpsOf(project) : 30;

  const counts = useMemo(() => {
    const assets = project?.assets ?? [];
    return {
      all: assets.length,
      video: assets.filter((asset) => asset.kind === 'video').length,
      image: assets.filter((asset) => asset.kind === 'image').length,
      audio: assets.filter((asset) => asset.kind === 'audio').length,
    };
  }, [project]);

  const bins = useMemo(() => assetBins(project?.assets ?? []), [project]);

  const visibleAssets = useMemo(
    () =>
      filterAssets(project?.assets ?? [], {
        query,
        kind: view === 'audio' ? 'audio' : filter,
        favoritesOnly,
        bin: activeBin,
      }),
    [activeBin, favoritesOnly, filter, project, query, view],
  );

  const visibleStickers =
    stickerCategory === 'all'
      ? STICKER_LIBRARY
      : STICKER_LIBRARY.filter((item) => item.category === stickerCategory);
  const visibleEffects = useMemo(
    () => EFFECT_PRESETS.filter((preset) => effectMatchesSetting(preset, treeFilter)),
    [treeFilter],
  );
  const visibleTransitions = useMemo(
    () => TRANSITION_PRESETS.filter((preset) => transitionMatchesPreset(preset, treeFilter)),
    [treeFilter],
  );
  const visibleLooks = useMemo(
    () => COLOR_LOOKS.filter((look) => lookMatchesPreset(look, treeFilter)),
    [treeFilter],
  );
  const visibleTemplates = useMemo(
    () => TITLE_TEMPLATES.filter((template) => templateMatchesPreset(template, treeFilter)),
    [treeFilter],
  );

  const selectedClip = useMemo(() => {
    const selection = store.state.selection;
    if (selection.kind !== 'clip' || !project) return null;
    return project.timeline.clips.find((clip) => clip.id === selection.id) ?? null;
  }, [project, store.state.selection]);

  function changeView(next: RailView): void {
    setView(next);
    setTreeFilter('all');
    setFacet(FACETS[next][0]?.id ?? 'files');
    setStickerCategory('all');
  }
  function selectTree(id: string): void {
    setTreeFilter(id);
    if (view === 'stickers' && ['all', 'trending', 'social', 'arrows', 'emojis'].includes(id)) {
      setStickerCategory(id as typeof stickerCategory);
    }
  }
  const treeItems = RAIL_TREES[view].flatMap((group) => group.items);
  const activeTreeLabel = treeItems.find((item) => item.id === treeFilter)?.label ?? 'Todos';
  const pendingTotal = treeItems.filter((item) => item.pending).length;
  const moduleCount =
    view === 'effects' ? visibleEffects.length
      : view === 'transitions' ? visibleTransitions.length
      : view === 'filters' || view === 'adjustments' ? visibleLooks.length
      : view === 'titles' ? visibleTemplates.length
      : view === 'stickers' ? visibleStickers.length
      : view === 'audio' ? SFX_PRESETS.length + counts.audio
      : view === 'templates' ? SPLIT_SCREEN_TEMPLATES.length
      : visibleAssets.length;

  if (!project) return null;

  function mount(asset: Asset, narration: boolean): void {
    const result = store.mutate((current) =>
      addClipFromAsset(current, asset, {
        atFrame: store.getPlayhead(),
        narration,
      }),
    );
    if (result) {
      store.setSelection({ kind: 'clip', id: result.clipId });
      store.setNotice(
        `${friendlyAssetLabel(asset.label)} montado en la pista ${narration ? 'de narración' : 'correspondiente'}.`,
      );
    }
  }

  function addTitle(template: TitleTemplate): void {
    const text = titleText.trim() || template.sample;
    const result = store.mutate((current) =>
      addTitleFromTemplate(current, {
        text,
        startFrame: store.getPlayhead(),
        durationFrames: Math.round(3 * fps),
        template,
      }),
    );
    if (result) {
      store.setSelection({ kind: 'cue', id: result.cueId });
      store.setNotice(`${template.name}: título agregado en el playhead.`);
    }
  }

  function addDefaultText(): void {
    const defaultTemplate: TitleTemplate = {
      id: 'default-text',
      name: 'Texto predeterminado',
      description: 'Texto limpio editable',
      sample: 'Escribí aquí',
      style: {
        fontFamily: 'Segoe UI',
        fontSizePx: 56,
        color: '#ffffff',
        outlineColor: '#000000',
        position: 'center',
        bold: true,
        borderStyle: 'outline',
        shadow: true,
      },
      animation: 'pop',
    };
    addTitle(defaultTemplate);
  }

  function addSticker(sticker: StickerItem): void {
    const template: TitleTemplate = {
      id: `sticker-${sticker.id}`,
      name: sticker.name,
      description: 'Sticker gráfico',
      sample: sticker.emoji,
      style: {
        fontFamily: 'Segoe UI',
        fontSizePx: 64,
        color: sticker.color || '#ffffff',
        outlineColor: '#000000',
        position: 'center',
        bold: true,
        borderStyle: 'outline',
        shadow: true,
      },
      animation: sticker.animation,
    };
    const result = store.mutate((current) =>
      addTitleFromTemplate(current, {
        text: sticker.text,
        startFrame: store.getPlayhead(),
        durationFrames: Math.round(2.5 * fps),
        template,
      }),
    );
    if (result) {
      store.setSelection({ kind: 'cue', id: result.cueId });
      store.setNotice(`Sticker ${sticker.name} agregado en el playhead.`);
    }
  }

  function insertTitleEmoji(emoji: string): void {
    const input = titleInputRef.current;
    const next = insertEmoji(
      titleText,
      emoji,
      input?.selectionStart ?? titleText.length,
      input?.selectionEnd ?? titleText.length,
    );
    setTitleText(next.value);
    window.requestAnimationFrame(() => {
      const current = titleInputRef.current;
      if (!current) return;
      current.focus();
      current.setSelectionRange(next.cursor, next.cursor);
    });
  }

  function applyPreset(label: string, effects: ClipEffects): void {
    if (!selectedClip) {
      store.setNotice('Seleccioná un clip en la timeline para aplicarle esto.');
      return;
    }
    store.update((current) => updateClip(current, selectedClip.id, { effects }));
    store.setNotice(`${label} aplicado al clip seleccionado.`);
  }

  function applyEffect(preset: EffectPreset): void {
    if (!selectedClip) {
      store.setNotice('Seleccioná un clip en la timeline para aplicarle esto.');
      return;
    }
    const currentEffects =
      'effects' in selectedClip ? selectedClip.effects ?? {} : {};
    applyPreset(preset.label, applyEffectPreset(currentEffects, preset));
  }

  function applyTransition(type: ClipTransition['type']): void {
    if (!selectedClip) {
      // Aplicar a todos los cortes si no hay clip individual seleccionado
      const result = store.mutate((current) =>
        applyTransitionToCuts(current, { type, frames: transitionFrames }),
      );
      if (result && result.applied > 0) {
        store.setNotice(`Transición aplicada a ${result.applied} corte(s).`);
      } else {
        store.setNotice('Seleccioná un clip en la timeline para aplicarle la transición.');
      }
      return;
    }
    store.update((current) =>
      updateClip(current, selectedClip.id, {
        transitionIn: { type, frames: transitionFrames },
      }),
    );
    store.setNotice(`Transición aplicada al clip seleccionado (${transitionFrames} frames).`);
  }

  function applyAllTransitions(type: ClipTransition['type']): void {
    const result = store.mutate((current) =>
      applyTransitionToCuts(current, { type, frames: transitionFrames }),
    );
    if (result && result.applied > 0) {
      store.setNotice(`Transición aplicada a ${result.applied} corte(s).`);
    } else {
      store.setNotice('No hay cortes contiguos para aplicar la transición.');
    }
  }

  function addAdjustment(): void {
    const playhead = store.getPlayhead();
    const result = store.mutate((current) => addAdjustmentLayer(current, playhead));
    if (result) {
      store.setSelection({ kind: 'clip', id: result.clipId });
      store.setNotice('Capa de ajuste agregada en el playhead.');
    }
  }

  function templatePreview(template: TitleTemplate) {
    const style = template.style;
    return {
      fontFamily: `"${style.fontFamily}", var(--emoji-font), sans-serif`,
      fontWeight: style.bold ? 800 : 500,
      fontStyle: style.italic ? 'italic' : 'normal',
      color: style.color,
      ...(style.backgroundColor ? { background: style.backgroundColor } : {}),
      WebkitTextStroke:
        style.borderStyle === 'box' ? undefined : `1px ${style.outlineColor}`,
      textShadow: style.shadow ? '0 3px 10px rgba(0, 0, 0, 0.55)' : undefined,
    };
  }

  const filters: ReadonlyArray<{ id: AssetFilter; label: string; count: number }> = [
    { id: 'all', label: 'Todo', count: counts.all },
    { id: 'video', label: 'Video', count: counts.video },
    { id: 'image', label: 'Imagen', count: counts.image },
    { id: 'audio', label: 'Audio', count: counts.audio },
  ];

  const activeView = RAIL_VIEWS.find((item) => item.id === view) ?? RAIL_VIEWS[0]!;
  const isMediaView = view === 'media';

  return (
    <aside className="asset-rail" data-tour="assets" aria-label="Herramientas y biblioteca del editor">
      {/* Pestañas de categoría estilo CapCut */}
      <div className="rail-tabs" role="tablist" aria-label="Herramientas de edición">
        {RAIL_VIEWS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={view === item.id}
              aria-label={item.label}
              className={view === item.id ? 'active' : ''}
              onClick={() => changeView(item.id)}
              title={item.label}
            >
            <Icon name={item.icon} size={15} />
            <span>{item.label}</span>
          </button>
        ))}
      </div>

      {/* Rail de fuentes y categorías: reproduce la columna izquierda de la
          referencia sin inventar pantallas. Cada entrada acciona un filtro
          real (`assetBins`, `filterAssets`, favoritos) o navega a una vista
          que ya existe en `app/navigation.ts`. */}
      <div className="rail-stage">
        {view === 'media' ? (
        <nav className="rail-categories" aria-label="Categorías de la biblioteca">
          <button
            type="button"
            className="rail-category-group"
            aria-expanded={mineOpen}
            onClick={() => setMineOpen((value) => !value)}
          >
            <Icon name="chevron-down" size={11} />
            <span>Mi proyecto</span>
          </button>
          {mineOpen ? (
            <div className="rail-category-items">
              <button
                type="button"
                className={!activeBin && !favoritesOnly && filter === 'all' ? 'active' : ''}
                onClick={() => {
                  setActiveBin(null);
                  setFavoritesOnly(false);
                  setFilter('all');
                }}
              >
                <Icon name="assets" size={12} />
                <span>Todos los medios</span>
              </button>
              <button
                type="button"
                className={favoritesOnly ? 'active' : ''}
                onClick={() => setFavoritesOnly((value) => !value)}
              >
                <Icon name="star" size={12} />
                <span>Favoritos</span>
              </button>
              {bins.map((bin) => (
                <button
                  key={bin}
                  type="button"
                  className={activeBin === bin ? 'active' : ''}
                  title={bin}
                  onClick={() => setActiveBin((current) => (current === bin ? null : bin))}
                >
                  <Icon name="folder" size={12} />
                  <span>{bin}</span>
                </button>
              ))}
            </div>
          ) : null}

          <button
            type="button"
            className="rail-category-group"
            aria-expanded={typesOpen}
            onClick={() => setTypesOpen((value) => !value)}
          >
            <Icon name="chevron-down" size={11} />
            <span>Tipos</span>
          </button>
          {typesOpen ? (
            <div className="rail-category-items">
              {(['video', 'image', 'audio'] as const).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  className={filter === kind && !activeBin && !favoritesOnly ? 'active' : ''}
                  onClick={() => {
                    setActiveBin(null);
                    setFavoritesOnly(false);
                    setFilter((current) => (current === kind ? 'all' : kind));
                  }}
                >
                  <span>{kind === 'video' ? 'Videos' : kind === 'image' ? 'Imágenes' : 'Audio'}</span>
                </button>
              ))}
            </div>
          ) : null}

          <button
            type="button"
            className="rail-category-group"
            aria-expanded={libraryOpen}
            onClick={() => setLibraryOpen((value) => !value)}
          >
            <Icon name="chevron-down" size={11} />
            <span>Biblioteca</span>
          </button>
          {libraryOpen ? (
            <div className="rail-category-items">
              <button type="button" onClick={() => onNavigate('assets')}>
                <span>Archivos</span>
              </button>
              <button type="button" onClick={() => onNavigate('ai-hub')}>
                <span>AI Hub</span>
                <span className="rail-category-badge">IA</span>
              </button>
              <button type="button" onClick={() => onNavigate('download')}>
                <span>Descargas</span>
              </button>
              <button type="button" onClick={() => onNavigate('motion')}>
                <span>Motion</span>
              </button>
              <button type="button" onClick={() => onNavigate('localization')}>
                <span>Subtítulos</span>
              </button>
              <button type="button" onClick={() => onNavigate('learn')}>
                <span>Aprender</span>
              </button>
            </div>
          ) : null}
        </nav>
        ) : (
        <ModuleTree
          view={view}
          active={treeFilter}
          downloads={moduleCount}
          onSelect={selectTree}
          onNavigate={onNavigate}
          onAddText={addDefaultText}
        />
        )}

        <div className="rail-main" data-ai={FACETS[view].find((item) => item.id === facet)?.ai ? 'true' : 'false'}>
      <div className="rail-module-bar">
        <div className="rail-facets" role="tablist" aria-label="Facetas del módulo">
          {FACETS[view].map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={facet === item.id}
              className={facet === item.id ? 'active' : ''}
              onClick={() => setFacet(item.id)}
            >
              {item.label}
              {item.ai ? <span className="rail-facet-badge">IA</span> : null}
            </button>
          ))}
          <button
            type="button"
            className="rail-commercial-toggle"
            disabled
            title="Filtro de licencia comercial · requiere catálogo de stock (pendiente)"
          >
            Comercial
          </button>
        </div>
      {view !== 'media' ? (
        <>
          <div className="rail-chips" role="group" aria-label="Categorías del módulo">
            {treeItems
              .filter((item) => !item.pending && !item.target && item.action !== 'add-text')
              .slice(0, 6)
              .map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={treeFilter === item.id ? 'rail-chip active' : 'rail-chip'}
                  aria-pressed={treeFilter === item.id}
                  onClick={() => selectTree(item.id)}
                >
                  {item.label}
                </button>
              ))}
          </div>
          <div className="rail-section-head">
            <span>{activeTreeLabel}</span>
            <span className="rail-section-count">{moduleCount}</span>
          </div>
          {pendingTotal > 0 ? (
            <p className="rail-pending-note">
              {pendingTotal} funciones de IA / stock preparadas · requieren backend
            </p>
          ) : null}
        </>
      ) : null}
      </div>
      {FACETS[view].find((item) => item.id === facet)?.ai ? (
        <AiFacetPanel view={view} facet={facet} />
      ) : null}
      <div className="rail-head">
        <div>
          <p className="eyebrow">{activeView.label}</p>
          <strong>
            {view === 'media'
              ? project.assets.length
              : view === 'audio'
                ? counts.audio + SFX_PRESETS.length
                : view === 'titles'
                  ? TITLE_TEMPLATES.length + 1
                  : view === 'stickers'
                    ? STICKER_LIBRARY.length
                    : view === 'effects'
                      ? EFFECT_PRESETS.length
                      : view === 'transitions'
                        ? TRANSITION_PRESETS.length
                        : view === 'filters'
                          ? COLOR_LOOKS.length
                          : view === 'templates'
                            ? SPLIT_SCREEN_TEMPLATES.length
                            : 'Ajuste'}
          </strong>
        </div>
        {isMediaView ? (
          <>
            <button type="button" className="small icon-text" onClick={() => onNavigate('assets')}>
              <Icon name="plus" size={12} />
              <span>Importar</span>
            </button>
            <button
              type="button"
              className="small ghost icon-text"
              disabled
              title="Grabación de pantalla/cámara · requiere integración nativa (pendiente)"
            >
              <Icon name="film" size={12} />
              <span>Grabar</span>
            </button>
          </>
        ) : view === 'adjustments' ? (
          <button type="button" className="small primary icon-text" onClick={addAdjustment}>
            <Icon name="plus" size={12} />
            <span>+ Capa</span>
          </button>
        ) : (
          <button type="button" className="small ghost icon-text" onClick={() => onNavigate('learn')}>
            <Icon name="script" size={12} />
            <span>Guía</span>
          </button>
        )}
      </div>

      {/* ─── VISTA: MEDIOS ─── */}
      {view === 'media' ? (
        <>
          <div className="rail-browser">
            <div className="rail-search">
              <Icon name="search" size={13} />
              <input
                type="search"
                value={query}
                placeholder="Buscar medios, etiquetas o bin…"
                aria-label="Buscar medios por nombre, etiqueta o bin"
                onChange={(event) => setQuery(event.target.value)}
              />
              {query ? (
                <button
                  type="button"
                  className="rail-search-clear"
                  aria-label="Limpiar búsqueda"
                  onClick={() => setQuery('')}
                >
                  <Icon name="close" size={11} />
                </button>
              ) : null}
            </div>
            <button
              type="button"
              className={favoritesOnly ? 'rail-fav-filter active' : 'rail-fav-filter'}
              aria-pressed={favoritesOnly}
              title="Mostrar solo favoritos"
              onClick={() => setFavoritesOnly((value) => !value)}
            >
              <Icon name="star" size={11} />
              <span>Favoritos</span>
            </button>
          </div>
          <div className="rail-chips" role="group" aria-label="Filtrar medios por tipo">
            {filters.map((item) => (
              <button
                key={item.id}
                type="button"
                className={filter === item.id ? 'rail-chip active' : 'rail-chip'}
                aria-pressed={filter === item.id}
                onClick={() => setFilter(item.id)}
              >
                {item.label}
                <span className="rail-chip-count">{item.count}</span>
              </button>
            ))}
          </div>
          <div className="rail-section-head">
            <span>{activeBin ?? (favoritesOnly ? 'Favoritos' : 'Todos los medios')}</span>
            <span className="rail-section-count">{visibleAssets.length}</span>
          </div>
          <div className="rail-list">
            {visibleAssets.length === 0 ? (
              <>
              {project.assets.length === 0 ? (
                <div className="rail-empty-import">
                  <button
                    type="button"
                    className="rail-dropzone"
                    onClick={() => onNavigate('assets')}
                  >
                    <Icon name="plus" size={22} />
                    <strong>Importar</strong>
                    <span>Arrastrá videos, imágenes o audio aquí</span>
                    <em>Escanear para importar</em>
                  </button>
                  <button
                    type="button"
                    className="rail-import-project"
                    onClick={() => onNavigate('projects')}
                  >
                    <Icon name="folder" size={14} />
                    <span>Importar proyecto</span>
                  </button>
                </div>
              ) : (
                <p className="empty-inline">Ningún medio coincide con los filtros aplicados.</p>
              )}
              </>
            ) : (
              visibleAssets.map((asset) => (
                <RailAsset key={asset.id} asset={asset} fps={fps} onMount={mount} />
              ))
            )}
          </div>
          <button
            type="button"
            className="ghost small rail-foot"
            onClick={() => onNavigate('assets')}
          >
            Abrir biblioteca completa de medios
          </button>
        </>
      ) : null}

      {/* ─── VISTA: AUDIO (Música & Efectos de sonido SFX) ─── */}
      {view === 'audio' ? (
        <div className="rail-audio-section">
          <p className="rail-view-hint">
            Sonidos y pistas para sincronizar. Podés montar clips de audio directo al playhead o grabar narraciones.
          </p>

          <div className="audio-category-group" hidden={treeFilter === 'assets'}>
            <h5 className="rail-subheading">Efectos de sonido (SFX)</h5>
            <div className="sfx-list">
              {SFX_PRESETS.map((sfx) => (
                <div key={sfx.id} className="sfx-card">
                  <div className="sfx-info">
                    <strong>{sfx.label}</strong>
                    <span>{sfx.duration} · {sfx.description}</span>
                  </div>
                  <button
                    type="button"
                    className="small ghost"
                    onClick={() => {
                      store.setNotice(`Efecto ${sfx.label}: agregalo o grabalo en tu carpeta de audios.`);
                    }}
                  >
                    + Agregar
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="audio-category-group" hidden={treeFilter === 'sfx'}>
            <h5 className="rail-subheading">Audios del proyecto ({counts.audio})</h5>
            <div className="rail-list">
              {visibleAssets.filter((a) => a.kind === 'audio').length === 0 ? (
                <p className="empty-inline">No hay archivos de audio importados en el proyecto.</p>
              ) : (
                visibleAssets
                  .filter((a) => a.kind === 'audio')
                  .map((asset) => <RailAsset key={asset.id} asset={asset} fps={fps} onMount={mount} />)
              )}
            </div>
          </div>
        </div>
      ) : null}

      {/* ─── VISTA: TEXTO & TÍTULOS ─── */}
      {view === 'titles' ? (
        <div className="rail-titles">
          <div className="text-quick-tools">
            <button
              type="button"
              className="primary small icon-text"
              onClick={addDefaultText}
              style={{ width: '100%', marginBottom: '8px' }}
            >
              <Icon name="plus" size={13} />
              <span>+ Agregar texto predeterminado</span>
            </button>
          </div>

          <label className="field rail-title-text">
            <span>Texto personalizado</span>
            <div className="emoji-input-row">
              <input
                ref={titleInputRef}
                type="text"
                className="emoji-capable"
                value={titleText}
                maxLength={120}
                placeholder="Escribí el texto aquí…"
                onChange={(event) => setTitleText(event.target.value)}
              />
              <EmojiPickerButton onPick={insertTitleEmoji} />
            </div>
          </label>
          <p className="fine-print">
            Hacé clic en una plantilla para montarla en el cursor con su estilo y animación.
          </p>
          <div className="title-template-list">
            {visibleTemplates.map((template) => (
              <button
                key={template.id}
                type="button"
                className="title-template-card"
                onClick={() => addTitle(template)}
              >
                <span className="title-template-preview" style={templatePreview(template)}>
                  {template.sample}
                </span>
                <span className="title-template-info">
                  <strong>{template.name}</strong>
                  <em>{template.description}</em>
                </span>
                <span className="title-template-action">+ Agregar</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* ─── VISTA: PLANTILLAS / SPLIT SCREEN (capturas 114–117) ─── */}
      {view === 'templates' ? (
        <div className="rail-presets fm-rail-templates">
          <SplitScreenTemplates
            selectedId={splitTemplate}
            onSelect={(template) => setSplitTemplate(template.id)}
          />
        </div>
      ) : null}

      {/* ─── VISTA: STICKERS & ELEMENTOS ─── */}
      {view === 'stickers' ? (
        <div className="rail-stickers">
          <div className="sticker-filter-pills" role="tablist">
            <button
              type="button"
              className={stickerCategory === 'all' ? 'active' : ''}
              onClick={() => setStickerCategory('all')}
            >
              Todos
            </button>
            <button
              type="button"
              className={stickerCategory === 'trending' ? 'active' : ''}
              onClick={() => setStickerCategory('trending')}
            >
              Trending 🔥
            </button>
            <button
              type="button"
              className={stickerCategory === 'social' ? 'active' : ''}
              onClick={() => setStickerCategory('social')}
            >
              Redes 🔔
            </button>
            <button
              type="button"
              className={stickerCategory === 'arrows' ? 'active' : ''}
              onClick={() => setStickerCategory('arrows')}
            >
              Flechas ➡️
            </button>
            <button
              type="button"
              className={stickerCategory === 'emojis' ? 'active' : ''}
              onClick={() => setStickerCategory('emojis')}
            >
              Emojis 😂
            </button>
          </div>
          <p className="fine-print">
            Insertá stickers animados sobre la timeline en la posición del playhead.
          </p>
          <div className="sticker-grid">
            {visibleStickers.map((sticker) => (
              <button
                key={sticker.id}
                type="button"
                className="sticker-card"
                onClick={() => addSticker(sticker)}
                title={`Agregar sticker ${sticker.name}`}
              >
                <span className="sticker-emoji">{sticker.emoji}</span>
                <span className="sticker-label">{sticker.name}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* ─── VISTA: EFECTOS DE VIDEO ─── */}
      {view === 'effects' ? (
        <div className="rail-presets">
          <p className="rail-view-hint">
            Efectos visuales creativos. Hacé clic para aplicar al clip seleccionado en la timeline.
          </p>
          {!selectedClip ? (
            <p className="empty-inline">
              Seleccioná un clip en la timeline para aplicarle un efecto.
            </p>
          ) : null}
          <div className="preset-grid">
            {visibleEffects.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className="preset-card"
                disabled={!selectedClip}
                onClick={() => applyEffect(preset)}
              >
                <span className="preset-icon">
                  <Icon name="effects" size={15} />
                </span>
                <strong>{preset.label}</strong>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* ─── VISTA: TRANSICIONES ─── */}
      {view === 'transitions' ? (
        <div className="rail-transitions">
          <p className="rail-view-hint">
            Transiciones entre cortes estilo CapCut. Aplicá al clip seleccionado o a todos los cortes contiguos.
          </p>
          <div className="transition-settings-bar">
            <label className="field" style={{ flex: 1 }}>
              <span>Duración ({transitionFrames} frames / {(transitionFrames / fps).toFixed(2)}s)</span>
              <input
                type="range"
                min={4}
                max={48}
                value={transitionFrames}
                onChange={(e) => setTransitionFrames(Number(e.target.value))}
              />
            </label>
          </div>
          <div className="transition-grid">
            {visibleTransitions.map((transition) => (
              <div key={transition.id} className="transition-card">
                <div className="transition-icon-wrap" aria-hidden="true">
                  <span className="transition-symbol">{transition.iconSymbol}</span>
                </div>
                <strong>{transition.label}</strong>
                <p>{transition.description}</p>
                <div className="transition-actions">
                  <button
                    type="button"
                    className="small"
                    disabled={!selectedClip}
                    onClick={() => applyTransition(transition.id)}
                    title={selectedClip ? 'Aplicar al clip seleccionado' : 'Seleccioná un clip'}
                  >
                    Aplicar
                  </button>
                  <button
                    type="button"
                    className="small ghost"
                    onClick={() => applyAllTransitions(transition.id)}
                    title="Aplicar a todos los cortes contiguos"
                  >
                    A todos
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* ─── VISTA: FILTROS DE COLOR ─── */}
      {view === 'filters' ? (
        <div className="rail-presets">
          <p className="rail-view-hint">
            Filtros cinematográficos y looks de color. Se aplican al clip seleccionado con un clic.
          </p>
          {!selectedClip ? (
            <p className="empty-inline">
              Seleccioná un clip en la timeline para aplicarle un filtro.
            </p>
          ) : null}
          <div className="preset-grid">
            {visibleLooks.map((look) => (
              <button
                key={look.id}
                type="button"
                className="preset-card"
                disabled={!selectedClip}
                onClick={() => applyPreset(look.label, look.effects)}
              >
                <span className="preset-swatch" aria-hidden="true">
                  <i style={{ background: lookSwatch(look.id) }} />
                </span>
                <strong>{look.label}</strong>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* ─── VISTA: AJUSTES ─── */}
      {view === 'adjustments' ? (
        <div className="rail-adjustments">
          <p className="rail-view-hint">
            Capas de ajuste globales estilo CapCut. Afectan a todos los clips ubicados debajo en la timeline.
          </p>
          <div className="adjustment-hero">
            <button
              type="button"
              className="primary icon-text"
              onClick={addAdjustment}
              style={{ width: '100%', padding: '10px' }}
            >
              <Icon name="layers" size={16} />
              <span>+ Agregar capa de ajuste en el playhead</span>
            </button>
          </div>
          <div className="adjustment-presets">
            <h5 className="rail-subheading">Looks rápidos para la capa</h5>
            <div className="preset-grid">
              {visibleLooks.map((look) => (
                <button
                  key={look.id}
                  type="button"
                  className="preset-card"
                  disabled={!selectedClip}
                  onClick={() => applyPreset(look.label, look.effects)}
                >
                  <span className="preset-swatch" aria-hidden="true">
                    <i style={{ background: lookSwatch(look.id) }} />
                  </span>
                  <strong>{look.label}</strong>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
      <ProxyToolsPanel />
        </div>
      </div>
    </aside>
  );
}
