import { clsx } from 'clsx';
import type { Category } from '../../types';
import { EmptyNote } from './Card';

const CATEGORY_EMOJI: Record<string, string> = {
  electronics: '🔌',
  home: '🏠',
  kitchen: '🍳',
  books: '📚',
  toys: '🧸',
  outdoors: '🏕️',
  fashion: '👕',
  office: '🗂️',
};

type Props = { categories: Category[]; onPick?: (name: string) => void; busy?: boolean };

/** Category chips for `list_categories`; clicking one (buyer) asks for that category. */
export function CategoryChips({ categories, onPick, busy }: Props) {
  if (categories.length === 0) return <EmptyNote>No categories yet.</EmptyNote>;
  const chip = 'glass-pill inline-flex items-center gap-1.5 px-3 py-1.5 text-sm';
  return (
    <div className="flex flex-wrap gap-1.5">
      {categories.map((c) => {
        const body = (
          <>
            <span className="emoji-mono" aria-hidden>{CATEGORY_EMOJI[c.name.toLowerCase()] ?? '🏷️'}</span>
            <span className="capitalize">{c.name}</span>
            <span className="rounded-full bg-stone-900/[0.06] px-1.5 text-[11px] text-stone-600 tabular-nums dark:bg-white/10 dark:text-stone-300">
              {c.count}
            </span>
          </>
        );
        return onPick ? (
          <button
            key={c.name}
            type="button"
            disabled={busy}
            onClick={() => onPick(c.name)}
            className={clsx(chip, 'transition hover:border-accent/40 hover:text-stone-950 dark:hover:text-white disabled:cursor-not-allowed disabled:opacity-50')}
          >
            {body}
          </button>
        ) : (
          <span key={c.name} className={chip}>
            {body}
          </span>
        );
      })}
    </div>
  );
}
