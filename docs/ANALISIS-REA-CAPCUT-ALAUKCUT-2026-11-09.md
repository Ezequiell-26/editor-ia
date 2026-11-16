# Análisis estático de AlaukCut y CapCut con REA/Ghidra

**Fecha:** 2026-11-09  
**Alcance:** inventario local, lectura estática de frontend/backend y análisis Ghidra de módulos seleccionados.

## Resumen

Se usó REA 6.8.0 y Ghidra 12.1.4 con JDK 27. Ghidra 12.2 no era compatible con el contrato de REA de este entorno; la descarga de 12.1.4 se verificó por SHA-256 (<code>ddac49f903da9d5bac833e5cc79395098b9c33cfd3279be5f31bd00387d2d4db</code>). No se ejecutaron CapCut ni AlaukCut, no se alteraron sus instalaciones y no se intentó eludir licencia o protección.

El inventario de ambas instalaciones fue **parcial**, no un análisis exhaustivo de todos sus módulos. CapCut presenta el límite principal: Ghidra no terminó el análisis de <code>videoeditor.dll</code> (72,501,160 bytes) dentro del plazo REA de 330 s; no se confirmó un error de memoria. Por tanto, las conclusiones de CapCut describen arquitectura e integración, no toda la lógica del editor.

## AlaukCut

- La instalación contiene un frontend PyWebView/HTML/JS/CSS y backend Python 3.11.9 con módulos <code>.pyc</code>, además del módulo nativo <code>motorcpp.cp311-win_amd64.pyd</code> (x86-64, 899,584 bytes). El frontend incluye vistas de inicio/configuración y editor, con módulos separados para timeline, inspector, escenario, audio, exportación, subtítulos y tracking.
- El inventario REA registró 6,946 archivos y sondeó 41; su estado fue **partial**. El mapa estático del backend expone operaciones de proyecto/medios, reconexión, timeline, LUT, audio, captura, subtítulos y exportación, entre otras. Es un mapa de APIs declaradas; no demuestra que cada ruta funcione correctamente en runtime.
- La configuración visible permite fijar un límite de caché de renderización de 2–200 GB. En Ghidra, el módulo nativo fue identificado como PE x86-64 con 8 segmentos, 1,888 procedimientos y 1,710 cadenas (<code>ev_ba06cc5cb2f4a4b310dc975f16a3e2cea8ded48c6144ed62188111cb764126a4</code>). La función de registro descompilada expone <code>audio_entradas</code> a Python; su documentación describe enumeración WASAPI e identificadores estables para dispositivos de entrada (<code>ev_add5abc49dd6396091d63c3c1319addd41e5091aaf74b051355ea35cc0a96258</code>). Esto acredita una interfaz Python/nativa y la intención documentada, no el comportamiento completo del backend WASAPI.

## CapCut

- Instalación observada: versión 9.6.0.4097. El ejecutable principal mide 90,536 bytes; el inventario incluye módulos nativos grandes como <code>videoeditor.dll</code>, <code>VECreator.dll</code>, <code>cccreator.dll</code>, <code>CefCreator.dll</code> y <code>lynx.dll</code>, además de Qt/QtQuick y FFmpeg. Las firmas Authenticode de los binarios principales inspeccionados fueron válidas.
- El inventario REA registró 5,641 archivos y sondeó 258; también quedó **partial**.
- Ghidra completó <code>CefCreator.dll</code> (3,270,568 bytes): PE x86-64, 8 segmentos, 5,465 procedimientos y 32,760 cadenas (<code>ev_95b82399544c2b81a058ed649173e194bc368c1973a44862260ac55dbec2fd82</code>). Las cadenas incluyen el gestor de servicios CEF/Mojo, carga de recursos y nombres de API Qt como <code>QNetworkInterface</code> y <code>QtConcurrent</code> (<code>ev_41a26b78ec8bbe0a341abe9f72201b4cef5dbbfc985154af9bbe117cbe017053</code>). Esto sustenta una capa CEF/Chromium integrada con Qt y servicios de carga, pero no revela el flujo visual completo.
- Ghidra también resumió <code>CapCut.exe</code> como PE x86-64 con 8 segmentos, 323 procedimientos y 226 cadenas (<code>ev_f61d4730a03ff7fa6f78b820a341f5166b6a16350ad5b35a23959ff9cef89885</code>).
- <code>videoeditor.dll</code> primero apuntaba a una ruta C: con reparse point que el puente Windows de REA no admite. Se confirmó su ruta física equivalente en D: y el mismo SHA-256; aun así, la importación/análisis Ghidra superó los 330 s y REA terminó con timeout. No se obtuvo pseudocódigo de ese módulo; la lógica de edición y render de CapCut queda **sin analizar a nivel de función**.

## Mejora concreta en Olyvia

La comparación de caché justificó exponer una capacidad ya existente en Olyvia: el servicio nativo <code>cleanupProxies()</code> elimina únicamente archivos derivados <code>media/proxies/proxy-*.mp4</code>. Se añadió en Medios un botón **«Limpiar proxies»** con confirmación explícita, exclusión mutua con la generación, eliminación de referencias obsoletas del proyecto sin entrada de deshacer y notificación de cantidad/espacio liberado. Los medios originales y los renders finales no se borran; los proxies pueden regenerarse.

Código y pruebas: [AssetsPanel.tsx](../apps/desktop/src/features/assets/AssetsPanel.tsx), [AssetsPanel.test.tsx](../apps/desktop/src/features/assets/AssetsPanel.test.tsx). La cola anota la mejora en [IMPROVEMENT-QUEUE.md](IMPROVEMENT-QUEUE.md).

**Verificación:** <code>npm run test -- apps/desktop/src/features/assets/AssetsPanel.test.tsx</code> — 9/9; <code>npm run typecheck</code> — OK; <code>npm --workspace apps/desktop run build</code> — OK (486 módulos; advertencias de Lottie/chunks grandes). No se ejecutó la suite completa ni se reconstruyó el instalador. La limpieza es manual: cuotas automáticas, advertencia de poco espacio y medición total de caché siguen pendientes.

## Cobertura pendiente

Para llamar exhaustivo al análisis haría falta repetir el análisis enfocado de <code>videoeditor.dll</code> con un plazo REA mayor y examinar <code>VECreator.dll</code>/<code>cccreator.dll</code>; además, una observación de runtime en un proyecto desechable y aislado ayudaría a confirmar los flujos visuales. Este informe no atribuye comportamientos no observados ni contiene código propietario copiado.
