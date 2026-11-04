import type { DatabaseSync } from 'node:sqlite';
import { daysAgoIso, dollarsToCents, stableId } from './format.js';
import type { CategoryName, OrderStatus } from './types.js';

export const DEMO_BUYER_ID = 'usr_ada';
export const DEMO_SELLER_ID = 'usr_northwind';
export const SECOND_SELLER_ID = 'usr_pixelpine';
export const DEMO_TOKENS = { buyer: 'mk_buyer_demo', seller: 'mk_seller_demo' } as const;
export const DEMO_ADDRESS = 'Ada, 221 Analytical Ave, Apt 4, Portland, OR 97205';

interface SeedProduct {
  key: string;
  seller: typeof DEMO_SELLER_ID | typeof SECOND_SELLER_ID;
  title: string;
  description: string;
  price: number;
  stock: number;
  category: CategoryName;
  tags: string[];
  emoji: string;
  rating: number;
  reviews: number;
  daysAgo: number;
}

const NW = DEMO_SELLER_ID;
const PP = SECOND_SELLER_ID;

const PRODUCTS: SeedProduct[] = [
  // ── electronics (Northwind) ─────────────────────────────────────────────
  {
    key: 'tkl-keyboard', seller: NW, category: 'electronics', emoji: '⌨️', price: 89, stock: 14, rating: 4.7, reviews: 312, daysAgo: 58,
    title: 'Northwind TKL Mechanical Keyboard (Tactile Brown Switches)',
    description: 'Tenkeyless mechanical keyboard with tactile brown switches, double-shot PBT keycaps and white per-key backlighting. A detachable USB-C cable and an aluminum top plate keep it solid on the desk.',
    tags: ['keyboard', 'mechanical', 'tenkeyless', 'wired', 'backlit'],
  },
  {
    key: 'lowprofile-keyboard', seller: NW, category: 'electronics', emoji: '⌨️', price: 129, stock: 4, rating: 4.5, reviews: 128, daysAgo: 41,
    title: 'Low-Profile Wireless Mechanical Keyboard',
    description: 'Slim full-size mechanical keyboard with low-profile linear switches. Pairs with up to three devices over Bluetooth or the included 2.4 GHz dongle, and runs about 80 hours per charge with the backlight off.',
    tags: ['keyboard', 'mechanical', 'wireless', 'bluetooth', 'low-profile'],
  },
  {
    key: 'compact-keyboard', seller: NW, category: 'electronics', emoji: '⌨️', price: 74, stock: 18, rating: 4.6, reviews: 204, daysAgo: 33,
    title: 'Compact 65% Hot-Swap Mechanical Keyboard',
    description: 'A 65% layout that keeps the arrow keys. Hot-swappable sockets let you change switches without soldering; ships with pre-lubed linear switches and a braided USB-C cable.',
    tags: ['keyboard', 'mechanical', 'compact', 'hot-swap', 'gaming'],
  },
  {
    key: 'anc-headphones', seller: NW, category: 'electronics', emoji: '🎧', price: 179, stock: 9, rating: 4.6, reviews: 842, daysAgo: 55,
    title: 'Over-Ear Noise-Cancelling Headphones',
    description: 'Wireless over-ear headphones with active noise cancelling, 35-hour battery life and a fold-flat design for travel. Comes with a carrying case and a 3.5 mm cable for wired listening.',
    tags: ['headphones', 'wireless', 'noise-cancelling', 'bluetooth', 'travel'],
  },
  {
    key: 'sport-earbuds', seller: NW, category: 'electronics', emoji: '🎶', price: 49.99, stock: 31, rating: 4.2, reviews: 530, daysAgo: 47,
    title: 'True Wireless Sport Earbuds',
    description: 'Secure-fit earbuds with ear hooks, IPX7 sweat and water resistance, and 8 hours of playback (28 with the charging case). Built for runs and gym sessions.',
    tags: ['earbuds', 'headphones', 'wireless', 'running', 'waterproof', 'gift'],
  },
  {
    key: 'bt-speaker', seller: NW, category: 'electronics', emoji: '🔊', price: 59, stock: 3, rating: 4.5, reviews: 402, daysAgo: 39,
    title: 'Portable Bluetooth Speaker',
    description: 'Pocketable speaker with surprisingly full sound, a 12-hour battery and an IP67 rating, so it can handle the beach or the shower. Pair two for stereo.',
    tags: ['speaker', 'bluetooth', 'waterproof', 'outdoor', 'gift'],
  },
  {
    key: 'gan-charger', seller: NW, category: 'electronics', emoji: '🔌', price: 34.99, stock: 40, rating: 4.7, reviews: 1290, daysAgo: 30,
    title: '65W USB-C GaN Charger (2-Port)',
    description: 'Compact GaN wall charger with two USB-C ports that fast-charges a laptop and a phone at the same time. Folding prongs make it easy to travel with.',
    tags: ['charger', 'usb-c', 'gan', 'travel', 'laptop'],
  },
  // ── kitchen ─────────────────────────────────────────────────────────────
  {
    key: 'pourover-kit', seller: NW, category: 'kitchen', emoji: '🫘', price: 42, stock: 15, rating: 4.6, reviews: 189, daysAgo: 52,
    title: 'Pour-Over Coffee Starter Kit',
    description: 'Everything for a great first pour-over: a ceramic dripper, 100 paper filters, a glass carafe and a measuring scoop. Brews one to two cups at a time.',
    tags: ['coffee', 'pour-over', 'dripper', 'brewing', 'gift'],
  },
  {
    key: 'burr-grinder', seller: NW, category: 'kitchen', emoji: '⚙️', price: 119, stock: 6, rating: 4.5, reviews: 264, daysAgo: 44,
    title: 'Conical Burr Coffee Grinder',
    description: 'Conical burr grinder with 40 grind settings, from espresso-fine to French-press coarse. Grinds straight into a static-free container.',
    tags: ['coffee', 'grinder', 'burr', 'espresso'],
  },
  {
    key: 'espresso-machine', seller: NW, category: 'kitchen', emoji: '☕', price: 349, stock: 5, rating: 4.4, reviews: 156, daysAgo: 21,
    title: 'Espresso Machine with Steam Wand',
    description: '15-bar pump espresso machine with a commercial-style steam wand for silky milk foam. Heats up in about 30 seconds and includes single and double baskets plus a tamper.',
    tags: ['espresso', 'coffee', 'machine', 'latte', 'steam wand'],
  },
  {
    key: 'cast-iron-skillet', seller: NW, category: 'kitchen', emoji: '🍳', price: 34, stock: 25, rating: 4.8, reviews: 1532, daysAgo: 60,
    title: 'Cast Iron Skillet, 10-inch',
    description: 'Pre-seasoned cast iron skillet that goes from stovetop to oven to campfire, and only gets better with use.',
    tags: ['skillet', 'cast iron', 'cooking', 'pre-seasoned', 'gift'],
  },
  {
    key: 'chef-knife', seller: NW, category: 'kitchen', emoji: '🔪', price: 79, stock: 2, rating: 4.7, reviews: 340, daysAgo: 36,
    title: "Chef's Knife, 8-inch",
    description: "High-carbon stainless steel chef's knife with a full tang and a comfortable pakkawood handle. Arrives sharp and holds its edge.",
    tags: ['knife', 'chef', 'stainless steel', 'cooking', 'gift'],
  },
  {
    key: 'travel-mug', seller: NW, category: 'kitchen', emoji: '🥤', price: 27, stock: 34, rating: 4.6, reviews: 612, daysAgo: 27,
    title: 'Insulated Travel Mug, 16 oz',
    description: 'Double-wall stainless steel travel mug with a leak-proof lid. Keeps coffee hot for about 6 hours and fits most car cup holders.',
    tags: ['mug', 'travel mug', 'coffee', 'insulated', 'leak-proof'],
  },
  {
    key: 'stoneware-mug', seller: PP, category: 'kitchen', emoji: '☕', price: 18, stock: 60, rating: 4.7, reviews: 418, daysAgo: 50,
    title: 'Hand-Thrown Stoneware Coffee Mug, 12 oz',
    description: 'Wheel-thrown stoneware mug with a speckled glaze and a comfortable handle. Microwave- and dishwasher-safe.',
    tags: ['mug', 'coffee', 'stoneware', 'handmade', 'gift'],
  },
  // ── home (Pixel & Pine) ─────────────────────────────────────────────────
  {
    key: 'soy-candle', seller: PP, category: 'home', emoji: '🕯️', price: 24, stock: 45, rating: 4.6, reviews: 233, daysAgo: 46,
    title: 'Soy Wax Candle, Cedar & Fig',
    description: 'Hand-poured soy wax candle with a cotton wick and notes of cedarwood, fig and a hint of smoke. About 50 hours of burn time.',
    tags: ['candle', 'soy', 'home fragrance', 'handmade', 'gift'],
  },
  {
    key: 'planter-set', seller: PP, category: 'home', emoji: '🪴', price: 38, stock: 18, rating: 4.5, reviews: 77, daysAgo: 38,
    title: 'Ceramic Planter Set (3 Sizes)',
    description: 'Three matte-glazed ceramic planters (4, 5 and 6 inch) with drainage holes and cork saucers. Each is glazed by hand, so colors vary slightly.',
    tags: ['planter', 'ceramic', 'plants', 'decor', 'handmade'],
  },
  {
    key: 'linen-throw', seller: PP, category: 'home', emoji: '🛋️', price: 64, stock: 12, rating: 4.8, reviews: 96, daysAgo: 29,
    title: 'Stonewashed Linen Throw Blanket',
    description: "Stonewashed linen throw (130 × 170 cm) that's soft from day one and gets softer with every wash. Finished with fringed edges.",
    tags: ['blanket', 'linen', 'throw', 'cozy', 'gift'],
  },
  // ── books (Northwind) ───────────────────────────────────────────────────
  {
    key: 'weeknight-cookbook', seller: NW, category: 'books', emoji: '📕', price: 28, stock: 20, rating: 4.6, reviews: 88, daysAgo: 43,
    title: 'The Weeknight Kitchen: 100 Fast Dinners (Hardcover)',
    description: 'A practical hardcover cookbook of 100 dinners that take 30 minutes or less, with shopping lists and make-ahead tips.',
    tags: ['cookbook', 'recipes', 'hardcover', 'cooking', 'gift'],
  },
  {
    key: 'night-sky-guide', seller: NW, category: 'books', emoji: '📘', price: 22, stock: 14, rating: 4.8, reviews: 61, daysAgo: 35,
    title: 'Field Guide to the Night Sky',
    description: 'Pocket field guide with seasonal star charts, constellation stories and tips for spotting planets with the naked eye or binoculars.',
    tags: ['astronomy', 'stars', 'field guide', 'paperback', 'gift'],
  },
  {
    key: 'focus-craft', seller: NW, category: 'books', emoji: '📗', price: 19, stock: 33, rating: 4.4, reviews: 152, daysAgo: 24,
    title: 'Focus Craft: Habits for Deep Work',
    description: 'A short, practical guide to protecting your attention: planning focus blocks, taming notifications and building routines that stick.',
    tags: ['productivity', 'habits', 'focus', 'paperback'],
  },
  // ── toys ────────────────────────────────────────────────────────────────
  {
    key: 'lighthouse-game', seller: NW, category: 'toys', emoji: '🎲', price: 36, stock: 5, rating: 4.6, reviews: 98, daysAgo: 32,
    title: 'Lighthouse Keepers Cooperative Board Game',
    description: 'Work together to keep the lights burning through a stormy season. A cooperative game for 1–4 players, ages 10+, about 45 minutes per game.',
    tags: ['board game', 'cooperative', 'family', 'strategy', 'gift'],
  },
  {
    key: 'marble-run', seller: PP, category: 'toys', emoji: '🎢', price: 54, stock: 8, rating: 4.7, reviews: 143, daysAgo: 40,
    title: 'Wooden Marble Run (60 Pieces)',
    description: 'Sixty beechwood pieces for building towers, chutes and spirals. Sanded smooth and finished with a child-safe oil; ages 4+.',
    tags: ['toy', 'wooden', 'marble run', 'kids', 'gift'],
  },
  {
    key: 'alpine-puzzle', seller: PP, category: 'toys', emoji: '🧩', price: 21, stock: 27, rating: 4.5, reviews: 210, daysAgo: 26,
    title: '1000-Piece Jigsaw Puzzle: Alpine Lake',
    description: 'A 1000-piece puzzle of an illustrated alpine lake at dusk, printed on thick recycled board with a linen finish.',
    tags: ['puzzle', 'jigsaw', '1000 pieces', 'family', 'gift'],
  },
  // ── outdoors (Northwind) ────────────────────────────────────────────────
  {
    key: 'camping-hammock', seller: NW, category: 'outdoors', emoji: '🏕️', price: 45, stock: 16, rating: 4.6, reviews: 377, daysAgo: 49,
    title: 'Ultralight Camping Hammock',
    description: 'Parachute-nylon hammock that packs down to the size of a grapefruit and holds up to 400 lb. Tree straps and carabiners included.',
    tags: ['hammock', 'camping', 'ultralight', 'travel', 'outdoor'],
  },
  {
    key: 'water-bottle', seller: NW, category: 'outdoors', emoji: '💧', price: 29, stock: 50, rating: 4.8, reviews: 2104, daysAgo: 57,
    title: 'Insulated Water Bottle, 32 oz',
    description: 'Vacuum-insulated stainless steel bottle that keeps drinks cold for 24 hours or hot for 12, with a powder-coated finish and a leak-proof chug cap.',
    tags: ['water bottle', 'insulated', 'hiking', 'stainless steel', 'gift'],
  },
  {
    key: 'led-headlamp', seller: NW, category: 'outdoors', emoji: '🔦', price: 24.99, stock: 0, rating: 4.5, reviews: 640, daysAgo: 45,
    title: 'Rechargeable LED Headlamp',
    description: '400-lumen headlamp with a red night mode, USB-C charging and a lightweight, sweat-resistant strap.',
    tags: ['headlamp', 'camping', 'hiking', 'rechargeable', 'led'],
  },
  // ── fashion ─────────────────────────────────────────────────────────────
  {
    key: 'merino-beanie', seller: NW, category: 'fashion', emoji: '🧶', price: 26, stock: 35, rating: 4.6, reviews: 190, daysAgo: 23,
    title: 'Merino Wool Beanie',
    description: 'Soft, itch-free merino wool beanie in a classic ribbed knit. Breathable enough for winter runs, warm enough for the bus stop.',
    tags: ['beanie', 'merino', 'wool', 'winter', 'hat', 'gift'],
  },
  {
    key: 'canvas-tote', seller: PP, category: 'fashion', emoji: '👜', price: 58, stock: 11, rating: 4.7, reviews: 122, daysAgo: 31,
    title: 'Waxed Canvas Tote Bag',
    description: 'Water-resistant waxed canvas tote with leather handles, an inside zip pocket and a magnetic snap. Sewn in small batches.',
    tags: ['tote', 'bag', 'canvas', 'everyday carry', 'handmade'],
  },
  {
    key: 'cactus-pin', seller: PP, category: 'fashion', emoji: '🌵', price: 8, stock: 120, rating: 4.9, reviews: 64, daysAgo: 18,
    title: 'Tiny Cactus Enamel Pin',
    description: 'A one-inch hard enamel pin with gold-tone edges and a rubber clutch back. Small, cheerful and easy to gift.',
    tags: ['pin', 'enamel', 'accessory', 'cactus', 'gift'],
  },
  // ── office ──────────────────────────────────────────────────────────────
  {
    key: 'wireless-mouse', seller: NW, category: 'office', emoji: '🖱️', price: 39, stock: 19, rating: 4.4, reviews: 511, daysAgo: 42,
    title: 'Ergonomic Wireless Mouse',
    description: 'Sculpted right-hand mouse with a thumb rest, quiet clicks and roughly 70 days of battery life. Connects over Bluetooth or the included USB receiver.',
    tags: ['mouse', 'wireless', 'ergonomic', 'bluetooth', 'office'],
  },
  {
    key: 'laptop-stand', seller: NW, category: 'office', emoji: '💻', price: 49, stock: 13, rating: 4.7, reviews: 689, daysAgo: 37,
    title: 'Adjustable Aluminum Laptop Stand',
    description: 'Raises your laptop screen to eye level with six height settings. Folds flat and fits 11–17 inch laptops.',
    tags: ['laptop stand', 'aluminum', 'ergonomic', 'desk', 'office'],
  },
  {
    key: 'desk-frame', seller: NW, category: 'office', emoji: '🖥️', price: 389, stock: 4, rating: 4.5, reviews: 97, daysAgo: 20,
    title: 'Electric Standing Desk Frame (Dual Motor)',
    description: 'Dual-motor electric desk frame with a 25–50 inch height range, three memory presets and anti-collision detection. Fits desktops from 48 to 72 inches wide (desktop not included).',
    tags: ['standing desk', 'electric', 'ergonomic', 'desk', 'office'],
  },
  {
    key: 'dot-notebook', seller: PP, category: 'office', emoji: '📓', price: 16, stock: 70, rating: 4.8, reviews: 905, daysAgo: 53,
    title: 'Dot Grid Notebook, A5 (2-Pack)',
    description: 'Two lay-flat A5 notebooks, each with 160 pages of 100 gsm dot-grid paper. Fountain-pen friendly with very little ghosting.',
    tags: ['notebook', 'dot grid', 'journal', 'stationery', 'gift'],
  },
];

