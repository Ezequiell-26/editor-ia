# 2026-11-13 — Oleada 9: clippy 0, SBOM/AGENTS/dep-rules, checkout limpio, ADR vendor, split ronda 2

## Resultados

1. **Clippy 59→0** (`2d8f9b67`): todos los warnings resueltos; 2
   refactors reales (SequenceSpec lottie, NativeRunSpec transcribe);
   32 allows justificados por sitio. **Gate endurecido**: verify.yml
   ahora `cargo clippy -- -D warnings`. 613 tests módulos tocados.

2. **F10/F11** (`7da3f42a`): AGENTS.md raíz; dependency-rules.test.mjs
   (7 checks: platform/shared purity, packages sin React/tauri, sin
   export *, application/ports sin std::process::Command); SBOM
   CycloneDX en release.yml (cargo-cyclonedx app+worker + cdxgen npm →
   artifact y GitHub Release; no ejecutado localmente aún).

3. **F12 checkout limpio** (`5b3daece`): worktree real con npm ci —
   HEAD commiteado NO estaba verde: arch-rules fallaba en
   commands/studio/production.rs + 3 vitest. **Yo reparé la violación**:
   production.rs ahora usa state.provider_*/production_driver_*
   (nuevos métodos en AppState), excepción stale removida del test.
   OJO al commitear: WIP agrega `prores` a VideoCodecSchema y el
   ExportDialog commiteado no lo tolera — verificar integración.
   Reporte: docs/verification/2026-11-13-f12-clean-checkout.md.

4. **ADR vendor scope** (`6689a223`):
   docs/decisions/2026-11-13-concat-vendor-scope.md — decisión: quitar
   concat-render/text/log del Cargo.toml app (~150-190 crates, wgpu);
   local_sfx (generate-sfx.mjs existe, 8 WAV propios) + Graphic en
   titlecard/pattern; video/audio/animation permanently unsupported.

5. **project-actions ronda 2** (`365c7309`): keyframe-actions.ts
   (keyframes mask/transform/gain + velocidad/speed curve). 4704→3797.

## Pendientes

- Quitar 3 deps vendor + mover tests seam al workspace vendor.
- Implementar local_sfx ContentGenerator + Graphic capabilities.
- project-actions sigue en 3797 líneas (escenas ~250 candidatas).
- Checkout limpio post-commit (cuando se commitee el WIP).
- Install smoke real del bundle.
- ADR-0005 caduca 2026-12-11.
- Commit/push: autorización pendiente (~740 archivos WIP).
