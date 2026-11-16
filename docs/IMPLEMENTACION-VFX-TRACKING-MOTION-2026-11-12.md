# Implementación VFX, tracking y Motion — 2026-11-12

## Alcance de esta pasada

Trabajo sobre la rama existente `architecture/refactor-foundation`. El árbol ya tenía numerosos cambios locales; se preservaron. No se hizo commit, push, reset ni limpieza.

## Tracking de objeto

El módulo previo `apps/desktop/src-tauri/src/commands/domains/media/object_track.rs` ya implementaba tracking de una región seleccionada mediante correlación cruzada normalizada (NCC). No era detección automática por clases.

Mejoras aplicadas:
- Re-adquisición global de búsqueda, sólo cuando la búsqueda local pierde confianza, para intentar recuperar objetos tras desplazamientos bruscos.
- El comando Tauri mueve FFprobe, FFmpeg y el tracking a `spawn_blocking`, sin ejecutar ese trabajo síncrono en el executor async.
- Decodificación en ventanas de cinco segundos; el tracker vuelve a sembrar la región desde la última posición y escala estimada. Esto evita guardar en RAM todos los fotogramas de los 180 segundos permitidos.
- Se conserva el límite de 180 segundos por análisis y la salida de muestras compactas.

Límites:
- Sigue necesitando una región semilla dibujada por el usuario (bounding box de una máscara).
- No es un detector YOLO/ONNX por nombre/clase, ni sigue de forma garantizada un objeto tras una oclusión larga, cambio fuerte de apariencia o pérdida de textura.
- Las máscaras/blur/encuadre que siguen al objeto ya existían en el Inspector y reutilizan las muestras del tracker.

## Máscaras personalizadas

- El dibujo libre, edición de vértices y máscara poligonal ya existían.
- Se agregó feather también al render FFmpeg de máscaras poligonales, calculando distancia firmada a los segmentos del polígono y suavizando la cobertura del borde.
- Se expuso el control Feather (0–1) en el Inspector y se renombró la opción «Polígono (roto)» a «Polígono personalizado».
- Se añadieron pruebas unitarias para feather, inversión y borde duro con feather cero.

## Motion Graphics y stickers

Nueva plantilla Motion `subscribe-bell`:
- CTA editable «SUSCRÍBETE» y texto secundario.
- Colores de botón y campana configurables.
- Capas vectoriales de botón, triángulo, campana y halo.
- Se registra en `MOTION_TEMPLATES` y se exporta desde `plan.ts`; utiliza el motor Motion existente y queda editable, no es un vídeo plano.

Se añadieron 13 elementos originales a `STICKER_LIBRARY`:
- CTAs: Comenta, Guardá este video, Activa la campana, Seguime.
- Indicadores: Link en bio, Deslizá, Nuevo, Oferta.
- Formas vectoriales: corazón, placa, paralelogramo, trapecio y línea.
- Se insertan mediante la ruta existente de stickers Motion/texto/shape en la timeline.

## Catálogos y motores existentes auditados

Antes de esta pasada, Olyvia ya tenía:
- 48 efectos de vídeo en `packages/effect-kit`.
- 32 transiciones.
- 30 efectos de audio.
- 16 plantillas de títulos y 24 plantillas Motion (se añade `subscribe-bell` en esta pasada).
- Efectos de blur, motion blur, bloom, glow, halation, viñeta, light leak y lens flare.

Advertencias de fidelidad:
- El motion blur tiene shader direccional espacial en preview y una exportación FFmpeg marcada como aproximada (`tmix`, que mezcla fotogramas temporales). No se declara equivalencia exacta entre ambas rutas.
- Los catálogos existentes son una base propia; no equivalen a miles de plantillas premium licenciadas. No se importaron recursos propietarios de CapCut.

## Verificación

- `npm run typecheck`: código de salida 0 después de los cambios en tracking, máscaras, Motion y stickers.
- `vitest`: `EditorAssets.test.tsx` 14/14 y `templates-pro.test.ts` 11/11.
- `rustfmt --check`: pasó para los archivos Rust tocados.
- `cargo test --lib object_track` y `cargo check --tests`: intentados, pero el crate de escritorio no terminó la compilación. El compilador quedó inactivo/esperando paginación con sólo ~1,6 GB de RAM física libre; se detuvieron únicamente los procesos de compilación iniciados en esta sesión para no degradar el PC. Los tests Rust de tracking y feather quedan **pendientes**, no aprobados.

## Backups de seguridad

- `memory/backups/object_track.rs.pre-streaming-20261112-0130`
- `memory/backups/masks.rs.pre-polygon-feather-20261112`
- `memory/backups/Inspector.tsx.pre-polygon-feather-20261112`

Los scripts de apoyo usados para las ediciones también quedaron en `memory/backups/` para trazabilidad.
