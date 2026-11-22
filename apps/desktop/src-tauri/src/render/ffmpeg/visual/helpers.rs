pub(crate) fn seconds(value: f64) -> String {
    format!("{:.6}", value.max(0.0))
}

pub(crate) fn hex_color(raw: &str) -> String {
    let hex = raw.trim().trim_start_matches('#');
    if hex.len() == 6 && hex.chars().all(|character| character.is_ascii_hexdigit()) {
        format!("0x{}", hex)
    } else {
        "0x0f1319".to_owned()
    }
}

/// `#rrggbb` → canales 0..1 para las curvas del dip-to-color congelado.
pub(crate) fn hex_rgb01(raw: &str) -> Option<(f64, f64, f64)> {
    let hex = raw.trim().trim_start_matches('#');
    if hex.len() != 6 || !hex.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    let channel = |at: usize| {
        u8::from_str_radix(&hex[at..at + 2], 16)
            .ok()
            .map(|byte| byte as f64 / 255.0)
    };
    Some((channel(0)?, channel(2)?, channel(4)?))
}

/// `wipe-*`: el clip entrante se revela por un borde que barre el cuadro
/// durante el lead (port Kdenlive wipe). `geq` modula el alfa por píxel:
/// progreso `p = min(1, N/lead_frames)` y cada dirección conserva el alfa
/// original sólo del lado ya barrido. El clip saliente queda intacto
/// debajo, igual que en Kdenlive. `wipe-*`/`iris`: el clip entrante se
/// revela por una máscara que crece durante el lead.
pub(crate) fn wipe_alpha_expr(kind: &str, p: &str) -> String {
    let alpha = |condition: &str| format!("if({condition},alpha(X,Y),0)");
    match kind {
        // El barrido viaja hacia la izquierda: lo nuevo crece desde el
        // borde derecho (X > W*(1-p)), igual que slide-left entra desde
        // la derecha. `gte` (no `gt`) porque en p=1 el borde opuesto debe
        // quedar abierto: con `gt(X,0)` la columna X=0 quedaba transparente
        // para siempre.
        "wipe-left" => alpha(&format!("gte(X,W*(1-({p})))")),
        "wipe-right" => alpha(&format!("lt(X,W*({p}))")),
        // Hacia arriba: desde abajo (Y > H*(1-p)); hacia abajo: desde arriba.
        "wipe-up" => alpha(&format!("gte(Y,H*(1-({p})))")),
        "wipe-down" => alpha(&format!("lt(Y,H*({p}))")),
        // Iris circular: el entrante se revela desde el centro en un óvalo
        // que crece hasta cubrir el cuadro (elipse inscrita en el frame).
        // `gt(p,0.999)` abre el borde exacto al cerrar el lead, donde los
        // cuatro vértices quedan a distancia² = R² y `lt` los excluiría.
        "iris" => format!(
            "if(gt(({p}),0.999),alpha(X,Y),if(lt((X-W/2)*(X-W/2)+(Y-H/2)*(Y-H/2),({p})*({p})*((W/2)*(W/2)+(H/2)*(H/2))),alpha(X,Y),0))"
        ),
        // Persiana en cascada (10 listones), equivalente al `persiana` de
        // AlaukCut: cada listón abre con retardo decreciente de arriba
        // hacia abajo y borde suave de 4 % de su alto. En FFmpeg Y=0 es el
        // borde superior, así que el listón `line` (0 arriba) recibe
        // `atraso = 0.035*line`; dentro del listón el nuevo clip se revela
        // de abajo hacia arriba (`r = 1-f` decrece al avanzar Y).
        "blinds" => {
            let line = "floor(Y/H*10)";
            let f = format!("(Y/H*10-{line})");
            let t = format!("clip(({p}-0.035*{line})/0.65,0,1)*1.05");
            let r = format!("(1-{f})");
            let u = format!("clip(({r}-({t}-0.04))/0.04,0,1)");
            let ss = format!("({u}*{u}*(3-2*{u}))");
            format!("alpha(X,Y)*(1-{ss})")
        }
        // Reloj (`relogio` de AlaukCut): barrido angular horario desde el
        // borde superior. En coordenadas FFmpeg (Y crece hacia abajo) el
        // vector «arriba» es H/2-Y, así que `atan2(X-W/2, H/2-Y)` da 0 en el tope
        // y crece en sentido horario; `volta` lo normaliza a [0,1) y el
        // smoothstep de ±0.012 replica el borde suave del shader.
        "clock-wipe" => {
            let ang = "atan2(X-W/2,H/2-Y)";
            let norm = format!("if(lt(({ang}),0),({ang})+6.28318530718,({ang}))");
            let volta = format!("(({norm})/6.28318530718)");
            let u = format!("clip((({volta})-(({p})-0.012))/0.024,0,1)");
            let ss = format!("({u}*{u}*(3-2*{u}))");
            format!("alpha(X,Y)*(1-{ss})")
        }
        // Tinta (`tinta` de AlaukCut): mancha que se expande desde el centro
        // con borde irregular (ruido de valor, 2 octavas). geq no tiene
        // variables: cada hash `sin()` se expone inline. El oscurecido del
        // borde mojado no es portable a alfa puro — queda como aproximación.
        // Las coordenadas de ruido usan X/H e Y/H (equivalente al
        // `q*vec2(ratio,1)` del shader tras normalizar por H).
        "ink" => {
            let hash = |u: &str, v: &str| {
                let s = format!("sin({u}*12.9898+{v}*78.233)*43758.5453");
                format!("({s}-floor({s}))")
            };
            let noise = |a: &str, b: &str| {
                let i = format!("floor({a})");
                let j = format!("floor({b})");
                let fx = format!("({a}-{i})");
                let fy = format!("({b}-{j})");
                let ux = format!("({fx}*{fx}*(3-2*{fx}))");
                let uy = format!("({fy}*{fy}*(3-2*{fy}))");
                let h00 = hash(&i, &j);
                let h10 = hash(&format!("({i}+1)"), &j);
                let h01 = hash(&i, &format!("({j}+1)"));
                let h11 = hash(&format!("({i}+1)"), &format!("({j}+1)"));
                let lo = format!("({h00}*(1-{ux})+{h10}*{ux})");
                let hi = format!("({h01}*(1-{ux})+{h11}*{ux})");
                format!("({lo}*(1-{uy})+{hi}*{uy})")
            };
            let n1 = noise("X/H*4", "Y/H*4");
            let n2 = noise("X/H*9+3.7", "Y/H*9+1.3");
            let n = format!("({n1}*0.6+{n2}*0.4)");
            let len = "sqrt((X/W-0.5)*(X/W-0.5)+(Y/H-0.5)*(Y/H-0.5))";
            let campo = format!("({n}*0.7+(1-{len}*1.2)*0.3)");
            let limiar = format!("(1-({p})*1.05)");
            let u = format!("clip((({campo})-({limiar}))/0.06,0,1)");
            let ss = format!("({u}*{u}*(3-2*{u}))");
            format!("alpha(X,Y)*{ss}")
        }
        // Bolhas (`bolhas` de AlaukCut): el clip entrante nace en burbujas
        // que crecen desde el centro de cada celda de una grilla 7×7, cada
        // una con retardo hasheado. geq no tiene variables: el centro de
        // celda y el hash se expanden inline (mismo truco `sin()` que `ink`).
        // `t` llega a 1 cuando la burbuja cubre la celda entera
        // (1.32 × semidiagonal²), así que al cerrar el lead todo queda
        // revelado sin caso especial.
        "bolhas" => {
            let hash = |u: &str, v: &str| {
                let s = format!("sin({u}*12.9898+{v}*78.233)*43758.5453");
                format!("({s}-floor({s}))")
            };
            let cx = "floor(X/W*7)";
            let cy = "floor(Y/H*7)";
            let h = hash(cx, cy);
            let px = format!("(({cx}+0.5)*W/7)");
            let py = format!("(({cy}+0.5)*H/7)");
            let dx = format!("(X-{px})");
            let dy = format!("(Y-{py})");
            let r2 = format!("({dx}*{dx}+{dy}*{dy})");
            let maxd2 = "((W/14)*(W/14)+(H/14)*(H/14))";
            let t = format!("clip((({p})-({h})*0.5)/0.45,0,1)");
            let rad2 = format!("({t}*{t}*1.32*{maxd2})");
            let u = format!("clip((({rad2})-({r2}))/({maxd2}*0.04+1),0,1)");
            let ss = format!("({u}*{u}*(3-2*{u}))");
            format!("alpha(X,Y)*{ss}")
        }
        // Colmeia (`colmeia` de AlaukCut): los favos hexagonales se revelan
        // del centro hacia los bordes; cada favó espera por distancia al
        // centro + hash de celda. La distancia hexagonal usa la celda más
        // cercana entre dos redes desplazadas (voronoi del shader). geq no
        // tiene variables ni `mod`: `mod(v,s)=v-s*floor(v/s)` y los `min`/`max`
        // se reescriben con `clip`/`if(lt|gt)` inline. El velo oscuro de las
        // juntas del shader no es portable a alfa puro — queda como
        // aproximación.
        "colmeia" => {
            // Coordenadas en unidades de hexágono: equivale al
            // `q*vec2(ratio*9,9)` del shader porque X/H*9 = X/W*(W/H)*9.
            let sx = "(X/H*9)";
            let sy = "(Y/H*9)";
            let s_y = "1.7320508";
            // a = mod(p, s) - h  →  ax = mod(px,1)-0.5, ay = mod(py,1.732)-0.866
            let ax = format!("({sx}-floor({sx})-0.5)");
            let ay = format!("({sy}-{s_y}*floor({sy}/{s_y})-0.866)");
            // b = mod(p - h, s) - h con h = (0.5, 0.866)
            let bx0 = format!("({sx}-0.5)");
            let by0 = format!("({sy}-0.866)");
            let bx = format!("({bx0}-floor({bx0})-0.5)");
            let by = format!("({by0}-{s_y}*floor({by0}/{s_y})-0.866)");
            let daa = format!("({ax}*{ax}+{ay}*{ay})");
            let dbb = format!("({bx}*{bx}+{by}*{by})");
            let pick_a = format!("lt({daa},{dbb})");
            let gx = format!("if({pick_a},{ax},{bx})");
            let gy = format!("if({pick_a},{ay},{by})");
            // id = p - g (coordenadas continuas de celda)
            let idx = format!("({sx}-{gx})");
            let idy = format!("({sy}-{gy})");
            // Retardo: proximidad al centro (meio = (W/H*4.5, 4.5)) + hash.
            let mxm = "(W/H*4.5)";
            let lenm = format!("sqrt({mxm}*{mxm}+4.5*4.5)");
            let dist = format!(
                "sqrt(({idx}-{mxm})*({idx}-{mxm})+({idy}-4.5)*({idy}-4.5))"
            );
            let hh_s = format!(
                "sin(floor({idx}*2+0.5)*12.9898+floor({idy}*2+0.5)*78.233)*43758.5453"
            );
            let hh = format!("({hh_s}-floor({hh_s}))");
            let atraso = format!(
                "(clip({dist}/{lenm},0,1)*0.5+{hh}*0.15)"
            );
            let t = format!("clip((({p})-{atraso})/0.3,0,1)");
            // hexd = max(dot(abs(g),(0.5,0.866)), abs(g).x) — distancia al
            // borde del favo hexagonal.
            let agx = format!("abs({gx})");
            let agy = format!("abs({gy})");
            let dot_ag = format!("({agx}*0.5+{agy}*0.8660254)");
            let hexd = format!("if(gt({dot_ag},{agx}),{dot_ag},{agx})");
            let u = format!(
                "clip(({hexd}-({t}*0.62-0.03))/0.03,0,1)"
            );
            let ss = format!("({u}*{u}*(3-2*{u}))");
            format!("alpha(X,Y)*(1-{ss})")
        }
        // Chuva (`chuva` de AlaukCut): 48 columnas que caen a velocidad y
        // fase hasheadas; cada columna revela B de abajo hacia arriba cuando
        // la «cabeza» de lluvia la alcanza. La estela verde digital y los
        // bloques brillantes del shader no son portables a alfa puro — el
        // reveal (`passou`) sí lo es. `y` del shader es 1-q.y → en FFmpeg
        // equivale a (1-Y/H).
        "chuva" => {
            let col = "floor(X/W*48)";
            let hash = |v: &str| {
                let s = format!("sin({col}*12.9898+{v}*78.233)*43758.5453");
                format!("({s}-floor({s}))")
            };
            let vel = format!("(0.7+{}*0.6)", hash("1"));
            let fase = format!("({}*0.35)", hash("2"));
            let cabeca = format!("((({p})*1.9-{fase})*{vel})");
            let y = "(1-Y/H)";
            let u = format!("clip(({y}-({cabeca}-0.02))/0.02,0,1)");
            let ss = format!("({u}*{u}*(3-2*{u}))");
            format!("alpha(X,Y)*(1-{ss})")
        }
        // Vento (`vento` de AlaukCut): los «granos» del clip saliente son
        // arrastrados por el viento hacia la derecha y el entrante aparece
        // detrás. El shader además muestrea A desplazado (`sa`) — eso no es
        // portable a alfa puro: la máscara reproduce sólo el reveal por
        // grano (`some = smoothstep(0.5,1,t)`), que sí es fiel.
        "vento" => {
            // Grano hasheado por celda de una grilla 320×180 sobre el frame
            // normalizado (equivale a floor(q*vec2(320,180)) del shader).
            let gx = "floor(X/W*320)";
            let gy = "floor(Y/H*180)";
            let gs = format!("sin({gx}*12.9898+{gy}*78.233)*43758.5453");
            let g = format!("({gs}-floor({gs}))");
            let frente = format!("(({p})*1.7-0.35)");
            let nx = "(X/W)";
            let t = format!("clip(({frente}-{nx}*0.6-{g}*0.4)/0.25,0,1)");
            let u = format!("clip(({t}-0.5)/0.5,0,1)");
            let ss = format!("({u}*{u}*(3-2*{u}))");
            format!("alpha(X,Y)*{ss}")
        }
        // Triangulos (`triangulos` de AlaukCut): cada celda de una grilla
        // 6×6 (corregida por aspecto) se parte en dos triángulos que se
        // encogen con retardo por columna + hash; B queda detrás. El shader
        // devuelve `dentro` = visibilidad de A dentro del triángulo, así que
        // la máscara del entrante es `1-dentro`. geq no tiene `step`/`mix`/
        // `min`/`max`: `step(f.x,f.y)` → `if(lt(fy,fx),0,1)`, `mix(a,b,t)` →
        // `a+(b-a)*t`, `min` → `if(lt)`, `max` → `if(gt)`, `step(k,0.999)` →
        // `if(lt(k,0.999),1,0)`. Coordenadas en unidades de celda:
        // `X/H*6` ≡ `q*vec2(ratio*6,6)` del shader.
        "triangulos" => {
            let gx = "(X/H*6)";
            let gy = "(Y/H*6)";
            let celx = format!("floor({gx})");
            let cely = format!("floor({gy})");
            let fx = format!("({gx}-{celx})");
            let fy = format!("({gy}-{cely})");
            // lado = step(f.x, f.y): 1 cuando f.y >= f.x (mitad superior).
            let lado = format!("if(lt({fy},{fx}),0,1)");
            // cen = mix(vec2(2/3,1/3), vec2(1/3,2/3), lado)
            let cenx = format!("(0.6666667-0.3333334*{lado})");
            let ceny = format!("(0.3333333+0.3333334*{lado})");
            // atraso = cel.x/(ratio*6)*0.55 + hash(cel + lado*(17,31))*0.25
            // cel.x/(W/H*6) = celx*H/(W*6); el hash usa cel + lado*(17,31).
            let hx = format!("({celx}+{lado}*17)");
            let hy = format!("({cely}+{lado}*31)");
            let hs = format!("sin({hx}*12.9898+{hy}*78.233)*43758.5453");
            let hh = format!("({hs}-floor({hs}))");
            let atraso = format!(
                "({celx}*H/(W*6)*0.55+{hh}*0.25)"
            );
            let k = format!("clip((({p})-{atraso})/0.2,0,1)");
            // sc = max(1-k, 0.001)
            let omk = format!("(1-{k})");
            let sc = format!("if(gt({omk},0.001),{omk},0.001)");
            // fl = cen + (f-cen)/sc
            let flx = format!("({cenx}+({fx}-{cenx})/{sc})");
            let fly = format!("({ceny}+({fy}-{ceny})/{sc})");
            let fdx = format!("({flx}-{fly})");
            // d1 = mix(fl.y, fl.x, lado) = fly + (flx-fly)*lado
            let d1 = format!("({fly}+{fdx}*{lado})");
            // d2 = mix(1-fl.x, 1-fl.y, lado) = 1-flx + (flx-fly)*lado
            let d2 = format!("(1-{flx}+{fdx}*{lado})");
            // d3 = mix(fl.x-fl.y, fl.y-fl.x, lado)*0.7071068
            //    = fdx*(1-2*lado)*0.7071068
            let d3 = format!("({fdx}*(1-2*{lado})*0.7071068)");
            let dmin = format!("if(lt({d2},{d3}),if(lt({d1},{d2}),{d1},{d2}),if(lt({d1},{d3}),{d1},{d3}))");
            // dentro = smoothstep(-0.03,0,dmin) * step(k,0.999)
            let du = format!("clip(({dmin}+0.03)/0.03,0,1)");
            let dss = format!("({du}*{du}*(3-2*{du}))");
            let dentro = format!("({dss}*if(lt({k},0.999),1,0))");
            format!("alpha(X,Y)*(1-{dentro})")
        }
        // Persiana (`persiana` de AlaukCut): diez listones horizontales que
        // abren en cascada — cada listón retrasa su apertura según su fila y
        // el reveal dentro del listón barre de abajo hacia arriba
        // (`smoothstep(t-0.04,t,1-f)`). geq: `linha=floor(Y/H*10)`,
        // `f=fract`, `atraso=(1-(linha+1)/10)*0.35`, `t=clip((p-atraso)/0.65)*1.05`.
        "persiana" => {
            let linha = "floor(Y/H*10)";
            let f = format!("(Y/H*10-{linha})");
            let atraso = format!("((1-({linha}+1)/10)*0.35)");
            let t = format!("clip((({p})-{atraso})/0.65,0,1)*1.05");
            let u = format!("clip((1.04-{f}-{t})/0.04,0,1)");
            let ss = format!("({u}*{u}*(3-2*{u}))");
            format!("alpha(X,Y)*(1-{ss})")
        }
        // Reflexo (`reflexo` de AlaukCut): frente de luz diagonal que cruza en
        // sentido anti-diagonal (`x = q.x*ratio*0.75 + (1-q.y)*0.25`, en geq
        // `X/H*0.75 + (1-Y/H)*0.25` porque `q.x*ratio = X/H`). La estela de
        // luz cálida que el shader pinta sobre el fundido no es portable a
        // alfa puro — queda sólo el reveal (`m = 1-smoothstep(frente±0.015)`).
        "reflexo" => {
            let total = "(W/H*0.75+0.25)";
            let x = "(X/H*0.75+(1-Y/H)*0.25)";
            let frente = format!("(({p})*({total}+0.5)-0.25)");
            let u = format!("clip(({x}-({frente}-0.015))/0.03,0,1)");
            let ss = format!("({u}*{u}*(3-2*{u}))");
            format!("alpha(X,Y)*(1-{ss})")
        }
        // Barrido diagonal (`directionalwipe` de transitions.dev): el clip
        // entrante se revela con un borde recto a ~45° que cruza de arriba-
        // izquierda hacia abajo-derecha. Proyección `u = (X+Y)/(W+H)` va de
        // 0 en la esquina superior-izquierda a 1 en la inferior-derecha sin
        // depender del aspecto; el smoothstep de ±0.008 da el borde suave.
        "barrido-diagonal" => {
            let u = "((X+Y)/(W+H))";
            let limiar = format!("((({p})*1.016)-0.008)");
            let g = format!("clip((({u})-({limiar}))/0.016,0,1)");
            let ss = format!("({g}*{g}*(3-2*{g}))");
            format!("alpha(X,Y)*(1-{ss})")
        }
        _ => "alpha(X,Y)".to_owned(),
    }
}

