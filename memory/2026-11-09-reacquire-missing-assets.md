# 2026-11-09 · Re-adquisición dirigida en el repair loop

## Problema

Cuando el quality gate fallaba por `missing-resources` (asset declarado en
el documento pero archivo ausente en disco), el repair loop sólo sabía
clampear rangos de clip: la corrida quedaba `failed` aunque el asset fuera
perfectamente re-descargable (p.ej. se borró `media/acquired/*.mp4`).

## Solución implementada

`application/studio_reacquire.rs` — re-adquisición DIRIGIDA por asset:

- Escanea `project.assets`, detecta los que tienen `source.path` sin
  archivo en disco y provenance de Internet Archive
  (`provider == "internet-archive"` o `sourceUrl` con
  `archive.org/details/{id}`).
- Llama `ResourceAcquisition::acquire` sólo para esos assets — NO
  re-ejecuta la etapa `acquire` completa (que regeneraría voz/música/
  imagen remota y re-gastaría presupuesto BYOK).
- Verifica que el path declarado quedó restaurado antes de contar el
  asset como recuperado.
- NO muta el documento: restaura bytes. Si el derivado difiere del
  original, `integrity.sha256` puede quedar viejo (límite documentado).

`repair_review_failure` (application/production.rs):

- Nuevo parámetro `Option<&dyn ResourceAcquisition>`.
- Si el reporte tiene errores `missing-resources`, corre la
  re-adquisición y RE-EVALÚA el gate antes de las reparaciones
  documentales.
- Gate verde tras re-acquire ⇒ `repair_reset(render+review)` igual que
  una reparación documental (consume un ciclo, tope 2).
- Gate sigue rojo ⇒ flujo anterior intacto (repair doc o failed).

`state.rs`: inyecta `InternetArchiveAcquisition::new().ok()` — si no hay
red/cliente, pasa `None` y el comportamiento previo se conserva.

## Alcance honesto

Sólo Internet Archive (fuente gratuita e idempotente del pipeline).
Quedan fuera: user-imported (no hay fuente), generated-locally
(requeriría re-ejecutar el generador — posible fase futura), generated-remote
(re-gastaría BYOK — decisión de presupuesto del usuario, no automática).

## Evidencia

- `cargo check --tests`: 0 errores · `cargo fmt --check`: limpio
- `production::` 13/13 · `studio::` 81/81 (incluye 3 tests nuevos de
  studio_reacquire + 2 de production para el ciclo reacquire→reset)
- Tests cubren: recuperación OK, skips user-imported/remote, archivo
  existente no se toca, sin adquisición → failed honesto.
