import React, { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";

interface MarkdownContentProps {
  content: string;
  className?: string;
}

/**
 * Renders markdown content with react-markdown + remark-gfm.
 * Converts [n] citation patterns into styled badge spans.
 */
export default function MarkdownContent({ content, className }: MarkdownContentProps) {
  // Custom components for react-markdown
  const components: Components = useMemo(
    () => ({
      table: ({ children, ...props }) => (
        <div className="overflow-x-auto my-3">
          <table
            className="min-w-full border-collapse border border-slate-200 text-sm"
            {...props}
          >
            {children}
          </table>
        </div>
      ),
      thead: ({ children, ...props }) => (
        <thead className="bg-slate-50" {...props}>
          {children}
        </thead>
      ),
      th: ({ children, ...props }) => (
        <th
          className="border border-slate-200 px-3 py-1.5 text-left text-xs font-semibold text-slate-700"
          {...props}
        >
          {children}
        </th>
      ),
      td: ({ children, ...props }) => (
        <td
          className="border border-slate-200 px-3 py-1.5 text-xs text-slate-600"
          {...props}
        >
          {children}
        </td>
      ),
      h1: ({ children, ...props }) => (
        <h2 className="font-bold text-lg text-slate-900 mt-4 mb-2" {...props}>
          {children}
        </h2>
      ),
      h2: ({ children, ...props }) => (
        <h3 className="font-semibold text-base text-slate-900 mt-4 mb-1" {...props}>
          {children}
        </h3>
      ),
      h3: ({ children, ...props }) => (
        <h4 className="font-semibold text-sm text-slate-800 mt-3 mb-1" {...props}>
          {children}
        </h4>
      ),
      h4: ({ children, ...props }) => (
        <h5 className="font-semibold text-[13px] text-slate-700 mt-2 mb-1" {...props}>
          {children}
        </h5>
      ),
      p: ({ children, ...props }) => (
        <p className="text-sm leading-relaxed mb-2" {...props}>
          {processCitations(children)}
        </p>
      ),
      li: ({ children, ...props }) => (
        <li className="text-sm leading-relaxed" {...props}>
          {processCitations(children)}
        </li>
      ),
      strong: ({ children, ...props }) => (
        <strong className="font-semibold" {...props}>
          {children}
        </strong>
      ),
    }),
    [],
  );

  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}

/**
 * Process React children to convert [n] citation patterns into styled badge spans.
 * Only transforms string children; passes through other React elements unchanged.
 */
function processCitations(children: React.ReactNode): React.ReactNode {
  return React.Children.map(children, (child) => {
    if (typeof child !== "string") return child;

    const parts: React.ReactNode[] = [];
    const regex = /\[(\d+)\]/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(child)) !== null) {
      if (match.index > lastIndex) {
        parts.push(child.slice(lastIndex, match.index));
      }
      const index = match[1];
      parts.push(
        <span
          key={`cit-${match.index}`}
          className="citation-badge inline-flex items-center justify-center w-4 h-4 rounded-full bg-slate-100 text-[9px] text-slate-500 ml-0.5 cursor-pointer hover:bg-slate-200 hover:ring-1 hover:ring-slate-300"
          data-citation-index={index}
        >
          {index}
        </span>,
      );
      lastIndex = regex.lastIndex;
    }

    if (lastIndex === 0) return child;
    if (lastIndex < child.length) {
      parts.push(child.slice(lastIndex));
    }
    return <>{parts}</>;
  });
}
