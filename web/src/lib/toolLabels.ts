import { asDict, asNumber, asString, type Dict } from './guards';
import { capitalize, plural, shortId } from './format';

export type ToolState = 'pending' | 'done' | 'error' | 'stopped';

type Labels = {
  /** Shown with a spinner while the tool runs. */
  pending: string;
  /** Shown once the result arrives; gets the result object. */
  done: (result: Dict) => string;
  /** Shown when the result is `ok: false`. */
  error?: string;
};

const count = (x: unknown) => (Array.isArray(x) ? x.length : 0);
const productTitle = (r: Dict) => asString(asDict(r.product).title);
const orderOf = (r: Dict) => asDict(r.order);

const LABELS: Record<string, Labels> = {
  search_products: {
    pending: 'Searching products…',
    done: (r) => (count(r.products) ? `Found ${plural(count(r.products), 'product')}` : 'No matching products'),
    error: 'Search failed',
  },
  get_product: {
    pending: 'Opening product…',
    done: (r) => (productTitle(r) ? `Opened ‘${productTitle(r)}’` : 'Product details'),
  },
  add_to_cart: { pending: 'Adding to cart…', done: () => 'Added to cart', error: 'Couldn’t add to cart' },
  remove_from_cart: { pending: 'Removing from cart…', done: () => 'Removed from cart' },
  view_cart: {
    pending: 'Checking your cart…',
    done: (r) => {
      const cart = asDict(r.cart);
      const n = asNumber(cart.item_count) ?? 0;
      return n ? `Cart · ${plural(n, 'item')} · ${asString(cart.subtotal)}` : 'Cart is empty';
    },
  },
  checkout: {
    pending: 'Placing order…',
    done: (r) => `Placed ${plural(count(r.orders), 'order')}${asString(r.total) ? ` · ${asString(r.total)}` : ''}`,
    error: 'Checkout failed',
  },
  list_orders: {
    pending: 'Looking up your orders…',
    done: (r) => (count(r.orders) ? `Found ${plural(count(r.orders), 'order')}` : 'No orders yet'),
  },
  get_order: {
    pending: 'Looking up order…',
    done: (r) => `Order ${shortId(asString(orderOf(r).id))}${asString(orderOf(r).status) ? ` · ${asString(orderOf(r).status)}` : ''}`,
  },
  cancel_order: {
    pending: 'Cancelling order…',
    done: (r) => `Cancelled order ${shortId(asString(orderOf(r).id))}`,
    error: 'Couldn’t cancel order',
  },
  create_listing: {
    pending: 'Publishing listing…',
    done: (r) => (productTitle(r) ? `Listed ‘${productTitle(r)}’` : 'Listing published'),
    error: 'Couldn’t publish listing',
  },
  update_listing: {
    pending: 'Updating listing…',
    done: (r) => (productTitle(r) ? `Updated ‘${productTitle(r)}’` : 'Listing updated'),
    error: 'Couldn’t update listing',
  },
  list_my_listings: { pending: 'Loading your listings…', done: (r) => plural(count(r.products), 'listing') },
  get_seller_orders: {
    pending: 'Checking orders…',
    done: (r) => (count(r.orders) ? `Found ${plural(count(r.orders), 'order')}` : 'No matching orders'),
  },
  update_order_status: {
    pending: 'Updating order…',
    done: (r) => `Order ${shortId(asString(orderOf(r).id))} marked ${asString(orderOf(r).status) || 'updated'}`,
    error: 'Couldn’t update order',
  },
  seller_stats: { pending: 'Crunching the numbers…', done: () => 'Stats ready' },
  list_categories: {
    pending: 'Browsing categories…',
    done: (r) => plural(count(r.categories), 'category', 'categories'),
  },
};

/** "search_products" → "Search products". */
export function humanizeTool(name: string): string {
  return capitalize(name.replace(/[_-]+/g, ' ').trim()) || 'Tool';
}

/** The chip text for a tool call in a given state, e.g. "Searching products…" → "Found 5 products". */
export function toolLabel(name: string, state: ToolState, result?: unknown): string {
  const labels = LABELS[name];
  const human = humanizeTool(name);
  switch (state) {
    case 'pending':
      return labels?.pending ?? `Running ${human.toLowerCase()}…`;
    case 'done':
      try {
        return labels ? labels.done(asDict(result)) : `${human} · done`;
      } catch {
        return `${human} · done`;
      }
    case 'error':
      return labels?.error ?? `${human} failed`;
    case 'stopped':
      return `${human} · interrupted`;
  }
}
