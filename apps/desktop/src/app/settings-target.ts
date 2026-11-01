/**
 * Pedido de sección para la ventana de Configuración. Evita prop-drilling por
 * todas las vistas: la vista marca la sección y navega a `settings`; App la
 * consume al abrir la ventana.
 */
import type { SettingsSectionId } from '../features/settings/SettingsHome';

let pending: SettingsSectionId | null = null;

export function openSettingsAt(section: SettingsSectionId): void {
  pending = section;
}

export function takeSettingsSection(): SettingsSectionId | null {
  const value = pending;
  pending = null;
  return value;
}
