"use client";

import type { SavedNote } from "@/types/api";

interface SavedNotesListProps {
  notes: SavedNote[];
  isLoading: boolean;
  onDelete: (noteId: string) => void;
}

export default function SavedNotesList({ notes, isLoading, onDelete }: SavedNotesListProps) {
  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <div className="w-5 h-5 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (notes.length === 0) {
    return (
      <p className="text-[13px] text-[var(--text-tertiary)] text-center py-4">
        No saved notes yet. Save messages from chat using the &quot;Save to note&quot; button.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {notes.map(note => (
        <div
          key={note.id}
          className="group p-3 bg-gray-50 rounded-xl text-[13px] leading-relaxed relative"
        >
          <div className="whitespace-pre-wrap line-clamp-6">{note.content}</div>
          <div className="flex items-center justify-between mt-2 pt-2 border-t border-[var(--border-light)]">
            <span className="text-[11px] text-[var(--text-tertiary)]">
              {new Date(note.created_at).toLocaleDateString()}
            </span>
            <button
              onClick={() => onDelete(note.id)}
              className="text-[11px] text-[var(--text-tertiary)] hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
            >
              Delete
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
