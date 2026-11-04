import { ArrowDown } from 'lucide-react';
import { Component, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { capitalize, errorText } from '../lib/format';
import { asDict, asList, asNumber, asObject, asString } from '../lib/guards';
import type { ToolState } from '../lib/toolLabels';
import type {
  Cart,
  Category,
  ChatItem,
  Order,
  ProductDetail as ProductDetailData,
  ProductSummary,
  Role,
  SellerStats,
  ToolResultItem,
} from '../types';
import { CartCard } from './cards/CartCard';
import { CategoryChips } from './cards/CategoryChips';
import { ErrorChip } from './cards/ErrorChip';
import { OrderList } from './cards/OrderCard';
import { ProductDetail } from './cards/ProductDetail';
import { ProductGrid } from './cards/ProductGrid';
import { StatsCard } from './cards/StatsCard';
import { Markdown } from './Markdown';
import { ToolChip } from './ToolChip';

type Send = (text: string) => void;

// ── Result → card (CONTRACT §9) ─────────────────────────────────────────────

function renderCard(item: ToolResultItem, role: Role, send: Send, busy: boolean): ReactNode {
  if (!item.ok) return <ErrorChip message={errorText(item.result)} />;
  const r = asDict(item.result);
  const addToCart =
    role === 'buyer' ? (p: ProductSummary) => send(`Add “${p.title}” (${p.id}) to my cart`) : undefined;
  const ship = role === 'seller' ? (o: Order) => send(`Mark order ${o.id} as shipped`) : undefined;

  switch (item.name) {
    case 'search_products':
    case 'list_my_listings': {
      const products = asList<ProductSummary>(r.products);
      if (!products) return null;
      const mine = item.name === 'list_my_listings';
      return (
        <ProductGrid
          products={products}
          total={asNumber(r.total)}
          query={asString(r.query)}
          onAdd={mine ? undefined : addToCart}
          exactStock={mine}
          busy={busy}
        />
      );
    }
    case 'get_product':
    case 'create_listing':
    case 'update_listing': {
      const product = asObject<ProductDetailData>(r.product);
      if (!product) return null;
      const badge = item.name === 'create_listing' ? 'new' : item.name === 'update_listing' ? 'updated' : undefined;
      return <ProductDetail product={product} badge={badge} onAdd={item.name === 'get_product' ? addToCart : undefined} busy={busy} />;
    }
    case 'add_to_cart':
    case 'remove_from_cart':
    case 'view_cart': {
      const cart = asObject<Cart>(r.cart);
      if (!cart) return null;
      const added = asObject<{ product: ProductSummary; quantity: number }>(r.added) ?? undefined;
      return (
        <CartCard
          cart={cart}
          added={item.name === 'add_to_cart' ? added : undefined}
          onCheckout={role === 'buyer' ? () => send('Check out my cart') : undefined}
          busy={busy}
        />
      );
    }
    case 'checkout':
    case 'list_orders':
    case 'get_order':
    case 'cancel_order':
    case 'get_seller_orders':
    case 'update_order_status': {
      const single = asObject<Order>(r.order);
      const orders = asList<Order>(r.orders) ?? (single ? [single] : null);
      if (!orders) return null;
      return (
        <OrderList
          orders={orders}
          perspective={role}
          onShip={ship}
          busy={busy}
          emptyText={item.name === 'get_seller_orders' ? 'No matching orders.' : 'No orders yet.'}
        />
      );
    }
    case 'seller_stats': {
      const stats = asObject<SellerStats>(r.stats);
      return stats ? <StatsCard stats={stats} onShip={ship} busy={busy} /> : null;
    }
    case 'list_categories': {
      const categories = asList<Category>(r.categories);
      if (!categories) return null;
      return (
        <CategoryChips
          categories={categories}
          onPick={role === 'buyer' ? (name) => send(`Show me ${name} products`) : undefined}
          busy={busy}
        />
      );
    }
    default:
      return null; // unknown tool: the chip alone is enough
  }
}

/** A card that throws (unexpected result shape) degrades to a chip instead of blanking the app. */
class CardBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.error('[transcript] card failed to render', error);
  }
  render() {
    return this.state.failed ? <ErrorChip message="Couldn’t display this result." /> : this.props.children;
  }
}

type ResultProps = { item: ToolResultItem; role: Role; send: Send; busy: boolean; orphan: boolean };

const ResultBlock = memo(function ResultBlock({ item, role, send, busy, orphan }: ResultProps) {
  const card = renderCard(item, role, send, busy);
  if (!card && !orphan) return null;
  return (
    <div className="flex animate-rise flex-col gap-2">
      {/* A result whose call we never saw (e.g. trimmed history) still gets its chip. */}
      {orphan && <ToolChip name={item.name} input={undefined} state={item.ok ? 'done' : 'error'} result={item.result} />}
      {card && <CardBoundary>{card}</CardBoundary>}
    </div>
  );
});

// ── Bubbles ─────────────────────────────────────────────────────────────────

const UserBubble = memo(function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex animate-rise justify-end pl-8">
      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-accent px-3.5 py-2 text-[15px] leading-relaxed break-words whitespace-pre-wrap text-accent-fg shadow-sm">
        {text}
      </div>
    </div>
  );
});

