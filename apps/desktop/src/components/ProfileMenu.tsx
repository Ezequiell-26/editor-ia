import { useEffect, useRef, useState } from 'react';
import type { ViewId } from '../app/navigation';
import {
  DEFAULT_PROFILE,
  fileToAvatar,
  initialsOf,
  loadProfile,
  saveProfile,
  type LocalProfile,
} from '../state/profile';
import { Icon } from './Icon';

export function ProfileMenu({ onSelect }: { readonly onSelect: (id: ViewId) => void }) {
  const [profile, setProfile] = useState<LocalProfile>(loadProfile);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ name: profile.name, role: profile.role });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent): void {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
        setEditing(false);
      }
    }
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        setOpen(false);
        setEditing(false);
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  function commit(next: LocalProfile): void {
    const normalized = { ...next, version: 1 as const };
    saveProfile(normalized);
    setProfile(normalized);
  }

  function beginEdit(): void {
    setDraft({ name: profile.name, role: profile.role });
    setEditing(true);
    setError(null);
  }

  async function choosePhoto(file: File | undefined): Promise<void> {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const avatar = await fileToAvatar(file);
      commit({ ...profile, avatar });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'No se pudo procesar la foto.');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  function go(view: ViewId): void {
    setOpen(false);
    setEditing(false);
    onSelect(view);
  }

  return (
    <div className="profile-menu" ref={rootRef}>
      <button
        type="button"
        className="profile-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Perfil de ${profile.name}`}
        data-tooltip={`${profile.name} · ${profile.role}`}
        onClick={() => {
          setOpen((current) => !current);
          setEditing(false);
          setError(null);
        }}
      >
        <span className="profile-avatar" aria-hidden="true">
          {profile.avatar ? (
            <img src={profile.avatar} alt="" />
          ) : (
            <span>{initialsOf(profile.name)}</span>
          )}
        </span>
        <span className="profile-trigger-copy" aria-hidden="true">
          <strong>{profile.name}</strong>
          <span>{profile.role}</span>
        </span>
        <Icon name="chevron" size={12} className="profile-chevron" />
      </button>

      {open ? (
        <div className="profile-popover" role="menu" aria-label="Menú de perfil">
          <header className="profile-popover-head">
            <span className="profile-avatar large" aria-hidden="true">
              {profile.avatar ? (
                <img src={profile.avatar} alt="" />
              ) : (
                <span>{initialsOf(profile.name)}</span>
              )}
            </span>
            <div>
              <strong>{profile.name}</strong>
              <span>{profile.role}</span>
            </div>
          </header>

          {editing ? (
            <div className="profile-edit">
              <label className="field">
                <span>Nombre</span>
                <input
                  value={draft.name}
                  maxLength={80}
                  autoFocus
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                />
              </label>
              <label className="field">
                <span>Rol o especialidad</span>
                <input
                  value={draft.role}
                  maxLength={80}
                  onChange={(event) => setDraft({ ...draft, role: event.target.value })}
                />
              </label>
              <div className="actions compact">
                <button
                  type="button"
                  className="small"
                  disabled={busy}
                  onClick={() => fileRef.current?.click()}
                >
                  {busy ? 'Procesando…' : 'Cambiar foto'}
                </button>
                {profile.avatar ? (
                  <button
                    type="button"
                    className="small"
                    onClick={() => commit({ ...profile, avatar: null })}
                  >
                    Quitar foto
                  </button>
                ) : null}
                <button
                  type="button"
                  className="small primary"
                  onClick={() => {
                    commit({
                      ...profile,
                      name: draft.name.trim() || DEFAULT_PROFILE.name,
                      role: draft.role.trim() || DEFAULT_PROFILE.role,
                    });
                    setEditing(false);
                  }}
                >
                  Guardar
                </button>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                hidden
                onChange={(event) => void choosePhoto(event.target.files?.[0])}
              />
              {error ? <p className="profile-error">{error}</p> : null}
            </div>
          ) : (
            <div className="profile-actions">
              <button type="button" role="menuitem" onClick={beginEdit}>
                <Icon name="user" size={15} />
                <span>Editar foto y nombre</span>
              </button>
              <button type="button" role="menuitem" onClick={() => go('learn')}>
                <Icon name="learn" size={15} />
                <span>Tutorial completo</span>
              </button>
              <button type="button" role="menuitem" onClick={() => go('settings')}>
                <Icon name="palette" size={15} />
                <span>Apariencia y ajustes</span>
              </button>
              <button type="button" role="menuitem" onClick={() => go('projects')}>
                <Icon name="projects" size={15} />
                <span>Proyectos</span>
              </button>
            </div>
          )}
          <p className="profile-local-note">Perfil local · no se sube a ningún servidor</p>
        </div>
      ) : null}
    </div>
  );
}
