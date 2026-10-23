import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { ViewId } from '../app/navigation';
import { NAV_VIEWS } from '../app/navigation';
import { detectNativeRuntime } from '../services/project-service';
import { useAppearance } from '../state/AppearanceProvider';
import { deleteCaptionCue, deleteClip, duplicateClip, splitClip, totalFrames } from '../state/project-actions';
import { useProjectStore } from '../state/project-store';
import { Icon } from './Icon';

type MenuId = 'file' | 'edit' | 'view' | 'playback' | 'tools' | 'help';

interface MenuItem {
  readonly kind: 'item';
  readonly label: string;
  readonly shortcut?: string;
  readonly disabled?: boolean;
  readonly checked?: boolean;
  readonly action: () => void;
}

interface MenuSeparator {
  readonly kind: 'separator';
  readonly id: string;
}

type MenuEntry = MenuItem | MenuSeparator;

interface MenuDefinition {
  readonly id: MenuId;
  readonly label: string;
  readonly entries: readonly MenuEntry[];
}

interface MenuBarProps {
  readonly activeId: ViewId;
  readonly onSelect: (id: ViewId) => void;
  readonly onOpenStart?: () => void;
}

export function MenuBar({ activeId, onSelect, onOpenStart }: MenuBarProps) {
  const store = useProjectStore();
  const { appearance, update, reset } = useAppearance();
  const [openMenu, setOpenMenu] = useState<MenuId | null>(null);
  const [modal, setModal] = useState<'shortcuts' | 'about' | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [configDir, setConfigDir] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  const project = store.state.project;
  const selection = store.state.selection;
  const clipId = selection.kind === 'clip' ? selection.id : null;
  const cueId = selection.kind === 'cue' ? selection.id : null;
  const hasClip = Boolean(project?.timeline.clips.length);
  const canEdit = store.service.available && project !== null;

  useEffect(() => {
    if (!openMenu) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpenMenu(null);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [openMenu]);

  useEffect(() => {
    if (!detectNativeRuntime()) return;
    let active = true;
    void getCurrentWindow()
      .isFullscreen()
      .then((value) => {
        if (active) setFullscreen(value);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'F11') {
        event.preventDefault();
        void toggleFullscreen();
      }
      if (event.key === 'Escape') {
        setOpenMenu(null);
        setModal(null);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // The handler only uses stable setters and the window API.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function toggleFullscreen(): Promise<void> {
    if (!detectNativeRuntime()) return;
    try {
      const next = !(await getCurrentWindow().isFullscreen());
      await getCurrentWindow().setFullscreen(next);
      setFullscreen(next);
    } catch {
      setFullscreen(false);
    }
  }

  const focusFirstItem = useCallback(() => {
    window.setTimeout(() => {
      dropdownRef.current
        ?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')
        ?.focus();
    }, 0);
  }, []);

  function openExport(): void {
    if (!project) return;
    if (activeId !== 'editor') onSelect('editor');
    store.requestExport();
  }

  function splitSelected(): void {
    if (!clipId) return;
    store.mutate((current) => {
      const split = splitClip(current, clipId, store.state.playheadFrame);
      if (!split) throw new Error('el cabezal no está dentro del clip seleccionado');
      return { project: split.project, rightClipId: split.rightClipId };
    });
  }

  function duplicateSelected(): void {
    if (!clipId) return;
    const result = store.mutate((current) => {
      const copy = duplicateClip(current, clipId);
      if (!copy) throw new Error('no se pudo duplicar el clip');
      return { project: copy.project, clipId: copy.clipId };
    });
    if (result) store.setSelection({ kind: 'clip', id: result.clipId });
  }

  function deleteSelected(): void {
    if (clipId) {
      let duration = 0;
      store.update((current) => {
        const next = deleteClip(current, clipId);
        duration = totalFrames(next);
        return next;
      });
      store.setSelection({ kind: 'none' });
      store.setPlayhead(Math.min(store.state.playheadFrame, duration));
      return;
    }
    if (cueId) {
      store.update((current) => deleteCaptionCue(current, cueId));
      store.setSelection({ kind: 'none' });
    }
  }

  function seek(frame: number): void {
    store.setPlaying(false);
    store.setPlayhead(frame);
  }

  async function showAbout(): Promise<void> {
    setModal('about');
    if (configDir || !store.service.available) return;
    try {
      const info = await store.service.systemInfo();
      setConfigDir(info.configDir);
    } catch {
      setConfigDir(null);
    }
  }

  const viewItems: MenuItem[] = NAV_VIEWS.map((view) => ({
    kind: 'item',
    label: view.label,
    checked: activeId === view.id,
    action: () => onSelect(view.id),
  }));

  const menus: readonly MenuDefinition[] = [
    {
      id: 'file',
      label: 'Archivo',
      entries: [
        {
          kind: 'item',
          label: 'Pantalla de inicio…',
          action: () => {
            if (onOpenStart) onOpenStart();
            else onSelect('home');
          },
        },
        { kind: 'separator', id: 'file-start' },
        {
          kind: 'item',
          label: 'Nuevo proyecto…',
          action: () => {
            onSelect('projects');
            window.setTimeout(() => {
              document.querySelector<HTMLInputElement>('#project-name')?.focus();
            }, 30);
          },
        },
        {
          kind: 'item',
          label: 'Abrir proyecto…',
          shortcut: 'Ctrl+O',
          disabled: !store.service.available || store.state.phase === 'saving',
          action: () => {
            void store.openProject().then((ok) => {
              if (ok) onSelect('editor');
            });
          },
        },
        { kind: 'separator', id: 'file-save' },
        {
          kind: 'item',
          label: 'Guardar',
          shortcut: 'Ctrl+S',
          disabled: !canEdit || store.state.phase === 'saving',
          action: () => void store.saveNow(),
        },
        {
          kind: 'item',
          label: 'Guardar como…',
          shortcut: 'Ctrl+Shift+S',
          disabled: !canEdit || store.state.phase === 'saving',
          action: () => void store.saveAs(),
        },
        {
          kind: 'item',
          label: 'Empaquetar proyecto (.zip)…',
          disabled: !canEdit || store.state.phase === 'saving',
          action: () => void store.packageProject(),
        },
        { kind: 'separator', id: 'file-export' },
        {
          kind: 'item',
          label: 'Exportar video…',
          shortcut: 'Ctrl+E',
          disabled: !canEdit || !hasClip,
          action: openExport,
        },
        {
          kind: 'item',
          label: 'Convertir medios…',
          action: () => onSelect('convert'),
        },
        { kind: 'separator', id: 'file-close' },
        {
          kind: 'item',
          label: 'Cerrar proyecto',
          disabled: !project,
          action: () => {
            store.closeProject();
            onSelect('projects');
          },
        },
      ],
    },
    {
      id: 'edit',
      label: 'Editar',
      entries: [
        {
          kind: 'item',
          label: 'Deshacer',
          shortcut: 'Ctrl+Z',
          disabled: !store.canUndo,
          action: store.undo,
        },
        {
          kind: 'item',
          label: 'Rehacer',
          shortcut: 'Ctrl+Shift+Z',
          disabled: !store.canRedo,
          action: store.redo,
        },
        { kind: 'separator', id: 'edit-clip' },
        {
          kind: 'item',
          label: 'Duplicar clip',
          shortcut: 'Ctrl+D',
          disabled: !clipId,
          action: duplicateSelected,
        },
        {
          kind: 'item',
          label: 'Dividir en el cabezal',
          shortcut: 'S',
          disabled: !clipId,
          action: splitSelected,
        },
        {
          kind: 'item',
          label: 'Eliminar clip o subtítulo',
          shortcut: 'Supr',
          disabled: !clipId && !cueId,
          action: deleteSelected,
        },
        { kind: 'separator', id: 'edit-selection' },
        {
          kind: 'item',
          label: 'Quitar selección',
          shortcut: 'Esc',
          disabled: selection.kind === 'none',
          action: () => store.setSelection({ kind: 'none' }),
        },
      ],
    },
    {
      id: 'view',
      label: 'Ver',
      entries: [
        ...viewItems,
        { kind: 'separator', id: 'view-chrome' },
        {
          kind: 'item',
          label: 'Etiquetas del rail',
          checked: appearance.sidebarLabels,
          action: () => update({ sidebarLabels: !appearance.sidebarLabels }),
        },
        {
          kind: 'item',
          label: 'Barra de estado',
          checked: appearance.showStatusbar,
          action: () => update({ showStatusbar: !appearance.showStatusbar }),
        },
        {
          kind: 'item',
          label: fullscreen ? 'Salir de pantalla completa' : 'Pantalla completa',
          shortcut: 'F11',
          action: () => void toggleFullscreen(),
        },
      ],
    },
    {
      id: 'playback',
      label: 'Reproducción',
      entries: [
        {
          kind: 'item',
          label: store.state.playing ? 'Pausar' : 'Reproducir',
          shortcut: 'Espacio',
          disabled: !canEdit,
          action: () => store.setPlaying(!store.state.playing),
        },
        { kind: 'separator', id: 'playback-seek' },
        {
          kind: 'item',
          label: 'Ir al inicio',
          disabled: !canEdit,
          action: () => seek(0),
        },
        {
          kind: 'item',
          label: 'Frame anterior',
          disabled: !canEdit,
          action: () => seek(store.state.playheadFrame - 1),
        },
        {
          kind: 'item',
          label: 'Frame siguiente',
          disabled: !canEdit,
          action: () => seek(store.state.playheadFrame + 1),
        },
        {
          kind: 'item',
          label: 'Ir al final',
          disabled: !canEdit,
          action: () => seek(store.durationFrames),
        },
      ],
    },
    {
      id: 'tools',
      label: 'Herramientas',
      entries: [
        { kind: 'item', label: 'Director automático', action: () => onSelect('director') },
        { kind: 'item', label: 'Fábrica de variantes', action: () => onSelect('factory') },
        { kind: 'item', label: 'Producción', action: () => onSelect('production') },
        { kind: 'item', label: 'Convertir medios', action: () => onSelect('convert') },
        { kind: 'separator', id: 'tools-mcp' },
        { kind: 'item', label: 'Servidores MCP', action: () => onSelect('mcp') },
        { kind: 'item', label: 'Apariencia y ajustes', action: () => onSelect('settings') },
      ],
    },
    {
      id: 'help',
      label: 'Ayuda',
      entries: [
        {
          kind: 'item',
          label: 'Tutorial completo',
          action: () => onSelect('learn'),
        },
        {
          kind: 'item',
          label: 'Atajos de teclado',
          action: () => setModal('shortcuts'),
        },
        {
          kind: 'item',
          label: 'Documentación en GitHub',
          action: () => {
            void store.service
              .openExternalUrl('https://github.com/Ezequiell-26/editor-ia')
              .catch((error) =>
                store.setNotice(
                  error instanceof Error ? error.message : 'no se pudo abrir la documentación',
                ),
              );
          },
        },
        {
          kind: 'item',
          label: 'Restaurar apariencia',
          action: () => {
            reset();
            store.setNotice('Apariencia restaurada a los valores de fábrica.');
          },
        },
        { kind: 'separator', id: 'help-about' },
        { kind: 'item', label: 'Acerca de Editor IA', action: () => void showAbout() },
      ],
    },
  ];

  function onDropdownKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpenMenu(null);
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const items = [
      ...(dropdownRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ??
        []),
    ];
    if (items.length === 0) return;
    event.preventDefault();
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : event.key === 'ArrowDown'
            ? (current + 1 + items.length) % items.length
            : (current - 1 + items.length) % items.length;
    items[next]?.focus();
  }

  return (
    <div className="menubar" ref={rootRef}>
      <div className="menubar-menus" role="menubar" aria-label="Menú principal">
        {menus.map((menu) => (
          <div className="menubar-slot" key={menu.id}>
            <button
              type="button"
              className={`menubar-title${openMenu === menu.id ? ' open' : ''}`}
              aria-haspopup="menu"
              aria-expanded={openMenu === menu.id}
              onClick={() => setOpenMenu((current) => (current === menu.id ? null : menu.id))}
              onPointerEnter={() => {
                if (openMenu) setOpenMenu(menu.id);
              }}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  setOpenMenu(menu.id);
                  focusFirstItem();
                }
              }}
            >
              {menu.label}
            </button>
            {openMenu === menu.id ? (
              <div
                className="menubar-dropdown"
                role="menu"
                aria-label={menu.label}
                ref={dropdownRef}
                onKeyDown={onDropdownKeyDown}
              >
                {menu.entries.map((entry, index) =>
                  entry.kind === 'separator' ? (
                    <div className="menubar-separator" key={entry.id} role="separator" />
                  ) : (
                    <button
                      key={`${menu.id}-${index}-${entry.label}`}
                      type="button"
                      role="menuitem"
                      className="menubar-item"
                      disabled={entry.disabled}
                      onClick={() => {
                        setOpenMenu(null);
                        entry.action();
                      }}
                    >
                      <span className="menubar-check" aria-hidden="true">
                        {entry.checked ? <Icon name="check" size={13} /> : null}
                      </span>
                      <span className="menubar-label">{entry.label}</span>
                      {entry.shortcut ? (
                        <span className="menubar-shortcut">{entry.shortcut}</span>
                      ) : null}
                    </button>
                  ),
                )}
              </div>
            ) : null}
          </div>
        ))}
      </div>

      {modal ? (
        <div
          className="app-modal-backdrop"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) setModal(null);
          }}
        >
          <div
            className="app-modal"
            role="dialog"
            aria-modal="true"
            aria-label={modal === 'shortcuts' ? 'Atajos de teclado' : 'Acerca de Editor IA'}
          >
            <header>
              <h2>{modal === 'shortcuts' ? 'Atajos de teclado' : 'Acerca de Editor IA'}</h2>
              <button
                type="button"
                className="icon-button"
                aria-label="Cerrar"
                data-tooltip="Cerrar"
                onClick={() => setModal(null)}
                autoFocus
              >
                <Icon name="close" size={16} />
              </button>
            </header>
            {modal === 'shortcuts' ? (
              <div className="shortcut-grid">
                {[
                  ['Ctrl+O', 'Abrir proyecto'],
                  ['Ctrl+S', 'Guardar'],
                  ['Ctrl+Shift+S', 'Guardar como'],
                  ['Ctrl+E', 'Exportar video'],
                  ['Ctrl+Z', 'Deshacer'],
                  ['Ctrl+Shift+Z', 'Rehacer'],
                  ['Ctrl+D', 'Duplicar clip'],
                  ['S', 'Dividir en el cabezal'],
                  ['Supr', 'Eliminar clip o subtítulo'],
                  ['Espacio', 'Reproducir o pausar'],
                  ['H', 'Herramienta mano para mover la timeline'],
                  ['Ctrl+rueda', 'Zoom en la timeline'],
                  ['Shift+rueda', 'Desplazar la timeline en horizontal'],
                  ['← / →', 'Un frame (Shift: diez)'],
                  ['F11', 'Pantalla completa'],
                  ['Esc', 'Cerrar menú o quitar selección'],
                ].map(([keys, description]) => (
                  <div className="shortcut-row" key={keys}>
                    <kbd>{keys}</kbd>
                    <span>{description}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="about-copy">
                <p>
                  <strong>Editor IA</strong> es un estudio de video local-first para Windows:
                  timeline por frames, Director automático, fábrica de variantes, conversión de
                  medios, subtítulos y render FFmpeg verificado.
                </p>
                <p>
                  No publica en redes por vos, no descarga stock sin procedencia y no guarda claves
                  en el proyecto. La apariencia y los servidores MCP viven sólo en este equipo.
                </p>
                <dl className="data-list">
                  <div>
                    <dt>Versión</dt>
                    <dd>0.1.0</dd>
                  </div>
                  <div>
                    <dt>Runtime</dt>
                    <dd>{detectNativeRuntime() ? 'Tauri · WebView2' : 'Navegador (sin archivos)'}</dd>
                  </div>
                  <div>
                    <dt>Datos locales</dt>
                    <dd className="path">{configDir ?? '—'}</dd>
                  </div>
                </dl>
                <button
                  type="button"
                  className="ghost icon-text"
                  onClick={() =>
                    void store.service
                      .openExternalUrl('https://github.com/Ezequiell-26/editor-ia')
                      .catch(() => store.setNotice('no se pudo abrir la documentación'))
                  }
                >
                  <Icon name="external" size={14} />
                  <span>Abrir repositorio</span>
                </button>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
