import { usePanelData } from '../../hooks/usePanelData';
import { plural } from '../../lib/format';
import { EmojiTile } from '../cards/Card';
import { OrderRow, PanelError, PanelHeader, PanelSection, PanelSkeleton, type PanelProps } from './PanelParts';

/** Buyer side panel: live cart + recent orders. */
export function BuyerPanel({ refreshKey, onSend, busy, onClose }: PanelProps) {
  const { data, loading, error, refresh } = usePanelData('buyer', refreshKey);
  const lines = data?.cart.items ?? [];

  return (
    <div className="flex min-h-full flex-col">
      <PanelHeader title="Cart & orders" onRefresh={refresh} onClose={onClose} />
      {!data ? (
        loading ? (
          <PanelSkeleton />
        ) : (
          <PanelError message={error ?? 'Couldn’t load your cart.'} onRetry={refresh} />
        )
      ) : (
        <>
          <PanelSection title="Cart" meta={plural(data.cart.item_count ?? 0, 'item')}>
            {lines.length === 0 ? (
              <p className="text-sm text-stone-500 dark:text-stone-400">Empty — ask the assistant to find something.</p>
            ) : (
              <>
                <ul className="space-y-2.5">
                  {lines.map((line) => (
                    <li key={line.product.id} className="flex items-center gap-2.5">
                      <EmojiTile emoji={line.product.emoji} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium">{line.product.title}</p>
                        <p className="text-xs text-stone-500 dark:text-stone-400">
                          Qty {line.quantity} · {line.product.price}
                        </p>
                      </div>
                      <span className="shrink-0 text-[13px] font-medium tabular-nums">{line.line_total}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-3 flex items-center justify-between border-t border-stone-900/[0.06] pt-3 text-sm dark:border-white/[0.06]">
                  <span className="text-stone-500 dark:text-stone-400">Subtotal</span>
                  <span className="font-semibold tabular-nums">{data.cart.subtotal}</span>
                </div>
                {onSend && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onSend('Check out my cart')}
                    className="btn-ink mt-3 w-full rounded-xl py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Checkout
                  </button>
                )}
              </>
            )}
          </PanelSection>
          <PanelSection title="Recent orders" meta={data.orders.length || undefined}>
            {data.orders.length === 0 ? (
              <p className="text-sm text-stone-500 dark:text-stone-400">No orders yet.</p>
            ) : (
              <ul className="space-y-2">
                {data.orders.slice(0, 6).map((order) => (
                  <OrderRow key={order.id} order={order} counterparty={order.seller_name} />
                ))}
              </ul>
            )}
          </PanelSection>
        </>
      )}
    </div>
  );
}
