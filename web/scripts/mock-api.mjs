#!/usr/bin/env node
// Dependency-free mock of the marketplace server (docs/CONTRACT.md §5–§7) for UI work without
// server/: REST routes, POST /api/chat as a keyword-scripted SSE stream, GET /api/events with a
// sample event every ~4s. `npm run mock -w web` → http://localhost:3001 (Vite proxies /api here).
// Env: PORT (3001) · MOCK_AI=0 → offline mode · MOCK_EVENTS=0 → no sample events.
// Buyer keywords: checkout · add…cart · cart · order · categories · "tell me about" · fail · crash ·
// else search ("under $50" = max price). Seller: "list a new…" · mark/ord_… · ship · low/stock ·
// stats/sold · listings · order · crash.
import http from 'node:http';

const PORT = Number(process.env.PORT) || 3001;
const AI = process.env.MOCK_AI !== '0';
const SAMPLE_EVENTS = process.env.MOCK_EVENTS !== '0';
const BUYER = { id: 'usr_ada', name: 'Ada', role: 'buyer' };
const SELLER = { id: 'usr_northwind', name: 'Northwind Goods', role: 'seller' };
const PINE = { id: 'usr_pixelpine', name: 'Pixel & Pine', role: 'seller' };
const ADDRESS = '12 Harbor St, Portland, OR 97201';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rid = () => Math.random().toString(36).slice(2, 10).padEnd(8, '0');
const money = (c) => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const ago = (min) => new Date(Date.now() - min * 60_000).toISOString();
const sum = (xs, f) => xs.reduce((n, x) => n + f(x), 0);
const short = (id) => `#${id.split('_')[1]?.slice(0, 8) ?? id}`;
const s = (n) => (n === 1 ? '' : 's');

// ── Catalogue: [id, seller, title, cents, stock, category, emoji, rating, reviews, tags, description]
const products = [
  ['prod_k3lp7x2a', SELLER, 'Keychron K3 Low-Profile Mechanical Keyboard', 8999, 14, 'electronics', '⌨️', 4.6, 1284, ['keyboard', 'mechanical', 'wireless'], 'Slim wireless mechanical keyboard with hot-swappable low-profile switches.'],
  ['prod_tk65brwn', SELLER, 'Tactile 65% Mechanical Keyboard, Brown Switches', 6400, 3, 'electronics', '🎹', 4.4, 512, ['keyboard', 'mechanical', 'tactile'], 'Compact 65% board with tactile brown switches, PBT keycaps and USB-C.'],
  ['prod_aerogo01', SELLER, 'AeroPress Go Travel Coffee Maker', 3995, 22, 'kitchen', '☕', 4.8, 3410, ['coffee', 'travel', 'gift'], 'Brews smooth, grit-free coffee in a minute and packs into its own mug.'],
  ['prod_ethbean2', SELLER, 'Single-Origin Ethiopia Coffee Beans, 12 oz', 1850, 40, 'kitchen', '🫘', 4.7, 860, ['coffee', 'beans', 'gift'], 'Light roast with notes of blueberry and jasmine, roasted weekly.'],
  ['prod_pourset2', SELLER, 'Stoneware Pour-Over Mug Set (2)', 2700, 5, 'kitchen', '🍵', 4.5, 214, ['coffee', 'mug', 'ceramic'], 'Two speckled stoneware mugs with a matching pour-over dripper.'],
  ['prod_linenoat', SELLER, 'Linen Throw Blanket, Oat', 5400, 9, 'home', '🛋️', 4.6, 402, ['blanket', 'linen', 'cozy'], 'Stonewashed European linen throw that softens with every wash.'],
  ['prod_walnutdk', SELLER, 'Walnut Desk Organizer', 3200, 0, 'office', '🗂️', 4.3, 98, ['desk', 'wood', 'organizer'], 'Solid walnut tray with slots for pens, phone and cards.'],
  ['prod_pragprog', SELLER, 'The Pragmatic Programmer (20th Anniversary)', 4199, 11, 'books', '📘', 4.8, 5120, ['book', 'programming'], 'The classic guide to becoming a better developer, updated for today.'],
  ['prod_rainbow7', PINE, 'Wooden Rainbow Stacker', 2900, 7, 'toys', '🌈', 4.9, 311, ['toy', 'wooden', 'kids'], 'Seven hand-painted arches for stacking, sorting and open-ended play.'],
  ['prod_campmug1', PINE, 'Insulated Camp Mug, 12 oz', 2200, 30, 'outdoors', '🏕️', 4.5, 190, ['mug', 'coffee', 'camping'], 'Double-wall steel mug that keeps coffee hot on cold mornings.'],
  ['prod_merinob1', PINE, 'Merino Wool Beanie', 2600, 2, 'fashion', '🧢', 4.4, 77, ['hat', 'wool', 'winter'], 'Soft, itch-free merino beanie in forest green.'],
  ['prod_cedarcd1', PINE, 'Hand-Poured Soy Candle, Cedar', 1900, 16, 'home', '🕯️', 4.7, 645, ['candle', 'gift', 'cozy'], 'Cedar and smoke soy candle with a 50-hour burn.'],
].map(([id, seller, title, price_cents, stock, category, emoji, rating, review_count, tags, description], i) => (
  { id, seller, title, price_cents, stock, category, emoji, rating, review_count, tags, description, status: 'active', created_at: ago(60 * 24 * (30 - i)), updated_at: ago(60 * (i + 2)) }
));
const byId = (id) => products.find((p) => p.id === id);
const summary = (p) => ({ id: p.id, title: p.title, price_cents: p.price_cents, price: money(p.price_cents), currency: 'USD', stock: p.stock, category: p.category, emoji: p.emoji, rating: p.rating, review_count: p.review_count, seller_id: p.seller.id, seller_name: p.seller.name, status: p.status });
const detail = (p) => ({ ...summary(p), description: p.description, tags: p.tags, created_at: p.created_at, updated_at: p.updated_at });

