"use client";

interface CreateNotebookCardProps {
  onClick: () => void;
  label?: string;
}

export function CreateNotebookCard({ onClick, label = "Create notebook" }: CreateNotebookCardProps) {
  return (
    <button
      onClick={onClick}
      className="bg-[var(--card-bg)] rounded-2xl p-5 cursor-pointer
        border-2 border-dashed border-[var(--border)]
        hover:border-[var(--accent)] hover:bg-[var(--accent-light)]/30
        transition-all duration-300 ease-out
        flex flex-col items-center justify-center min-h-[140px] group"
    >
      <div className="w-10 h-10 rounded-full bg-[var(--accent)]/10 flex items-center justify-center mb-2
        group-hover:bg-[var(--accent)]/20 transition-colors">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="text-[var(--accent)]">
          <path d="M10 4V16M4 10H16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </div>
      <span className="text-[13px] font-medium text-[var(--text-secondary)] group-hover:text-[var(--accent)] transition-colors">
        {label}
      </span>
    </button>
  );
}