interface SeedOrder {
  key: string;
  seller: string;
  status: OrderStatus;
  createdDaysAgo: number;
  createdHoursAgo?: number;
  updatedDaysAgo: number;
  items: { product: string; quantity: number }[];
}

const ORDERS: SeedOrder[] = [
  { key: 'seed-order-1', seller: NW, status: 'delivered', createdDaysAgo: 24, updatedDaysAgo: 19,
    items: [{ product: 'cast-iron-skillet', quantity: 1 }, { product: 'water-bottle', quantity: 1 }] },
  { key: 'seed-order-2', seller: PP, status: 'delivered', createdDaysAgo: 15, updatedDaysAgo: 11,
    items: [{ product: 'dot-notebook', quantity: 2 }] },
  { key: 'seed-order-3', seller: NW, status: 'shipped', createdDaysAgo: 4, updatedDaysAgo: 3,
    items: [{ product: 'anc-headphones', quantity: 1 }] },
  { key: 'seed-order-4', seller: NW, status: 'placed', createdDaysAgo: 0, createdHoursAgo: 20, updatedDaysAgo: 0,
    items: [{ product: 'gan-charger', quantity: 1 }, { product: 'merino-beanie', quantity: 1 }] },
];

export function seedProductId(key: string): string {
  return stableId('prod', key);
}

