import React, { useState } from "react";
import { ClipboardList, ChevronDown, ChevronUp, BookmarkPlus, Copy, Check, Share2, Link, Loader2, X } from "lucide-react";
import type { ChatMessage } from "@/types/api";
import { api } from "@/services/api";
import MarkdownContent from "./MarkdownContent";

interface Props {
  message: ChatMessage;
  notebookId: string;
  onSave: () => void;
  isSaved: boolean;
  onCopy: () => void;
  isCopied: boolean;
}

export default function MeetingMinutesMessage({ message, notebookId, onSave, isSaved, onCopy, isCopied }: Props) {
  const [expanded, setExpanded] = useState(false);
  const title = message.metadata?.title || "Meeting Minutes";
  const summary = message.metadata?.collapsed_summary || "";

  // Share state
  const [shareToken, setShareToken] = useState<string | null>(null);
  const [shareLoading, setShareLoading] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  const shareUrl = shareToken ? `${window.location.origin}/shared/minutes/${shareToken}` : "";

  const handleShare = async () => {
    if (shareToken) {
      setShareOpen(true);
      return;
    }
    setShareLoading(true);
    try {
      const res = await api.shareMeetingMinutes(notebookId, message.id);
      setShareToken(res.token);
      setShareOpen(true);
    } catch {
      alert("Failed to create share link");
    } finally {
      setShareLoading(false);
    }
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(shareUrl);
    setShareCopied(true);
    setTimeout(() => setShareCopied(false), 2000);
  };

  const handleRevoke = async () => {
    try {
      await api.revokeMeetingMinutesShare(notebookId, message.id);
      setShareToken(null);
      setShareOpen(false);
    } catch {
      alert("Failed to revoke share link");
    }
  };

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
          {/* Share button — always visible on the card */}
          {!expanded && (
            <div className="relative shrink-0">
              <button
                onClick={(e) => { e.stopPropagation(); handleShare(); }}
                disabled={shareLoading}
                className={`flex items-center gap-1 px-2 py-1.5 rounded-lg transition-colors ${
                  shareToken ? "text-blue-500 hover:bg-blue-50" : "text-slate-400 hover:text-slate-600 hover:bg-slate-100"
                }`}
                title="Share meeting minutes"
              >
                {shareLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Share2 className="w-3.5 h-3.5" />}
                <span className="text-[12px]">Share</span>
              </button>
              {shareOpen && shareToken && (
                <div className="absolute top-full right-0 mt-2 w-80 bg-white rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.12)] border border-slate-200 p-4 z-50">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-sm font-semibold text-slate-800">Share Meeting Minutes</h4>
                    <button onClick={(e) => { e.stopPropagation(); setShareOpen(false); }} className="p-0.5 text-slate-400 hover:text-slate-600">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-500 mb-3">Anyone with this link can view without logging in. Expires in 30 days.</p>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                      <Link className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <input readOnly value={shareUrl} className="flex-1 text-[11px] text-slate-600 bg-transparent outline-none truncate" onClick={(e) => { e.stopPropagation(); (e.target as HTMLInputElement).select(); }} />
                    </div>
                    <button onClick={(e) => { e.stopPropagation(); handleCopyLink(); }} className={`px-3 py-2 rounded-lg text-xs font-medium transition-colors shrink-0 ${shareCopied ? "bg-[#5b8c15] text-white" : "bg-slate-800 text-white hover:bg-slate-700"}`}>
                      {shareCopied ? "Copied!" : "Copy"}
                    </button>
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); handleRevoke(); }} className="mt-3 text-[11px] text-red-500 hover:text-red-600 transition-colors">Revoke link</button>
                </div>
              )}
            </div>
          )}
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

              {/* Share button */}
              <div className="relative ml-auto">
                <button
                  onClick={handleShare}
                  disabled={shareLoading}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    shareToken
                      ? "bg-blue-50 text-blue-600 hover:bg-blue-100"
                      : "text-slate-500 hover:bg-slate-100"
                  }`}
                >
                  {shareLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Share2 className="w-3.5 h-3.5" />}
                  Share
                </button>

                {/* Share popover */}
                {shareOpen && shareToken && (
                  <div className="absolute bottom-full right-0 mb-2 w-80 bg-white rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.12)] border border-slate-200 p-4 z-50">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-sm font-semibold text-slate-800">Share Meeting Minutes</h4>
                      <button onClick={() => setShareOpen(false)} className="p-0.5 text-slate-400 hover:text-slate-600">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <p className="text-[11px] text-slate-500 mb-3">Anyone with this link can view the meeting minutes without logging in. Expires in 30 days.</p>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                        <Link className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <input
                          readOnly
                          value={shareUrl}
                          className="flex-1 text-[11px] text-slate-600 bg-transparent outline-none truncate"
                          onClick={(e) => (e.target as HTMLInputElement).select()}
                        />
                      </div>
                      <button
                        onClick={handleCopyLink}
                        className={`px-3 py-2 rounded-lg text-xs font-medium transition-colors shrink-0 ${
                          shareCopied ? "bg-[#5b8c15] text-white" : "bg-slate-800 text-white hover:bg-slate-700"
                        }`}
                      >
                        {shareCopied ? "Copied!" : "Copy"}
                      </button>
                    </div>
                    <button
                      onClick={handleRevoke}
                      className="mt-3 text-[11px] text-red-500 hover:text-red-600 transition-colors"
                    >
                      Revoke link
                    </button>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