// ── Cart, orders, stats ──────────────────────────────────────────────────────
let cart = [{ id: 'prod_aerogo01', qty: 1 }, { id: 'prod_ethbean2', qty: 2 }];
function cartView() {
  const items = cart.map(({ id, qty }) => { const p = byId(id); return { product: summary(p), quantity: qty, line_total_cents: p.price_cents * qty, line_total: money(p.price_cents * qty) }; });
  const subtotal = sum(items, (i) => i.line_total_cents);
  return { buyer_id: BUYER.id, items, item_count: sum(items, (i) => i.quantity), subtotal_cents: subtotal, subtotal: money(subtotal) };
}
function makeOrder(id, seller, status, lines, minutesAgo) {
  const items = lines.map(([pid, q]) => { const p = byId(pid); return { product_id: pid, title: p.title, emoji: p.emoji, unit_price_cents: p.price_cents, unit_price: money(p.price_cents), quantity: q, line_total_cents: p.price_cents * q }; });
  const subtotal = sum(items, (i) => i.line_total_cents);
  const shipping = subtotal >= 3500 ? 0 : 599;
  return { id, buyer_id: BUYER.id, buyer_name: BUYER.name, seller_id: seller.id, seller_name: seller.name, status, items, subtotal_cents: subtotal, shipping_cents: shipping, total_cents: subtotal + shipping, total: money(subtotal + shipping), shipping_address: ADDRESS, created_at: ago(minutesAgo), updated_at: ago(Math.max(0, minutesAgo - 20)) };
}
const orders = [
  makeOrder('ord_a1b2c3d4', SELLER, 'placed', [['prod_k3lp7x2a', 1]], 95),
  makeOrder('ord_e5f6g7h8', SELLER, 'shipped', [['prod_pourset2', 1]], 60 * 26),
  makeOrder('ord_t4u5v6w7', SELLER, 'delivered', [['prod_pragprog', 1], ['prod_ethbean2', 2]], 60 * 24 * 5),
  makeOrder('ord_j9k8l7m6', PINE, 'delivered', [['prod_rainbow7', 1], ['prod_cedarcd1', 1]], 60 * 24 * 9),
  makeOrder('ord_n5p4q3r2', SELLER, 'cancelled', [['prod_linenoat', 1]], 60 * 24 * 15),
];
const sellerOrders = (status) => orders.filter((o) => o.seller_id === SELLER.id && (!status || o.status === status));
const listings = () => products.filter((p) => p.seller.id === SELLER.id).map(detail);
function stats() {
  const mine = sellerOrders();
  const live = mine.filter((o) => o.status !== 'cancelled');
  const top = new Map();
  for (const item of live.flatMap((o) => o.items)) {
    const t = top.get(item.product_id) ?? { product_id: item.product_id, title: item.title, emoji: item.emoji, units: 0, revenue_cents: 0 };
    t.units += item.quantity; t.revenue_cents += item.line_total_cents; top.set(item.product_id, t);
  }
  const revenue = sum(live, (o) => o.total_cents);
  const by = { placed: 0, shipped: 0, delivered: 0, cancelled: 0 };
  mine.forEach((o) => by[o.status]++);
  const active = products.filter((p) => p.seller.id === SELLER.id && p.status === 'active');
  return {
    revenue_cents: revenue, revenue: money(revenue), orders_total: mine.length, orders_by_status: by,
    units_sold: sum(live, (o) => sum(o.items, (i) => i.quantity)), active_listings: active.length,
    top_products: [...top.values()].sort((a, b) => b.revenue_cents - a.revenue_cents).slice(0, 5).map((t) => ({ ...t, revenue: money(t.revenue_cents) })),
    low_stock: active.filter((p) => p.stock <= 5).map(summary), needs_shipping: sellerOrders('placed'),
  };
}
function categories() {
  const counts = new Map();
  for (const p of products) if (p.status === 'active') counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
  return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
}
const STOP = new Set('a an the me my for to of and or with show find some any im looking want need under over below gift gifts lover lovers good best new please can you what whats is are in on get buy see product products about tell more'.split(' '));
function search(q, { max, limit = 8, category } = {}) {
  const words = q.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w) && !/^\d+$/.test(w)).map((w) => (w.length > 3 ? w.replace(/s$/, '') : w));
  let hits = products.filter((p) => p.status === 'active' && (!max || p.price_cents <= max * 100) && (!category || p.category === category)).map((p) => {
    const hay = `${p.category} ${p.tags.join(' ')} ${p.description}`.toLowerCase();
    return { p, score: sum(words, (w) => (p.title.toLowerCase().includes(w) ? 3 : 0) + (hay.includes(w) ? 1 : 0)) };
  });
  if (words.length) hits = hits.filter((h) => h.score > 0);
  hits.sort((a, b) => b.score - a.score || b.p.rating - a.p.rating);
  return { products: hits.slice(0, limit).map((h) => summary(h.p)), total: hits.length, query: words.join(' ') };
}

