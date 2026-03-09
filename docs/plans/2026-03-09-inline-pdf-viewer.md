# Inline PDF Viewer Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** When a user clicks a PDF source or a citation `[1]` in chat, the right Studio panel switches to an inline PDF viewer showing the document at the relevant page.

**Architecture:** Studio panel gains a "pdf viewer mode" controlled by `pdfViewer` state in `studioStore`. Any component that has a source + page can call `openPdf(sourceId, filename, page)` to activate it. The backend adds a `GET /sources/{source_id}/file` endpoint that serves the raw file. Frontend uses `react-pdf` (pdfjs-dist) for rendering.

**Tech Stack:** Next.js 16 / React 19, FastAPI, react-pdf v9, pdfjs-dist 4.x, Zustand, Tailwind CSS

---

### Task 1: Install react-pdf and configure PDF.js worker

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/next.config.ts`

**Step 1: Install react-pdf**

```bash
cd /Users/tommy/Documents/vibe-coding/Noteflow/frontend
npm install react-pdf
```

Expected output: react-pdf added to node_modules, package.json updated.

**Step 2: Configure PDF.js worker in next.config.ts**

Replace `frontend/next.config.ts` with:

```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  webpack: (config) => {
    // Required for pdfjs-dist worker
    config.resolve.alias["canvas"] = false;
    return config;
  },
};