pub(crate) fn wipe_geq(expr: &str) -> String {
    format!("geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='{expr}'")
}

pub(crate) fn wipe_transition_filter(kind: &str, lead: f64, fps: f64) -> String {
    let lead_frames = (lead.max(0.0) * fps.max(1.0)).round().max(1.0);
    // Progreso en frames del stream local (0 = inicio del solape).
    let p = format!("if(lt(N,{lead_frames:.0}),N/{lead_frames:.0},1)");
    let alpha = wipe_alpha_expr(kind, &p);
    // `ink`/`bolhas` evalúan ruido por pixel: `if` de geq cortocircuita,
    // así que fuera del lead se devuelve el alfa original sin pagar la
    // máscara. Verificado: 10 frames con guarda ≈ 4× más rápido que sin ella.
    let alpha = if matches!(kind, "ink" | "bolhas" | "colmeia" | "chuva" | "vento" | "triangulos" | "persiana" | "reflexo") {
        format!("if(lt(N,{lead_frames:.0}),{alpha},alpha(X,Y))")
    } else {
        alpha
    };
    wipe_geq(&alpha)
}

/// Versión de una ventana de un frame: `p` llega ya resuelto por el preview.
pub(crate) fn wipe_frozen_filter(kind: &str, progress: f64) -> String {
    wipe_geq(&wipe_alpha_expr(kind, &format!("{progress:.6}")))
}

