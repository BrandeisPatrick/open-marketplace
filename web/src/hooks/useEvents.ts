import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { subscribeEvents } from '../api';
import type { MarketplaceEvent } from '../types';

// One shared EventSource for the whole app (browsers cap connections per host),
// ref-counted across every component that listens.

type Listener = (event: MarketplaceEvent) => void;

const listeners = new Set<Listener>();
const statusListeners = new Set<() => void>();
const seen = new Set<string>();
let connected = false;
let users = 0;
let unsubscribe: (() => void) | null = null;

function dispatch(event: MarketplaceEvent) {
  if (event.id) {
    if (seen.has(event.id)) return;
    seen.add(event.id);
    if (seen.size > 500) seen.delete(seen.values().next().value as string);
  }
  for (const listener of [...listeners]) {
    try {
      listener(event);
    } catch (err) {
      console.error('[events] listener failed', err);
    }
  }
}

function setConnected(next: boolean) {
  if (next === connected) return;
  connected = next;
  for (const notify of statusListeners) notify();
}

function retain() {
  if (users++ === 0) unsubscribe = subscribeEvents(dispatch, setConnected);
}

function release() {
  if (--users === 0) {
    unsubscribe?.();
    unsubscribe = null;
    setConnected(false);
  }
}

function subscribeStatus(notify: () => void) {
  statusListeners.add(notify);
  return () => {
    statusListeners.delete(notify);
  };
}

/** Calls `fn` for every live marketplace event while the component is mounted. */
export function useEventListener(fn: Listener): void {
  const ref = useRef(fn);
  useEffect(() => {
    ref.current = fn;
  });
  useEffect(() => {
    const listener: Listener = (event) => ref.current(event);
    listeners.add(listener);
    retain();
    return () => {
      listeners.delete(listener);
      release();
    };
  }, []);
}

/** Whether the shared `/api/events` stream is currently open. */
export function useEventsConnected(): boolean {
  return useSyncExternalStore(subscribeStatus, () => connected, () => false);
}

/** The most recent `limit` events, newest first, plus the connection state. */
export function useEvents(limit = 50): { events: MarketplaceEvent[]; connected: boolean } {
  const [events, setEvents] = useState<MarketplaceEvent[]>([]);
  useEventListener(
    useCallback((event: MarketplaceEvent) => setEvents((prev) => [event, ...prev].slice(0, limit)), [limit]),
  );
  return { events, connected: useEventsConnected() };
}
