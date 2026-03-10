"use client";

import type { Source } from "@/types/api";

interface SourceItemProps {
  source: Source;
  selected: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onOpenPdf?: (sourceId: string, filename: string, page: number) => void;
}

const STATUS_CONFIG: Record<string, { icon: string; label: string; color: string }> = {
  uploading: { icon: "\u23F3", label: "Uploading", color: "text-yellow-600" },
  parsing: { icon: "\uD83D\uDD04", label: "Parsing", color: "text-blue-600" },
  vectorizing: { icon: "\u26A1", label: "Vectorizing", color: "text-purple-600" },
  ready: { icon: "\u2705", label: "Ready", color: "text-green-600" },
  failed: { icon: "\u274C", label: "Failed", color: "text-red-600" },
};

const TYPE_ICONS: Record<string, string> = {
  pdf: "\uD83D\uDCC4",
  docx: "\uD83D\uDCDD",
  pptx: "\uD83D\uDCCA",
  txt: "\uD83D\uDCC3",
  md: "\uD83D\uDCCB",
  jpg: "\uD83D\uDDBC\uFE0F",
  png: "\uD83D\uDDBC\uFE0F",
  webp: "\uD83D\uDDBC\uFE0F",
  gif: "\uD83D\uDDBC\uFE0F",
  bmp: "\uD83D\uDDBC\uFE0F",
};

function formatSize(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export default function SourceItem({ source, selected, onToggle, onDelete, onOpenPdf }: SourceItemProps) {
  const status = STATUS_CONFIG[source.status] || STATUS_CONFIG.uploading;
  const typeIcon = TYPE_ICONS[source.file_type] || "\uD83D\uDCC4";
  const isProcessing = source.status !== "ready" && source.status !== "failed";

  return (
    <div className="group flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-gray-50 transition-colors">
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggle}
        disabled={source.status !== "ready"}
        className="w-3.5 h-3.5 rounded border-[var(--border)] accent-[var(--accent)] shrink-0"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[13px]">{typeIcon}</span>
          {['pdf', 'pptx', 'docx'].includes(source.file_type) && source.status === 'ready' && onOpenPdf ? (
            <button
              onClick={() => onOpenPdf(source.id, source.filename, 1)}
              className="text-[13px] truncate font-medium text-[var(--accent)] hover:underline text-left"
              title={`Open ${source.filename}`}
            >
              {source.filename}
            </button>
          ) : (
            <span className="text-[13px] truncate font-medium">{source.filename}</span>
          )}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className={`text-[11px] ${status.color}`}>
            {status.icon} {status.label}
          </span>
          {source.file_size && (
            <span className="text-[11px] text-[var(--text-tertiary)]">
              &middot; {formatSize(source.file_size)}
            </span>
          )}
        </div>
        {source.status === "failed" && source.error_message && (
          <p className="text-[11px] text-red-500 mt-0.5 truncate" title={source.error_message}>
            {source.error_message}
          </p>
        )}
      </div>
      {isProcessing && (
        <div className="w-3.5 h-3.5 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin shrink-0" />
      )}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        className="opacity-0 group-hover:opacity-100 text-[var(--text-tertiary)] hover:text-red-500 transition-all shrink-0"
        title="Delete source"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path
            d="M3 3L11 11M11 3L3 11"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
}
