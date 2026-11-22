// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Jareer Abdullah
// SPDX-FileCopyrightText: 2026 Olyvia (extracción y adaptaciones)

//! Where a downloadable Whisper model is fetched from, and what proves it
//! arrived whole. Portado de `concat-host/src/models.rs`, reducido:
//!
//! - Sin preferencias de fuente (`SourcePreference`, base personalizada) ni
//!   proxy explícito: se prueban en orden el mirror de Concat, el upstream
//!   de Hugging Face (pineado a commit) y su espejo hf-mirror.com.
//! - Sin `net::Cause`: los errores se reportan con el mensaje del host que
//!   falló, como hacía `concat_host` antes de esa clasificación.
//! - Se conserva `supply`: una copia que la persona bajó en el navegador
//!   queda instalada sólo si su SHA-256 es el de la tabla.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};

/// The repository the mirror lives on (Concat's, public on GitHub).
pub const REPO: &str = "jub0t/Concat";

/// The release every model is mirrored on. Must match `release` in
/// Concat's `models/manifest.toml`.
pub const RELEASE: &str = "models-v1";

/// Where `file` is mirrored: Concat's own release.
pub fn mirror(file: &str) -> String {
    format!("https://github.com/{REPO}/releases/download/{RELEASE}/{file}")
}

/// The host that mirrors Hugging Face for mainland China.
const HF_MIRROR_HOST: &str = "https://hf-mirror.com/";

/// `url`, served by hf-mirror.com instead, for a Hugging Face URL; `None`
/// for anything else.
fn hf_mirror(url: &str) -> Option<String> {
    url.strip_prefix("https://huggingface.co/")
        .map(|rest| format!("{HF_MIRROR_HOST}{rest}"))
}

/// Where to try for `file`, in order: Concat's mirror, the pinned upstream
/// and its hf-mirror twin. Every source is tried; the bytes are checked
/// against the same digest whichever answers.
pub fn sources(file: &str, upstream: &str) -> Vec<String> {
    let mut ordered = vec![mirror(file), upstream.to_owned()];
    if let Some(mirrored) = hf_mirror(upstream) {
        ordered.push(mirrored);
    }
    ordered
}

/// Files the person downloaded themselves, each standing in for the
/// download of the model file it is named for; see [`supply`].
static SUPPLIED: Mutex<Vec<(String, PathBuf)>> = Mutex::new(Vec::new());

/// Hands [`fetch_model`] a copy of `file` the person downloaded themselves -
/// in a browser the network lets through when it does not let this process -
/// for the next fetch of that file to install instead of downloading.
///
/// It is held to the same digest as a download, so a wrong file is refused
/// rather than installed; and it is copied, not moved, so the person's own
/// copy stays where they put it.
pub fn supply(file: &str, path: PathBuf) {
    if let Ok(mut held) = SUPPLIED.lock() {
        held.retain(|(name, _)| name != file);
        held.push((file.to_owned(), path));
    }
}

fn take_supplied(file: &str) -> Option<PathBuf> {
    let mut held = SUPPLIED.lock().ok()?;
    let at = held.iter().position(|(name, _)| name == file)?;
    Some(held.remove(at).1)
}

