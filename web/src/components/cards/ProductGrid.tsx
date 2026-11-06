import { clsx } from 'clsx';
import { Plus, Star } from 'lucide-react';
import { useState } from 'react';
import { compact } from '../../lib/format';
import type { ProductSummary } from '../../types';
import { EmptyNote, MoreToggle } from './Card';

export function Rating({ rating, count, className }: { rating: number; count: number; className?: string }) {
  const value = Number(rating) || 0;
  const reviews = Number(count) || 0;
  if (!value && !reviews) return <span className={clsx('text-xs text-stone-400', className)}>No reviews yet</span>;
  return (
    <span
      className={clsx('inline-flex items-center gap-1 text-xs text-stone-500 dark:text-stone-400', className)}
      aria-label={`Rated ${value.toFixed(1)} out of 5 from ${reviews} reviews`}
    >
      <Star className="size-3.5 fill-stone-800 text-stone-800 dark:fill-stone-200 dark:text-stone-200" aria-hidden />
      <span className="font-medium text-stone-700 dark:text-stone-200">{value.toFixed(1)}</span>
      <span>({compact(reviews)})</span>
    </span>
  );
}

/** in stock = outlined glass, low = ink fill (needs attention), out = dashed and dimmed. */
const STOCK_TONES = {
  ok: 'bg-white/75 text-stone-700 ring-1 ring-stone-300 ring-inset shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] backdrop-blur-sm dark:bg-white/5 dark:text-stone-200 dark:ring-stone-600 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]',
  low: 'bg-stone-900 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.22)] dark:bg-stone-50 dark:text-stone-950',
  out: 'bg-white/40 text-stone-500 outline-1 -outline-offset-1 outline-dashed outline-stone-400 dark:bg-transparent dark:text-stone-400 dark:outline-stone-500',
} as const;

/** "In stock" / "Only 3 left" / "Out of stock" (`exact` shows "12 in stock" for sellers). */
export function StockBadge({ stock, exact, className }: { stock: number; exact?: boolean; className?: string }) {
  const n = Number(stock) || 0;
  const tone = n <= 0 ? 'out' : n <= 5 ? 'low' : 'ok';
  const label = n <= 0 ? 'Out of stock' : n <= 5 ? `Only ${n} left` : exact ? `${n} in stock` : 'In stock';
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap',
        STOCK_TONES[tone],
        className,
      )}
    >
      {label}
    </span>
  );
}

/** Draft / archived marker; active listings show nothing. */
export function ListingStatus({ status }: { status: ProductSummary['status'] }) {
  if (status === 'active') return null;
  return (
    <span className="inline-flex items-center rounded-full bg-stone-600 px-2 py-0.5 text-[11px] font-medium text-white capitalize shadow-[inset_0_1px_0_rgba(255,255,255,0.2)] dark:bg-stone-300 dark:text-stone-900">
      {status}
    </span>
  );
}

type TileProps = {
  product: ProductSummary;
  onAdd?: (product: ProductSummary) => void;
  busy?: boolean;
  exactStock?: boolean;
};

function ProductTile({ product: p, onAdd, busy, exactStock }: TileProps) {
  const unavailable = p.stock <= 0 || p.status !== 'active';
  return (
    <article className="glass glass-sheen group flex min-w-0 flex-col rounded-2xl transition hover:-translate-y-px">
      <div className="relative grid aspect-[4/3] place-items-center bg-linear-to-br from-white/80 to-stone-200/50 dark:from-white/10 dark:to-white/[0.02]">
        <span className="emoji-mono text-[2.6rem] leading-none transition-transform duration-300 group-hover:scale-110" aria-hidden>
          {p.emoji || '📦'}
        </span>
        <div className="absolute inset-x-2 top-2 flex flex-wrap items-start justify-between gap-1">
          <StockBadge stock={p.stock} exact={exactStock} />
          <ListingStatus status={p.status} />
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3">
        <h4 className="line-clamp-2 text-[13.5px] leading-snug font-medium text-stone-900 dark:text-stone-100" title={p.title}>
          {p.title}
        </h4>
        <Rating rating={p.rating} count={p.review_count} />
        <div className="mt-auto flex items-end justify-between gap-2 pt-1.5">
          <div className="min-w-0">
            <div className="text-[15px] font-semibold tabular-nums">{p.price}</div>
            <div className="truncate text-xs text-stone-500 dark:text-stone-400">{p.seller_name}</div>
          </div>
          {onAdd && (
            <button
              type="button"
              onClick={() => onAdd(p)}
              disabled={busy || unavailable}
              aria-label={`Add ${p.title} to cart`}
              className="btn-ink inline-flex shrink-0 items-center gap-0.5 rounded-full py-1 pr-2.5 pl-2 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Plus className="size-3.5" aria-hidden />
              Add
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

type Props = {
  products: ProductSummary[];
  total?: number;
  query?: string;
  /** Buyer windows get an "Add" button that asks the assistant to add the item. */
  onAdd?: (product: ProductSummary) => void;
  busy?: boolean;
  /** Seller listings: show exact stock and draft/archived state. */
  exactStock?: boolean;
  limit?: number;
};

/** Grid of product tiles for `search_products` / `list_my_listings`. */
export function ProductGrid({ products, total, query, onAdd, busy, exactStock, limit = 6 }: Props) {
  const [expanded, setExpanded] = useState(false);
  if (products.length === 0) {
    return <EmptyNote>No products matched{query ? ` “${query}”` : ''}. Try different words or a wider price range.</EmptyNote>;
  }
  const shown = expanded ? products : products.slice(0, limit);
  return (
    <div className="@container flex flex-col gap-2">
      <div className="grid grid-cols-1 gap-2.5 @2xs:grid-cols-2 @xl:grid-cols-3">
        {shown.map((p) => (
          <ProductTile key={p.id} product={p} onAdd={onAdd} busy={busy} exactStock={exactStock} />
        ))}
      </div>
      <div className="flex items-center justify-between gap-3">
        <MoreToggle expanded={expanded} hidden={products.length - shown.length} onToggle={() => setExpanded((v) => !v)} />
        {typeof total === 'number' && total > products.length && (
          <span className="ml-auto text-xs text-stone-500">
            Showing {products.length} of {total}
          </span>
        )}
      </div>
    </div>
  );
}
