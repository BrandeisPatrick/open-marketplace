import { clsx } from 'clsx';
import { Truck } from 'lucide-react';
import { useState } from 'react';
import { usePanelData } from '../../hooks/usePanelData';
import { EmojiTile, MoreToggle } from '../cards/Card';
import { MiniStat, OrderRow, PanelError, PanelHeader, PanelSection, PanelSkeleton, type PanelProps } from './PanelParts';

const LISTING_STATUS_DOT = {
  active: 'bg-stone-900 dark:bg-stone-50',
  draft: 'bg-stone-400',
  archived: 'bg-transparent ring-1 ring-stone-400 ring-inset',
} as const;

/** Seller side panel: stats tiles, orders needing shipping, listings. */
export function SellerPanel({ refreshKey, onSend, busy, onClose }: PanelProps) {
  const { data, loading, error, refresh } = usePanelData('seller', refreshKey);
  const [showAll, setShowAll] = useState(false);

  if (!data) {
    return (
      <div className="flex min-h-full flex-col">
        <PanelHeader title="Store" onRefresh={refresh} onClose={onClose} />
        {loading ? <PanelSkeleton /> : <PanelError message={error ?? 'Couldn’t load your store.'} onRetry={refresh} />}
      </div>
    );
  }

  const { stats, listings } = data;
  const toShip = Array.isArray(stats.needs_shipping) ? stats.needs_shipping : [];
  const shown = showAll ? listings : listings.slice(0, 8);

  return (
    <div className="flex min-h-full flex-col">
      <PanelHeader title="Store" onRefresh={refresh} onClose={onClose} />
      <PanelSection title="Stats">
        <div className="grid grid-cols-2 gap-2">
          <MiniStat label="Revenue" value={stats.revenue} />
          <MiniStat label="Orders" value={(stats.orders_total ?? 0).toLocaleString('en-US')} />
          <MiniStat label="Units sold" value={(stats.units_sold ?? 0).toLocaleString('en-US')} />
          <MiniStat label="Active listings" value={(stats.active_listings ?? 0).toLocaleString('en-US')} />
        </div>
      </PanelSection>
      <PanelSection title="Needs shipping" meta={toShip.length || undefined}>
        {toShip.length === 0 ? (
          <p className="text-sm text-stone-500 dark:text-stone-400">All caught up.</p>
        ) : (
          <ul className="space-y-2">
            {toShip.map((order) => (
              <OrderRow
                key={order.id}
                order={order}
                counterparty={order.buyer_name}
                action={
                  onSend && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onSend(`Mark order ${order.id} as shipped`)}
                      className="btn-ink inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Truck className="size-3" aria-hidden />
                      Mark shipped
                    </button>
                  )
                }
              />
            ))}
          </ul>
        )}
      </PanelSection>
      <PanelSection title="Listings" meta={listings.length}>
        {listings.length === 0 ? (
          <p className="text-sm text-stone-500 dark:text-stone-400">No listings yet — ask the assistant to create one.</p>
        ) : (
          <div className="flex flex-col gap-2">
            <ul className="divide-y divide-stone-900/[0.06] dark:divide-white/[0.06]">
              {shown.map((p) => (
                <li key={p.id} className="flex items-center gap-2.5 py-2 first:pt-0">
                  <EmojiTile emoji={p.emoji} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium" title={p.title}>
                      {p.title}
                    </p>
                    <p className="text-xs text-stone-500 tabular-nums dark:text-stone-400">
                      {p.price} ·{' '}
                      <span
                        className={clsx(
                          p.stock <= 0 && 'font-semibold text-stone-950 underline decoration-dashed underline-offset-2 dark:text-white',
                          p.stock > 0 && p.stock <= 5 && 'font-semibold text-stone-800 dark:text-stone-100',
                        )}
                      >
                        {p.stock <= 0 ? 'out of stock' : `${p.stock} in stock`}
                      </span>
                    </p>
                  </div>
                  <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-stone-500 capitalize dark:text-stone-400">
                    <span className={clsx('size-1.5 rounded-full', LISTING_STATUS_DOT[p.status] ?? 'bg-stone-400')} />
                    {p.status}
                  </span>
                </li>
              ))}
            </ul>
            <MoreToggle expanded={showAll} hidden={listings.length - shown.length} onToggle={() => setShowAll((v) => !v)} />
          </div>
        )}
      </PanelSection>
    </div>
  );
}
