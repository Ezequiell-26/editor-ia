//! Dominio AI: contratos puros de proveedores, generación de guiones,
//! efectos, traducción y sondeo de conexión. La orquestación vive en
//! `application::providers`; keyring/HTTP/settings en `infrastructure::ai`.

pub mod assistant;
pub mod motion;
pub mod providers;
pub mod watchdog;
