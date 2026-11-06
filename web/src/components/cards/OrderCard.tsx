import { clsx } from 'clsx';
import { Ban, Clock, MapPin, PackageCheck, Store, Truck, UserRound } from 'lucide-react';
import { useState, type ComponentType } from 'react';
import { fullDate, money, relativeTime, shortId } from '../../lib/format';
import type { Order, OrderStatus, Role } from '../../types';
import { Card, EmojiTile, EmptyNote, MoreToggle } from './Card';

const STATUS_STYLE: Record<OrderStatus, string> = {
  placed:
    'bg-white/70 text-stone-700 ring-1 ring-stone-300 ring-inset shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] dark:bg-white/5 dark:text-stone-200 dark:ring-stone-600 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]',
  shipped:
    'bg-stone-200 text-stone-800 ring-1 ring-stone-300/80 ring-inset shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] dark:bg-stone-600 dark:text-stone-50 dark:ring-stone-500 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]',
  delivered:
    'bg-stone-900 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.22)] dark:bg-stone-50 dark:text-stone-950 dark:shadow-[inset_0_-1px_0_rgba(0,0,0,0.15)]',
  cancelled: 'bg-transparent text-stone-400 outline-1 -outline-offset-1 outline-dashed outline-stone-300 dark:text-stone-500 dark:outline-stone-600',
};

const STATUS_ICON: Record<OrderStatus, ComponentType<{ className?: string }>> = {
  placed: Clock,
  shipped: Truck,
  delivered: PackageCheck,
  cancelled: Ban,
};

export const ORDER_STATUSES: OrderStatus[] = ['placed', 'shipped', 'delivered', 'cancelled'];

/** placed = outlined, shipped = mid-gray fill, delivered = ink fill, cancelled = dashed and dimmed. */
export function StatusPill({ status, count }: { status: OrderStatus; count?: number }) {
  const Icon = STATUS_ICON[status] ?? Clock;
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap capitalize',
        STATUS_STYLE[status] ?? STATUS_STYLE.cancelled,
      )}
    >
      <Icon className="size-3" aria-hidden />
      {count === undefined ? status : `${count} ${status}`}
    </span>
  );
}

type CardProps = {
  order: Order;
  /** Whose window this is: buyers see the seller, sellers see the buyer. */
  perspective: Role;
  onShip?: (order: Order) => void;
  busy?: boolean;
};

export function OrderCard({ order, perspective, onShip, busy }: CardProps) {
  const items = Array.isArray(order.items) ? order.items : [];
  const CounterpartyIcon = perspective === 'seller' ? UserRound : Store;
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 border-b border-stone-900/[0.06] px-4 py-2.5 dark:border-white/[0.06]">
        <span className="font-mono text-[13px] font-semibold text-stone-800 dark:text-stone-100">{shortId(order.id)}</span>
        <StatusPill status={order.status} />
        <span className="ml-auto text-xs text-stone-500 dark:text-stone-400" title={fullDate(order.created_at)}>
          {relativeTime(order.created_at)}
        </span>
      </div>
      <ul className="space-y-2 px-4 py-3">
        {items.map((item, i) => (
          <li key={`${item.product_id}-${i}`} className="flex items-center gap-3">
            <EmojiTile emoji={item.emoji} size="sm" />
            <span className="min-w-0 flex-1 truncate text-sm">{item.title}</span>
            <span className="shrink-0 text-xs text-stone-500 tabular-nums dark:text-stone-400">
              {item.quantity} × {item.unit_price}
            </span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-t border-stone-900/[0.06] bg-sunken/50 px-4 py-2.5 text-xs dark:border-white/[0.06] dark:bg-black/10">
        <div className="min-w-0 space-y-1 text-stone-500 dark:text-stone-400">
          <div className="flex items-center gap-1.5">
            <CounterpartyIcon className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">{perspective === 'seller' ? `Buyer: ${order.buyer_name}` : `Sold by ${order.seller_name}`}</span>
          </div>
          {order.shipping_address && (
            <div className="flex items-start gap-1.5">
              <MapPin className="mt-px size-3.5 shrink-0" aria-hidden />
              <span className="break-words">{order.shipping_address}</span>
            </div>
          )}
        </div>
        <div className="ml-auto text-right">
          <div className="text-sm font-semibold text-stone-900 tabular-nums dark:text-stone-50">{order.total}</div>
          <div className="text-stone-500 dark:text-stone-400">
            {order.shipping_cents > 0 ? `incl. ${money(order.shipping_cents)} shipping` : 'Free shipping'}
          </div>
        </div>
      </div>
      {onShip && order.status === 'placed' && (
        <div className="flex justify-end border-t border-stone-900/[0.06] px-4 py-2 dark:border-white/[0.06]">
          <button
            type="button"
            onClick={() => onShip(order)}
            disabled={busy}
            className="btn-ink inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Truck className="size-3.5" aria-hidden />
            Mark shipped
          </button>
        </div>
      )}
    </Card>
  );
}

type ListProps = Omit<CardProps, 'order'> & { orders: Order[]; limit?: number; emptyText?: string };

/** Order cards for `checkout`, `list_orders`, `get_order`, `cancel_order`, `get_seller_orders`, `update_order_status`. */
export function OrderList({ orders, limit = 3, emptyText = 'No orders yet.', ...card }: ListProps) {
  const [expanded, setExpanded] = useState(false);
  if (orders.length === 0) return <EmptyNote>{emptyText}</EmptyNote>;
  const shown = expanded ? orders : orders.slice(0, limit);
  return (
    <div className="flex flex-col gap-2.5">
      {shown.map((order) => (
        <OrderCard key={order.id} order={order} {...card} />
      ))}
      <MoreToggle expanded={expanded} hidden={orders.length - shown.length} onToggle={() => setExpanded((v) => !v)} />
    </div>
  );
}
