import { useEffect, useMemo, useState } from 'react';
import {
  EFFECT_KEYFRAME_PROPERTIES,
  effectValueRange,
  type Clip,
  type ClipEffectKeyframe,
  type ClipEffects,
  type EffectKeyframeProperty,
} from '@editor-ia/project-schema';
import type { VisualCatalog } from '../../services/project-service';
import { effectsToCss } from '../editor/effects-to-css';
import {
  PREVIEW_PROFILES,
  adaptEffectsForPreview,
  setPreviewProfile,
  usePreviewProfile,
} from './preview-profile';
import {
  buildEffectRegistry,
  categoryLabel,
  type EffectStatus,
  type RegisteredEffect,
} from './registry';
import {
  applyEffectValues,
  defaultValues,
  valuesFromClip,
  type EffectValue,
  type EffectValues,
} from './apply';
import {
  loadEffectPreferences,
  pushRecent,
  saveEffectPreferences,
  toggleFavorite,
} from './preferences';
import {
  addUserPreset,
  duplicateUserPreset,
  loadUserPresets,
  removeUserPreset,
  saveUserPresets,
  type UserEffectPreset,
} from './user-presets';

const STATUS_LABEL: Record<EffectStatus, string> = {
  available: 'Preview real',
  'export-only': 'Solo export',
  'requires-file': 'Requiere LUT',
  manual: 'En el Inspector',
};

function stepFor(min: number, max: number, value: number): number {
  if (Number.isInteger(value) && max - min >= 2) return 1;
  return 0.01;
}

