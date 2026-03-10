"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

// Use the CDN worker to avoid bundler issues
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface PdfViewerProps {
  notebookId: string;
  sourceId: string;
  filename: string;
  initialPage: number;
  onClose: () => void;
}

export default function PdfViewer({ notebookId, sourceId, filename, initialPage, onClose }: PdfViewerProps) {
  const [numPages, setNumPages] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [scale, setScale] = useState<number>(1.0);
  const [retryKey, setRetryKey] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(initialPage);

  // Track the last initialPage so we detect external navigation (citation clicks)
  const lastInitialPage = useRef(initialPage);

  useEffect(() => {
    if (initialPage !== lastInitialPage.current) {
      lastInitialPage.current = initialPage;
      setCurrentPage(initialPage);
    }
  }, [initialPage]);

  const clampedPage = Math.max(1, Math.min(numPages || 999, currentPage));

  const token = typeof window !== "undefined" ? localStorage.getItem("access_token") : null;
  const pdfUrl = `/api/notebooks/${notebookId}/sources/${sourceId}/file${token ? `?token=${token}` : ""}`;

  const onDocumentLoadSuccess = useCallback(({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
    setError(null);
  }, []);

  const onDocumentLoadError = useCallback((err: Error) => {
    setError(`Failed to load PDF: ${err.message}`);
  }, []);

  const goToPrev = () => setCurrentPage(p => Math.max(1, p - 1));
  const goToNext = () => setCurrentPage(p => Math.min(numPages, p + 1));

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border-light)] bg-[var(--card-bg)] shrink-0">
        <button
          onClick={onClose}
          className="text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors p-1 rounded hover:bg-gray-100"
          title="Close viewer"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M3 3L11 11M11 3L3 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
        <span className="text-[12px] font-medium text-[var(--text-secondary)] truncate flex-1" title={filename}>
          {filename}
        </span>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={goToPrev}
            disabled={clampedPage <= 1}
            className="p-1 rounded hover:bg-gray-100 disabled:opacity-30 text-[var(--text-secondary)] transition-colors"
            title="Previous page"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M8 2L4 6L8 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <span className="text-[11px] text-[var(--text-tertiary)] tabular-nums min-w-[48px] text-center">
            {numPages > 0 ? `${clampedPage} / ${numPages}` : "—"}
          </span>
          <button
            onClick={goToNext}
            disabled={clampedPage >= numPages}
            className="p-1 rounded hover:bg-gray-100 disabled:opacity-30 text-[var(--text-secondary)] transition-colors"
            title="Next page"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M4 2L8 6L4 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            onClick={() => setScale(s => Math.min(2.0, s + 0.2))}
            className="p-1 rounded hover:bg-gray-100 text-[var(--text-secondary)] transition-colors text-[11px] font-medium"
            title="Zoom in"
          >
            +
          </button>
          <button
            onClick={() => setScale(s => Math.max(0.5, s - 0.2))}
            className="p-1 rounded hover:bg-gray-100 text-[var(--text-secondary)] transition-colors text-[11px] font-medium"
            title="Zoom out"
          >
            −
          </button>
        </div>
      </div>

      {/* PDF Content */}
      <div className="flex-1 overflow-auto bg-gray-100 flex justify-center">
        {error ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center p-4">
            <span className="text-3xl">⚠️</span>
            <p className="text-[13px] text-[var(--text-secondary)]">{error}</p>
            <button
              onClick={() => { setError(null); setRetryKey(k => k + 1); }}
              className="text-[12px] text-[var(--accent)] hover:underline"
            >
              Retry
            </button>
          </div>
        ) : (
          <Document
            key={retryKey}
            file={pdfUrl}
            onLoadSuccess={onDocumentLoadSuccess}
            onLoadError={onDocumentLoadError}
            loading={
              <div className="flex items-center justify-center h-32">
                <div className="w-5 h-5 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
              </div>
            }
          >
            <Page
              pageNumber={clampedPage}
              scale={scale}
              width={220}
              renderTextLayer={true}
              renderAnnotationLayer={true}
            />
          </Document>
        )}
      </div>
    </div>
  );
}