/// Fracción mínima del lienzo que ocupa el eje comprimido de un `slide-3d-*`
/// al inicio del lead: el cuadro entra casi de canto y abre hasta el 100 %.
const SLIDE3D_MIN_EXTENT: f64 = 0.15;

/// Eje que se comprime en perspectiva: el perpendicular al deslizamiento
/// (entradas laterales comprimen X = giro sobre eje vertical; las verticales
/// comprimen Y = giro sobre eje horizontal).
fn slide3d_axis(kind: &str) -> &'static str {
    if kind.ends_with("-up") || kind.ends_with("-down") {
        "y"
    } else {
        "x"
    }
}

/// `slide-3d-*`: además del desplazamiento del overlay (mismo `slide_axis`),
/// el clip entrante rota en perspectiva durante el lead. `perspective` con
/// `eval=frame` y `sense=destination` lleva las esquinas del fuente a un
/// quad comprimido simétrico sobre el centro; `extent` es la fracción de
/// progreso 0..1 ya expresada en las variables del filtro (`in` = frames
/// desde el inicio del solape) y `enable` apaga el remapeo al terminar el
/// lead para no pagarlo en todo el clip. Aproximación declarada: el giro es
/// simétrico sobre el centro, no una puerta anclada a un borde.
fn slide3d_perspective(axis: &str, extent: &str, enable: &str) -> String {
    let f = format!(
        "({SLIDE3D_MIN_EXTENT}+{:.2}*min(max(({extent}),0),1))",
        1.0 - SLIDE3D_MIN_EXTENT
    );
    let (x0, x1, x2, x3, y0, y1, y2, y3) = if axis == "y" {
        (
            "0".to_owned(),
            "W".to_owned(),
            "0".to_owned(),
            "W".to_owned(),
            format!("H*(1-({f}))/2"),
            format!("H*(1-({f}))/2"),
            format!("H*(1+({f}))/2"),
            format!("H*(1+({f}))/2"),
        )
    } else {
        (
            format!("W*(1-({f}))/2"),
            format!("W*(1+({f}))/2"),
            format!("W*(1-({f}))/2"),
            format!("W*(1+({f}))/2"),
            "0".to_owned(),
            "0".to_owned(),
            "H".to_owned(),
            "H".to_owned(),
        )
    };
    format!(
        "perspective=x0='{x0}':y0='{y0}':x1='{x1}':y1='{y1}':x2='{x2}':y2='{y2}':x3='{x3}':y3='{y3}':sense=destination:eval=frame:enable='{enable}'"
    )
}

