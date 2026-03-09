import { create } from "zustand";
import type { SavedNote } from "@/types/api";
import { api } from "@/services/api";

interface StudioState {
  activeTab: "summary" | "faq" | "study_guide" | "ppt" | "mindmap" | "podcast" | "notes" | null;
  content: Record<string, string>;  // content_type -> generated content
  isGenerating: Record<string, boolean>;
  notes: SavedNote[];
  isLoadingNotes: boolean;

  setActiveTab: (tab: StudioState["activeTab"]) => void;
  generateContent: (notebookId: string, contentType: string) => Promise<void>;
  fetchNotes: (notebookId: string) => Promise<void>;
  deleteNote: (notebookId: string, noteId: string) => Promise<void>;
  reset: () => void;
}

export const useStudioStore = create<StudioState>((set, get) => ({
  activeTab: null,
  content: {},
  isGenerating: {},
  notes: [],
  isLoadingNotes: false,

  setActiveTab: (tab) => set({ activeTab: tab }),

  generateContent: async (notebookId: string, contentType: string) => {
    set(state => ({ isGenerating: { ...state.isGenerating, [contentType]: true } }));
    try {
      const content = await api.generateStudioContent(notebookId, contentType);
      set(state => ({
        content: { ...state.content, [contentType]: content },
      }));
    } catch (err) {
      set(state => ({
        content: { ...state.content, [contentType]: `Error generating content: ${err}` },
      }));
    } finally {
      set(state => ({ isGenerating: { ...state.isGenerating, [contentType]: false } }));
    }
  },

  fetchNotes: async (notebookId: string) => {
    set({ isLoadingNotes: true });
    try {
      const notes = await api.listNotes(notebookId);
      set({ notes });
    } finally {
      set({ isLoadingNotes: false });
    }
  },

  deleteNote: async (notebookId: string, noteId: string) => {
    await api.deleteNote(notebookId, noteId);
    set(state => ({
      notes: state.notes.filter(n => n.id !== noteId),
    }));
  },

  reset: () => set({ activeTab: null, content: {}, isGenerating: {}, notes: [], isLoadingNotes: false }),
}));