// ── Live events ──────────────────────────────────────────────────────────────
const clients = new Set();
function emit(event) {
  const full = { id: `evt_${rid()}`, at: new Date().toISOString(), ...event };
  for (const res of clients) res.write(`event: ${full.type}\ndata: ${JSON.stringify(full)}\n\n`);
}
let tick = 0;
setInterval(() => {
  if (!SAMPLE_EVENTS || !clients.size) return;
  const p = products[tick % products.length];
  const kind = tick++ % 3;
  if (kind === 0) emit({ type: 'order.created', order: makeOrder(`ord_${rid()}`, p.seller, 'placed', [[p.id, 1]], 0), actor: BUYER, source: 'chat' });
  else if (kind === 1) emit({ type: 'agent.tool_call', tool: 'search_products', actor: BUYER, source: 'mcp', ok: true, summary: `Ada searched for "${p.tags[0]}" (${search(p.tags[0]).total} results)` });
  else emit({ type: 'product.updated', product: summary(p), actor: p.seller, source: 'api' });
}, 4000).unref();
// Heartbeat: the web client reopens a stream that stays silent for 40s, like it does with the real server.
setInterval(() => { for (const res of clients) res.write('event: ping\ndata: {}\n\n'); }, 15_000).unref();

// ── Scripted chat turns: { say?, tool?, input?, run?() → { ok, result, summary }, after?(result) } ──
function plan(role, text) {
  const m = text.toLowerCase();
  const idIn = (prefix) => text.match(new RegExp(`\\b${prefix}_[a-z0-9]+`, 'i'))?.[0];
  if (/crash/.test(m)) return { crash: true };
  const tool = (name, input, run, after, say = '') => ({ say, tool: name, input, run, after });
  if (role === 'buyer') {
    if (/check ?out|place (my|the|an) order/.test(m)) return tool('checkout', { shipping_address: ADDRESS }, () => {
      if (!cart.length) return { ok: false, result: 'Your cart is empty — add something first.' };
      const groups = new Map();
      for (const { id, qty } of cart) { const seller = byId(id).seller; groups.set(seller, [...(groups.get(seller) ?? []), [id, qty]]); }
      const placed = [...groups].map(([seller, lines]) => makeOrder(`ord_${rid()}`, seller, 'placed', lines, 0));
      cart.forEach(({ id, qty }) => { byId(id).stock -= qty; });
      orders.unshift(...placed); cart = [];
      placed.forEach((order) => emit({ type: 'order.created', order, actor: BUYER, source: 'chat' }));
      emit({ type: 'cart.updated', cart: cartView(), actor: BUYER, source: 'chat' });
      const total = sum(placed, (o) => o.total_cents);
      return { ok: true, result: { orders: placed, total_cents: total, total: money(total) }, summary: `Ada checked out ${placed.length} order${s(placed.length)} (${money(total)})` };
    }, (r) => `Done — **${r.orders.length}** order${s(r.orders.length)} placed for **${r.total}**. The sellers can see ${r.orders.length === 1 ? 'it' : 'them'} now.`, 'Placing your order now.');
    if (/\b(add|put)\b/.test(m) && /cart/.test(m)) {
      const p = byId(idIn('prod')) ?? byId(search(text).products[0]?.id);
      const qty = Number(m.match(/\b(?:add|put)\s+(\d+)\b/)?.[1]) || 1;
      return tool('add_to_cart', { product_id: p?.id ?? 'unknown', quantity: qty }, () => {
        if (!p) return { ok: false, result: 'I couldn’t find that product.' };
        const line = cart.find((l) => l.id === p.id);
        if ((line?.qty ?? 0) + qty > p.stock) return { ok: false, result: `Only ${p.stock} of “${p.title}” left in stock.` };
        if (line) line.qty += qty; else cart.push({ id: p.id, qty });
        emit({ type: 'cart.updated', cart: cartView(), actor: BUYER, source: 'chat' });
        return { ok: true, result: { cart: cartView(), added: { product: summary(p), quantity: qty } }, summary: `Ada added ${qty} × “${p.title}” to her cart` };
      }, (r) => `Added **${r.added.product.title}** — your subtotal is now **${r.cart.subtotal}**.`);
    }
    if (/cart/.test(m)) return tool('view_cart', {}, () => ({ ok: true, result: { cart: cartView() }, summary: 'Ada viewed her cart' }),
      (r) => r.cart.item_count ? `You have **${r.cart.item_count}** item${s(r.cart.item_count)} totalling **${r.cart.subtotal}**${r.cart.subtotal_cents >= 3500 ? ' — shipping is free.' : '.'}` : 'Your cart is empty.', 'Here’s your cart:');
    if (/order/.test(m)) return tool('list_orders', {}, () => ({ ok: true, result: { orders: orders.filter((o) => o.buyer_id === BUYER.id) }, summary: 'Ada listed her orders' }),
      (r) => `You have **${r.orders.length}** orders; ${r.orders.filter((o) => o.status === 'shipped').length} on the way and ${r.orders.filter((o) => o.status === 'placed').length} not shipped yet.`);
    if (/categor/.test(m)) return tool('list_categories', {}, () => ({ ok: true, result: { categories: categories() } }), () => 'Pick a category and I’ll show you the best of it.');
    if (/tell me|detail|more info/.test(m)) {
      const p = byId(idIn('prod')) ?? byId(search(text).products[0]?.id);
      return tool('get_product', { product_id: p?.id ?? 'unknown' }, () => (p ? { ok: true, result: { product: detail(p) } } : { ok: false, result: 'No such product.' }),
        (r) => `**${r.product.title}** is rated ${r.product.rating} by ${r.product.review_count.toLocaleString()} buyers.`);
    }
    const max = Number(m.match(/(?:under|below|less than)\s*\$?(\d+)/)?.[1]) || undefined;
    const found = search(text, { max });
    return tool('search_products', { query: found.query, ...(max ? { max_price: max } : {}), limit: 8 }, () => (/fail/.test(m)
      ? { ok: false, result: 'Search index unavailable (mock failure).' }
      : { ok: true, result: found, summary: `Ada searched for "${found.query}" (${found.total} results)` }),
    (r) => r.products.length ? `Here ${r.products.length === 1 ? 'is' : 'are'} **${r.products.length}** pick${s(r.products.length)}${r.query ? ` for “${r.query}”` : ''}. The **${r.products[0].title}** is the top match at **${r.products[0].price}**.` : 'Nothing matched — try broader words?', 'Let me look.');
  }
  // seller
  if (/\blist\b.*\b(new|product)\b|new listing|create/.test(m)) {
    const title = (text.split(':')[1] ?? text).split(',')[0].trim().replace(/\b\w/g, (c) => c.toUpperCase()) || 'New Product';
    const price = Number(m.match(/\$(\d+(?:\.\d{1,2})?)/)?.[1]) || 20;
    const stock = Number(m.match(/(\d+)\s*(in stock|units|pcs)/)?.[1]) || 10;
    const kitchen = /mug|cup|bowl|plate|ceramic/.test(m);
    const input = { title, description: `${title}, made in small batches.`, price, stock, category: kitchen ? 'kitchen' : 'home', emoji: kitchen ? '☕' : '📦', status: 'active' };
    return tool('create_listing', input, () => {
      const p = { id: `prod_${rid()}`, seller: SELLER, title, price_cents: Math.round(price * 100), stock, category: input.category, emoji: input.emoji, rating: 0, review_count: 0, tags: [], description: input.description, status: 'active', created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      products.push(p);
      emit({ type: 'product.created', product: summary(p), actor: SELLER, source: 'chat' });
      return { ok: true, result: { product: detail(p) }, summary: `Northwind Goods listed “${title}” at ${money(p.price_cents)}` };
    }, (r) => `**${r.product.title}** is live at **${r.product.price}** with ${r.product.stock} in stock.`, 'Publishing that for you.');
  }
  if (/\bmark\b|as shipped/.test(m) || idIn('ord')) return tool('update_order_status', { order_id: idIn('ord') ?? sellerOrders('placed').at(-1)?.id, status: 'shipped' }, () => {
    const o = sellerOrders().find((x) => x.id === idIn('ord')) ?? sellerOrders('placed').at(-1);
    if (!o || o.status !== 'placed') return { ok: false, result: 'That order isn’t waiting to ship.' };
    o.status = 'shipped'; o.updated_at = new Date().toISOString();
    emit({ type: 'order.updated', order: o, actor: SELLER, source: 'chat' });
    return { ok: true, result: { order: o }, summary: `Northwind Goods shipped order ${short(o.id)}` };
  }, (r) => `Order **${short(r.order.id)}** is marked shipped — ${r.order.buyer_name} sees it right away.`);
  if (/ship/.test(m)) return tool('get_seller_orders', { status: 'placed' }, () => ({ ok: true, result: { orders: sellerOrders('placed') } }),
    (r) => r.orders.length ? `**${r.orders.length}** order${s(r.orders.length)} waiting to ship.` : 'Nothing is waiting to ship.');
  if (/low|stock/.test(m)) return tool('list_my_listings', { status: 'active' }, () => ({ ok: true, result: { products: listings().filter((p) => p.status === 'active') } }), (r) => {
    const low = r.products.filter((p) => p.stock <= 5);
    return low.length ? `Running low: ${low.map((p) => `**${p.title}** (${p.stock} left)`).join(', ')}. Want me to restock any of them?` : 'Everything is well stocked.';
  });
  if (/stat|sold|sales|revenue|doing|perform/.test(m)) return tool('seller_stats', {}, () => ({ ok: true, result: { stats: stats() } }),
    (r) => `Revenue so far is **${r.stats.revenue}** across **${r.stats.orders_total}** orders. Your best seller is **${r.stats.top_products[0]?.title ?? '—'}**.`);
  if (/listing/.test(m)) return tool('list_my_listings', {}, () => ({ ok: true, result: { products: listings() } }), (r) => `You have **${r.products.length}** listings.`);
  if (/order/.test(m)) return tool('get_seller_orders', {}, () => ({ ok: true, result: { orders: sellerOrders() } }), (r) => `You have **${r.orders.length}** orders in total.`);
  if (/categor/.test(m)) return tool('list_categories', {}, () => ({ ok: true, result: { categories: categories() } }), () => 'Those are the marketplace categories.');
  return { say: 'I can help you run **Northwind Goods**: ask which orders need shipping, what sold recently, or to *list a new product*.' };
}

async function streamTurn(req, res, role, message) {
  res.writeHead(200, { ...cors(req), 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  let open = true;
  res.on('close', () => { open = false; });
  const items = conversations[role].items;
  const send = (event) => open && res.write(`data: ${JSON.stringify(event)}\n\n`);
  const say = async (text) => {
    for (const chunk of text.match(/\S+\s*/g) ?? []) {
      if (!open) return;
      send({ type: 'text_delta', text: chunk });
      const last = items.at(-1);
      if (last?.kind === 'assistant_text') last.text += chunk; else items.push({ kind: 'assistant_text', text: chunk });
      await sleep(15 + Math.random() * 35);
    }
  };
  items.push({ kind: 'user', text: message });
  send({ type: 'status', text: 'thinking' });
  await sleep(450);
  const step = plan(role, message);
  if (!AI) await say('_The AI assistant is off (offline mode)._ Add `ANTHROPIC_API_KEY` to `.env` to enable Claude. Here’s a keyword-based answer:\n\n');
  if (step.crash) {
    await say('Let me check… ');
    send({ type: 'error', message: 'Mock failure: the model request failed (you asked for “crash”).' });
    return res.end();
  }
  if (step.say) await say(step.say);
  if (step.tool) {
    const id = `toolu_${rid()}`;
    send({ type: 'tool_call', id, name: step.tool, input: step.input });
    items.push({ kind: 'tool_call', id, name: step.tool, input: step.input });
    await sleep(500 + Math.random() * 600);
    const out = step.run();
    send({ type: 'tool_result', id, name: step.tool, ok: out.ok, result: out.result });
    items.push({ kind: 'tool_result', id, name: step.tool, ok: out.ok, result: out.result });
    const actor = role === 'buyer' ? BUYER : SELLER;
    emit({ type: 'agent.tool_call', tool: step.tool, actor, source: 'chat', ok: out.ok, summary: out.summary ?? `${actor.name} ran ${step.tool}${out.ok ? '' : ' (failed)'}` });
    await sleep(250);
    await say(out.ok ? step.after(out.result) : `That didn’t work: ${out.result}`);
  }
  send({ type: 'done', usage: { input_tokens: 1180 + message.length, output_tokens: 160 } });
  res.end();
}

// ── HTTP ─────────────────────────────────────────────────────────────────────
const conversations = { buyer: { id: `conv_${rid()}`, items: [] }, seller: { id: `conv_${rid()}`, items: [] } };
const health = () => ({
  ok: true, ai: { enabled: AI, model: 'claude-opus-5-5', effort: 'medium' },
  mcp: { path: '/mcp', url: `http://localhost:${PORT}/mcp`, tokens: { buyer: 'mk_buyer_demo', seller: 'mk_seller_demo' } },
  actors: { buyer: BUYER, seller: SELLER },
});
function cors(req) {
  const origin = req.headers.origin;
  return { 'Access-Control-Allow-Origin': /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin ?? '') ? origin : 'http://localhost:5173', 'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'content-type,authorization,x-marketplace-token', Vary: 'Origin' };
}
function json(req, res, status, body) {
  res.writeHead(status, { ...cors(req), 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}
async function readJson(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  try { return JSON.parse(raw || '{}'); } catch { return null; }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://mock');
  const path = url.pathname;
  const get = req.method === 'GET';
  let m;
  try {
    if (req.method === 'OPTIONS') { res.writeHead(204, cors(req)); return res.end(); }
    if (get && path === '/api/health') return json(req, res, 200, health());
    if (get && path === '/api/products') {
      const r = search(url.searchParams.get('q') ?? '', { category: url.searchParams.get('category') || undefined, limit: Number(url.searchParams.get('limit')) || 50 });
      return json(req, res, 200, { products: r.products, total: r.total });
    }
    if (get && (m = path.match(/^\/api\/products\/([\w-]+)$/))) {
      const p = byId(m[1]);
      return p ? json(req, res, 200, { product: detail(p) }) : json(req, res, 404, { error: `No product ${m[1]}` });
    }
    if (get && path === '/api/categories') return json(req, res, 200, { categories: categories() });
    if (get && path === '/api/buyer/cart') return json(req, res, 200, { cart: cartView() });
    if (get && path === '/api/buyer/orders') return json(req, res, 200, { orders: orders.filter((o) => o.buyer_id === BUYER.id) });
    if (get && path === '/api/seller/listings') return json(req, res, 200, { products: listings() });
    if (get && path === '/api/seller/orders') return json(req, res, 200, { orders: sellerOrders() });
    if (get && path === '/api/seller/stats') return json(req, res, 200, { stats: stats() });
    if (get && path === '/api/events') {
      res.writeHead(200, { ...cors(req), 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write('retry: 3000\n: connected\n\n');
      clients.add(res);
      return res.on('close', () => clients.delete(res));
    }
    if ((m = path.match(/^\/api\/conversations\/(buyer|seller)$/))) {
      const conv = conversations[m[1]];
      if (get) return json(req, res, 200, { id: conv.id, role: m[1], actor: m[1] === 'buyer' ? BUYER : SELLER, items: conv.items });
      if (req.method === 'DELETE') { conv.items = []; return json(req, res, 200, { ok: true }); }
    }
    if (req.method === 'POST' && path === '/api/chat') {
      const body = await readJson(req);
      if (!body || !['buyer', 'seller'].includes(body.role) || typeof body.message !== 'string' || !body.message.trim()) {
        return json(req, res, 400, { error: 'Expected JSON { role: "buyer" | "seller", message: string }' });
      }
      return await streamTurn(req, res, body.role, body.message.trim());
    }
    if (path === '/mcp') return json(req, res, 405, { jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed (the mock does not implement MCP).' }, id: null });
    return json(req, res, 404, { error: `No route for ${req.method} ${path}` });
  } catch (err) {
    console.error(err);
    if (!res.headersSent) json(req, res, 500, { error: String(err?.message ?? err) });
    else res.end();
  }
});

server.listen(PORT, () => {
  console.log(`[mock-api] http://localhost:${PORT}  ai=${AI ? 'on' : 'off (MOCK_AI=0)'}  sample events=${SAMPLE_EVENTS ? 'on' : 'off'}`);
});