/// Streams one model into `partial` through [`fetch`]: every source of
/// [`sources`] in turn, or the copy the person chose with [`supply`], and
/// the finished file checked against the digest its table carries before
/// the caller is told it arrived.
///
/// `file` is what the model is called on the mirror.
#[allow(clippy::too_many_arguments)]
pub(crate) fn fetch_model(
    file: &str,
    upstream: &str,
    partial: &Path,
    id: &str,
    estimate: u64,
    sha256: &str,
    cancel: &AtomicBool,
    progress: &mut dyn FnMut(crate::DownloadProgress),
) -> Result<(u64, u64), String> {
    let mut inner = |received: u64, total: u64| {
        progress(crate::DownloadProgress {
            id: id.to_owned(),
            received,
            total,
            unpacking: false,
            done: false,
        })
    };
    if let Some(chosen) = take_supplied(file) {
        return adopt(
            &chosen,
            file,
            partial,
            sha256,
            cancel,
            "download cancelled",
            &mut inner,
        );
    }
    let mut last = String::new();
    for url in sources(file, upstream) {
        match attempt(
            &url,
            partial,
            estimate,
            cancel,
            "download cancelled",
            &mut inner,
        ) {
            Ok(totals) => {
                verify(partial, sha256).inspect_err(|_| {
                    let _ = std::fs::remove_file(partial);
                })?;
                return Ok(totals);
            }
            Err(miss) => {
                if cancel.load(Ordering::Relaxed) {
                    return Err("download cancelled".to_owned());
                }
                log::warn!("model download: {miss}");
                last = miss;
            }
        }
    }
    Err(format!(
        "could not download {file}: every source failed; the last one said: {last}"
    ))
}

/// Installs the person's own copy of `file` as if it had been downloaded:
/// copied into `partial` by way of a file of its own, hashed as it is
/// copied, and kept only if the hash is the table's. A download half done
/// in `partial` survives a wrong file.
fn adopt(
    chosen: &Path,
    file: &str,
    partial: &Path,
    sha256: &str,
    cancel: &AtomicBool,
    cancelled: &str,
    progress: &mut dyn FnMut(u64, u64),
) -> Result<(u64, u64), String> {
    use sha2::{Digest, Sha256};
    use std::io::{Read, Write};

    if sha256.is_empty() {
        return Err(format!(
            "{file} cannot be checked: the model table carries no digest for it"
        ));
    }
    let mut source = std::fs::File::open(chosen)
        .map_err(|error| format!("could not read {}: {error}", chosen.display()))?;
    let total = source.metadata().map(|meta| meta.len()).unwrap_or(0);
    let copy = partial.with_extension("chosen");
    let mut out = std::fs::File::create(&copy)
        .map_err(|error| format!("could not write {}: {error}", copy.display()))?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 1024 * 1024];
    let mut copied = 0u64;
    let mut reported = 0u64;
    progress(0, total);
    let result = loop {
        if cancel.load(Ordering::Relaxed) {
            break Err(cancelled.to_owned());
        }
        let read = match source.read(&mut buffer) {
            Ok(0) => break Ok(()),
            Ok(read) => read,
            Err(error) => break Err(format!("could not read {}: {error}", chosen.display())),
        };
        hasher.update(&buffer[..read]);
        if let Err(error) = out.write_all(&buffer[..read]) {
            break Err(format!("could not write {}: {error}", copy.display()));
        }
        copied += read as u64;
        if copied - reported >= 8 * 1024 * 1024 {
            reported = copied;
            progress(copied, total.max(copied));
        }
    }
    .and_then(|()| {
        out.flush()
            .map_err(|error| format!("could not write {}: {error}", copy.display()))
    });
    drop(out);
    if let Err(error) = result {
        let _ = std::fs::remove_file(&copy);
        return Err(error);
    }
    let actual = hex(&hasher.finalize());
    if actual != sha256 {
        let _ = std::fs::remove_file(&copy);
        return Err(format!(
            "{} is not {file}: its sha256 is {actual}, where {file}'s is {sha256}",
            chosen.display()
        ));
    }
    std::fs::rename(&copy, partial)
        .map_err(|error| format!("could not write {}: {error}", partial.display()))?;
    progress(copied, copied);
    Ok((copied, copied))
}

