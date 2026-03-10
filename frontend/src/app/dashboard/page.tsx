"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/stores/auth-store";
import { useNotebookStore } from "@/stores/notebook-store";
import { NotebookCard } from "@/components/notebook/NotebookCard";
import { CreateNotebookCard } from "@/components/notebook/CreateNotebookCard";
import { CreateNotebookModal } from "@/components/notebook/CreateNotebookModal";

export default function DashboardPage() {
  const router = useRouter();
  const { user, isAuthenticated, isLoading: authLoading, loadUser, logout } = useAuthStore();
  const { notebooks, isLoading: nbLoading, fetchNotebooks } = useNotebookStore();
  const [showCreate, setShowCreate] = useState(false);
  const [showCreateTeam, setShowCreateTeam] = useState(false);

  useEffect(() => {
    loadUser();
  }, [loadUser]);

  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated) {
      router.replace("/login");
      return;
    }
    fetchNotebooks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, authLoading, fetchNotebooks]);

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const myNotebooks = notebooks.filter((nb) => !nb.is_shared);
  const teamNotebooks = notebooks.filter((nb) => nb.is_shared);

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-[var(--background)]/80 backdrop-blur-xl border-b border-[var(--border-light)]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-xl">📒</span>
            <span className="text-[17px] font-semibold tracking-tight">Noteflow</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[13px] text-[var(--text-secondary)]">{user?.name}</span>
            <button
              onClick={logout}
              className="text-[13px] text-[var(--text-secondary)] hover:text-[var(--foreground)] transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-6xl mx-auto p-4 sm:p-6 lg:p-8 space-y-10">
        {/* My Notebooks */}
        <section>
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-[22px] font-semibold tracking-tight">My Notebooks</h2>
          </div>

          {nbLoading ? (
            <div className="flex justify-center py-20">
              <div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {myNotebooks.map((nb) => (
                <NotebookCard key={nb.id} notebook={nb} />
              ))}
              <CreateNotebookCard onClick={() => setShowCreate(true)} />
            </div>
          )}
        </section>

        {/* Team Notebooks */}
        {!nbLoading && (
          <section>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-[22px] font-semibold tracking-tight">Team Notebooks</h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {teamNotebooks.map((nb) => (
                <NotebookCard key={nb.id} notebook={nb} />
              ))}
              <CreateNotebookCard onClick={() => setShowCreateTeam(true)} label="Create team notebook" />
            </div>
          </section>
        )}
      </main>

      <CreateNotebookModal open={showCreate} onClose={() => setShowCreate(false)} />
      <CreateNotebookModal open={showCreateTeam} onClose={() => setShowCreateTeam(false)} defaultIsTeam />
    </div>
  );
}
