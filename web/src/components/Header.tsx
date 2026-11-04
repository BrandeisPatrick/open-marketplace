import { clsx } from 'clsx';
import { Activity, Bot, Check, Copy, Plug, ShoppingBag } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Health } from '../types';

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for browsers/contexts without the async clipboard API.
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/** [key of the thing just copied, copy(text, key)] — the key resets after a moment. */
function useCopy(): [string | null, (text: string, key: string) => void] {
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = useCallback((text: string, key: string) => {
    void copyText(text).then((ok) => {
      if (!ok) return;
      setCopied(key);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(null), 1600);
    });
  }, []);
  return [copied, copy];
}

const PILL_TONES = {
  green: 'bg-emerald-50 text-emerald-800 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-200 dark:ring-emerald-400/25',
  amber: 'bg-amber-50 text-amber-900 ring-amber-600/25 dark:bg-amber-500/10 dark:text-amber-200 dark:ring-amber-400/25',
  red: 'bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-400/25',
  gray: 'bg-surface text-stone-500 ring-line dark:text-stone-400',
} as const;

const DOT_TONES = {
  green: 'bg-emerald-500',
  amber: 'bg-amber-500',
  red: 'bg-red-500',
  gray: 'bg-stone-400 animate-pulse',
} as const;

function AiPill({ health, error }: { health: Health | null; error: string | null }) {
  let tone: keyof typeof PILL_TONES;
  let label: string;
  let short: string;
  let title: string | undefined;
  if (!health && error) {
    tone = 'red';
    label = 'Server unreachable';
    short = 'No server';
    title = error;
  } else if (!health) {
    tone = 'gray';
    label = 'Connecting…';
    short = '…';
  } else if (health.ai.enabled) {
    tone = 'green';
    label = `Claude · ${health.ai.model} · ${health.ai.effort}`;
    short = 'Claude';
  } else {
    tone = 'amber';
    label = 'Offline mode — add ANTHROPIC_API_KEY to .env';
    short = 'Offline mode';
  }
  return (
    <span
      title={title ?? label}
      className={clsx('inline-flex h-8 min-w-0 items-center gap-1.5 rounded-full px-3 text-xs font-medium ring-1 ring-inset', PILL_TONES[tone])}
    >
      <span className={clsx('size-2 shrink-0 rounded-full', DOT_TONES[tone])} aria-hidden />
      <span className="hidden truncate lg:inline">{label}</span>
      <span className="truncate lg:hidden">{short}</span>
    </span>
  );
}

