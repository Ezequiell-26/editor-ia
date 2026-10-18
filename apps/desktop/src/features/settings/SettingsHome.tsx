export function SettingsHome() {
  return (
    <section className="view">
      <h2>Settings</h2>
      <p className="view-summary">Preferencias de la app, proveedores y herramientas externas.</p>
      <p className="empty-state">
        Ninguna preferencia está operativa todavía. Esta pantalla informa qué falta en lugar de
        ofrecer controles que no hacen nada.
      </p>
      <ul className="pending-list">
        <li>
          Proveedores de IA: sin configurar. La app no llama a ningún modelo ni genera guiones,
          voces ni escenas.
        </li>
        <li>
          Almacén de credenciales: no implementado. Ninguna API key se guarda en el proyecto ni en
          el navegador.
        </li>
        <li>
          FFmpeg y Remotion: sin detección. Las capacidades del worker se declaran no disponibles
          hasta la tarea 5.
        </li>
      </ul>
    </section>
  );
}
