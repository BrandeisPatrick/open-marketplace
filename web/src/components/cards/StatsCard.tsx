import { ChartColumn, Truck } from 'lucide-react';
import type { ReactNode } from 'react';
import { plural, relativeTime, shortId } from '../../lib/format';
import type { Order, SellerStats } from '../../types';
import { Card, CardHeader, EmojiTile } from './Card';
import { ORDER_STATUSES, StatusPill } from './OrderCard';

export function StatTile({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="glass-tile min-w-0 rounded-xl px-3 py-2.5">
      <div className="truncate text-[11px] font-medium tracking-wide text-stone-500 uppercase dark:text-stone-400">{label}</div>
      <div className="mt-0.5 truncate text-lg leading-tight font-semibold tabular-nums text-stone-900 dark:text-stone-50">{value}</div>
      {hint && <div className="truncate text-[11px] text-stone-500 dark:text-stone-400">{hint}</div>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h5 className="mb-2 text-[11px] font-semibold tracking-wide text-stone-500 uppercase dark:text-stone-400">{title}</h5>
      {children}
    </section>
  );
}

type Props = { stats: SellerStats; onShip?: (order: Order) => void; busy?: boolean };

/** Seller dashboard card for `seller_stats`. */
export function StatsCard({ stats, onShip, busy }: Props) {
  const top = Array.isArray(stats.top_products) ? stats.top_products : [];
  const low = Array.isArray(stats.low_stock) ? stats.low_stock : [];
  const ship = Array.isArray(stats.needs_shipping) ? stats.needs_shipping : [];
  const byStatus = stats.orders_by_status ?? {};
  const maxRevenue = Math.max(1, ...top.map((t) => t.revenue_cents || 0));

  return (
    <Card className="@container overflow-hidden">
      <CardHeader icon={<ChartColumn />} title="Store performance" meta="all time" />
      <div className="space-y-4 p-4">
        <div className="grid grid-cols-2 gap-2 @lg:grid-cols-4">
          <StatTile label="Revenue" value={stats.revenue} />
          <StatTile label="Orders" value={(stats.orders_total ?? 0).toLocaleString('en-US')} />
          <StatTile label="Units sold" value={(stats.units_sold ?? 0).toLocaleString('en-US')} />
          <StatTile label="Active listings" value={(stats.active_listings ?? 0).toLocaleString('en-US')} />
        </div>

        <div className="flex flex-wrap gap-1.5">
          {ORDER_STATUSES.map((s) => (
            <StatusPill key={s} status={s} count={byStatus[s] ?? 0} />
          ))}
        </div>

        {top.length > 0 && (
          <Section title="Top products">
            <ol className="space-y-2">
              {top.map((t) => (
                <li key={t.product_id} className="flex items-center gap-3">
                  <EmojiTile emoji={t.emoji} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-sm">{t.title}</span>
                      <span className="shrink-0 text-sm font-medium tabular-nums">{t.revenue}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-stone-900/[0.07] dark:bg-white/10">
                        <div
                          className="h-full rounded-full bg-linear-to-r from-accent/60 to-accent"
                          style={{ width: `${Math.max(4, Math.round(((t.revenue_cents || 0) / maxRevenue) * 100))}%` }}
                        />
                      </div>
                      <span className="shrink-0 text-[11px] text-stone-500 tabular-nums dark:text-stone-400">
                        {plural(t.units ?? 0, 'unit')}
                      </span>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </Section>
        )}

        {low.length > 0 && (
          <Section title="Low stock">
            <ul className="space-y-1.5">
              {low.map((p) => (
                <li key={p.id} className="flex items-center gap-3">
                  <EmojiTile emoji={p.emoji} size="sm" />
                  <span className="min-w-0 flex-1 truncate text-sm">{p.title}</span>
                  <span
                    className={
                      p.stock <= 0
                        ? 'shrink-0 rounded-full bg-stone-900 px-1.5 text-[11px] font-semibold text-white dark:bg-stone-50 dark:text-stone-950'
                        : 'shrink-0 text-xs font-medium text-stone-700 dark:text-stone-200'
                    }
                  >
                    {p.stock <= 0 ? 'Sold out' : `${p.stock} left`}
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        <Section title={ship.length ? `Needs shipping (${ship.length})` : 'Needs shipping'}>
          {ship.length === 0 ? (
            <p className="text-sm text-stone-500 dark:text-stone-400">All caught up — nothing waiting to ship.</p>
          ) : (
            <ul className="space-y-1.5">
              {ship.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-mono text-xs font-semibold">{shortId(o.id)}</span>
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {o.buyer_name} · {o.total}
                  </span>
                  <span className="text-xs text-stone-500 dark:text-stone-400">{relativeTime(o.created_at)}</span>
                  {onShip && (
                    <button
                      type="button"
                      onClick={() => onShip(o)}
                      disabled={busy}
                      className="glass-pill inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium text-accent-text transition hover:border-accent/50 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Truck className="size-3" aria-hidden />
                      Ship
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </Card>
  );
}
