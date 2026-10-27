const PATHS = {
  trapped: "M3 21h18M5 21V9l7-5 7 5v12M9 21v-6h6v6M8 11h8",
  injured: "M12 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM6 21v-6a6 6 0 0 1 12 0v6M4 12h16",
  bleeding: "M12 3c4 5 6 8 6 11a6 6 0 0 1-12 0c0-3 2-6 6-11z",
  fire: "M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-4-1-6 1-9z",
  other: "M12 4v10M12 18v2M4 12a8 8 0 1 0 16 0 8 8 0 0 0-16 0",
  baby: "M12 4a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM8 21v-4a4 4 0 0 1 8 0v4",
  child: "M12 5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM8 21v-6a4 4 0 0 1 8 0v6M5 13h14",
  adult: "M12 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM7 21V13a5 5 0 0 1 10 0v8M10 21v-5M14 21v-5",
  elder: "M12 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM8 21V13a4 4 0 0 1 8 0v8M18 12l2 9",
  mic: "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3",
  speaker: "M4 9v6h4l5 4V5L8 9H4zM17 8a5 5 0 0 1 0 8",
  send: "M3 11l18-8-8 18-2-8-8-2z",
  pin: "M12 21s-7-6-7-11a7 7 0 0 1 14 0c0 5-7 11-7 11zM12 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
  check: "M4 12l5 5L20 6",
  lock: "M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 40 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={PATHS[name]} />
    </svg>
  );
}
