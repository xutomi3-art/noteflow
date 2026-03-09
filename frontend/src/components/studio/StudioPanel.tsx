"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useStudioStore } from "@/stores/studio-store";
import { useSourceStore } from "@/stores/source-store";
import { api } from "@/services/api";
import StudioContentView from "./StudioContentView";
import SavedNotesList from "./SavedNotesList";

const MindMap = dynamic(() => import("./MindMap"), { ssr: false });

interface StudioPanelProps {
  notebookId: string;
}

const TABS = [
  { key: "summary" as const, icon: "\uD83D\uDCDD", label: "Summary" },
  { key: "faq" as const, icon: "\uD83D\uDDC2", label: "FAQ" },
  { key: "study_guide" as const, icon: "\uD83D\uDCD6", label: "Study Guide" },
  { key: "ppt" as const, icon: "\uD83D\uDCCA", label: "PPT" },
  { key: "mindmap" as const, icon: "\uD83E\uDDE0", label: "Mind Map" },
  { key: "podcast" as const, icon: "\uD83C\uDFA7", label: "Podcast" },
  { key: "notes" as const, icon: "\uD83D\uDCCC", label: "Saved Notes" },
];

export default function StudioPanel({ notebookId }: StudioPanelProps) {
  const {
    activeTab,
    content,
    isGenerating,
    notes,
    isLoadingNotes,
    setActiveTab,
    generateContent,
    fetchNotes,
    deleteNote,
    reset,
  } = useStudioStore();

  const hasReadySources = useSourceStore(state => state.sources.some(s => s.status === "ready"));

  const [isPPTLoading, setIsPPTLoading] = useState(false);
  const [pptError, setPPTError] = useState<string | null>(null);

  const [podcastUrl, setPodcastUrl] = useState<string | null>(null);
  const [isPodcastLoading, setIsPodcastLoading] = useState(false);
  const [podcastError, setPodcastError] = useState<string | null>(null);

  useEffect(() => {
    fetchNotes(notebookId);
    return () => reset();
  }, [notebookId, fetchNotes, reset]);

  const handlePPTDownload = async () => {
    setIsPPTLoading(true);
    setPPTError(null);
    try {
      await api.downloadPPT(notebookId);
    } catch (err) {
      setPPTError(err instanceof Error ? err.message : "Failed to generate PPT");
    } finally {
      setIsPPTLoading(false);
    }
  };

  const handleGeneratePodcast = async () => {
    setIsPodcastLoading(true);
    setPodcastError(null);
    try {
      const url = await api.generatePodcast(notebookId);
      setPodcastUrl(url);
    } catch (err) {
      setPodcastError(err instanceof Error ? err.message : 'Failed to generate podcast');
    } finally {
      setIsPodcastLoading(false);
    }
  };

  const handleTabClick = (tabKey: typeof TABS[number]["key"]) => {
    if (activeTab === tabKey) {
      setActiveTab(null);
      return;
    }
    setActiveTab(tabKey);

    // Auto-generate content if not already generated
    if (tabKey !== "notes" && tabKey !== "ppt" && tabKey !== "podcast" && !content[tabKey] && !isGenerating[tabKey] && hasReadySources) {
      generateContent(notebookId, tabKey);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <h3 className="text-[13px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-3">
        Studio
      </h3>

      <div className="flex flex-col gap-1.5">
        {TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => handleTabClick(tab.key)}
            disabled={tab.key !== "notes" && !hasReadySources}
            className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-[14px] text-left transition-colors
              ${activeTab === tab.key
                ? "bg-[var(--accent)]/10 text-[var(--accent)] font-medium"
                : "hover:bg-gray-50"
              }
              ${tab.key !== "notes" && !hasReadySources ? "opacity-50 cursor-not-allowed" : ""}
            `}
          >
            <span>{tab.icon}</span>
            <span>{tab.label}</span>
            {tab.key !== "notes" && isGenerating[tab.key] && (
              <div className="ml-auto w-3 h-3 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
            )}
            {tab.key === "notes" && notes.length > 0 && (
              <span className="ml-auto text-[11px] bg-gray-200 px-1.5 py-0.5 rounded-full">
                {notes.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Content area */}
      {activeTab && (
        <div className="mt-3 pt-3 border-t border-[var(--border-light)] flex-1 overflow-y-auto">
          {activeTab === "notes" ? (
            <SavedNotesList
              notes={notes}
              isLoading={isLoadingNotes}
              onDelete={(noteId) => deleteNote(notebookId, noteId)}
            />
          ) : activeTab === "ppt" ? (
            <div className="flex flex-col items-center gap-4 p-6">
              <p className="text-center text-sm text-gray-500 mb-2">
                Generate a PowerPoint presentation from your source documents.
              </p>
              {pptError && (
                <div className="text-red-500 text-sm">{pptError}</div>
              )}
              <button
                onClick={handlePPTDownload}
                disabled={isPPTLoading || !hasReadySources}
                className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {isPPTLoading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    Download PPT
                  </>
                )}
              </button>
              {!hasReadySources && (
                <p className="text-xs text-gray-400">Upload and process documents first</p>
              )}
            </div>
          ) : activeTab === "podcast" ? (
            <div className="flex flex-col gap-4 p-4">
              <p className="text-sm text-gray-500">Generate an AI podcast dialogue from your sources. This may take 1-2 minutes.</p>
              {podcastError && <div className="text-red-500 text-sm">{podcastError}</div>}
              {podcastUrl ? (
                <div className="flex flex-col gap-2">
                  <audio controls src={podcastUrl} className="w-full rounded" />
                  <button
                    onClick={() => { URL.revokeObjectURL(podcastUrl); setPodcastUrl(null); }}
                    className="text-xs text-gray-400 hover:text-gray-600 self-start"
                  >
                    Generate new podcast
                  </button>
                </div>
              ) : (
                <button
                  onClick={handleGeneratePodcast}
                  disabled={isPodcastLoading || !hasReadySources}
                  className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {isPodcastLoading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Generating podcast...
                    </>
                  ) : 'Generate Podcast'}
                </button>
              )}
              {!hasReadySources && (
                <p className="text-xs text-gray-400">Upload and process documents first</p>
              )}
            </div>
          ) : activeTab === "mindmap" ? (
            <div className="flex flex-col">
              {isGenerating["mindmap"] ? (
                <div className="flex items-center justify-center p-8">
                  <div className="animate-spin w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full" />
                  <span className="ml-2 text-sm text-gray-500">Generating mind map...</span>
                </div>
              ) : content["mindmap"] ? (
                <MindMap rawJson={content["mindmap"]} />
              ) : (
                <div className="text-center text-sm text-gray-400 p-8">
                  Click the tab to generate a mind map from your sources.
                </div>
              )}
            </div>
          ) : (
            <StudioContentView
              content={content[activeTab] || ""}
              isGenerating={isGenerating[activeTab] || false}
              onRegenerate={() => generateContent(notebookId, activeTab)}
            />
          )}
        </div>
      )}

      {!hasReadySources && (
        <p className="text-[11px] text-[var(--text-tertiary)] mt-3">
          Upload and process documents to use Studio features.
        </p>
      )}
    </div>
  );
}
