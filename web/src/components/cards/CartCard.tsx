import { clsx } from 'clsx';
import { ShoppingCart } from 'lucide-react';
import { money, plural } from '../../lib/format';
import type { Cart, ProductSummary } from '../../types';
import { Card, CardHeader, EmojiTile } from './Card';

/** CONTRACT §2: shipping is free at a $35 subtotal, else $5.99 per order. */
export const FREE_SHIPPING_CENTS = 3500;

type Props = {
  cart: Cart;
  /** `add_to_cart` result: highlights the line that was just added. */
  added?: { product: ProductSummary; quantity: number };
  onCheckout?: () => void;
  busy?: boolean;
};

/** Cart card for `add_to_cart` / `remove_from_cart` / `view_cart`. */
export function CartCard({ cart, added, onCheckout, busy }: Props) {
  const lines = Array.isArray(cart.items) ? cart.items : [];
  const remaining = FREE_SHIPPING_CENTS - (cart.subtotal_cents ?? 0);
  return (
    <Card className="overflow-hidden">
      <CardHeader icon={<ShoppingCart />} title="Your cart" meta={plural(cart.item_count ?? 0, 'item')} />
      {lines.length === 0 ? (
        <p className="px-4 py-5 text-center text-sm text-stone-500 dark:text-stone-400">Your cart is empty.</p>
      ) : (
        <ul className="divide-y divide-line">
          {lines.map((line) => {
            const fresh = added?.product?.id === line.product.id;
            return (
              <li key={line.product.id} className={clsx('flex items-center gap-3 px-4 py-2.5', fresh && 'bg-accent-soft')}>
                <EmojiTile emoji={line.product.emoji} />
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <p className="truncate text-sm font-medium">{line.product.title}</p>
                    {fresh && (
                      <span className="shrink-0 rounded-full bg-accent px-1.5 py-px text-[10px] font-semibold tracking-wide text-accent-fg uppercase">
                        Added
                      </span>
                    )}
                  </div>
                  <p className="truncate text-xs text-stone-500 dark:text-stone-400">
                    {line.quantity} × {line.product.price} · {line.product.seller_name}
                  </p>
                </div>
                <span className="shrink-0 text-sm font-medium tabular-nums">{line.line_total}</span>
              </li>
            );
          })}
        </ul>
      )}
      {lines.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-sunken px-4 py-3">
          <div>
            <div className="text-sm">
              <span className="text-stone-500 dark:text-stone-400">Subtotal </span>
              <span className="font-semibold tabular-nums">{cart.subtotal}</span>
            </div>
            <div className="text-xs text-stone-500 dark:text-stone-400">
              {remaining > 0 ? `Add ${money(remaining)} more for free shipping` : 'Free shipping'}
            </div>
          </div>
          {onCheckout && (
            <button
              type="button"
              onClick={onCheckout}
              disabled={busy}
              className="rounded-full bg-accent px-4 py-1.5 text-sm font-medium text-accent-fg shadow-sm transition hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-40"
            >
              Checkout
            </button>
          )}
        </div>
      )}
    </Card>
  );
}
