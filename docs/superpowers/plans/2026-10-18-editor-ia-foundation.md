# Editor IA Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a runnable, testable Windows desktop foundation for Editor IA, with a versioned editable-project format, a clear UI shell, a Rust-owned project-file boundary, a renderer-worker contract, and Windows CI/package workflows.

**Architecture:** Use one npm workspace for the React/TypeScript desktop UI, project-schema package, and local render worker, plus one Cargo workspace for the Tauri/Rust desktop backend. The project JSON is engine-neutral; renderer adapters consume validated project data rather than owning the canonical edit. This first plan establishes the application foundation and a small create/open/save project flow; media ingestion, real timeline editing, AI-provider orchestration, subtitles, and production rendering are subsequent independently verifiable plans.

**Tech Stack:** Tauri 2, Rust stable, React, TypeScript strict mode, Vite, npm workspaces, Vitest, Zod, Serde/Serde JSON, Node.js 22+, GitHub Actions on Windows.

**Spec:** `docs/product/PRODUCT-SPEC.md`

## Global Constraints

- Windows desktop is the first supported distribution target.
- The product's core must not require a paid AI provider or paid cloud account.
- Provider APIs, renderer engines, and asset sources must be replaceable through explicit adapters.
- Project files use a versioned JSON schema and do not contain API credentials.
- Filesystem operations happen in Rust after validating the user-selected path; UI text and model output never become shell commands.
- Do not mark a render successful unless the renderer actually writes an output that passes post-render checks.
- Missing external tools must be reported as unavailable with actionable guidance, not represented by fake successes.
- No unbounded retry/agent loop; long operations must eventually expose progress, cancellation or a terminal error.
- Avoid empty placeholder folders: create folders alongside a real contract, implementation or test.
- Preserve source assets by default; no overwrite or destructive cleanup without explicit user intent.
- Record third-party license/provenance obligations before enabling redistribution.
- Remotion is an optional renderer adapter until current licensing and commercial-use requirements are validated.

## Review Focus

1. **Malformed or future project format:** bad JSON, unknown schema version, invalid dimensions or malformed clip timing is rejected with a useful error, not partially loaded. Covered by Tasks 2 and 4.
2. **Filesystem traversal:** asset paths containing `..`, absolute paths or platform-specific prefixes cannot escape a project root. Covered by Task 4.
3. **Missing tools and renderer:** an absent FFmpeg/Remotion runtime is reported as unavailable; the worker never returns a completed-render result without a real output. Covered by Task 5.
4. **Secrets in project/log output:** the project schema has no credential fields and diagnostic messages must not include provider secret values. Provider credential handling is not implemented in this foundation plan; Task 2 pins the schema boundary and provider integration gets a separate security-focused plan.
5. **Windows path and shell differences:** commands work on Windows without Bash-only syntax or arbitrary shell interpolation. Covered by Task 1 and Task 6.

---

### Task 1: Bootstrap the repository workspaces and developer commands

**Files:**
- Create: `.gitignore`
- Create: `.editorconfig`
- Create: `.nvmrc`
- Create: `LICENSE`
- Create: `SECURITY.md`
- Create: `README.md`
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `apps/desktop/package.json`
- Create: `packages/project-schema/package.json`
- Create: `apps/render-worker/package.json`
- Create: `Cargo.toml`
- Create: `rust-toolchain.toml`
- Create: `apps/desktop/src-tauri/Cargo.toml`
- Create: `apps/desktop/src-tauri/src/main.rs` (minimal compilable entry-point stub, later wired to `lib.rs` in Task 4)

**Interfaces:**
- Root npm workspace packages: `@editor-ia/desktop`, `@editor-ia/project-schema`, `@editor-ia/render-worker`.
- Root commands: `npm run dev`, `npm run build`, `npm run typecheck`, `npm run test`, `npm run verify`, `npm run tauri:dev`, `npm run tauri:build`.
- Root Cargo workspace has only `apps/desktop/src-tauri` as its first member.

