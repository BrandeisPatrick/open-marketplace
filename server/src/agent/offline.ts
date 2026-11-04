// Rule-based stand-in for the assistants when no ANTHROPIC_API_KEY is configured. It emits the same ChatEvents and
// persists the same MessageParam shapes (text, tool_use, tool_result) as the Claude loop, so the UI and transcript
// replay behave identically, just with keyword commands instead of language understanding.
import type Anthropic from '@anthropic-ai/sdk';
import { newId, plural, truncate } from '../marketplace/format.js';
import { getOrCreateConversation, saveConversation } from '../marketplace/store.js';
import { executeTool } from '../marketplace/tools.js';
import {
  CATEGORIES,
  ToolError,
  type Actor,
  type Cart,
  type Category,
  type ChatEvent,
  type Order,
  type ProductDetail,
  type ProductSummary,
  type SellerStats,
  type SortKey,
} from '../marketplace/types.js';
import { latestToolResult } from './transcript.js';

export const OFFLINE_NOTICE =
  '**The AI assistant is off** because no `ANTHROPIC_API_KEY` is set. Add your key to `.env` and restart the server ' +
  'to enable it. Until then I am a simple offline helper that understands short commands (say "help" to see them).';

const BUYER_HELP =
  'Try: "find a mechanical keyboard", "gifts under $50", "tell me about the first one", "add the first one", ' +
  '"add 2 prod_…", "show my cart", "remove prod_…", "checkout", "my orders" or "cancel ord_…".';

const SELLER_HELP =
  'Try: "my listings", "orders to ship", "how are sales?", "what is low on stock?", "mark ord_… shipped", ' +
  '"set stock of prod_… to 20", "set price of prod_… to $24.99" or "archive prod_…". Drafting new listings ' +
  'from a description needs the AI assistant.';

export interface OfflineTurnOptions {
  actor: Actor;
  message: string;
  emit: (event: ChatEvent) => void;
}

type CallResult<T> = { ok: true; output: T } | { ok: false; error: string };

/** Records one turn as Anthropic MessageParams while streaming the equivalent ChatEvents. */
class TurnRecorder {
  readonly messages: Anthropic.MessageParam[] = [];
  private pending: Anthropic.ContentBlockParam[] = [];
  private lastEmitted: 'text' | 'tool' | null = null;

  constructor(
    private readonly actor: Actor,
    private readonly emit: (event: ChatEvent) => void,
  ) {}

  say(text: string): void {
    const last = this.pending.at(-1);
    if (last?.type === 'text') {
      last.text += `\n\n${text}`;
      this.emit({ type: 'text_delta', text: `\n\n${text}` });
    } else {
      this.pending.push({ type: 'text', text });
      this.emit({ type: 'text_delta', text: this.lastEmitted === 'text' ? `\n\n${text}` : text });
    }
    this.lastEmitted = 'text';
  }

  call<T = unknown>(name: string, input: Record<string, unknown>): CallResult<T> {
    const id = `toolu_offline_${newId('x').slice(2)}`;
    this.pending.push({ type: 'tool_use', id, name, input });
    this.messages.push({ role: 'assistant', content: this.pending });
    this.pending = [];
    this.emit({ type: 'tool_call', id, name, input });
    let result: CallResult<T>;
    try {
      result = { ok: true, output: executeTool(this.actor, name, input, 'chat') as T };
    } catch (err) {
      result = { ok: false, error: err instanceof ToolError ? err.message : 'Internal error while running the tool.' };
    }
    this.messages.push({
      role: 'user',
      content: [
        result.ok
          ? { type: 'tool_result', tool_use_id: id, content: JSON.stringify(result.output) }
          : { type: 'tool_result', tool_use_id: id, content: result.error, is_error: true },
      ],
    });
    this.emit({ type: 'tool_result', id, name, ok: result.ok, result: result.ok ? result.output : result.error });
    this.lastEmitted = 'tool';
    return result;
  }

  finish(): Anthropic.MessageParam[] {
    if (this.pending.length > 0) this.messages.push({ role: 'assistant', content: this.pending });
    this.pending = [];
    return this.messages;
  }
}

