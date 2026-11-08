/**
 * Contrato de desuscripción de eventos.
 *
 * Los contratos del servicio no dependen de `@tauri-apps/api`: este alias
 * local es estructuralmente idéntico a `UnlistenFn` y lo que devuelven los
 * adaptadores de `platform/tauri`.
 */
export type UnlistenFn = () => void;
