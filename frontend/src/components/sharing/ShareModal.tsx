import { useState, useEffect, useCallback } from "react";
import { X, Copy, Link, ChevronDown, Trash2, Check, UserPlus, Mail, Loader2 } from "lucide-react";
import { useSharingStore } from "@/stores/sharing-store";

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  notebookId: string;
  /** Called after successfully adding a member (e.g. to refresh notebook data) */
  onMemberAdded?: () => void;
}

interface InvitedEmail {
  email: string;
  role: string;
  status: "sending" | "sent" | "failed";
}

export default function ShareModal({ isOpen, onClose, notebookId, onMemberAdded }: ShareModalProps) {
  const { members, fetchMembers, createInviteLink, sendEmailInvite, removeMember } =
    useSharingStore();

  const [emailInput, setEmailInput] = useState("");
  const [inviteRole, setInviteRole] = useState<string>("viewer");
  const [roleDropdownOpen, setRoleDropdownOpen] = useState(false);
  const [generatedLink, setGeneratedLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showLinkSection, setShowLinkSection] = useState(false);
  const [invitedEmails, setInvitedEmails] = useState<InvitedEmail[]>([]);

  useEffect(() => {
    if (isOpen && notebookId) {
      fetchMembers(notebookId);
      setGeneratedLink(null);
      setCopied(false);
      setShowLinkSection(false);
      setEmailInput("");
      setInvitedEmails([]);
    }
  }, [isOpen, notebookId, fetchMembers]);

  const handleAddByEmail = useCallback(async () => {
    const email = emailInput.trim();
    if (!email) return;
    // Don't add duplicates
    if (invitedEmails.some((e) => e.email === email)) return;

    const entry: InvitedEmail = { email, role: inviteRole, status: "sending" };
    setInvitedEmails((prev) => [...prev, entry]);
    setEmailInput("");

    try {
      // Send email invite directly (backend creates invite link + sends email)
      await sendEmailInvite(notebookId, email, inviteRole);
      setInvitedEmails((prev) =>
        prev.map((e) => (e.email === email ? { ...e, status: "sent" } : e)),
      );
      fetchMembers(notebookId);
      onMemberAdded?.();
    } catch {
      // Email send failed — create invite link as fallback
      try {
        const link = await createInviteLink(notebookId, inviteRole);
        const url = `${window.location.origin}/join/${link.token}`;
        setGeneratedLink(url);
        setShowLinkSection(true);
        setInvitedEmails((prev) =>
          prev.map((e) => (e.email === email ? { ...e, status: "sent" } : e)),
        );
        onMemberAdded?.();
      } catch {
        setInvitedEmails((prev) =>
          prev.map((e) => (e.email === email ? { ...e, status: "failed" } : e)),
        );
      }
    }
  }, [emailInput, inviteRole, notebookId, sendEmailInvite, createInviteLink, fetchMembers, onMemberAdded]);

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

  const handleRemoveInvited = useCallback((email: string) => {
    setInvitedEmails((prev) => prev.filter((e) => e.email !== email));
  }, []);

  const handleRemoveMember = useCallback(
    async (userId: string) => {
      await removeMember(notebookId, userId);
    },
    [notebookId, removeMember],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.key === "Enter" || e.key === ",") && !e.nativeEvent.isComposing) {
        e.preventDefault();
        handleAddByEmail();
      }
    },
    [handleAddByEmail],
  );

  if (!isOpen) return null;

  const nonOwnerMembers = members.filter((m) => m.role !== "owner");

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
            <UserPlus className="w-5 h-5 text-slate-600" />
            <h2 className="text-[16px] font-semibold text-slate-900">Invite your team members</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-5 space-y-5">
          {/* Email Input + Role + Add Button */}
          <div>
            <div className="flex items-center gap-2">
              <div className="flex-1 flex items-center gap-2 border border-slate-200 rounded-xl px-3 py-2 focus-within:border-[#5b8c15] focus-within:ring-1 focus-within:ring-[#5b8c15]/20 transition-all">
                <Mail className="w-4 h-4 text-slate-400 shrink-0" />
                <input
                  type="email"
                  placeholder="Enter email address"
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  className="flex-1 text-[13px] text-slate-700 outline-none bg-transparent placeholder:text-slate-400"
                  autoFocus
                />
              </div>

              {/* Role Dropdown */}
              <div className="relative">
                <button
                  onClick={() => setRoleDropdownOpen(!roleDropdownOpen)}
                  className="flex items-center gap-1 px-3 py-2 border border-slate-200 rounded-xl text-[13px] text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  <span className="capitalize">{inviteRole}</span>
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                </button>
                {roleDropdownOpen && (
                  <div className="absolute top-full left-0 mt-1 w-28 bg-white border border-slate-200 rounded-xl shadow-lg py-1 z-10">
                    {["viewer", "editor"].map((role) => (
                      <button
                        key={role}
                        onClick={() => {
                          setInviteRole(role);
                          setRoleDropdownOpen(false);
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

              {/* Add Button */}
              <button
                onClick={handleAddByEmail}
                disabled={!emailInput.trim()}
                className="px-4 py-2 bg-[#5b8c15] text-white rounded-xl text-[13px] font-medium hover:bg-[#4a7311] transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
              >
                Add
              </button>
            </div>
          </div>

          {/* Invited Emails List */}
          {invitedEmails.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {invitedEmails.map((entry) => (
                <div
                  key={entry.email}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium border ${
                    entry.status === "sending"
                      ? "bg-slate-50 text-slate-500 border-slate-200"
                      : entry.status === "sent"
                        ? "bg-green-50 text-green-700 border-green-200"
                        : "bg-red-50 text-red-600 border-red-200"
                  }`}
                >
                  {entry.status === "sending" && <Loader2 className="w-3 h-3 animate-spin" />}
                  {entry.status === "sent" && <Check className="w-3 h-3" />}
                  {entry.email}
                  <span className="text-[10px] opacity-60 capitalize">{entry.role}</span>
                  <button
                    onClick={() => handleRemoveInvited(entry.email)}
                    className="text-current opacity-40 hover:opacity-80"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Invite Link Section (toggle) */}
          <div>
            {!showLinkSection ? (
              <button
                onClick={() => {
                  setShowLinkSection(true);
                  if (!generatedLink) handleGenerateLink();
                }}
                className="flex items-center gap-2 text-[13px] text-slate-500 hover:text-[#5b8c15] transition-colors"
              >
                <Link className="w-3.5 h-3.5" />
                Or generate an invite link
              </button>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-[13px] text-slate-600">
                  <Link className="w-3.5 h-3.5" />
                  <span className="font-medium">Invite Link</span>
                </div>
                {generatedLink ? (
                  <div className="flex items-center gap-2 p-3 bg-slate-50 rounded-xl border border-slate-100">
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
                ) : (
                  <button
                    onClick={handleGenerateLink}
                    className="flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-700 rounded-xl text-[13px] font-medium hover:bg-slate-200 transition-colors"
                  >
                    Generate Link
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Current Members */}
          {nonOwnerMembers.length > 0 && (
            <div>
              <h3 className="text-[12px] font-semibold text-slate-500 uppercase tracking-wider mb-2">
                Members ({nonOwnerMembers.length})
              </h3>
              <div className="space-y-1 max-h-[160px] overflow-y-auto">
                {nonOwnerMembers.map((member) => (
                  <div
                    key={member.user_id}
                    className="flex items-center gap-3 p-2 rounded-xl hover:bg-slate-50 transition-colors group"
                  >
                    <div className="w-7 h-7 rounded-full bg-[#5b8c15] text-white flex items-center justify-center text-[12px] font-semibold shrink-0">
                      {(member.name || member.email || "U").charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium text-slate-800 truncate">
                        {member.name || member.email}
                      </p>
                    </div>
                    <span className="text-[11px] text-slate-400 capitalize">{member.role}</span>
                    <button
                      onClick={() => handleRemoveMember(member.user_id)}
                      className="p-1 text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-100 flex justify-end">
          <button
            onClick={onClose}
            className="px-6 py-2.5 bg-[#5b8c15] text-white rounded-xl text-[13px] font-semibold hover:bg-[#4a7311] transition-colors shadow-sm"
          >
            Finish & Open Notebook
          </button>
        </div>
      </div>
    </div>
  );
}
