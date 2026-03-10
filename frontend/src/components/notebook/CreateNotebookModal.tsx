"use client";

import { useState, useEffect } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useNotebookStore } from "@/stores/notebook-store";
import { useRouter } from "next/navigation";

const EMOJIS = ["📒", "📕", "📗", "📘", "📙", "📓", "📔", "📋", "📑", "🗂", "📊", "🤖", "🛡", "🧪", "💡", "🎯"];
const COLORS = ["#4A90D9", "#34C759", "#FF9500", "#FF3B30", "#AF52DE", "#5856D6", "#FF2D55", "#00C7BE"];

interface CreateNotebookModalProps {
  open: boolean;
  onClose: () => void;
  defaultIsTeam?: boolean;
}

export function CreateNotebookModal({ open, onClose, defaultIsTeam = false }: CreateNotebookModalProps) {
  const router = useRouter();
  const { createNotebook } = useNotebookStore();
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("📒");
  const [color, setColor] = useState("#4A90D9");
  const [isTeam, setIsTeam] = useState(defaultIsTeam);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setIsTeam(defaultIsTeam);
  }, [defaultIsTeam]);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setLoading(true);
    try {
      const nb = await createNotebook({ name: name.trim(), emoji, cover_color: color, is_team: isTeam });
      onClose();
      setName("");
      setEmoji("📒");
      setColor("#4A90D9");
      router.push(`/notebook/${nb.id}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Create notebook">
      <div className="flex flex-col gap-5">
        {/* Type toggle */}
        <div className="flex bg-gray-100 rounded-lg p-0.5">
          <button
            onClick={() => setIsTeam(false)}
            className={`flex-1 py-2 text-[13px] font-medium rounded-md transition-all ${
              !isTeam
                ? "bg-white text-[var(--foreground)] shadow-sm"
                : "text-[var(--text-secondary)] hover:text-[var(--foreground)]"
            }`}
          >
            Personal
          </button>
          <button
            onClick={() => setIsTeam(true)}
            className={`flex-1 py-2 text-[13px] font-medium rounded-md transition-all ${
              isTeam
                ? "bg-white text-[var(--foreground)] shadow-sm"
                : "text-[var(--text-secondary)] hover:text-[var(--foreground)]"
            }`}
          >
            Team
          </button>
        </div>

        <Input
          label="Notebook name"
          placeholder={isTeam ? "Team Project" : "My Research"}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          autoFocus
        />

        <div>
          <label className="text-[13px] font-medium text-[var(--text-secondary)] block mb-2">
            Choose an icon
          </label>
          <div className="flex flex-wrap gap-2">
            {EMOJIS.map((e) => (
              <button
                key={e}
                onClick={() => setEmoji(e)}
                className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg transition-all
                  ${emoji === e ? "bg-[var(--accent-light)] ring-2 ring-[var(--accent)] scale-110" : "bg-gray-50 hover:bg-gray-100"}`}
              >
                {e}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-[13px] font-medium text-[var(--text-secondary)] block mb-2">
            Cover color
          </label>
          <div className="flex gap-2">
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                className={`w-8 h-8 rounded-full transition-all
                  ${color === c ? "ring-2 ring-offset-2 ring-[var(--accent)] scale-110" : "hover:scale-105"}`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>

        <Button onClick={handleCreate} loading={loading} disabled={!name.trim()} className="w-full" size="lg">
          Create {isTeam ? "team notebook" : "notebook"}
        </Button>
      </div>
    </Modal>
  );
}
