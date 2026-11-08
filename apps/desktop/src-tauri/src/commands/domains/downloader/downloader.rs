//! Social media downloader and post-download compression.
//!
//! The frontend never passes shell arguments: this module builds the yt-dlp and
//! FFmpeg argument vectors, validates the URL, caps galleries and verifies the
//! downloaded files before returning their paths. The engine is a separate
//! open-source executable; it is not bundled with Editor IA.

use std::collections::{BTreeMap, HashMap};
use std::io::{BufRead, BufReader, Read};
use std::net::IpAddr;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

use md5::Md5;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;
use uuid::Uuid;

use crate::commands::system::resolve_tools;
use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::state::AppState;

include!("downloader/control.rs");
include!("downloader/engine.rs");
include!("downloader/probe.rs");
include!("downloader/media_filters.rs");
include!("downloader/pipeline.rs");
include!("downloader/output.rs");

#[cfg(test)]
#[path = "downloader.tests.rs"]
mod tests;
