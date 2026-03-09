"use client";

import { useEffect, useState, useCallback } from "react";
import { useSharingStore } from "@/stores/sharing-store";
import { useAuthStore } from "@/stores/auth-store";
import { Modal } from "@/components/ui/Modal";

interface ShareModalProps {
  open: boolean;
  onClose: () => void;
  notebookId: string;
  notebookName: string;
}

export default function ShareModal({ open, onClose, notebookId, notebookName }: ShareModalProps) {
  const {
    members,
    isLoading,
    fetchMembers,
    createInviteLink,
    updateMemberRole,
    removeMember,
    stopSharing,
    transferOwnership,
  } = useSharingStore();
  const currentUser = useAuthStore((s) => s.user);
  const [inviteRole, setInviteRole] = useState<"editor" | "viewer">("viewer");
  const [inviteUrl, setInviteUrl] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (open) {
      fetchMembers(notebookId);
      setInviteUrl("");
    }
  }, [open, notebookId, fetchMembers]);

  const currentUserRole = members.find((m) => m.user_id === currentUser?.id)?.role;
  const isOwner = currentUserRole === "owner";

  const handleCreateLink = useCallback(async () => {
    const link = await createInviteLink(notebookId, inviteRole);
    const url = `${window.location.origin}/join/${link.token}`;
    setInviteUrl(url);
  }, [notebookId, inviteRole, createInviteLink]);

  const handleCopy = () => {
    navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRoleChange = async (userId: string, role: string) => {
    await updateMemberRole(notebookId, userId, role);
  };

  const handleRemove = async (userId: string) => {
    await removeMember(notebookId, userId);
  };

  const handleStopSharing = async () => {
    if (confirm("Remove all members and stop sharing?")) {
      await stopSharing(notebookId);
      onClose();
    }
  };

  const handleTransfer = async (userId: string) => {
    if (confirm("Transfer ownership? You will become an editor.")) {
      await transferOwnership(notebookId, userId);
      await fetchMembers(notebookId);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={`Share "${notebookName}"`}>
      <div className="space-y-5">
        {/* Invite link section */}
        {isOwner && (
          <div>
            <h4 className="text-[13px] font-semibold text-[var(--text-secondary)] mb-2">
              Invite Link
            </h4>
            <div className="flex gap-2">
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as "editor" | "viewer")}
                className="px-3 py-2 text-[13px] border border-[var(--border)] rounded-lg bg-white"
              >
                <option value="viewer">Viewer</option>
                <option value="editor">Editor</option>
              </select>
              <button
                onClick={handleCreateLink}
                className="px-4 py-2 bg-[var(--accent)] text-white text-[13px] font-medium rounded-lg hover:opacity-90 transition-opacity"
              >
                Generate Link
              </button>
            </div>
            {inviteUrl && (
              <div className="mt-2 flex gap-2">
                <input
                  value={inviteUrl}
                  readOnly
                  className="flex-1 px-3 py-2 text-[12px] bg-gray-50 border border-[var(--border)] rounded-lg"
                />
                <button
                  onClick={handleCopy}
                  className="px-3 py-2 text-[12px] text-[var(--accent)] border border-[var(--accent)] rounded-lg hover:bg-blue-50 transition-colors"
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Members list */}
        <div>
          <h4 className="text-[13px] font-semibold text-[var(--text-secondary)] mb-2">
            Members ({members.length})
          </h4>
          {isLoading ? (
            <div className="flex justify-center py-4">
              <div className="w-5 h-5 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {members.map((member) => (
                <div
                  key={member.user_id}
                  className="flex items-center gap-3 py-2 px-2 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  <div className="w-8 h-8 rounded-full bg-[var(--accent)]/20 flex items-center justify-center text-[13px] font-semibold text-[var(--accent)] shrink-0">
                    {member.name[0]?.toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium truncate">
                      {member.name}
                      {member.user_id === currentUser?.id && (
                        <span className="text-[var(--text-tertiary)] ml-1">(you)</span>
                      )}
                    </p>
                    <p className="text-[11px] text-[var(--text-tertiary)] truncate">
                      {member.email}
                    </p>
                  </div>
                  {member.role === "owner" ? (
                    <span className="text-[11px] font-medium text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
                      Owner
                    </span>
                  ) : isOwner ? (
                    <div className="flex items-center gap-1">
                      <select
                        value={member.role}
                        onChange={(e) => handleRoleChange(member.user_id, e.target.value)}
                        className="text-[11px] px-2 py-0.5 border border-[var(--border)] rounded-lg bg-white"
                      >
                        <option value="editor">Editor</option>
                        <option value="viewer">Viewer</option>
                      </select>
                      <button
                        onClick={() => handleTransfer(member.user_id)}
                        className="text-[11px] text-amber-600 hover:underline ml-1"
                        title="Transfer ownership"
                      >
                        Transfer
                      </button>
                      <button
                        onClick={() => handleRemove(member.user_id)}
                        className="text-[11px] text-red-500 hover:underline ml-1"
                      >
                        Remove
                      </button>
                    </div>
                  ) : (
                    <span className="text-[11px] text-[var(--text-tertiary)] capitalize">
                      {member.role}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Stop sharing button (owner only) */}
        {isOwner && members.length > 1 && (
          <button
            onClick={handleStopSharing}
            className="text-[12px] text-red-500 hover:underline"
          >
            Stop sharing and remove all members
          </button>
        )}
      </div>
    </Modal>
  );
}
