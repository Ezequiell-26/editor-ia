import { useState } from 'react';
import { useProjectStore } from '../../state/project-store';
import { folderQueueSummary, runFolderQueue, type FolderQueueReport } from '../../state/folder-queue';

/**
 * Cola por carpeta.
 *
 * Procesa los videos de una carpeta sin abrir nada: copia el material, arma un
 * proyecto por archivo, limpia con el perfil medido, renderiza y verifica. No
 * toca el proyecto que la persona tiene abierto.
 */
export function FolderQueuePanel() {
  const store = useProjectStore();
  const root = store.state.opened?.root ?? '';
  const [folder, setFolder] = useState('');
  const [outputDir, setOutputDir] = useState(root ? `${root}\\entregas` : '');
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<FolderQueueReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(): Promise<void> {
    if (!folder.trim() || !outputDir.trim() || busy) return;
    setBusy(true);
    setError(null);
    setReport(null);
    try {
      const result = await runFolderQueue(store.service, {
        folder: folder.trim(),
        outputDir: outputDir.trim(),
      });
      setReport(result);
      store.setNotice(`Cola por carpeta: ${folderQueueSummary(result)}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'no pude procesar la carpeta');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card folder-queue" aria-label="Cola por carpeta">
      <header className="folder-queue-head">
        <div>
          <p className="eyebrow">Modo desatendido</p>
          <h3>Procesar una carpeta</h3>
        </div>
        <span className="fine-print">hasta 12 videos por corrida</span>
      </header>
      <p className="fine-print">
        Cada video se entrega como proyecto y MP4 en la carpeta de salida. No abre ni modifica el
        proyecto actual.
      </p>
      <div className="inspector-grid">
        <label className="field">
          <span>Carpeta de entrada</span>
          <input
            type="text"
            value={folder}
            placeholder="C:\\Users\\tu-usuario\\Videos\\crudos"
            onChange={(event) => setFolder(event.target.value)}
          />
        </label>
        <label className="field">
          <span>Carpeta de entrega</span>
          <input
            type="text"
            value={outputDir}
            placeholder="C:\\Users\\tu-usuario\\Videos\\entregas"
            onChange={(event) => setOutputDir(event.target.value)}
          />
        </label>
      </div>
      <div className="actions compact">
        <button
          type="button"
          className="small primary"
          disabled={busy || !folder.trim() || !outputDir.trim()}
          onClick={() => void run()}
        >
          {busy ? 'Procesando carpeta…' : 'Procesar carpeta'}
        </button>
        {report ? <span className="fine-print">{folderQueueSummary(report)}</span> : null}
      </div>
      {error ? (
        <p className="notice notice-warning" role="alert">
          {error}
        </p>
      ) : null}
      {report && report.items.length > 0 ? (
        <ul className="keyframe-list folder-queue-results">
          {report.items.map((item) => (
            <li key={item.path} className="fine-print">
              <strong>{item.name}</strong> · {item.message}
              {item.videoPath ? <span className="muted"> → {item.videoPath}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
