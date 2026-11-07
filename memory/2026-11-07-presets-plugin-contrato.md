# 2026-11-07 · Presets de plugins: contrato y aplicación

Pasada del loop (Devin CLI). Cierra el `[pending]` «Aplicar presets de plugin»
de `docs/IMPROVEMENT-QUEUE.md`.

## Qué quedó

- `apps/desktop/src/state/plugin-presets.ts` (nuevo): contrato de
  `presets.effects` / `exportProfiles` / `captionStyles` del manifiesto.
  - effects = documento `olyvia-effect-template` v1 (reusa
    `parseEffectTemplateValue`, nueva exportación de `effect-templates.ts`).
  - exportProfiles = `RenderProfile` sin `id`; captionStyles = `CaptionStyle`
    sin `id`. Se validan inyectando un uuid de prueba y se descarta.
- Aplicación: plantillas → biblioteca del usuario (`saveEffectTemplate`);
  perfiles → `project.renderProfiles`; estilos → `project.captions.styles`.
  Dedup por nombre (lote + proyecto), id uuid nuevo, proyecto no mutado.
- UI: bloque «Presets» en `PluginsCard` (Ajustes → Extensiones) con un botón
  por grupo; presets de proyecto deshabilitados sin proyecto abierto.
- 10 tests nuevos (`plugin-presets.test.ts`).

## Verificación

- `npx tsc --noEmit -p apps/desktop` → 0 errores.
- vitest dirigido: plugin-presets 10/10, effect-templates 7/7,
  PluginsCard 5/5 (22/22 total). Suite serial no corrida.

## Límites

- Ningún plugin oficial declara presets: el camino está testeado pero no
  ejercitado por una extensión real.
- El preset de efectos importa a la biblioteca de plantillas; aplicarlo al
  clip sigue siendo el flujo existente (con normalización de effectId).
- `commands/plugins.rs` sigue transportando presets como `Value` (JSON
  libre); el contrato vive en TS, donde están los schemas reales (Zod +
  effect-kit). Si algún día Rust necesita validar presets, hay que portar
  el contrato o exponerlo.
