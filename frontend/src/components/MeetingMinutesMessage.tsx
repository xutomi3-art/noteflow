import React, { useState } from "react";
import { ClipboardList, ChevronDown, ChevronUp, BookmarkPlus, Copy, Check } from "lucide-react";
import type { ChatMessage } from "@/types/api";
import MarkdownContent from "./MarkdownContent";

interface Props {
  message: ChatMessage;
  onSave: () => void;
  isSaved: boolean;
  onCopy: () => void;
  isCopied: boolean;
}

export default function MeetingMinutesMessage({ message, onSave, isSaved, onCopy, isCopied }: Props) {
  const [expanded, setExpanded] = useState(false);
  const title = message.metadata?.title || "Meeting Minutes";
  const summary = message.metadata?.collapsed_summary || "";

  return (
    <div className="w-full max-w-[90%]">
      <div
        className={`rounded-xl border transition-colors ${
          expanded
            ? "bg-white border-amber-200/60"
            : "bg-amber-50/50 border-amber-200/60 cursor-pointer hover:bg-amber-50"
        }`}
      >
        {/* Header — always visible */}
        <div
          className="flex items-start gap-3 px-4 py-3"
          onClick={() => !expanded && setExpanded(true)}
        >
          <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center shrink-0 mt-0.5">
            <ClipboardList className="w-4 h-4 text-amber-600" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-[14px] text-slate-800">{title}</span>
              <span className="text-[10px] px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded font-medium">
                Meeting Minutes
              </span>
            </div>
            {!expanded && summary && (
              <p className="text-[13px] text-slate-600 mt-1 line-clamp-2">{summary}</p>
            )}
            {!expanded && (
              <button
                className="flex items-center gap-1 text-[12px] text-amber-600 mt-2 hover:text-amber-700"
                onClick={(e) => { e.stopPropagation(); setExpanded(true); }}
              >
                Show full minutes <ChevronDown className="w-3 h-3" />
              </button>
            )}
          </div>
          {expanded && (
            <button
              onClick={() => setExpanded(false)}
              className="p-1 text-slate-400 hover:text-slate-600 rounded transition-colors shrink-0"
            >
              <ChevronUp className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Expanded content */}
        {expanded && (
          <>
            <div className="px-4 pb-4 border-t border-amber-100">
              <div className="mt-3 prose prose-sm max-w-none text-[13px] text-slate-700">
                <MarkdownContent content={message.content} />
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1 px-4 py-2 border-t border-slate-100">
              <button
                onClick={onSave}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  isSaved
                    ? "bg-[#5b8c15]/10 text-[#5b8c15]"
                    : "text-slate-500 hover:bg-slate-100"
                }`}
              >
                {isSaved ? <Check className="w-3.5 h-3.5" /> : <BookmarkPlus className="w-3.5 h-3.5" />}
                {isSaved ? "Saved" : "Save to note"}
              </button>
              <button
                onClick={onCopy}
                className={`p-1.5 rounded-lg transition-colors ${
                  isCopied ? "text-[#5b8c15]" : "text-slate-400 hover:text-slate-600 hover:bg-slate-100"
                }`}
              >
                {isCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
