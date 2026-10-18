export function ProjectHome() {
  return (
    <section className="view">
      <h2>Projects</h2>
      <p className="view-summary">Proyectos guardados en este dispositivo.</p>
      <p className="empty-state">
        Todavía no hay proyectos. Los comandos nativos para crear y abrir un archivo
        <code> .editoria.json</code> llegan con la tarea 4, así que en esta pantalla no hay
        botones: no existe todavía una forma real de crear o abrir nada.
      </p>
    </section>
  );
}