pub(crate) fn slide3d_transition_filter(kind: &str, lead: f64, fps: f64) -> String {
    let lead_frames = (lead.max(0.0) * fps.max(1.0)).round().max(1.0);
    slide3d_perspective(
        slide3d_axis(kind),
        &format!("in/{lead_frames:.0}"),
        &format!("lt(n,{lead_frames:.0})"),
    )
}

/// Ventana de un frame: el progreso ya viene resuelto por el preview.
pub(crate) fn slide3d_frozen_filter(axis: &str, progress: f64) -> String {
    slide3d_perspective(axis, &format!("{progress:.6}"), "1")
}

/// `pixelar` (paridad del `pixelar` de `transiciones_gl` de AlaukCut): el
/// clip entrante aparece pixelado y se resuelve durante el lead. Cada canal
/// toma el píxel de la esquina del bloque de lado `B` — `B*floor(X/B)` es el
/// origen del bloque (geq no tiene `%`; con B=1 la expresión es identidad
/// exacta). `B` decrece de 48 a 1 con el progreso; el `if` de geq
/// cortocircuita y fuera del lead se devuelve el píxel original.
fn pixelar_geq(progress: &str, guard: &str) -> String {
    let b = format!("(1+47*(1-({progress})))");
    let px = format!("({b})*floor(X/({b}))");
    let py = format!("({b})*floor(Y/({b}))");
    format!(
        "geq=r='if({guard},r({px},{py}),r(X,Y))':g='if({guard},g({px},{py}),g(X,Y))':b='if({guard},b({px},{py}),b(X,Y))':a='alpha(X,Y)'"
    )
}

pub(crate) fn pixelar_transition_filter(lead: f64, fps: f64) -> String {
    let lead_frames = (lead.max(0.0) * fps.max(1.0)).round().max(1.0);
    pixelar_geq(
        &format!("clip(N/{lead_frames:.0},0,1)"),
        &format!("lt(N,{lead_frames:.0})"),
    )
}

/// Versión de un frame: el progreso ya viene resuelto por el preview.
pub(crate) fn pixelar_frozen_filter(progress: f64) -> String {
    pixelar_geq(&format!("{progress:.6}"), "1")
}

/// `interferencia` (paridad del `interferencia` de `transicoes_gl` de
/// AlaukCut): durante el lead el clip entrante sufre aberración cromática
/// radial — R y B se samplean desplazados desde el centro del frame — más
/// ruido de «señal» por canal (dos senos con coeficientes y semillas
/// distintos por canal; `N` lo hace parpadear frame a frame como una
/// interferencia). La envolvente `sin(pi*p)` enciende y apaga el efecto
/// solo, y el `if` de geq cortocircuita fuera del lead.
fn interferencia_geq(progress: &str, guard: &str) -> String {
    // nx/ny: vector centro→píxel; dist: su módulo +1 para no dividir por 0.
    let nx = "(X-W/2)";
    let ny = "(Y-H/2)";
    let dist = format!("(sqrt({nx}*{nx}+{ny}*{ny})+1)");
    let env = format!("sin(3.14159265*({progress}))");
    // ab: aberración en px (pico ~14 al medio del lead); amp: ruido ±36.
    let ab = format!("({env}*14)");
    let amp = format!("({env}*36)");
    let dx = format!("({nx}/{dist}*{ab})");
    let dy = format!("({ny}/{dist}*{ab})");
    // Ruido por canal: producto de dos senos con semillas distintas.
    let nr = "sin(X*0.913+Y*1.731+N*2.17)*sin(X*2.39+Y*0.57+N*0.31)";
    let ng = "sin(X*1.37+Y*2.11+N*3.71)*sin(Y*1.93+X*0.31+N*1.13)";
    let nb = "sin(X*2.71+Y*0.83+N*1.43)*sin(X*0.47+Y*2.97+N*2.29)";
    format!(
        "geq=r='if({guard},clip(r(X+{dx},Y+{dy})+({nr})*({amp}),0,255),r(X,Y))':g='if({guard},clip(g(X,Y)+({ng})*({amp}),0,255),g(X,Y))':b='if({guard},clip(b(X-{dx},Y-{dy})+({nb})*({amp}),0,255),b(X,Y))':a='alpha(X,Y)'"
    )
}

pub(crate) fn interferencia_transition_filter(lead: f64, fps: f64) -> String {
    let lead_frames = (lead.max(0.0) * fps.max(1.0)).round().max(1.0);
    interferencia_geq(
        &format!("clip(N/{lead_frames:.0},0,1)"),
        &format!("lt(N,{lead_frames:.0})"),
    )
}

/// Versión de un frame: el progreso ya viene resuelto por el preview.
pub(crate) fn interferencia_frozen_filter(progress: f64) -> String {
    interferencia_geq(&format!("{progress:.6}"), "1")
}

/// `liquido` (paridad del `liquido` de `transicoes_gl` de AlaukCut): el
/// clip entrante entra «licuado» — cada canal se samplea con un offset
/// de píxel dado por un campo de ruido suave de X/Y (senos anidados,
/// sin hash: geq no tiene variables ni `%`) que decae con el progreso
/// hasta quedar en 0 (el clip se resuelve, como `pixelar`). `N` aporta
/// un «hervor» leve frame a frame. El `if` de geq cortocircuita fuera
/// del lead.
fn liquido_geq(progress: &str, guard: &str) -> String {
    // Campo de desplazamiento: dos senos anidados por eje, en [-1,1]
    // aprox. (suma acotada ~±1.7; amp la compensa).
    let fx = "sin(X*0.021+sin(Y*0.017+N*0.11)*2.1)+0.6*sin(Y*0.013+X*0.007+N*0.07)";
    let fy = "sin(Y*0.019+sin(X*0.015+N*0.13)*1.9)+0.6*sin(X*0.011+Y*0.009+N*0.05)";
    // amp: pico ~26 px al inicio del lead → 0 al final.
    let amp = format!("((1-({progress}))*26)");
    let dx = format!("(({fx})*{amp}/1.7)");
    let dy = format!("(({fy})*{amp}/1.7)");
    format!(
        "geq=r='if({guard},r(X+{dx},Y+{dy}),r(X,Y))':g='if({guard},g(X+{dx},Y+{dy}),g(X,Y))':b='if({guard},b(X+{dx},Y+{dy}),b(X,Y))':a='alpha(X,Y)'"
    )
}

