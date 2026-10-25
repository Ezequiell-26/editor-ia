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
import { filterAssets, type AssetKindFilter } from '../../state/asset-organization';
import {
  EFFECT_PRESETS,
  applyEffectPreset,
  type EffectPreset,
} from '../../state/effect-presets';
import { TITLE_TEMPLATES, type TitleTemplate } from '../../state/title-templates';
import { COLOR_LOOKS } from './Inspector';
import { useProjectStore } from '../../state/project-store';
import { EmojiPickerButton } from '../emoji/EmojiPicker';
import { insertEmoji } from '../emoji/emoji';

type AssetFilter = AssetKindFilter;

export type RailView =
  | 'media'
  | 'audio'
  | 'titles'
  | 'stickers'
  | 'effects'
  | 'transitions'
  | 'filters'
  | 'adjustments';

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

  return (
    <div className="rail-asset">
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
  const [view, setView] = useState<RailView>('media');
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

  const visibleAssets = useMemo(
    () =>
      filterAssets(project?.assets ?? [], {
        query,
        kind: view === 'audio' ? 'audio' : filter,
        favoritesOnly,
      }),
    [favoritesOnly, filter, project, query, view],
  );

  const selectedClip = useMemo(() => {
    const selection = store.state.selection;
    if (selection.kind !== 'clip' || !project) return null;
    return project.timeline.clips.find((clip) => clip.id === selection.id) ?? null;
  }, [project, store.state.selection]);

  if (!project) return null;

  function mount(asset: Asset, narration: boolean): void {
    const result = store.mutate((current) =>
      addClipFromAsset(current, asset, {
        atFrame: store.state.playheadFrame,
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
        startFrame: store.state.playheadFrame,
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
        startFrame: store.state.playheadFrame,
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
    const playhead = store.state.playheadFrame;
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

  const visibleStickers =
    stickerCategory === 'all'
      ? STICKER_LIBRARY
      : STICKER_LIBRARY.filter((item) => item.category === stickerCategory);

  return (
    <aside className="asset-rail" aria-label="Herramientas y biblioteca del editor">
      {/* Pestañas de categoría estilo CapCut */}
      <div className="rail-tabs" role="tablist" aria-label="Herramientas de edición">
        {RAIL_VIEWS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={view === item.id}
            className={view === item.id ? 'active' : ''}
            onClick={() => setView(item.id)}
            title={item.label}
          >
            <Icon name={item.icon} size={15} />
            <span>{item.label}</span>
          </button>
        ))}
      </div>

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
                          : 'Ajuste'}
          </strong>
        </div>
        {isMediaView ? (
          <button type="button" className="small icon-text" onClick={() => onNavigate('assets')}>
            <Icon name="plus" size={12} />
            <span>Importar</span>
          </button>
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
            <select
              className="rail-filter"
              value={filter}
              aria-label="Filtrar medios por tipo"
              onChange={(event) => setFilter(event.target.value as AssetFilter)}
            >
              {filters.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label} · {item.count}
                </option>
              ))}
            </select>
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
          <div className="rail-list">
            {visibleAssets.length === 0 ? (
              <p className="empty-inline">
                {project.assets.length === 0
                  ? 'No hay medios cargados. Hacé clic en Importar para agregar videos o imágenes.'
                  : 'Ningún medio coincide con los filtros aplicados.'}
              </p>
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

          <div className="audio-category-group">
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

          <div className="audio-category-group">
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
            {TITLE_TEMPLATES.map((template) => (
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
            {EFFECT_PRESETS.map((preset) => (
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
            {TRANSITION_PRESETS.map((transition) => (
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
            {COLOR_LOOKS.map((look) => (
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
              {COLOR_LOOKS.map((look) => (
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
    </aside>
  );
}
