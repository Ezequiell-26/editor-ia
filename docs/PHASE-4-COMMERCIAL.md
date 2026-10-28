# Fase 4 — Paquete comercial Windows

Actualizado: 2026-10-28.

## Ejecutado

- **Trial de 14 días** en Rust, guardado cifrado y ligado a la máquina en
  `trial.bin`. Se activa una sola vez; al vencer, la app vuelve a Free con un
  mensaje claro. Tests: activa Pro, impide segunda prueba, vence a Free.
- **Modal de activación** en Ajustes → Licencia: prueba de 14 días, carga de
  archivo firmado y explicación del estado. La tarjeta muestra Pro, prueba o
  Free, días restantes y permite desactivar.
- **Instalador NSIS firmado** generado con el código de Fases 1–4:
  - `target/release/bundle/nsis/Olyvia_0.1.0_x64-setup.exe`
  - **222.329.952 B**
  - SHA-256 `9D3EDD323160F2A97893774C4DA2BDF0879844DB80D2D3765F08C50F76FAE3A1`
  - Authenticode **Valid** (certificado autofirmado, sin timestamp).
- **Ejecutable de release**: **37.078.528 B**, SHA-256
  `3DEB7E45DA982F0420E7264B3CEA470CBFBCC994BF75164F1E921312644EACBC`
  (sin firmar en `target`; el instalador sí está firmado).
- Comandos embebidos verificados: `license_status`, `start_trial`,
  `license.bin`, `trial.bin`.
- **Assets limpios**: se corrigió Vite para vaciar `dist` en cada build y no publicar sourcemaps. El frontend pasó de **331 MB / 3.642 archivos** a **16 MB / 65 archivos**, sin mapas; el instalador bajó de 264,5 MiB a 212,0 MiB. Assets nuevos `main-8dbOyqzg.js` y comandos `license_status`/`start_trial` verificados dentro del exe.
- **Compilación y arranque verificados**: frontend `✓ built in 9,07 s`; Rust release `Finished` y la app abrió desde `target/release/editor-ia-desktop.exe` (ventana Olyvia respondiendo). Captura en [olyvia-fase4.png](screenshots/olyvia-fase4.png).
- **Trampa de build**: un `cargo build --release` sin la feature `custom-protocol` genera un exe que apunta a `localhost:5173`; el build comercial debe usar `npm run tauri:build` o `cargo build --release --features custom-protocol`.

## Verificación

- Typecheck raíz verde.
- Frontend raíz **1361/1361 en 166 archivos**.
- Escritorio **961/961 en 140**.
- Rust **450 passed + 47 ignored**.
- `npm run audit:licenses` OK (Wav2Lip fuera del bundle).
- Sin instalación sobre la build en uso.

## Bloqueos reales para publicar

1. **Lemon Squeezy / Gumroad:** falta el product ID y la configuración del
   endpoint. El modal lo declara; no se inventó una verificación. Para
   habilitarla hay que definir el producto, implementar el POST y probarlo con
   una licencia real.
2. **SmartScreen:** el instalador está firmado con un certificado autofirmado.
   Windows seguirá mostrando advertencias de reputación hasta usar un
   certificado OV/EV de una CA y acumular reputación. No se puede prometer
   “sin alertas” con la firma actual.
3. **Auto-updater:** no hay endpoint de releases ni clave pública de firma de
   actualizaciones. La app actual dice honestamente que no hay canal; el motor
   `yt-dlp` sí se actualiza cada 7 días. Publicar actualizaciones silenciosas
   requiere servidor, manifiesto firmado y prueba de downgrade/rollback.
4. **MSI:** el bundle configurado es NSIS `.exe`; no se generó `.msi` porque el
   target WiX no está configurado/instalado.
5. **Instalación limpia/desinstalación:** no se ejecutó sobre la máquina porque
   reemplazaría la app abierta y podría afectar trabajo sin guardar. La prueba
   en VM limpia queda pendiente.

## Próximo paso para cerrar la publicación

- Configurar producto y API de licencias, probar activación real y trial.
- Adquirir certificado de firma de código y configurar timestamp.
- Elegir canal de actualización y firmar manifiestos.
- Probar instalador y desinstalador en una VM limpia de Windows 11.
