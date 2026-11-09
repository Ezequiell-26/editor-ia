# 10 — Fuentes oficiales y política de investigación

**Revisión de fuentes:** 2026-11-08. APIs, precios, modelos, términos y licencias cambian; volver a consultar antes de cada integración o release.

## 1. Protocolo para investigar capacidades

SWE 2 debe usar, en este orden:
1. Documentación oficial del provider/API.
2. Repositorio upstream oficial y archivo LICENSE/NOTICE.
3. Changelog/release notes oficiales y avisos de seguridad.
4. Tests, samples y SDK oficial de la versión instalada.
5. Issues/discussions upstream sólo para conocer bugs y limitaciones.
6. Fuentes comunitarias como señal secundaria, nunca prueba única de licencia o soporte.

Para cada integración registrar URL, fecha consultada, versión/tag/commit, API version, modelo, región, licencia, precio/quotas, límites, status de cuenta y prueba real.

## 2. APIs y providers

- OpenAI image generation/editing: https://developers.openai.com/api/docs/guides/image-generation
- OpenAI API docs index: https://developers.openai.com/api/docs
- Google Gemini video: https://ai.google.dev/gemini-api/docs/video
- Google Gemini image generation: https://ai.google.dev/gemini-api/docs/image-generation
- ElevenLabs API: https://elevenlabs.io/api
- ElevenLabs TTS: https://elevenlabs.io/docs/overview/capabilities/text-to-speech
- Runway developer pricing: https://docs.dev.runwayml.com/guides/pricing/

No usar recetas Sora viejas ni endpoints copiados de blogs como base de implementación. Confirmar endpoints y disponibilidad de modelos en docs oficiales actuales y test de cuenta.

## 3. MCP y desktop security

- MCP specification repository: https://github.com/modelcontextprotocol/modelcontextprotocol
- MCP 2026-07-28 specification index: https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/basic/index.mdx
- MCP tools: https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/server/tools.mdx
- MCP authorization: https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/basic/authorization/index.mdx
- MCP release/specification announcement: https://blog.modelcontextprotocol.io/posts/2026-07-28/
- Tauri capabilities: https://v2.tauri.app/security/capabilities/
- Tauri permissions: https://tauri.app/security/permissions/

El protocolo MCP cambia. Usar el SDK y spec versionados por el proyecto, validar auth y transport, y probar tool discovery, schema, errors, cancellation y permission scopes.

## 4. Repos y licencias

- OpenCut: https://github.com/OpenCut-app/Opencut
- OTIO: https://github.com/AcademySoftwareFoundation/OpenTimelineIO
- wgpu: https://github.com/gfx-rs/wgpu
- Motion Canvas: https://github.com/motion-canvas/motion-canvas
- Lottie Web: https://github.com/airbnb/lottie-web
- whisper.cpp: https://github.com/ggml-org/whisper.cpp
- sherpa-onnx: https://github.com/k2-fsa/sherpa-onnx
- DeepFilterNet: https://github.com/Rikorose/DeepFilterNet
- Piper current line: https://github.com/OHF-Voice/piper1-gpl
- FFmpeg legal: https://ffmpeg.org/legal.html
- GStreamer licensing: https://gstreamer.freedesktop.org/documentation/frequently-asked-questions/licensing.html
- Remotion licensing: https://www.remotion.dev/docs/license/pricing
- Kdenlive: https://github.com/KDE/kdenlive
- Shotcut: https://github.com/mltframework/shotcut
- Olive: https://github.com/olive-editor/olive
- OpenShot: https://github.com/OpenShot/openshot-qt

La licencia informada por GitHub/paquete debe confirmarse leyendo los archivos del tag exacto. Revisar transitive deps y contenido adicional. Esta nota no sustituye análisis legal.

## 5. Derechos de medios

- Pexels API: https://www.pexels.com/api/
- Pixabay API: https://pixabay.com/api/docs/
- Wikimedia Commons licensing: https://commons.wikimedia.org/wiki/Commons:Licensing
- Wikimedia Attribution API guidance: https://attribution.wikimedia.org/attribution-signals/license.html
- Internet Archive metadata: https://archive.org/developers/metadata.html

API availability, key issuance, limits, attribution and content license can differ. Check per-asset metadata and the terms current on download date.

## 6. Seguridad y mantenimiento

- NVD: https://nvd.nist.gov/
- CVE Program: https://www.cve.org/
- OSV: https://osv.dev/
- GitHub Security Advisories: https://github.com/advisories
- RustSec Advisory Database: https://rustsec.org/
- npm audit documentation: https://docs.npmjs.com/cli/commands/npm-audit

Maintain an SBOM or dependency/license inventory for every release. Pin and monitor binary versions and update only after regression tests.

## 7. Sources-to-claims policy

Every design/engineering choice that depends on an external fact must link to its current source. Provider models/prices and licensing are time-sensitive; store retrieved date and model/API version in the implementation docs. If official docs disagree with an old internal note, correct the implementation decision and append a dated correction to the historical note rather than silently editing the historical record.

## 8. Important caveat: research vs integration

A repository link or a provider docs page proves that a project/API exists; it does not prove:
- Olyvia has implemented it;
- the user's account can access it;
- it is available in the user's region;
- the model supports requested inputs/outputs;
- the requested use is commercially permitted;
- the output is valid/usable;
- it performs acceptably on the target PC.

The implementation must gather and record that evidence separately.