interface TurnContext {
  rec: TurnRecorder;
  history: Anthropic.MessageParam[];
}

export async function runOfflineTurn({ actor, message, emit }: OfflineTurnOptions): Promise<void> {
  const conversation = getOrCreateConversation(actor);
  const history = conversation.messages;
  const rec = new TurnRecorder(actor, emit);
  if (!history.some((m) => m.role === 'assistant')) rec.say(OFFLINE_NOTICE);

  const text = message.trim();
  if (actor.role === 'buyer') buyerTurn(text, { rec, history });
  else sellerTurn(text, { rec, history });

  // Offline turns add no thinking blocks, so the stored prompt fingerprint stays as it was.
  saveConversation(conversation.id, [...history, { role: 'user', content: message }, ...rec.finish()], conversation.fingerprint);
  emit({ type: 'done' });
}

// ─── parsing helpers ───────────────────────────────────────────────────────

const ids = (text: string, prefix: 'prod' | 'ord') =>
  [...text.matchAll(new RegExp(`\\b${prefix}_[a-z0-9]+\\b`, 'gi'))].map((m) => m[0].toLowerCase());

const ORDINAL_WORDS: Record<string, number> = {
  first: 1, '1st': 1, top: 1, second: 2, '2nd': 2, third: 3, '3rd': 3, fourth: 4, '4th': 4, fifth: 5, '5th': 5,
  sixth: 6, '6th': 6, seventh: 7, '7th': 7, eighth: 8, '8th': 8, last: -1,
};
const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

