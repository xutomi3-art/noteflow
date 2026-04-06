import { useState } from "react";
import { ChevronDown, ChevronUp, BookmarkPlus, Copy, Check } from "lucide-react";
import type { ChatMessage } from "@/types/api";
import MarkdownContent from "./MarkdownContent";
import MindMapContent from "./MindMapContent";

const SKILL_COLORS: Record<string, { border: string; bg: string; text: string }> = {
  summary: { border: "border-indigo-200/60", bg: "bg-indigo-50/30", text: "text-indigo-700" },
  faq: { border: "border-cyan-200/60", bg: "bg-cyan-50/30", text: "text-cyan-700" },
  mindmap: { border: "border-pink-200/60", bg: "bg-pink-50/30", text: "text-pink-700" },
  action_items: { border: "border-yellow-200/60", bg: "bg-yellow-50/30", text: "text-yellow-700" },
  swot: { border: "border-emerald-200/60", bg: "bg-emerald-50/30", text: "text-emerald-700" },
  recommendations: { border: "border-purple-200/60", bg: "bg-purple-50/30", text: "text-purple-700" },
  risk_analysis: { border: "border-orange-200/60", bg: "bg-orange-50/30", text: "text-orange-700" },
  decision_support: { border: "border-blue-200/60", bg: "bg-blue-50/30", text: "text-blue-700" },
  study_guide: { border: "border-teal-200/60", bg: "bg-teal-50/30", text: "text-teal-700" },
};

const DEFAULT_COLORS = { border: "border-slate-200/60", bg: "bg-slate-50/30", text: "text-slate-700" };

interface Props {
  message: ChatMessage;
  onSave: () => void;
  isSaved: boolean;
  onCopy: () => void;
  isCopied: boolean;
}

export default function SkillOutputCard({ message, onSave, isSaved, onCopy, isCopied }: Props) {
  const [expanded, setExpanded] = useState(false);
  const skillType = message.metadata?.skill_type || "";
  const label = message.metadata?.skill_label || "Skill";
  const summary = message.metadata?.collapsed_summary || "";
  const colors = SKILL_COLORS[skillType] || DEFAULT_COLORS;

  return (
    <div className="w-full max-w-[90%]">
      <div className={`rounded-xl border ${colors.border} ${colors.bg} overflow-hidden`}>
        {/* Header — always visible, click to toggle */}
        <div
          className="flex items-start gap-3 px-4 py-3 cursor-pointer"
          onClick={() => setExpanded(!expanded)}
        >
          <div className="flex-1 min-w-0">
            <span className="font-semibold text-[14px] text-slate-800">{label}</span>
            {!expanded && summary && (
              <p className="text-[13px] text-slate-600 mt-1 line-clamp-2">{summary}</p>
            )}
            {!expanded && (
              <button
                className={`flex items-center gap-1 text-[12px] ${colors.text} mt-2 hover:opacity-80`}
                onClick={(e) => { e.stopPropagation(); setExpanded(true); }}
              >
                Show full content <ChevronDown className="w-3 h-3" />
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
            <div className="px-4 pb-4 border-t border-slate-100/50">
              <div className="mt-3 prose prose-sm max-w-none text-[13px] text-slate-700">
                {skillType === "mindmap" ? (
                  <MindMapContent content={message.content} />
                ) : (
                  <MarkdownContent content={message.content} />
                )}
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1 px-4 py-2 border-t border-slate-100/50">
              <button
                onClick={onSave}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  isSaved ? "bg-[#5b8c15]/10 text-[#5b8c15]" : "text-slate-500 hover:bg-slate-100"
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
