# Continuación: REA/Ghidra CapCut + AlaukCut (2026-11-09)

## Proyecto y estado
- Checkout activo: D:/Users/ofici/QODER-WORK/editor-ia-architecture, rama architecture/refactor-foundation. No cambiar al repo homónimo sin nueva instrucción.
- Se preservaron cambios previos del usuario. Este ciclo añadió AssetsPanel.tsx, sus pruebas, docs/IMPROVEMENT-QUEUE.md, el informe de análisis y esta memoria.
- No commit, push, reset ni deploy.

## Solicitud activa
Analizar AlaukCut y CapCut localmente usando REA/Ghidra, describir flujos y mejorar Olyvia sin copiar código propietario ni eludir licencias.

## Análisis recogido
- REA 6.8.0 + Ghidra 12.1.4 + JDK 27. La descarga Ghidra 12.1.4 verificada: SHA-256 ddac49f903da9d5bac833e5cc79395098b9c33cfd3279be5f31bd00387d2d4db. REA rechaza Ghidra 12.2 para este entorno. REA desktop inventory parcial: AlaukCut 6,946 archivos/41 probados; CapCut 5,641/258.
- AlaukCut: frontend PyWebView + HTML/JS/CSS, CPython 3.11.9, backend .pyc, módulo nativo motorcpp.cp311-win_amd64.pyd SHA-256 47488a8b9ada5c92ffcbaad0f78c071d57f165371c38128f429987e229b2f46a. Ghidra overview: x86-64, 8 segmentos, 1,888 procedimientos, 1,710 cadenas. El método expuesto a Python audio_entradas documenta enumeración WASAPI con IDs estables; es evidencia de la interfaz/documentación, no del runtime completo. Ghidra Evidence IDs: ev_ba06cc5cb2f4a4b310dc975f16a3e2cea8ded48c6144ed62188111cb764126a4, pseudocódigo ev_add5abc49dd6396091d63c3c1319addd41e5091aaf74b051355ea35cc0a96258. UI configura caché de render de 2–200 GB.
- CapCut 9.6.0.4097: módulos Qt/QtQuick, CEF, Lynx, FFmpeg y DLLs nativas grandes; firmas principales válidas. Ghidra CefCreator.dll: 8 segmentos, 5,465 procedimientos, 32,760 cadenas; evidencia de CEF/Mojo, carga de recursos y Qt (QNetworkInterface, QtConcurrent). IDs ev_95b82399544c2b81a058ed649173e194bc368c1973a44862260ac55dbec2fd82, ev_41a26b78ec8bbe0a341abe9f72201b4cef5dbbfc985154af9bbe117cbe017053. CapCut.exe: 323 procedimientos/226 cadenas, ID ev_f61d4730a03ff7fa6f78b820a341f5166b6a16350ad5b35a23959ff9cef89885.
- videoeditor.dll (72,501,160 bytes): ruta C: original es un reparse point no admitido; se verificó ruta física D: con el mismo hash 47e341ce930074bd7d11ef418ea5c893fc6330aa73b2f2203c5098f302d63e9f. Ghidra REA agotó su timeout por defecto de 330 s; no OOM confirmado y no hay resultados de función. No repetir con la misma configuración; siguiente análisis requiere plazo mayor. VECreator.dll/cccreator.dll quedan sin decompilar.
- No se ejecutó ninguna de las dos apps ni se observó runtime/red.

## Olyvia implementado y probado
- Medios ahora presenta «Limpiar proxies» con confirmación; llama al servicio existente de limpieza, borra del proyecto las referencias derivadas sin undo y notifica archivo(s)/bytes. Backend solo elimina media/proxies/proxy-*.mp4; originales y renders intactos. Cuotas/alertas automáticas siguen pendientes.
- npm run test -- apps/desktop/src/features/assets/AssetsPanel.test.tsx: 9/9. npm run typecheck: OK. npm --workspace apps/desktop run build: OK (486 módulos; warnings de lottie-web/chunks). Suite completa/installer no ejecutados.
- Un pnpm exec inicial creó pnpm-lock.yaml accidental (se leyó y eliminó); ejecutó el test. La verificación final se repitió con npm. No volver a correr pnpm sin revisar configuración de workspaces.
- Informe: docs/ANALISIS-REA-CAPCUT-ALAUKCUT-2026-11-09.md.

## Continuación segura
1. Si se retoma la ingeniería inversa, inspeccionar el estado del terminal pty-2; el Ghidra session debe cerrarse con REA close_binary y luego terminal_close cuando no se necesite más.
2. Para seguir el core CapCut, reiniciar un REA MCP con REA_GHIDRA_STARTUP_TIMEOUT_MS aumentado (el timeout es 330000 ms por defecto); usar la ruta física D: y analizar con funciones enfocadas. No afirmar análisis completo sin ello.
3. Mantener la limitación de análisis estático/no runtime y preservar todos los cambios preexistentes.