export default nextConfig;
```

**Step 3: Verify no build error**

```bash
cd /Users/tommy/Documents/vibe-coding/Noteflow/frontend
npm run build 2>&1 | tail -20
```

Expected: Build succeeds (or shows only pre-existing errors, not new ones from react-pdf).

**Step 4: Commit**

```bash
cd /Users/tommy/Documents/vibe-coding/Noteflow
git add frontend/package.json frontend/package-lock.json frontend/next.config.ts
git commit -m "feat: install react-pdf for inline PDF viewer"
```

---

### Task 2: Backend — serve raw source file

**Files:**
- Modify: `backend/api/sources.py`

The source's local path is stored in `source.storage_url`. We add a new endpoint that serves it as a FileResponse. Only users with `view` permission on the notebook can access it.

**Step 1: Add the endpoint**

In `backend/api/sources.py`, add these imports at the top (after existing imports):

```python
from fastapi.responses import FileResponse
```

Then add this new route **before** the `@router.get('/status')` route at the bottom:

```python
@router.get('/{source_id}/file')
async def get_source_file(
    notebook_id: str,
    source_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> FileResponse:
    if not await permission_service.check_permission(db, uuid.UUID(notebook_id), user.id, 'view'):
        raise HTTPException(status_code=403, detail='No access to this notebook')

    source = await source_service.get_source(db, uuid.UUID(source_id))
    if source is None or str(source.notebook_id) != notebook_id:
        raise HTTPException(status_code=404, detail='Source not found')

    if not source.storage_url or not os.path.exists(source.storage_url):
        raise HTTPException(status_code=404, detail='File not found on disk')

    return FileResponse(
        path=source.storage_url,
        media_type='application/pdf',
        filename=source.filename,
    )
```

**Step 2: Commit**

```bash
cd /Users/tommy/Documents/vibe-coding/Noteflow
git add backend/api/sources.py
git commit -m "feat: add GET /sources/{source_id}/file endpoint to serve raw PDF"
```

---

### Task 3: Add pdfViewer state to studioStore

**Files:**
- Modify: `frontend/src/stores/studio-store.ts`

**Step 1: Add pdfViewer state and actions**

Replace the `StudioState` interface and store in `frontend/src/stores/studio-store.ts` with this updated version:

```typescript
import { create } from "zustand";
import type { SavedNote } from "@/types/api";
import { api } from "@/services/api";

interface PdfViewerState {
  sourceId: string;
  filename: string;
  page: number;
}

interface StudioState {
  activeTab: "summary" | "faq" | "study_guide" | "ppt" | "mindmap" | "podcast" | "notes" | null;
  content: Record<string, string>;
  isGenerating: Record<string, boolean>;
  notes: SavedNote[];
  isLoadingNotes: boolean;
  pdfViewer: PdfViewerState | null;

  setActiveTab: (tab: StudioState["activeTab"]) => void;
  generateContent: (notebookId: string, contentType: string) => Promise<void>;
  fetchNotes: (notebookId: string) => Promise<void>;
  deleteNote: (notebookId: string, noteId: string) => Promise<void>;
  openPdf: (sourceId: string, filename: string, page: number) => void;
  closePdf: () => void;
  reset: () => void;
}

export const useStudioStore = create<StudioState>((set, get) => ({
  activeTab: null,
  content: {},
  isGenerating: {},
  notes: [],
  isLoadingNotes: false,
  pdfViewer: null,

  setActiveTab: (tab) => set({ activeTab: tab }),

  openPdf: (sourceId, filename, page) => set({ pdfViewer: { sourceId, filename, page } }),

  closePdf: () => set({ pdfViewer: null }),

  generateContent: async (notebookId: string, contentType: string) => {
    set(state => ({ isGenerating: { ...state.isGenerating, [contentType]: true } }));
    try {
      const content = await api.generateStudioContent(notebookId, contentType);
      set(state => ({
        content: { ...state.content, [contentType]: content },
      }));
    } catch (err) {
      set(state => ({
        content: { ...state.content, [contentType]: `Error generating content: ${err}` },
      }));
    } finally {
      set(state => ({ isGenerating: { ...state.isGenerating, [contentType]: false } }));
    }
  },

  fetchNotes: async (notebookId: string) => {
    set({ isLoadingNotes: true });
    try {
      const notes = await api.listNotes(notebookId);
      set({ notes });
    } finally {
      set({ isLoadingNotes: false });
    }
  },

  deleteNote: async (notebookId: string, noteId: string) => {
    await api.deleteNote(notebookId, noteId);
    set(state => ({
      notes: state.notes.filter(n => n.id !== noteId),
    }));
  },

  reset: () => set({ activeTab: null, content: {}, isGenerating: {}, notes: [], isLoadingNotes: false, pdfViewer: null }),
}));
```

**Step 2: Commit**

```bash
cd /Users/tommy/Documents/vibe-coding/Noteflow
git add frontend/src/stores/studio-store.ts
git commit -m "feat: add pdfViewer state to studioStore"
```

---

### Task 4: Create PdfViewer.tsx component

**Files:**
- Create: `frontend/src/components/studio/PdfViewer.tsx`

This component renders a PDF using `react-pdf`. It fetches the PDF from `/api/sources/{sourceId}/file`, shows a toolbar with page navigation and a close button, and scrolls to `initialPage` on load.

**Step 1: Create the file**

```typescript
"use client";

import { useState, useCallback } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

// Use the bundled worker from pdfjs-dist
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
  const [currentPage, setCurrentPage] = useState<number>(initialPage);
  const [error, setError] = useState<string | null>(null);
  const [scale, setScale] = useState<number>(1.0);

  const pdfUrl = `/api/notebooks/${notebookId}/sources/${sourceId}/file`;

  const onDocumentLoadSuccess = useCallback(({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
    setCurrentPage(Math.min(initialPage, numPages));
    setError(null);
  }, [initialPage]);

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
            disabled={currentPage <= 1}
            className="p-1 rounded hover:bg-gray-100 disabled:opacity-30 text-[var(--text-secondary)] transition-colors"
            title="Previous page"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M8 2L4 6L8 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <span className="text-[11px] text-[var(--text-tertiary)] tabular-nums min-w-[48px] text-center">
            {numPages > 0 ? `${currentPage} / ${numPages}` : "—"}
          </span>
          <button
            onClick={goToNext}
            disabled={currentPage >= numPages}
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
              onClick={() => setError(null)}
              className="text-[12px] text-[var(--accent)] hover:underline"
            >
              Retry
            </button>
          </div>
        ) : (
          <Document
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
              pageNumber={currentPage}
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
```

**Step 2: Commit**

```bash
cd /Users/tommy/Documents/vibe-coding/Noteflow
git add frontend/src/components/studio/PdfViewer.tsx
git commit -m "feat: add PdfViewer component using react-pdf"
```

---

### Task 5: Modify StudioPanel to show PdfViewer

**Files:**
- Modify: `frontend/src/components/studio/StudioPanel.tsx`

**Step 1: Read current StudioPanel.tsx fully first, then apply these changes:**

At the top of the file, add to the imports:
```typescript
import dynamic from "next/dynamic";
```
(It already has this — skip if already there.)

Add a new dynamic import after the MindMap one:
```typescript
const PdfViewer = dynamic(() => import("./PdfViewer"), { ssr: false });
```

Add `pdfViewer` and `closePdf` to the destructured store values:
```typescript
const {
  activeTab,
  content,
  isGenerating,
  notes,
  isLoadingNotes,
  pdfViewer,          // ADD THIS
  setActiveTab,
  generateContent,
  fetchNotes,
  deleteNote,
  closePdf,           // ADD THIS
  reset,
} = useStudioStore();
```

At the very top of the return statement, before the existing `<div>`, wrap everything:
```tsx
return (
  <div className="h-full flex flex-col border-l border-[var(--border-light)] bg-[var(--card-bg)]">
    {pdfViewer ? (
      <PdfViewer
        notebookId={notebookId}
        sourceId={pdfViewer.sourceId}
        filename={pdfViewer.filename}
        initialPage={pdfViewer.page}
        onClose={closePdf}
      />
    ) : (
      /* existing content — everything that was previously returned */
      <>
        {/* tabs row */}
        {/* content area */}
      </>
    )}
  </div>
);
```

**Important:** Do NOT restructure or rewrite the Studio panel logic. Only wrap the existing JSX in the `else` branch. Read the full file before editing to make sure you preserve everything.

**Step 2: Commit**

```bash
cd /Users/tommy/Documents/vibe-coding/Noteflow
git add frontend/src/components/studio/StudioPanel.tsx
git commit -m "feat: StudioPanel shows PdfViewer when pdfViewer state is set"
```

---

### Task 6: Modify SourceItem to open PDF on click

**Files:**
- Modify: `frontend/src/components/sources/SourceItem.tsx`

**Step 1: Add openPdf prop and wire click handler**

The `SourceItem` component needs to accept an `onOpenPdf` callback and call it when the user clicks the filename of a ready PDF source.

Replace the `SourceItemProps` interface:
```typescript
interface SourceItemProps {
  source: Source;
  selected: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onOpenPdf?: (sourceId: string, filename: string, page: number) => void;
}
```

Update the function signature:
```typescript
export default function SourceItem({ source, selected, onToggle, onDelete, onOpenPdf }: SourceItemProps) {
```

Change the filename display to be clickable for PDF sources:
```tsx
<div className="flex items-center gap-1.5">
  <span className="text-[13px]">{typeIcon}</span>
  {source.file_type === 'pdf' && source.status === 'ready' && onOpenPdf ? (
    <button
      onClick={() => onOpenPdf(source.id, source.filename, 1)}
      className="text-[13px] truncate font-medium text-[var(--accent)] hover:underline text-left"
      title={`Open ${source.filename}`}
    >
      {source.filename}
    </button>
  ) : (
    <span className="text-[13px] truncate font-medium">{source.filename}</span>
  )}
</div>
```

**Step 2: Wire onOpenPdf in SourcesPanel**

Read `frontend/src/components/sources/SourcesPanel.tsx` to find where `<SourceItem>` is rendered, then add:

```tsx
// At the top of SourcesPanel, import the store:
import { useStudioStore } from "@/stores/studio-store";

// Inside the component:
const openPdf = useStudioStore(state => state.openPdf);

// In the SourceItem render:
<SourceItem
  key={source.id}
  source={source}
  selected={selectedIds.has(source.id)}
  onToggle={() => toggleSource(source.id)}
  onDelete={() => handleDelete(source.id)}
  onOpenPdf={openPdf}   // ADD THIS
/>
```

**Step 3: Commit**

```bash
cd /Users/tommy/Documents/vibe-coding/Noteflow
git add frontend/src/components/sources/SourceItem.tsx frontend/src/components/sources/SourcesPanel.tsx
git commit -m "feat: clicking PDF source name opens inline PDF viewer"
```

---

### Task 7: Make [1] citation markers open PDF viewer

**Files:**
- Modify: `frontend/src/components/chat/ChatMessage.tsx`

**Problem:** The `[1]` markers are rendered via `dangerouslySetInnerHTML`, so we can't attach React handlers directly. Solution: add a `data-citation-idx` attribute to the `<sup>` tag, then use event delegation on the container `<div>`.

**Step 1: Update ChatMessage.tsx**

Add store import at the top:
```typescript
import { useStudioStore } from "@/stores/studio-store";
```

Update the `ChatMessageProps` interface — no changes needed, citations are already in `message.citations`.

Inside the component, add:
```typescript
const openPdf = useStudioStore(state => state.openPdf);
```

Change the `[1]` regex replacement in `renderContent` from:
```typescript
.replace(/\[(\d+)\]/g, '<sup class="text-[var(--accent)] font-medium cursor-pointer">[$1]</sup>')
```
to:
```typescript
.replace(/\[(\d+)\]/g, '<sup data-citation-idx="$1" class="text-[var(--accent)] font-medium cursor-pointer hover:underline">[$1]</sup>')
```

Add a click handler to the `<div>` that wraps `dangerouslySetInnerHTML`:
```tsx
<div
  key={i}
  className="whitespace-pre-wrap"
  onClick={(e) => {
    const target = e.target as HTMLElement;
    const idx = target.dataset.citationIdx;
    if (idx && message.citations) {
      const citation = message.citations.find(c => c.index === parseInt(idx));
      if (citation && citation.file_type === 'pdf') {
        openPdf(citation.source_id, citation.filename, citation.location.page ?? 1);
      }
    }
  }}
  dangerouslySetInnerHTML={{ __html: ... }}
/>
```

**Step 2: Commit**

```bash
cd /Users/tommy/Documents/vibe-coding/Noteflow
git add frontend/src/components/chat/ChatMessage.tsx
git commit -m "feat: clicking [1] citation marker opens PDF at cited page"
```

---

### Task 8: Make CitationList rows open PDF viewer

**Files:**
- Modify: `frontend/src/components/chat/CitationList.tsx`

**Step 1: Add openPdf to CitationList**

Add store import:
```typescript
import { useStudioStore } from "@/stores/studio-store";
```

Inside the component:
```typescript
const openPdf = useStudioStore(state => state.openPdf);
```

Change each citation button to also call `openPdf` for PDF sources. Update the button's `onClick`:
```tsx
<button
  onClick={() => {
    setExpanded(isExpanded ? null : citation.index);
    if (citation.file_type === 'pdf') {
      openPdf(citation.source_id, citation.filename, citation.location.page ?? 1);
    }
  }}
  className="flex items-center gap-1.5 text-[var(--accent)] hover:underline"
>
```

**Step 2: Commit**

```bash
cd /Users/tommy/Documents/vibe-coding/Noteflow
git add frontend/src/components/chat/CitationList.tsx
git commit -m "feat: clicking citation in CitationList opens PDF at cited page"
```

---

### Task 9: Deploy and verify

**Step 1: Deploy to server**

```bash
rsync -avz --exclude 'node_modules' --exclude '.git' \
  /Users/tommy/Documents/vibe-coding/Noteflow/frontend/ \
  root@10.200.0.112:/opt/noteflow/frontend/

rsync -avz \
  /Users/tommy/Documents/vibe-coding/Noteflow/backend/ \
  root@10.200.0.112:/opt/noteflow/backend/

sshpass -p "Jototech@123" ssh root@10.200.0.112 \
  "cd /opt/noteflow && docker compose build backend frontend && docker compose up -d"
```

**Step 2: Verify backend endpoint works**

```bash
# Get a JWT token and test the file endpoint
sshpass -p "Jototech@123" ssh root@10.200.0.112 \
  "curl -s -o /dev/null -w '%{http_code}' http://localhost:8000/api/notebooks/ -H 'Authorization: Bearer test'"
```

Expected: 401 (endpoint exists, auth required — not 404).

**Step 3: Smoke test in browser**

Open http://10.200.0.112, log in, open a notebook with a PDF source:
1. Click the PDF filename in Sources panel → Studio panel should switch to PDF viewer
2. Ask a question, get a response with [1] citation → click [1] → Studio panel shows PDF at the cited page
3. Click ✕ in PDF viewer → Studio panel restores

**Step 4: Run e2e tests**

Use the `noteflow-e2e-test` skill to verify all existing tests still pass (no regressions).

**Step 5: Final commit if any last fixes**

```bash
git add -A
git commit -m "fix: PDF viewer post-deploy fixes"
```
