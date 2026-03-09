"use client";

import { useState, useEffect, useRef } from "react";
import type { Citation } from "@/types/api";
import { useStudioStore } from "@/stores/studio-store";

interface CitationListProps {
  citations: Citation[];
  /** When set externally, auto-expand and highlight this citation index */
  activeCitationIndex?: number | null;
}

function formatLocation(citation: Citation): string {
  const loc = citation.location;
  if (loc.page) return `p.${loc.page}`;
  if (loc.slide) return `slide ${loc.slide}`;
  if (loc.paragraph) return `¶${loc.paragraph}`;
  return "";
}

interface GroupedSource {
  filename: string;
  fileType: string;
  sourceId: string;
  citations: Citation[];
}

function groupBySource(citations: Citation[]): GroupedSource[] {
  const map = new Map<string, GroupedSource>();
  for (const c of citations) {
    const key = `${c.source_id}-${c.filename}`;
    if (!map.has(key)) {
      map.set(key, {
        filename: c.filename,
        fileType: c.file_type,
        sourceId: c.source_id,
        citations: [],
      });
    }
    map.get(key)!.citations.push(c);
  }
  return Array.from(map.values());
}

export default function CitationList({ citations, activeCitationIndex }: CitationListProps) {
  const [expandedSource, setExpandedSource] = useState<string | null>(null);
  const [expandedCitation, setExpandedCitation] = useState<number | null>(null);
  const openPdf = useStudioStore(state => state.openPdf);
  const containerRef = useRef<HTMLDivElement>(null);

  const groups = groupBySource(citations);

  // When activeCitationIndex changes from parent (inline [n] click), expand the right group
  useEffect(() => {
    if (activeCitationIndex == null) return;
    const citation = citations.find(c => c.index === activeCitationIndex);
    if (!citation) return;

    const key = `${citation.source_id}-${citation.filename}`;
    setExpandedSource(key);
    setExpandedCitation(activeCitationIndex);

    // Scroll this component into view
    setTimeout(() => {
      containerRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 50);
  }, [activeCitationIndex, citations]);

  if (citations.length === 0) return null;

  return (
    <div className="mt-2" ref={containerRef}>
      <p className="text-[12px] font-medium text-[var(--text-secondary)] mb-1.5">
        Sources ({citations.length})
      </p>
      <div className="space-y-1">
        {groups.map(group => {
          const key = `${group.sourceId}-${group.filename}`;
          const isExpanded = expandedSource === key;

          return (
            <div key={key} className="text-[12px]">
              {/* Source row: filename + citation badges */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  onClick={() => {
                    setExpandedSource(isExpanded ? null : key);
                    setExpandedCitation(null);
                    if (group.fileType === 'pdf') {
                      openPdf(group.sourceId, group.filename, 1);
                    }
                  }}
                  className="flex items-center gap-1 text-[var(--accent)] hover:underline shrink-0"
                >
                  <span className="truncate max-w-[180px]">{group.filename}</span>
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 10 10"
                    fill="none"
                    className={`transition-transform shrink-0 ${isExpanded ? "rotate-180" : ""}`}
                  >
                    <path d="M2 4L5 7L8 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                  </svg>
                </button>
                <div className="flex items-center gap-0.5 flex-wrap">
                  {group.citations.map(c => (
                    <button
                      key={c.index}
                      onClick={() => {
                        if (c.file_type === 'pdf') {
                          openPdf(c.source_id, c.filename, c.location.page ?? 1);
                        }
                        setExpandedSource(key);
                        setExpandedCitation(expandedCitation === c.index ? null : c.index);
                      }}
                      className={`px-1 py-0 rounded text-[11px] font-medium transition-colors ${
                        expandedCitation === c.index && isExpanded
                          ? "bg-[var(--accent)] text-white"
                          : "bg-gray-100 text-[var(--text-secondary)] hover:bg-gray-200"
                      }`}
                      title={formatLocation(c) || `Citation ${c.index}`}
                    >
                      {c.index}
                    </button>
                  ))}
                </div>
              </div>

              {/* Expanded: show individual citation excerpts */}
              {isExpanded && (
                <div className="ml-4 mt-1 space-y-1">
                  {group.citations.map(c => {
                    const loc = formatLocation(c);
                    const isCitExpanded = expandedCitation === c.index;
                    return (
                      <div key={c.index}>
                        <button
                          onClick={() => {
                            setExpandedCitation(isCitExpanded ? null : c.index);
                            if (c.file_type === 'pdf') {
                              openPdf(c.source_id, c.filename, c.location.page ?? 1);
                            }
                          }}
                          className="flex items-center gap-1 text-[var(--text-secondary)] hover:text-[var(--accent)]"
                        >
                          <span className="font-medium text-[var(--accent)]">[{c.index}]</span>
                          {loc && <span className="text-[var(--text-tertiary)]">{loc}</span>}
                          {c.excerpt && (
                            <span className="truncate max-w-[200px] text-[var(--text-tertiary)]">
                              {c.excerpt.slice(0, 50)}...
                            </span>
                          )}
                        </button>
                        {isCitExpanded && c.excerpt && (
                          <div className="mt-1 ml-4 p-2 bg-gray-50 rounded-lg text-[var(--text-secondary)] leading-relaxed text-[11px]">
                            {c.excerpt}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
