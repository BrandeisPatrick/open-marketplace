import { clsx } from 'clsx';
import { PanelRightClose, PanelRightOpen, RotateCcw, ShoppingBag, ShoppingCart, Sparkles, Store, type LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useId, useState } from 'react';
import { useChat } from '../hooks/useChat';
import { useMediaQuery } from '../hooks/useMediaQuery';
import type { Actor, Role } from '../types';
import { ErrorChip } from './cards/ErrorChip';
import { Composer } from './Composer';
import { BuyerPanel } from './panels/BuyerPanel';
import { SellerPanel } from './panels/SellerPanel';
import { Transcript } from './Transcript';

export type Accent = 'indigo' | 'amber';

type Persona = {
  roleLabel: string;
  subtitle: string;
  Icon: LucideIcon;
  panelLabel: string;
  PanelIcon: LucideIcon;
  placeholder: string;
  suggestions: string[];
  welcome: (name: string) => { title: string; body: string };
};

const PERSONAS: Record<Role, Persona> = {
  buyer: {
    roleLabel: 'Buyer',
    subtitle: 'Shopping assistant',
    Icon: ShoppingBag,
    panelLabel: 'Cart',
    PanelIcon: ShoppingCart,
    placeholder: 'Ask for anything — “a gift under $50 for a coffee lover”',
    suggestions: [
      'Find a gift under $50 for a coffee lover',
      'Show me mechanical keyboards',
      "What's in my cart?",
      'Where are my orders?',
    ],
    welcome: (name) => ({
      title: `Hi ${name}, what are you shopping for?`,
      body: 'I can search the catalogue, compare options, manage your cart, check out and track your orders.',
    }),
  },
  seller: {
    roleLabel: 'Seller',
    subtitle: 'Store operations assistant',
    Icon: Store,
    panelLabel: 'Store',
    PanelIcon: Store,
    placeholder: 'Run your store — “which orders need shipping?”',
    suggestions: [
      'What sold recently?',
      'Which orders need shipping?',
      'List a new product: handmade ceramic mug, $24, 15 in stock',
      'Which listings are low on stock?',
    ],
    welcome: (name) => ({
      title: `Welcome back, ${name}.`,
      body: 'I can publish and edit listings, restock, ship orders and sum up how the store is doing.',
    }),
  },
};

