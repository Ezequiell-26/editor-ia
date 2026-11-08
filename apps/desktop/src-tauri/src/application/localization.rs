//! Casos de uso de Localization Studio: publicar un subtítulo traducido con
//! nombre seguro, único y escritura atómica.

use std::path::PathBuf;

use crate::media::localized_subtitle::{
    localized_file_name, safe_token, validate_content, validate_format,
    SaveLocalizedSubtitleRequest, SaveLocalizedSubtitleResult,
};
use crate::ports::media::LocalizedSubtitleFiles;
use crate::projects::service::{ProjectError, ProjectErrorCode};

pub fn save_localized_subtitle(
    files: &dyn LocalizedSubtitleFiles,
    request: SaveLocalizedSubtitleRequest,
) -> Result<SaveLocalizedSubtitleResult, ProjectError> {
    let format = validate_format(&request.format)?;
    validate_content(&request.content, format)?;
    let output_dir = PathBuf::from(request.output_dir.trim());
    if output_dir.as_os_str().is_empty() || !files.output_dir_exists(&output_dir) {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "la carpeta de destino de los subtítulos no existe",
        ));
    }
    let base = safe_token(&request.base_name, "subtitulos");
    let language = safe_token(&request.language, "xx");
    let mut index = 1u32;
    let final_path = loop {
        let candidate = output_dir.join(localized_file_name(&base, &language, format, index));
        if !files.candidate_exists(&candidate) {
            break candidate;
        }
        index += 1;
    };
    let (temp_path, written) = files.write_temp(&output_dir, format, &request.content)?;
    files.publish(&temp_path, &final_path)?;
    let published = files.file_len(&final_path).unwrap_or(written);
    Ok(SaveLocalizedSubtitleResult {
        path: final_path.to_string_lossy().into_owned(),
        bytes: published,
        format: format.to_owned(),
        language,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ports::media::LocalizedSubtitleFiles;
    use std::path::{Path, PathBuf};
    use std::sync::Mutex;

    const SRT: &str = "1\n00:00:00,000 --> 00:00:01,500\nHola mundo\n";

    /// Store en memoria que reproduce el comportamiento del adaptador real:
    /// temporal + publish atómico + existencia por nombre.
    struct MemFiles {
        dir: PathBuf,
        files: Mutex<std::collections::HashMap<PathBuf, Vec<u8>>>,
    }

    impl MemFiles {
        fn new() -> Self {
            let dir =
                std::env::temp_dir().join(format!("editoria-loc-mem-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&dir).expect("carpeta temporal");
            Self {
                dir,
                files: Mutex::new(std::collections::HashMap::new()),
            }
        }
    }

    impl LocalizedSubtitleFiles for MemFiles {
        fn output_dir_exists(&self, dir: &Path) -> bool {
            dir.is_dir()
        }
        fn candidate_exists(&self, path: &Path) -> bool {
            self.files.lock().unwrap().contains_key(path)
        }
        fn write_temp(
            &self,
            dir: &Path,
            extension: &str,
            content: &str,
        ) -> Result<(PathBuf, u64), ProjectError> {
            let temp = dir.join(format!(".localized-mem.{extension}"));
            self.files
                .lock()
                .unwrap()
                .insert(temp.clone(), content.as_bytes().to_vec());
            Ok((temp, content.len() as u64))
        }
        fn file_len(&self, path: &Path) -> Option<u64> {
            self.files
                .lock()
                .unwrap()
                .get(path)
                .map(|bytes| bytes.len() as u64)
        }
        fn publish(&self, temp: &Path, final_path: &Path) -> Result<(), ProjectError> {
            let mut files = self.files.lock().unwrap();
            let bytes = files
                .remove(temp)
                .ok_or_else(|| ProjectError::message(ProjectErrorCode::Io, "sin temporal"))?;
            files.insert(final_path.to_path_buf(), bytes);
            Ok(())
        }
    }

    fn request(dir: &Path, content: &str, format: &str) -> SaveLocalizedSubtitleRequest {
        SaveLocalizedSubtitleRequest {
            content: content.to_owned(),
            output_dir: dir.to_string_lossy().into_owned(),
            base_name: "Mi Video: Ñandú / 2026".to_owned(),
            language: "EN".to_owned(),
            format: format.to_owned(),
        }
    }

    #[test]
    fn publishes_with_safe_unique_names() {
        let files = MemFiles::new();
        let first = save_localized_subtitle(&files, request(&files.dir, SRT, "srt")).unwrap();
        assert!(first.path.ends_with("mi-video-nandu-2026.en.srt"));
        let second = save_localized_subtitle(&files, request(&files.dir, SRT, "srt")).unwrap();
        assert!(second.path.ends_with("mi-video-nandu-2026.en-2.srt"));
    }

    #[test]
    fn rejects_bad_format_content_and_destination() {
        let files = MemFiles::new();
        assert!(save_localized_subtitle(&files, request(&files.dir, SRT, "ass")).is_err());
        assert!(save_localized_subtitle(&files, request(&files.dir, "", "srt")).is_err());
        assert!(
            save_localized_subtitle(&files, request(&files.dir, "sin tiempos", "srt")).is_err()
        );
        assert!(
            save_localized_subtitle(&files, request(&files.dir, "sin cabecera", "vtt")).is_err()
        );
        let mut missing = request(&files.dir, SRT, "srt");
        missing.output_dir = files.dir.join("no-existe").to_string_lossy().into_owned();
        assert!(save_localized_subtitle(&files, missing).is_err());
    }
}
