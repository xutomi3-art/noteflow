import { create } from "zustand";
import type { Notebook } from "@/types/api";
import { api } from "@/services/api";

interface NotebookState {
  notebooks: Notebook[];
  isLoading: boolean;

  fetchNotebooks: () => Promise<void>;
  createNotebook: (data: { name: string; emoji?: string; cover_color?: string; is_team?: boolean; custom_prompt?: string }) => Promise<Notebook>;
  updateNotebook: (id: string, data: { name?: string; emoji?: string; cover_color?: string; custom_prompt?: string }) => Promise<void>;
  deleteNotebook: (id: string) => Promise<void>;
}

export const useNotebookStore = create<NotebookState>((set, get) => ({
  notebooks: [],
  isLoading: false,

  fetchNotebooks: async () => {
    set({ isLoading: true });
    const notebooks = await api.listNotebooks();
    set({ notebooks, isLoading: false });
  },

  createNotebook: async (data) => {
    const notebook = await api.createNotebook(data);
    set((state) => ({ notebooks: [notebook, ...state.notebooks] }));
    return notebook;
  },

  updateNotebook: async (id, data) => {
    const updated = await api.updateNotebook(id, data);
    set((state) => ({
      notebooks: state.notebooks.map((nb) => (nb.id === id ? updated : nb)),
    }));
  },

  deleteNotebook: async (id) => {
    await api.deleteNotebook(id);
    set((state) => ({
      notebooks: state.notebooks.filter((nb) => nb.id !== id),
    }));
  },
}));