pub(crate) fn liquido_transition_filter(lead: f64, fps: f64) -> String {
    let lead_frames = (lead.max(0.0) * fps.max(1.0)).round().max(1.0);
    liquido_geq(
        &format!("clip(N/{lead_frames:.0},0,1)"),
        &format!("lt(N,{lead_frames:.0})"),
    )
}

/// Versión de un frame: el progreso ya viene resuelto por el preview.
pub(crate) fn liquido_frozen_filter(progress: f64) -> String {
    liquido_geq(&format!("{progress:.6}"), "1")
}

/// `caleidoscopio` (paridad del `caleidoscopio` de `transicoes_gl` de
/// AlaukCut): el clip entrante aparece plegado en 8 sectores angulares
/// espejados (cada sector rebota su mitad → roseta) y se abre hasta
/// quedar normal con el progreso. Coordenadas polares por `atan2` +
/// `sqrt` (mismo truco que `clock-wipe`), fold triangular
/// `1-|2u-1|` por sector, y mezcla `orig + (plegado-orig)*(1-p)` — a
/// p=1 la expresión es identidad exacta. `clip` contiene el muestreo
/// cuando el punto plegado cae fuera del cuadro.
fn caleidoscopio_geq(progress: &str, guard: &str) -> String {
    let p = format!("clip({progress},0,1)");
    let k = format!("(1-{p})");
    let nx = "(X-W/2)";
    let ny = "(Y-H/2)";
    let radius = format!("sqrt({nx}*{nx}+{ny}*{ny})");
    // a ∈ [0,1]: atan2(ny,nx) ∈ [-π,π] → +π → [0,2π] → /2π.
    let a = format!("((atan2({ny},{nx})+3.14159265)/6.28318531)");
    // t = sector fraccionario*8; u = fase dentro del sector; v = triángulo
    // espejo 1-|2u-1| que pliega el sector sobre sí mismo.
    let t = format!("({a}*8)");
    let u = format!("({t}-floor({t}))");
    let v = format!("(1-abs(2*{u}-1))");
    let af = format!("((floor({t})+{v})/8)");
    let th = format!("({af}*6.28318531-3.14159265)");
    let xf = format!("(W/2+{radius}*cos({th}))");
    let yf = format!("(H/2+{radius}*sin({th}))");
    let xs = format!("clip(X+({xf}-X)*{k},0,W-1)");
    let ys = format!("clip(Y+({yf}-Y)*{k},0,H-1)");
    format!(
        "geq=r='if({guard},r({xs},{ys}),r(X,Y))':g='if({guard},g({xs},{ys}),g(X,Y))':b='if({guard},b({xs},{ys}),b(X,Y))':a='alpha(X,Y)'"
    )
}

pub(crate) fn caleidoscopio_transition_filter(lead: f64, fps: f64) -> String {
    let lead_frames = (lead.max(0.0) * fps.max(1.0)).round().max(1.0);
    caleidoscopio_geq(
        &format!("clip(N/{lead_frames:.0},0,1)"),
        &format!("lt(N,{lead_frames:.0})"),
    )
}

/// Versión de un frame: el progreso ya viene resuelto por el preview.
pub(crate) fn caleidoscopio_frozen_filter(progress: f64) -> String {
    caleidoscopio_geq(&format!("{progress:.6}"), "1")
}

/// `desenfoque-lineal` (paridad del `LinearBlur` MIT de `transicoes_gl`
/// de AlaukCut): el clip entrante aparece con un desenfoque direccional
/// en estelas (vector a ~30°) que se acorta hasta quedar nítido con el
/// progreso. geq no tiene vecindario: el blur es un promedio de 9 taps
/// a lo largo del vector — box-blur direccional aproximado, con el
/// paso por tap `(1-p)*7` px → racha máxima ~±28 px al inicio.
fn desenfoque_lineal_geq(progress: &str, guard: &str) -> String {
    const DX: f64 = 0.8660254;
    const DY: f64 = 0.5;
    let taps = |channel: char| -> String {
        let terms: Vec<String> = (-4i32..=4)
            .map(|i| {
                let k = i as f64 * 7.0;
                format!(
                    "{channel}(X+({k:.1}*(1-({progress}))*{DX}),Y+({k:.1}*(1-({progress}))*{DY}))"
                )
            })
            .collect();
        format!("({})/9", terms.join("+"))
    };
    let (r, g, b) = (taps('r'), taps('g'), taps('b'));
    format!(
        "geq=r='if({guard},{r},r(X,Y))':g='if({guard},{g},g(X,Y))':b='if({guard},{b},b(X,Y))':a='alpha(X,Y)'"
    )
}

pub(crate) fn desenfoque_lineal_transition_filter(lead: f64, fps: f64) -> String {
    let lead_frames = (lead.max(0.0) * fps.max(1.0)).round().max(1.0);
    desenfoque_lineal_geq(
        &format!("clip(N/{lead_frames:.0},0,1)"),
        &format!("lt(N,{lead_frames:.0})"),
    )
}

/// Versión de un frame: el progreso ya viene resuelto por el preview.
pub(crate) fn desenfoque_lineal_frozen_filter(progress: f64) -> String {
    desenfoque_lineal_geq(&format!("{progress:.6}"), "1")
}

/// `warp-direccional` (paridad del `directionalwarp` MIT de
/// `transicoes_gl` de AlaukCut): el clip entrante aparece «abombado»
/// hacia un lado — el offset es `dir · sen(π·u) · K·(1-p)`, con `u` la
/// coordenada normalizada sobre el eje perpendicular al vector de
/// desplazamiento (~30°). Seno → cero en los bordes, abombamiento
/// máximo en el centro; decae a 0 con el progreso (identidad exacta).
/// Una sola muestra por canal, como `liquido`.
fn warp_direccional_geq(progress: &str, guard: &str) -> String {
    // Eje de abombamiento (perpendicular al vector 30°) y vector de
    // desplazamiento, ambos unitarios.
    let ax = "(-0.5)";
    let ay = "0.8660254";
    let dx = "0.8660254";
    let dy = "0.5";
    // u ∈ [0,1]: proyección sobre el eje perpendicular normalizada por
    // la hipotenusa del cuadro + 0.5.
    let diag = "sqrt(W*W+H*H)";
    let u = format!(
        "(({ax}*(X-W/2)+{ay}*(Y-H/2))/{diag}+0.5)"
    );
    let bulge = format!("(sin({u}*3.14159265)*{dx}*(1-({progress}))*36)");
    let buly = format!("(sin({u}*3.14159265)*{dy}*(1-({progress}))*36)");
    format!(
        "geq=r='if({guard},r(X+{bulge},Y+{buly}),r(X,Y))':g='if({guard},g(X+{bulge},Y+{buly}),g(X,Y))':b='if({guard},b(X+{bulge},Y+{buly}),b(X,Y))':a='alpha(X,Y)'"
    )
}

pub(crate) fn warp_direccional_transition_filter(lead: f64, fps: f64) -> String {
    let lead_frames = (lead.max(0.0) * fps.max(1.0)).round().max(1.0);
    warp_direccional_geq(
        &format!("clip(N/{lead_frames:.0},0,1)"),
        &format!("lt(N,{lead_frames:.0})"),
    )
}

