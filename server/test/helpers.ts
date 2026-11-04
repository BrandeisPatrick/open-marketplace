import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { resetDb } from '../src/db.js';
import { events } from '../src/events.js';
import { createApp } from '../src/index.js';
import { stableId } from '../src/marketplace/format.js';
import { seedProductId } from '../src/marketplace/seed.js';
import { demoActor } from '../src/marketplace/store.js';
import type { Actor, MarketplaceEvent } from '../src/marketplace/types.js';

export function freshDb(): void {
  resetDb(':memory:');
}

export const buyer = (): Actor => demoActor('buyer');
export const seller = (): Actor => demoActor('seller');
export const pixelPine = (): Actor => ({ id: 'usr_pixelpine', name: 'Pixel & Pine', role: 'seller' });

export const P = {
  tklKeyboard: seedProductId('tkl-keyboard'),
  lowProfileKeyboard: seedProductId('lowprofile-keyboard'),
  stonewareMug: seedProductId('stoneware-mug'),
  headlamp: seedProductId('led-headlamp'),
  chefKnife: seedProductId('chef-knife'),
  candle: seedProductId('soy-candle'),
};

export const O = {
  nwDelivered: stableId('ord', 'seed-order-1'),
  ppDelivered: stableId('ord', 'seed-order-2'),
  nwShipped: stableId('ord', 'seed-order-3'),
  nwPlaced: stableId('ord', 'seed-order-4'),
};

export function captureEvents(): { list: MarketplaceEvent[]; stop: () => void } {
  const list: MarketplaceEvent[] = [];
  const stop = events.subscribe((e) => list.push(e));
  return { list, stop };
}

export async function startApp(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer(createApp());
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** Parses `data: <json>` SSE frames (the chat protocol). */
export function parseDataFrames(body: string): unknown[] {
  return body
    .split('\n\n')
    .map((frame) => frame.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('\n'))
    .filter(Boolean)
    .map((json) => JSON.parse(json));
}
