//! Monitor dual (`previa_dupla` de AlaukCut): una segunda ventana del SO
//! que muestra el monitor del programa, pensada para una segunda pantalla.
//!
//! La ventana carga la misma app con `?dual=1`; el frontend detecta el modo
//! y monta `DualMonitorView`, que recibe el documento del proyecto y el
//! estado de transporte por `BroadcastChannel` desde la ventana principal
//! (`state/dual-link.ts`). No hay render propio acá: la ventana es sólo el
//! escaparate; la sincronización es 100 % frontend.

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::projects::service::{ProjectError, ProjectErrorCode};

pub(crate) const DUAL_MONITOR_LABEL: &str = "dual-monitor";

/// Abre (o enfoca) la ventana del monitor dual. Idempotente: si ya existe,
/// la trae al frente en vez de duplicarla.
#[tauri::command]
pub async fn dual_monitor_open(app: AppHandle) -> Result<(), ProjectError> {
    if let Some(window) = app.get_webview_window(DUAL_MONITOR_LABEL) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(());
    }
    WebviewWindowBuilder::new(
        &app,
        DUAL_MONITOR_LABEL,
        WebviewUrl::App("index.html?dual=1".into()),
    )
    .title("Olyvia — Monitor")
    .inner_size(1280.0, 720.0)
    .min_inner_size(640.0, 360.0)
    .resizable(true)
    .visible(true)
    .center()
    .build()
    .map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "no se pudo abrir el monitor dual",
        )
    })?;
    Ok(())
}

/// Cierra la ventana del monitor dual si está abierta. No toca el proyecto:
/// el documento vive en la ventana principal.
#[tauri::command]
pub async fn dual_monitor_close(app: AppHandle) -> Result<(), ProjectError> {
    if let Some(window) = app.get_webview_window(DUAL_MONITOR_LABEL) {
        let _ = window.destroy();
    }
    Ok(())
}

/// Estado actual para que el botón del monitor pueda alternar sin adivinar.
#[tauri::command]
pub async fn dual_monitor_is_open(app: AppHandle) -> Result<bool, ProjectError> {
    Ok(app.get_webview_window(DUAL_MONITOR_LABEL).is_some())
}
