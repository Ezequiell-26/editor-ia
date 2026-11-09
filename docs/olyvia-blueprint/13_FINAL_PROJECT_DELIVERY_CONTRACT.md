# 13 — Contrato de entrega final del proyecto Olyvia

**Este documento es obligatorio para HY4 y SWE 2.** La tarea no termina al presentar un análisis, lista de pendientes, arquitectura, demo o plan. Deben implementar el proyecto acordado, verificarlo, empaquetarlo y entregar el resultado final.

## 1. Resultado que debe recibir el usuario

Un build funcional de Olyvia para Windows x64, acompañado por:
1. Instalador NSIS real generado desde la configuración Tauri vigente.
2. Código fuente completo del worktree de arquitectura, conservando la política de distribución cerrada del propietario.
3. Proyecto de ejemplo editable y assets de prueba con licencias claras.
4. Guía de instalación, primer inicio, proveedores, MCP y flujo de producción.
5. Reporte de calidad y pruebas.
6. Inventario de dependencias/licencias/binaries/models.
7. Manifiesto de artefactos y hashes SHA-256.
8. Registro de limitaciones conocidas y acciones necesarias del usuario (por ejemplo API keys, credenciales, voice consent).
9. Instrucciones para ejecutar desde código y reconstruir el instalador.
10. Capturas reales de las pantallas principales y pruebas E2E.

## 2. Ruta de entrega

Crear en el worktree:
deliverables/final/

Estructura esperada:
- Olyvia-Setup-x64.exe (o nombre versionado producido por Tauri NSIS)
- SHA256SUMS.txt
- RELEASE-MANIFEST.json
- BUILD-AND-TEST-REPORT.md
- INSTALL.md
- USER-GUIDE.md
- PROVIDERS-AND-MCP.md
- SECURITY-AND-LICENSES.md
- KNOWN-LIMITATIONS.md
- sample-project/
- screenshots/

El nombre del instalador puede ajustarse al nombre/versionado que produzca Tauri, pero el artefacto entregado debe ser el instalador final de Windows x64. No renombrar un archivo inexistente ni simular un build.

## 3. Build real

La raíz del proyecto ya tiene scripts:
- npm run typecheck
- npm run test:serial
- npm run test:extension
- npm run test:web-tts
- npm run verify
- npm run build
- npm run tauri:dev
- npm run tauri:build
- npm run audit:licenses

Usar los scripts reales del package.json vigente. Antes, reparar el aislamiento de workspaces/junctions observado en esta rama. Build final recomendado:
1. Validación del estado limpio de pruebas sin borrar ni limpiar trabajo del usuario.
2. Install frozen/lockfile-preserving si realmente se requiere.
3. Typecheck de todos los workspaces.
4. Unit/integration tests.
5. Extension/web-tts tests.
6. E2E Playwright.
7. Rust tests/clippy/fmt.
8. npm run audit:licenses.
9. npm run build.
10. npm run tauri:build.
11. Instalar el NSIS recién creado en entorno de prueba.
12. Smoke test de la build instalada y artefactos reales.

No llamar “build final” a vite build sin un instalador Tauri.

## 4. Configuración nativa observada que debe corregirse/validarse

El tauri.conf.json inspeccionado en esta rama declara:
- productName Olyvia;
- bundle target nsis;
- installMode currentUser;
- main window width 900 y height 580;
- minWidth 760 y minHeight 500;
- resizable false.

La ventana principal no debe quedar fija ni demasiado pequeña para el editor profesional. SWE 2 debe establecer una geometría inicial y min/max apropiadas, habilitar resizing/maximizing cuando corresponda y preservar ventana/splitters. HY4 valida la composición real en 1360×768 y 1280×720. No cambiar sólo el CSS: el window config nativo también importa.

El bundle NSIS existente es el destino; no afirmar que hay MSI/portable si no se construye. Si se decide añadir otros formatos, probarlos por separado.

## 5. Calidad y pruebas de aceptación en desktop

