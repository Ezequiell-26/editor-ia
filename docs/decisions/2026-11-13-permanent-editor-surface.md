---
date: 2026-11-13
status: accepted
scope: product-architecture
priority: mandatory
---

# Decisión: Olyvia mantiene un único editor permanente

## Decisión del usuario

Todas las funciones de Olyvia deben utilizarse dentro del mismo editor principal. Activar una herramienta nunca debe sustituir, abandonar, ocultar ni transformar la interfaz de edición. El usuario debe conservar continuamente el contexto visual del proyecto para seguir viendo el video y continuar editándolo mientras trabaja.

Esta decisión expresa el requisito de producto vigente y prevalece sobre cualquier secuencia de implementación anterior que proponga unificar ahora mismo las pantallas. No invalida ni reescribe los resultados históricos documentados.

## Invariantes obligatorios

1. **Un solo editor y un solo proyecto activo.** No crear un editor distinto por herramienta, modo, flujo o motor.
2. **Preview persistente.** El video/monitor principal permanece visible mientras se configura, ejecuta y revisa cualquier función.
3. **Timeline persistente.** La timeline del proyecto actual permanece disponible y conserva clips, pistas, selección, playhead y contexto de edición.
4. **Herramientas dentro del editor.** Tracking, máscaras, dibujo, audio, color, subtítulos, efectos, transiciones, motion, IA, generación, descarga, composición y demás capacidades se invocan desde el editor y actúan sobre el proyecto actual.
5. **Controles integrados.** Los parámetros de la herramienta se muestran en las zonas ya definidas por el diseño del editor (por ejemplo, inspector, biblioteca, toolbar o controles contextuales). No se crea una pantalla/editor alternativo ni se reemplaza el layout.
6. **Edición continua.** Siempre que la función lo permita, el usuario ve su efecto en el preview mientras ajusta parámetros y puede volver inmediatamente a la edición normal sin perder el contexto.
7. **Resultado nativo del proyecto.** Los resultados se aplican al clip/objeto seleccionado o se incorporan como elementos, capas, pistas o clips en la timeline. No quedan aislados en una vista ajena al proyecto.
8. **Estado compartido.** Herramientas y editor respetan el mismo proyecto, selección, playhead, medios, historial, undo/redo, guardado y recuperación. No se mantienen copias divergentes del proyecto.
9. **Sin navegación disruptiva.** Ninguna acción interna de una herramienta puede navegar a otra pantalla, abrir otro workspace de edición ni reemplazar el editor principal. Un diálogo contextual pequeño puede usarse si no sustituye el editor ni oculta permanentemente preview/timeline.
10. **Ninguna pérdida de capacidades.** La integración no autoriza eliminar, simular ni degradar herramientas existentes. Una capacidad no disponible debe indicarse honestamente.

## Ejemplo de comportamiento esperado: tracking

1. El usuario activa Tracking desde el editor.
2. El editor, preview y timeline siguen en el mismo lugar.
3. El usuario selecciona el objeto en el preview.
4. Los ajustes de tracking aparecen en los controles integrados del editor.
5. El seguimiento se previsualiza en ese mismo monitor.
6. Al aplicar, el resultado queda vinculado al clip/proyecto y se puede revisar o deshacer desde la misma timeline.

El mismo patrón se aplica a todas las herramientas, no sólo a Tracking.

## Fases de trabajo vigentes

### Fase actual: terminar el frontend

- Continuar definiendo y construyendo el diseño visual definitivo del editor.
- Mantener el layout, preview, timeline, biblioteca, toolbar e inspector según las decisiones visuales del usuario.
- Conservar las herramientas y sus capacidades existentes.
- Preparar componentes, acciones e identificadores para que puedan integrarse después, sin iniciar ahora una reestructuración funcional masiva.
- No cambiar el diseño aprobado ni introducir una segunda interfaz para anticipar la integración.

### Fase posterior: unificación funcional

Sólo cuando el usuario confirme que el frontend está terminado y aprobado:

