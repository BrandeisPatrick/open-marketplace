import { PencilLine, Plus, Sparkles } from 'lucide-react';
import { relativeTime } from '../../lib/format';
import type { ProductDetail as ProductDetailData, ProductSummary } from '../../types';
import { Card } from './Card';
import { ListingStatus, Rating, StockBadge } from './ProductGrid';

type Props = {
  product: ProductDetailData;
  /** `create_listing` → "New listing", `update_listing` → "Updated". */
  badge?: 'new' | 'updated';
  onAdd?: (product: ProductSummary) => void;
  busy?: boolean;
};

/** Full product card for `get_product` / `create_listing` / `update_listing`. */
export function ProductDetail({ product: p, badge, onAdd, busy }: Props) {
  const tags = Array.isArray(p.tags) ? p.tags : [];
  const unavailable = p.stock <= 0 || p.status !== 'active';
  return (
    <Card className="@container overflow-hidden">
      <div className="flex flex-col @md:flex-row">
        <div className="relative grid shrink-0 place-items-center bg-linear-to-br from-white/80 to-stone-200/50 py-7 @md:w-40 @md:py-0 dark:from-white/10 dark:to-white/[0.02]">
          <span className="emoji-mono text-6xl leading-none" aria-hidden>
            {p.emoji || '📦'}
          </span>
          {badge && (
            <span className="ink-glass absolute top-3 left-3 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold">
              {badge === 'new' ? <Sparkles className="size-3" aria-hidden /> : <PencilLine className="size-3" aria-hidden />}
              {badge === 'new' ? 'New listing' : 'Updated'}
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-2.5 p-4">
          <div>
            <h4 className="text-[15px] leading-snug font-semibold text-stone-900 dark:text-stone-50">{p.title}</h4>
            <p className="mt-0.5 text-xs text-stone-500 dark:text-stone-400">
              by {p.seller_name} · <span className="capitalize">{p.category}</span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className="text-lg font-semibold tabular-nums">{p.price}</span>
            <Rating rating={p.rating} count={p.review_count} />
            <StockBadge stock={p.stock} exact={Boolean(badge)} />
            <ListingStatus status={p.status} />
          </div>
          {p.description && (
            <p className="line-clamp-5 text-sm leading-relaxed text-stone-600 dark:text-stone-300">{p.description}</p>
          )}
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="glass-tile rounded-full px-2 py-0.5 text-[11px] text-stone-600 dark:text-stone-300"
                >
                  #{tag}
                </span>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
            <span className="text-[11px] text-stone-400">
              {badge === 'updated' ? `Updated ${relativeTime(p.updated_at)}` : `Listed ${relativeTime(p.created_at)}`}
              <span className="font-mono"> · {p.id}</span>
            </span>
            {onAdd && (
              <button
                type="button"
                onClick={() => onAdd(p)}
                disabled={busy || unavailable}
                className="btn-ink inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Plus className="size-4" aria-hidden />
                Add to cart
              </button>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}
