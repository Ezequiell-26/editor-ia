export function AssetsPanel() {
  return (
    <section className="view">
      <h2>Assets</h2>
      <p className="view-summary">Medios declarados por el proyecto y sus derechos.</p>
      <p className="empty-state">
        Todavía no hay assets: no hay proyecto abierto y la ingesta de medios no está implementada.
        Cuando existan, cada uno llega con licencia y procedencia declaradas. El formato de
        proyecto rechaza un material apto para exportar si esos datos faltan.
      </p>
    </section>
  );
}