/// One attempt at one URL, streamed into `partial`, taking up from
/// however much of `partial` is already there. Portado de
/// `concat_host::models::attempt`, sin la clasificación de causas de
/// `net.rs`: los errores vuelven como `Err(String)`.
///
/// A model is hundreds of megabytes, and the links this matters most on
/// are the slow ones: a dropped connection at 280 MB of 300 used to start
/// again from nothing. The bytes already on disk are kept and the server
/// is asked for the rest, by a Range request; a server that answers with
/// the whole file instead is taken at its word and the partial started
/// over. What arrives is checked against the model's digest afterwards.
fn attempt(
    url: &str,
    partial: &Path,
    estimate: u64,
    cancel: &AtomicBool,
    cancelled: &str,
    progress: &mut dyn FnMut(u64, u64),
) -> Result<(u64, u64), String> {
    use std::io::{Read, Write};

    let already = std::fs::metadata(partial)
        .map(|meta| meta.len())
        .unwrap_or(0);

    // A read timeout: a stalled connection blocks in `read` with the
    // cancel flag unreachable, and thirty seconds without a byte means
    // the download is dead.
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(std::time::Duration::from_secs(20))
        .timeout_read(std::time::Duration::from_secs(30))
        .build();
    let request = agent.get(url);
    let request = if already > 0 {
        request.set("Range", &format!("bytes={already}-"))
    } else {
        request
    };
    let response = match request.call() {
        Ok(response) => response,
        // Range not satisfiable: everything is already here. Let the
        // caller's digest check say whether it is the file.
        Err(ureq::Error::Status(416, _)) if already > 0 => return Ok((already, already)),
        Err(error) => return Err(format!("{url} did not answer: {error}")),
    };

    let resumed = response.status() == 206;
    let remaining = response
        .header("Content-Length")
        .and_then(|value| value.parse::<u64>().ok());
    let (mut received, total) = if resumed {
        (
            already,
            remaining.map_or(estimate.max(already), |rest| already + rest),
        )
    } else {
        (0, remaining.unwrap_or(estimate))
    };
    let mut file = if resumed {
        std::fs::OpenOptions::new().append(true).open(partial)
    } else {
        std::fs::File::create(partial)
    }
    .map_err(|error| format!("could not write {}: {error}", partial.display()))?;

    let mut reader = response.into_reader();
    let mut buffer = [0u8; 64 * 1024];
    let mut reported = received;
    progress(received, total);
    loop {
        if cancel.load(Ordering::Relaxed) {
            // The partial stays: it is where the next attempt picks up.
            return Err(cancelled.to_owned());
        }
        let read = reader
            .read(&mut buffer)
            .map_err(|error| format!("{url} stopped partway: {error}"))?;
        if read == 0 {
            break;
        }
        file.write_all(&buffer[..read])
            .map_err(|error| format!("could not write {}: {error}", partial.display()))?;
        received += read as u64;
        // Every 2 MB, not every chunk: a progress bar cannot use more.
        if received - reported >= 2 * 1024 * 1024 {
            reported = received;
            progress(received, total);
        }
    }
    file.flush()
        .map_err(|error| format!("could not write {}: {error}", partial.display()))?;
    if received == 0 {
        return Err(format!("{url} came back empty"));
    }
    Ok((received, received.max(total)))
}

/// Checks a finished download against the digest the table carries.
///
/// A file that does not match is refused - the caller deletes it rather
/// than leaving something that looks installed - and so is a download with
/// no digest to check against.
pub fn verify(file: &Path, expected: &str) -> Result<(), String> {
    if expected.is_empty() {
        return Err(format!(
            "{} cannot be checked: the model table carries no digest for it",
            file.display()
        ));
    }
    let actual = sha256(file)?;
    if actual == expected {
        return Ok(());
    }
    Err(format!(
        "{} is not the file it should be: expected sha256 {expected}, got {actual}",
        file.display()
    ))
}

/// The SHA-256 of a file, as lowercase hex.
fn sha256(file: &Path) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    use std::io::Read;

    let mut handle = std::fs::File::open(file)
        .map_err(|error| format!("could not read {}: {error}", file.display()))?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 1024 * 1024];
    loop {
        let read = handle
            .read(&mut buffer)
            .map_err(|error| format!("could not read {}: {error}", file.display()))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hex(&hasher.finalize()))
}

