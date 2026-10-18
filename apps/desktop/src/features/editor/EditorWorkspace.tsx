export function EditorWorkspace() {
  return (
    <section className="view editor-grid">
      <div className="view-head">
        <h2>Editor</h2>
        <p className="view-summary">Timeline, preview e inspector del proyecto abierto.</p>
      </div>
      <div className="editor-panels">
        <section className="panel preview">
          <h3>Preview</h3>
          <p className="empty-state">
            No hay proyecto abierto. La vista previa no está disponible: no hay reproductor ni
            decodificador conectado a esta ventana.
          </p>
        </section>
        <section className="panel inspector">
          <h3>Inspector</h3>
          <p className="empty-state">
            Sin selección. El inspector muestra propiedades de un clip seleccionado, y acá no se
            puede seleccionar ninguno.
          </p>
        </section>
        <section className="panel timeline">
          <h3>Timeline vacía</h3>
          <p className="empty-state">
            0 pistas y 0 clips. Montar y exportar no están habilitados en esta versión: el worker
            de render llega con la tarea 5 y ningún resultado se reporta como terminado sin archivo
            verificado.
          </p>
        </section>
      </div>
    </section>
  );
}