function CommandBlock({ label, command, copied, onCopy }: { label: string; command: string; copied: boolean; onCopy: () => void }) {
  return (
    <div className="mt-3">
      <div className="mb-1 text-xs font-medium text-stone-600 dark:text-stone-300">{label}</div>
      <div className="flex items-start gap-2 rounded-xl bg-stone-900 py-2 pr-2 pl-3 dark:bg-black/40">
        <code className="min-w-0 flex-1 font-mono text-[11.5px] leading-relaxed break-all whitespace-pre-wrap text-stone-100">
          {command}
        </code>
        <button
          type="button"
          onClick={onCopy}
          aria-label={`Copy command: ${label}`}
          className="grid size-7 shrink-0 place-items-center rounded-lg text-stone-400 transition hover:bg-white/10 hover:text-white"
        >
          {copied ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
        </button>
      </div>
    </div>
  );
}

function McpPill({ health }: { health: Health | null }) {
  const [open, setOpen] = useState(false);
  const [copied, copy] = useCopy();
  const ref = useRef<HTMLDivElement>(null);

  const url = health?.mcp.url ?? `${window.location.origin}/mcp`;
  const tokens = health?.mcp.tokens ?? { buyer: 'mk_buyer_demo', seller: 'mk_seller_demo' };
  const buyerName = health?.actors.buyer.name ?? 'Ada';
  const sellerName = health?.actors.seller.name ?? 'Northwind Goods';
  const buyerCmd = `claude mcp add --transport http marketplace ${url} --header "Authorization: Bearer ${tokens.buyer}"`;
  const sellerCmd = `claude mcp add --transport http marketplace-seller ${url} --header "Authorization: Bearer ${tokens.seller}"`;

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <div className="inline-flex h-8 items-center rounded-full bg-surface shadow-sm ring-1 ring-line ring-inset">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-haspopup="dialog"
          title="Connect an external agent over MCP"
          className="inline-flex h-full items-center gap-1.5 rounded-full pr-3 pl-3 text-xs font-medium text-stone-700 transition hover:text-stone-950 sm:rounded-r-none sm:pr-2 dark:text-stone-200 dark:hover:text-white"
        >
          <Plug className="size-3.5 text-mcp" aria-hidden />
          <span className="font-semibold">MCP</span>
          <span className="hidden max-w-56 truncate font-mono text-[11px] text-stone-500 lg:inline dark:text-stone-400">{url}</span>
        </button>
        <button
          type="button"
          onClick={() => copy(url, 'url')}
          aria-label="Copy MCP endpoint URL"
          title="Copy endpoint URL"
          className="hidden h-full place-items-center rounded-r-full border-l border-line pr-2.5 pl-2 text-stone-400 transition hover:text-stone-700 sm:grid dark:hover:text-stone-200"
        >
          {copied === 'url' ? <Check className="size-3.5 text-emerald-600" /> : <Copy className="size-3.5" />}
        </button>
      </div>

      {open && (
        <div
          role="dialog"
          aria-label="Connect an external agent"
          className="fixed inset-x-4 top-16 z-50 animate-rise rounded-2xl border border-line bg-surface p-4 shadow-xl sm:absolute sm:inset-x-auto sm:top-full sm:right-0 sm:mt-2 sm:w-[30rem]"
        >
          <h3 className="flex items-center gap-2 text-sm font-semibold text-stone-900 dark:text-stone-50">
            <Bot className="size-4 text-mcp" aria-hidden />
            Connect an external agent
          </h3>
          <p className="mt-1 text-[13px] leading-relaxed text-stone-500 dark:text-stone-400">
            Every marketplace action is an MCP tool. Point Claude Code (or any MCP client) at this endpoint — whatever the
            agent does shows up live in the activity feed and in both windows.
          </p>
          <CommandBlock
            label={`As the buyer (${buyerName})`}
            command={buyerCmd}
            copied={copied === 'buyer'}
            onCopy={() => copy(buyerCmd, 'buyer')}
          />
          <CommandBlock
            label={`As the seller (${sellerName})`}
            command={sellerCmd}
            copied={copied === 'seller'}
            onCopy={() => copy(sellerCmd, 'seller')}
          />
          <p className="mt-3 text-xs leading-relaxed text-stone-500 dark:text-stone-400">
            Streamable HTTP at <code className="font-mono">{url}</code>. Without a token the agent acts as the demo buyer.
          </p>
        </div>
      )}
    </div>
  );
}

type Props = {
  health: Health | null;
  healthError: string | null;
  activityOpen: boolean;
  onToggleActivity: () => void;
  unread: number;
};

export function Header({ health, healthError, activityOpen, onToggleActivity, unread }: Props) {
  return (
    <header className="flex shrink-0 items-center gap-2 px-4 py-3 sm:gap-3 md:px-5">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-linear-to-br from-buyer via-mcp to-seller text-white shadow-sm">
          <ShoppingBag className="size-[18px]" aria-hidden />
        </span>
        <div className="min-w-0">
          <h1 className="truncate text-[15px] leading-tight font-semibold text-stone-900 dark:text-stone-50">AI Marketplace</h1>
          <p className="truncate text-xs text-stone-500 dark:text-stone-400">chat-first · agent-ready</p>
        </div>
      </div>
      <div className="ml-auto flex min-w-0 items-center gap-1.5 sm:gap-2">
        <AiPill health={health} error={healthError} />
        <McpPill health={health} />
        <button
          type="button"
          onClick={onToggleActivity}
          aria-pressed={activityOpen}
          title={activityOpen ? 'Hide activity' : 'Show activity'}
          className={clsx(
            'relative hidden h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-medium ring-1 ring-inset transition md:inline-flex',
            activityOpen
              ? 'bg-stone-900 text-white ring-stone-900 dark:bg-stone-100 dark:text-stone-900 dark:ring-stone-100'
              : 'bg-surface text-stone-600 shadow-sm ring-line hover:text-stone-900 dark:text-stone-300 dark:hover:text-white',
          )}
        >
          <Activity className="size-3.5" aria-hidden />
          Activity
          {unread > 0 && (
            <span className="grid h-[18px] min-w-[18px] place-items-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white tabular-nums">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </button>
      </div>
    </header>
  );
}
