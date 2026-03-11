import { useState, useEffect, useCallback } from "react";
import { X, Copy, Link, Users, ChevronDown, Trash2, Check } from "lucide-react";
import { useSharingStore } from "@/stores/sharing-store";

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  notebookId: string;
}

export default function ShareModal({ isOpen, onClose, notebookId }: ShareModalProps) {
  const { members, isLoading, fetchMembers, createInviteLink, updateMemberRole, removeMember } =
    useSharingStore();

  const [inviteRole, setInviteRole] = useState<string>("viewer");
  const [generatedLink, setGeneratedLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [roleDropdownOpen, setRoleDropdownOpen] = useState(false);
  const [memberDropdownId, setMemberDropdownId] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && notebookId) {
      fetchMembers(notebookId);
      setGeneratedLink(null);
      setCopied(false);
    }
  }, [isOpen, notebookId, fetchMembers]);

  const handleGenerateLink = useCallback(async () => {
    try {
      const link = await createInviteLink(notebookId, inviteRole);
      const url = `${window.location.origin}/join/${link.token}`;
      setGeneratedLink(url);
      setCopied(false);
    } catch (err) {
      console.error("Failed to generate invite link:", err);
    }
  }, [notebookId, inviteRole, createInviteLink]);

  const handleCopyLink = useCallback(() => {
    if (!generatedLink) return;
    navigator.clipboard.writeText(generatedLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [generatedLink]);

  const handleRoleChange = useCallback(
    async (userId: string, role: string) => {
      await updateMemberRole(notebookId, userId, role);
      setMemberDropdownId(null);
    },
    [notebookId, updateMemberRole],
  );

  const handleRemoveMember = useCallback(
    async (userId: string) => {
      await removeMember(notebookId, userId);
    },
    [notebookId, removeMember],
  );

  if (!isOpen) return null;

  const owner = members.find((m) => m.role === "owner");
  const nonOwnerMembers = members.filter((m) => m.role !== "owner");
  const isOwner = !!owner; // current user can manage if owner exists in the list

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-white rounded-2xl shadow-[0_25px_60px_rgb(0,0,0,0.15)] w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <Users className="w-5 h-5 text-slate-600" />
            <h2 className="text-[16px] font-semibold text-slate-900">Share Notebook</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-5 space-y-6">
          {/* Invite Link Section */}
          <div>
            <h3 className="text-[13px] font-semibold text-slate-700 mb-3">Invite Link</h3>
            <div className="flex items-center gap-2">
              {/* Role Dropdown */}
              <div className="relative">
                <button
                  onClick={() => setRoleDropdownOpen(!roleDropdownOpen)}
                  className="flex items-center gap-1.5 px-3 py-2 border border-slate-200 rounded-lg text-[13px] text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  <span className="capitalize">{inviteRole}</span>
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                </button>
                {roleDropdownOpen && (
                  <div className="absolute top-full left-0 mt-1 w-32 bg-white border border-slate-200 rounded-xl shadow-lg py-1 z-10">
                    {["viewer", "editor"].map((role) => (
                      <button
                        key={role}
                        onClick={() => {
                          setInviteRole(role);
                          setRoleDropdownOpen(false);
                          setGeneratedLink(null);
                        }}
                        className={`w-full text-left px-3 py-2 text-[13px] hover:bg-slate-50 transition-colors capitalize ${
                          inviteRole === role ? "text-[#5b8c15] font-medium" : "text-slate-700"
                        }`}
                      >
                        {role}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Generate Button */}
              <button
                onClick={handleGenerateLink}
                className="flex items-center gap-2 px-4 py-2 bg-[#5b8c15] text-white rounded-lg text-[13px] font-medium hover:bg-[#4a7311] transition-colors"
              >
                <Link className="w-3.5 h-3.5" />
                Generate Link
              </button>
            </div>

            {/* Generated Link Display */}
            {generatedLink && (
              <div className="mt-3 flex items-center gap-2 p-3 bg-slate-50 rounded-xl border border-slate-100">
                <input
                  type="text"
                  readOnly
                  value={generatedLink}
                  className="flex-1 bg-transparent text-[12px] text-slate-600 outline-none truncate"
                />
                <button
                  onClick={handleCopyLink}
                  className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors shrink-0 ${
                    copied
                      ? "bg-green-100 text-green-700"
                      : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  {copied ? (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      Copy
                    </>
                  )}
                </button>
              </div>
            )}
          </div>

          {/* Members Section */}
          <div>
            <h3 className="text-[13px] font-semibold text-slate-700 mb-3">
              Members ({members.length})
            </h3>

            {isLoading ? (
              <div className="text-center py-6 text-[13px] text-slate-400">Loading members...</div>
            ) : (
              <div className="space-y-1 max-h-[240px] overflow-y-auto">
                {members.map((member) => (
                  <div
                    key={member.user_id}
                    className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-slate-50 transition-colors group"
                  >
                    {/* Avatar */}
                    <div className="w-8 h-8 rounded-full bg-[#5b8c15] text-white flex items-center justify-center text-[13px] font-semibold shrink-0">
                      {(member.name || member.email || "U").charAt(0).toUpperCase()}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium text-slate-800 truncate">
                        {member.name || member.email}
                      </p>
                      <p className="text-[11px] text-slate-400 truncate">{member.email}</p>
                    </div>

                    {/* Role */}
                    {member.role === "owner" ? (
                      <span className="text-[11px] font-medium text-slate-500 bg-slate-100 px-2.5 py-1 rounded-full">
                        Owner
                      </span>
                    ) : (
                      <div className="relative flex items-center gap-1">
                        <button
                          onClick={() =>
                            setMemberDropdownId(
                              memberDropdownId === member.user_id ? null : member.user_id,
                            )
                          }
                          className="flex items-center gap-1 text-[11px] font-medium text-slate-500 bg-slate-100 px-2.5 py-1 rounded-full hover:bg-slate-200 transition-colors capitalize"
                        >
                          {member.role}
                          <ChevronDown className="w-3 h-3" />
                        </button>

                        {memberDropdownId === member.user_id && (
                          <div className="absolute top-full right-0 mt-1 w-32 bg-white border border-slate-200 rounded-xl shadow-lg py-1 z-10">
                            {["viewer", "editor"].map((role) => (
                              <button
                                key={role}
                                onClick={() => handleRoleChange(member.user_id, role)}
                                className={`w-full text-left px-3 py-2 text-[12px] hover:bg-slate-50 transition-colors capitalize ${
                                  member.role === role
                                    ? "text-[#5b8c15] font-medium"
                                    : "text-slate-700"
                                }`}
                              >
                                {role}
                              </button>
                            ))}
                          </div>
                        )}

                        <button
                          onClick={() => handleRemoveMember(member.user_id)}
                          className="p-1 text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                ))}

                {members.length === 0 && !isLoading && (
                  <div className="text-center py-6 text-[13px] text-slate-400">
                    No members yet. Share the invite link to add members.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
