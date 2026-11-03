<div align="center">
  <img src="apps/desktop/public/olyvia-mark.png" alt="Olyvia" width="104" />
  <h1>Olyvia</h1>
  <p><strong>Un estudio de creación y edición de vídeo para Windows.</strong></p>
  <p>
    Edición multipista, motion graphics, herramientas audiovisuales y automatización con IA opcional.
    Diseñado para trabajar localmente, con control sobre tus proyectos y tus medios.
  </p>
  <p>
    <a href="#capturas">Ver la aplicación</a> ·
    <a href="#funcionalidades">Funcionalidades</a> ·
    <a href="#instalacion">Instalación</a> ·
    <a href="docs/TUTORIAL.md">Tutorial</a>
  </p>
  <p>
    <img src="https://img.shields.io/badge/Windows-10%20%7C%2011-64748b?logo=windows&logoColor=white" alt="Windows 10 y 11" />
    <img src="https://img.shields.io/badge/Version-0.2.0-7c6ee6" alt="Versión 0.2.0" />
    <img src="https://img.shields.io/badge/Tauri-2-24c8a5?logo=tauri&logoColor=white" alt="Tauri 2" />
    <img src="https://img.shields.io/badge/Rust-powered-d97706?logo=rust&logoColor=white" alt="Rust" />
    <img src="https://img.shields.io/badge/License-MIT-0f9d78" alt="Licencia MIT" />
  </p>
</div>

---

## Capturas

<p align="center">
  <img src="editor-ia-shots/olyvia-editor-organizacion-instalada-2026-10-24.png" alt="Editor principal de Olyvia" width="100%" />
</p>

<p align="center">
  <img src="editor-ia-shots/olyvia-mezclador-2026-10-24.png" alt="Mezclador de audio por pistas" width="49%" />
  <img src="editor-ia-shots/olyvia-vfx-roto-2026-10-24.png" alt="Herramientas VFX y rotoscopía" width="49%" />
</p>

## ¿Qué es Olyvia?

Olyvia es una aplicación de escritorio **local-first** para crear, editar y producir contenido audiovisual desde Windows. Reúne en un mismo entorno el flujo de trabajo de un editor de vídeo, herramientas de procesamiento multimedia y funciones de asistencia y automatización.

La IA es opcional: podés trabajar con herramientas locales y conectar proveedores o servicios externos cuando los necesites. No hace falta depender de una plataforma en la nube para organizar proyectos y editar material.

## Funcionalidades

| Área | Qué podés hacer |
| --- | --- |
| **Edición de vídeo** | Timeline multipista, recorte, composición, keyframes, velocidad, cámara lenta, transiciones, máscaras y efectos por clip. |
| **Color y acabado** | LUTs, scopes, ajustes de imagen, comparación antes/después, reducción de ruido y herramientas VFX. |
| **Audio y voz** | Mezcla por pistas, paneo, EQ, ducking, medición de loudness, narración local y procesamiento de audio. |
| **Guion y producción** | Organización por escenas, generación asistida de guiones, asignación de medios y montaje automatizado. |
| **Subtítulos e idiomas** | Importación y exportación SRT/VTT/ASS, transcripción, traducción, doblaje y subtítulos animados. |
| **Contenido para redes** | Shorts, reencuadre vertical, formatos de exportación, miniaturas y comprobaciones previas por plataforma. |
| **Herramientas multimedia** | Conversión y compresión, procesamiento por lotes, upscale, eliminación de fondo y análisis de archivos. |
| **IA e integraciones** | Proveedores OpenAI-compatible, modelos locales, gestor de servidores MCP e integración con Google Flow mediante MCP. |
| **Automatización** | Flujos de producción, generación de variantes, colas de trabajo y exportaciones verificadas. |

> Algunas funciones dependen de herramientas externas, modelos, proveedores o capacidades del equipo. Consultá el [tutorial](docs/TUTORIAL.md) y la [hoja de ruta](docs/ROADMAP.md) para conocer los requisitos y el alcance de cada integración.

## Principios del proyecto

- **Local-first:** los proyectos y los medios se gestionan en tu equipo; la nube no es obligatoria.
- **IA bajo tu control:** configurás los proveedores y decidís cuándo utilizar servicios externos.
- **Procesamiento real:** las operaciones multimedia se ejecutan con motores como FFmpeg, no son simples demostraciones visuales.
- **Exportación verificable:** los resultados se comprueban antes de considerarse terminados.
- **Derechos y procedencia:** el proyecto registra información de licencias y procedencia de los medios utilizados.

