import {useState} from "react";
import {AppShell} from "./components/AppShell";
import {ProjectHome} from "./features/projects/ProjectHome";
import {EditorWorkspace} from "./features/editor/EditorWorkspace";
import {AssetsPanel} from "./features/assets/AssetsPanel";
import {SettingsHome} from "./features/settings/SettingsHome";
import type {PageKey} from "./app/navigation";
export default function App(){const [page,setPage]=useState<PageKey>("projects");return <AppShell activePage={page} onNavigate={setPage}>{page==="projects"&&<ProjectHome onOpenEditor={()=>setPage("editor")}/ >}{page==="editor"&&<EditorWorkspace/>}{page==="assets"&&<AssetsPanel/>}{page==="settings"&&<SettingsHome/>}</AppShell>}