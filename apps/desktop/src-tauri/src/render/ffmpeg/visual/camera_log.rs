// Perfiles de cámara log → Rec.709 (paridad con `luts_camera.js` de
// AlaukCut): curvas de decodificación por fabricante, matriz de gamut a
// Rec.709, saturación/exposición/filmic, ajuste de temperatura y OETF
// BT.1886. En lugar de empaquetar LUTs binarios se genera un `.cube`
// 3D (33³) por perfil en el directorio temporal del render y se aplica
// con el `lut3d` ya existente — la fórmula es la misma que AlaukCut
// registra como LUT de 65³, evaluada una vez por render.

const D65: [f64; 2] = [0.3127, 0.329];

type Vec3 = [f64; 3];
type Mat3 = [[f64; 3]; 3];

#[derive(Clone, Copy)]
struct Curve {
    /// true si la entrada legal de 10 bits se expande a full range antes
    /// de decodificar (`legal` en AlaukCut).
    legal: bool,
    dec: fn(f64) -> f64,
}

fn dec_slog3(y: f64) -> f64 {
    if y >= 171.2102946929 / 1023.0 {
        10f64.powf((y * 1023.0 - 420.0) / 261.5) * (0.18 + 0.01) - 0.01
    } else {
        (y * 1023.0 - 95.0) * 0.01125 / (171.2102946929 - 95.0)
    }
}

fn dec_vlog(y: f64) -> f64 {
    if y < 0.181 {
        (y - 0.125) / 5.6
    } else {
        10f64.powf((y - 0.598206) / 0.241514) - 0.00873
    }
}

fn dec_nlog(y: f64) -> f64 {
    if y < 452.0 / 1023.0 {
        (y / (650.0 / 1023.0)).powi(3) - 0.0075
    } else {
        ((y - 619.0 / 1023.0) / (150.0 / 1023.0)).exp()
    }
}

fn dec_dlog(y: f64) -> f64 {
    if y <= 0.14 {
        (y - 0.0929) / 6.025
    } else {
        (10f64.powf(3.89616 * y - 2.27752) - 0.0108) / 0.9892
    }
}

fn dec_clog3(y: f64) -> f64 {
    0.9 * if y < 0.097465473 {
        -(10f64.powf((0.12783901 - y) / 0.36726845) - 1.0) / 14.98325
    } else if y <= 0.15277891 {
        (y - 0.12512219) / 1.9754798
    } else {
        (10f64.powf((y - 0.12240537) / 0.36726845) - 1.0) / 14.98325
    }
}

fn dec_gplog(y: f64) -> f64 {
    (400f64.powf(y) - 1.0) / 399.0
}

const CURVES: &[(&str, Curve)] = &[
    ("slog3", Curve { legal: true, dec: dec_slog3 }),
    ("vlog", Curve { legal: true, dec: dec_vlog }),
    ("nlog", Curve { legal: true, dec: dec_nlog }),
    ("dlog", Curve { legal: true, dec: dec_dlog }),
    ("clog3", Curve { legal: true, dec: dec_clog3 }),
    ("gplog", Curve { legal: false, dec: dec_gplog }),
];

fn curve_by_id(id: &str) -> Option<Curve> {
    CURVES.iter().find(|(name, _)| *name == id).map(|(_, c)| *c)
}

/// Legal 10-bit code value (0..1) → full-range float.
fn legal(v: f64) -> f64 {
    (876.0 * v + 64.0) / 1023.0
}

fn primaries(gamut: &str) -> Option<[[f64; 2]; 3]> {
    Some(match gamut {
        "rec709" => [[0.64, 0.33], [0.3, 0.6], [0.15, 0.06]],
        "sgamut3cine" => [[0.766, 0.275], [0.225, 0.8], [0.089, -0.087]],
        "vgamut" => [[0.73, 0.28], [0.165, 0.84], [0.1, -0.03]],
        "ngamut" => [[0.708, 0.292], [0.17, 0.797], [0.131, 0.046]],
        "dgamut" => [[0.71, 0.31], [0.21, 0.88], [0.09, -0.08]],
        "cinemagamut" => [[0.74, 0.27], [0.17, 1.14], [0.08, -0.1]],
        _ => return None,
    })
}

fn mulv(m: &Mat3, v: Vec3) -> Vec3 {
    [
        m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
        m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
        m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
    ]
}

fn mul(a: &Mat3, b: &Mat3) -> Mat3 {
    let mut out = [[0.0; 3]; 3];
    for (i, row) in out.iter_mut().enumerate() {
        for (j, cell) in row.iter_mut().enumerate() {
            *cell = a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j];
        }
    }
    out
}

fn inv3(m: &Mat3) -> Mat3 {
    let [a, b, c] = m[0];
    let [d, e, f] = m[1];
    let [g, h, i] = m[2];
    let aa = e * i - f * h;
    let bb = -(d * i - f * g);
    let cc = d * h - e * g;
    let det = a * aa + b * bb + c * cc;
    [
        [aa / det, -(b * i - c * h) / det, (b * f - c * e) / det],
        [bb / det, (a * i - c * g) / det, -(a * f - c * d) / det],
        [cc / det, -(a * h - b * g) / det, (a * e - b * d) / det],
    ]
}

