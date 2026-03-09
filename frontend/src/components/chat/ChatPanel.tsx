"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { useChatStore } from "@/stores/chat-store";
import { useSourceStore } from "@/stores/source-store";
import { api } from "@/services/api";
import ChatMessage from "./ChatMessage";
import ChatInput from "./ChatInput";
import MarkdownRenderer from "@/components/ui/MarkdownRenderer";
import type { Notebook } from "@/types/api";

interface ChatPanelProps {
  notebook: Notebook;
}

export default function ChatPanel({ notebook }: ChatPanelProps) {
  const { messages, isStreaming, streamingContent, isLoading, fetchHistory, sendMessage, clearHistory } = useChatStore();
  const { sources, selectedIds } = useSourceStore();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [overview, setOverview] = useState("");
  const [suggestedQuestions, setSuggestedQuestions] = useState<string[]>([]);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const overviewFetchedForRef = useRef<string>("");

  const readySources = sources.filter(s => s.status === "ready");
  const hasReadySources = readySources.length > 0;

  useEffect(() => {
    fetchHistory(notebook.id);
  }, [notebook.id, fetchHistory]);

  // Fetch overview when sources become ready
  useEffect(() => {
    if (!hasReadySources) return;
    // Create a key from ready source IDs to detect changes
    const readyKey = readySources.map(s => s.id).sort().join(",");
    if (overviewFetchedForRef.current === readyKey) return;
    overviewFetchedForRef.current = readyKey;

    setOverviewLoading(true);
    api.getOverview(notebook.id)
      .then(data => {
        setOverview(data.overview);
        setSuggestedQuestions(data.suggested_questions);
      })
      .catch(() => {})
      .finally(() => setOverviewLoading(false));
  }, [hasReadySources, readySources, notebook.id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  const handleSend = useCallback((message: string) => {
    const sourceIds = Array.from(selectedIds);
    sendMessage(notebook.id, message, sourceIds);
  }, [notebook.id, selectedIds, sendMessage]);

  const handleSaveNote = useCallback(async (content: string, messageId: string) => {
    try {
      await api.saveNote(notebook.id, content, messageId);
    } catch (err) {
      console.error("Failed to save note:", err);
    }
  }, [notebook.id]);

  const handleClear = useCallback(async () => {
    await clearHistory(notebook.id);
  }, [notebook.id, clearHistory]);

  const getPlaceholder = () => {
    if (sources.length === 0) return "Upload documents to start asking questions...";
    if (!hasReadySources) return "Waiting for documents to finish processing...";
    return `Ask about your ${readySources.length} document${readySources.length !== 1 ? "s" : ""}...`;
  };

  return (
    <div className="flex-1 flex flex-col bg-[var(--background)]">
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto">
        {messages.length === 0 && !isStreaming ? (
          /* Welcome state */
          <div className="h-full flex items-center justify-center">
            <div className="text-center max-w-md px-4">
              <div className="text-4xl mb-3">{notebook.emoji}</div>
              <h2 className="text-[20px] font-semibold mb-2">{notebook.name}</h2>

              {overviewLoading ? (
                <div className="flex items-center justify-center gap-2 mt-4">
                  <div className="w-4 h-4 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
                  <span className="text-[13px] text-[var(--text-secondary)]">Analyzing your documents...</span>
                </div>
              ) : overview ? (
                <>
                  <p className="text-[14px] text-[var(--text-secondary)] leading-relaxed mb-5">
                    {overview}
                  </p>
                  {suggestedQuestions.length > 0 && (
                    <div className="flex flex-col gap-2">
                      <p className="text-[12px] text-[var(--text-tertiary)] uppercase tracking-wider font-medium mb-1">
                        Suggested questions
                      </p>
                      {suggestedQuestions.map((q, i) => (
                        <button
                          key={i}
                          onClick={() => handleSend(q)}
                          className="text-left text-[13px] px-4 py-3 rounded-xl border border-[var(--border-light)] bg-[var(--card-bg)] hover:border-[var(--accent)] hover:bg-[var(--accent)]/5 transition-all text-[var(--foreground)]"
                        >
                          {q}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <p className="text-[14px] text-[var(--text-secondary)]">
                  {hasReadySources
                    ? "Your documents are ready. Ask anything about them — the AI will answer with full citations."
                    : "Upload documents to start asking questions. The AI will answer using your sources with full citation traceability."}
                </p>
              )}
            </div>
          </div>
        ) : (
          /* Chat messages */
          <div className="max-w-2xl mx-auto px-4 py-6">
            {/* Clear button */}
            {messages.length > 0 && (
              <div className="flex justify-center mb-4">
                <button
                  onClick={handleClear}
                  className="text-[12px] text-[var(--text-tertiary)] hover:text-red-500 transition-colors"
                >
                  Clear conversation
                </button>
              </div>
            )}

            {messages.map(msg => (
              <ChatMessage
                key={msg.id}
                message={msg}
                onSaveNote={msg.role === "assistant" ? handleSaveNote : undefined}
              />
            ))}

            {/* Streaming message */}
            {isStreaming && streamingContent && (
              <div className="flex justify-start mb-4">
                <div className="max-w-[80%] bg-[var(--card-bg)] border border-[var(--border-light)] rounded-2xl rounded-tl-md px-4 py-3">
                  <div className="text-[14px] leading-relaxed markdown-content">
                    <MarkdownRenderer content={streamingContent} />
                    <span className="inline-block w-2 h-4 bg-[var(--accent)] animate-pulse ml-0.5" />
                  </div>
                </div>
              </div>
            )}

            {/* Streaming without content yet */}
            {isStreaming && !streamingContent && (
              <div className="flex justify-start mb-4">
                <div className="bg-[var(--card-bg)] border border-[var(--border-light)] rounded-2xl rounded-tl-md px-4 py-3">
                  <div className="flex items-center gap-2 text-[14px] text-[var(--text-secondary)]">
                    <div className="w-4 h-4 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
                    Thinking...
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Chat input */}
      <ChatInput
        onSend={handleSend}
        disabled={!hasReadySources}
        placeholder={getPlaceholder()}
        isStreaming={isStreaming}
      />
    </div>
  );
}
