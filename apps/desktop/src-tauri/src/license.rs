//! Licencias offline de Olyvia.
//!
//! La build embebe una clave pública Ed25519. El archivo que entrega el
//! vendedor contiene un payload firmado; la app no puede fabricar licencias.
//! El estado local se guarda cifrado con AES-256-GCM y una clave derivada de
//! la máquina para que copiar `license.bin` a otra PC no alcance.

use base64::Engine;
use ring::rand::SystemRandom;
use ring::signature::{UnparsedPublicKey, ED25519};
use serde::{Deserialize, Serialize};

const LICENSE_PRODUCT: &str = "olyvia";
const STORE_MAGIC: &[u8; 12] = b"OLYVIA-LIC1\0";
const STORE_NONCE_LEN: usize = 12;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LicenseTier {
    Free,
    Pro,
}

impl Default for LicenseTier {
    fn default() -> Self {
        Self::Free
    }
}

impl std::fmt::Display for LicenseTier {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::Free => "free",
            Self::Pro => "pro",
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LicensePayload {
    pub v: u32,
    pub product: String,
    pub tier: LicenseTier,
    pub license_id: String,
    pub email: String,
    pub issued_at: String,
    pub expires_at_unix: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LicenseError {
    pub message: String,
}

impl LicenseError {
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl std::fmt::Display for LicenseError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for LicenseError {}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LicenseFile {
    payload: String,
    signature: String,
}

pub fn verify_license(
    payload: &[u8],
    signature: &[u8],
    public_key: &[u8],
) -> Result<LicensePayload, LicenseError> {
    let key = UnparsedPublicKey::new(&ED25519, public_key);
    key.verify(payload, signature)
        .map_err(|_| LicenseError::new("la firma del archivo de licencia no es válida"))?;
    let parsed: LicensePayload = serde_json::from_slice(payload)
        .map_err(|_| LicenseError::new("el archivo de licencia no contiene un payload válido"))?;
    if parsed.v != 1 {
        return Err(LicenseError::new(
            "esta versión de Olyvia no reconoce el formato de licencia",
        ));
    }
    if parsed.product != LICENSE_PRODUCT {
        return Err(LicenseError::new(
            "la licencia pertenece a otro producto y no se puede usar en Olyvia",
        ));
    }
    if parsed.tier != LicenseTier::Pro {
        return Err(LicenseError::new(
            "el archivo no contiene una licencia Pro utilizable",
        ));
    }
    if let Some(expires) = parsed.expires_at_unix {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_secs())
            .unwrap_or(0);
        if expires < now {
            return Err(LicenseError::new("la licencia está vencida"));
        }
    }
    Ok(parsed)
}

pub fn parse_license_file(
    text: &str,
    public_key: &[u8],
) -> Result<LicensePayload, LicenseError> {
    let file: LicenseFile = serde_json::from_str(text)
        .map_err(|_| LicenseError::new("el archivo no es una licencia de Olyvia"))?;
    let payload = base64::engine::general_purpose::STANDARD
        .decode(file.payload)
        .map_err(|_| LicenseError::new("el payload de la licencia está corrupto"))?;
    let signature = base64::engine::general_purpose::STANDARD
        .decode(file.signature)
        .map_err(|_| LicenseError::new("la firma de la licencia está corrupta"))?;
    verify_license(&payload, &signature, public_key)
}

/// Clave local para cifrar el estado. No es una protección DRM: impide que
/// copiar el archivo a otra máquina active Pro, pero el binario contiene el
/// secreto de la aplicación. La validación fuerte es la firma Ed25519.
pub fn store_key(secret: &str, machine: &str) -> [u8; 32] {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(secret.as_bytes());
    hasher.update(b"|olyvia-license-store-v1|");
    hasher.update(machine.as_bytes());
    hasher.finalize().into()
}

pub fn encrypt_store(key: &[u8; 32], data: &[u8]) -> Result<Vec<u8>, LicenseError> {
    use ring::aead::{Aad, LessSafeKey, Nonce, UnboundKey, AES_256_GCM};
    let rng = SystemRandom::new();
    let mut nonce_bytes = [0u8; STORE_NONCE_LEN];
    ring::rand::SecureRandom::fill(&rng, &mut nonce_bytes)
        .map_err(|_| LicenseError::new("no se pudo generar el nonce de la licencia"))?;
    let unbound = UnboundKey::new(&AES_256_GCM, key)
        .map_err(|_| LicenseError::new("la clave local de licencia no es válida"))?;
    let key = LessSafeKey::new(unbound);
    let nonce = Nonce::assume_unique_for_key(nonce_bytes);
    let mut sealed = data.to_vec();
    key.seal_in_place_append_tag(nonce, Aad::empty(), &mut sealed)
        .map_err(|_| LicenseError::new("no se pudo cifrar la licencia local"))?;
    let mut output = Vec::with_capacity(STORE_MAGIC.len() + STORE_NONCE_LEN + sealed.len());
    output.extend_from_slice(STORE_MAGIC);
    output.extend_from_slice(&nonce_bytes);
    output.extend_from_slice(&sealed);
    Ok(output)
}

pub fn decrypt_store(key: &[u8; 32], blob: &[u8]) -> Result<Vec<u8>, LicenseError> {
    use ring::aead::{Aad, LessSafeKey, Nonce, UnboundKey, AES_256_GCM};
    if blob.len() < STORE_MAGIC.len() + STORE_NONCE_LEN + 16 || &blob[..STORE_MAGIC.len()] != STORE_MAGIC {
        return Err(LicenseError::new("el archivo de licencia local no tiene el formato esperado"));
    }
    let nonce_bytes: [u8; STORE_NONCE_LEN] = blob[STORE_MAGIC.len()..STORE_MAGIC.len() + STORE_NONCE_LEN]
        .try_into()
        .map_err(|_| LicenseError::new("el nonce de la licencia local está corrupto"))?;
    let unbound = UnboundKey::new(&AES_256_GCM, key)
        .map_err(|_| LicenseError::new("la clave local de licencia no es válida"))?;
    let key = LessSafeKey::new(unbound);
    let mut payload = blob[STORE_MAGIC.len() + STORE_NONCE_LEN..].to_vec();
    let plain = key
        .open_in_place(Nonce::assume_unique_for_key(nonce_bytes), Aad::empty(), &mut payload)
        .map_err(|_| LicenseError::new("no se pudo descifrar la licencia local en esta máquina"))?;
    Ok(plain.to_vec())
}

pub fn check_parallel(tier: LicenseTier, active: usize) -> Result<(), LicenseError> {
    if tier == LicenseTier::Free && active >= 2 {
        return Err(LicenseError::new(
            "El plan Free permite 2 descargas simultáneas. Activá Pro para ampliar la cola.",
        ));
    }
    Ok(())
}

pub fn check_download(
    tier: LicenseTier,
    max_height: Option<u32>,
    codec: Option<&str>,
    format: Option<&str>,
    hdr_mode: Option<&str>,
    upscale_target: Option<&str>,
    sponsorblock: bool,
) -> Result<(), LicenseError> {
    if tier == LicenseTier::Pro {
        return Ok(());
    }
    if max_height.is_some_and(|height| height > 1080) {
        return Err(LicenseError::new(
            "El plan Free permite hasta 1080p. Activá Pro para descargar 4K/8K.",
        ));
    }
    if matches!(codec, Some("h265") | Some("av1")) {
        return Err(LicenseError::new(
            "El plan Free descarga MP4/H.264. HEVC y AV1 requieren Pro.",
        ));
    }
    if hdr_mode == Some("preserve") {
        return Err(LicenseError::new(
            "El HDR 10-bit requiere el plan Pro.",
        ));
    }
    if matches!(upscale_target, Some("2160") | Some("auto")) {
        return Err(LicenseError::new(
            "El upscale a 4K requiere el plan Pro.",
        ));
    }
    if sponsorblock {
        return Err(LicenseError::new(
            "El borrado automático de SponsorBlock requiere el plan Pro.",
        ));
    }
    if let Some(format) = format {
        if format != "mp4" && format != "mp3" && format != "m4a" {
            return Err(LicenseError::new(
                "El plan Free exporta MP4, MP3 o M4A. MKV/WebM requieren Pro.",
            ));
        }
    }
    Ok(())
}

pub fn check_render(
    tier: LicenseTier,
    width: u32,
    height: u32,
    video_codec: &str,
) -> Result<(), LicenseError> {
    if tier == LicenseTier::Pro {
        return Ok(());
    }
    if width > 1920 || height > 1080 {
        return Err(LicenseError::new(
            "La exportación por encima de 1080p requiere el plan Pro.",
        ));
    }
    if video_codec != "h264" {
        return Err(LicenseError::new(
            "El plan Free exporta H.264. H.265 y otros códecs requieren Pro.",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    const TEST_PUBLIC: &str = "j64kkprKyzGztX5Tqje/qPrZ5xyqDL9A8vvJt65VJhQ=";
    const GOOD_LICENSE: &str = r#"{"payload":"eyJ2IjoxLCJwcm9kdWN0Ijoib2x5dmlhIiwidGllciI6InBybyIsImxpY2Vuc2VJZCI6ImxpYy10ZXN0IiwiZW1haWwiOiJ0ZXN0ZXJAZXhhbXBsZS5jb20iLCJpc3N1ZWRBdCI6IjIwMjYtMTAtMjhUMDA6MDA6MDBaIiwiZXhwaXJlc0F0VW5peCI6bnVsbH0=","signature":"Sl64u3L5docrlkp9mAAw8+pxU/f4kzC3DQV5c3WJ7pMRlMmvxNuKGaDQxHAMhWTvizrT/5Hq1jydZDi0F4zTAQ=="}"#;
    const OTHER_PRODUCT_LICENSE: &str = r#"{"payload":"eyJ2IjoxLCJwcm9kdWN0Ijoib3RybyIsInRpZXIiOiJwcm8iLCJsaWNlbnNlSWQiOiJ4IiwiZW1haWwiOiJ4IiwiaXNzdWVkQXQiOiJ4IiwiZXhwaXJlc0F0VW5peCI6bnVsbH0=","signature":"iO9b6FpawXGsMS4tOuRGM0qg7iWgoKnU7rxQqbqJ3aDPfajccF+9k2E/qrN14A9r2FoC9tGHSvasQLI9xXebCQ=="}"#;
    const EXPIRED_LICENSE: &str = r#"{"payload":"eyJ2IjoxLCJwcm9kdWN0Ijoib2x5dmlhIiwidGllciI6InBybyIsImxpY2Vuc2VJZCI6IngiLCJlbWFpbCI6IngiLCJpc3N1ZWRBdCI6IngiLCJleHBpcmVzQXRVbml4IjoxfQ==","signature":"0zZ9xje5q0CCZCoXktTtlJ8Wppm3LOjCFPBcEus4VXoJ24RBMs4yeZ3hIwUpr3aX3sDagU2OOM+t/K/wrJmOAA=="}"#;

    fn public_key() -> Vec<u8> {
        base64::engine::general_purpose::STANDARD
            .decode(TEST_PUBLIC)
            .unwrap()
    }

    #[test]
    fn acepta_una_licencia_firmada_y_rechaza_manipulacion() {
        let parsed = parse_license_file(GOOD_LICENSE, &public_key()).unwrap();
        assert_eq!(parsed.tier, LicenseTier::Pro);
        assert_eq!(parsed.license_id, "lic-test");

        let mut file: serde_json::Value = serde_json::from_str(GOOD_LICENSE).unwrap();
        file["payload"] = serde_json::json!(
            base64::engine::general_purpose::STANDARD.encode(
                br#"{"v":1,"product":"olyvia","tier":"pro","licenseId":"forged","email":"x","issuedAt":"x","expiresAtUnix":null}"#
            )
        );
        assert!(parse_license_file(&file.to_string(), &public_key()).is_err());
    }

    #[test]
    fn rechaza_otro_producto_y_licencias_vencidas() {
        assert!(parse_license_file(OTHER_PRODUCT_LICENSE, &public_key()).is_err());
        assert!(parse_license_file(EXPIRED_LICENSE, &public_key()).is_err());
    }

    #[test]
    fn cifra_el_estado_y_falla_en_otra_maquina() {
        let key = store_key("secreto-de-prueba", "MAQUINA-A");
        let blob = encrypt_store(&key, b"contenido de licencia").unwrap();
        assert_eq!(
            decrypt_store(&key, &blob).unwrap(),
            b"contenido de licencia"
        );
        let other = store_key("secreto-de-prueba", "MAQUINA-B");
        assert!(decrypt_store(&other, &blob).is_err());
    }

    #[test]
    fn free_limita_descargas_y_exportaciones() {
        assert!(check_download(LicenseTier::Free, Some(1080), Some("h264"), Some("mp4"), None, None, false).is_ok());
        assert!(check_download(LicenseTier::Free, Some(2160), Some("h264"), Some("mp4"), None, None, false).is_err());
        assert!(check_download(LicenseTier::Free, Some(1080), Some("h265"), Some("mp4"), None, None, false).is_err());
        assert!(check_download(LicenseTier::Free, Some(1080), Some("h264"), Some("mp4"), Some("preserve"), None, false).is_err());
        assert!(check_download(LicenseTier::Free, Some(1080), Some("h264"), Some("mp4"), None, Some("auto"), false).is_err());
        assert!(check_download(LicenseTier::Free, Some(1080), Some("h264"), Some("mp4"), None, None, true).is_err());
        assert!(check_download(LicenseTier::Free, Some(1080), Some("h264"), Some("mkv"), None, None, false).is_err());

        assert!(check_parallel(LicenseTier::Free, 1).is_ok());
        assert!(check_parallel(LicenseTier::Free, 2).is_err());
        assert!(check_parallel(LicenseTier::Pro, 500).is_ok());
        assert!(check_render(LicenseTier::Free, 1920, 1080, "h264").is_ok());
        assert!(check_render(LicenseTier::Free, 3840, 2160, "h264").is_err());
        assert!(check_render(LicenseTier::Free, 1920, 1080, "h265").is_err());
        assert!(check_download(LicenseTier::Pro, Some(4320), Some("av1"), Some("mkv"), Some("preserve"), Some("2160"), true).is_ok());
        assert!(check_render(LicenseTier::Pro, 3840, 2160, "h265").is_ok());
    }
}
