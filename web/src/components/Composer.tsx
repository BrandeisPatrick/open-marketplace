import { clsx } from 'clsx';
import { ArrowUp, LoaderCircle } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

type Props = {
  onSend: (text: string) => void;
  /** True while the assistant is replying: no sending (and no typing) until it finishes. */
  disabled: boolean;
  placeholder: string;
  /** Compact follow-up chips above the input (the empty state shows the big ones). */
  suggestions?: string[];
};

const MAX_HEIGHT_PX = 168;

export function Composer({ onSend, disabled, placeholder, suggestions = [] }: Props) {
  const [text, setText] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  const wasDisabled = useRef(disabled);

  // Auto-grow the textarea with its content.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT_PX)}px`;
  }, [text]);

  // When a reply finishes, put the caret back (desktop only, and only if focus is free).
  useEffect(() => {
    if (wasDisabled.current && !disabled) {
      const el = ref.current;
      const free = !document.activeElement || document.activeElement === document.body;
      if (el && free && window.matchMedia('(pointer: fine)').matches) el.focus({ preventScroll: true });
    }
    wasDisabled.current = disabled;
  }, [disabled]);

  const submit = (value: string) => {
    const message = value.trim();
    if (!message || disabled) return;
    onSend(message);
    setText('');
  };

  return (
    <div className="border-t border-stone-900/[0.06] px-3 pt-2.5 pb-3 dark:border-white/[0.06]">
      {suggestions.length > 0 && (
        <div className="no-scrollbar -mx-3 mb-2 flex gap-1.5 overflow-x-auto px-3">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              disabled={disabled}
              onClick={() => {
                setText(s);
                submit(s);
              }}
              className="glass-pill shrink-0 px-2.5 py-1 text-xs text-stone-600 transition hover:border-accent/40 hover:text-stone-900 disabled:cursor-not-allowed disabled:opacity-50 dark:text-stone-300 dark:hover:text-white"
            >
              {s}
            </button>
          ))}
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(text);
        }}
        className={clsx(
          'glass flex items-end gap-2 rounded-2xl py-1.5 pr-1.5 pl-3.5 transition',
          'focus-within:border-accent/50 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent/25',
          disabled && 'opacity-80',
        )}
      >
        <textarea
          ref={ref}
          rows={1}
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit(text);
            }
          }}
          placeholder={disabled ? 'Assistant is replying…' : placeholder}
          aria-label="Message"
          className="min-h-6 flex-1 resize-none bg-transparent py-1.5 text-[15px] leading-6 text-stone-900 outline-none placeholder:text-stone-400 focus-visible:outline-none disabled:cursor-not-allowed dark:text-stone-100 dark:placeholder:text-stone-500"
        />
        <button
          type="submit"
          disabled={disabled || !text.trim()}
          aria-label="Send message"
          className="btn-ink grid size-9 shrink-0 place-items-center rounded-xl disabled:cursor-not-allowed disabled:opacity-35"
        >
          {disabled ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <ArrowUp className="size-4" aria-hidden />}
        </button>
      </form>
      <p className="mt-1.5 hidden px-1 text-[11px] text-stone-400 sm:block dark:text-stone-500">
        Enter to send · Shift + Enter for a new line
      </p>
    </div>
  );
}
