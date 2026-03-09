"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuthStore } from "@/stores/auth-store";
import { api } from "@/services/api";

export default function JoinPage() {
  const params = useParams();
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading, loadUser } = useAuthStore();
  const [status, setStatus] = useState<"loading" | "success" | "error" | "already">("loading");
  const [notebookName, setNotebookName] = useState("");
  const [notebookId, setNotebookId] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    loadUser();
  }, [loadUser]);

  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated) {
      router.replace(`/login?redirect=/join/${params.token}`);
      return;
    }

    const join = async () => {
      try {
        const result = await api.joinViaToken(params.token as string);
        setNotebookName(result.name);
        setNotebookId(result.notebook_id);
        setStatus(result.already_member ? "already" : "success");
        // Auto-redirect to the notebook after a brief moment
        setTimeout(() => {
          router.replace(`/notebook/${result.notebook_id}`);
        }, 1500);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Invalid or expired invite link");
        setStatus("error");
      }
    };
    join();
  }, [isAuthenticated, authLoading, params.token, router, loadUser]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--background)]">
      <div className="bg-[var(--card-bg)] rounded-2xl shadow-lg p-8 max-w-sm w-full text-center">
        {status === "loading" && (
          <>
            <div className="w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-[15px] text-[var(--text-secondary)]">Joining notebook...</p>
          </>
        )}
        {status === "success" && (
          <>
            <div className="text-4xl mb-3">&#127881;</div>
            <h1 className="text-[18px] font-semibold mb-2">Joined!</h1>
            <p className="text-[14px] text-[var(--text-secondary)] mb-4">
              You&apos;ve joined &quot;{notebookName}&quot;
            </p>
            <button
              onClick={() => router.push(`/notebook/${notebookId}`)}
              className="px-6 py-2.5 bg-[var(--accent)] text-white rounded-xl text-[15px] font-medium hover:opacity-90 transition-opacity"
            >
              Open Notebook
            </button>
          </>
        )}
        {status === "already" && (
          <>
            <div className="text-4xl mb-3">&#128075;</div>
            <h1 className="text-[18px] font-semibold mb-2">Already a member</h1>
            <p className="text-[14px] text-[var(--text-secondary)] mb-4">
              You&apos;re already a member of &quot;{notebookName}&quot;
            </p>
            <button
              onClick={() => router.push(`/notebook/${notebookId}`)}
              className="px-6 py-2.5 bg-[var(--accent)] text-white rounded-xl text-[15px] font-medium hover:opacity-90 transition-opacity"
            >
              Open Notebook
            </button>
          </>
        )}
        {status === "error" && (
          <>
            <div className="text-4xl mb-3">&#128533;</div>
            <h1 className="text-[18px] font-semibold mb-2">Unable to Join</h1>
            <p className="text-[14px] text-red-500 mb-4">{error}</p>
            <button
              onClick={() => router.push("/dashboard")}
              className="px-6 py-2.5 bg-[var(--accent)] text-white rounded-xl text-[15px] font-medium hover:opacity-90 transition-opacity"
            >
              Go to Dashboard
            </button>
          </>
        )}
      </div>
    </div>
  );
}
