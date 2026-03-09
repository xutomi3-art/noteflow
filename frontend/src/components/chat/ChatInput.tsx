"use client";

import { useState, useRef, useEffect } from "react";

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  placeholder?: string;
  isStreaming?: boolean;
}

export default function ChatInput({ onSend, disabled, placeholder, isStreaming }: ChatInputProps) {
  const [message, setMessage] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 120) + "px";
    }
  }, [message]);

  const handleSend = () => {
    const trimmed = message.trim();
    if (!trimmed || disabled || isStreaming) return;
    onSend(trimmed);
    setMessage("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="border-t border-[var(--border-light)] p-4 bg-[var(--card-bg)]">
      <div className="max-w-2xl mx-auto flex gap-2 items-end">
        <textarea
          ref={textareaRef}
          value={message}
          onChange={e => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder || "Ask a question..."}
          disabled={disabled || isStreaming}
          rows={1}
          className="flex-1 px-4 py-2.5 text-[15px] bg-[var(--background)] border border-[var(--border)] rounded-xl outline-none resize-none disabled:opacity-50 focus:border-[var(--accent)] transition-colors"
        />
        <button
          onClick={handleSend}
          disabled={disabled || isStreaming || !message.trim()}
          className="px-4 py-2.5 bg-[var(--accent)] text-white rounded-xl text-[15px] font-medium disabled:opacity-50 hover:opacity-90 transition-opacity shrink-0"
        >
          {isStreaming ? (
            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            "Send"
          )}
        </button>
      </div>
    </div>
  );
}
