"use client";

import { useEffect, useCallback, useState } from "react";
import { useSourceStore } from "@/stores/source-store";
import { useStudioStore } from "@/stores/studio-store";
import { useSharingStore } from "@/stores/sharing-store";
import SourceItem from "./SourceItem";
import UploadDropZone from "./UploadDropZone";

interface SourcesPanelProps {
  notebookId: string;
  userRole?: string;
  isShared?: boolean;
}

export default function SourcesPanel({ notebookId, userRole = "owner", isShared = false }: SourcesPanelProps) {
  const {
    sources,
    selectedIds,
    isLoading,
    fetchSources,
    uploadSource,
    deleteSource,
    toggleSelect,
    selectAll,
    deselectAll,
    subscribeStatus,
    cleanup,
  } = useSourceStore();

  const openPdf = useStudioStore(state => state.openPdf);
  const { members, fetchMembers, createInviteLink, sendEmailInvite } = useSharingStore();

  const [inviteRole, setInviteRole] = useState("editor");
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [generatingLink, setGeneratingLink] = useState(false);
  const [emailInput, setEmailInput] = useState("");
  const [emailSending, setEmailSending] = useState(false);
  const [emailStatus, setEmailStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);

  useEffect(() => {
    fetchSources(notebookId);
    subscribeStatus(notebookId);
    if (isShared) {
      fetchMembers(notebookId);
    }
    return () => cleanup();
  }, [notebookId, fetchSources, subscribeStatus, cleanup, isShared, fetchMembers]);

  const handleUpload = useCallback(
    async (files: File[]) => {
      for (const file of files) {
        try {
          await uploadSource(notebookId, file);
        } catch (err) {
          console.error("Upload failed:", err);
        }
      }
    },
    [notebookId, uploadSource],
  );

  const handleDelete = useCallback(
    async (sourceId: string) => {
      try {
        await deleteSource(notebookId, sourceId);
      } catch (err) {
        console.error("Delete failed:", err);
      }
    },
    [notebookId, deleteSource],
  );

  const handleGenerateLink = async () => {
    setGeneratingLink(true);
    try {
      const link = await createInviteLink(notebookId, inviteRole);
      const url = `${window.location.origin}/join/${link.token}`;
      setInviteLink(url);
      setLinkCopied(false);
    } finally {
      setGeneratingLink(false);
    }
  };

  const handleCopyLink = async () => {
    if (!inviteLink) return;
    await navigator.clipboard.writeText(inviteLink);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  };

  const handleSendEmail = async () => {
    if (!emailInput.trim()) return;
    setEmailSending(true);
    setEmailStatus(null);
    try {
      const message = await sendEmailInvite(notebookId, emailInput.trim(), inviteRole);
      setEmailStatus({ type: "success", message });
      setEmailInput("");
      setTimeout(() => setEmailStatus(null), 3000);
    } catch (err) {
      setEmailStatus({ type: "error", message: err instanceof Error ? err.message : "Failed to send invite" });
    } finally {
      setEmailSending(false);
    }
  };

  const readyCount = sources.filter((s) => s.status === "ready").length;
  const allSelected = readyCount > 0 && selectedIds.size === readyCount;

  const canInvite = userRole === "owner" || userRole === "editor";

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[13px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
          Sources
        </h3>
        {sources.length > 0 && (
          <span className="text-[12px] text-[var(--text-tertiary)]">
            {sources.length} file{sources.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {userRole !== "viewer" && <UploadDropZone onUpload={handleUpload} />}

      {sources.length > 0 && (
        <>
          <div className="flex items-center justify-between mt-3 mb-1 px-1">
            <button
              onClick={allSelected ? deselectAll : selectAll}
              className="text-[12px] text-[var(--accent)] hover:underline"
            >
              {allSelected ? "Deselect all" : "Select all"}
            </button>
            <span className="text-[11px] text-[var(--text-tertiary)]">
              {selectedIds.size} selected
            </span>
          </div>

          <div className="flex-1 overflow-y-auto mt-1 -mx-1 min-h-0">
            {isLoading ? (
              <div className="flex justify-center py-8">
                <div className="w-5 h-5 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
              </div>
            ) : (
              sources.map((source) => (
                <SourceItem
                  key={source.id}
                  source={source}
                  selected={selectedIds.has(source.id)}
                  onToggle={() => toggleSelect(source.id)}
                  onDelete={() => handleDelete(source.id)}
                  onOpenPdf={openPdf}
                />
              ))
            )}
          </div>
        </>
      )}

      {sources.length === 0 && !isLoading && (
        <p className="text-[13px] text-[var(--text-tertiary)] mt-3 text-center">
          Upload documents to get started
        </p>
      )}

      {/* Team section — only for shared notebooks */}
      {isShared && (
        <div className="mt-4 pt-4 border-t border-[var(--border-light)]">
          <h4 className="text-[12px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-3">
            Team
          </h4>

          {/* Invite controls */}
          {canInvite && (
            <div className="space-y-3 mb-4">
              {/* Role selector */}
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-[var(--text-tertiary)]">Invite as</span>
                <select
                  value={inviteRole}
                  onChange={(e) => {
                    setInviteRole(e.target.value);
                    setInviteLink(null);
                  }}
                  className="text-[12px] px-2 py-1 rounded-lg border border-[var(--border)]
                    bg-[var(--background)] text-[var(--foreground)]
                    focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
                >
                  <option value="editor">Editor</option>
                  <option value="viewer">Viewer</option>
                </select>
              </div>

              {/* Email invite */}
              <div className="flex items-center gap-1.5">
                <input
                  type="email"
                  placeholder="Email address"
                  value={emailInput}
                  onChange={(e) => { setEmailInput(e.target.value); setEmailStatus(null); }}
                  onKeyDown={(e) => { if (e.key === "Enter") handleSendEmail(); }}
                  className="flex-1 text-[12px] px-2 py-1.5 rounded-lg border border-[var(--border)]
                    bg-[var(--background)] text-[var(--foreground)] placeholder:text-[var(--text-tertiary)]
                    focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
                />
                <button
                  onClick={handleSendEmail}
                  disabled={emailSending || !emailInput.trim()}
                  className="text-[12px] font-medium px-3 py-1.5 rounded-lg
                    bg-[var(--accent)] text-white hover:opacity-90 transition-opacity
                    disabled:opacity-50 shrink-0"
                >
                  {emailSending ? "..." : "Send"}
                </button>
              </div>

              {emailStatus && (
                <p className={`text-[11px] px-1 ${emailStatus.type === "success" ? "text-green-600" : "text-red-500"}`}>
                  {emailStatus.message}
                </p>
              )}

              {/* Divider */}
              <div className="flex items-center gap-2">
                <div className="flex-1 h-px bg-[var(--border-light)]" />
                <span className="text-[10px] text-[var(--text-tertiary)]">or</span>
                <div className="flex-1 h-px bg-[var(--border-light)]" />
              </div>

              {/* Link invite */}
              <div className="space-y-1.5">
                <button
                  onClick={handleGenerateLink}
                  disabled={generatingLink}
                  className="w-full text-[12px] font-medium px-3 py-1.5 rounded-lg
                    border border-[var(--border)] text-[var(--foreground)]
                    hover:bg-[var(--background-secondary)] transition-colors
                    disabled:opacity-50"
                >
                  {generatingLink ? "Generating..." : "Copy invite link"}
                </button>

                {inviteLink && (
                  <div className="flex items-center gap-1.5 bg-[var(--background)] rounded-lg border border-[var(--border)] px-2 py-1.5">
                    <span className="flex-1 text-[11px] text-[var(--text-secondary)] truncate">
                      {inviteLink}
                    </span>
                    <button
                      onClick={handleCopyLink}
                      className="shrink-0 text-[11px] font-medium text-[var(--accent)] hover:underline"
                    >
                      {linkCopied ? "Copied!" : "Copy"}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Member list */}
          <div className="space-y-1.5">
            <span className="text-[11px] text-[var(--text-tertiary)]">
              Members ({members.length})
            </span>
            {members.map((member) => (
              <div key={member.user_id} className="flex items-center gap-2 py-1 px-1">
                <div className="w-6 h-6 rounded-full bg-[var(--accent)]/10 flex items-center justify-center text-[11px] font-medium text-[var(--accent)] shrink-0">
                  {member.name?.[0]?.toUpperCase() || "?"}
                </div>
                <span className="flex-1 text-[12px] text-[var(--foreground)] truncate">
                  {member.name}
                </span>
                <span className="text-[10px] text-[var(--text-tertiary)] capitalize shrink-0">
                  {member.role}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