/// Versión de un frame: el progreso ya viene resuelto por el preview.
pub(crate) fn warp_direccional_frozen_filter(progress: f64) -> String {
    warp_direccional_geq(&format!("{progress:.6}"), "1")
}

/// `glitch-digital` (paridad del `GlitchDisplace` MIT de
/// `transicoes_gl` de AlaukCut): el clip entrante entra con bloques de
/// 16 px desplazados por un hash determinista de (bloque, N) —geq no
/// tiene variables, el hash es `fract(sin(bx·a+by·b+N·c)·k)`— más split
/// cromático horizontal que parpadea con `sin(N·…)`. La amplitud
/// `(1-p)` hace que el glitch se resuelva a identidad exacta.
fn glitch_digital_geq(progress: &str, guard: &str) -> String {
    let bx = "floor(X/16)";
    let by = "floor(Y/16)";
    // Hash pseudo-aleatorio por bloque y frame → [-1,1].
    let hash = |bx_seed: &str, by_seed: &str, n_seed: &str, k: &str| -> String {
        format!(
            "((sin({bx}*{bx_seed}+{by}*{by_seed}+N*{n_seed})*{k})-floor(sin({bx}*{bx_seed}+{by}*{by_seed}+N*{n_seed})*{k}))"
        )
    };
    let h1 = hash("127.1", "311.7", "0.37", "43758.5453");
    let h2 = hash("269.5", "183.3", "0.91", "28001.8384");
    let amp = format!("(1-({progress}))");
    let ox = format!("(({h1}*2-1)*{amp}*18)");
    let oy = format!("(({h2}*2-1)*{amp}*14)");
    // Split cromático: magnitud decrece y el signo oscila frame a frame.
    let split = format!("(sin(N*2.7)*{amp}*8)");
    format!(
        "geq=r='if({guard},r(X+{ox}+{split},Y+{oy}),r(X,Y))':g='if({guard},g(X+{ox},Y+{oy}),g(X,Y))':b='if({guard},b(X+{ox}-{split},Y+{oy}),b(X,Y))':a='alpha(X,Y)'"
    )
}

pub(crate) fn glitch_digital_transition_filter(lead: f64, fps: f64) -> String {
    let lead_frames = (lead.max(0.0) * fps.max(1.0)).round().max(1.0);
    glitch_digital_geq(
        &format!("clip(N/{lead_frames:.0},0,1)"),
        &format!("lt(N,{lead_frames:.0})"),
    )
}

/// Versión de un frame: el progreso ya viene resuelto por el preview.
pub(crate) fn glitch_digital_frozen_filter(progress: f64) -> String {
    glitch_digital_geq(&format!("{progress:.6}"), "1")
}

/// `zoom-suave` (paridad del `DreamyZoom` MIT de `transicoes_gl` de
/// AlaukCut): el clip entrante aparece ~18 % «acercado» y asienta a
/// tamaño natural — remap polar `sample = centro + (pixel-centro)·k`
/// con `k = 1+(1-p)·0.18` (mismo truco de coordenadas de
/// `caleidoscopio`), `clip` contiene el muestreo fuera del cuadro.
fn zoom_suave_geq(progress: &str, guard: &str) -> String {
    let p = format!("clip({progress},0,1)");
    let k = format!("(1+((1-{p})*0.18))");
    let nx = "(X-W/2)";
    let ny = "(Y-H/2)";
    let xs = format!("clip(W/2+{nx}*{k},0,W-1)");
    let ys = format!("clip(H/2+{ny}*{k},0,H-1)");
    format!(
        "geq=r='if({guard},r({xs},{ys}),r(X,Y))':g='if({guard},g({xs},{ys}),g(X,Y))':b='if({guard},b({xs},{ys}),b(X,Y))':a='alpha(X,Y)'"
    )
}

pub(crate) fn zoom_suave_transition_filter(lead: f64, fps: f64) -> String {
    let lead_frames = (lead.max(0.0) * fps.max(1.0)).round().max(1.0);
    zoom_suave_geq(
        &format!("clip(N/{lead_frames:.0},0,1)"),
        &format!("lt(N,{lead_frames:.0})"),
    )
}

/// Versión de un frame: el progreso ya viene resuelto por el preview.
pub(crate) fn zoom_suave_frozen_filter(progress: f64) -> String {
    zoom_suave_geq(&format!("{progress:.6}"), "1")
}

/// `zoom-rapido` (paridad del `SimpleZoom` MIT de `transicoes_gl` de
/// AlaukCut): complemento de `zoom-suave` — el clip entrante aparece
/// ~15 % «alejado» y acerca hasta tamaño natural (`k = 1-(1-p)·0.15`,
/// misma mecánica polar; a p=1 identidad exacta).
fn zoom_rapido_geq(progress: &str, guard: &str) -> String {
    let p = format!("clip({progress},0,1)");
    let k = format!("(1-((1-{p})*0.15))");
    let nx = "(X-W/2)";
    let ny = "(Y-H/2)";
    let xs = format!("clip(W/2+{nx}*{k},0,W-1)");
    let ys = format!("clip(H/2+{ny}*{k},0,H-1)");
    format!(
        "geq=r='if({guard},r({xs},{ys}),r(X,Y))':g='if({guard},g({xs},{ys}),g(X,Y))':b='if({guard},b({xs},{ys}),b(X,Y))':a='alpha(X,Y)'"
    )
}

pub(crate) fn zoom_rapido_transition_filter(lead: f64, fps: f64) -> String {
    let lead_frames = (lead.max(0.0) * fps.max(1.0)).round().max(1.0);
    zoom_rapido_geq(
        &format!("clip(N/{lead_frames:.0},0,1)"),
        &format!("lt(N,{lead_frames:.0})"),
    )
}

/// Versión de un frame: el progreso ya viene resuelto por el preview.
pub(crate) fn zoom_rapido_frozen_filter(progress: f64) -> String {
    zoom_rapido_geq(&format!("{progress:.6}"), "1")
}