## Instalación

### Requisitos

- Windows 10 u 11 con WebView2.
- Node.js **22 o superior** (el proyecto fija Node 24 en `.nvmrc`).
- Rust stable.
- Toolchain MSVC de Visual Studio y Windows SDK para compilar Tauri.
- FFmpeg y FFprobe disponibles en `PATH` o configurados desde **Ajustes → Herramientas**.

**Opcionales según el flujo de trabajo:** Python con Faster-Whisper para transcripción local, PowerShell/System.Speech para voz SAPI y Node/npx para lanzar servidores MCP basados en Node.

### Ejecutar desde el código fuente

Abrí PowerShell en la carpeta donde quieras guardar el proyecto:

```powershell
git clone https://github.com/Ezequiell-26/editor-ia.git
cd editor-ia
npm install
npm run tauri:dev
```

Para generar el instalador de Windows:

```powershell
npm run tauri:build
```

Para ejecutar las verificaciones del proyecto:

```powershell
npm run verify
```

> La primera compilación puede requerir la instalación de componentes de Visual Studio, Rust y las herramientas multimedia indicadas arriba.

## Tecnología

| Componente | Tecnología |
| --- | --- |
| Aplicación de escritorio | Tauri 2 |
| Interfaz | React, TypeScript y Vite |
| Backend nativo | Rust |
| Procesamiento audiovisual | FFmpeg / FFprobe |
| Esquema de proyecto | Zod y JSON Schema |
| Pruebas | Vitest y herramientas de verificación del workspace |
| Integraciones | MCP, proveedores OpenAI-compatible y extensiones de navegador |

### Estructura principal

```text
apps/
  desktop/             Aplicación de escritorio: interfaz y backend Tauri/Rust
  render-worker/       Contrato y ejecución del worker de render
packages/
  project-schema/     Esquema, validación y fixtures de proyectos
  effect-kit/         Catálogo y recetas de efectos
extensions/
  flow-queue/          Integración de navegador para Google Flow
docs/                  Tutoriales, arquitectura, producto e integraciones
scripts/                Verificación, entorno de desarrollo y empaquetado
```

## Privacidad y seguridad

Olyvia está diseñada para mantener el flujo de trabajo en el equipo:

- Las claves de proveedores se guardan mediante el **Administrador de credenciales de Windows**.
- La aplicación no necesita subir tus proyectos o medios para utilizar el flujo local.
- Los proveedores externos solo intervienen cuando configurás y ejecutás una integración; los datos enviados a esos servicios quedan sujetos a sus propias políticas.
- Las operaciones nativas se validan antes de ejecutarse y los resultados de exportación pasan por comprobaciones.
- Los derechos y la procedencia de los recursos forman parte del proyecto.

Para reportar vulnerabilidades o revisar el alcance de seguridad, consultá [SECURITY.md](SECURITY.md).

## Documentación

| Recurso | Descripción |
| --- | --- |
| [Tutorial de Olyvia](docs/TUTORIAL.md) | Guía paso a paso desde la creación del proyecto hasta la exportación. |
| [Hoja de ruta](docs/ROADMAP.md) | Prioridades y evolución del producto. |
| [Especificación del producto](docs/product/PRODUCT-SPEC.md) | Objetivos y alcance funcional. |
| [Arquitectura y formato de proyecto](docs/architecture/) | Diseño técnico y estructura de los proyectos. |
| [Integraciones](docs/integrations/) | MCP, Google Flow y servicios conectados. |
| [Seguridad](SECURITY.md) | Prácticas y reporte de vulnerabilidades. |
| [Licencias de terceros](THIRD-PARTY-NOTICES.md) | Avisos y licencias de componentes externos. |

## Licencia

El repositorio incluye una licencia [MIT](LICENSE) para el código propio del proyecto. Las dependencias, herramientas, modelos, fuentes, voces y materiales de terceros mantienen sus respectivas licencias y condiciones de uso. Consultá [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

---

<div align="center">
  <strong>Olyvia</strong><br />
  <sub>Creá, editá y producí desde un solo lugar.</sub><br />
  <sub><a href="https://github.com/Ezequiell-26/editor-ia">GitHub · Ezequiell-26/editor-ia</a></sub>
</div>
