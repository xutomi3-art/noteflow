"use client";

interface MarkdownRendererProps {
  content: string;
}

export default function MarkdownRenderer({ content }: MarkdownRendererProps) {
  // Split by code blocks first
  const parts = content.split(/(```[\s\S]*?```)/g);

  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("```")) {
          const code = part.replace(/```\w*\n?/, "").replace(/```$/, "");
          return (
            <pre key={i} className="bg-gray-100 rounded-lg p-3 my-2 overflow-x-auto text-[13px]">
              <code>{code}</code>
            </pre>
          );
        }

        return (
          <div
            key={i}
            className="whitespace-pre-wrap"
            dangerouslySetInnerHTML={{
              __html: part
                .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
                .replace(/\*(.+?)\*/g, "<em>$1</em>")
                .replace(/`(.+?)`/g, '<code class="bg-gray-100 px-1 py-0.5 rounded text-[13px]">$1</code>')
                .replace(/^### (.+)$/gm, '<h3 class="text-[15px] font-semibold mt-3 mb-1">$1</h3>')
                .replace(/^## (.+)$/gm, '<h2 class="text-[16px] font-semibold mt-3 mb-1">$1</h2>')
                .replace(/^# (.+)$/gm, '<h1 class="text-[17px] font-bold mt-3 mb-1">$1</h1>')
                .replace(/^- (.+)$/gm, '<li class="ml-4 list-disc">$1</li>')
                .replace(/^\d+\. (.+)$/gm, '<li class="ml-4 list-decimal">$1</li>')
                .replace(/\[(\d+)\]/g, '<sup class="text-[var(--accent)] font-medium cursor-pointer">[$1]</sup>'),
            }}
          />
        );
      })}
    </>
  );
}
