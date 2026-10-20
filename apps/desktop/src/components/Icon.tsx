import type { ReactNode, SVGProps } from 'react';

export type IconName =
  | 'projects'
  | 'production'
  | 'editor'
  | 'script'
  | 'assets'
  | 'settings'
  | 'undo'
  | 'redo'
  | 'save'
  | 'export'
  | 'play'
  | 'pause'
  | 'skipBack'
  | 'skipForward'
  | 'frameBack'
  | 'frameForward'
  | 'plus'
  | 'minus'
  | 'split'
  | 'trash'
  | 'captions'
  | 'chevron'
  | 'sparkles'
  | 'close'
  | 'volume'
  | 'eye'
  | 'lock'
  | 'grid'
  | 'search'
  | 'film'
  | 'audio'
  | 'check'
  | 'fit'
  | 'layers'
  | 'plug'
  | 'learn'
  | 'user'
  | 'refresh'
  | 'external'
  | 'keyboard'
  | 'info'
  | 'palette'
  | 'fullscreen'
  | 'maximize'
  | 'restore'
  | 'stop';

const paths: Record<IconName, ReactNode> = {
  projects: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  production: (
    <>
      <path d="M4 7.5 20 4v13.5L4 21z" />
      <path d="M4 7.5 20 4" />
      <path d="m8 6.5-1.5 5" />
      <path d="m13 5.6-1.5 5" />
      <path d="m18 4.7-1.5 5" />
    </>
  ),
  editor: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 4v16M17 4v16" />
      <path d="M3 9h4M3 15h4M17 9h4M17 15h4" />
    </>
  ),
  script: (
    <>
      <path d="M5 3h9l5 5v13H5z" />
      <path d="M14 3v5h5" />
      <path d="M8 12h8M8 16h8M8 8h3" />
    </>
  ),
  assets: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9" r="1.5" />
      <path d="m4 18 5.5-5.5L14 17l3-3 3 3" />
    </>
  ),
  settings: (
    <>
      <path d="M4 7h16M4 12h16M4 17h16" />
      <circle cx="9" cy="7" r="2" />
      <circle cx="15" cy="12" r="2" />
      <circle cx="8" cy="17" r="2" />
    </>
  ),
  undo: (
    <>
      <path d="M9 7 4 12l5 5" />
      <path d="M4 12h10a6 6 0 0 1 6 6" />
    </>
  ),
  redo: (
    <>
      <path d="m15 7 5 5-5 5" />
      <path d="M20 12H10a6 6 0 0 0-6 6" />
    </>
  ),
  save: (
    <>
      <path d="M5 3h11l3 3v15H5z" />
      <path d="M8 3v6h8V3M8 21v-7h8v7" />
    </>
  ),
  export: (
    <>
      <path d="M12 16V4" />
      <path d="m7 9 5-5 5 5" />
      <path d="M4 16v4h16v-4" />
    </>
  ),
  play: <path d="M8 5.5v13l10-6.5z" fill="currentColor" stroke="none" />,
  pause: (
    <>
      <rect x="7" y="5" width="3.5" height="14" rx="1" fill="currentColor" stroke="none" />
      <rect x="13.5" y="5" width="3.5" height="14" rx="1" fill="currentColor" stroke="none" />
    </>
  ),
  skipBack: (
    <>
      <path d="M6 5v14" />
      <path d="M18 5 8 12l10 7z" fill="currentColor" stroke="none" />
    </>
  ),
  skipForward: (
    <>
      <path d="M18 5v14" />
      <path d="M6 5l10 7L6 19z" fill="currentColor" stroke="none" />
    </>
  ),
  frameBack: <path d="m15 5-8 7 8 7z" fill="currentColor" stroke="none" />,
  frameForward: <path d="m9 5 8 7-8 7z" fill="currentColor" stroke="none" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  split: (
    <>
      <circle cx="6" cy="7" r="2.5" />
      <circle cx="6" cy="17" r="2.5" />
      <path d="m8 8.5 11 8.5M8 15.5 19 7" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14" />
      <path d="M10 11v6M14 11v6" />
    </>
  ),
  captions: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M7 11h4M7 15h7M14 11h3M17 15h2" />
    </>
  ),
  chevron: <path d="m7 9 5 5 5-5" />,
  sparkles: (
    <>
      <path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6z" />
      <path d="M18.5 15l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" />
    </>
  ),
  close: <path d="m6 6 12 12M18 6 6 18" />,
  volume: (
    <>
      <path d="M4 10v4h3l4 4V6l-4 4z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
      <path d="M18 6a8.5 8.5 0 0 1 0 12" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12S6 6.2 12 6.2 21.5 12 21.5 12 18 17.8 12 17.8 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="2.6" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10" width="14" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      <path d="M12 14v2" />
    </>
  ),
  grid: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 3v18M15 3v18M3 9h18M3 15h18" />
    </>
  ),
  search: (
    <>
      <circle cx="10.8" cy="10.8" r="6.3" />
      <path d="m15.5 15.5 4.8 4.8" />
    </>
  ),
  film: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4" />
    </>
  ),
  audio: <path d="M4 10v4M8 6v12M12 8v8M16 5v14M20 10v4" />,
  check: <path d="m4.5 12 5 5L20 6" />,
  fit: <path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" />,
  layers: (
    <>
      <path d="m12 3 9 5-9 5-9-5z" />
      <path d="m3 12 9 5 9-5M3 16l9 5 9-5" />
    </>
  ),
  plug: (
    <>
      <path d="M9 3v5M15 3v5" />
      <path d="M7 8h10v3a5 5 0 0 1-10 0z" />
      <path d="M12 16v5" />
    </>
  ),
  learn: (
    <>
      <path d="m3 8 9-4 9 4-9 4z" />
      <path d="M7 10.5V16c2.8 1.6 7.2 1.6 10 0v-5.5" />
      <path d="M21 8v6" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M4.5 21a7.5 7.5 0 0 1 15 0" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 12a8 8 0 1 1-2.34-5.66" />
      <path d="M20 4v5h-5" />
    </>
  ),
  external: (
    <>
      <path d="M14 4h6v6" />
      <path d="M20 4 11 13" />
      <path d="M18 14v5H5V6h5" />
    </>
  ),
  keyboard: (
    <>
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <path d="M6 10h.01M9 10h.01M12 10h.01M15 10h.01M18 10h.01M7 14h10" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </>
  ),
  palette: (
    <>
      <path d="M12 3a9 9 0 1 0 0 18h1.5a2.5 2.5 0 0 0 0-5H12a2 2 0 0 1 0-4h5.5A3.5 3.5 0 0 0 21 8.5C21 5.5 17 3 12 3z" />
      <circle cx="7.5" cy="9" r="1" />
      <circle cx="10" cy="6.5" r="1" />
      <circle cx="14.5" cy="6.5" r="1" />
      <circle cx="6.5" cy="13" r="1" />
    </>
  ),
  fullscreen: (
    <>
      <path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5" />
    </>
  ),
  maximize: <rect x="5" y="5" width="14" height="14" rx="1.5" />,
  restore: (
    <>
      <rect x="4" y="8" width="12" height="12" rx="1.5" />
      <path d="M8 8V4h12v12h-4" />
    </>
  ),
  stop: <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none" />,
};

export function Icon({
  name,
  size = 18,
  ...rest
}: { readonly name: IconName; readonly size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {paths[name]}
    </svg>
  );
}
