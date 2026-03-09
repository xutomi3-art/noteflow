"use client";

import { useEffect, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuthStore } from "@/stores/auth-store";
import { api } from "@/services/api";
import type { Notebook } from "@/types/api";
import SourcesPanel from "@/components/sources/SourcesPanel";
import ChatPanel from "@/components/chat/ChatPanel";
import StudioPanel from "@/components/studio/StudioPanel";
import ShareModal from "@/components/sharing/ShareModal";
import MobileTabs from "@/components/notebook/MobileTabs";

export default function NotebookPage() {
  const params = useParams();
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;
  const { isAuthenticated, isLoading: authLoading, loadUser } = useAuthStore();
  const [notebook, setNotebook] = useState<Notebook | null>(null);
  const [showShare, setShowShare] = useState(false);
  const [mobileTab, setMobileTab] = useState<'sources' | 'chat' | 'studio'>('chat');

  useEffect(() => {
    loadUser();
  }, [loadUser]);

  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated) {
      routerRef.current.replace("/login");
      return;
    }
    api.getNotebook(params.id as string).then(setNotebook).catch(() => routerRef.current.replace("/dashboard"));
  }, [isAuthenticated, authLoading, params.id]);

  if (!notebook) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const canShare = notebook.user_role === "owner" || notebook.user_role === "editor";

  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <header className="h-12 border-b border-[var(--border-light)] flex items-center px-4 bg-[var(--card-bg)] shrink-0">
        <button
          onClick={() => router.push("/dashboard")}
          className="mr-3 text-[var(--text-secondary)] hover:text-[var(--foreground)] transition-colors"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M10 3L5 8L10 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <span className="text-lg mr-2">{notebook.emoji}</span>
        <span className="text-[15px] font-semibold">{notebook.name}</span>

        {notebook.is_shared && (
          <span className="ml-2 text-[11px] text-[var(--text-tertiary)] bg-gray-100 px-2 py-0.5 rounded-full flex items-center gap-1">
            <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" className="opacity-60">
              <path d="M13 13c0-2.761-2.239-5-5-5S3 10.239 3 13M8 8a3 3 0 100-6 3 3 0 000 6zm5.5 0a2.5 2.5 0 100-5 2.5 2.5 0 000 5M2.5 8a2.5 2.5 0 100-5 2.5 2.5 0 000 5" />
            </svg>
            {notebook.member_count} members
          </span>
        )}

        <div className="ml-auto">
          {canShare && (
            <button
              onClick={() => setShowShare(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium
                bg-[var(--accent)] text-white rounded-lg hover:opacity-90 transition-opacity"
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 4.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM5 8.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM11 12.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3z" />
                <path d="M9.5 7.25L6.5 5.75M6.5 9.25l3 1.5" />
              </svg>
              Share
            </button>
          )}
        </div>
      </header>

      {/* Mobile tab switcher — hidden on lg+ */}
      <MobileTabs activeTab={mobileTab} onTabChange={setMobileTab} />

      {/* Three-panel layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sources Panel */}
        <aside className={`${mobileTab === 'sources' ? 'flex flex-col' : 'hidden'} lg:flex lg:flex-col w-full lg:w-64 border-r border-[var(--border-light)] bg-[var(--card-bg)] p-4 overflow-y-auto shrink-0`}>
          <SourcesPanel notebookId={params.id as string} userRole={notebook.user_role} />
        </aside>

        {/* Chat Panel */}
        <div className={`${mobileTab === 'chat' ? 'flex flex-col' : 'hidden'} lg:flex lg:flex-col w-full lg:w-auto lg:flex-1 min-h-0 overflow-hidden`}>
          <ChatPanel notebook={notebook} />
        </div>

        {/* Studio Panel */}
        <aside className={`${mobileTab === 'studio' ? 'flex flex-col' : 'hidden'} lg:flex lg:flex-col w-full lg:w-64 bg-[var(--card-bg)] shrink-0 overflow-hidden`}>
          <StudioPanel notebookId={params.id as string} />
        </aside>
      </div>

      {/* Share Modal */}
      <ShareModal
        open={showShare}
        onClose={() => setShowShare(false)}
        notebookId={notebook.id}
        notebookName={notebook.name}
      />
    </div>
  );
}
