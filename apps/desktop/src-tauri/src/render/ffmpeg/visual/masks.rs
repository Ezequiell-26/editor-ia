#[allow(clippy::too_many_arguments)]
pub(crate) fn mask_filter(clip: &Value, fps: f64, lead_seconds: f64) -> Option<String> {
    let mask = &clip["mask"];
    let shape = mask["shape"].as_str()?;
    if !matches!(
        shape,
        "rectangle" | "ellipse" | "diamond" | "triangle" | "rounded" | "polygon"
    ) {
        return None;
    }
    let keyframes = mask["keyframes"]
        .as_array()
        .filter(|items| !items.is_empty());
    // The mask runs after zoompan, whose timestamps may be rebased; the frame
    // counter N is the reliable clock, expressed in seconds since the clip's
    // nominal start (the lead belongs to the incoming transition).
    let time_var = format!(
        "((N-{:.0})/{:.6})",
        (lead_seconds * fps).round(),
        fps.max(1.0)
    );
    let expression = |property: &str, fallback: f64| -> String {
        keyframes
            .and_then(|items| keyframe_expression(items, property, fps, &time_var))
            .unwrap_or_else(|| format!("{fallback:.6}"))
    };
    let x = expression("x", number(mask, "x").unwrap_or(0.0).clamp(-1.0, 1.0));
    let y = expression("y", number(mask, "y").unwrap_or(0.0).clamp(-1.0, 1.0));
    let width = expression(
        "width",
        number(mask, "width").unwrap_or(1.0).clamp(0.01, 2.0),
    );
    let height = expression(
        "height",
        number(mask, "height").unwrap_or(1.0).clamp(0.01, 2.0),
    );
    let feather = expression(
        "feather",
        number(mask, "feather").unwrap_or(0.08).clamp(0.0, 1.0),
    );
    let rotation = expression(
        "rotationDeg",
        number(mask, "rotationDeg")
            .unwrap_or(0.0)
            .clamp(-180.0, 180.0),
    );
    let invert = mask["invert"].as_bool().unwrap_or(false);
    if shape == "polygon" {
        let points: Vec<(f64, f64)> = mask["points"]
            .as_array()?
            .iter()
            .filter_map(|point| {
                let px = point["x"].as_f64()?;
                let py = point["y"].as_f64()?;
                if px.is_finite() && py.is_finite() {
                    Some((px.clamp(0.0, 1.0), py.clamp(0.0, 1.0)))
                } else {
                    None
                }
            })
            .collect();
        if points.len() < 3 {
            return None;
        }
        let px = "(X/W)".to_owned();
        let py = "(Y/H)".to_owned();
        let mut crossings = Vec::new();
        for index in 0..points.len() {
            let (x1, y1) = points[index];
            let (x2, y2) = points[(index + 1) % points.len()];
            let x1 = format!("({x1:.6}+({x}))");
            let y1 = format!("({y1:.6}+({y}))");
            let x2 = format!("({x2:.6}+({x}))");
            let y2 = format!("({y2:.6}+({y}))");
            let crosses_y = format!(
                "(if(gt({y1},{py}),1,0)*if(lte({y2},{py}),1,0))+(if(gt({y2},{py}),1,0)*if(lte({y1},{py}),1,0))"
            );
            let x_at_y =
                format!("(({x1})+((({x2})-({x1}))*((({py})-({y1}))/((({y2})-({y1}))+0.000001))))");
            let condition = format!("(({crosses_y})*if(lt({px},{x_at_y}),1,0))");
            crossings.push(format!("if({condition},1,0)"));
        }
        let inside = format!("mod(({}),2)", crossings.join("+"));
        let alpha = if invert {
            format!("(1-({inside}))")
        } else {
            inside
        };
        return Some(format!(
            "geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*({alpha})'"
        ));
    }
    let dx = format!("((X/W)-0.5-({x}))");
    let dy = format!("((Y/H)-0.5-({y}))");
    let rotating = keyframes.is_some() || rotation != "0.000000";
    let (nx, ny) = if !rotating {
        (
            format!("({dx}/(({width})/2))"),
            format!("({dy}/(({height})/2))"),
        )
    } else {
        // Rotate in pixel space even though the centre and size are
        // normalised: H/W converts the vertical component before mixing.
        let cos = format!("cos(({rotation})*PI/180)");
        let sin = format!("sin(({rotation})*PI/180)");
        (
            format!("((({cos})*({dx})+({sin})*({dy})*(H/W))/(({width})/2))"),
            format!("((({cos})*({dy})-({sin})*({dx})*(W/H))/(({height})/2))"),
        )
    };
    let feather_expr = format!("max(({feather}),0.0001)");
    let soft = |value: &str| format!("max(0,min(1,(1-abs({value}))/{feather_expr}))");
    let coverage = match shape {
        "ellipse" => {
            let radius = format!("sqrt(({nx})*({nx})+({ny})*({ny}))");
            format!("max(0,min(1,(1-({radius}))/{feather_expr}))")
        }
        "diamond" => {
            let distance = format!("abs({nx})+abs({ny})");
            format!("max(0,min(1,(1-({distance}))/{feather_expr}))")
        }
        "triangle" => {
            // Triángulo con vértice arriba: ancho permitido = v, donde v va de
            // 0 en el vértice a 1 en la base. El borde superior también se
            // suaviza para que el vértice no quede duro.
            let v = format!("max(0,min(1,(({ny})+1)/2))");
            let inside = format!("(({v})-abs({nx}))");
            format!(
                "max(0,min(1,({inside})/{feather_expr}))*max(0,min(1,({v})/{feather_expr}))*max(0,min(1,(1-({v}))/{feather_expr}))"
            )
        }
        "rounded" => {
            // SDF de una caja redondeada: los centros de esquina quedan en
            // 1-radio y el borde exterior sigue en 1. Radio fijo de 0.25.
            let radius = 0.25;
            let qx = format!("(abs({nx})-{:.6})", 1.0 - radius);
            let qy = format!("(abs({ny})-{:.6})", 1.0 - radius);
            let outside = format!("sqrt(pow(max({qx},0),2)+pow(max({qy},0),2))");
            let inside = format!("min(max({qx},{qy}),0)");
            let distance = format!("(({outside})+({inside})-{radius:.6})");
            format!("max(0,min(1,(-({distance}))/{feather_expr}))")
        }
        _ => format!("({})*({})", soft(&nx), soft(&ny)),
    };
    let alpha = if invert {
        format!("(1-({coverage}))")
    } else {
        coverage
    };
    Some(format!(
        "geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*({alpha})'"
    ))
}
