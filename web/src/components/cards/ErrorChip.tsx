import { CircleAlert } from 'lucide-react';

/** High-contrast ink chip for failed tool results and failed turns. */
export function ErrorChip({ message, title }: { message: string; title?: string }) {
  return (
    <div
      role="alert"
      className="inline-flex max-w-full items-start gap-2 self-start rounded-xl bg-stone-900 px-3 py-2 text-sm text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_6px_16px_-8px_rgba(0,0,0,0.45)] dark:bg-stone-50 dark:text-stone-950"
    >
      <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span className="min-w-0 break-words">
        {title && <span className="font-medium">{title}: </span>}
        {message}
      </span>
    </div>
  );
}
