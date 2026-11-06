import { clsx } from 'clsx';
import type { ReactNode } from 'react';

/** Rounded surface used by every result card. */
export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={clsx(
        'glass glass-sheen rounded-2xl',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CardHeader({ icon, title, meta }: { icon?: ReactNode; title: ReactNode; meta?: ReactNode }) {
  return (
    <div className="flex items-center gap-2 border-b border-stone-900/[0.06] px-4 py-2.5 dark:border-white/[0.06]">
      {icon && <span className="text-stone-400 dark:text-stone-500 [&>svg]:size-4">{icon}</span>}
      <h4 className="text-sm font-semibold text-stone-800 dark:text-stone-100">{title}</h4>
      {meta && <span className="ml-auto text-xs text-stone-500 dark:text-stone-400">{meta}</span>}
    </div>
  );
}

const TILE_SIZES = {
  sm: 'size-8 rounded-lg text-base',
  md: 'size-10 rounded-xl text-xl',
} as const;

/** A product's emoji on a soft tile (the catalogue has emoji instead of photos). */
export function EmojiTile({ emoji, size = 'md' }: { emoji?: string; size?: keyof typeof TILE_SIZES }) {
  return (
    <span
      aria-hidden
      className={clsx('glass-tile emoji-mono grid shrink-0 place-items-center leading-none', TILE_SIZES[size])}
    >
      {emoji || '📦'}
    </span>
  );
}

export function EmptyNote({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-stone-300 bg-surface/40 px-4 py-3 dark:border-stone-700 text-sm text-stone-500 dark:text-stone-400">
      {children}
    </div>
  );
}

/** "Show 3 more" / "Show fewer" toggle under long lists. */
export function MoreToggle({ expanded, hidden, onToggle }: { expanded: boolean; hidden: number; onToggle: () => void }) {
  if (!expanded && hidden <= 0) return null;
  return (
    <button
      type="button"
      onClick={onToggle}
      className="self-start rounded-full px-1 text-xs font-medium text-accent-text hover:underline"
    >
      {expanded ? 'Show fewer' : `Show ${hidden} more`}
    </button>
  );
}
