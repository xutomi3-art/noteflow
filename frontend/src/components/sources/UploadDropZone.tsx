"use client";

import { useCallback, useRef, useState } from "react";

interface UploadDropZoneProps {
  onUpload: (files: File[]) => void;
  disabled?: boolean;
}

const ACCEPTED = ".pdf,.docx,.pptx,.txt,.md,.xlsx,.xls,.csv";

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

  const uploadingRef = useRef(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (uploadingRef.current) return;
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (files.length > 0) {
      uploadingRef.current = true;
      Promise.resolve(onUpload(files)).finally(() => {
        uploadingRef.current = false;
      });
    }
  };

  return (
    <div
      onClick={handleClick}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`
        relative border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-all
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
        className="absolute w-0 h-0 opacity-0 overflow-hidden"
      />
      <div className="text-2xl mb-1">+</div>
      <p className="text-[12px] text-[var(--text-secondary)]">
        Drop files or click to upload
      </p>
      <p className="text-[11px] text-[var(--text-tertiary)] mt-0.5">
        PDF, DOCX, PPTX, TXT, MD, Excel, CSV
      </p>
    </div>
  );
}
