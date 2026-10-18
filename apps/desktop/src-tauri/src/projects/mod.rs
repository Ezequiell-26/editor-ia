mod service;
mod storage;

#[cfg(test)]
mod tests;

pub use service::{create_project, open_project, save_project};
pub use storage::ProjectDocument;
