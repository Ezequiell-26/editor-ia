# Whiteboard hand sprites

The `hand*-720p.webp` files in this directory are the hand sprites from
**Inkplainer-OS**, used by the "Pizarra blanca" (whiteboard) generator preview
and available to the render pipeline.

- Source: <https://github.com/NadirWeb-App/Inkplainer-OS> (local mirror:
  `inkplainer-ref/images/`)
- License: Apache License 2.0. See the project `LICENSE` at the source
  repository; the license permits redistribution with attribution.
- Files copied: `hand1`–`hand6` at 720p, landscape and `vertical` (portrait)
  variants. Only the 720p set is bundled; 1080p/1440p were left out to keep
  the installer small.
- Sprite geometry (`tipX`/`tipY` anchor points and logical canvas size) is
  mirrored in `src/features/whiteboard/hands.ts`, taken from `index.html`
  (`CUSTOM_HANDS`) of the same project.
