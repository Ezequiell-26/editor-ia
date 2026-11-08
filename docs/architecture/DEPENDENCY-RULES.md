# Reglas de dependencias

Estas reglas definen dirección de dependencias; una estructura de carpetas no basta para garantizar arquitectura.

## 1. TypeScript

Dirección objetivo:

    app (composition root)
      ├─ features (presentation)
      ├─ application (use cases)
      ├─ state (app state)
      └─ platform (concrete adapters)

    features -> application contracts / service facades -> platform adapters
    application -> domain contracts and ports
    platform -> implement ports and external APIs
    shared -> no depende de features ni app

Reglas obligatorias para código nuevo:

1. Un componente dentro de features/** no importa @tauri-apps/api ni ejecuta invoke/listen/emit directamente; consume una fachada o caso de uso.
2. shared/** no importa desde features/**, state/**, app/** ni platform/**.
3. Una feature no importa archivos privados de otra feature. La comunicación entre dominios usa contracts/services o entrypoints públicos documentados.
4. application/** no importa React, CSS, componentes, Tauri o módulos del browser.
5. platform/** no importa componentes ni estado visual. Puede implementar contratos de application.
6. La detección de runtime Tauri/web se hace una vez en platform y se expone como capability, no se repite por componente.
7. Los eventos Tauri se normalizan en un adaptador. La UI no debe conocer el nombre de canal nativo si existe un contrato semántico estable.
8. Los modelos persistidos se parsean con project-schema en el borde antes de llegar al estado de UI.
9. Evitar barrel files globales que reexporten todo el repositorio; cada dominio expone sólo su API pública.
10. No introducir ciclos de importación entre features o entre application/platform.

## 2. Rust

Dirección objetivo:

    commands -> application -> domain
                     ^          |
                     |          v
                  ports <- infrastructure

1. commands/** depende de application/** y DTO del borde; no implementa lógica de negocio.
2. domain/** no depende de Tauri, serde IPC específico, FFmpeg CLI, filesystem, HTTP ni procesos.
3. application/** define qué infraestructura necesita mediante traits en ports/**.
4. infrastructure/** implementa ports; no contiene decisiones de UX ni reglas persistentes del dominio.
5. lib.rs registra comandos y ensambla dependencias; no concentra implementaciones de caso de uso.
6. La ejecución de FFmpeg sólo ocurre a través de infrastructure/ffmpeg/**; los casos de uso no construyen strings de shell ni invocan procesos directamente.
7. Los trabajos largos deben propagar cancelación, progreso y errores tipados hasta el adaptador Tauri.
8. Nunca construir comandos shell con concatenación de entradas del usuario; usar argumentos estructurados y validación por dominio.

## 3. Formato de proyecto y contratos externos

- El schema persistido tiene versión explícita y migraciones compatibles.
- Un movimiento de módulo no justifica modificar el JSON persistido.
- Los nombres y payloads de Tauri/MCP son contratos de integración: actualizar implementador, consumidor, documentación y pruebas en el mismo cambio.
- Los secretos y credenciales sólo se administran por la infraestructura de credenciales del SO; no llegan a logs, DTO de UI o memoria.

## 4. Criterio práctico de tamaño

No dividir código sólo por alcanzar una cantidad de líneas. Usar como señal de revisión:

| Tamaño del módulo | Política |
|---:|---|
| Hasta 400 líneas | Aceptable si mantiene una responsabilidad clara |
| 400–700 | Revisar si contiene más de un motivo de cambio |
| Más de 700 | Se exige justificar por qué no puede dividirse |
| Más de 1.000 | Debe tener un plan explícito de descomposición, salvo código generado/fixtures |

La cohesión y el acoplamiento importan más que la longitud.

## 5. Compatibilidad durante la migración

- Mantener imports/reexports de rutas antiguas como fachadas temporales.
- No cambiar contratos públicos sólo para adecuarlos a la nueva estructura.
- Trasladar tests junto a la responsabilidad nueva o mantener adaptadores de import si otros tests aún los consumen.
- No usar any, casts inseguros ni allow masivos para silenciar fallos de migración.
- Registrar excepciones temporales con ruta, motivo y criterio de eliminación.
