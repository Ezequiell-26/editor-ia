//! Utilidades de procesos compartidas por la infraestructura.

use std::process::Command;

/// Prepara un proceso externo para que **no parpadee una consola** y para que
/// ceda CPU cuando la persona está editando o usando la IA.
///
/// Los hijos pesados (FFmpeg, yt-dlp, Python, PowerShell) corren en
/// `BELOW_NORMAL_PRIORITY_CLASS`: si no hay contención usan todos los núcleos
/// igual, pero cuando la UI o un modelo local compiten por CPU, el sistema
/// atiende primero a la app. Toda invocación debe pasar por acá antes de
/// `spawn()`/`output()`/`status()`.
pub fn hide_console(command: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        const BELOW_NORMAL_PRIORITY_CLASS: u32 = 0x0000_4000;
        command.creation_flags(CREATE_NO_WINDOW | BELOW_NORMAL_PRIORITY_CLASS);
    }
    #[cfg(not(windows))]
    let _ = command;
}
