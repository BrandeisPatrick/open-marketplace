import { RefreshCw, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { relativeTime, shortId } from '../../lib/format';
import type { Order } from '../../types';
import { StatusPill } from '../cards/OrderCard';

export type PanelProps = {
  /** Changes after every completed chat turn → debounced refetch. */
  refreshKey: number;
  /** Sends a message in this window's chat (quick actions). */
  onSend?: (text: string) => void;
  busy?: boolean;
  /** Present when the panel is an overlay (narrow screens). */
  onClose?: () => void;
};

export function PanelHeader({ title, onRefresh, onClose }: { title: string; onRefresh: () => void; onClose?: () => void }) {
  return (
    <div className="sticky top-0 z-10 flex items-center gap-1 border-b border-stone-900/[0.06] bg-surface/60 px-4 py-2.5 backdrop-blur-xl dark:border-white/[0.06] dark:bg-surface/50">
      <h3 className="text-xs font-semibold tracking-wide text-stone-500 uppercase dark:text-stone-400">{title}</h3>
      <button
        type="button"
        onClick={onRefresh}
        aria-label="Refresh"
        title="Refresh"
        className="ml-auto grid size-7 place-items-center rounded-lg text-stone-400 transition hover:bg-stone-900/5 hover:text-stone-700 dark:hover:bg-white/10 dark:hover:text-stone-200"
      >
        <RefreshCw className="size-3.5" />
      </button>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label="Close panel"
          className="grid size-7 place-items-center rounded-lg text-stone-400 transition hover:bg-stone-900/5 hover:text-stone-700 dark:hover:bg-white/10 dark:hover:text-stone-200"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}

export function PanelSection({ title, meta, children }: { title: string; meta?: ReactNode; children: ReactNode }) {
  return (
    <section className="border-b border-stone-900/[0.06] px-4 py-4 last:border-b-0 dark:border-white/[0.06]">
      <div className="mb-2.5 flex items-baseline justify-between gap-2">
        <h4 className="text-sm font-semibold text-stone-800 dark:text-stone-100">{title}</h4>
        {meta !== undefined && <span className="text-xs text-stone-500 dark:text-stone-400">{meta}</span>}
      </div>
      {children}
    </section>
  );
}

export function PanelSkeleton() {
  return (
    <div className="space-y-3 p-4" aria-label="Loading">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="glass-tile h-12 animate-pulse rounded-xl" />
      ))}
    </div>
  );
}

export function PanelError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="m-4 rounded-xl bg-stone-900 p-3 text-sm text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.2)] dark:bg-stone-50 dark:text-stone-950">
      <p>{message}</p>
      <button type="button" onClick={onRetry} className="mt-2 text-xs font-medium underline underline-offset-2">
        Try again
      </button>
    </div>
  );
}

export function MiniStat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="glass-tile min-w-0 rounded-xl px-2.5 py-2">
      <div className="truncate text-[10.5px] font-medium tracking-wide text-stone-500 uppercase dark:text-stone-400">{label}</div>
      <div className="truncate text-[15px] font-semibold tabular-nums">{value}</div>
    </div>
  );
}

/** Compact order row used in both side panels. */
export function OrderRow({ order, counterparty, action }: { order: Order; counterparty: string; action?: ReactNode }) {
  const emojis = (Array.isArray(order.items) ? order.items : []).map((i) => i.emoji || '📦').slice(0, 4).join(' ');
  return (
    <li className="glass-tile rounded-xl px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs font-semibold">{shortId(order.id)}</span>
        <StatusPill status={order.status} />
        <span className="ml-auto text-[13px] font-medium tabular-nums">{order.total}</span>
      </div>
      <div className="mt-1 flex items-center gap-1.5 text-xs text-stone-500 dark:text-stone-400">
        <span className="emoji-mono" aria-hidden>{emojis}</span>
        <span className="min-w-0 truncate">{counterparty}</span>
        <span className="ml-auto shrink-0">{relativeTime(order.created_at)}</span>
      </div>
      {action && <div className="mt-2 flex justify-end">{action}</div>}
    </li>
  );
}
