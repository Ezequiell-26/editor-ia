import { useState } from "react";
import { AudioLines, Captions, Film, FolderOpen, Layers3, MousePointer2, Play, Save, Settings2, Sparkles, WandSparkles } from "lucide-react";
import type { ProjectDocument } from "@editor-ia/project-schema";

type SaveStatus = "idle" | "dirty" | "saving" | "saved" | "failed";

export function EditorWorkspace({ project, onSave, saveError }: { project: ProjectDocument | null; onSave?: (project: ProjectDocument) => Promise<void>; saveError?: string }) {
  const [draft, setDraft] = useState<ProjectDocument | null>(project);
  const [isDirty, setIsDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");

  async function saveDraft() {
    if (!draft || !onSave) return;
    setSaveStatus("saving");
    try {
      const updated = { ...draft, updatedAt: new Date().toISOString() };
      await onSave(updated);
      setDraft(updated);
      setIsDirty(false);
      setSaveStatus("saved");
    } catch {
      // Preserve the draft and its dirty state; the save can be retried.
      setIsDirty(true);
      setSaveStatus("failed");
    }
  }

  return (
    <section className="editor-page" aria-labelledby="editor-heading">
      <div className="editor-header"><div><div className="eyebrow"><i/> ESPACIO DE EDICIÓN</div><h1 id="editor-heading">{draft ? "Editor de contenido" : "Editor de contenido"}</h1><p className="page-description">{draft ? "Proyecto local abierto. Editá el nombre y guardá los cambios." : "La interfaz base está lista. Creá o abrí un proyecto para habilitar el guardado."}</p></div><div className="header-actions"><span className="draft"><i/> {draft ? (isDirty ? "Cambios sin guardar" : saveStatus === "saved" ? "Proyecto guardado" : "Proyecto abierto") : "Sin proyecto abierto"}</span><button className={draft && onSave && saveStatus!=="saving" ? "button-secondary" : "button-disabled"} onClick={() => void saveDraft()} disabled={!draft || !onSave || saveStatus==="saving"}><Save size={14}/>{saveStatus==="saving" ? "Guardando..." : "Guardar"}</button><button className="button-disabled" disabled title="El renderizador se implementará en la siguiente fase">Exportar</button></div></div>
      {draft && <div className="project-title-field"><label htmlFor="editor-project-name">Nombre del proyecto</label><input id="editor-project-name" value={draft.name} maxLength={160} onChange={(event) => { setDraft({ ...draft, name: event.target.value }); setIsDirty(true); setSaveStatus("dirty"); }}/>{saveStatus==="failed" && <span role="alert" className="inline-error">{saveError || "No se pudo guardar. Tus cambios siguen pendientes."}</span>}{saveStatus==="saved" && !isDirty && <span className="saved-indicator">Cambios guardados</span>}</div>}
      <div className="editor-grid"><section className="panel"><div className="panel-head"><span><Film size={15}/> PREVISUALIZACIÓN</span><small>{draft ? `${draft.settings.width}×${draft.settings.height} · ${draft.settings.fps} FPS` : "16:9 · 1080p"}</small></div><div className="preview"><div className="preview-art"><div className="grid-art"/><div className="play-orb"><Play size={19} fill="currentColor"/></div><label>● PREVIEW</label></div><div className="preview-copy"><b>El lienzo espera tu idea</b><small>La previsualización aparecerá cuando haya escenas y recursos.</small></div></div><div className="preview-foot"><button disabled aria-label="Reproducir (requiere una escena)"><Play size={13}/></button><code>00:00:00:00</code><span/><small>{draft?.settings.fps ?? 30} FPS</small><small>100%</small></div></section><aside className="panel inspector"><div className="panel-head"><span><Settings2 size={15}/> INSPECTOR</span><small>···</small></div><div className="inspector-empty"><div><MousePointer2 size={20}/></div><b>Nada seleccionado</b><p>Seleccioná una escena o un clip para editar sus propiedades.</p></div><div className="line"/><h4>HERRAMIENTAS DEL PROYECTO</h4><div className="tool-row"><Captions size={15}/><span><b>Subtítulos</b><small>Sin pista de subtítulos</small></span><small>—</small></div><div className="tool-row"><AudioLines size={15}/><span><b>Audio</b><small>Sin pista de audio</small></span><small>—</small></div><div className="tool-row"><WandSparkles size={15}/><span><b>Motion graphics</b><small>Plantillas no cargadas</small></span><small>—</small></div></aside></div>
      <section className="panel timeline"><div className="timeline-head"><span><Layers3 size={15}/><b>Línea de tiempo</b><label>{draft?.clips.length ? "CON CLIPS" : "VACÍA"}</label></span><small>{draft?.settings.fps ?? 30} FPS　·　00:00</small></div><div className="ruler"><span>00:00</span><span>00:05</span><span>00:10</span><span>00:15</span><span>00:20</span><span>00:25</span><span>00:30</span></div>{[["Video 1",Film],["Audio 1",AudioLines],["Subtítulos",Captions]].map(([name,Icon])=><div className="track-row" key={name as string}><div className="track-label"><Icon size={14}/>{name as string}</div><div className="track-lane">{name==="Video 1"&&!draft?.clips.length&&<span>＋　Importá medios para empezar a editar</span>}</div></div>)}<div className="timeline-foot"><span><FolderOpen size={13}/>{draft ? draft.name : "No hay proyecto cargado"}</span><span><Sparkles size={13}/> Edición asistida por IA: pendiente de integración</span></div></section>
    </section>
  );
}
