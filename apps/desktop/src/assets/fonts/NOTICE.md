# Emoji assets

Olyvia bundles two open emoji fonts for the picker and preview. Apple Color
Emoji is proprietary and is **not** included; on macOS the CSS stack falls back
to the system Apple font when the user selects it.

## Noto Color Emoji (Android style)

- File: `NotoColorEmoji.ttf`
- SHA-256: `2f59a51a426b9f51692a30e8f9f03b6fc6a34aa88437172f93eefa4918c65194`
- Copyright: Google Inc.
- License: SIL Open Font License 1.1. See `licenses/NotoColorEmoji-OFL.txt`.
- Source: Google Noto Emoji project, mirror used for the binary:
  <https://github.com/googlefonts/noto-emoji>

## Twemoji Mozilla (open second style)

- File: `Twemoji.Mozilla.ttf`
- SHA-256: `6d90152ee0d29e82fe2a87793af5aa4b7ad13e6538360889e141e81ed299ee8e`
- Artwork: Twemoji, CC-BY 4.0.
- Font build/code: Mozilla, Apache License 2.0.
- See `licenses/Twemoji-LICENSE.md` for the full notice.
- Source: <https://github.com/mozilla/twemoji-colr/releases/tag/v0.7.0>

## What the renderer can do

The bundled FFmpeg/libass build renders emoji glyphs in monochrome. The web
preview and picker render the colour fonts above. A future raster overlay pass is
required for colour emoji inside the exported MP4; the picker and the export
dialog state this limit.
