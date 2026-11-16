import { useEffect, useState } from 'react';
import type { Asset, Clip, ClipEffects } from '@editor-ia/project-schema';
import type { EffectStack } from '@editor-ia/effect-kit';
import { AudioEffectStack } from '../AudioEffectStack';
import { InspectorSection as Section } from '../InspectorSection';
import { NumberField } from './fields';
import { useProjectStore } from '../../../state/project-store';

/**
 * Secciones «Reducción de ruido» y «Filtros de voz» del inspector de clip.
 * Extraídas de `Inspector.tsx` sin cambiar comportamiento: el estado de
 * voice-isolation se reinicia al cambiar de clip igual que antes (el efecto
 * del padre corría con deps `[clip.id, clip.kind]`).
 */
export function ClipAudioFxSections({
  clip,
  source,
  audio,
  asset,
  audioStack,
  localFrame,
  fps,
  patchAudio,
  patchEffects,
}: {
  readonly clip: Clip;
  readonly source: Clip['source'];
  readonly audio: NonNullable<Clip['audio']>;
  readonly asset: Asset | undefined;
  readonly audioStack: EffectStack;
  readonly localFrame: number;
  readonly fps: number;
  readonly patchAudio: (patch: Partial<NonNullable<Clip['audio']>>) => void;
  readonly patchEffects: (patch: Partial<ClipEffects>) => void;
}) {
  const store = useProjectStore();
  const [voiceIsoBusy, setVoiceIsoBusy] = useState(false);
  const [voiceIsoInfo, setVoiceIsoInfo] = useState<string | null>(null);
  useEffect(() => {
    setVoiceIsoInfo(null);
    setVoiceIsoBusy(false);
  }, [clip.id, clip.kind]);
  return (
    <>
        <Section title="Reducción de ruido" group="audio" subtab="noise">
          <div className="inspector-grid">
            <NumberField
              label="Reducción de ruido (%)"
              value={Math.round((audio.denoise ?? 0) * 100)}
              min={0}
              max={100}
              step={5}
              onCommit={(value) =>
                patchAudio({ denoise: value > 0 ? value / 100 : undefined })
              }
            />
            <NumberField
              label="Puerta de ruido (dB)"
              value={audio.gateDb ?? -60}
              min={-60}
              max={-10}
              step={1}
              onCommit={(value) => patchAudio({ gateDb: value > -60 ? value : undefined })}
            />
          </div>
          {source.type === 'asset' && (asset?.kind === 'audio' || asset?.kind === 'video') ? (
            <div className="inspector-block">
              <label className="check">
                <input
                  type="checkbox"
                  checked={audio.voiceIsolation?.enabled ?? false}
                  onChange={(event) =>
                    patchAudio({
                      voiceIsolation: event.target.checked
                        ? {
                            enabled: true,
                            model: 'demucs-v4',
                            quality: audio.voiceIsolation?.quality ?? 'medium',
                          }
                        : undefined,
                    })
                  }
                />
                <span>Aislar voz (IA local, Demucs)</span>
              </label>
              <label className="field">
                <span>Calidad del stem</span>
                <select
                  value={audio.voiceIsolation?.quality ?? 'medium'}
                  onChange={(event) =>
                    patchAudio({
                      voiceIsolation: {
                        enabled: audio.voiceIsolation?.enabled ?? false,
                        model: 'demucs-v4',
                        quality: event.target.value as 'low' | 'medium' | 'high' | 'best',
                      },
                    })
                  }
                >
                  <option value="low">Baja (rápida)</option>
                  <option value="medium">Media</option>
                  <option value="high">Alta</option>
                  <option value="best">Máxima</option>
                </select>
              </label>
              <div className="actions compact">
                <button
                  type="button"
                  className="small"
                  disabled={voiceIsoBusy || !asset}
                  onClick={async () => {
                    if (!asset) return;
                    setVoiceIsoBusy(true);
                    setVoiceIsoInfo(null);
                    try {
                      const outcome = await store.service.voiceIsolationPrepare(
                        asset.id,
                        audio.voiceIsolation?.quality ?? 'medium',
                      );
                      patchAudio({
                        voiceIsolation: {
                          enabled: true,
                          model: 'demucs-v4',
                          quality: audio.voiceIsolation?.quality ?? 'medium',
                        },
                      });
                      setVoiceIsoInfo(
                        outcome.cached
                          ? 'Stem de voz reutilizado.'
                          : `Stem listo en ${(outcome.processingTimeMs / 1000).toFixed(1)} s de proceso.`,
                      );
                    } catch (error) {
                      setVoiceIsoInfo(
                        error instanceof Error ? error.message : 'No se pudo aislar la voz.',
                      );
                    } finally {
                      setVoiceIsoBusy(false);
                    }
                  }}
                >
                  {voiceIsoBusy ? 'Aislando voz…' : 'Generar stem de voz'}
                </button>
              </div>
              <p className="fine-print">
                Requiere Python con Demucs; la primera vez descarga el modelo (~2 GB). El audio
                exportado usa sólo la voz; el video no cambia. La preview reproduce el original.
              </p>
              {voiceIsoInfo ? <p className="fine-print">{voiceIsoInfo}</p> : null}
            </div>
          ) : null}
          <p className="fine-print">
            La reducción de ruido usa `afftdn` en el export; la preview la aproxima con
            sustracción espectral (puede variar con el material y, si el motor de audio no
            está disponible, queda seca). No reemplaza un modelo de voice isolation: probá
            el resultado en el MP4 antes de publicar.
          </p>
        </Section>
        <Section title="Filtros de voz" group="audio" subtab="voice">
          <div className="inspector-grid">
            <NumberField
              label="High-pass (Hz)"
              value={audio.highPassHz ?? 0}
              min={0}
              max={2_000}
              step={10}
              onCommit={(value) => patchAudio({ highPassHz: value > 20 ? value : undefined })}
            />
            <NumberField
              label="Low-pass (Hz)"
              value={audio.lowPassHz ?? 0}
              min={0}
              max={20_000}
              step={100}
              onCommit={(value) => patchAudio({ lowPassHz: value > 1_000 ? value : undefined })}
            />
            <NumberField
              label="EQ graves (dB)"
              value={audio.eqLowDb ?? 0}
              min={-12}
              max={12}
              step={0.5}
              onCommit={(value) => patchAudio({ eqLowDb: value })}
            />
            <NumberField
              label="EQ medios (dB)"
              value={audio.eqMidDb ?? 0}
              min={-12}
              max={12}
              step={0.5}
              onCommit={(value) => patchAudio({ eqMidDb: value })}
            />
            <NumberField
              label="EQ agudos (dB)"
              value={audio.eqHighDb ?? 0}
              min={-12}
              max={12}
              step={0.5}
              onCommit={(value) => patchAudio({ eqHighDb: value })}
            />
          </div>
          <label className="field">
            <span>Efecto de voz (render)</span>
            <select
              value={audio.voiceEffect ?? 'none'}
              onChange={(event) =>
                patchAudio({
                  voiceEffect:
                    event.target.value === 'none'
                      ? undefined
                      : (event.target.value as NonNullable<
                          NonNullable<Clip['audio']>['voiceEffect']
                        >),
                })
              }
            >
              <option value="none">Sin efecto</option>
              <option value="deep">Voz grave</option>
              <option value="chipmunk">Voz aguda</option>
              <option value="robot">Robot</option>
              <option value="echo">Eco</option>
              <option value="cave">Cueva</option>
              <option value="radio">Radio / teléfono</option>
            </select>
          </label>
          <p className="fine-print">
            El efecto se aplica en el render con filtros locales (`asetrate`, `aecho`, `vibrato`,
            high/low-pass); la preview lo aproxima con la cadena de efectos de audio (pitcheo
            granular, eco y filtro de radio), no es sample-exacto.
          </p>
          <AudioEffectStack
            stack={audioStack}
            onChange={(next) =>
              patchEffects({ audioStack: [...next] as ClipEffects['audioStack'] })
            }
            clipLabel={asset?.label ?? clip.label}
            keyframeFrame={localFrame}
            frameRate={fps}
            onSeekFrame={(frame) => store.setPlayhead(clip.startFrame + frame)}
          />
          <div className="actions compact">
            <label className="check">
              <input
                type="checkbox"
                checked={audio.compressor ?? false}
                onChange={(event) => patchAudio({ compressor: event.target.checked })}
              />
              <span>Compresor</span>
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={audio.deesser ?? false}
                onChange={(event) => patchAudio({ deesser: event.target.checked })}
              />
              <span>De-esser</span>
            </label>
            <button
              type="button"
              className="small"
              onClick={() =>
                patchAudio({
                  highPassHz: 80,
                  lowPassHz: 16_000,
                  eqLowDb: -2,
                  eqMidDb: 3,
                  eqHighDb: 2,
                  compressor: true,
                  deesser: true,
                  denoise: 0.15,
                })
              }
            >
              Voz clara
            </button>
            <button
              type="button"
              className="small"
              onClick={() =>
                patchAudio({
                  highPassHz: 40,
                  eqLowDb: 2,
                  eqMidDb: 0,
                  eqHighDb: 1,
                  compressor: false,
                  denoise: 0,
                })
              }
            >
              Música
            </button>
          </div>
          <p className="fine-print">
            High-pass, low-pass, EQ, de-esser, puerta y compresor se aplican en el render con
            FFmpeg y la preview los aproxima con filtros Web Audio equivalentes.
          </p>
        </Section>
    </>
  );
}
