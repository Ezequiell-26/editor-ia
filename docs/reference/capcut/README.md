# CapCut — Base de conocimiento para port a Olyvia

> Análisis estático de CapCut 9.4.0.4015 (2026-10-20 y 2026-11-09).
> Describe arquitectura y capacidades — **no copiar código, assets ni
> identidad visual**. Implementaciones en Olyvia son propias.

## Índice

| Doc/archivo | Contenido |
|---|---|
| `README.md` | Este índice |
| `01-arquitectura.md` | Stack: Qt6 QML + CEF + DLLs nativos |
| `02-recursos-modelos.md` | Resources/ (68 dirs) + models/ (220 MB IA) + builtin_skills |
| `feature-flags.txt` | Feature flags extraídos (strings) |
| `feature-strings.txt` | Strings de features del binario |
| `keyframe-types.txt` | Tipos de keyframe del motor |
| `rea-capcut-940-*.json` | Evidencia REA del análisis |
| `rea-videoeditor-pe-*.json` | Intento REA sobre videoeditor.dll (límite 64 MB) |
| `../../CAPCUT-9.4-FEATURE-INVENTORY-2026-10-20.md` | Inventario funcional previo |

## Instalación analizada

`D:\Users\ofici\_Migrado_de_C\AppData\Local\CapCut\Apps\9.4.0.4015`
(junction desde `C:\Users\ofici\AppData\Local\CapCut\Apps`).
Versiones: 8.5, 8.6, 8.9.1, 9.1, 9.2, **9.4.0.4015**.

## Datos duros

- **No es Electron**: UI en **Qt6 Quick/QML** + **CEF** (Chromium
  Embedded Framework) para webviews internas + plugins QML.
- 167 DLLs + ~15 EXEs (CapCut.exe, VECreator, VEHelper, VEDetector,
  tt\\*daemon, ffmpeg.exe propio, hpatchz, crash handlers).
- Motores nativos: `videoeditor.dll` (70 MB — engine de edición),
  `VECreator.dll` (262 MB — creator/pipeline), `cccreator.dll` (158 MB),
  `lens.dll` (88 MB — efectos?), `EffectPlatform.dll`, `audioeffect.dll`.
- `Resources/` = 68 carpetas de features (Chroma, Curves, MixMode,
  mattingBlend, rnnoise, lvop_intelligent_crop, models, tts…).
- `Resources/models/` = ~220 MB de modelos IA (ver `02-recursos-modelos.md`).
- `Resources/DefaultAdjustBundle/` = 39 bundles de ajuste de color
  (brightness, contrast, hsl, saturation, sharpen, temperature, tone,
  vignetting, particle, fade, clear…) cada uno con JS propio.
- `builtin_skills/` = skills del agente IA (highlight, material
  understanding, script, speaker, align_bgm, lvc…).

## Estado del análisis

- `videoeditor.dll` (70 MB) **excede el límite REA de 64 MiB** — el
  inventario se hizo por strings/recursos, no por decompilación.
- Ghidra sobre ese DLL probablemente timeout (CapCut.exe sí analizó).
- Lo legible de verdad: `Resources/**` (JS de bundles, configs, modelos),
  feature strings, QML de Qt5Compat (pero la UI propia está compilada en
  los DLLs — no hay .qml de la app, solo los de Qt).
