# 02 — Recursos y modelos de IA de CapCut

## `Resources/models/` (~220 MB) — superficie de IA on-device

| Modelo/recurso | Feature probable |
|---|---|
| `object_tracking`, `single_object_tracking_v1.0.model` | Tracking de objeto único |
| `skeleton_model`, `tt_skeletonsquat_v9.1.model` | Pose/esqueleto (squat = ejercicio?) |
| `headsegmodel`, `skin_seg`, `saliency_seg_model`, `tt_salient_human`, `humanparsingmodel` | Segmentación: cabeza, piel, saliencia, humano parsing |
| `mattingmodel`, `tt_interactive_matting`, `tt_mobilevos` | Matting interactivo (cutout) |
| `tt_facefitting_3d`, `tt_eyefitting`, `facefitting`, `faceverifymodel`, `bingo_facegan_model`, `tt_gendergan` | Cara: fitting 3D, ojos, verificación, gender swap |
| `facebeautifymodel`, `cc_auto_beauty_simo_script` | Belleza automática |
| `petfacemodel` | Rostro de mascota |
| `hairparser` | Cabello (segmentación) |
| `handmodel` | Manos |
| `depthmodel`, `scene_normal_model` | Profundidad, normales de escena |
| `freidmodel` | Reconocimiento de escena (FreID?) |
| `interpolation`, `umvfi` | Interpolación de frames (UMVFI = flujo óptico) |
| `deflicker` | Anti-parpadeo |
| `noise_reduction` | Reducción de ruido |
| `invisible_watermark` | Watermark invisible |
| `jianying_aigc_charge` | Cobro AIGC (JianYing = CapCut China) |
| `jy_compressShotDetect*` | Detección de planos/tomas (shot detect) bytenn |
| `jypc_yunfuhua*` | Modelos "yunfu" NPU/CPU |
| `mangamodel` | "Manga" style transfer? |
| `oilpaintbrush` | Efecto óleo |
| `media_search`, `nh_nodehub_image`, `nh_script`, `nh_*` | Búsqueda de media, node hub |
| `idream` | Generación AIGC (image dream?) |
| `avatar3d`, `avatar_drive` | Avatar 3D, conducción de avatar |
| `colorcard`, `custom_region_v1.0` | Color card, región custom |
| `maskPostProcess.model` | Post-proceso de máscaras |
| `v1-models`, `v2-models` | Versiones de packs de modelos |
| `aec` | Cancelación de eco (audio) |
| `alg_scene_normal` | Normal de escena (relighting) |
| `SegmentJS`, `audiomodel` | Segmentación JS, modelo de audio |
| `smart_relight_preset.webp` | Relighting inteligente presets |
| `smart_relight` (en Resources) | Relighting con IA |

## `builtin_skills/` — agente IA modular

- `jianying.agent.highlight` — resaltar momentos clave
- `jianying.agent.material_understanding` — entender el material
- `jianying.agent.script` — guiones
- `jianying.agent.speaker` — hablantes/diarización
- `jingying.agent.align_bgm_with_video` — alinear música con video
- `jingying.agent.lvc` — LVC (live captions? vertical captions?)

## `DefaultAdjustBundle/` — color grading versionado

39 bundles; cada uno = `Feature.js` + JS por etapa. Versionado por
iteración (`_v1/_v2/_v3`) y backend (`_gles2/_gles3/_npu`). Los nombres
cubren: brillo, contraste, saturación, HSL, temperatura/tinte, tono,
sombras, highlights, nitidez, viñeta, fade, clear (dehaze), particle,
color match, light sensation, black&white, merge_all_adjust_color.

**Patrón replicable**: ajustes de color como "bundles" con JS+shaders
propios por versión — Olyvia podría organizar `effect-kit` igual
(efecto = paquete con params + shader/FFmpeg graph).

## Keyframes (`keyframe-types.txt`, 184 tipos)

Enumeración completa de propiedades animables del motor: Alpha,
AudioPanning, Bloom*, Border*, Background*, más familias
`KFTypeAdjustColorMask*` (expansión, feather, position, rotation,
roundcorner, size) — o sea **máscaras de ajuste de color animables**,
propiedad avanzada que Olyvia debería revisar.

## Feature flags (`feature-flags.txt`, 52)

Flags de downgrade por versión de esquema (proyecto v51→v132):
text_composition, template_keyword, tool_template_video, seg_combination,
feature_cover, voice_change_param, motion_blur, pr_fcp_import,
beauty_all_family_bucket, handwrite_res, video_algorithm, deflicker,
smart_second_tab, text_to_video, article_video_with_emoji,
subvideo_limit, subtrack_transition, tts_auto_update, video_tracking,
3d_text_template, beauty_item, matting_stroke, object_lock…
→ revelan el roadmap de features: motion blur, voice change, deflicker,
text-to-video, video tracking, object lock, beauty, matting stroke.

## Otras strings de features (`feature-strings.txt`, 220)

Extraídas del binario — consultar para nombres de features UI.
