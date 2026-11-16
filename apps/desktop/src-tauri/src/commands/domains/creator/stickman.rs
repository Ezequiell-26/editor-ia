//! Adaptador IPC del motor stickman. El dominio puro (rig FK, rasterizador,
//! partículas, validación) vive en `crate::media::stickman`; acá sólo queda
//! la orquestación de cuadros PNG → FFmpeg → verificación ffprobe.

include!("stickman/command.rs");
