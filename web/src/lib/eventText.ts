import type { MarketplaceEvent } from '../types';
import { plural, shortId } from './format';

/** One human line for the activity feed, e.g. "Ada placed order #ab12cd34 ($57.98) with Northwind Goods". */
export function eventText(e: MarketplaceEvent): string {
  try {
    switch (e.type) {
      case 'order.created':
        return `${e.order.buyer_name} placed order ${shortId(e.order.id)} (${e.order.total}) with ${e.order.seller_name}`;
      case 'order.updated':
        return `Order ${shortId(e.order.id)} is now ${e.order.status}`;
      case 'product.created':
        return `${e.product.seller_name} listed ‘${e.product.title}’ at ${e.product.price}`;
      case 'product.updated':
        return `${e.actor.name} updated ‘${e.product.title}’`;
      case 'cart.updated':
        return `${e.actor.name}'s cart: ${plural(e.cart.item_count, 'item')} (${e.cart.subtotal})`;
      case 'agent.tool_call':
        return e.summary || `${e.actor.name} ran ${e.tool}`;
      default:
        return 'Marketplace activity';
    }
  } catch {
    // A shape we did not expect; still show that something happened.
    return `${(e as { type?: string }).type ?? 'event'}`;
  }
}
