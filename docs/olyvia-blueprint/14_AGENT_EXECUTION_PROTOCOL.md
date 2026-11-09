# 14 — Protocolo de ejecución hasta terminar, reanudar y entregar

## 1. Orden directa a los agentes

No respondas con un plan como si fuera el resultado. Primero diseña el plan interno, después ejecuta la implementación y pruebas en el repositorio. Sigue trabajando por fases hasta cerrar todas las tareas alcanzables y entregar el proyecto final del documento 13.

No te detengas después de:
- crear archivos de diseño;
- enumerar los faltantes;
- construir una UI estática;
- agregar interfaces/traits sin adapter;
- registrar commands sin call site;
- integrar un SDK sin conectar el flujo;
- conseguir un archivo de render sin verificarlo;
- pasar sólo una prueba parcial.

## 2. Ownership del trabajo

### HY4
- Dueño exclusivo de apps/desktop/src/** y recursos visuales UI.
- Diseña, implementa, integra servicios, estados y navegación frontend.
- No altera Rust, schemas, provider code, workers, Tauri backend ni build scripts.
- Informa contratos faltantes a SWE 2 en 11_FRONTEND_BACKEND_HANDOFF.md.

### SWE 2
- Dueño del backend Rust/Tauri, project-schema, effect-kit, providers, workers, MCP, engine adapters, permissions, build, tests, packaging y server integrations.
- No hace rediseño visual de React/CSS ni reemplaza las decisiones de layout de HY4.
- Puede agregar los DTOs/IPC de los que HY4 depende; documenta cada contrato antes del consumo.

### Coordinación
- No cambiar carpetas propiedad del otro agente.
- Antes de modificar contratos compartidos, abrir/actualizar la nota de handoff y fixtures.
- Evitar dos agentes trabajando simultáneamente sobre el mismo archivo.
- Mantener un registro de archivos/áreas reservadas por agente y de cambios concurrentes.
- Compartir un único project schema y una única fuente de verdad del comportamiento.

## 3. Regla de continuidad

Cada agente mantiene un solo documento de estado persistente:
- docs/olyvia-blueprint/agent-status/HY4-STATUS.md;
- docs/olyvia-blueprint/agent-status/SWE2-STATUS.md.

Cada documento registra:
- fase actual y última fase cerrada;
- lista de archivos propios tocados;
- comandos/tests ejecutados con exit code y fecha;
- bloqueos exactos;
- contratos cambiados;
- próxima acción concreta.

Si una sesión se corta:
1. reabrir status/branch/diff;
2. leer el último status del agente;
3. comprobar que archivos y pruebas siguen coincidiendo;
4. retomar desde el último checkpoint válido;
5. no repetir ni descartar trabajo verificado;
6. no afirmar que una tarea quedó terminada sólo porque está marcada en status.

No crear status duplicado por cada turno; actualizar el mismo documento.

## 4. Una iteración = mejora completa

Cada iteración:
1. Elegir un gap que cierre un flujo o un blocker.
2. Confirmar ownership, dependencias y baseline.
3. Implementar en capa correcta.
4. Añadir pruebas que reproduzcan la necesidad.
5. Ejecutar validaciones específicas.
6. Probar integración con los módulos que la consumen.
7. Inspeccionar el output real.
8. Actualizar matriz de capacidades, roadmap y status.
9. Continuar al siguiente gap.

No acumular decenas de funciones sin comprobarlas.

## 5. Gestión de bloqueos

Clasificar:
- bug de código;
- falta de contrato;
- entorno/toolchain;
- falta de API key/billing;
- cuota/región/capability de proveedor;
- licencia/rights;
- hardware/OS;
- falta de decisión del usuario.

Resolver todos los bloqueos que no requieran acción del usuario. Para bloqueos externos, dejar una integración completa con UI/contract tests y un mensaje con el requisito exacto. No pedir una decisión si se puede aplicar una opción segura por defecto.

## 6. Pruebas y honestidad
- Ejecutar tests focalizados tras cada cambio.
- Ejecutar typecheck/build y suites globales en hitos.
- Anotar resultados, no estimaciones.
- Distinguir fails nuevos de baseline.
- No eliminar/skip tests para pintar verde.
- Repetir pruebas de regresión después de reparar.
- No esconder warnings relevantes.
- Para generación de media verificar el archivo resultante con ffprobe/decoder/playback.

## 7. Regla de alcance

La misión es toda la app especificada, no un MVP arbitrariamente pequeño. Se puede escalonar por prioridades para reducir riesgo, pero no declarar “completo” cuando faltan capacidades de la matriz.
Las capacidades legalmente incompatibles, físicamente imposibles o dependientes de credenciales quedan como opt-in/blocked, con alternativa y reason; no se sustituyen por simulaciones.

## 8. Cierre de cada agente

HY4 entrega frontend probado, capturas, e2e y una lista de endpoints consumidos/pendientes.
SWE 2 entrega backend, API contracts, jobs, MCP, providers, engines, tests, security/license report, instalador y entrega inicial.
Una fase se cierra sólo con artefactos, pruebas y evidencia. El resultado global se cierra tras la integración y acceptance del documento 13.