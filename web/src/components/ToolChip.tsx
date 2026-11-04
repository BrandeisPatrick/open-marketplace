import { clsx } from 'clsx';
import { Check, ChevronDown, CircleSlash, LoaderCircle, X } from 'lucide-react';
import { memo, useState } from 'react';
import { isDict } from '../lib/guards';
import { toolLabel, type ToolState } from '../lib/toolLabels';

const STYLES: Record<ToolState, string> = {
  pending: 'border-accent/25 bg-accent-soft text-accent-text',
  done: 'border-line bg-surface text-stone-600 dark:text-stone-300',
  error: 'border-red-200 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300',
  stopped: 'border-line bg-surface text-stone-400',
};

function StateIcon({ state }: { state: ToolState }) {
  switch (state) {
    case 'pending':
      return <LoaderCircle className="size-3.5 shrink-0 animate-spin" aria-hidden />;
    case 'done':
      return <Check className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />;
    case 'error':
      return <X className="size-3.5 shrink-0" aria-hidden />;
    case 'stopped':
      return <CircleSlash className="size-3.5 shrink-0" aria-hidden />;
  }
}

type Props = { name: string; input: unknown; state: ToolState; result?: unknown };

/**
 * One tool call: "Searching products…" with a spinner, then "Found 5 products".
 * Click to reveal the arguments the assistant passed.
 */
export const ToolChip = memo(function ToolChip({ name, input, state, result }: Props) {
  const [open, setOpen] = useState(false);
  const hasInput = input !== undefined && input !== null && !(isDict(input) && Object.keys(input).length === 0);
  const label = toolLabel(name, state, result);

  return (
    <div className="flex animate-rise flex-col items-start">
      <button
        type="button"
        onClick={() => hasInput && setOpen((v) => !v)}
        aria-expanded={hasInput ? open : undefined}
        title={hasInput ? `${name} — show arguments` : name}
        className={clsx(
          'inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition',
          STYLES[state],
          hasInput ? 'hover:brightness-[0.98]' : 'cursor-default',
        )}
      >
        <StateIcon state={state} />
        <span className="truncate">{label}</span>
        {hasInput && <ChevronDown className={clsx('size-3 shrink-0 opacity-50 transition', open && 'rotate-180')} aria-hidden />}
      </button>
      {open && hasInput && (
        <pre className="mt-1.5 max-h-56 w-full overflow-auto rounded-xl border border-line bg-surface p-3 font-mono text-[11.5px] leading-relaxed text-stone-600 scroll-thin dark:text-stone-300">
          <span className="text-stone-400">{name}</span>
          {' '}
          {safeJson(input)}
        </pre>
      )}
    </div>
  );
});

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}