/// Canales de la primera pista de audio (`a:0`) de un archivo:
/// `None` = sin pista de audio, `Some(None)` = audio sin campo `channels`,
/// `Some(Some(n))` = n canales. Reemplaza a `has_audio_stream` sumando la
/// medición de canales que el upmix mono→estéreo necesita (la ley de
/// rematrix de `aformat` baja 3 dB si no se compensa).
pub(crate) fn probe_audio_stream(ffprobe: &Path, path: &Path) -> Option<Option<u32>> {
    let mut command = Command::new(ffprobe);
    command
        .args([
            "-v",
            "error",
            "-select_streams",
            "a:0",
            "-show_entries",
            "stream=index,channels",
            "-of",
            "csv=p=0",
        ])
        .arg(path)
        .stdin(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    let output = command.output().ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let line = text.lines().next()?.trim();
    if line.is_empty() {
        return None;
    }
    // csv=p=0 → "<index>,<channels>"; el campo channels puede venir vacío.
    let mut fields = line.split(',');
    fields.next()?;
    let channels = fields
        .next()
        .and_then(|value| value.trim().parse::<u32>().ok());
    Some(channels)
}

pub(crate) fn sanitize_filter_number(value: f64) -> f64 {
    if value.is_finite() {
        value.clamp(-100_000.0, 100_000.0)
    } else {
        0.0
    }
}

/// Tramos uniformes en x con los que se aproxima cada segmento Bézier
/// (16 tramos => 17 nudos, con x=0 e x=1 cerrando exactos en 0 y 1).
// 64 tramos reducen el error de la aproximación por cuerdas de ~0,05 a
// ~0,003 de progreso incluso con manejadores extremos (1,0)-(0,1), sin
// acercarse al límite de tamaño de expresión de FFmpeg para pocos keyframes.
pub(crate) const BEZIER_PIECES: usize = 64;

/// Progreso eased de una Bézier cúbica estilo CSS para el avance de segmento
/// `t`: resuelve el parámetro u con x(u) = t (Newton, 8 iteraciones, con
/// bisección de respaldo, 24) y devuelve y(u). Port de `cubicBezierProgress`
/// en packages/project-schema/src/keyframes.ts, para que el export evalúe
/// y(x=t) igual que la preview en lugar de la fórmula paramétrica x(u).
pub(crate) fn cubic_bezier_progress(t: f64, cp1_x: f64, cp1_y: f64, cp2_x: f64, cp2_y: f64) -> f64 {
    let clamped = t.clamp(0.0, 1.0);
    if clamped <= 0.0 {
        return 0.0;
    }
    if clamped >= 1.0 {
        return 1.0;
    }
    let cx = 3.0 * cp1_x;
    let bx = 3.0 * (cp2_x - cp1_x) - cx;
    let ax = 1.0 - cx - bx;
    let cy = 3.0 * cp1_y;
    let by = 3.0 * (cp2_y - cp1_y) - cy;
    let ay = 1.0 - cy - by;
    let sample_x = |u: f64| ((ax * u + bx) * u + cx) * u;
    let sample_y = |u: f64| ((ay * u + by) * u + cy) * u;
    let derivative_x = |u: f64| (3.0 * ax * u + 2.0 * bx) * u + cx;

    let mut u = clamped;
    for _ in 0..8 {
        let x = sample_x(u) - clamped;
        if x.abs() < 1e-6 {
            return sample_y(u);
        }
        let d = derivative_x(u);
        if d.abs() < 1e-6 {
            break;
        }
        u -= x / d;
    }
    let mut low = 0.0;
    let mut high = 1.0;
    u = clamped;
    for _ in 0..24 {
        let x = sample_x(u);
        if (x - clamped).abs() < 1e-6 {
            break;
        }
        if x < clamped {
            low = u;
        } else {
            high = u;
        }
        u = (low + high) / 2.0;
    }
    sample_y(u)
}

/// Expresión FFmpeg piecewise-lineal del segmento Bézier: pre-muestrea la
/// curva en Rust resolviendo y(x) con `cubic_bezier_progress` en nudos
/// uniformes de [0,1] y anida tramos lineales con 6 decimales:
/// if(lt(X,x1),y0+(y1-y0)*(X-x0)/(x1-x0), if(...)). En x=0 el primer tramo
/// evalúa y0=0 exacto y en x=1 el cierre es y=1 exacto.
pub(crate) fn bezier_segment_expression(
    progress_expr: &str,
    cp1_x: f64,
    cp1_y: f64,
    cp2_x: f64,
    cp2_y: f64,
) -> String {
    let mut expression = format!(
        "{:.6}",
        cubic_bezier_progress(1.0, cp1_x, cp1_y, cp2_x, cp2_y)
    );
    for i in (0..BEZIER_PIECES).rev() {
        let x0 = i as f64 / BEZIER_PIECES as f64;
        let x1 = (i + 1) as f64 / BEZIER_PIECES as f64;
        let y0 = cubic_bezier_progress(x0, cp1_x, cp1_y, cp2_x, cp2_y);
        let y1 = cubic_bezier_progress(x1, cp1_x, cp1_y, cp2_x, cp2_y);
        let piece = format!(
            "{:.6}+({:.6})*({}-{:.6})/({:.6})",
            y0,
            y1 - y0,
            progress_expr,
            x0,
            x1 - x0
        );
        expression = format!(
            "if(lt({},{:.6}),{},{})",
            progress_expr, x1, piece, expression
        );
    }
    expression
}

/// Piecewise-linear FFmpeg expression for one keyframed property with cubic-bezier support.
///
/// `time_var` is the expression that yields seconds relative to the clip
/// (`t` for filters that see the clip after `setpts`, `(t-start)` for overlay
/// coordinates). Values clamp to the first/last keyframe outside the range.
pub(crate) fn keyframe_expression(
    keyframes: &[Value],
    property: &str,
    fps: f64,
    time_var: &str,
) -> Option<String> {
    let rate = fps.max(1.0);
    // Sample format: (frame_normalized, value, easing_or_bezier)
    type Sample = (f64, f64, SegmentEasing);
    let mut samples: Vec<Sample> = keyframes
        .iter()
        .filter_map(|kf| {
            let frame = kf["frame"].as_f64()?;
            let value = kf[property].as_f64().map(sanitize_filter_number)?;
            Some((frame / rate, value, parse_easing(kf)))
        })
        .collect();
    if samples.is_empty() {
        return None;
    }
    samples.sort_by(|a, b| a.0.total_cmp(&b.0));
    if samples.len() == 1 {
        return Some(format!("{:.4}", samples[0].1));
    }
    let last = samples.last()?;
    let mut expression = format!("{:.4}", last.1);
    for pair in samples.windows(2).rev() {
        let (start, end) = (&pair[0], &pair[1]);
        let delta = (end.0 - start.0).max(1e-6);
        let progress_expr = format!("(({time_var})-{:.6})/{:.6}", start.0, delta);
        // Cubic-bezier or preset easing for this segment
        let eased: String = match &start.2 {
            SegmentEasing::Bezier(cp1_x, cp1_y, cp2_x, cp2_y) => {
                // Resolver y(x=t) como la preview y emitir la curva
                // pre-muestreada como expresión piecewise-lineal (antes se
                // evaluaba la paramétrica x(u), que no es el progreso eased).
                bezier_segment_expression(&progress_expr, *cp1_x, *cp1_y, *cp2_x, *cp2_y)
            }
            SegmentEasing::Preset(easing) => match easing.as_str() {
                "ease-in" => format!("pow({},3)", progress_expr),
                "ease-out" => format!("(1-pow(1-({}),3))", progress_expr),
                "ease-in-out" => format!(
                    "(({})*({})*(3-2*({})))",
                    progress_expr, progress_expr, progress_expr
                ),
                "hold" => "0".to_owned(),
                _ => progress_expr.clone(),
            },
        };
        let slope = end.1 - start.1;
        let segment = format!("({:.4}+({:.4})*({}))", start.1, slope, eased);
        expression = format!("if(lt({time_var},{:.6}),{segment},{})", end.0, expression);
    }
    let first = &samples[0];
    Some(format!(
        "if(lt({time_var},{:.6}),{:.4},{})",
        first.0, first.1, expression
    ))
}

/// Easing for a segment: cubic-bezier control points or preset string
pub(crate) enum SegmentEasing {
    Bezier(f64, f64, f64, f64), // cp1X, cp1Y, cp2X, cp2Y
    Preset(String),
}

/// Easing de un keyframe: Bézier explícito (objeto {cp1X,cp1Y,cp2X,cp2Y} como
/// el esquema), preset nombrado, o linear por defecto. Nunca descarta la
/// muestra: un keyframe sin curva declarada interpola lineal, como el export
/// históricamente.
pub(crate) fn parse_easing(keyframe: &Value) -> SegmentEasing {
    if let Some(bezier) = keyframe["bezier"].as_object() {
        let coords = [
            bezier.get("cp1X").and_then(|v| v.as_f64()),
            bezier.get("cp1Y").and_then(|v| v.as_f64()),
            bezier.get("cp2X").and_then(|v| v.as_f64()),
            bezier.get("cp2Y").and_then(|v| v.as_f64()),
        ];
        if let [Some(cp1_x), Some(cp1_y), Some(cp2_x), Some(cp2_y)] = coords {
            return SegmentEasing::Bezier(cp1_x, cp1_y, cp2_x, cp2_y);
        }
    }
    SegmentEasing::Preset(keyframe["easing"].as_str().unwrap_or("linear").to_owned())
}

/// Expresión FFmpeg para una propiedad animada de posición del clip,
/// anclada al inicio del clip en segundos.
pub(crate) fn offset_expression(
    clip: &Value,
    property: &str,
    start_seconds: f64,
    fps: f64,
) -> Option<String> {
    let keyframes = clip["transform"]["keyframes"].as_array()?;
    keyframe_expression(
        keyframes,
        property,
        fps,
        &format!("(t-{:.6})", start_seconds.max(0.0)),
    )
}

pub(crate) fn scale_zoom_expression(
    clip: &Value,
    profile: &Profile,
    lead_seconds: f64,
) -> Option<(f64, String)> {
    if clip["scaleFrozen"].as_bool() == Some(true) {
        return None;
    }
    let transform = &clip["transform"];
    let keyframes = transform["keyframes"].as_array()?;
    if keyframes.is_empty() {
        return None;
    }
    let mut minimum = f64::INFINITY;
    let mut found = false;
    for keyframe in keyframes {
        if let Some(scale) = keyframe["scale"].as_f64() {
            if scale.is_finite() {
                minimum = minimum.min(scale);
                found = true;
            }
        }
    }
    if !found || minimum < 0.999 {
        return None;
    }
    // `on` cuenta frames ya retimados por la velocidad, así que su reloj es la
    // timeline del clip, no el tiempo de origen.
    let frame_rate = profile.fps();
    let expression = keyframe_expression(
        keyframes,
        "scale",
        profile.fps(),
        &format!(
            "((on-{:.0})/{:.6})",
            (lead_seconds * frame_rate).round(),
            frame_rate
        ),
    )?;
    Some((1.0, format!("max(1,({expression}))")))
}

/// Devuelve `(max, factor)` para una curva que baja de 1×. La capa se
/// pre-escala una vez al máximo (Lanczos) y cada frame se reduce dentro de un
/// lienzo fijo; así no se baja a 0,7 para volver a subir a 1,3, que perdía
/// nitidez. El factor es `escala/max <= 1` y `pad` centra el contenido.
pub(crate) fn scale_dynamic_expression(
    clip: &Value,
    profile: &Profile,
    lead_seconds: f64,
    speed_num: u32,
    speed_den: u32,
    is_image: bool,
) -> Option<(f64, String)> {
    if clip["scaleFrozen"].as_bool() == Some(true) {
        return None;
    }
    let transform = &clip["transform"];
    let keyframes = transform["keyframes"].as_array()?;
    if keyframes.is_empty() {
        return None;
    }
    let mut minimum = f64::INFINITY;
    let mut maximum = f64::NEG_INFINITY;
    let mut found = false;
    for keyframe in keyframes {
        if let Some(scale) = keyframe["scale"].as_f64() {
            if scale.is_finite() {
                minimum = minimum.min(scale);
                maximum = maximum.max(scale);
                found = true;
            }
        }
    }
    if !found || minimum >= 0.999 || maximum <= 0.001 {
        return None;
    }
    // El `setpts` de velocidad cambia la cantidad de frames por segundo del
    // flujo; a diferencia de `zoompan`, este `scale` no lo re-muestrea, así que
    // el reloj de `n` debe usar la tasa retimada y no la fps nominal.
    let rate = if is_image {
        profile.fps()
    } else {
        profile.fps() * speed_num.max(1) as f64 / speed_den.max(1) as f64
    };
    let expression = keyframe_expression(
        keyframes,
        "scale",
        profile.fps(),
        &format!("((n-{:.0})/{:.6})", (lead_seconds * rate).round(), rate),
    )?;
    let factor = format!("max(0.001,min(1,(({expression})/{maximum:.6})))");
    Some((maximum, factor))
}

/// VP9 con alfa guarda el canal en un stream lateral que el decodificador
/// nativo de FFmpeg no expone; el de libvpx sí. Sólo se fuerza en los assets
/// marcados con `media.alpha`, para no cambiar el decoder de un WebM común.
pub(crate) fn alpha_video_decoder(asset: &Value) -> Option<&'static str> {
    if asset["media"]["alpha"].as_bool() == Some(true) {
        Some("libvpx-vp9")
    } else {
        None
    }
}

