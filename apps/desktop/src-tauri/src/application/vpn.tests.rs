use super::*;

#[test]
fn parsea_array_y_objeto_unico() {
    let array = r#"[{"name":"Casa","server":"vpn.ejemplo.com","tunnel":"IKEv2","status":"Disconnected"}]"#;
    let list = parse_vpn_connections(array);
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].name, "Casa");
    assert_eq!(list[0].server_address, "vpn.ejemplo.com");
    assert_eq!(list[0].tunnel_type, "IKEv2");
    assert_eq!(list[0].status, "Disconnected");

    let single =
        r#"{"name":"Oficina","server":"10.0.0.1","tunnel":"L2tp","status":"Connected"}"#;
    let list = parse_vpn_connections(single);
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].status, "Connected");
}

#[test]
fn tolera_vacio_null_y_basura() {
    assert!(parse_vpn_connections("").is_empty());
    assert!(parse_vpn_connections("null").is_empty());
    assert!(parse_vpn_connections("esto no es json").is_empty());
    assert!(parse_vpn_connections("[]").is_empty());
}

#[test]
fn descarta_entradas_sin_nombre() {
    let json =
        r#"[{"name":"","server":"x"},{"server":"y"},{"name":"Ok","status":"Disconnected"}]"#;
    let list = parse_vpn_connections(json);
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].name, "Ok");
}

#[test]
fn require_known_connection_rechaza_desconocidas() {
    let connections = vec![VpnConnection {
        name: "Casa".to_owned(),
        server_address: String::new(),
        tunnel_type: String::new(),
        status: "Disconnected".to_owned(),
    }];
    assert!(require_known_connection(&connections, "Casa").is_ok());
    assert!(require_known_connection(&connections, "Otra").is_err());
    // Inyección tipo "Casa; rm -rf" no matchea nada.
    assert!(require_known_connection(&connections, "Casa\" /disconnect").is_err());
}
