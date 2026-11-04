import { clsx } from 'clsx';
import { Activity, MessageSquare, Plug, Terminal, X, type LucideIcon } from 'lucide-react';
import { memo } from 'react';
import { eventText } from '../lib/eventText';
import { clockTime, fullDate } from '../lib/format';
import type { EventOrigin, MarketplaceEvent } from '../types';

const SOURCES: Record<EventOrigin, { label: string; Icon: LucideIcon; className: string; title: string }> = {
  chat: {
    label: 'Chat',
    Icon: MessageSquare,
    className: 'bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300',
    title: 'From one of the in-app assistants',
  },
  mcp: {
    label: 'MCP',
    Icon: Plug,
    className: 'bg-mcp text-white shadow-sm shadow-violet-600/30',
    title: 'From an external agent over MCP',
  },
  api: {
    label: 'API',
    Icon: Terminal,
    className: 'bg-sky-50 text-sky-700 ring-1 ring-sky-600/20 ring-inset dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-400/25',
    title: 'From the REST API',
  },
};

export function SourceBadge({ source }: { source: EventOrigin }) {
  const s = SOURCES[source] ?? SOURCES.api;
  return (
    <span
      title={s.title}
      className={clsx(
        'inline-flex w-[3.6rem] shrink-0 items-center justify-center gap-1 rounded-full py-0.5 text-[10.5px] font-semibold tracking-wide uppercase',
        s.className,
      )}
    >
      <s.Icon className="size-3" aria-hidden />
      {s.label}
    </span>
  );
}

const EventRow = memo(function EventRow({ event }: { event: MarketplaceEvent }) {
  const mcp = event.source === 'mcp';
  const failed = event.type === 'agent.tool_call' && event.ok === false;
  const role = event.actor?.role;
  return (
    <li className={clsx('flex items-start gap-3 px-4 py-2 text-[13px] leading-5', mcp ? 'animate-mcp-flash' : 'animate-rise')}>
      <time dateTime={event.at} title={fullDate(event.at)} className="shrink-0 font-mono text-xs leading-5 text-stone-400 tabular-nums">
        {clockTime(event.at)}
      </time>
      <SourceBadge source={event.source} />
      <span className={clsx('min-w-0 flex-1 break-words', failed ? 'text-red-600 dark:text-red-400' : 'text-stone-700 dark:text-stone-200')}>
        <span
          className={clsx('mr-1.5 inline-block size-1.5 -translate-y-px rounded-full align-middle', role === 'seller' ? 'bg-seller' : 'bg-buyer')}
          title={role === 'seller' ? 'Seller' : 'Buyer'}
        />
        {eventText(event)}
        {failed && <span className="ml-1 text-xs font-medium">· failed</span>}
      </span>
    </li>
  );
});

type Props = {
  events: MarketplaceEvent[];
  connected: boolean;
  /** `strip`: fixed-height desktop strip under the windows; `page`: full mobile tab. */
  variant: 'strip' | 'page';
  onClose?: () => void;
};

/** Live marketplace events (newest first) from `/api/events`, including external MCP agents. */
export function ActivityFeed({ events, connected, variant, onClose }: Props) {
  return (
    <section
      aria-label="Live activity"
      className={clsx(
        'flex min-h-0 flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_1px_3px_rgb(28_25_23/0.05)] dark:shadow-none',
        variant === 'strip' ? 'h-48 shrink-0' : 'h-full',
      )}
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-2">
        <Activity className="size-4 text-stone-400" aria-hidden />
        <h2 className="text-sm font-semibold text-stone-800 dark:text-stone-100">Activity</h2>
        <span
          className={clsx(
            'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium',
            connected
              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300'
              : 'bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400',
          )}
        >
          <span className={clsx('size-1.5 rounded-full', connected ? 'animate-pulse bg-emerald-500' : 'bg-stone-400')} />
          {connected ? 'Live' : 'Connecting…'}
        </span>
        <p className="ml-1 hidden min-w-0 truncate text-xs text-stone-500 lg:block dark:text-stone-400">
          Both windows, the REST API and external agents over MCP — newest first
        </p>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Hide activity"
            className="ml-auto grid size-7 shrink-0 place-items-center rounded-lg text-stone-400 transition hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-200"
          >
            <X className="size-4" />
          </button>
        )}
      </header>
      {events.length === 0 ? (
        <div className="grid flex-1 place-items-center px-6 py-6 text-center text-sm text-stone-500 dark:text-stone-400">
          <p className="max-w-md">
            Nothing yet. Chat in either window, or connect an agent over{' '}
            <span className="font-medium text-mcp">MCP</span> (see the header) and watch its actions land here.
          </p>
        </div>
      ) : (
        <ol className="min-h-0 flex-1 divide-y divide-line overflow-y-auto scroll-thin">
          {events.map((event, i) => (
            <EventRow key={event.id || `${event.type}-${event.at}-${i}`} event={event} />
          ))}
        </ol>
      )}
    </section>
  );
}
