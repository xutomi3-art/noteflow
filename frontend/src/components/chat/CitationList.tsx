"use client";

import { useState } from "react";
import type { Citation } from "@/types/api";
import { useStudioStore } from "@/stores/studio-store";

interface CitationListProps {
  citations: Citation[];
}

function formatLocation(citation: Citation): string {
  const loc = citation.location;
  if (loc.page) return `p.${loc.page}`;
  if (loc.slide) return `slide ${loc.slide}`;
  if (loc.paragraph) return `\u00B6${loc.paragraph}`;
  return "";
}

export default function CitationList({ citations }: CitationListProps) {
  const [expanded, setExpanded] = useState<number | null>(null);
  const openPdf = useStudioStore(state => state.openPdf);

  if (citations.length === 0) return null;

  return (
    <div className="mt-2 space-y-1">
      <p className="text-[12px] font-medium text-[var(--text-secondary)] mb-1">
        Sources ({citations.length})
      </p>
      {citations.map(citation => {
        const isExpanded = expanded === citation.index;
        const loc = formatLocation(citation);

        return (
          <div key={citation.index} className="text-[12px]">
            <button
              onClick={() => {
                setExpanded(isExpanded ? null : citation.index);
                if (citation.file_type === 'pdf') {
                  openPdf(citation.source_id, citation.filename, citation.location.page ?? 1);
                }
              }}
              className="flex items-center gap-1.5 text-[var(--accent)] hover:underline"
            >
              <span className="font-medium">[{citation.index}]</span>
              <span className="truncate max-w-[200px]">{citation.filename}</span>
              {loc && <span className="text-[var(--text-tertiary)]">&middot; {loc}</span>}
              <svg
                width="10"
                height="10"
                viewBox="0 0 10 10"
                fill="none"
                className={`transition-transform ${isExpanded ? "rotate-180" : ""}`}
              >
                <path d="M2 4L5 7L8 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
            </button>
            {isExpanded && citation.excerpt && (
              <div className="mt-1 ml-4 p-2 bg-gray-50 rounded-lg text-[var(--text-secondary)] leading-relaxed">
                {citation.excerpt}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
