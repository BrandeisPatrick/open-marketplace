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
    className: 'bg-stone-200/80 text-stone-700 dark:bg-stone-700/80 dark:text-stone-200',
    title: 'From one of the in-app assistants',
  },
  mcp: {
    label: 'MCP',
    Icon: Plug,
    className:
      'bg-linear-to-b from-white to-stone-300 text-stone-900 ring-1 ring-stone-400/70 ring-inset shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_1px_3px_rgba(0,0,0,0.18)] dark:from-stone-200 dark:to-stone-400 dark:text-stone-950 dark:ring-white/40',
    title: 'From an external agent over MCP',
  },
  api: {
    label: 'API',
    Icon: Terminal,
    className: 'bg-transparent text-stone-600 ring-1 ring-stone-400/60 ring-inset dark:text-stone-300 dark:ring-stone-500/60',
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
    <li className={clsx('flex items-start gap-3 px-4 py-2 text-[13px] leading-5 transition-colors hover:bg-white/40 dark:hover:bg-white/[0.03]', mcp ? 'animate-mcp-flash' : 'animate-rise')}>
      <time dateTime={event.at} title={fullDate(event.at)} className="shrink-0 font-mono text-xs leading-5 text-stone-400 tabular-nums">
        {clockTime(event.at)}
      </time>
      <SourceBadge source={event.source} />
      <span className={clsx('min-w-0 flex-1 break-words', failed ? 'font-medium text-stone-950 dark:text-white' : 'text-stone-700 dark:text-stone-200')}>
        <span
          className={clsx('mr-1.5 inline-block size-1.5 -translate-y-px rounded-full align-middle', role === 'seller' ? 'bg-transparent ring-[1.5px] ring-seller ring-inset' : 'bg-buyer')}
          title={role === 'seller' ? 'Seller' : 'Buyer'}
        />
        {eventText(event)}
        {failed && <span className="ml-1 rounded-full bg-stone-900 px-1.5 text-[10.5px] font-semibold text-white dark:bg-stone-50 dark:text-stone-950">failed</span>}
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
        'glass glass-sheen flex min-h-0 flex-col rounded-3xl',
        variant === 'strip' ? 'h-48 shrink-0' : 'h-full',
      )}
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-stone-900/[0.06] px-4 py-2 dark:border-white/[0.06]">
        <Activity className="size-4 text-stone-400" aria-hidden />
        <h2 className="text-sm font-semibold text-stone-800 dark:text-stone-100">Activity</h2>
        <span
          className={clsx(
            'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium',
            connected
              ? 'glass-pill text-stone-800 dark:text-stone-100'
              : 'border border-dashed border-stone-300 text-stone-500 dark:border-stone-600 dark:text-stone-400',
          )}
        >
          <span className={clsx('size-1.5 rounded-full', connected ? 'animate-pulse bg-stone-900 dark:bg-white' : 'bg-stone-400')} />
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
            className="ml-auto grid size-7 shrink-0 place-items-center rounded-lg text-stone-400 transition hover:bg-stone-900/5 hover:text-stone-700 dark:hover:bg-white/10 dark:hover:text-stone-200"
          >
            <X className="size-4" />
          </button>
        )}
      </header>
      {events.length === 0 ? (
        <div className="grid flex-1 place-items-center px-6 py-6 text-center text-sm text-stone-500 dark:text-stone-400">
          <p className="max-w-md">
            Nothing yet. Chat in either window, or connect an agent over{' '}
            <span className="font-semibold text-stone-700 dark:text-stone-200">MCP</span> (see the header) and watch its actions land here.
          </p>
        </div>
      ) : (
        <ol className="min-h-0 flex-1 divide-y divide-stone-900/[0.06] overflow-y-auto scroll-thin dark:divide-white/[0.06]">
          {events.map((event, i) => (
            <EventRow key={event.id || `${event.type}-${event.at}-${i}`} event={event} />
          ))}
        </ol>
      )}
    </section>
  );
}
