"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Notebook } from "@/types/api";
import { useNotebookStore } from "@/stores/notebook-store";
import { api } from "@/services/api";

interface NotebookCardProps {
  notebook: Notebook;
}

export function NotebookCard({ notebook }: NotebookCardProps) {
  const router = useRouter();
  const { deleteNotebook, updateNotebook, fetchNotebooks } = useNotebookStore();
  const [menuOpen, setMenuOpen] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [newName, setNewName] = useState(notebook.name);

  const isOwner = notebook.user_role === "owner";

  const handleClick = () => {
    if (isRenaming) return;
    router.push(`/notebook/${notebook.id}`);
  };

  const handleRename = async () => {
    if (newName.trim() && newName !== notebook.name) {
      await updateNotebook(notebook.id, { name: newName.trim() });
    }
    setIsRenaming(false);
    setMenuOpen(false);
  };

  const handleDelete = async () => {
    if (confirm("Delete this notebook? This cannot be undone.")) {
      await deleteNotebook(notebook.id);
    }
    setMenuOpen(false);
  };

  const handleLeave = async () => {
    if (confirm("Leave this shared notebook?")) {
      await api.leaveNotebook(notebook.id);
      await fetchNotebooks();
    }
    setMenuOpen(false);
  };

  const formattedDate = new Date(notebook.updated_at).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

  return (
    <div
      onClick={handleClick}
      className="group relative bg-[var(--card-bg)] rounded-2xl p-5 cursor-pointer
        shadow-[var(--shadow-sm)] hover:shadow-[var(--shadow-md)]
        transition-all duration-300 ease-out
        hover:-translate-y-0.5 border border-[var(--border-light)]"
    >
      {/* Cover */}
      <div
        className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl mb-3"
        style={{ backgroundColor: notebook.cover_color + "18" }}
      >
        {notebook.emoji}
      </div>

      {/* Name */}
      {isRenaming ? (
        <input
          autoFocus
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onBlur={handleRename}
          onKeyDown={(e) => e.key === "Enter" && handleRename()}
          onClick={(e) => e.stopPropagation()}
          className="text-[15px] font-semibold w-full bg-transparent border-b border-[var(--accent)] outline-none pb-0.5"
        />
      ) : (
        <h3 className="text-[15px] font-semibold truncate">{notebook.name}</h3>
      )}

      {/* Meta */}
      <p className="text-[12px] text-[var(--text-secondary)] mt-1">
        {formattedDate} &middot; {notebook.source_count} source{notebook.source_count !== 1 ? "s" : ""}
      </p>

      {/* Member badge (shared notebooks) */}
      {notebook.is_shared && (
        <div className="mt-2 flex items-center gap-1">
          <span className="text-[11px] text-[var(--text-tertiary)] bg-gray-100 px-2 py-0.5 rounded-full flex items-center gap-1">
            <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" className="opacity-60">
              <path d="M13 13c0-2.761-2.239-5-5-5S3 10.239 3 13M8 8a3 3 0 100-6 3 3 0 000 6zm5.5 0a2.5 2.5 0 100-5 2.5 2.5 0 000 5M2.5 8a2.5 2.5 0 100-5 2.5 2.5 0 000 5" />
            </svg>
            {notebook.member_count}
          </span>
          {!isOwner && (
            <span className="text-[11px] text-[var(--text-tertiary)] capitalize bg-gray-100 px-2 py-0.5 rounded-full">
              {notebook.user_role}
            </span>
          )}
        </div>
      )}

      {/* Menu */}
      <button
        onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen); }}
        className="absolute top-3 right-3 w-7 h-7 flex items-center justify-center
          rounded-lg opacity-0 group-hover:opacity-100 hover:bg-gray-100
          transition-all text-[var(--text-secondary)]"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
          <circle cx="8" cy="3" r="1.5" />
          <circle cx="8" cy="8" r="1.5" />
          <circle cx="8" cy="13" r="1.5" />
        </svg>
      </button>

      {menuOpen && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute top-10 right-3 z-10 w-36 bg-[var(--card-bg)] rounded-xl
            shadow-[var(--shadow-lg)] border border-[var(--border-light)] py-1 overflow-hidden"
        >
          {isOwner ? (
            <>
              <button
                onClick={() => { setIsRenaming(true); setMenuOpen(false); }}
                className="w-full text-left px-3 py-2 text-[13px] hover:bg-gray-50 transition-colors"
              >
                Rename
              </button>
              <button
                onClick={handleDelete}
                className="w-full text-left px-3 py-2 text-[13px] text-[var(--danger)] hover:bg-red-50 transition-colors"
              >
                Delete
              </button>
            </>
          ) : (
            <button
              onClick={handleLeave}
              className="w-full text-left px-3 py-2 text-[13px] text-[var(--danger)] hover:bg-red-50 transition-colors"
            >
              Leave
            </button>
          )}
        </div>
      )}
    </div>
  );
}