- Integrar progresivamente todas las herramientas en el editor permanente.
- Reemplazar rutas/pantallas disruptivas por activación contextual dentro del editor.
- Conectar controles con los motores reales y el estado compartido.
- Garantizar preview y timeline persistentes.
- Conectar resultados con clips/capas/pistas y el historial del proyecto.
- Validar herramienta por herramienta con pruebas funcionales y E2E.

No comenzar esta fase antes de la aprobación explícita del frontend.

## Criterios de aceptación de la futura unificación

- Al activar cualquier herramienta interna, el contenedor principal del editor no se desmonta ni se reemplaza.
- Preview y timeline siguen montados y visibles durante el flujo de la herramienta.
- No hay navegación a otra pantalla/workspace para configurar, ejecutar o revisar la función.
- La herramienta opera sobre el proyecto y selección actuales.
- El resultado se refleja en el preview y/o timeline del mismo proyecto.
- Undo/redo, guardado y recuperación conservan el resultado.
- Las herramientas existentes siguen disponibles; no se sustituyen por mocks.
- Pruebas automatizadas cubren activación, edición, cancelación, aplicación, undo/redo y persistencia.
- La verificación se realiza con evidencia real; no declarar integración completa por mostrar sólo el panel.

## Relación con documentación existente

Este registro es la fuente canónica para la decisión de producto «editor permanente» y para el orden de fases vigente.

- `docs/UNIFICATION-PLAN.md`: plan e historial técnico previo de unificación; conservar como antecedente, no ejecutar fases antiguas ignorando esta decisión.
- `docs/UNIFICACION-TOTAL-PROMPT.md`: análisis/prompt previo; consultar sólo las partes pertinentes.
- `docs/PROMPT-REESTRUCTURACION-FRONTEND.md` y `goals/frontend-sin-duplicados.md`: trabajo estructural/visual del frontend; respetar sus restricciones y el trabajo pendiente.
- `docs/olyvia-blueprint/02_FRONTEND_HY4_SPEC.md` y `09_IMPLEMENTATION_ROADMAP_AND_ACCEPTANCE.md`: especificaciones de frontend y roadmap; aplicar esta decisión como requisito transversal.

No copiar esta decisión completa en otros documentos. Los documentos relacionados deben enlazar a este registro cuando necesiten referenciarla.

## Seguridad de cambios

Antes de cualquier edición de código: revisar rama, `git status` y diff; preservar cambios existentes y trabajo de agentes. No borrar, resetear, limpiar, hacer commit ni push sin autorización. Esta decisión por sí sola no autoriza cambios de código.


## Aclaración vinculante del propietario — ninguna herramienta independiente

La intención del producto queda precisada así: **Olyvia no tendrá herramientas que funcionen como aplicaciones, editores o espacios de trabajo independientes.** Todas las capacidades forman parte del editor principal y operan directamente sobre la sesión y el proyecto activos.

- No habrá un editor de tracking, audio, color, subtítulos, VFX, motion, composición, generación o exportación separado.
- No habrá una segunda preview, timeline, biblioteca, inspector, selección ni historial propios de una herramienta.
- No se abrirán workspaces alternativos ni se navegará fuera del editor para completar una operación de edición.
- Una herramienta puede tener componentes, módulos, servicios o motores internos separados por razones de arquitectura; esa separación técnica nunca debe convertirse en una experiencia independiente ni mantener un estado de proyecto paralelo.
- La herramienta activa sólo aporta sus controles y overlays al editor principal. Sus operaciones leen el contexto compartido y aplican sus resultados al mismo documento, clips, capas o pistas.
- Los procesos largos pueden ejecutarse en background, pero su progreso, cancelación y resultado se gestionan desde la sesión del editor y se incorporan al mismo proyecto.
- Los únicos flujos que pueden existir fuera de la sesión son los estrictamente previos a abrir/crear un proyecto o las preferencias globales de la aplicación; no son editores ni herramientas de edición independientes.

Esta aclaración refuerza los invariantes anteriores y debe ser aplicada por HY4, SWE 2 y cualquier agente que trabaje en Olyvia. Si una propuesta crea una superficie de edición separada, se considera contraria a la decisión del producto y debe rechazarse.
