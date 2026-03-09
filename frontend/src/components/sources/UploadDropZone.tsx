"use client";

import { useCallback, useRef, useState } from "react";

interface UploadDropZoneProps {
  onUpload: (files: File[]) => void;
  disabled?: boolean;
}

const ACCEPTED = ".pdf,.docx,.pptx,.txt,.md";

export default function UploadDropZone({ onUpload, disabled }: UploadDropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!disabled) setIsDragging(true);
    },
    [disabled],
  );

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      if (disabled) return;

      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) onUpload(files);
    },
    [disabled, onUpload],
  );

  const handleClick = () => {
    if (!disabled) inputRef.current?.click();
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) onUpload(files);
    e.target.value = "";
  };

  return (
    <div
      onClick={handleClick}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`
        border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-all
        ${
          isDragging
            ? "border-[var(--accent)] bg-blue-50/50"
            : "border-[var(--border)] hover:border-[var(--accent)] hover:bg-gray-50/50"
        }
        ${disabled ? "opacity-50 cursor-not-allowed" : ""}
      `}
    >
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED}
        multiple
        onChange={handleChange}
        className="hidden"
      />
      <div className="text-2xl mb-1">+</div>
      <p className="text-[12px] text-[var(--text-secondary)]">
        Drop files or click to upload
      </p>
      <p className="text-[11px] text-[var(--text-tertiary)] mt-0.5">
        PDF, DOCX, PPTX, TXT, MD
      </p>
    </div>
  );
}