- [ ] **Step 1: Add package metadata and minimal workspace manifests.** Set Node engine to `>=22`, npm workspaces to the three packages above, Rust toolchain to stable, and all package names to the exact scope above. Add scripts so each command has one clear owner; `verify` invokes typecheck, tests and build without recursive workspace calls.
- [ ] **Step 2: Configure ignore rules and licensing.** Ignore `node_modules`, Rust `target`, Vite build output, generated render cache, logs, local environment files and credentials. Add an MIT license for the new application source, plus `SECURITY.md` stating how to report vulnerabilities and prohibiting credentials in issues. Do not imply that third-party dependencies, stock media or Remotion are automatically covered by this license.
- [ ] **Step 3: Add the initial README.** Link to the product spec, list currently supported commands, mark rendering/AI integration as not yet implemented, and document Node.js 22+, Rust stable and Windows prerequisites.
- [ ] **Step 4: Generate and validate the npm lockfile.**

Run: `npm install --package-lock-only --ignore-scripts`

Expected: a root `package-lock.json` is generated consistently from all workspace manifests.

- [ ] **Step 5: Validate Rust workspace metadata.**

Run: `cargo metadata --no-deps --format-version 1`

Expected: valid JSON with exactly the declared workspace member and no missing manifest errors.

- [ ] **Step 6: Commit the bootstrap.**

Run: `git add .gitignore .editorconfig .nvmrc LICENSE SECURITY.md README.md package.json package-lock.json tsconfig.base.json apps/desktop/package.json packages/project-schema/package.json apps/render-worker/package.json Cargo.toml rust-toolchain.toml apps/desktop/src-tauri/Cargo.toml apps/desktop/src-tauri/src/main.rs && git commit -m "build: bootstrap Editor IA workspaces"`

Expected: one commit containing only the bootstrap configuration and workspace manifests.

### Task 2: Define and test the canonical editable project format

**Files:**
- Create: `packages/project-schema/tsconfig.json`
- Create: `packages/project-schema/src/index.ts`
- Create: `packages/project-schema/src/project.ts`
- Create: `packages/project-schema/src/project.test.ts`
- Create: `packages/project-schema/fixtures/empty-project.editoria.json`

**Interfaces:**
- Export `PROJECT_SCHEMA_VERSION = 1`.
- Export Zod schema `ProjectDocumentSchema` and inferred type `ProjectDocument`.
- Export `createEmptyProject(name: string, now?: string): ProjectDocument`.
- The fixture must parse in TypeScript and later in Rust.
- Timeline timing is frame-based integer data, not floating-point seconds.

- [ ] **Step 1: Write tests first.** In `project.test.ts`, test a valid default project; reject unsupported schema versions, empty names, zero/negative dimensions, invalid frame rates, negative start frames, non-positive clip durations, duplicate IDs, unknown asset references, and credential-like fields. Assert default canvas is 1920×1080 at 30 FPS.
- [ ] **Step 2: Run the test and confirm the intended failure.**

Run: `npm --workspace @editor-ia/project-schema test -- --run`

Expected: FAIL because the schema exports do not exist yet, not because the test environment is broken.

- [ ] **Step 3: Implement the minimum schema.** Define project ID/name/timestamps, dimensions/fps, media assets with relative URI/provenance metadata, ordered tracks, frame-based clips, and scene records. Validate cross-reference invariants after structural Zod parsing. Do not add provider/API keys to the schema.
- [ ] **Step 4: Add the fixture and factory.** `createEmptyProject` returns a project with empty assets/scenes and at least one default video track. Use an injectable timestamp for deterministic tests.
- [ ] **Step 5: Verify.**

Run: `npm --workspace @editor-ia/project-schema test -- --run`

Expected: all project-schema tests PASS.

Run: `npm --workspace @editor-ia/project-schema run typecheck`

Expected: PASS with strict TypeScript checks.

- [ ] **Step 6: Commit the project contract.**

Run: `git add packages/project-schema/tsconfig.json packages/project-schema/src/index.ts packages/project-schema/src/project.ts packages/project-schema/src/project.test.ts packages/project-schema/fixtures/empty-project.editoria.json && git commit -m "feat: define versioned editable project schema"`

Expected: one commit containing the tested v1 project format.

### Task 3: Build the Windows desktop shell and initial product UI

