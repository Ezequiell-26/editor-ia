from pathlib import Path

root = Path(r"D:\Users\ofici\QODER-WORK\editor-ia-architecture")
mask_path = root / "apps/desktop/src-tauri/src/render/ffmpeg/visual/masks.rs"
s = mask_path.read_text(encoding="utf-8")
old = """        let inside = format!("mod(({}),2)", crossings.join("+"));
        let alpha = if invert {
            format!("(1-({inside}))")
        } else {
            inside
        };"""
new = """        let inside = format!("mod(({}),2)", crossings.join("+"));

        // Soft edge for freehand/polygon masks. Compute the shortest distance
        // to every segment in frame-height units, then sign it with the
        // even/odd point-in-polygon result. Feather is relative to the
        // polygon's smaller bounding-box dimension, matching the other shapes.
        let min_x = points.iter().map(|point| point.0).fold(f64::INFINITY, f64::min);
        let max_x = points.iter().map(|point| point.0).fold(f64::NEG_INFINITY, f64::max);
        let min_y = points.iter().map(|point| point.1).fold(f64::INFINITY, f64::min);
        let max_y = points.iter().map(|point| point.1).fold(f64::NEG_INFINITY, f64::max);
        let span_x = (max_x - min_x).max(0.0001);
        let span_y = (max_y - min_y).max(0.0001);
        let mut edge_distances = Vec::with_capacity(points.len());
        for index in 0..points.len() {
            let (x1_value, y1_value) = points[index];
            let (x2_value, y2_value) = points[(index + 1) % points.len()];
            let x1 = format!("({x1_value:.6}+({x}))");
            let y1 = format!("({y1_value:.6}+({y}))");
            let x2 = format!("({x2_value:.6}+({x}))");
            let y2 = format!("({y2_value:.6}+({y}))");
            let vx = format!("(({x2})-({x1}))*(W/H)");
            let vy = format!("(({y2})-({y1}))");
            let wx = format!("(({px})-({x1}))*(W/H)");
            let wy = format!("(({py})-({y1}))");
            let projection = format!(
                "clip((({wx})*({vx})+({wy})*({vy}))/((({vx})*({vx})+({vy})*({vy}))+0.000001),0,1)"
            );
            let dx = format!("(({wx})-({projection})*({vx}))");
            let dy = format!("(({wy})-({projection})*({vy}))");
            edge_distances.push(format!(
                "sqrt(({dx})*({dx})+({dy})*({dy}))"
            ));
        }
        let distance = edge_distances
            .into_iter()
            .reduce(|left, right| format!("min(({left}),({right}))"))
            .unwrap_or_else(|| "0".to_owned());
        let feather_distance = format!(
            "max(({feather})*min(({span_x:.6})*(W/H),{span_y:.6}),0.0001)"
        );
        let signed_distance = format!(
            "if(gt(({inside}),0),({distance}),-({distance}))"
        );
        let soft_coverage = format!(
            "clip(0.5+({signed_distance})/(2*({feather_distance})),0,1)"
        );
        let coverage = format!(
            "if(lte(({feather}),0.0001),({inside}),({soft_coverage}))"
        );
        let alpha = if invert {
            format!("(1-({coverage}))")
        } else {
            coverage
        };"""
assert old in s
s = s.replace(old, new, 1)

idx = s.rfind("\n}")
assert idx > 0
tests = r""" 

#[cfg(test)]
mod polygon_feather_tests {
    use super::mask_filter;
    use serde_json::json;

    fn polygon(feather: f64, invert: bool) -> serde_json::Value {
        json!({
            "mask": {
                "shape": "polygon",
                "x": 0.0,
                "y": 0.0,
                "feather": feather,
                "invert": invert,
                "points": [
                    {"x": 0.2, "y": 0.2},
                    {"x": 0.8, "y": 0.2},
                    {"x": 0.7, "y": 0.8},
                    {"x": 0.3, "y": 0.8}
                ]
            }
        })
    }

    #[test]
    fn polygonmask_builds_a_signed_distance_feather() {
        let filter = mask_filter(&polygon(0.12, false), 30.0, 0.0).expect("polygon filter");
        assert!(filter.contains("sqrt("));
        assert!(filter.contains("clip(0.5+e"));
        assert!(filter.contains("lte((0.120000),0.0001)"));
        assert!(filter.contains("alpha(X,Y)*"));
    }

    #[test]
    fn polygon_feather_respects_invert() {
        let filter = mask_filter(&polygon(true, 0.12), 30.0, 0.0).expect("inverted polygon");
        assert!(filter.contains("alpha(X,Y)*(1-("));
    }

    #[test]
    fn zero_feather_keeps_a_hard_polygon_edge() {
        let filter = mask_filter(&polygon(0.0, false), 30.0, 0.0).expect("hard polygon");
        assert!(filter.contains("if(lte((0.000000),0.0001)"));
        assert!(filter.contains("mod(("));
    }
}
"""
s = s[:idx+2] + tests + s[idx+2:]
mask_path.write_text(s, encoding="utf-8")

inspector = root / "apps/desktop/src/features/editor/Inspector.tsx"
ui = inspector.read_text(encoding="utf-8")
ui = ui.replace('<option value="polygon">Polígono (roto)</option>', '<option value="polygon">Polígono personalizado</option>', 1)
old_ui = """                    <p className="fine-print">
                      Arrastrá los vértices para deformar el polígono; el conjunto se mueve con
                      Centro X/Y.
                    </p>"""
new_ui = """                    <div className="inspector-grid">
                      <NumberField
                        label="Feather"
                        value={maskView.feather}
                        min={0}
                        max={1}
                        step={0.02}
                        onCommit={(value) => patchMask({ feather: value })}
                      />
                    </div>
                    <p className="fine-print">
                      Arrastrá los vértices para deformar el polígono; el conjunto se mueve con
                      Centro X/Y. Feather suaviza el borde tanto en la vista previa como en el render.
                    </p>"""
assert old_ui in ui
ui = ui.replace(old_ui, new_ui, 1)
inspector.write_text(ui, encoding="utf-8")
print("patched polygon feather in Rust renderer and Inspector")
