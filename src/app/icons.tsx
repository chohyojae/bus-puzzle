import type { CSSProperties } from 'react';
export type IconName =
  | 'bus'
  | 'settings'
  | 'sound'
  | 'muted'
  | 'back'
  | 'pause'
  | 'play'
  | 'restart'
  | 'undo'
  | 'check'
  | 'lock'
  | 'download'
  | 'upload'
  | 'leaf'
  | 'close'
  | 'flag'
  | 'save'
  | 'home';
const paths: Record<IconName, React.ReactNode> = {
  bus: (
    <>
      <rect x="3" y="5" width="18" height="13" rx="4" />
      <path d="M7 8v6m5-6v6m5-6v6M7 18v2m10-2v2" />
    </>
  ),
  settings: (
    <>
      <path d="m9 3-1 3-3 1 1 3-2 2 2 2-1 3 3 1 1 3h6l1-3 3-1-1-3 2-2-2-2 1-3-3-1-1-3Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  sound: (
    <>
      <path d="m11 4-6 5H2v6h3l6 5ZM16 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" />
    </>
  ),
  muted: (
    <>
      <path d="m11 4-6 5H2v6h3l6 5ZM16 9l6 6m0-6-6 6" />
    </>
  ),
  back: <path d="m14 5-7 7 7 7" />,
  pause: (
    <>
      <path d="M8 5v14M16 5v14" />
    </>
  ),
  play: <path d="m8 4 12 8-12 8Z" />,
  restart: (
    <>
      <path d="M4 10a8 8 0 1 1 1 8M4 4v6h6" />
    </>
  ),
  undo: (
    <>
      <path d="m8 4-5 5 5 5M3 9h10a7 7 0 0 1 7 7v4" />
    </>
  ),
  check: <path d="m5 12 4 4L19 6" />,
  lock: (
    <>
      <rect x="5" y="10" width="14" height="11" rx="3" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      <path d="M12 14v3" />
    </>
  ),
  download: (
    <>
      <path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" />
    </>
  ),
  upload: (
    <>
      <path d="M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5" />
    </>
  ),
  leaf: (
    <>
      <path d="M20 3C4 2 1 10 6 16c5 5 14 1 14-13ZM5 21l9-12" />
    </>
  ),
  close: <path d="m6 6 12 12M6 18 18 6" />,
  flag: (
    <>
      <path d="M5 21V3m0 1c5-4 9 4 14 0v10c-5 4-9-4-14 0" />
    </>
  ),
  save: (
    <>
      <path d="M4 3h13l4 4v14H3V3Zm3 0v7h10V3M7 21v-7h10v7" />
    </>
  ),
  home: (
    <>
      <path d="m3 10 9-7 9 7v11h-7v-7h-4v7H3Z" />
    </>
  ),
};
export function Icon({ name, size = 22, style }: { name: IconName; size?: number; style?: CSSProperties }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={style}
    >
      {paths[name]}
    </svg>
  );
}