**Files:**
- Create: `apps/desktop/index.html`
- Create: `apps/desktop/vite.config.ts`
- Create: `apps/desktop/tsconfig.json`
- Create: `apps/desktop/src/main.tsx`
- Create: `apps/desktop/src/App.tsx`
- Create: `apps/desktop/src/app/navigation.ts`
- Create: `apps/desktop/src/components/AppShell.tsx`
- Create: `apps/desktop/src/components/Sidebar.tsx`
- Create: `apps/desktop/src/features/projects/ProjectHome.tsx`
- Create: `apps/desktop/src/features/editor/EditorWorkspace.tsx`
- Create: `apps/desktop/src/features/assets/AssetsPanel.tsx`
- Create: `apps/desktop/src/features/settings/SettingsHome.tsx`
- Create: `apps/desktop/src/styles/tokens.css`
- Create: `apps/desktop/src/styles/app.css`
- Create: `apps/desktop/src/App.test.tsx`

**Interfaces:**
- Routes/views: Projects, Editor, Assets, Settings.
- `AppShell` owns navigation only; business logic stays in feature modules/services.
- `EditorWorkspace` has a visibly empty timeline, preview panel and inspector panel. Do not imply that editing/rendering already works.
- Keep the main UI responsive at 1360×768 and scale cleanly for 1280×720.

- [ ] **Step 1: Write the UI smoke test.** Assert the app title, primary navigation labels, project landing view and an explicit empty-state message for the timeline.
- [ ] **Step 2: Run the UI test to confirm RED.**

Run: `npm --workspace @editor-ia/desktop test -- --run`

Expected: FAIL because the shell/components are missing.

- [ ] **Step 3: Create the desktop shell.** Implement the responsive dark editing workspace, sidebar, top-level navigation, project list/empty state, editor preview/timeline placeholder, assets panel, and settings page. Use CSS tokens and accessible button names; avoid fake controls that appear functional but do nothing.
- [ ] **Step 4: Add the Vite/React entry points and test setup.** Configure Vitest with jsdom and React Testing Library. TypeScript strict mode remains enabled.
- [ ] **Step 5: Verify the UI.**

Run: `npm --workspace @editor-ia/desktop test -- --run`

Expected: all UI smoke tests PASS.

Run: `npm --workspace @editor-ia/desktop run build`

Expected: Vite emits production assets into `apps/desktop/dist`.

- [ ] **Step 6: Commit the UI shell.**

Run: `git add apps/desktop/index.html apps/desktop/vite.config.ts apps/desktop/tsconfig.json apps/desktop/src/main.tsx apps/desktop/src/App.tsx apps/desktop/src/app/navigation.ts apps/desktop/src/components/AppShell.tsx apps/desktop/src/components/Sidebar.tsx apps/desktop/src/features/projects/ProjectHome.tsx apps/desktop/src/features/editor/EditorWorkspace.tsx apps/desktop/src/features/assets/AssetsPanel.tsx apps/desktop/src/features/settings/SettingsHome.tsx apps/desktop/src/styles/tokens.css apps/desktop/src/styles/app.css apps/desktop/src/App.test.tsx && git commit -m "feat: add Editor IA desktop workspace shell"`

Expected: one commit containing the smoke-tested UI.

### Task 4: Implement safe Rust project create/open/save commands

**Files:**
- Create: `apps/desktop/src-tauri/build.rs`
- Create: `apps/desktop/src-tauri/tauri.conf.json`
- Create: `apps/desktop/src-tauri/capabilities/default.json`
- Modify: `apps/desktop/src-tauri/src/main.rs` (call the Tauri library entry point)
- Create: `apps/desktop/src-tauri/src/lib.rs`
- Create: `apps/desktop/src-tauri/src/commands/mod.rs`
- Create: `apps/desktop/src-tauri/src/commands/projects.rs`
- Create: `apps/desktop/src-tauri/src/projects/mod.rs`
- Create: `apps/desktop/src-tauri/src/projects/service.rs`
- Create: `apps/desktop/src-tauri/src/projects/storage.rs`
- Create: `apps/desktop/src-tauri/src/projects/tests.rs`

**Interfaces:**
- Tauri commands: `get_app_info() -> AppInfo`, `create_project(path, name) -> ProjectDocument`, `open_project(path) -> ProjectDocument`, `save_project(path, project) -> SaveProjectResult`.
- Backend validation rejects unsupported versions and malformed JSON, validates project before save, writes atomically through a temporary file in the same directory, and avoids silent overwrite during create.
- The frontend invokes commands through a typed service, never through arbitrary filesystem or shell access.