pub(crate) fn blend_mode_name(mode: &str) -> Option<&'static str> {
    match mode {
        "multiply" => Some("multiply"),
        "screen" => Some("screen"),
        // The base is the first blend input, so hardlight reproduces an
        // overlay with the clip on top.
        "overlay" => Some("hardlight"),
        "soft-light" => Some("softlight"),
        "darken" => Some("darken"),
        "lighten" => Some("lighten"),
        "color-dodge" => Some("dodge"),
        "color-burn" => Some("burn"),
        "hard-light" => Some("hardlight"),
        _ => None,
    }
}

/// Eje de deslizamiento de una transición `slide-*`/`slide-3d-*`:
/// `Some("x")` para entradas laterales, `Some("y")` para verticales.
pub(crate) fn slide_axis(transition: &str) -> Option<&'static str> {
    match transition {
        "slide-left" | "slide-right" | "slide-3d-left" | "slide-3d-right" => Some("x"),
        "slide-up" | "slide-down" | "slide-3d-up" | "slide-3d-down" => Some("y"),
        _ => None,
    }
}

pub(crate) fn overlay_x_expression(
    clip: &Value,
    start_seconds: f64,
    lead_seconds: f64,
    offset_x: &str,
) -> String {
    let center = format!("(W-overlay_w)/2+({offset_x})");
    if lead_seconds <= 0.001
        || slide_axis(clip["transitionIn"]["type"].as_str().unwrap_or("")) != Some("x")
    {
        return center;
    }
    let from = (start_seconds - lead_seconds).max(0.0);
    let transition = clip["transitionIn"]["type"].as_str().unwrap_or("");
    let direction = if transition == "slide-left" || transition == "slide-3d-left" {
        "W"
    } else {
        "-W"
    };
    format!(
        "if(lt(t,{start_seconds:.6}),{center}+({direction})*(1-((t-{from:.6})/{lead_seconds:.6})),{center})"
    )
}

pub(crate) fn overlay_y_expression(
    clip: &Value,
    start_seconds: f64,
    lead_seconds: f64,
    offset_y: &str,
    animation_y: Option<&str>,
) -> String {
    let base = format!("(H-overlay_h)/2+({offset_y})");
    let base = match animation_y {
        Some(term) => format!("({base})+({term})"),
        None => base,
    };
    let transition = clip["transitionIn"]["type"].as_str().unwrap_or("");
    if lead_seconds <= 0.001 || slide_axis(transition) != Some("y") {
        return base;
    }
    let from = (start_seconds - lead_seconds).max(0.0);
    // slide-up/slide-3d-up entran desde abajo y suben; slide-down/slide-3d-down
    // entran desde arriba.
    let direction = if transition == "slide-up" || transition == "slide-3d-up" {
        "H"
    } else {
        "-H"
    };
    format!(
        "if(lt(t,{start_seconds:.6}),({base})+({direction})*(1-((t-{from:.6})/{lead_seconds:.6})),({base}))"
    )
}
