use super::*;

#[test]
fn slot_rechaza_nombres_peligrosos() {
    assert!(sanitize_slot("").is_err());
    assert!(sanitize_slot("../etc").is_err());
    assert!(sanitize_slot("a b").is_err());
    assert!(sanitize_slot(&"x".repeat(40)).is_err());
    assert_eq!(sanitize_slot("Flow").unwrap(), "flow");
    assert_eq!(sanitize_slot("mi-web_1").unwrap(), "mi-web_1");
}

#[test]
fn url_vacia_cae_al_default_y_rechaza_esquemas_raros() {
    assert_eq!(validate_url("").unwrap(), DEFAULT_URL);
    assert!(validate_url("file:///etc/passwd").is_err());
    assert!(validate_url("javascript:alert(1)").is_err());
}

#[test]
fn flow_tiene_puerto_cdp_fijo_y_otros_slots_no_colisionan() {
    assert_eq!(slot_port("flow"), BASE_CDP_PORT);
    assert_ne!(slot_port("canva"), slot_port("flow"));
    assert_ne!(slot_port("canva"), slot_port("leonardo"));
    for slot in ["canva", "leonardo", "free-tier"] {
        let port = slot_port(slot);
        assert!(port > BASE_CDP_PORT && port < BASE_CDP_PORT + CDP_PORT_RANGE);
    }
}

#[test]
fn window_label_prefija_web() {
    assert_eq!(window_label("flow"), "web-flow");
    assert_eq!(window_label("canva"), "web-canva");
}

#[test]
fn register_slot_resuelve_colisiones_con_puerto_libre() {
    // Dos slots que hashean al mismo puerto: el segundo debe recibir otro.
    let no_free = || None;
    // Busca un par que colisione dentro del rango.
    let slots: Vec<String> = (0..200).map(|i| format!("slot-{i}")).collect();
    let mut collision = None;
    'outer: for (i, a) in slots.iter().enumerate() {
        for b in slots.iter().skip(i + 1) {
            if slot_port(a) == slot_port(b) {
                collision = Some((a.clone(), b.clone()));
                break 'outer;
            }
        }
    }
    let Some((first, second)) = collision else {
        // Con 200 nombres es estadísticamente improbable no hallar colisión;
        // si no aparece, el test no aplica en esta corrida.
        return;
    };
    let port_a = register_slot(&first, &no_free);
    let port_b = register_slot(&second, &|| Some(19999));
    assert_eq!(port_a, slot_port(&first));
    assert_ne!(port_b, port_a);
    assert_eq!(port_b, 19999);
    // El mapa devuelve el puerto efectivo para ambos.
    assert_eq!(slot_port_for(&first), port_a);
    assert_eq!(slot_port_for(&second), port_b);
    unregister_slot(&first);
    unregister_slot(&second);
}
