"use client";

import { useEffect, useCallback } from "react";
import { useSourceStore } from "@/stores/source-store";
import { useStudioStore } from "@/stores/studio-store";
import SourceItem from "./SourceItem";
import UploadDropZone from "./UploadDropZone";

interface SourcesPanelProps {
  notebookId: string;
  userRole?: string;
}

export default function SourcesPanel({ notebookId, userRole = "owner" }: SourcesPanelProps) {
  const {
    sources,
    selectedIds,
    isLoading,
    fetchSources,
    uploadSource,
    deleteSource,
    toggleSelect,
    selectAll,
    deselectAll,
    subscribeStatus,
    cleanup,
  } = useSourceStore();

  const openPdf = useStudioStore(state => state.openPdf);

  useEffect(() => {
    fetchSources(notebookId);
    subscribeStatus(notebookId);
    return () => cleanup();
  }, [notebookId, fetchSources, subscribeStatus, cleanup]);

  const handleUpload = useCallback(
    async (files: File[]) => {
      for (const file of files) {
        try {
          await uploadSource(notebookId, file);
        } catch (err) {
          console.error("Upload failed:", err);
        }
      }
    },
    [notebookId, uploadSource],
  );

  const handleDelete = useCallback(
    async (sourceId: string) => {
      try {
        await deleteSource(notebookId, sourceId);
      } catch (err) {
        console.error("Delete failed:", err);
      }
    },
    [notebookId, deleteSource],
  );

  const readyCount = sources.filter((s) => s.status === "ready").length;
  const allSelected = readyCount > 0 && selectedIds.size === readyCount;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[13px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
          Sources
        </h3>
        {sources.length > 0 && (
          <span className="text-[12px] text-[var(--text-tertiary)]">
            {sources.length} file{sources.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {userRole !== "viewer" && <UploadDropZone onUpload={handleUpload} />}

      {sources.length > 0 && (
        <>
          <div className="flex items-center justify-between mt-3 mb-1 px-1">
            <button
              onClick={allSelected ? deselectAll : selectAll}
              className="text-[12px] text-[var(--accent)] hover:underline"
            >
              {allSelected ? "Deselect all" : "Select all"}
            </button>
            <span className="text-[11px] text-[var(--text-tertiary)]">
              {selectedIds.size} selected
            </span>
          </div>

          <div className="flex-1 overflow-y-auto mt-1 -mx-1">
            {isLoading ? (
              <div className="flex justify-center py-8">
                <div className="w-5 h-5 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
              </div>
            ) : (
              sources.map((source) => (
                <SourceItem
                  key={source.id}
                  source={source}
                  selected={selectedIds.has(source.id)}
                  onToggle={() => toggleSelect(source.id)}
                  onDelete={() => handleDelete(source.id)}
                  onOpenPdf={openPdf}
                />
              ))
            )}
          </div>
        </>
      )}

      {sources.length === 0 && !isLoading && (
        <p className="text-[13px] text-[var(--text-tertiary)] mt-3 text-center">
          Upload documents to get started
        </p>
      )}
    </div>
  );
}
