import { clsx } from 'clsx';
import { Activity, ShoppingBag, Store, TriangleAlert, X, type LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useEvents } from '../hooks/useEvents';
import { useHealth } from '../hooks/useHealth';
import { useMediaQuery } from '../hooks/useMediaQuery';
import type { Actor, MarketplaceEvent } from '../types';
import { ActivityFeed } from './ActivityFeed';
import { ChatWindow } from './ChatWindow';
import { Header } from './Header';

/** Used until /api/health answers (CONTRACT §1 demo actors). */
const DEFAULT_ACTORS: { buyer: Actor; seller: Actor } = {
  buyer: { id: 'usr_ada', name: 'Ada', role: 'buyer' },
  seller: { id: 'usr_northwind', name: 'Northwind Goods', role: 'seller' },
};

type Tab = 'buyer' | 'seller' | 'activity';

const ACTIVITY_PREF = 'aim.activityOpen';

function readPref(key: string, fallback: boolean): boolean {
  try {
    const v = window.localStorage.getItem(key);
    return v === null ? fallback : v === '1';
  } catch {
    return fallback;
  }
}

function writePref(key: string, value: boolean) {
  try {
    window.localStorage.setItem(key, value ? '1' : '0');
  } catch {
    /* storage unavailable (private mode etc.) */
  }
}

/** Events that arrived while the feed was not on screen. */
function useUnread(events: MarketplaceEvent[], visible: boolean): number {
  const top = events[0]?.id ?? null;
  const [seen, setSeen] = useState<string | null>(null);
  useEffect(() => {
    if (visible) setSeen(top);
  }, [visible, top]);
  if (visible || !top) return 0;
  if (seen === null) return events.length;
  const index = events.findIndex((e) => e.id === seen);
  return index === -1 ? events.length : index;
}

function OfflineBanner({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="glass-strong mx-4 mb-3 flex shrink-0 items-start gap-2.5 rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed text-stone-800 md:mx-5 dark:text-stone-100">
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-stone-900 dark:text-stone-50" aria-hidden />
      <p className="min-w-0 flex-1">
        <span className="font-semibold">Offline mode.</span> Both assistants are running on simple keyword rules. Add{' '}
        <code className="rounded bg-stone-200/80 px-1 font-mono text-[12px] dark:bg-white/10">ANTHROPIC_API_KEY</code> to{' '}
        <code className="rounded bg-stone-200/80 px-1 font-mono text-[12px] dark:bg-white/10">.env</code> and restart the
        server to chat with Claude.
      </p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="grid size-6 shrink-0 place-items-center rounded-md text-stone-500 transition hover:bg-stone-900/5 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-white/10 dark:hover:text-stone-50"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}

const TABS: { id: Tab; label: string; Icon: LucideIcon }[] = [
  { id: 'buyer', label: 'Buyer', Icon: ShoppingBag },
  { id: 'seller', label: 'Seller', Icon: Store },
  { id: 'activity', label: 'Activity', Icon: Activity },
];

function MobileTabs({ tab, onChange, unread }: { tab: Tab; onChange: (tab: Tab) => void; unread: number }) {
  return (
    <nav className="shrink-0 px-4 pb-3" aria-label="Views">
      <div role="tablist" className="glass grid grid-cols-3 gap-1 rounded-2xl p-1">
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => onChange(id)}
            className={clsx(
              'flex items-center justify-center gap-1.5 rounded-xl py-1.5 text-sm font-medium transition',
              tab === id
                ? 'ink-glass rounded-xl'
                : 'text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-100',
            )}
          >
            <Icon className="size-4" aria-hidden />
            {label}
            {id === 'activity' && unread > 0 && (
              <span className="grid h-[18px] min-w-[18px] place-items-center rounded-full bg-stone-900 px-1 text-[10px] font-bold text-white tabular-nums ring-1 ring-white/50 dark:bg-white dark:text-stone-950 dark:ring-black/40">
                {unread > 99 ? '99+' : unread}
              </span>
            )}
          </button>
        ))}
      </div>
    </nav>
  );
}

export default function App() {
  const { health, error: healthError } = useHealth();
  const { events, connected } = useEvents(50);
  const isMd = useMediaQuery('(min-width: 768px)');
  const [tab, setTab] = useState<Tab>('buyer');
  const [activityOpen, setActivityOpen] = useState(() => readPref(ACTIVITY_PREF, true));
  const [offlineDismissed, setOfflineDismissed] = useState(false);

  const toggleActivity = useCallback(() => {
    setActivityOpen((open) => {
      writePref(ACTIVITY_PREF, !open);
      return !open;
    });
  }, []);

  const feedVisible = isMd ? activityOpen : tab === 'activity';
  const unread = useUnread(events, feedVisible);
  const actors = health?.actors ?? DEFAULT_ACTORS;
  const offline = health?.ai.enabled === false;

  return (
    <div className="flex h-dvh flex-col">
      <Header
        health={health}
        healthError={healthError}
        activityOpen={activityOpen}
        onToggleActivity={toggleActivity}
        unread={unread}
      />
      {offline && !offlineDismissed && <OfflineBanner onDismiss={() => setOfflineDismissed(true)} />}
      {!isMd && <MobileTabs tab={tab} onChange={setTab} unread={unread} />}

      <main className="flex min-h-0 flex-1 flex-col gap-4 px-4 pb-4 md:px-5 md:pb-5">
        <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-1 gap-4 md:grid-cols-2">
          {/* Both windows stay mounted on mobile so a reply keeps streaming while you look elsewhere. */}
          <ChatWindow role="buyer" actor={actors.buyer} accent="ink" hidden={!isMd && tab !== 'buyer'} />
          <ChatWindow role="seller" actor={actors.seller} accent="graphite" hidden={!isMd && tab !== 'seller'} />
          {!isMd && tab === 'activity' && <ActivityFeed events={events} connected={connected} variant="page" />}
        </div>
        {isMd && activityOpen && (
          <ActivityFeed events={events} connected={connected} variant="strip" onClose={toggleActivity} />
        )}
      </main>
    </div>
  );
}
