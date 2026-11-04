import { useCallback, useEffect, useRef, useState } from 'react';
import { getBuyerCart, getBuyerOrders, getSellerListings, getSellerStats } from '../api';
import { errorText } from '../lib/format';
import type { Cart, MarketplaceEvent, MarketplaceEventType, Order, ProductDetail, Role, SellerStats } from '../types';
import { useEventListener } from './useEvents';

export type BuyerPanelData = { cart: Cart; orders: Order[] };
export type SellerPanelData = { stats: SellerStats; listings: ProductDetail[] };

export type PanelState<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
};

const LOADERS: { buyer: () => Promise<BuyerPanelData>; seller: () => Promise<SellerPanelData> } = {
  buyer: async () => {
    const [{ cart }, { orders }] = await Promise.all([getBuyerCart(), getBuyerOrders()]);
    return { cart, orders };
  },
  seller: async () => {
    const [{ stats }, { products }] = await Promise.all([getSellerStats(), getSellerListings()]);
    return { stats, listings: products };
  },
};

/** Events that can change what each panel shows. */
const RELEVANT: Record<Role, ReadonlySet<MarketplaceEventType>> = {
  buyer: new Set(['cart.updated', 'order.created', 'order.updated', 'product.updated']),
  seller: new Set(['order.created', 'order.updated', 'product.created', 'product.updated']),
};

const DEBOUNCE_MS = 300;

/**
 * Side-panel data for a window. Fetches on mount, then refetches (debounced) when a
 * relevant live event arrives or `refreshKey` changes (pass the completed-turn count).
 */
export function usePanelData(role: 'buyer', refreshKey?: unknown): PanelState<BuyerPanelData>;
export function usePanelData(role: 'seller', refreshKey?: unknown): PanelState<SellerPanelData>;
export function usePanelData(role: Role, refreshKey?: unknown): PanelState<BuyerPanelData | SellerPanelData> {
  const [data, setData] = useState<BuyerPanelData | SellerPanelData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const timer = useRef<number | undefined>(undefined);

  const load = useCallback(async () => {
    window.clearTimeout(timer.current);
    const id = ++seq.current;
    try {
      const next = await LOADERS[role]();
      if (id !== seq.current) return; // a newer request superseded this one
      setData(next);
      setError(null);
    } catch (err) {
      if (id === seq.current) setError(errorText(err));
    } finally {
      if (id === seq.current) setLoading(false);
    }
  }, [role]);

  const schedule = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void load(), DEBOUNCE_MS);
  }, [load]);

  useEffect(() => {
    void load();
    return () => {
      window.clearTimeout(timer.current);
      seq.current++; // drop any in-flight response
    };
  }, [load]);

  const lastKey = useRef(refreshKey);
  useEffect(() => {
    if (Object.is(lastKey.current, refreshKey)) return;
    lastKey.current = refreshKey;
    schedule();
  }, [refreshKey, schedule]);

  useEventListener(
    useCallback(
      (event: MarketplaceEvent) => {
        if (RELEVANT[role].has(event.type)) schedule();
      },
      [role, schedule],
    ),
  );

  const refresh = useCallback(() => void load(), [load]);
  return { data, loading, error, refresh };
}
