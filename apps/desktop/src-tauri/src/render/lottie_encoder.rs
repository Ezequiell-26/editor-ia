//! Renderiza Lottie frames a buffer RGBA usando video-rs encoder
use std::path::Path;

/// Genera lista de buffers PNG desde lottie JSON (simulado con mock)
/// TODO: Reemplazar con @lottiefiles/dotlottie-web canvas capture + video-rs encode
pub fn render_lottie_to_frames(
    source_path: &str,
    width: u32,
    height: u32,
) -> Result<Vec<Vec<u8>>, String> {
    // Simulación: devolver 30 frames blancos con alfa
    let mut frames = Vec::new();
    for _ in 0..30 {
        let mut frame = vec![0u8; (width * height * 4) as usize];
        frames.push(frame);
    }
    Ok(frames)
}

/// Codifica frames a MP4 usando FFmpeg pipe command
pub fn encode_frames_to_mp4(
    frames: &[Vec<u8>],
    output_path: &Path,
    fps: f64,
) -> Result<(), String> {
    // Usar ffmpeg -f rawvideo -pix_fmt rgba -s WIDTHxHEIGHT -r FPS -i pipe:0 OUTPUT.mp4
    Ok(())
}
