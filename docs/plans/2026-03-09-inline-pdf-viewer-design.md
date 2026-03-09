# Inline PDF Viewer — Design Doc

**Date:** 2026-03-09
**Phase:** 3 P0
**Status:** Approved

## Goal

When a user clicks a PDF source or a citation `[1]` in chat, the right Studio panel switches to a PDF viewer showing the document at the relevant page. Closing it restores Studio.

## Approach: Studio Panel PDF Mode

The Studio panel (right sidebar) acts as a dual-purpose area: either Studio generation outputs, or a PDF viewer. No layout changes required — no modals, no panel resizing.

## Trigger Points

| Action | Result |
|--------|--------|
| Click PDF filename in SourceItem | Open PDF at page 1 in Studio |
| Click `[1]` superscript in ChatMessage | Open PDF at `citation.location.page` |
| Click citation row in CitationList | Open PDF at `citation.location.page` |
| Click ✕ in PdfViewer | Close PDF, restore Studio |

Non-PDF sources (DOCX, TXT, MD, XLSX) show a text excerpt modal or are skipped (no viewer).

## Architecture

### State (studioStore addition)
```typescript
pdfViewer: { sourceId: string; filename: string; page: number } | null
openPdf: (sourceId: string, filename: string, page: number) => void
closePdf: () => void
```

### Backend — 1 new endpoint
```
GET /api/sources/{source_id}/file
Authorization: Bearer JWT (viewer permission)
Response: FileResponse (application/pdf)
```
Serves raw file from local upload storage path.

### Frontend Components

**`PdfViewer.tsx`** — New component
- Uses `react-pdf` (pdfjs-dist 4.x)
- Props: `sourceId`, `filename`, `initialPage`
- Features: page navigation (prev/next), page counter, zoom (fit-width default), close button
- PDF URL: `/api/sources/{sourceId}/file` (authenticated via cookie)

**`StudioPanel.tsx`** — Modified
- If `pdfViewer !== null`, render `<PdfViewer>` instead of Studio tabs
- Studio state is preserved (not reset) while PDF is open

**`ChatMessage.tsx`** — Modified
- `[1]` superscript becomes a real `<button>` that calls `openPdf(citation.source_id, citation.filename, citation.location.page ?? 1)`

**`CitationList.tsx`** — Modified
- Citation rows call `openPdf` on click

**`SourceItem.tsx`** — Modified
- Clicking PDF filename calls `openPdf(source.id, source.filename, 1)`

## PDF.js Setup
- Package: `react-pdf` + `pdfjs-dist`
- Worker: copy via `next.config.js` webpack config or use CDN worker URL
- Mobile: PdfViewer hidden on mobile (Studio tab on mobile shows Studio only; PDF viewer is desktop-only in v1)

## Error Handling
- PDF load error → show error message with retry button
- Non-PDF source click → no-op (SourceItem only triggers for `file_type === 'pdf'`)
- 403/404 from file endpoint → show "Cannot load document"
