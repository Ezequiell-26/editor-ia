# Estructura objetivo

La siguiente estructura es un destino lógico. No se debe crear una carpeta vacía para cada nombre ni mover cientos de archivos en un solo cambio. Cada subcarpeta aparece cuando tiene una implementación real y una prueba asociada.

## 1. Frontend TypeScript

    apps/desktop/src/
    ├─ app/                         # Composición, navegación, routing y registro de vistas
    │  ├─ bootstrap/                # Inicialización de la aplicación
    │  ├─ navigation/               # workspace-map y navegación canónica
    │  ├─ routing/                  # resolveViewRoute y deep links
    │  └─ registry/                 # loaders lazy, estilos por superficie
    ├─ features/                    # Dominios visuales, conservando los actuales
    │  ├─ editor/
    │  ├─ timeline/
    │  ├─ media/
    │  ├─ audio/
    │  ├─ color/
    │  ├─ effects/                  # VFX y effect browser cuando se migre
    │  ├─ subtitles/
    │  ├─ motion/
    │  ├─ ai/
    │  ├─ agents/
    │  ├─ integrations/             # MCP, browser, plugins, Flow, extensiones
    │  └─ ...                       # Resto de features existentes
    ├─ application/                 # Casos de uso y orquestación agnóstica de UI
    │  ├─ projects/
    │  ├─ media/
    │  ├─ render/
    │  ├─ ai/
    │  └─ integrations/
    ├─ services/                    # Fachadas de servicios de aplicación
    │  ├─ contracts/                # Tipos públicos y DTO por dominio
    │  ├─ projects/
    │  ├─ media/
    │  ├─ render/
    │  ├─ ai/
    │  └─ integrations/
    ├─ platform/                    # Adaptadores concretos del entorno desktop
    │  └─ tauri/
    │     ├─ commands/              # invoke agrupados por dominio
    │     ├─ events/                # listen/emit y progreso
    │     ├─ runtime/               # detección Tauri/web y capacidades
    │     └─ filesystem/
    ├─ state/                       # Estado de aplicación, segmentado por dominio
    │  ├─ project/
    │  ├─ timeline/
    │  ├─ render/
    │  ├─ preferences/
    │  └─ integrations/
    └─ shared/                      # UI/utilidades realmente transversales
       ├─ components/
       ├─ hooks/
       ├─ lib/
       ├─ types/
       └─ utils/

### Responsabilidades del frontend

- app/ ensambla la aplicación y decide qué superficie se monta; no contiene lógica de export ni reglas de proyecto.
- features/ contiene UI y lógica de presentación de cada dominio. No invoca Tauri directamente.
- application/ contiene flujos de usuario reutilizables y coordina servicios mediante interfaces.
- services/ ofrece APIs estables a features y stores. La compatibilidad con project-service.ts se conserva mediante una fachada hasta terminar la migración.
- platform/tauri/ es el único lugar nuevo donde se concentra el transporte de Tauri, sus eventos y capacidades.
- state/ guarda estado de UI/aplicación; no debe convertirse en un segundo servicio de negocio.
- shared/ sólo aloja piezas sin propietario de dominio. Si un módulo sólo se usa en audio, pertenece a audio.

## 2. Backend Rust

    apps/desktop/src-tauri/src/
    ├─ app/                         # Composición y registro de dependencias
    ├─ commands/                    # Adaptadores IPC Tauri: DTO, validación de entrada, llamada al caso de uso
    ├─ domain/
    │  ├─ project/
    │  ├─ timeline/
    │  ├─ media/
    │  ├─ audio/
    │  ├─ effects/
    │  ├─ subtitles/
    │  ├─ motion/
    │  └─ render/
    ├─ application/
    │  ├─ projects/
    │  ├─ media/
    │  ├─ timeline/
    │  ├─ render/
    │  ├─ ai/
    │  └─ integrations/
    ├─ ports/                       # Traits/interfaces que define application/domain
    ├─ infrastructure/
    │  ├─ ffmpeg/                   # CLI, graph, filtros, probes, perfiles y ejecución
    │  ├─ filesystem/
    │  ├─ process/
    │  ├─ providers/
    │  ├─ credentials/
    │  ├─ mcp/
    │  └─ browser/
    ├─ runtime/                     # Estado mínimo, jobs, cancelación, eventos y progreso
    ├─ projects/                    # Fachada temporal de compatibilidad durante migración
    └─ render/                      # Fachada temporal hacia infrastructure/ffmpeg y dominio render

### Responsabilidades de Rust

- commands/ traduce el protocolo IPC; no debe implementar un flujo largo ni ejecutar un filtergraph.
- application/ implementa casos de uso: importar medios, guardar proyectos, preparar render, ejecutar export, etc.
- domain/ define reglas puras, invariantes y modelos. No conoce Tauri, filesystem, FFmpeg CLI o HTTP.
- ports/ define contratos requeridos por los casos de uso.
- infrastructure/ implementa ports y encapsula procesos, filesystem, FFmpeg y proveedores.
- runtime/ administra tareas, eventos, cancelación y progreso sin absorber reglas de dominio.
- lib.rs queda como composition root: plugins, registro de comandos, estado y wiring.

No es obligatorio convertir cada carpeta en un crate. Se mantiene el crate actual hasta que una frontera de compilación independiente aporte valor medible.

## 3. Paquetes compartidos

    packages/
    ├─ project-schema/              # Documento persistido .olyp, validación y migraciones de schema
    ├─ effect-kit/                  # Catálogo, parámetros, presets y semántica de stacks de efectos
    └─ ...                          # Sólo cuando un contrato sea compartido por 2+ unidades reales

Reglas:

- Los contratos persistidos pertenecen a project-schema.
- La semántica de efectos pertenece a effect-kit.
- Los DTO IPC no se duplican como interfaces independientes entre UI y services.
- No llevar modelos internos de Rust a los paquetes TS ni al revés; mapear en el adaptador IPC.

## 4. Fachadas y compatibilidad

Durante la migración:

- services/project-service.ts conserva exports públicos y delega en servicios especializados.
- state/project-store.tsx conserva el Provider/hooks exportados y delega en módulos internos.
- App.tsx conserva el punto de entrada por defecto y delega el shell a módulos de composición.
- render/ffmpeg.rs conserva la interfaz del módulo mientras los helpers se trasladan a submódulos.
- Los comandos Tauri y tools MCP mantienen nombres y payloads hasta que los dos lados puedan cambiarse juntos.

Una fachada se elimina sólo cuando no quedan consumidores internos, tests, plugins ni deep links que la utilicen.

## Organización real de los comandos nativos

Los archivos de src-tauri/src/commands se agrupan en commands/domains/{projects,media,render,audio,ai,downloader,creator,integrations,system}. commands/mod.rs usa atributos #[path] para conservar las rutas públicas de Rust (commands::projects, commands::audio, etc.); las importaciones cruzadas existentes no tienen que migrar en masa.

La lista allowlisted de tauri::generate_handler! se encuentra en commands/registry.rs. La composición del runtime permanece en lib.rs.
