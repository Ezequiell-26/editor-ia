# Olyvia — Blueprint maestro de producto, interfaz y backend

**Versión:** 1.0  
**Fecha:** 2026-11-08  
**Rama objetivo:** architecture/refactor-foundation  
**Finalidad:** especificación canónica para construir Olyvia separando HY4 (frontend) y SWE 2 (backend y capacidades).

> Este directorio define el producto objetivo y cómo implementarlo. No afirma que todo lo documentado ya esté construido. El estado real se determina con código, pruebas y ejecución de esta rama.

## Lectura obligatoria por agente

| Agente | Leer primero | Alcance |
|---|---|---|
| HY4 | HY4_EXECUTION_BRIEF.md, 02_FRONTEND_HY4_SPEC.md, 01_PRODUCT_VISION.md | Diseño y construcción de React/TypeScript. |
| SWE 2 | SWE2_EXECUTION_BRIEF.md, 03_BACKEND_SWE2_SPEC.md, 04_AUTONOMOUS_STUDIO_MCP_CONTRACT.md | Rust, Tauri IPC, IA, motores, MCP, almacenamiento, workers y pruebas. |
| Ambos | 09_IMPLEMENTATION_ROADMAP_AND_ACCEPTANCE.md y contratos versionados | Integración por contratos. |

## Documentos del blueprint

1. [Visión y requisitos de producto](./01_PRODUCT_VISION.md)
2. [Especificación completa del frontend — HY4](./02_FRONTEND_HY4_SPEC.md)
3. [Especificación backend y capacidades — SWE 2](./03_BACKEND_SWE2_SPEC.md)
4. [Estudio autónomo, estados, operaciones y herramientas MCP](./04_AUTONOMOUS_STUDIO_MCP_CONTRACT.md)
5. [Matriz de capacidades existentes, parciales y faltantes](./05_CAPABILITY_GAP_MATRIX.md)
6. [Proveedores de IA, medios y conectores](./06_PROVIDER_AND_MEDIA_CONNECTORS.md)
7. [Motores, repositorios y política de reutilización](./07_ENGINE_STACK_AND_OPEN_SOURCE_RESEARCH.md)
8. [Seguridad, privacidad, licencias y rendimiento](./08_SECURITY_PRIVACY_PERFORMANCE.md)
9. [Fases de implementación y aceptación](./09_IMPLEMENTATION_ROADMAP_AND_ACCEPTANCE.md)
10. [Fuentes oficiales y política de investigación](./10_SOURCES_AND_RESEARCH_POLICY.md)
11. [Contrato de integración frontend/backend HY4 ↔ SWE 2](./11_FRONTEND_BACKEND_HANDOFF.md)
12. [Catálogo completo de capacidades](./12_COMPLETE_FEATURE_CATALOG.md)
13. [Contrato de entrega final del proyecto](./13_FINAL_PROJECT_DELIVERY_CONTRACT.md)
14. [Protocolo de ejecución y continuidad](./14_AGENT_EXECUTION_PROTOCOL.md)
15. [Actualización técnica 2026-11-08](./15_CURRENT_TECHNICAL_UPDATES_2026-11-08.md)
16. [Matriz de aceptación funcional completa](./16_FEATURE_ACCEPTANCE_MATRIX.md)
17. [Instrucciones ejecutables para HY4](./HY4_EXECUTION_BRIEF.md)
18. [Instrucciones ejecutables para SWE 2](./SWE2_EXECUTION_BRIEF.md)

## División de responsabilidades

**HY4** es responsable de la experiencia de usuario: arquitectura de información, pantallas, componentes, navegación, visualización de estado, accesibilidad, interacción y responsive desktop. Consume contratos existentes o acordados. No implementa motores ni inventa servicios.

**SWE 2** es responsable de las capacidades reales: casos de uso, Rust, Tauri IPC, esquemas, almacenamiento, IA, proveedores, edición, render, calidad, MCP, workers, permisos y pruebas. No sustituye la dirección visual ni crea una segunda interfaz.

**Integración compartida:** contratos tipados, eventos, errores, estados de jobs, resultados y criterios de aceptación. Si una capacidad no tiene backend real, HY4 la presenta como no disponible/en preparación, nunca como funcional.

## Estado del árbol al crear este blueprint

- Worktree: D:\Users\ofici\QODER-WORK\editor-ia-architecture
- Rama observada: architecture/refactor-foundation
- HEAD observado: 4f2e4a4
- Git estaba limpio antes de crear estos documentos.
- El árbol ya contiene una aplicación de escritorio amplia, motor FFmpeg, módulos Rust, paquetes TypeScript, catálogo de funciones y un primer flujo de producción autónoma.
- La suite scripts/verify-studio.mjs había pasado en la revisión anterior: 12 pruebas live y 7 E2E. Volver a ejecutarla antes de afirmar estado actual.
- El comando general npm run verify tuvo un bloqueo TypeScript por junctions de node_modules/@editor-ia/* que apuntan a editor-ia (main), en vez de usar los paquetes de este worktree.
- La documentación define la misión de construcción y entrega; no declara terminadas las funciones que todavía no estén implementadas y verificadas.

## Reglas de verdad

1. El código y las pruebas de esta rama mandan sobre documentos históricos.
2. La matriz docs/CAPABILITY-MATRIX.md y las auditorías docs/APP-FEATURE-AUDIT.md y docs/AUDITORIA-FRONTEND-2026-11-07.md son referencias; sus fechas y métricas deben revalidarse.
3. No borrar, reemplazar o copiar en bloque desde main.
4. No duplicar el schema de proyecto, el motor de efectos, el gestor de claves, el catálogo de proveedores ni las operaciones de timeline.
5. Nada se marca como completo por tener una pantalla, un botón, una interfaz de trait o una respuesta simulada.
6. Los repositorios externos se estudian por capacidad; no se copian sin auditoría de licencia, mantenimiento, seguridad, dependencias y compatibilidad comercial.
7. La aplicación debe seguir siendo un monolito modular local-first. Separar procesos sólo por una razón concreta: aislamiento, vida útil, recursos o estabilidad.

## Estructura visual objetivo

La aplicación debe sentirse como un estudio creativo profesional, no como un panel de administración lleno de módulos inconexos. Debe ofrecer dos caminos dentro del mismo producto:

- **Crear con Olyvia:** el usuario describe el resultado y el estudio IA planifica y ejecuta con supervisión y checkpoints.
- **Editar manualmente:** el usuario conserva el control de timeline, clips, audio, color, efectos, motion y exportación.

El modo autónomo no reemplaza al editor manual. Ambos trabajan sobre el mismo proyecto editable y el mismo motor.

## Historial y documentos anteriores

No se eliminan documentos previos. Cuando una auditoría histórica contradiga el estado actual, se crea una nueva medición con fecha y evidencia; no se reescribe el pasado.