La validación debe ejecutarse en la app nativa instalada, no sólo Vite/browser:
- primer arranque, launcher/splash y ventana principal;
- ventana redimensionable y persistencia de layout;
- crear/abrir/guardar/cerrar/reabrir proyecto;
- importación y probe de vídeo/audio/imagen;
- timeline: split/trim/move/ripple/undo/redo;
- preview real con audio;
- captions/transcription si el engine está presente;
- voz/SAPI fallback y provider remoto si credenciales configuradas;
- color, efectos, motion, mixer y multicam con test media;
- AI brief -> plan -> storyboard -> assets -> assembly;
- production run: hide/minimize/reconnect/cancel/restart recovery según policy instalada;
- MCP client y MCP server desde cliente compatible;
- export MP4, ffprobe, decode test y reproducción;
- packaging de entrega y re-open del proyecto;
- errores de red, proveedor offline, cuota, archivo corrupto y missing media.

La salida se reporta por escenario: pass/fail/blocked con evidencia, no con una frase “todo funciona”.

## 6. Firma y seguridad

La configuración actual especifica NSIS, instalación por usuario y un certificate thumbprint. Eso no demuestra que el certificado esté disponible ni que el ejecutable quede firmado. Verificar:
- firma Authenticode efectiva y timestamp;
- si falta certificado, build unsigned con warning transparente;
- hash SHA-256;
- instalador obtenido desde ruta real;
- no incluir secrets, sample API keys, test credentials, logs privados ni datos del usuario;
- third-party notices y source offer/obligaciones según licencia real.

No modificar ni rotar certificate/private key. Nunca leer/exportar private key del sistema.

## 7. Provider cloud y disponibilidad de cuenta

Una integración puede estar completa en código y aún no ser verificable en vivo si el propietario no tiene API key, billing, región o permiso. En ese caso:
- implementar adapter, contract tests, credential UI y test de configuración;
- incluir estado BLOCKED_BY_USER_CREDENTIALS con pasos exactos;
- no inventar una llamada exitosa;
- solicitar sólo la credencial o autorización específica que falta;
- nunca poner credenciales en documentación o capturas;
- separar implemented, tested_live, account_blocked y not_available.

La versión final debe incluir la integración y su UI aunque el usuario deba introducir su propia key después. Ningún servicio de pago se ejecuta sin consentimiento.

## 8. Performance

Medir en la máquina de referencia:
- startup hasta ventana usable;
- idle RAM tras estabilización;
- abrir proyecto mediano y grande;
- timeline scroll/scrub responsiveness;
- preview fps y codec;
- render fps/realtime ratio;
- peak CPU/RAM/disk;
- cancel latency;
- recovery time.

No afirmar “bajo consumo”, “4K fluido” o “GPU acelerado” sin medidas. La PC de referencia no tiene GPU dedicada; los modelos locales de imagen/video no son requisito.

## 9. Documentación que se entrega
- Quick Start para persona no técnica.
- Cómo configurar proveedores BYOK y comprobarlos.
- Cómo activar y auditar MCP.
- Cómo importar material y preservar backups.
- Cómo ejecutar un proyecto desde brief.
- Cómo editarlo manualmente.
- Cómo revisar derechos/licencias.
- Cómo exportar y recuperar un run interrumpido.
- Diagnóstico de fallos y soporte.
- Build/release instructions y architecture overview.

## 10. Estados finales permitidos

- **COMPLETE:** todos los gates aplicables pasaron; instalador real generado e instalado.
- **COMPLETE_WITH_USER_SETUP:** build y funciones implementadas; una cuenta/credencial del usuario es necesaria para activar providers. Todos los tests alternativos pasaron.
- **BLOCKED:** requisito legal, credencial o entorno esencial bloquea un flujo; se entrega todo lo que sí se completó y lista exacta del bloqueo.
- **NOT_COMPLETE:** falta una función, test crítico o instalador; no presentar el proyecto como terminado.

## 11. Nada de entregas ficticias

Prohibido:
- terminar respondiendo sólo “implementé X” sin enlaces/rutas y evidencias;
- entregar un ZIP que contiene el repo pero no hay ejecutable;
- reportar test counts de una ejecución anterior;
- reutilizar un instalador viejo y llamarlo nuevo;
- etiquetar un mock como integración real;
- ocultar fallos por tests skipped/ignored;
- reemplazar el repo principal o sus cambios concurrentes;
- borrar, resetear, limpiar, commitear, pushear o fusionar sin autorización expresa.

El objetivo final es un producto de escritorio instalable, ejecutable, probado y documentado, no una colección de archivos de especificación.