- [ ] **Step 1: Write Rust unit tests first.** Test fixture loading, round-trip save/open, unsupported schema rejection, malformed JSON rejection, refusal to overwrite on create, atomic-save failure behavior and asset path validation for traversal/absolute paths.
- [ ] **Step 2: Run tests to confirm RED.**

Run: `cargo test -p editor-ia-desktop`

Expected: FAIL because project storage implementation is absent; the test harness compiles.

- [ ] **Step 3: Implement project service and storage.** Use Serde structures aligned with the TypeScript schema and validate invariants in Rust before persistence. Limit file size to a documented bound. Treat paths as user-selected filesystem paths, reject relative asset references that escape the project root, and return typed errors safe for UI display.
- [ ] **Step 4: Register Tauri commands and capability permissions.** Expose only the required project commands and app metadata. Configure Tauri's development/build hooks to use the desktop frontend package directory explicitly; verify the hook working directory rather than assuming the CLI's current directory.
- [ ] **Step 5: Verify Rust behavior.**

Run: `cargo test -p editor-ia-desktop`

Expected: all project-storage tests PASS.

Run: `cargo fmt --all -- --check`

Expected: PASS.

- [ ] **Step 6: Commit the project-file boundary.**

Run: `git add apps/desktop/src-tauri/build.rs apps/desktop/src-tauri/tauri.conf.json apps/desktop/src-tauri/capabilities/default.json apps/desktop/src-tauri/src/main.rs apps/desktop/src-tauri/src/lib.rs apps/desktop/src-tauri/src/commands/mod.rs apps/desktop/src-tauri/src/commands/projects.rs apps/desktop/src-tauri/src/projects/mod.rs apps/desktop/src-tauri/src/projects/service.rs apps/desktop/src-tauri/src/projects/storage.rs apps/desktop/src-tauri/src/projects/tests.rs && git commit -m "feat: add safe Rust project persistence"`

Expected: one commit containing the tested persistence commands.

### Task 5: Define the render-worker protocol and truthful capability discovery

**Files:**
- Create: `apps/render-worker/tsconfig.json`
- Create: `apps/render-worker/src/protocol.ts`
- Create: `apps/render-worker/src/capabilities.ts`
- Create: `apps/render-worker/src/index.ts`
- Create: `apps/render-worker/src/protocol.test.ts`

**Interfaces:**
- `RenderRequest`: request ID, schema version, project path, output path and named render profile.
- `RenderResult`: request ID, status (`completed | failed | cancelled | unsupported`), output path only on verified completion, duration and safe error code.
- `getRendererCapabilities(resolveExecutable)` returns availability for FFmpeg and Remotion; it must be testable without requiring either tool to be installed.
- This task does not implement real rendering. The protocol must report missing/unimplemented renderers as unsupported, never as a successful MP4.

- [ ] **Step 1: Write worker protocol tests first.** Validate unknown protocol version, unsafe paths, unknown profiles, missing project file, missing renderer, and the invariant that `completed` requires a post-render file verification result.
- [ ] **Step 2: Run the worker tests to confirm RED.**

Run: `npm --workspace @editor-ia/render-worker test -- --run`

Expected: FAIL because the protocol and capability registry are not implemented.

- [ ] **Step 3: Implement the protocol and capability registry.** Keep the worker contract independent from Remotion/FFmpeg imports; use injected executable discovery and allowlisted profiles. The initial CLI supports `--capabilities` and exits non-zero on malformed requests.
- [ ] **Step 4: Verify.**

Run: `npm --workspace @editor-ia/render-worker test -- --run`

Expected: all worker contract tests PASS.

Run: `npm --workspace @editor-ia/render-worker run build`

Expected: worker CLI compiles.

- [ ] **Step 5: Commit the renderer boundary.**

Run: `git add apps/render-worker/tsconfig.json apps/render-worker/src/protocol.ts apps/render-worker/src/capabilities.ts apps/render-worker/src/index.ts apps/render-worker/src/protocol.test.ts && git commit -m "feat: define safe render worker protocol"`

Expected: one commit containing the worker contract and truthful capability discovery.

### Task 6: Connect project UI to the Rust boundary

**Files:**
- Create: `apps/desktop/src/services/project-service.ts`
- Create: `apps/desktop/src/features/projects/ProjectHome.test.tsx`