function ordinalIn(t: string): number | undefined {
  const word = t.match(/\b(first|1st|top|second|2nd|third|3rd|fourth|4th|fifth|5th|sixth|6th|seventh|7th|eighth|8th|last)\b/);
  if (word) return ORDINAL_WORDS[word[1]!];
  const num = t.match(/(?:#|\bnumber\s+|\bno\.?\s*|\boption\s+|\bitem\s+|\bresult\s+)(\d{1,2})\b/);
  return num ? Number(num[1]) : undefined;
}

function quantityIn(t: string): number {
  const m =
    t.match(/\b(?:add|buy|get)\s+(\d{1,2})\b(?!\s*(?:st|nd|rd|th)\b)/) ??
    t.match(/(?:\bx|×)\s*(\d{1,2})\b/) ??
    t.match(/\b(?:qty|quantity)\s*:?\s*(\d{1,2})\b/) ??
    t.match(/\b(\d{1,2})\s*(?:x|×|units?|pcs|pieces|of)\b/);
  if (m) return Math.max(1, Math.min(99, Number(m[1])));
  const w = t.match(/\b(?:add|buy|get)\s+(two|three|four|five|six|seven|eight|nine|ten)\b/);
  return w ? NUMBER_WORDS[w[1]!]! : 1;
}

function pick<T>(list: T[], ordinal: number): T | undefined {
  return ordinal === -1 ? list.at(-1) : list[ordinal - 1];
}

function lastSearchResults(history: Anthropic.MessageParam[]): ProductSummary[] {
  const found = latestToolResult(history, ['search_products']);
  const products = (found?.result as { products?: ProductSummary[] } | undefined)?.products;
  return Array.isArray(products) ? products : [];
}

function lastViewedProduct(history: Anthropic.MessageParam[]): ProductSummary | undefined {
  const found = latestToolResult(history, ['get_product', 'search_products', 'add_to_cart']);
  if (!found) return undefined;
  const r = found.result as { product?: ProductSummary; products?: ProductSummary[]; added?: { product: ProductSummary } };
  return r.product ?? r.added?.product ?? r.products?.[0];
}

const CATEGORY_ALIASES: Record<string, string> = {
  electronic: 'electronics', electronics: 'electronics', gadget: 'electronics', gadgets: 'electronics', tech: 'electronics',
  home: 'home', decor: 'home', kitchen: 'kitchen', cooking: 'kitchen', book: 'books', books: 'books', reading: 'books',
  toy: 'toys', toys: 'toys', game: 'toys', games: 'toys', outdoor: 'outdoors', outdoors: 'outdoors', camping: 'outdoors',
  fashion: 'fashion', clothes: 'fashion', clothing: 'fashion', apparel: 'fashion', office: 'office', stationery: 'office',
};

interface SearchInput {
  query?: string;
  category?: string;
  min_price?: number;
  max_price?: number;
  sort?: SortKey;
  in_stock_only?: boolean;
  limit?: number;
}

/** "cheap gifts under $50 in stock" -> { query: "gifts", max_price: 50, sort: "price_asc", in_stock_only: true } */
export function parseSearch(text: string): SearchInput {
  let t = ` ${text.toLowerCase().replace(/[“”"]/g, ' ')} `;
  const take = (re: RegExp): RegExpMatchArray | null => {
    const m = t.match(re);
    if (m) t = t.replace(m[0], ' ');
    return m;
  };
  const input: SearchInput = {};
  const range =
    take(/\bbetween\s*\$?\s*(\d+(?:\.\d+)?)\s*(?:and|-|to)\s*\$?\s*(\d+(?:\.\d+)?)/) ??
    take(/\$\s*(\d+(?:\.\d+)?)\s*(?:-|to)\s*\$?\s*(\d+(?:\.\d+)?)/);
  if (range) {
    input.min_price = Number(range[1]);
    input.max_price = Number(range[2]);
  }
  const under = take(/\b(?:under|below|less than|cheaper than|max(?:imum)?|up to|no more than|at most|within)\s*\$?\s*(\d+(?:\.\d+)?)\s*(?:dollars|bucks|usd)?/);
  if (under) input.max_price = Number(under[1]);
  const over = take(/\b(?:over|above|more than|at least|min(?:imum)?|starting at)\s*\$?\s*(\d+(?:\.\d+)?)\s*(?:dollars|bucks|usd)?/);
  if (over) input.min_price = Number(over[1]);
  if (take(/\b(?:cheap(?:est)?|budget|affordable|inexpensive|lowest[- ]price[ds]?)\b/)) input.sort = 'price_asc';
  if (take(/\b(?:most expensive|priciest|premium|high[- ]end|luxury)\b/)) input.sort = 'price_desc';
  if (take(/\b(?:best|top|highest)[- ]?(?:rated|reviewed)\b|\bpopular\b|\bbest\b/)) input.sort = input.sort ?? 'rating';
  if (take(/\bin[- ]stock\b|\bavailable (?:now|today)\b/)) input.in_stock_only = true;

  const query = t
    .replace(/\b(?:can|could|would) you\b|\bplease\b|\bi'?m\b|\bi am\b|\bwe'?re\b|\bi'?d like\b|\bi (?:need|want)\b/g, ' ')
    .replace(/\b(?:looking|look|searching|shopping) for\b|\bsearch(?: for)?\b|\bfind(?: me)?\b|\bshow(?: me)?\b|\bget me\b|\bbrowse\b/g, ' ')
    .replace(/\b(?:need|want|recommend(?:ations?)?|suggest(?:ions?)?|ideas?|options?)\b/g, ' ')
    .replace(/\b(?:what|which|where|is|are|there|do|does|you|have|got|sell|carry|in stock)\b|what's/g, ' ')
    .replace(/\b(?:some|any|a few|a|an|the|me|for me|stuff|things|gear|products?|items?|something|anything)\b/g, ' ')
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const alias = CATEGORY_ALIASES[query];
  if (alias) input.category = alias;
  else if (query) input.query = query;
  return input;
}

function describeSearch(input: SearchInput): string {
  const parts = [
    input.query ? `"${input.query}"` : input.category ? input.category : 'products',
    input.query && input.category ? `in ${input.category}` : '',
    input.min_price !== undefined ? `from $${input.min_price}` : '',
    input.max_price !== undefined ? `under $${input.max_price}` : '',
    input.in_stock_only ? 'in stock' : '',
  ];
  return parts.filter(Boolean).join(' ');
}

function stockNote(p: ProductSummary): string {
  if (p.stock === 0) return ', currently out of stock';
  if (p.stock <= 5) return `, only ${p.stock} left`;
  return '';
}

// ─── buyer ─────────────────────────────────────────────────────────────────

function buyerTurn(text: string, { rec, history }: TurnContext): void {
  const t = text.toLowerCase();
  const productIds = ids(text, 'prod');
  const orderIds = ids(text, 'ord');
  const isQuestion = /\?\s*$/.test(t) || /^(how|what|why|when|where|can|could|does|do|is|are|should)\b/.test(t);

  if (/^(hi|hello|hey|help|menu|commands|what can you do)\b/.test(t) && t.length < 40) {
    rec.say(`I can help you shop with simple commands. ${BUYER_HELP}`);
    return;
  }

  if (/\bcheck\s*-?\s*out\b|\bplace (?:my |the |an )?order\b/.test(t)) {
    if (isQuestion) {
      rec.say('Checkout places one order per seller (free shipping at $35+ per seller, otherwise $5.99) and empties your cart. Say "checkout" when you are ready.');
      return;
    }
    const address = text.match(/\b(?:ship|send|deliver) (?:it |them )?to[:\s]+(.{5,200})$/i)?.[1]?.trim();
    rec.say('Placing your order…');
    const r = rec.call<{ orders: Order[]; total: string }>('checkout', address ? { shipping_address: address } : {});
    if (!r.ok) return rec.say(`I couldn't check out: ${r.error}`);
    const sellers = r.output.orders.map((o) => o.seller_name).join(' and ');
    rec.say(`Done! ${plural(r.output.orders.length, 'order')} placed (${sellers}) for ${r.output.total} in total. You can track them with "my orders".`);
    return;
  }

  if (/\bcancel\b/.test(t)) {
    const orderId = orderIds[0];
    if (!orderId) {
      const r = rec.call<{ orders: Order[] }>('list_orders', { status: 'placed' });
      if (r.ok && r.output.orders.length > 0) {
        rec.say(`Which order should I cancel? Orders that haven't shipped yet: ${r.output.orders.map((o) => `${o.id} (${o.total})`).join(', ')}. Say "cancel ord_…".`);
      } else {
        rec.say("You don't have any orders that can still be cancelled (only orders that haven't shipped can be).");
      }
      return;
    }
    const r = rec.call<{ order: Order }>('cancel_order', { order_id: orderId });
    rec.say(r.ok ? `Cancelled order ${r.output.order.id} (${r.output.order.total}). The items are back in stock.` : `I couldn't cancel it: ${r.error}`);
    return;
  }

  if (/\b(remove|delete|take out|drop)\b/.test(t)) {
    let productId = productIds[0];
    if (!productId) {
      const cart = rec.call<{ cart: Cart }>('view_cart', {});
      if (!cart.ok) return rec.say(`I couldn't read your cart: ${cart.error}`);
      const words = t.replace(/\b(remove|delete|take out|drop|from|my|the|cart|basket|please)\b/g, ' ').trim().split(/\s+/).filter((w) => w.length > 2);
      const items = cart.output.cart.items;
      const matches = items.filter((i) => words.some((w) => i.product.title.toLowerCase().includes(w)));
      if (matches.length !== 1) {
        const inCart = items.map((i) => `${truncate(i.product.title, 40)} (${i.product.id})`).join(', ');
        rec.say(
          items.length === 0
            ? 'Your cart is already empty.'
            : matches.length === 0
              ? `I don't see that in your cart. It has: ${inCart}. Say "remove prod_…" with one of those ids.`
              : `Which one? Matching items: ${matches.map((i) => `${truncate(i.product.title, 40)} (${i.product.id})`).join(', ')}.`,
        );
        return;
      }
      productId = matches[0]!.product.id;
    }
    const r = rec.call<{ cart: Cart }>('remove_from_cart', { product_id: productId });
    rec.say(r.ok ? `Removed. Your cart now has ${plural(r.output.cart.item_count, 'item')} (${r.output.cart.subtotal}).` : `I couldn't remove it: ${r.error}`);
    return;
  }

  if (/\badd\b/.test(t) || /\b(put|throw)\b.*\b(cart|basket)\b/.test(t)) {
    const quantity = quantityIn(t.replace(/\b(?:prod|ord)_[a-z0-9]+\b/g, ' '));
    let product: { id: string; title?: string } | undefined = productIds[0] ? { id: productIds[0] } : undefined;
    const ordinal = ordinalIn(t);
    if (!product && ordinal !== undefined) {
      const results = lastSearchResults(history);
      const chosen = pick(results, ordinal);
      if (!chosen) {
        rec.say(results.length ? `There are only ${results.length} results in the last search.` : 'Search for something first, then say "add the first one".');
        return;
      }
      product = chosen;
    }
    if (!product && /\b(it|that|this|this one|that one)\b/.test(t)) product = lastViewedProduct(history);
    if (!product) {
      const query = t
        .replace(/\b(add|put|throw|please|to|into|in|my|the|a|an|cart|basket|bag|of|x|qty|quantity|one|two|three|four|five|six|seven|eight|nine|ten)\b|\d+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (!query) {
        rec.say('What should I add? Search for something first, then say "add the first one", or use an id like "add prod_…".');
        return;
      }
      const found = rec.call<{ products: ProductSummary[] }>('search_products', { query, limit: 3 });
      const top = found.ok ? found.output.products[0] : undefined;
      if (!top) {
        rec.say(`I couldn't find anything matching "${query}".`);
        return;
      }
      product = top;
    }
    const r = rec.call<{ cart: Cart; added: { product: ProductSummary; quantity: number } }>('add_to_cart', {
      product_id: product.id,
      quantity,
    });
    if (!r.ok) return rec.say(`I couldn't add it: ${r.error}`);
    rec.say(
      `Added ${r.output.added.quantity} × **${r.output.added.product.title}** to your cart. Cart: ${plural(r.output.cart.item_count, 'item')}, ${r.output.cart.subtotal}. Say "checkout" when you're ready.`,
    );
    return;
  }

  if (/\b(cart|basket|bag)\b/.test(t)) {
    const r = rec.call<{ cart: Cart }>('view_cart', {});
    if (!r.ok) return rec.say(`I couldn't read your cart: ${r.error}`);
    const cart = r.output.cart;
    rec.say(
      cart.items.length === 0
        ? 'Your cart is empty. Try "find a mechanical keyboard" to get started.'
        : `Your cart has ${plural(cart.item_count, 'item')} for ${cart.subtotal} before shipping. Say "checkout" to place the order.`,
    );
    return;
  }

  if (orderIds[0]) {
    const r = rec.call<{ order: Order }>('get_order', { order_id: orderIds[0] });
    rec.say(r.ok ? `Order ${r.output.order.id} from ${r.output.order.seller_name} is **${r.output.order.status}** (${r.output.order.total}).` : `I couldn't find that order: ${r.error}`);
    return;
  }

  if (/\b(orders?|purchases?|bought|track(?:ing)?|deliver(?:y|ies|ed)?|shipped|shipping status)\b/.test(t)) {
    const r = rec.call<{ orders: Order[] }>('list_orders', {});
    if (!r.ok) return rec.say(`I couldn't load your orders: ${r.error}`);
    const counts = new Map<string, number>();
    for (const o of r.output.orders) counts.set(o.status, (counts.get(o.status) ?? 0) + 1);
    rec.say(
      r.output.orders.length === 0
        ? "You haven't placed any orders yet."
        : `You have ${plural(r.output.orders.length, 'order')}: ${[...counts].map(([s, n]) => `${n} ${s}`).join(', ')}.`,
    );
    return;
  }

  if (productIds[0] || /\b(tell me (?:more )?about|details?|more info|info (?:on|about)|describe|what is|what's)\b/.test(t)) {
    let productId: string | undefined = productIds[0];
    const ordinal = ordinalIn(t);
    if (!productId && ordinal !== undefined) productId = pick(lastSearchResults(history), ordinal)?.id;
    if (!productId && /\b(it|that|this)\b/.test(t)) productId = lastViewedProduct(history)?.id;
    if (productId) {
      const r = rec.call<{ product: ProductDetail }>('get_product', { product_id: productId });
      if (!r.ok) return rec.say(`I couldn't load that product: ${r.error}`);
      const p = r.output.product;
      rec.say(`**${p.title}**: ${p.price} from ${p.seller_name}, rated ${p.rating} (${p.review_count} reviews)${stockNote(p)}. Say "add it" to put it in your cart.`);
      return;
    }
  }

  if (/\bcategor(?:y|ies)\b/.test(t)) {
    const r = rec.call<{ categories: Category[] }>('list_categories', {});
    rec.say(r.ok ? `Categories: ${r.output.categories.map((c) => `${c.name} (${c.count})`).join(', ')}. Try "show me kitchen".` : r.error);
    return;
  }

  // Default: treat the message as a search.
  const input = parseSearch(text);
  if (!input.query && !input.category && input.max_price === undefined && input.min_price === undefined) {
    rec.say(`I'm not sure what to do with that in offline mode. ${BUYER_HELP}`);
    return;
  }
  rec.say(`Searching for ${describeSearch(input)}…`);
  const r = rec.call<{ products: ProductSummary[]; total: number }>('search_products', { ...input });
  if (!r.ok) return rec.say(`The search failed: ${r.error}`);
  const { products, total } = r.output;
  if (products.length === 0) {
    rec.say(`No products matched. Try a broader word, or browse a category: ${CATEGORIES.join(', ')}.`);
    return;
  }
  const top = products[0]!;
  rec.say(
    `Found ${plural(total, 'match', 'matches')}${total > products.length ? ` (showing ${products.length})` : ''}. ` +
      `Top pick: **${top.title}** at ${top.price}, rated ${top.rating} (${top.review_count} reviews)${stockNote(top)}. ` +
      'Say "add the first one" or "tell me about the second one".',
  );
}

// ─── seller ────────────────────────────────────────────────────────────────

function sellerTurn(text: string, { rec }: TurnContext): void {
  const t = text.toLowerCase();
  const productIds = ids(text, 'prod');
  const orderIds = ids(text, 'ord');

  if (/^(hi|hello|hey|help|menu|commands|what can you do)\b/.test(t) && t.length < 40) {
    rec.say(`I can help run your store with simple commands. ${SELLER_HELP}`);
    return;
  }

  if (orderIds[0] && /\b(ship|shipped|deliver|delivered|fulfil+(?:ed)?|sent|send)\b/.test(t)) {
    const status = /\bdeliver(?:ed)?\b/.test(t) ? 'delivered' : 'shipped';
    const r = rec.call<{ order: Order }>('update_order_status', { order_id: orderIds[0], status });
    rec.say(r.ok ? `Marked ${r.output.order.id} as **${r.output.order.status}**.` : `I couldn't update it: ${r.error}`);
    return;
  }

  if (productIds[0] && /\b(set|change|update|make|restock|archive|unpublish|publish|activate|draft|price|stock)\b/.test(t)) {
    const patch: Record<string, unknown> = { product_id: productIds[0] };
    const n = t.replace(/\bprod_[a-z0-9]+\b/g, ' '); // ids contain digits; parse numbers without them
    const price = n.match(/\bprice\b[^$\d]*\$?\s*(\d+(?:\.\d{1,2})?)/) ?? n.match(/\$\s*(\d+(?:\.\d{1,2})?)/);
    const stock = n.match(/\b(?:stock|inventory|units?|qty|quantity)\b[^\d]*(\d{1,6})\b/) ?? n.match(/\brestock\b[^\d]*(\d{1,6})\b/);
    if (price) patch.price = Number(price[1]);
    if (stock) patch.stock = Number(stock[1]);
    if (/\barchive\b/.test(t)) patch.status = 'archived';
    else if (/\b(unpublish|draft)\b/.test(t)) patch.status = 'draft';
    else if (/\b(publish|activate)\b/.test(t)) patch.status = 'active';
    if (Object.keys(patch).length === 1) {
      rec.say('What should I change? For example "set stock of prod_… to 20" or "set price of prod_… to $24.99".');
      return;
    }
    const r = rec.call<{ product: ProductDetail }>('update_listing', patch);
    if (!r.ok) return rec.say(`I couldn't update it: ${r.error}`);
    const p = r.output.product;
    rec.say(`Updated **${p.title}**: ${p.price}, ${plural(p.stock, 'unit')} in stock, ${p.status}.`);
    return;
  }

  if (/\blow(?:[- ]| on | in )?(?:stock|inventory)\b|\brunning (?:low|out)\b|\bout of stock\b|\brestock\b/.test(t)) {
    const r = rec.call<{ stats: SellerStats }>('seller_stats', {});
    if (!r.ok) return rec.say(r.error);
    const low = r.output.stats.low_stock;
    rec.say(
      low.length === 0
        ? 'Nothing is running low: every active listing has more than 5 units.'
        : `${plural(low.length, 'listing')} at 5 units or fewer: ${low.map((p) => `${truncate(p.title, 40)} (${p.stock} left, ${p.id})`).join('; ')}. Say "set stock of prod_… to 25" to restock.`,
    );
    return;
  }

  if (/\b(orders?|ship(?:ping)?|fulfil+(?:ment)?|unshipped|pending|to ship)\b/.test(t)) {
    const onlyOpen = /\b(ship|shipping|unshipped|pending|to ship|need|needs|open|fulfil+)\b/.test(t);
    const r = rec.call<{ orders: Order[] }>('get_seller_orders', onlyOpen ? { status: 'placed' } : {});
    if (!r.ok) return rec.say(r.error);
    const orders = r.output.orders;
    if (onlyOpen) {
      rec.say(
        orders.length === 0
          ? 'All caught up: no orders are waiting to ship.'
          : `${plural(orders.length, 'order')} waiting to ship: ${orders.slice(0, 5).map((o) => `${o.id} for ${o.buyer_name} (${plural(o.items.reduce((n, i) => n + i.quantity, 0), 'item')}, ${o.total})`).join('; ')}. Say "mark ord_… shipped" once it's on its way.`,
      );
    } else {
      rec.say(`You have ${plural(orders.length, 'order')} in total, ${orders.filter((o) => o.status === 'placed').length} waiting to ship.`);
    }
    return;
  }

  if (/\b(stats?|sales|revenue|dashboard|performance|how am i doing|how is (?:the )?(?:store|business|shop)|how'?s (?:the )?(?:store|business|shop)|earnings|best ?sellers?|top products?)\b/.test(t)) {
    const r = rec.call<{ stats: SellerStats }>('seller_stats', {});
    if (!r.ok) return rec.say(r.error);
    const s = r.output.stats;
    const top = s.top_products[0];
    rec.say(
      `Revenue: ${s.revenue} from ${plural(s.orders_total - s.orders_by_status.cancelled, 'order')} (${plural(s.units_sold, 'unit')} sold). ` +
        `${s.needs_shipping.length} to ship, ${s.low_stock.length} low on stock${top ? `; best seller: ${truncate(top.title, 40)}` : ''}.`,
    );
    return;
  }

  if (/\b(listings?|products?|catalog(?:ue)?|inventory|items?|my store|my shop)\b/.test(t)) {
    const status = t.match(/\b(active|draft|archived)\b/)?.[1];
    const r = rec.call<{ products: ProductDetail[] }>('list_my_listings', status ? { status } : {});
    if (!r.ok) return rec.say(r.error);
    const products = r.output.products;
    const count = (s: string) => products.filter((p) => p.status === s).length;
    const low = products.filter((p) => p.status === 'active' && p.stock <= 5).length;
    rec.say(
      `You have ${plural(products.length, `${status ? `${status} ` : ''}listing`)}` +
        (status ? '.' : ` (${count('active')} active, ${count('draft')} draft, ${count('archived')} archived).`) +
        (low ? ` ${low} active ${low === 1 ? 'is' : 'are'} at 5 units or fewer.` : ''),
    );
    return;
  }

  if (/\bcategor(?:y|ies)\b/.test(t)) {
    const r = rec.call<{ categories: Category[] }>('list_categories', {});
    rec.say(r.ok ? `Categories: ${r.output.categories.map((c) => `${c.name} (${c.count})`).join(', ')}.` : r.error);
    return;
  }

  if (/\b(list|sell|create|new listing|add a product|draft)\b/.test(t)) {
    rec.say(
      'Drafting a new listing from a description needs the AI assistant. In offline mode I can still update your ' +
        'listings ("set price of prod_… to $24.99", "set stock of prod_… to 20", "archive prod_…"), show orders and stats.',
    );
    return;
  }

  rec.say(`I'm not sure what to do with that in offline mode. ${SELLER_HELP}`);
}
