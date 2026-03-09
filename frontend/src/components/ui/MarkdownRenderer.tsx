"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import type { Components } from "react-markdown";

interface MarkdownRendererProps {
  content: string;
  onCitationClick?: (index: number) => void;
}

const components: Components = {
  table: ({ children, ...props }) => (
    <div className="overflow-x-auto my-3">
      <table
        className="min-w-full border-collapse text-[13px] leading-snug"
        {...props}
      >
        {children}
      </table>
    </div>
  ),
  thead: ({ children, ...props }) => (
    <thead className="bg-gray-50" {...props}>
      {children}
    </thead>
  ),
  th: ({ children, ...props }) => (
    <th
      className="px-3 py-2 text-left font-semibold text-[var(--foreground)] border border-[var(--border-light)]"
      {...props}
    >
      {children}
    </th>
  ),
  td: ({ children, ...props }) => (
    <td
      className="px-3 py-2 border border-[var(--border-light)] text-[var(--text-secondary)]"
      {...props}
    >
      {children}
    </td>
  ),
  tr: ({ children, ...props }) => (
    <tr className="even:bg-gray-50/50" {...props}>
      {children}
    </tr>
  ),
  pre: ({ children, ...props }) => (
    <pre
      className="bg-gray-100 rounded-lg p-3 my-2 overflow-x-auto text-[13px]"
      {...props}
    >
      {children}
    </pre>
  ),
  code: ({ children, className, ...props }) => {
    if (className) {
      return (
        <code className={className} {...props}>
          {children}
        </code>
      );
    }
    return (
      <code
        className="bg-gray-100 px-1 py-0.5 rounded text-[13px]"
        {...props}
      >
        {children}
      </code>
    );
  },
  h1: ({ children, ...props }) => (
    <h1 className="text-[17px] font-bold mt-3 mb-1" {...props}>
      {children}
    </h1>
  ),
  h2: ({ children, ...props }) => (
    <h2 className="text-[16px] font-semibold mt-3 mb-1" {...props}>
      {children}
    </h2>
  ),
  h3: ({ children, ...props }) => (
    <h3 className="text-[15px] font-semibold mt-3 mb-1" {...props}>
      {children}
    </h3>
  ),
  ul: ({ children, ...props }) => (
    <ul className="ml-4 list-disc my-1" {...props}>
      {children}
    </ul>
  ),
  ol: ({ children, ...props }) => (
    <ol className="ml-4 list-decimal my-1" {...props}>
      {children}
    </ol>
  ),
  li: ({ children, ...props }) => (
    <li className="my-0.5" {...props}>
      {children}
    </li>
  ),
  img: ({ src, alt, ...props }) => (
    <img
      src={src}
      alt={alt || ""}
      className="max-w-full rounded-lg my-2 border border-[var(--border-light)]"
      loading="lazy"
      {...props}
    />
  ),
  a: ({ href, children, ...props }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-[var(--accent)] hover:underline"
      {...props}
    >
      {children}
    </a>
  ),
  p: ({ children, ...props }) => (
    <p className="my-1" {...props}>
      {children}
    </p>
  ),
  blockquote: ({ children, ...props }) => (
    <blockquote
      className="border-l-3 border-[var(--border)] pl-3 my-2 text-[var(--text-secondary)] italic"
      {...props}
    >
      {children}
    </blockquote>
  ),
  hr: (props) => (
    <hr className="my-3 border-[var(--border-light)]" {...props} />
  ),
  sup: ({ children, ...props }) => (
    <sup
      className="text-[var(--accent)] font-medium cursor-pointer hover:underline"
      {...props}
    >
      {children}
    </sup>
  ),
};

/**
 * Pre-process content to convert [1] citation markers to <sup> tags
 * so rehype-raw can render them as clickable superscripts.
 */
function preprocessCitations(content: string): string {
  return content.replace(
    /\[(\d+)\]/g,
    '<sup data-citation-idx="$1">[$1]</sup>'
  );
}

export default function MarkdownRenderer({
  content,
  onCitationClick,
}: MarkdownRendererProps) {
  const processed = preprocessCitations(content);

  return (
    <div
      className="markdown-content"
      onClick={(e) => {
        const target = e.target as HTMLElement;
        const idx = target.dataset.citationIdx;
        if (idx && onCitationClick) {
          onCitationClick(parseInt(idx));
        }
      }}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw]}
        components={components}
      >
        {processed}
      </ReactMarkdown>
    </div>
  );
}
