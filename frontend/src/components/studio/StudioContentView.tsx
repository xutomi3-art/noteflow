"use client";

import MarkdownRenderer from "@/components/ui/MarkdownRenderer";

interface StudioContentViewProps {
  content: string;
  isGenerating: boolean;
  onRegenerate: () => void;
}

export default function StudioContentView({ content, isGenerating, onRegenerate }: StudioContentViewProps) {
  if (isGenerating) {
    return (
      <div className="flex flex-col items-center justify-center py-8">
        <div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin mb-3" />
        <p className="text-[13px] text-[var(--text-secondary)]">Generating...</p>
      </div>
    );
  }

  if (!content) {
    return null;
  }

  return (
    <div>
      <div className="text-[13px] leading-relaxed text-[var(--foreground)]">
        <MarkdownRenderer content={content} />
      </div>
      <button
        onClick={onRegenerate}
        className="mt-3 text-[12px] text-[var(--accent)] hover:underline"
      >
        Regenerate
      </button>
    </div>
  );
}
