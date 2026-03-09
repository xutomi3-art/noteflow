import { create } from "zustand";
import type { Source } from "@/types/api";
import { api } from "@/services/api";

interface SourceState {
  sources: Source[];
  selectedIds: Set<string>;
  isLoading: boolean;
  unsubscribe: (() => void) | null;

  fetchSources: (notebookId: string) => Promise<void>;
  uploadSource: (notebookId: string, file: File) => Promise<Source>;
  deleteSource: (notebookId: string, sourceId: string) => Promise<void>;
  toggleSelect: (sourceId: string) => void;
  selectAll: () => void;
  deselectAll: () => void;
  subscribeStatus: (notebookId: string) => void;
  cleanup: () => void;
}

export const useSourceStore = create<SourceState>((set, get) => ({
  sources: [],
  selectedIds: new Set(),
  isLoading: false,
  unsubscribe: null,

  fetchSources: async (notebookId: string) => {
    set({ isLoading: true });
    try {
      const sources = await api.listSources(notebookId);
      set({ sources });
      // Auto-select all ready sources
      const readyIds = new Set(
        sources.filter((s) => s.status === "ready").map((s) => s.id),
      );
      set({ selectedIds: readyIds });
    } finally {
      set({ isLoading: false });
    }
  },

  uploadSource: async (notebookId: string, file: File) => {
    const source = await api.uploadSource(notebookId, file);
    set((state) => ({ sources: [source, ...state.sources] }));
    return source;
  },

  deleteSource: async (notebookId: string, sourceId: string) => {
    await api.deleteSource(notebookId, sourceId);
    set((state) => ({
      sources: state.sources.filter((s) => s.id !== sourceId),
      selectedIds: new Set(
        [...state.selectedIds].filter((id) => id !== sourceId),
      ),
    }));
  },

  toggleSelect: (sourceId: string) => {
    set((state) => {
      const next = new Set(state.selectedIds);
      if (next.has(sourceId)) {
        next.delete(sourceId);
      } else {
        next.add(sourceId);
      }
      return { selectedIds: next };
    });
  },

  selectAll: () => {
    set((state) => ({
      selectedIds: new Set(
        state.sources.filter((s) => s.status === "ready").map((s) => s.id),
      ),
    }));
  },

  deselectAll: () => {
    set({ selectedIds: new Set() });
  },

  subscribeStatus: (notebookId: string) => {
    const { unsubscribe: prev } = get();
    if (prev) prev();

    const unsub = api.subscribeToSourceStatus(notebookId, (event) => {
      if (event.type === "source_status") {
        set((state) => {
          const sources = state.sources.map((s) =>
            s.id === event.source_id
              ? {
                  ...s,
                  status: event.status as Source["status"],
                  error_message: event.error || null,
                }
              : s,
          );
          // Auto-select newly ready sources
          const selectedIds = new Set(state.selectedIds);
          if (event.status === "ready") {
            selectedIds.add(event.source_id);
          }
          return { sources, selectedIds };
        });
      }
    });

    set({ unsubscribe: unsub });
  },

  cleanup: () => {
    const { unsubscribe } = get();
    if (unsubscribe) unsubscribe();
    set({ sources: [], selectedIds: new Set(), unsubscribe: null });
  },
}));
