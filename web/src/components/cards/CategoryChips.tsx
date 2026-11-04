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
  const chip = 'inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-sm shadow-sm';
  return (
    <div className="flex flex-wrap gap-1.5">
      {categories.map((c) => {
        const body = (
          <>
            <span aria-hidden>{CATEGORY_EMOJI[c.name.toLowerCase()] ?? '🏷️'}</span>
            <span className="capitalize">{c.name}</span>
            <span className="rounded-full bg-stone-100 px-1.5 text-[11px] text-stone-500 tabular-nums dark:bg-stone-800 dark:text-stone-400">
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
            className={clsx(chip, 'transition hover:border-accent hover:text-accent-text disabled:cursor-not-allowed disabled:opacity-50')}
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
