"use client";

import { useState } from "react";
import type { ChatMessage as ChatMessageType } from "@/types/api";
import CitationList from "./CitationList";
import { useStudioStore } from "@/stores/studio-store";

interface ChatMessageProps {
  message: ChatMessageType;
  onSaveNote?: (content: string, messageId: string) => void;
}

export default function ChatMessage({ message, onSaveNote }: ChatMessageProps) {
  const [copied, setCopied] = useState(false);
  const isUser = message.role === "user";
  const openPdf = useStudioStore(state => state.openPdf);

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSaveNote = () => {
    onSaveNote?.(message.content, message.id);
  };

  // Simple markdown rendering - convert markdown to HTML-like rendering
  // For production, use react-markdown, but this works for basic cases
  const renderContent = (content: string) => {
    // Split by code blocks first
    const parts = content.split(/(```[\s\S]*?```)/g);

    return parts.map((part, i) => {
      if (part.startsWith("```")) {
        const code = part.replace(/```\w*\n?/, "").replace(/```$/, "");
        return (
          <pre key={i} className="bg-gray-100 rounded-lg p-3 my-2 overflow-x-auto text-[13px]">
            <code>{code}</code>
          </pre>
        );
      }

      // Process inline markdown
      return (
        <div
          key={i}
          className="whitespace-pre-wrap"
          onClick={(e) => {
            const target = e.target as HTMLElement;
            const idx = target.dataset.citationIdx;
            if (idx && message.citations) {
              const citation = message.citations.find(c => c.index === parseInt(idx));
              if (citation && citation.file_type === 'pdf') {
                openPdf(citation.source_id, citation.filename, citation.location.page ?? 1);
              }
            }
          }}
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
              .replace(/\[(\d+)\]/g, '<sup data-citation-idx="$1" class="text-[var(--accent)] font-medium cursor-pointer hover:underline">[$1]</sup>'),
          }}
        />
      );
    });
  };

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-4`}>
      <div
        className={`max-w-[80%] ${
          isUser
            ? "bg-[var(--accent)] text-white rounded-2xl rounded-tr-md px-4 py-3"
            : "bg-[var(--card-bg)] border border-[var(--border-light)] rounded-2xl rounded-tl-md px-4 py-3"
        }`}
      >
        <div className="text-[14px] leading-relaxed">
          {renderContent(message.content)}
        </div>

        {!isUser && message.citations && message.citations.length > 0 && (
          <CitationList citations={message.citations} />
        )}

        {!isUser && (
          <div className="flex items-center gap-2 mt-2 pt-2 border-t border-[var(--border-light)]">
            <button
              onClick={handleCopy}
              className="text-[11px] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors"
              title="Copy"
            >
              {copied ? "Copied!" : "Copy"}
            </button>
            {onSaveNote && (
              <button
                onClick={handleSaveNote}
                className="text-[11px] text-[var(--text-tertiary)] hover:text-[var(--accent)] transition-colors"
                title="Save to note"
              >
                Save to note
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
