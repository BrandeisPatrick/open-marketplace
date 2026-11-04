import { EventEmitter } from 'node:events';
import { newId, nowIso } from './marketplace/format.js';
import type { MarketplaceEvent, MarketplaceEventBody } from './marketplace/types.js';

type Listener = (event: MarketplaceEvent) => void;

/** In-process domain event bus. Every event gets an `id` and an ISO `at`; SSE subscribers fan it out. */
class EventBus {
  private readonly emitter = new EventEmitter();
  private readonly recent: MarketplaceEvent[] = [];

  constructor(private readonly keep = 100) {
    this.emitter.setMaxListeners(0);
  }

  emit(body: MarketplaceEventBody): MarketplaceEvent {
    const event = { ...body, id: newId('evt'), at: nowIso() } as MarketplaceEvent;
    this.recent.push(event);
    if (this.recent.length > this.keep) this.recent.shift();
    for (const listener of this.emitter.listeners('event') as Listener[]) {
      try {
        listener(event);
      } catch (err) {
        console.error('[events] listener failed:', err);
      }
    }
    return event;
  }

  /** Returns an unsubscribe function. */
  subscribe(listener: Listener): () => void {
    this.emitter.on('event', listener);
    return () => this.emitter.off('event', listener);
  }

  /** Most recent events, oldest first. */
  history(): MarketplaceEvent[] {
    return [...this.recent];
  }

  listenerCount(): number {
    return this.emitter.listenerCount('event');
  }
}

export const events = new EventBus();
