import { useState } from 'react';
import type { Asset } from '@editor-ia/project-schema';
import { Icon } from '../../components/Icon';

export interface FolderStructure {
  readonly name: string;
  readonly path: string;
  readonly assets: Asset[];
  readonly subfolders: FolderStructure[];
  readonly isExpanded?: boolean;
}

interface AssetFolderTreeProps {
  readonly folders: FolderStructure[];
  readonly onFolderClick: (path: string) => void;
  readonly selectedFolder: string | null;
  readonly onCreateFolder: () => void;
}

/**
 * Árbol de carpetas para organizar assets como en Filmora.
 * Muestra una jerarquía de carpetas con contadores de assets.
 */
export function AssetFolderTree({
  folders,
  onFolderClick,
  selectedFolder,
  onCreateFolder,
}: AssetFolderTreeProps) {
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(['root']));

  const toggleFolder = (path: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const renderFolder = (folder: FolderStructure, depth: number = 0) => {
    const isExpanded = expandedFolders.has(folder.path);
    const isSelected = selectedFolder === folder.path;
    const hasSubfolders = folder.subfolders.length > 0;
    const assetCount = folder.assets.length;

    return (
      <div key={folder.path} className="folder-tree-item" style={{ paddingLeft: `${depth * 16}px` }}>
        <div
          className={`folder-row ${isSelected ? 'selected' : ''}`}
          onClick={() => onFolderClick(folder.path)}
        >
          {hasSubfolders && (
            <button
              type="button"
              className="folder-expand"
              onClick={(e) => {
                e.stopPropagation();
                toggleFolder(folder.path);
              }}
              aria-label={isExpanded ? 'Colapsar carpeta' : 'Expandir carpeta'}
            >
              <Icon name={isExpanded ? 'chevron-down' : 'chevron'} size={12} />
            </button>
          )}
          {!hasSubfolders && <span className="folder-spacer" />}
          <Icon name="folder" size={14} />
          <span className="folder-name">{folder.name}</span>
          {assetCount > 0 && <span className="folder-count">{assetCount}</span>}
        </div>
        {isExpanded && hasSubfolders && (
          <div className="folder-children">
            {folder.subfolders.map((subfolder) => renderFolder(subfolder, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="asset-folder-tree">
      <div className="folder-tree-header">
        <h3>Carpetas</h3>
        <button
          type="button"
          className="small icon-only"
          onClick={onCreateFolder}
          title="Nueva carpeta"
          aria-label="Crear nueva carpeta"
        >
          <Icon name="plus" size={14} />
        </button>
      </div>
      <div className="folder-tree-list">
        {folders.map((folder) => renderFolder(folder, 0))}
      </div>
    </div>
  );
}

/**
 * Convierte la estructura plana de bins en una jerarquía de carpetas.
 * Los bins con "/" se interpretan como rutas de carpetas.
 */
export function buildFolderHierarchy(assets: Asset[]): FolderStructure[] {
  const root: FolderStructure = {
    name: 'Project Media',
    path: 'root',
    assets: assets.filter((a) => !a.bin || a.bin === ''),
    subfolders: [],
  };

  const folderMap = new Map<string, FolderStructure>();
  folderMap.set('root', root);

  // Recopilar todos los bins únicos
  const bins = new Set<string>();
  for (const asset of assets) {
    if (asset.bin && asset.bin.trim()) {
      bins.add(asset.bin);
    }
  }

  // Crear estructura de carpetas
  for (const bin of Array.from(bins).sort()) {
    const parts = bin.split('/').filter((p) => p.trim());
    let currentPath = 'root';
    let parent = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      const newPath = `${currentPath}/${part}`;

      if (!folderMap.has(newPath)) {
        const isLeaf = i === parts.length - 1;
        const folder: FolderStructure = {
          name: part,
          path: newPath,
          assets: isLeaf ? assets.filter((a) => a.bin === bin) : [],
          subfolders: [],
        };
        folderMap.set(newPath, folder);
        parent.subfolders.push(folder);
      }

      parent = folderMap.get(newPath)!;
      currentPath = newPath;
    }
  }

  return [root];
}