/// Bytes as lowercase hex.
fn hex(bytes: &[u8]) -> String {
    bytes
        .iter()
        .fold(String::with_capacity(bytes.len() * 2), |mut out, byte| {
            use std::fmt::Write;
            let _ = write!(out, "{byte:02x}");
            out
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sources_try_the_mirror_then_upstream_then_its_mirror() {
        let upstream = "https://huggingface.co/ggerganov/whisper.cpp/resolve/abc/ggml-tiny.bin";
        let list = sources("ggml-tiny.bin", upstream);
        assert_eq!(list[0], mirror("ggml-tiny.bin"));
        assert_eq!(list[1], upstream);
        assert_eq!(
            list[2],
            "https://hf-mirror.com/ggerganov/whisper.cpp/resolve/abc/ggml-tiny.bin"
        );
        assert_eq!(sources("f", "https://example.com/f").len(), 2);
    }

    #[test]
    fn a_partial_download_is_finished_from_a_range() {
        use std::io::{Read, Write};
        // A server that honours Range on one 1 MB file.
        let body: Vec<u8> = (0..1_048_576u32).map(|i| (i % 251) as u8).collect();
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("a port");
        let port = listener.local_addr().expect("an address").port();
        let served = body.clone();
        std::thread::spawn(move || {
            for stream in listener.incoming().take(2) {
                let mut stream = stream.expect("a connection");
                let mut head = [0u8; 4096];
                let read = stream.read(&mut head).unwrap_or(0);
                let head = String::from_utf8_lossy(&head[..read]).to_string();
                let from = head
                    .lines()
                    .find_map(|line| line.strip_prefix("Range: bytes="))
                    .and_then(|range| range.trim_end_matches('-').parse::<usize>().ok());
                let (status, slice) = match from {
                    Some(from) if from < served.len() => ("206 Partial Content", &served[from..]),
                    _ => ("200 OK", &served[..]),
                };
                let _ = write!(
                    stream,
                    "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    slice.len()
                );
                let _ = stream.write_all(slice);
            }
        });
        let url = format!("http://127.0.0.1:{port}/model.bin");
        let partial =
            std::env::temp_dir().join(format!("speech-min-partial-{}", std::process::id()));
        // Half of it is already here, as a dropped connection leaves it.
        std::fs::write(&partial, &body[..600_000]).expect("a partial");
        let cancel = AtomicBool::new(false);
        let mut reports = Vec::new();
        let (received, total) = attempt(&url, &partial, 0, &cancel, "stopped", &mut |got, of| {
            reports.push((got, of))
        })
        .expect("the rest arrives");
        assert_eq!((received, total), (body.len() as u64, body.len() as u64));
        assert_eq!(
            std::fs::read(&partial).expect("the file"),
            body,
            "the halves join up"
        );
        assert_eq!(
            reports[0],
            (600_000, body.len() as u64),
            "progress starts where the partial ended"
        );
        let _ = std::fs::remove_file(&partial);
    }

    #[test]
    fn a_digest_is_checked_and_an_empty_one_is_refused() {
        let dir = std::env::temp_dir().join(format!("speech-min-verify-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("a temp dir");
        let file = dir.join("bytes");
        std::fs::write(&file, b"concat").expect("a temp file");
        // echo -n concat | sha256sum
        let known = "3f4c1a4b3c9fb1b0e24bd1ec0bd7b16d0db4dbf1fe2f3b5dcdba0bd38b8f8b3a";
        assert!(verify(&file, "").is_err(), "nothing to check against");
        assert!(verify(&file, known).is_err());
        let actual = sha256(&file).expect("a digest");
        assert_eq!(actual.len(), 64);
        assert!(verify(&file, &actual).is_ok());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
