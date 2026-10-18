# Editor IA

Editor IA is a Windows-first, local-first AI-assisted content production editor. It is designed to turn a brief into an editable video project: research and script, media assets, narration, scenes, subtitles, motion graphics, review and export.

## Current status

**Foundation in development.** This repository is being initialized. The product specification and foundation plan are the current source of truth. Not all features described in the vision are implemented yet; renderer and provider capabilities must be reported honestly.

- Product specification: [docs/product/PRODUCT-SPEC.md](docs/product/PRODUCT-SPEC.md)
- Foundation plan: [docs/superpowers/plans/2026-10-18-editor-ia-foundation.md](docs/superpowers/plans/2026-10-18-editor-ia-foundation.md)

## Development prerequisites

- Node.js 22+
- npm 10+
- Rust stable toolchain
- Windows 10/11 for desktop packaging; Linux can be used for frontend checks where Tauri system dependencies are installed.

## Commands

```powershell
npm install
npm run typecheck
npm test
npm run build
npm run verify
npm run tauri:dev
npm run tauri:build
```

Use `npm install` to resolve and install the workspace dependencies. The project will pin the generated package lockfile once it can be generated and checked in a network-enabled, reproducible environment; do not hand-author a fake lockfile.

## Architecture

- `apps/desktop`: React/TypeScript product UI and Tauri/Rust native boundary.
- `apps/render-worker`: isolated worker protocol and renderer capability discovery.
- `packages/project-schema`: canonical versioned editable project document.
- `docs/`: requirements, architecture, development instructions and licensing.

The project format is engine-neutral. Renderers consume a validated project document; they do not own the canonical edit decision.

## Security and licensing

API keys must never be written to project documents, source control or logs. Media provenance and licensing are tracked independently from the application license. Review [SECURITY.md](SECURITY.md) and [docs/licensing/THIRD-PARTY-NOTICES.md](docs/licensing/THIRD-PARTY-NOTICES.md) before packaging third-party resources.