/// Matriz RGB→XYZ con blanco normalizado a D65 (equivale a `npm` de
/// AlaukCut: primarias xy → XYZ por columna, escaladas por M⁻¹·D65).
fn rgb_to_xyz(p: &[[f64; 2]; 3]) -> Mat3 {
    let column = |xy: [f64; 2]| -> Vec3 {
        [xy[0] / xy[1], 1.0, (1.0 - xy[0] - xy[1]) / xy[1]]
    };
    let c0 = column(p[0]);
    let c1 = column(p[1]);
    let c2 = column(p[2]);
    // M con las columnas XYZ de cada primaria.
    let m: Mat3 = [
        [c0[0], c1[0], c2[0]],
        [c0[1], c1[1], c2[1]],
        [c0[2], c1[2], c2[2]],
    ];
    let minv = inv3(&m);
    let d65xyz: Vec3 = [
        D65[0] / D65[1],
        1.0,
        (1.0 - D65[0] - D65[1]) / D65[1],
    ];
    let s = mulv(&minv, d65xyz);
    let mut out = m;
    for j in 0..3 {
        for row in &mut out {
            row[j] *= s[j];
        }
    }
    out
}

/// Matriz gamut→Rec.709 (equivale a `PARA_709[gamut]`).
fn gamut_to_709(gamut: &str) -> Option<Mat3> {
    let xyz_709_inv = inv3(&rgb_to_xyz(&primaries("rec709")?));
    Some(mul(&xyz_709_inv, &rgb_to_xyz(&primaries(gamut)?)))
}

#[derive(Clone, Copy)]
struct Visual {
    exposure: f64,
    saturation: f64,
    warm: f64,
    cool: f64,
}

/// Los 8 perfiles registrados por `luts_camera.js` (id, curva, gamut,
/// acabado visual).
const PROFILES: &[(&str, &str, &str, Visual)] = &[
    ("vlog709", "vlog", "vgamut", Visual { exposure: 0.5, saturation: 0.9, warm: 0.0, cool: 0.0 }),
    ("slog3709", "slog3", "sgamut3cine", Visual { exposure: 0.5, saturation: 0.9, warm: 0.0, cool: 0.0 }),
    ("slog3cinema", "slog3", "sgamut3cine", Visual { exposure: 0.45, saturation: 0.75, warm: 0.04, cool: 0.04 }),
    ("nlog709", "nlog", "ngamut", Visual { exposure: 0.5, saturation: 0.9, warm: 0.0, cool: 0.0 }),
    ("nlogcinema", "nlog", "ngamut", Visual { exposure: 0.45, saturation: 0.75, warm: 0.04, cool: 0.04 }),
    ("gplog709", "gplog", "rec709", Visual { exposure: 0.5, saturation: 0.9, warm: 0.0, cool: 0.0 }),
    ("dlog709", "dlog", "dgamut", Visual { exposure: 0.5, saturation: 0.9, warm: 0.0, cool: 0.0 }),
    ("clog3709", "clog3", "cinemagamut", Visual { exposure: 0.5, saturation: 0.9, warm: 0.0, cool: 0.0 }),
];

fn filmic(x: f64) -> f64 {
    let x = x.max(0.0);
    (x * (2.51 * x + 0.03) / (x * (2.43 * x + 0.59) + 0.14)).min(1.0)
}

fn bt1886(l: f64) -> f64 {
    l.max(0.0).powf(1.0 / 2.4)
}

/// Evalúa el perfil sobre un RGB de entrada normalizado [0,1]. Réplica
/// exacta de `formula(curva, gamut, visual)` de AlaukCut.
fn profile_rgb(profile: &str, r: f64, g: f64, b: f64) -> Option<Vec3> {
    let (_, curve_id, gamut_id, visual) = PROFILES.iter().find(|(id, _, _, _)| *id == profile)?;
    let curve = curve_by_id(curve_id)?;
    let m = gamut_to_709(gamut_id)?;
    let dec = |v: f64| {
        let cv = if curve.legal { legal(v.clamp(0.0, 1.0)) } else { v.clamp(0.0, 1.0) };
        (curve.dec)(cv)
    };
    let mut c = mulv(&m, [dec(r), dec(g), dec(b)]);
    if (visual.saturation - 1.0).abs() > 1e-9 {
        let y = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
        for v in c.iter_mut() {
            *v = y + (*v - y) * visual.saturation;
        }
    }
    for v in c.iter_mut() {
        *v = filmic(visual.exposure * *v);
    }
    if visual.warm != 0.0 || visual.cool != 0.0 {
        let y = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
        let luz = y * y;
        let sombra = (1.0 - y) * (1.0 - y);
        c[0] *= 1.0 + visual.warm * luz - visual.cool * sombra;
        c[2] *= 1.0 - visual.warm * luz + visual.cool * sombra;
    }
    Some(c.map(|v| bt1886(v).min(1.0)))
}

