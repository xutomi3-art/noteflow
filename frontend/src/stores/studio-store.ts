import { create } from "zustand";
import type { SavedNote, CustomSkill } from "@/types/api";
import { api } from "@/services/api";

interface PdfViewerState {
  sourceId: string;
  filename: string;
  page: number;
  _seq: number;
}

interface StudioState {
  activeTab: "summary" | "faq" | "study_guide" | "ppt" | "mindmap" | "podcast" | "action_items" | "notes" | null;
  content: Record<string, string>;
  isGenerating: Record<string, boolean>;
  notes: SavedNote[];
  isLoadingNotes: boolean;
  pdfViewer: PdfViewerState | null;
  customSkills: CustomSkill[];

  setActiveTab: (tab: StudioState["activeTab"]) => void;
  generateContent: (notebookId: string, contentType: string, sourceIds?: string[]) => Promise<void>;
  clearContent: (contentType: string) => void;
  fetchNotes: (notebookId: string) => Promise<void>;
  deleteNote: (notebookId: string, noteId: string) => Promise<void>;
  openPdf: (sourceId: string, filename: string, page: number) => void;
  closePdf: () => void;
  fetchCustomSkills: (notebookId: string) => Promise<void>;
  createCustomSkill: (notebookId: string, data: { name: string; prompt: string; icon?: string; all_notebooks?: boolean; shared_with_team?: boolean }) => Promise<CustomSkill>;
  deleteCustomSkill: (notebookId: string, skillId: string) => Promise<void>;
  executeCustomSkill: (notebookId: string, skillId: string, sourceIds?: string[]) => Promise<void>;
  reset: () => void;
}

export const useStudioStore = create<StudioState>((set, get) => ({
  activeTab: null,
  content: {},
  isGenerating: {},
  notes: [],
  isLoadingNotes: false,
  pdfViewer: null,
  customSkills: [],

  setActiveTab: (tab) => set({ activeTab: tab }),

  openPdf: (sourceId, filename, page) => set(state => ({
    pdfViewer: { sourceId, filename, page, _seq: (state.pdfViewer?._seq ?? 0) + 1 },
  })),

  closePdf: () => set({ pdfViewer: null }),

  clearContent: (contentType: string) => {
    set(state => {
      const content = { ...state.content };
      delete content[contentType];
      return { content };
    });
  },

  generateContent: async (notebookId: string, contentType: string, sourceIds?: string[]) => {
    // Clear previous content (including error messages) before retrying
    set(state => {
      const content = { ...state.content };
      delete content[contentType];
      return { content, isGenerating: { ...state.isGenerating, [contentType]: true } };
    });
    try {
      let content = await api.generateStudioContent(notebookId, contentType, sourceIds);
      // Strip ```json fences from mindmap content so the frontend can parse it as JSON
      if (contentType === "mindmap") {
        const stripped = content.trim();
        if (stripped.startsWith("```")) {
          content = stripped.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
        }
      }
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

  fetchCustomSkills: async (notebookId: string) => {
    try {
      const skills = await api.listCustomSkills(notebookId);
      set({ customSkills: skills });
    } catch {
      // silently fail
    }
  },

  createCustomSkill: async (notebookId, data) => {
    const skill = await api.createCustomSkill(notebookId, data);
    set(state => ({ customSkills: [...state.customSkills, skill] }));
    return skill;
  },

  deleteCustomSkill: async (notebookId, skillId) => {
    await api.deleteCustomSkill(notebookId, skillId);
    set(state => ({ customSkills: state.customSkills.filter(s => s.id !== skillId) }));
  },

  executeCustomSkill: async (notebookId, skillId, sourceIds) => {
    set(state => ({ isGenerating: { ...state.isGenerating, [skillId]: true } }));
    try {
      const content = await api.executeCustomSkill(notebookId, skillId, sourceIds);
      set(state => ({ content: { ...state.content, [skillId]: content } }));
    } catch (err) {
      set(state => ({ content: { ...state.content, [skillId]: `Error: ${err}` } }));
    } finally {
      set(state => ({ isGenerating: { ...state.isGenerating, [skillId]: false } }));
    }
  },

  reset: () => set({ activeTab: null, content: {}, isGenerating: {}, notes: [], isLoadingNotes: false, pdfViewer: null, customSkills: [] }),
}));
