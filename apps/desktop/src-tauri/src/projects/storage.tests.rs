use super::{read_project_file, write_project_file, ProjectErrorCode, MAX_PROJECT_FILE_BYTES};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

static COUNTER: AtomicU64 = AtomicU64::new(0);

struct TestDir(PathBuf);

impl TestDir {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!(
            "olyvia-project-storage-{}-{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::SeqCst)
        ));
        fs::create_dir_all(&path).expect("create isolated test directory");
        Self(path)
    }

    fn file(&self) -> PathBuf {
        self.0.join("project.editoria.json")
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        if self.0.is_dir() {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
}

#[test]
fn refuses_to_write_a_project_larger_than_the_read_limit() {
    let dir = TestDir::new();
    let path = dir.file();
    fs::write(&path, b"previous valid contents").expect("seed existing project");
    let oversized = "x".repeat(MAX_PROJECT_FILE_BYTES as usize + 1);

    let error = write_project_file(&path, &oversized)
        .expect_err("oversized projects must be rejected before creating a temp file");

    assert_eq!(error.code, ProjectErrorCode::FileTooLarge);
    assert_eq!(
        fs::read(&path).expect("existing project remains readable"),
        b"previous valid contents",
        "a rejected save must preserve the previous file"
    );
    assert_eq!(
        fs::read_dir(&dir.0).expect("list test directory").count(),
        1,
        "a rejected save must not leave a temporary file"
    );
}

#[test]
fn accepts_a_project_exactly_at_the_read_limit() {
    let dir = TestDir::new();
    let path = dir.file();
    let contents = "x".repeat(MAX_PROJECT_FILE_BYTES as usize);

    let written = write_project_file(&path, &contents).expect("exact limit is allowed");

    assert_eq!(written, MAX_PROJECT_FILE_BYTES);
    assert_eq!(
        fs::metadata(&path).expect("project exists").len(),
        MAX_PROJECT_FILE_BYTES
    );
    assert_eq!(
        read_project_file(&path).expect("the just-written project must be readable"),
        contents
    );
}

#[test]
fn refuses_to_read_a_project_larger_than_the_limit() {
    let dir = TestDir::new();
    let path = dir.file();
    let oversized = vec![b'x'; MAX_PROJECT_FILE_BYTES as usize + 1];
    fs::write(&path, oversized).expect("write oversized fixture");

    let error = read_project_file(&path).expect_err("oversized files must be rejected");

    assert_eq!(error.code, ProjectErrorCode::FileTooLarge);
}

#[test]
fn rejects_a_directory_as_a_project_file() {
    let dir = TestDir::new();

    let error = read_project_file(&dir.0).expect_err("directories are not project files");

    assert_eq!(error.code, ProjectErrorCode::NotFound);
}