function prefersReducedMotion(): boolean {
  try {
    return (
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  } catch {
    return false;
  }
}

export function EffectBrowser({
  catalog,
  disabled,
  currentEffects,
  currentClip,
  playheadFrame,
  onApply,
  onKeyframes,
  onApplyPreset,
  onApplyToTrack,
}: {
  readonly catalog: VisualCatalog;
  readonly disabled: boolean;
  readonly currentEffects?: ClipEffects | undefined;
  readonly currentClip?: Clip | undefined;
  readonly playheadFrame?: number | undefined;
  readonly onApply: (effect: RegisteredEffect, values: EffectValues) => void;
  readonly onKeyframes?: ((keyframes: ClipEffectKeyframe[]) => void) | undefined;
  readonly onApplyPreset?: ((name: string, effects: ClipEffects) => void) | undefined;
  readonly onApplyToTrack?: ((effect: RegisteredEffect, values: EffectValues) => void) | undefined;
}) {
  const registry = useMemo(() => buildEffectRegistry(catalog), [catalog]);
  const [preferences, setPreferences] = useState(loadEffectPreferences);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [values, setValues] = useState<EffectValues>({});
  const [draftKeyframes, setDraftKeyframes] = useState<ClipEffectKeyframe[] | null>(null);
  const [userPresets, setUserPresets] = useState<UserEffectPreset[]>(loadUserPresets);
  const [presetName, setPresetName] = useState('');
  const [thumbHover, setThumbHover] = useState<string | null>(null);
  const [thumbFailed, setThumbFailed] = useState<string[]>([]);
  const reducedMotion = prefersReducedMotion();
  const previewProfile = usePreviewProfile();

  useEffect(() => {
    setDraftKeyframes(null);
  }, [currentClip?.id, openId]);

  const categories = useMemo(
    () => [...new Set(registry.map((effect) => effect.category))],
    [registry],
  );
  const term = query.trim().toLowerCase();
  const filtered = registry.filter((effect) => {
    if (category !== 'all' && effect.category !== category) return false;
    if (!term) return true;
    return `${effect.label} ${effect.description} ${effect.id}`.toLowerCase().includes(term);
  });
  const openEffect = registry.find((effect) => effect.id === openId) ?? null;
  const canApply =
    openEffect !== null &&
    openEffect.parameters.length > 0 &&
    (openEffect.status === 'available' || openEffect.status === 'export-only');
  const animatableKey = openEffect
    ? openEffect.id === 'glow'
      ? 'glowIntensity'
      : openEffect.parameters[0]?.key
    : undefined;
  const animatableProperty =
    animatableKey &&
    (EFFECT_KEYFRAME_PROPERTIES as readonly string[]).includes(animatableKey)
      ? (animatableKey as EffectKeyframeProperty)
      : null;
  const clipKeyframes =
    draftKeyframes ??
    (currentClip && 'effectKeyframes' in currentClip ? (currentClip.effectKeyframes ?? []) : []);
  const propertyKeyframes = animatableProperty
    ? clipKeyframes
        .filter((keyframe) => keyframe.property === animatableProperty)
        .slice()
        .sort((a, b) => a.frame - b.frame)
    : [];
  const canAnimate =
    animatableProperty !== null && currentClip !== undefined && onKeyframes !== undefined;

  function emitKeyframes(next: ClipEffectKeyframe[]): void {
    if (!onKeyframes || !animatableProperty) return;
    const untouched = clipKeyframes.filter(
      (keyframe) => keyframe.property !== animatableProperty,
    );
    const merged = [...untouched, ...next].sort((a, b) => a.frame - b.frame);
    setDraftKeyframes(merged);
    onKeyframes(merged);
  }

  function addKeyframe(): void {
    if (!currentClip || !animatableProperty || !openEffect) return;
    const frame = Math.max(
      0,
      Math.min(
        currentClip.durationFrames - 1,
        (playheadFrame ?? currentClip.startFrame) - currentClip.startFrame,
      ),
    );
    const parameter = openEffect.parameters[0];
    const raw = Number(values[parameter?.key ?? ''] ?? parameter?.default ?? 0);
    if (!Number.isFinite(raw)) return;
    const [min, max] = effectValueRange(animatableProperty);
    const next = propertyKeyframes.filter((keyframe) => keyframe.frame !== frame);
    emitKeyframes([
      ...next,
      {
        frame,
        property: animatableProperty,
        value: Math.min(max, Math.max(min, raw)),
        easing: 'linear',
      },
    ]);
  }

  function updateKeyframe(index: number, patch: Partial<ClipEffectKeyframe>): void {
    emitKeyframes(
      propertyKeyframes.map((keyframe, position) =>
        position === index ? { ...keyframe, ...patch } : keyframe,
      ),
    );
  }

  function removeKeyframe(index: number): void {
    emitKeyframes(propertyKeyframes.filter((_, position) => position !== index));
  }

  function savePreset(): void {
    if (!currentEffects || Object.keys(currentEffects).length === 0) return;
    const next = addUserPreset(userPresets, presetName, currentEffects);
    setUserPresets(next);
    saveUserPresets(next);
    setPresetName('');
  }

  function deletePreset(id: string): void {
    const next = removeUserPreset(userPresets, id);
    setUserPresets(next);
    saveUserPresets(next);
  }

  function duplicatePreset(id: string): void {
    const next = duplicateUserPreset(userPresets, id);
    setUserPresets(next);
    saveUserPresets(next);
  }

  function open(effect: RegisteredEffect): void {
    setOpenId(effect.id);
    setValues(
      currentEffects ? valuesFromClip(currentEffects, effect) : defaultValues(effect),
    );
  }

  function updatePreferences(next: typeof preferences): void {
    setPreferences(next);
    saveEffectPreferences(next);
  }

  function toggle(id: string): void {
    updatePreferences(toggleFavorite(preferences, id));
  }

  function apply(): void {
    if (!openEffect || !canApply) return;
    onApply(openEffect, values);
    updatePreferences(pushRecent(preferences, openEffect.id));
  }

  /** Vuelve a los defaults declarados por el registro, sin inventar valores. */
  function resetValues(): void {
    if (!openEffect) return;
    setValues(defaultValues(openEffect));
  }

  return (
    <section className="card visuals-card effect-browser">
      <div className="visuals-card-head">
        <div>
          <p className="eyebrow">Registro de efectos</p>
          <h3>Efectos profesionales</h3>
        </div>
        <span className="fine-print">
          {registry.length} registrados · preview y export declarados
        </span>
      </div>

      <div className="effect-toolbar">
        <label className="field">
          <span className="sr-only">Buscar efecto</span>
          <input
            type="search"
            aria-label="Buscar efecto"
            placeholder="Buscar por nombre o efecto…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className="effect-categories" role="group" aria-label="Categorías de efectos">
          <button
            type="button"
            className={`chip${category === 'all' ? ' active' : ''}`}
            aria-pressed={category === 'all'}
            onClick={() => setCategory('all')}
          >
            Todos
          </button>
          {categories.map((id) => (
            <button
              key={id}
              type="button"
              className={`chip${category === id ? ' active' : ''}`}
              aria-pressed={category === id}
              onClick={() => setCategory(id)}
            >
              {categoryLabel(id)}
            </button>
          ))}
        </div>
      </div>

      <div className="effect-profiles" role="group" aria-label="Perfil de preview">
        <span className="fine-print">Preview</span>
        {PREVIEW_PROFILES.map((profile) => (
          <button
            key={profile.id}
            type="button"
            className={`chip${previewProfile === profile.id ? ' active' : ''}`}
            aria-pressed={previewProfile === profile.id}
            title={profile.description}
            onClick={() => setPreviewProfile(profile.id)}
          >
            {profile.label}
          </button>
        ))}
      </div>

      {preferences.recent.length > 0 ? (
        <div className="effect-recent">
          <span className="fine-print">Recientes</span>
          {preferences.recent.map((id) => {
            const effect = registry.find((item) => item.id === id);
            if (!effect) return null;
            return (
              <button
                key={id}
                type="button"
                className="chip"
                aria-label={`Reciente: ${effect.label}`}
                onClick={() => open(effect)}
              >
                {effect.label}
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="effect-grid">
        {filtered.map((effect) => {
          const favorite = preferences.favorites.includes(effect.id);
          return (
            <article
              key={effect.id}
              className={`effect-card${openId === effect.id ? ' active' : ''}`}
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData('application/x-olyvia-effect', effect.id);
                event.dataTransfer.effectAllowed = 'copy';
              }}
              onMouseEnter={() => setThumbHover(effect.id)}
              onMouseLeave={() => {
                setThumbHover((current) => (current === effect.id ? null : current));
              }}
              onFocus={() => setThumbHover(effect.id)}
              onBlur={() => {
                setThumbHover((current) => (current === effect.id ? null : current));
              }}
            >
              <div className="effect-swatch-wrap">
                <span
                  className="effect-swatch"
                  aria-hidden="true"
                  style={effectsToCss(
                    adaptEffectsForPreview(
                      applyEffectValues(undefined, effect, defaultValues(effect)),
                      previewProfile,
                    ),
                  )}
                />
                {thumbHover === effect.id && !thumbFailed.includes(effect.id) && !reducedMotion ? (
                  <video
                    className="effect-thumb-preview"
                    src={`/effects/thumbs/${effect.id}.webm`}
                    data-effect-thumb={effect.id}
                    autoPlay
                    loop
                    muted
                    playsInline
                    aria-hidden="true"
                    onError={() => {
                      setThumbFailed((current) =>
                        current.includes(effect.id) ? current : [...current, effect.id],
                      );
                    }}
                  />
                ) : null}
              </div>
              <button type="button" className="effect-open" onClick={() => open(effect)}>
                <strong>{effect.label}</strong>
                <small>{categoryLabel(effect.category)}</small>
                <span>{effect.description}</span>
              </button>
              <div className="effect-card-foot">
                <span className={`effect-status status-${effect.status}`}>
                  {STATUS_LABEL[effect.status]}
                </span>
                <button
                  type="button"
                  className="effect-fav"
                  aria-label={`Favorito ${effect.label}`}
                  aria-pressed={favorite}
                  onClick={() => toggle(effect.id)}
                >
                  {favorite ? '★' : '☆'}
                </button>
              </div>
            </article>
          );
        })}
      </div>
      {filtered.length === 0 ? (
        <p className="fine-print">Ningún efecto coincide con la búsqueda.</p>
      ) : null}

      <div className="effect-user-presets">
        <div className="effect-editor-head">
          <strong>Mis presets</strong>
          <span className="fine-print">{userPresets.length}/20</span>
        </div>
        <div className="effect-preset-save">
          <input
            type="text"
            aria-label="Nombre del preset"
            placeholder="Nombre del look…"
            maxLength={60}
            value={presetName}
            onChange={(event) => setPresetName(event.target.value)}
          />
          <button
            type="button"
            className="ghost"
            onClick={savePreset}
            disabled={
              !currentEffects ||
              Object.keys(currentEffects).length === 0 ||
              !presetName.trim()
            }
          >
            Guardar preset
          </button>
        </div>
        {userPresets.map((preset) => (
          <div className="effect-preset-row" key={preset.id}>
            <span>{preset.name}</span>
            <button
              type="button"
              className="ghost"
              aria-label={`Aplicar ${preset.name}`}
              disabled={disabled}
              onClick={() => onApplyPreset?.(preset.name, preset.effects)}
            >
              Aplicar
            </button>
            <button
              type="button"
              className="ghost"
              aria-label={`Duplicar ${preset.name}`}
              onClick={() => duplicatePreset(preset.id)}
            >
              Duplicar
            </button>
            <button
              type="button"
              className="ghost"
              aria-label={`Eliminar ${preset.name}`}
              onClick={() => deletePreset(preset.id)}
            >
              ×
            </button>
          </div>
        ))}
      </div>

      {openEffect ? (
        <div
          className="effect-editor"
          role="region"
          aria-label={`Parámetros de ${openEffect.label}`}
        >
          <div className="effect-editor-head">
            <strong>{openEffect.label}</strong>
            <span className={`effect-status status-${openEffect.status}`}>
              {STATUS_LABEL[openEffect.status]}
            </span>
          </div>
          {openEffect.parameters.length === 0 ? (
            <p className="fine-print">
              Este efecto se configura en el Inspector del clip; el registro sólo declara sus
              motores y su licencia.
            </p>
          ) : (
            <div className="visuals-sliders">
              {openEffect.parameters.map((parameter) => (
                <label className="visuals-slider" key={parameter.key}>
                  <span>
                    {parameter.label}
                    <output>
                      {Number(values[parameter.key] ?? parameter.default).toFixed(2)}
                    </output>
                  </span>
                  <input
                    type="range"
                    aria-label={parameter.label}
                    min={parameter.min}
                    max={parameter.max}
                    step={stepFor(parameter.min, parameter.max, parameter.default)}
                    value={Number(values[parameter.key] ?? parameter.default)}
                    onChange={(event) =>
                      setValues((current) => ({
                        ...current,
                        [parameter.key]: Number(event.target.value) as EffectValue,
                      }))
                    }
                  />
                </label>
              ))}
            </div>
          )}
          {openEffect.parameters.length > 0 ? (
            <div className="effect-reset-row">
              <button
                type="button"
                className="ghost"
                onClick={resetValues}
                disabled={disabled}
              >
                Restaurar valores
              </button>
            </div>
          ) : null}
          {canAnimate && animatableProperty ? (
            <div
              className="effect-keyframes"
              role="region"
              aria-label={`Keyframes de ${openEffect.label}`}
            >
              <div className="effect-editor-head">
                <strong>Keyframes</strong>
                <button type="button" className="ghost" onClick={addKeyframe}>
                  Agregar keyframe
                </button>
              </div>
              {propertyKeyframes.length === 0 ? (
                <p className="fine-print">
                  Sin keyframes: el valor estático se mantiene en todo el clip.
                </p>
              ) : (
                <div className="effect-keyframe-list">
                  {propertyKeyframes.map((keyframe, index) => {
                    const [min, max] = effectValueRange(animatableProperty);
                    const lastFrame = Math.max(0, (currentClip?.durationFrames ?? 1) - 1);
                    return (
                      <div className="effect-keyframe-row" key={`${keyframe.frame}-${index}`}>
                        <label>
                          <span>Frame</span>
                          <input
                            type="number"
                            aria-label={`Frame ${index + 1}`}
                            min={0}
                            max={lastFrame}
                            value={keyframe.frame}
                            onChange={(event) =>
                              updateKeyframe(index, {
                                frame: Math.max(
                                  0,
                                  Math.min(lastFrame, Number(event.target.value)),
                                ),
                              })
                            }
                          />
                        </label>
                        <label>
                          <span>Valor</span>
                          <input
                            type="number"
                            aria-label={`Valor ${index + 1}`}
                            step={0.01}
                            min={min}
                            max={max}
                            value={keyframe.value}
                            onChange={(event) =>
                              updateKeyframe(index, {
                                value: Math.min(
                                  max,
                                  Math.max(min, Number(event.target.value)),
                                ),
                              })
                            }
                          />
                        </label>
                        <label>
                          <span>Easing</span>
                          <select
                            aria-label={`Easing ${index + 1}`}
                            value={keyframe.bezier ? 'bezier' : (keyframe.easing ?? 'linear')}
                            onChange={(event) => {
                              const easing = event.target.value;
                              updateKeyframe(
                                index,
                                easing === 'bezier'
                                  ? {
                                      easing: 'linear',
                                      bezier: { cp1X: 0.42, cp1Y: 0, cp2X: 0.58, cp2Y: 1 },
                                    }
                                  : {
                                      easing: easing as ClipEffectKeyframe['easing'],
                                      bezier: undefined,
                                    },
                              );
                            }}
                          >
                            <option value="linear">Lineal</option>
                            <option value="ease-in">Ease in</option>
                            <option value="ease-out">Ease out</option>
                            <option value="ease-in-out">Ease in out</option>
                            <option value="hold">Hold</option>
                            <option value="bezier">Bézier</option>
                          </select>
                        </label>
                        {keyframe.bezier ? (
                          <div className="effect-keyframe-bezier">
                            {(['cp1X', 'cp1Y', 'cp2X', 'cp2Y'] as const).map((coordinate) => (
                              <label key={coordinate}>
                                <span>{coordinate}</span>
                                <input
                                  type="number"
                                  aria-label={`${coordinate} ${index + 1}`}
                                  min={0}
                                  max={1}
                                  step={0.01}
                                  value={keyframe.bezier?.[coordinate] ?? 0}
                                  onChange={(event) =>
                                    updateKeyframe(index, {
                                      bezier: {
                                        cp1X: keyframe.bezier?.cp1X ?? 0,
                                        cp1Y: keyframe.bezier?.cp1Y ?? 0,
                                        cp2X: keyframe.bezier?.cp2X ?? 0,
                                        cp2Y: keyframe.bezier?.cp2Y ?? 0,
                                        [coordinate]: Math.min(
                                          1,
                                          Math.max(0, Number(event.target.value)),
                                        ),
                                      },
                                    })
                                  }
                                />
                              </label>
                            ))}
                          </div>
                        ) : null}
                        <button
                          type="button"
                          className="ghost"
                          aria-label={`Quitar keyframe ${index + 1}`}
                          onClick={() => removeKeyframe(index)}
                        >
                          ×
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : null}
          {openEffect.status === 'export-only' ? (
            <p className="fine-print">
              Sólo se aplica en el render final: la preview no simula este efecto.
            </p>
          ) : null}
          {openEffect.status === 'requires-file' ? (
            <p className="fine-print">
              Requiere cargar un archivo .cube desde el Inspector; la preview lo aplica con WebGL2.
            </p>
          ) : null}
          <div className="actions compact">
            <button
              type="button"
              className="ghost"
              onClick={() => setValues(defaultValues(openEffect))}
            >
              Restaurar
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => {
                if (openEffect && canApply) onApplyToTrack?.(openEffect, values);
              }}
              disabled={disabled || !canApply || !onApplyToTrack}
            >
              Aplicar a la pista
            </button>
            <button
              type="button"
              className="primary"
              onClick={apply}
              disabled={disabled || !canApply}
            >
              Aplicar efecto
            </button>
          </div>
          {disabled ? (
            <p className="fine-print">Elegí al menos un clip visual para aplicar.</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
