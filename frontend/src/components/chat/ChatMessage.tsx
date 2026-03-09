"use client";

import { useState } from "react";
import type { ChatMessage as ChatMessageType } from "@/types/api";
import CitationList from "./CitationList";
import MarkdownRenderer from "@/components/ui/MarkdownRenderer";
import { useStudioStore } from "@/stores/studio-store";

interface ChatMessageProps {
  message: ChatMessageType;
  onSaveNote?: (content: string, messageId: string) => void;
}

export default function ChatMessage({ message, onSaveNote }: ChatMessageProps) {
  const [copied, setCopied] = useState(false);
  const [activeCitation, setActiveCitation] = useState<number | null>(null);
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

  const handleCitationClick = (index: number) => {
    if (message.citations) {
      const citation = message.citations.find(c => c.index === index);
      if (citation && citation.file_type === "pdf") {
        openPdf(citation.source_id, citation.filename, citation.location.page ?? 1);
      }
    }
    setActiveCitation(prev => (prev === index ? null : index));
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
          {isUser ? (
            <p>{message.content}</p>
          ) : (
            <MarkdownRenderer
              content={message.content}
              onCitationClick={handleCitationClick}
            />
          )}
        </div>

        {!isUser && message.citations && message.citations.length > 0 && (
          <CitationList citations={message.citations} activeCitationIndex={activeCitation} />
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
