import { memo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

// react-markdown passes the hast `node` to every override; keep it off the DOM.
const components: Components = {
  p: ({ node, ...props }) => <p className="my-2 first:mt-0 last:mb-0" {...props} />,
  a: ({ node, ...props }) => (
    <a
      {...props}
      target="_blank"
      rel="noreferrer noopener"
      className="font-medium text-accent-text underline decoration-current/30 underline-offset-2 transition hover:decoration-current"
    />
  ),
  ul: ({ node, ...props }) => <ul className="my-2 list-disc space-y-1 pl-5 marker:text-stone-400" {...props} />,
  ol: ({ node, ...props }) => <ol className="my-2 list-decimal space-y-1 pl-5 marker:text-stone-400" {...props} />,
  li: ({ node, ...props }) => <li className="pl-0.5" {...props} />,
  strong: ({ node, ...props }) => <strong className="font-semibold text-stone-900 dark:text-stone-50" {...props} />,
  em: ({ node, ...props }) => <em className="italic" {...props} />,
  code: ({ node, ...props }) => (
    <code
      className="rounded-md bg-stone-100 px-1.5 py-0.5 font-mono text-[0.85em] text-stone-800 dark:bg-stone-800 dark:text-stone-200"
      {...props}
    />
  ),
  pre: ({ node, ...props }) => (
    <pre
      className="my-3 overflow-x-auto rounded-xl bg-stone-900 p-3 font-mono text-[13px] leading-relaxed text-stone-100 dark:bg-black/40 [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-inherit"
      {...props}
    />
  ),
  h1: ({ node, ...props }) => <h3 className="mt-3 mb-1.5 text-base font-semibold first:mt-0" {...props} />,
  h2: ({ node, ...props }) => <h3 className="mt-3 mb-1.5 text-[15px] font-semibold first:mt-0" {...props} />,
  h3: ({ node, ...props }) => <h4 className="mt-3 mb-1 text-[15px] font-semibold first:mt-0" {...props} />,
  h4: ({ node, ...props }) => <h5 className="mt-2 mb-1 font-semibold first:mt-0" {...props} />,
  blockquote: ({ node, ...props }) => (
    <blockquote className="my-2 border-l-2 border-line pl-3 text-stone-600 dark:text-stone-300" {...props} />
  ),
  hr: () => <hr className="my-3 border-line" />,
  // GitHub-flavored markdown (remark-gfm): tables for product comparisons, strikethrough, task lists.
  table: ({ node, ...props }) => (
    <div className="my-3 overflow-x-auto rounded-xl border border-line">
      <table className="w-full border-collapse text-[13px]" {...props} />
    </div>
  ),
  thead: ({ node, ...props }) => <thead className="bg-stone-100 text-left dark:bg-stone-800" {...props} />,
  th: ({ node, ...props }) => <th className="border-b border-line px-3 py-1.5 font-semibold" {...props} />,
  td: ({ node, ...props }) => <td className="border-b border-line px-3 py-1.5 align-top last:border-b-0" {...props} />,
  del: ({ node, ...props }) => <del className="text-stone-500 line-through" {...props} />,
};

/** Assistant markdown: lists, bold, inline code, links (opened in a new tab), GFM tables and strikethrough. */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="text-[15px] leading-relaxed break-words text-stone-800 dark:text-stone-200">
      <ReactMarkdown components={components} remarkPlugins={[remarkGfm]} skipHtml>
        {text}
      </ReactMarkdown>
    </div>
  );
});
