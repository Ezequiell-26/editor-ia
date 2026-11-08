# 2026-11-08 — Transiciones slide-3d-* (pasada del loop, Devin CLI)

## Qué se hizo

Implementadas `slide-3d-left|right|up|down` de punta a punta: schema Zod +
JSON Schema regenerado, export FFmpeg real, preview congelado, catálogo y
auditoría visual, y UI (Inspector/EditorAssets/Timeline). Es el cierre del
pendiente «slide 3D» del port Kdenlive (`docs/KDENLIVE-REFERENCE.md` §4);
el ledger estaba idle y el ítem salió de la brecha declarada en la matriz.

## Diseño

- Reusa el desplazamiento del overlay de `slide-*` (`slide_axis`
  reconoce ambos grupos) y suma `perspective` con `sense=destination` +
  `eval=frame`: las esquinas del fuente van a un quad comprimido
  simétrico sobre el centro, `extent = 0.15 + 0.85·min(max(in/lead,0),1)`.
- Eje perpendicular al viaje: laterales comprimen X, verticales Y.
- `enable='lt(n,lead_frames)'` apaga el remapeo al terminar el lead.
- Preview: `transitionFrozen {mode:"slide3d",axis,progress,x,y}` →
  `slide3d_frozen_filter` con progreso constante (mismo contrato que
  wipe/dip-color).

## Bug preexistente corregido

`commands/visuals.rs` tenía la whitelist de la auditoría sin `dip-color`
ni `wipe-*`: un proyecto válido con esas transiciones se marcaba
«transición desconocida». Se agregaron junto a los slide-3d.

## Verificación (todo corrido en esta sesión)

- `cargo test -p editor-ia-desktop --lib extra_transitions_change_the_filter_chain` ok
- `cargo test -p editor-ia-desktop --lib window_freezes_fades_and_transition_leads` ok
- `cargo test -p editor-ia-desktop --lib visuals::` 6/6 ok
- Smoke FFmpeg real con la cadena `perspective` exacta emitida: 8 frames ok
- `npx tsc --noEmit -p apps/desktop/tsconfig.json` → 0 errores
- vitest: `EditorAssets` 9/9 (12→16 tarjetas), `Timeline` 20/20,
  `project-actions` 108/108, `visuals`/`motion`/`caption-motion` ok;
  schema `timeline`+`schema-artifacts` 57/57

## Límite honesto

El giro es una aproximación: quad comprimido simétrico sobre el centro,
no una puerta 3D anclada a un borde como en MLT/Kdenlive. Sirve para el
gesto «entra rotando», no para paridad geométrica exacta.

## Siguiente

Luma wipe con clip mate (último gap de transiciones Kdenlive declarado).
