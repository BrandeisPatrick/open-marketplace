import { CircleAlert } from 'lucide-react';

/** Small red chip for failed tool results and failed turns. */
export function ErrorChip({ message, title }: { message: string; title?: string }) {
  return (
    <div
      role="alert"
      className="inline-flex max-w-full items-start gap-2 self-start rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-600/15 ring-inset dark:bg-red-500/10 dark:text-red-300 dark:ring-red-400/20"
    >
      <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span className="min-w-0 break-words">
        {title && <span className="font-medium">{title}: </span>}
        {message}
      </span>
    </div>
  );
}
