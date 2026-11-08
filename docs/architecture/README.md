# Arquitectura de Olyvia / Editor IA

**Estado:** reorganización estructural en curso.
**Base:** a7cff32638e670a1265d74e86e641abc7dc32764.
**Rama de trabajo:** architecture/refactor-foundation.
**Decisión:** arquitectura modular por dominios, sin convertir la aplicación en microservicios.

## Propósito

Este directorio es la fuente de verdad de la arquitectura. Describe qué capa posee cada responsabilidad, qué dependencias están permitidas, cómo migrar módulos grandes y qué evidencia se exige para cerrar una fase.

La reorganización debe conservar el comportamiento visible, el formato de proyecto, los contratos IPC de Tauri, los comandos MCP y la compatibilidad de los proyectos existentes. No se considera una mejora mover archivos si no reduce acoplamiento o clarifica propiedad.

## Stack y unidades de despliegue

- Desktop: Tauri 2, React 19, TypeScript y Vite.
- Backend nativo: Rust 2021 dentro de un solo crate Tauri.
- Motor multimedia: FFmpeg/FFprobe integrados como infraestructura local.
- Paquetes compartidos: project-schema y effect-kit.
- Procesos de apoyo existentes: render-worker, motion-mcp, project-mcp y extensiones.

La aplicación principal sigue siendo un monolito modular local-first. Los procesos auxiliares sólo se separan cuando exista una razón operativa concreta (aislamiento, ciclo de vida o consumo de recursos), no por motivos estéticos.

## Lectura recomendada

1. [Estado actual](./CURRENT-STATE.md): inventario y puntos de concentración.
2. [Estructura objetivo](./TARGET-STRUCTURE.md): destino por capas y dominios.
3. [Reglas de dependencias](./DEPENDENCY-RULES.md): límites que no deben romperse.
4. [Plan por fases](./MIGRATION-ROADMAP.md): orden, entregables y criterios de cierre.
5. [Formato del proyecto](./PROJECT-FORMAT.md): contrato persistente de los proyectos.

## Principios no negociables

1. Una responsabilidad por módulo; una fuente de verdad por contrato.
2. Dominio independiente: reglas de proyecto, timeline y render no conocen React, Tauri, FFmpeg CLI ni proveedores externos.
3. Adaptadores en los bordes: Tauri, filesystem, procesos, FFmpeg y servicios externos implementan puertos.
4. Fachadas compatibles durante la migración: no romper imports públicos por mover una implementación.
5. Sin duplicación de modelos: los documentos persistidos siguen validados por project-schema; los efectos siguen definidos en effect-kit.
6. Sin degradar el arranque: conservar lazy loading, CSS splitting y carga bajo demanda.
7. Sin dependencias nuevas por conveniencia: preferir capacidades ya instaladas y módulos pequeños.
8. Migración vertical y verificable: mover una responsabilidad, ejecutar sus pruebas y continuar.
9. No borrar historial ni trabajo concurrente: no reset, clean, force-push o sobrescritura de cambios ajenos.
10. No declarar terminado sin resultados medidos.

## Decisión arquitectónica principal

Se adopta monolito modular por dominios + puertos/adaptadores en los límites. No se crea un crate Rust por cada carpeta ni se parte el editor en microservicios. El código queda organizado por responsabilidades dentro de los paquetes y procesos existentes.

La arquitectura objetivo está descrita en TARGET-STRUCTURE.md. Las migraciones pendientes están enumeradas en MIGRATION-ROADMAP.md.