/// Contenido `.cube` 3D del perfil (LUT_3D_SIZE³, rojo más rápido).
/// Devuelve `None` si el id no existe.
pub(crate) fn camera_cube_text(profile: &str) -> Option<String> {
    profile_rgb(profile, 0.0, 0.0, 0.0)?; // valida el id antes de generar
    const SIZE: usize = 33;
    let mut out = String::with_capacity(SIZE * SIZE * SIZE * 24 + 64);
    out.push_str("TITLE \"Editor IA camera log profile\"\n");
    out.push_str(&format!("LUT_3D_SIZE {SIZE}\n"));
    out.push_str("DOMAIN_MIN 0.0 0.0 0.0\nDOMAIN_MAX 1.0 1.0 1.0\n");
    for b in 0..SIZE {
        for g in 0..SIZE {
            for r in 0..SIZE {
                let (rf, gf, bf) = (r as f64, g as f64, b as f64);
                let scale = (SIZE - 1) as f64;
                let rgb = profile_rgb(
                    profile,
                    rf / scale,
                    gf / scale,
                    bf / scale,
                )
                .unwrap_or([0.0, 0.0, 0.0]);
                out.push_str(&format!("{:.6} {:.6} {:.6}\n", rgb[0], rgb[1], rgb[2]));
            }
        }
    }
    Some(out)
}

/// Escribe el `.cube` del perfil en `temp_dir` (una vez por perfil y
/// render) y devuelve la ruta lista para `lut_filter`. `None` si el
/// `effects.cameraProfile` está vacío o no es un id válido — en ese caso
/// el render sigue sin perfil en vez de fallar el export.
pub(crate) fn camera_lut_path(effects: &Value, temp_dir: &Path) -> Option<PathBuf> {
    let profile = effects["cameraProfile"].as_str()?.trim();
    if profile.is_empty() || !PROFILES.iter().any(|(id, _, _, _)| *id == profile) {
        return None;
    }
    let path = temp_dir.join(format!("camera-{profile}.cube"));
    if !path.exists() {
        let text = camera_cube_text(profile)?;
        std::fs::write(&path, text).ok()?;
    }
    Some(path)
}

#[cfg(test)]
mod camera_log_tests {
    use super::*;

    #[test]
    fn every_profile_generates_a_valid_cube() {
        for (id, _, _, _) in PROFILES {
            let text = camera_cube_text(id).expect("profile produces cube");
            assert!(text.starts_with("TITLE"));
            assert!(text.contains("LUT_3D_SIZE 33"));
            let entries = text
                .lines()
                .filter(|l| l.chars().next().is_some_and(|c| c.is_ascii_digit() || c == '.'))
                .count();
            assert_eq!(entries, 33 * 33 * 33, "{id} entries");
        }
    }

    #[test]
    fn slog3_mid_gray_is_not_black() {
        // Código legal medio (~18% reflectancia en S-Log3) debe dar un
        // gris visible, no negro ni saturado.
        let (_, _, _, _) = PROFILES[1];
        let out = profile_rgb("slog3709", 0.5, 0.5, 0.5).unwrap();
        assert!(out[0] > 0.05 && out[0] < 0.95, "{out:?}");
        assert!((out[0] - out[1]).abs() < 1e-6 && (out[1] - out[2]).abs() < 1e-6);
    }

    #[test]
    fn gamut_matrix_is_invertible_pair() {
        // Rec.709 → Rec.709 debe ser ~identidad.
        let m = gamut_to_709("rec709").unwrap();
        let v = mulv(&m, [0.2, 0.5, 0.8]);
        assert!((v[0] - 0.2).abs() < 1e-6);
        assert!((v[1] - 0.5).abs() < 1e-6);
        assert!((v[2] - 0.8).abs() < 1e-6);
    }

    #[test]
    fn unknown_profile_returns_none() {
        assert!(camera_cube_text("nope").is_none());
        assert!(profile_rgb("nope", 0.5, 0.5, 0.5).is_none());
    }

    #[test]
    fn camera_lut_path_writes_cube_once() {
        let dir = std::env::temp_dir().join(format!("camlog-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let effects = serde_json::json!({ "cameraProfile": "slog3709" });
        let first = camera_lut_path(&effects, &dir).expect("writes cube");
        assert!(first.is_file());
        if let Ok(dump) = std::env::var("CAMLOG_DUMP") {
            std::fs::copy(&first, dump).ok();
        }
        let text = std::fs::read_to_string(&first).unwrap();
        assert!(text.contains("LUT_3D_SIZE 33"));
        // Segunda llamada reutiliza el archivo (mtime no cambia de tamaño).
        let second = camera_lut_path(&effects, &dir).unwrap();
        assert_eq!(first, second);
        // Perfil inválido o ausente → None, sin archivo.
        assert!(camera_lut_path(&serde_json::json!({ "cameraProfile": "xxx" }), &dir).is_none());
        assert!(camera_lut_path(&serde_json::json!({}), &dir).is_none());
        std::fs::remove_dir_all(&dir).ok();
    }
}
