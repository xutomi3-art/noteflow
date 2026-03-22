import { create } from "zustand";
import type { Source } from "@/types/api";
import { api } from "@/services/api";

interface SourceState {
  sources: Source[];
  selectedIds: Set<string>;
  isLoading: boolean;
  unsubscribe: (() => void) | null;
  activeSourceId: string | null;
  activeSourceContent: string | null;
  isLoadingContent: boolean;
  highlightExcerpt: string | null;
  raptorStatus: "idle" | "running" | "done" | "failed";

  fetchSources: (notebookId: string) => Promise<void>;
  uploadSource: (notebookId: string, file: File) => Promise<Source>;
  deleteSource: (notebookId: string, sourceId: string) => Promise<void>;
  toggleSelect: (sourceId: string) => void;
  selectAll: () => void;
  deselectAll: () => void;
  subscribeStatus: (notebookId: string) => void;
  setActiveSource: (notebookId: string, sourceId: string | null, excerpt?: string | null) => Promise<void>;
  clearActiveSource: () => void;
  setHighlightExcerpt: (excerpt: string | null) => void;
  cleanup: () => void;
}

export const useSourceStore = create<SourceState>((set, get) => ({
  sources: [],
  selectedIds: new Set(),
  isLoading: false,
  unsubscribe: null,
  activeSourceId: null,
  activeSourceContent: null,
  isLoadingContent: false,
  highlightExcerpt: null,
  raptorStatus: "idle",

  fetchSources: async (notebookId: string) => {
    set({ isLoading: true });
    try {
      const sources = await api.listSources(notebookId);
      const { selectedIds: currentSelected } = get();
      // Only auto-select all ready sources on initial load (when nothing is selected)
      // On subsequent fetches, preserve user's selections and add newly ready sources
      if (currentSelected.size === 0) {
        const readyIds = new Set(
          sources.filter((s) => s.status === "ready").map((s) => s.id),
        );
        set({ sources, selectedIds: readyIds });
      } else {
        set({ sources });
      }
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
    // Optimistic delete: remove from UI immediately, then clean up server-side
    const prev = get().sources;
    const prevSelected = get().selectedIds;
    set((state) => ({
      sources: state.sources.filter((s) => s.id !== sourceId),
      selectedIds: new Set(
        [...state.selectedIds].filter((id) => id !== sourceId),
      ),
    }));
    try {
      await api.deleteSource(notebookId, sourceId);
    } catch {
      // Rollback on failure
      set({ sources: prev, selectedIds: prevSelected });
    }
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

    // Debounce timer for unknown-source refetch to avoid duplicate requests
    let refetchTimer: ReturnType<typeof setTimeout> | null = null;

    const unsub = api.subscribeToSourceStatus(notebookId, (event) => {
      if (event.type === "raptor_status") {
        const status = event.status as "idle" | "running" | "done" | "failed";
        set({ raptorStatus: status });
        // Auto-clear "done" after 5 seconds
        if (status === "done") {
          setTimeout(() => set({ raptorStatus: "idle" }), 5000);
        }
        return;
      }
      if (event.type === "source_status") {
        const { sources, isLoading } = get();
        const known = sources.some((s) => s.id === event.source_id);
        if (!known) {
          // Unknown source — another user uploaded it; debounce the reload
          if (!isLoading && !refetchTimer) {
            refetchTimer = setTimeout(() => {
              refetchTimer = null;
              // After reload, auto-select any newly ready sources
              get().fetchSources(notebookId).then(() => {
                set((state) => {
                  const selectedIds = new Set(state.selectedIds);
                  state.sources.filter((s) => s.status === "ready").forEach((s) => selectedIds.add(s.id));
                  return { selectedIds };
                });
              });
            }, 500);
          }
          return;
        }
        set((state) => {
          const updatedSources = state.sources.map((s) =>
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
          return { sources: updatedSources, selectedIds };
        });
      }
    });

    set({ unsubscribe: unsub });
  },

  setActiveSource: async (notebookId: string, sourceId: string | null, excerpt?: string | null) => {
    if (sourceId === null) {
      set({ activeSourceId: null, activeSourceContent: null, isLoadingContent: false, highlightExcerpt: null });
      return;
    }
    // If same source is already active, just update the highlight excerpt
    if (sourceId === get().activeSourceId) {
      set({ highlightExcerpt: excerpt ?? null });
      return;
    }
    set({ activeSourceId: sourceId, activeSourceContent: null, isLoadingContent: true, highlightExcerpt: excerpt ?? null });
    try {
      const result = await api.getSourceContent(notebookId, sourceId);
      // Only update if this source is still the active one
      if (get().activeSourceId === sourceId) {
        set({ activeSourceContent: result.content, isLoadingContent: false });
      }
    } catch {
      if (get().activeSourceId === sourceId) {
        set({ activeSourceContent: null, isLoadingContent: false });
      }
    }
  },

  clearActiveSource: () => {
    set({ activeSourceId: null, activeSourceContent: null, isLoadingContent: false, highlightExcerpt: null });
  },

  setHighlightExcerpt: (excerpt: string | null) => {
    set({ highlightExcerpt: excerpt });
  },

  cleanup: () => {
    const { unsubscribe } = get();
    if (unsubscribe) unsubscribe();
    set({ sources: [], selectedIds: new Set(), unsubscribe: null, activeSourceId: null, activeSourceContent: null, isLoadingContent: false, highlightExcerpt: null, raptorStatus: "idle" });
  },
}));