**Interfaces:**
- UI calls typed methods `createProject`, `openProject` and `saveProject`.
- In a browser test environment, use a test adapter; in Tauri runtime, call native commands.
- Creation/open/save state is explicit: idle, loading, dirty, saving, saved, failed.
- The UI shows errors without leaking full filesystem paths unnecessarily.

- [ ] **Step 1: Write integration-facing UI tests.** Use a fake typed project service to assert successful create/open/save transitions, validation errors, and failed saves remain dirty instead of showing a false success state.
- [ ] **Step 2: Run the tests to confirm RED.**

Run: `npm --workspace @editor-ia/desktop test -- --run`

Expected: FAIL because the service and project flow are missing.

- [ ] **Step 3: Implement the typed service and initial project flow.** Wire the project landing page to create or open projects, initialize the editor from the returned schema, and allow saving edits to project metadata. Keep file picker integration behind Tauri's dialog capability.
- [ ] **Step 4: Verify.**

Run: `npm --workspace @editor-ia/desktop test -- --run`

Expected: all UI and project-flow tests PASS.

Run: `npm run typecheck`

Expected: PASS across all workspace TypeScript packages.

- [ ] **Step 5: Commit the initial project flow.**

Run: `git add apps/desktop/src/services/project-service.ts apps/desktop/src/features/projects/ProjectHome.test.tsx && git commit -m "feat: connect project home to native storage"`

Expected: one commit containing the tested create/open/save UI flow.

### Task 7: Add CI and Windows packaging gates

**Files:**
- Create: `.github/workflows/verify.yml`
- Create: `.github/workflows/windows-package.yml`
- Create: `scripts/verify.ps1`
- Create: `scripts/package-windows.ps1`
- Modify: `README.md`

**Interfaces:**
- CI checks formatting, TypeScript, schema/worker/UI tests, frontend build and Rust project tests.
- Windows packaging uses a Windows runner, Node.js 22 and stable Rust, then produces an MSI or NSIS bundle if Tauri's configured bundler supports the environment.
- Upload only actual generated installer artifacts; never upload `.env`, keys, caches or source media.

- [ ] **Step 1: Add deterministic verification script.** Run the same root checks locally and in CI; fail on the first unsuccessful command and preserve its exit code.
- [ ] **Step 2: Add GitHub Actions verification.** Pin major action versions, use npm cache and Rust cache, and execute `npm ci`, `npm run verify`, `cargo fmt --all -- --check`, `cargo test -p editor-ia-desktop`.
- [ ] **Step 3: Add Windows packaging workflow.** Build the Tauri app from the configured path and upload the exact existing bundles as an artifact. If packaging fails, preserve the logs and do not report that an installer exists.
- [ ] **Step 4: Verify local scripts and CI definitions.**

Run: `npm run verify`

Expected: PASS with a clean checkout.

Run: `cargo metadata --no-deps --format-version 1`

Expected: PASS.

Run: GitHub Actions `verify.yml` and `windows-package.yml`.

Expected: successful checks and a non-expired Windows installer artifact tied to the exact commit.

- [ ] **Step 5: Commit CI and release automation.**

Run: `git add .github/workflows/verify.yml .github/workflows/windows-package.yml scripts/verify.ps1 scripts/package-windows.ps1 README.md && git commit -m "ci: verify and package Editor IA on Windows"`

Expected: one commit with reproducible CI and an installer artifact workflow.

## Handoff boundary

After these tasks, Editor IA should have a real Windows app shell, a tested versioned project format, safe create/open/save behavior, a truthful renderer capability protocol and repeatable CI/package automation. It is **not yet the full AI video editor**: actual provider integrations, source research, asset downloads, TTS/transcription, a functional timeline, motion compositions and real render-to-MP4 are later plans with their own acceptance criteria.

The next plan should be split into two independent slices:
1. `Media + timeline + real FFmpeg render vertical slice`.
2. `AI provider adapters + script/scene planning and agent orchestration`.

Official reference docs to check during implementation:
- Tauri Vite/React build configuration: https://tauri.app/start/frontend/vite/
- Tauri configuration and hook working-directory options: https://tauri.app/reference/config/
- Tauri CLI build/bundle behavior: https://v2.tauri.app/reference/cli/
- Remotion licensing: https://www.remotion.dev/license