const AssistantText = memo(function AssistantText({ text }: { text: string }) {
  return (
    <div className="pr-4">
      <Markdown text={text} />
    </div>
  );
});

function Thinking({ status }: { status: string | null }) {
  const label = status ? capitalize(status.trim()).replace(/[.…]*$/, '…') : null;
  return (
    <div className="flex animate-rise items-center gap-2" role="status" aria-label={label ?? 'Assistant is thinking'}>
      <span className="inline-flex items-center gap-1 rounded-full bg-surface px-3 py-2 shadow-sm ring-1 ring-line">
        {[0, 1, 2].map((i) => (
          <span key={i} className="size-1.5 animate-typing rounded-full bg-accent" style={{ animationDelay: `${i * 0.16}s` }} />
        ))}
      </span>
      {label && <span className="text-xs text-stone-500 dark:text-stone-400">{label}</span>}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="space-y-3" aria-label="Loading conversation">
      <div className="ml-auto h-9 w-2/5 animate-pulse rounded-2xl bg-stone-200/70 dark:bg-stone-800" />
      <div className="h-16 w-4/5 animate-pulse rounded-2xl bg-stone-200/50 dark:bg-stone-800/70" />
    </div>
  );
}

// ── Transcript ──────────────────────────────────────────────────────────────

type Props = {
  role: Role;
  items: ChatItem[];
  streaming: boolean;
  status: string | null;
  loaded: boolean;
  onSend: Send;
  /** Rendered when there is no history (welcome + suggestions). */
  empty: ReactNode;
};

const NEAR_BOTTOM_PX = 48;

export function Transcript({ role, items, streaming, status, loaded, onSend, empty }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true); // follow new content unless the user scrolled up
  const lastTop = useRef(0);
  const [showJump, setShowJump] = useState(false);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.clientHeight - el.scrollTop;
    // Smooth for incremental growth; jump for big leaps (initial history load, tab switch).
    el.scrollTo({ top: el.scrollHeight, behavior: distance > el.clientHeight * 1.5 ? 'auto' : 'smooth' });
  }, []);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const gap = el.scrollHeight - el.clientHeight - el.scrollTop;
    if (gap < NEAR_BOTTOM_PX) pinned.current = true;
    else if (el.scrollTop < lastTop.current - 2) pinned.current = false; // moved up = user intent
    lastTop.current = el.scrollTop;
    setShowJump(!pinned.current && gap > 160);
  };

  // Follow any growth of the content (streamed text, cards, thinking dots) while pinned.
  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const observer = new ResizeObserver(() => {
      if (pinned.current) scrollToBottom();
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [scrollToBottom]);

  // Sending a message always re-pins to the bottom.
  const userCount = useMemo(() => items.reduce((n, it) => (it.kind === 'user' ? n + 1 : n), 0), [items]);
  useLayoutEffect(() => {
    pinned.current = true;
    setShowJump(false);
    scrollToBottom();
  }, [userCount, scrollToBottom]);

  const { results, calls } = useMemo(() => {
    const results = new Map<string, ToolResultItem>();
    const calls = new Set<string>();
    for (const it of items) {
      if (it.kind === 'tool_result') results.set(it.id, it);
      else if (it.kind === 'tool_call') calls.add(it.id);
    }
    return { results, calls };
  }, [items]);

  const last = items[items.length - 1];
  // Dots between send and first content, and while the model digests a tool result.
  const thinking = streaming && (!last || last.kind === 'user' || last.kind === 'tool_result');

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="h-full overflow-x-hidden overflow-y-auto overscroll-contain scroll-thin"
        role="log"
        aria-live="polite"
        aria-busy={streaming}
      >
        <div ref={contentRef} className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 py-5">
          {!loaded && items.length === 0 && <Skeleton />}
          {loaded && items.length === 0 && !streaming && empty}
          {items.map((item, i) => {
            switch (item.kind) {
              case 'user':
                return <UserBubble key={i} text={item.text} />;
              case 'assistant_text':
                return <AssistantText key={i} text={item.text} />;
              case 'tool_call': {
                const result = results.get(item.id);
                const state: ToolState = result ? (result.ok ? 'done' : 'error') : streaming ? 'pending' : 'stopped';
                return <ToolChip key={i} name={item.name} input={item.input} state={state} result={result?.result} />;
              }
              case 'tool_result':
                return (
                  <ResultBlock key={i} item={item} role={role} send={onSend} busy={streaming} orphan={!calls.has(item.id)} />
                );
              case 'error':
                return <ErrorChip key={i} message={item.message} />;
              default:
                return null;
            }
          })}
          {thinking && <Thinking status={status} />}
        </div>
      </div>
      {showJump && (
        <button
          type="button"
          onClick={() => {
            pinned.current = true;
            setShowJump(false);
            scrollToBottom();
          }}
          className="absolute bottom-3 left-1/2 inline-flex -translate-x-1/2 animate-rise items-center gap-1 rounded-full border border-line bg-surface/95 px-3 py-1 text-xs font-medium text-stone-600 shadow-md backdrop-blur dark:text-stone-300"
        >
          <ArrowDown className="size-3.5" aria-hidden />
          Latest
        </button>
      )}
    </div>
  );
}