function EmptyState({
  persona,
  name,
  error,
  disabled,
  onPick,
}: {
  persona: Persona;
  name: string;
  error: string | null;
  disabled: boolean;
  onPick: (text: string) => void;
}) {
  const { title, body } = persona.welcome(name);
  return (
    <div className="@container flex animate-rise flex-col items-center py-6 text-center">
      {error && (
        <div className="mb-4 flex justify-center">
          <ErrorChip message={error} />
        </div>
      )}
      <div className="grid size-12 place-items-center rounded-2xl bg-accent-soft text-accent-text">
        <Sparkles className="size-6" aria-hidden />
      </div>
      <h3 className="mt-3 text-base font-semibold text-balance text-stone-900 dark:text-stone-50">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-balance text-stone-500 dark:text-stone-400">{body}</p>
      <div className="mt-5 grid w-full max-w-md gap-2 @sm:grid-cols-2">
        {persona.suggestions.map((s) => (
          <button
            key={s}
            type="button"
            disabled={disabled}
            onClick={() => onPick(s)}
            className="rounded-xl border border-line bg-surface px-3 py-2.5 text-left text-sm text-stone-700 shadow-sm transition hover:-translate-y-px hover:border-accent hover:text-stone-900 hover:shadow-md disabled:opacity-50 dark:text-stone-200 dark:hover:text-white"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

type Props = {
  role: Role;
  actor: Actor;
  accent: Accent;
  /** Mobile tabs hide the inactive window but keep it mounted (its stream keeps going). */
  hidden?: boolean;
};

/** One persona's chat: header, transcript with rich cards, composer, and a collapsible side panel. */
export function ChatWindow({ role, actor, accent, hidden = false }: Props) {
  const { items, streaming, status, error, loaded, turns, send: sendMessage, reset } = useChat(role);
  const persona = PERSONAS[role];
  const panelId = useId();

  // ≥1024px: the panel is a column inside the window, open by default.
  // Narrower: it's an overlay drawer, closed by default.
  const isWide = useMediaQuery('(min-width: 1024px)');
  const [panelOpen, setPanelOpen] = useState(isWide);
  useEffect(() => setPanelOpen(isWide), [isWide]);
  const overlay = panelOpen && !isWide;

  useEffect(() => {
    if (!overlay) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPanelOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [overlay]);

  const send = useCallback((text: string) => void sendMessage(text), [sendMessage]);
  const closePanel = useCallback(() => setPanelOpen(false), []);

  const panelProps = { refreshKey: turns, onSend: send, busy: streaming, onClose: overlay ? closePanel : undefined };
  const PanelToggleIcon = isWide ? (panelOpen ? PanelRightClose : PanelRightOpen) : persona.PanelIcon;

  return (
    <section
      data-accent={accent}
      aria-label={`${persona.roleLabel} window — ${actor.name}`}
      className={clsx(
        'relative min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_1px_3px_rgb(28_25_23/0.05),0_12px_32px_-18px_rgb(28_25_23/0.18)] dark:shadow-none',
        hidden ? 'hidden' : 'flex',
      )}
    >
      <div className="h-[3px] shrink-0 bg-accent" aria-hidden />
      <header className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-3">
        <div className="relative shrink-0">
          <div className="grid size-10 place-items-center rounded-full bg-accent text-[15px] font-semibold text-accent-fg shadow-sm">
            {(actor.name || '?').trim().charAt(0).toUpperCase()}
          </div>
          <span className="absolute -right-1 -bottom-1 grid size-5 place-items-center rounded-full bg-surface ring-2 ring-surface">
            <persona.Icon className="size-3 text-accent-text" aria-hidden />
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="truncate text-[15px] leading-tight font-semibold text-stone-900 dark:text-stone-50">{actor.name}</h2>
            <span className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent-text">
              {persona.roleLabel}
            </span>
          </div>
          <p className="mt-0.5 truncate text-xs text-stone-500 dark:text-stone-400">
            {persona.subtitle}
            {streaming && <span className="text-accent-text"> · replying…</span>}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => setPanelOpen((v) => !v)}
            aria-expanded={panelOpen}
            aria-controls={panelId}
            title={panelOpen ? `Hide ${persona.panelLabel.toLowerCase()} panel` : `Show ${persona.panelLabel.toLowerCase()} panel`}
            className={clsx(
              'inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-medium transition',
              panelOpen
                ? 'bg-accent-soft text-accent-text'
                : 'text-stone-500 hover:bg-stone-100 hover:text-stone-800 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100',
            )}
          >
            <PanelToggleIcon className="size-4" aria-hidden />
            <span className="hidden sm:inline">{persona.panelLabel}</span>
          </button>
          <button
            type="button"
            onClick={() => void reset()}
            disabled={items.length === 0 && !streaming}
            aria-label="Start a new conversation"
            title="New conversation (clears history)"
            className="grid size-8 place-items-center rounded-lg text-stone-500 transition hover:bg-stone-100 hover:text-stone-800 disabled:cursor-not-allowed disabled:opacity-35 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
          >
            <RotateCcw className="size-4" aria-hidden />
          </button>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col bg-sunken">
          <Transcript
            role={role}
            items={items}
            streaming={streaming}
            status={status}
            loaded={loaded}
            onSend={send}
            empty={<EmptyState persona={persona} name={actor.name} error={error} disabled={streaming} onPick={send} />}
          />
          <Composer
            onSend={send}
            disabled={streaming}
            placeholder={persona.placeholder}
            suggestions={items.length > 0 ? persona.suggestions : undefined}
          />
        </div>

        {overlay && (
          <div className="absolute inset-0 z-10 animate-rise bg-stone-950/25 backdrop-blur-[1px]" onClick={closePanel} aria-hidden />
        )}
        <aside
          id={panelId}
          aria-label={`${persona.panelLabel} panel`}
          className={clsx(
            'overflow-y-auto overscroll-contain bg-surface scroll-thin',
            !panelOpen && 'hidden',
            panelOpen && isWide && 'w-56 shrink-0 border-l border-line xl:w-64 2xl:w-72',
            overlay && 'absolute inset-y-0 right-0 z-20 w-[min(20rem,88%)] animate-slide-in border-l border-line shadow-2xl',
          )}
        >
          {role === 'buyer' ? <BuyerPanel {...panelProps} /> : <SellerPanel {...panelProps} />}
        </aside>
      </div>
    </section>
  );
}