export function shippingFor(subtotalCents: number): number {
  return subtotalCents >= 3500 ? 0 : 599;
}

/** Inserts the demo users, catalog and order history. Idempotent: does nothing once users exist. */
export function seedDatabase(db: DatabaseSync): boolean {
  const existing = db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number } | undefined;
  if (existing && existing.n > 0) return false;

  const userCreated = daysAgoIso(90);
  db.exec('BEGIN');
  try {
    const insertUser = db.prepare('INSERT INTO users (id, name, role, api_token, created_at) VALUES (?, ?, ?, ?, ?)');
    insertUser.run(DEMO_BUYER_ID, 'Ada', 'buyer', DEMO_TOKENS.buyer, userCreated);
    insertUser.run(DEMO_SELLER_ID, 'Northwind Goods', 'seller', DEMO_TOKENS.seller, userCreated);
    insertUser.run(SECOND_SELLER_ID, 'Pixel & Pine', 'seller', null, userCreated);

    const insertProduct = db.prepare(
      `INSERT INTO products (id, seller_id, title, description, price_cents, currency, stock, category, tags, emoji,
                             rating, review_count, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'USD', ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
    );
    const byKey = new Map<string, SeedProduct>();
    for (const p of PRODUCTS) {
      byKey.set(p.key, p);
      const created = daysAgoIso(p.daysAgo);
      insertProduct.run(
        seedProductId(p.key), p.seller, p.title, p.description, dollarsToCents(p.price), p.stock, p.category,
        JSON.stringify(p.tags), p.emoji, p.rating, p.reviews, created, created,
      );
    }

    const insertOrder = db.prepare(
      `INSERT INTO orders (id, buyer_id, seller_id, status, subtotal_cents, shipping_cents, total_cents, shipping_address,
                           created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertItem = db.prepare(
      'INSERT INTO order_items (order_id, product_id, title, emoji, unit_price_cents, quantity) VALUES (?, ?, ?, ?, ?, ?)',
    );
    for (const o of ORDERS) {
      const id = stableId('ord', o.key);
      const lines = o.items.map((item) => {
        const p = byKey.get(item.product);
        if (!p) throw new Error(`seed order ${o.key} references unknown product ${item.product}`);
        return { p, quantity: item.quantity, unit: dollarsToCents(p.price) };
      });
      const subtotal = lines.reduce((sum, l) => sum + l.unit * l.quantity, 0);
      const shipping = shippingFor(subtotal);
      const created = daysAgoIso(o.createdDaysAgo, o.createdHoursAgo ?? 0);
      const updated = o.updatedDaysAgo === o.createdDaysAgo ? created : daysAgoIso(o.updatedDaysAgo, o.createdHoursAgo ?? 0);
      insertOrder.run(id, DEMO_BUYER_ID, o.seller, o.status, subtotal, shipping, subtotal + shipping, DEMO_ADDRESS, created, updated);
      for (const l of lines) insertItem.run(id, seedProductId(l.p.key), l.p.title, l.p.emoji, l.unit, l.quantity);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return true;
}
