# PRD · Noteflow
**Product Requirements Document**
Version 5.0 | Date 2026-03-10 | Author Tommy

---

## Table of Contents

1. [Product Overview](#1-product-overview)
2. [Target Users & Scenarios](#2-target-users--scenarios)
3. [Information Architecture](#3-information-architecture)
4. [User Flows](#4-user-flows)
5. [Feature Specifications](#5-feature-specifications)
6. [Permission System](#6-permission-system)
7. [Technical Architecture](#7-technical-architecture)
8. [Non-Functional Requirements](#8-non-functional-requirements)
9. [Milestone Roadmap](#9-milestone-roadmap)
10. [Success Metrics](#10-success-metrics)

---

## 1. Product Overview

### 1.1 Product Vision

An AI-powered knowledge base tool for individuals and teams, inspired by Google NotebookLM. Users create notebooks, upload documents as knowledge sources, and interact through AI-powered Q&A with full citation traceability. Any notebook can be shared with collaborators at any time — no team setup required.

### 1.2 Core Concepts

There is only **one notebook type**. Every notebook starts as personal and private. The owner can share it at any time via the **[Share]** button inside the notebook. Once shared, it moves to the "Shared with Me" section on the dashboard for other members.

> No "team" entity exists. No "create shared notebook" flow. You always create a notebook first, then optionally share it from inside.

### 1.3 Core Value Propositions

| Dimension | Value |
|-----------|-------|
| **Personal Efficiency** | Private notebooks + AI Q&A for instant retrieval of personal knowledge |
| **Frictionless Sharing** | Share any notebook with one click — no team setup overhead |
| **Meeting Intelligence** | Upload meeting minutes and let AI surface decisions, action items, and context across sessions |
| **Citation Traceability** | Every AI answer traces back to the exact source paragraph — no hallucinations |
| **Enterprise Formats** | Full support for PDF, Word, PPT, Excel/CSV including table semantics |
| **Studio Outputs** | AI-generated summaries, FAQs, study guides, mind maps, podcasts, and PPT exports |
| **Inline PDF Viewer** | Click any citation to jump directly to the referenced page in an inline PDF viewer |
| **China-Optimized** | Powered by Qwen (通义千问) for superior Chinese language understanding |

### 1.4 Key Differentiators from NotebookLM

| Feature | Noteflow | NotebookLM |
|---------|:--------:|:----------:|
| Notebook-level sharing (no team setup) | ✅ | ❌ |
| Member list per shared notebook | ✅ | ❌ |
| Meeting minutes Q&A | ✅ | Limited |
| Excel/CSV semantic understanding | ✅ | ❌ |
| Mind Map generation | ✅ | ❌ |
| PPT generation & export | ✅ | ❌ |
| Inline PDF viewer with citation navigation | ✅ | ❌ |
| Private deployment | ✅ | ❌ |
| Chinese LLM (Qwen) | ✅ | ❌ |
| Citation traceability | ✅ | ✅ |
| Podcast generation | ✅ | ✅ |

### 1.5 Current Status

All three development phases are **complete and deployed** at http://10.200.0.112:
- **Phase 1**: Core knowledge base (auth, notebooks, document upload, AI Q&A with citations, Studio basics)
- **Phase 2**: Notebook sharing (invite links, roles, member management, ownership transfer)
- **Phase 3**: Advanced Studio (Mind Map, Podcast, PPT generation), Excel/CSV support, Inline PDF viewer

---

## 2. Target Users & Scenarios

### 2.1 User Segments

| Segment | Description | Typical Use Case |
|---------|-------------|-----------------|
| **Individual** | Researchers, students, independent consultants | Organizing papers, reading notes, project materials |
| **Small Collaboration** | Two or more colleagues on a shared project | Shared research, co-maintained knowledge base |
| **Enterprise Teams** | Sales, product, legal, operations | SOP management, meeting continuity, onboarding |

### 2.2 Core Use Cases

**Use Case A — Personal Research Assistant**
> A user uploads 20 industry reports and asks "What are the AI healthcare trends across these reports?" The AI synthesizes a structured answer with every claim linked to the exact page of the source document. Clicking a citation [1] opens the PDF inline at the cited page.

**Use Case B — Meeting Minutes Intelligence**
> A product team uploads meeting minutes from the past 6 months into a shared notebook. Any member can ask: "What did we decide about the pricing model in Q4?" The AI retrieves answers across all sessions with source attribution.

**Use Case C — Team Knowledge Hub**
> A sales team uploads client case studies, product manuals, and competitive analyses into a shared notebook. New hires ask the AI anything without interrupting senior colleagues.

**Use Case D — Excel/CSV Data Q&A**
> A finance team uploads a quarterly report (.xlsx) and asks "What is the revenue breakdown by region in Q3?" The AI understands the table structure and returns accurate, data-grounded answers via LLM-native markdown parsing or SQL-based DuckDB execution.

**Use Case E — Presentation Generation**
> After uploading research documents, a user clicks "PPT" in Studio and downloads a ready-to-edit PowerPoint summarizing key findings. They also generate a mind map for visual concept overview.

---

## 3. Information Architecture

### 3.1 Dashboard Layout

```
┌──────────────────────────────────────────────────────────────────────┐
│  📒 Noteflow                                        [User] [Sign out] │
├──────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  My Notebooks                                                        │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────────┐   │
│  │ 📒       │ │ 🤖       │ │ 🛡        │ │  Create notebook     │   │
│  │ Research │ │ AI Notes │ │ Security │ │         +            │   │
│  │ 8 Mar    │ │ 16 Oct   │ │ 17 Feb   │ │                      │   │
│  │ 3 sources│ │ 1 source │ │14 sources│ │                      │   │
│  │  [⋮]     │ │  [⋮]     │ │  [⋮]     │ │                      │   │
│  └──────────┘ └──────────┘ └──────────┘ └──────────────────────┘   │
│                                                                       │
│  Shared with Me                                                       │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐                             │
│  │ 📁       │ │ 📊       │ │ 🏫        │                             │
│  │ JOTO AI  │ │ Harrow   │ │ Q1 Mtgs  │                             │
│  │ Product  │ │ Project  │ │ Minutes  │                             │
│  │ 5 Mar    │ │ 1 Mar    │ │ 3 Mar    │                             │
│  │ 8 sources│ │ 4 sources│ │12 sources│                             │
│  │ 👤 6     │ │ 👤 3     │ │ 👤 4     │                             │
│  │ Editor   │ │ Viewer   │ │ Editor   │                             │
│  └──────────┘ └──────────┘ └──────────┘                             │
│                                                                       │
└──────────────────────────────────────────────────────────────────────┘
```

**Section rules:**
- **My Notebooks** — notebooks owned by the current user. Has "Create notebook" card.
- **Shared with Me** — notebooks the user has been invited to (not owned by them). Shows role badge (Editor/Viewer).
- Shared notebook cards show a `👤 N` member count badge and role label.
- Both sections auto-populated by the system.
- Own notebook `⋮` menu: Rename / Delete
- Shared notebook `⋮` menu: Leave

### 3.2 Notebook Interior — Three-Panel Layout

```
┌─────────────────────┬──────────────────────────────────┬─────────────────┐
│   SOURCES           │           CHAT                   │   STUDIO        │
│   (Left Panel)      │       (Center Panel)             │ (Right Panel)   │
│                     │                                  │                 │
│  Sources            │  📒 Notebook Name  👤N  [Share]  │ Studio          │
│  N files            │                                  │                 │
│  ┌───────────────┐  │  AI-generated overview...        │ 📝 Summary      │
│  │ Drop files or  │  │                                  │ 🗂 FAQ          │
│  │ click to upload│  │  Suggested questions:            │ 📖 Study Guide  │
│  └───────────────┘  │  • What was decided in ...?      │ 📊 PPT          │
│                     │  • Who owns action item X?       │ 🧠 Mind Map     │
│  ☑ Select all       │                                  │ 🎧 Podcast      │
│  ☑ Deselect all     │  ──────────────────────────      │ 📌 Saved Notes  │
│                     │                                  │                 │
│  📄 report.pdf   ✅ │  👤 [User question]              │                 │
│  📊 data.pptx    ✅ │                                  │                 │
│  📊 budget.xlsx  ✅ │  🤖 [AI answer... [1][2]]        │                 │
│                     │  ▸ [1] report.pdf · p.4          │                 │
│                     │  ▸ [2] data.pptx · slide 2      │                 │
│                     │  [Copy]  [Save to note]          │                 │
│                     ├──────────────────────────────────┤                 │
│                     │ [Ask about your N documents...]  │                 │
└─────────────────────┴──────────────────────────────────┴─────────────────┘
```

**Panel rules:**
- **Sources panel (left)** — documents only. Upload area, file list with checkboxes, status badges.
- **Chat panel (center)** — header shows notebook name, member count, and [Share] button.
- **Studio panel (right)** — AI output tabs. When PDF viewer is active, it replaces the entire Studio panel.

**PDF Viewer mode (replaces Studio panel):**
```
┌─────────────────────┐
│ [✕] filename.pdf    │
│ [◀] 3 / 70 [▶] [+][-]│
│                     │
│  ┌───────────────┐  │
│  │               │  │
│  │   PDF Page    │  │
│  │   Rendered    │  │
│  │               │  │
│  └───────────────┘  │
└─────────────────────┘
```

---

## 4. User Flows

### 4.1 Create a Notebook

```
Dashboard → [Create notebook] card
      │
      ▼
Modal: Enter notebook name + choose emoji + cover color
      │
      ▼
Notebook opens in three-panel layout
      │
      ▼
Upload files → Processing pipeline → Chat ready
      │
      ▼
Notebook listed under "My Notebooks" on Dashboard
```

### 4.2 Share a Notebook

```
Inside any notebook → click [Share] in Chat panel header
      │
      ▼
Share modal opens:
  ├── Select role for invite link (Editor / Viewer)
  └── Click "Generate Link" → copy invite URL
      │
      ▼
Share the link with collaborators
Notebook appears under "Shared with Me" on their Dashboard
```

### 4.3 Joining a Shared Notebook via Invite

```
Receive invite link
      │
      ├── Not logged in → Register / Login → Auto-join
      └── Already logged in → Auto-join → Redirected to notebook
      │
      ▼
Notebook appears under "Shared with Me" on their Dashboard
```

### 4.4 Revert Shared → Personal

```
Inside shared notebook → [Share] → modal
      │
      ▼
Click "Stop sharing and remove all members"
      │
      ▼
All members removed; notebook remains in owner's "My Notebooks"
```

### 4.5 View PDF from Citation

```
AI response contains inline citation [1]
      │
      ├── Click [1] in response text → Opens PDF viewer at cited page
      └── Click source name in citation list → Opens PDF viewer at cited page
      │
      ▼
PDF viewer replaces Studio panel
User can navigate pages, zoom in/out
Click [✕] to close and return to Studio
```

---

## 5. Feature Specifications

### 5.1 Dashboard

#### 5.1.1 "My Notebooks" Section

- Always shown at the top of the Dashboard
- Card grid layout, responsive
- Each card: emoji cover + color, notebook name, date, source count
- Last card is always the "Create notebook" shortcut
- Hover reveals `⋮` menu: Rename / Delete

#### 5.1.2 "Shared with Me" Section

- Shown below My Notebooks
- Same card grid layout
- Cards additionally show: `👤 N` member count badge and role label (Editor/Viewer)
- Section hidden if user has no shared notebooks
- Hover `⋮` menu: Leave

#### 5.1.3 Notebook Card

| Element | My Notebooks | Shared with Me |
|---------|:------------:|:--------------:|
| Cover (emoji + color) | ✅ | ✅ |
| Notebook name | ✅ | ✅ |
| Date + source count | ✅ | ✅ |
| `👤 N` member count | ❌ | ✅ |
| Role badge (Editor/Viewer) | ❌ | ✅ |
| `⋮` menu | Rename, Delete | Leave |

---

### 5.2 [Share] Button & Modal

The [Share] button sits in the Chat panel header, visible to Owner and Editor.

**Share modal:**

```
┌────────────────────────────────────────────────┐
│  Share "Research Notes"                    [×] │
│                                                │
│  Invite Link                                   │
│  Role: [Viewer ▾] [Editor]                     │
│  [Generate Link]                               │
│                                                │
│  ┌──────────────────────────────┐ [📋 Copy]   │
│  │ https://app/join/abc123...   │              │
│  └──────────────────────────────┘              │
│                                                │
│  Members (3)                                   │
│  ┌──────────────────────────────────────────┐  │
│  │ T  Test User (you)     Owner             │  │
│  │ T  Test User 2         [Editor ▾]        │  │
│  │    test2@noteflow.dev  [Transfer][Remove]│  │
│  └──────────────────────────────────────────┘  │
│                                                │
│  [Stop sharing and remove all members]         │
└────────────────────────────────────────────────┘
```

**Modal features:**
- Generate invite link with selectable role (Viewer/Editor)
- Copy link to clipboard
- Member list with role dropdown (Owner only can change)
- Transfer ownership button per member
- Remove member button
- "Stop sharing" to remove all members at once

---

### 5.3 Sources Panel (Left)

- Lists all knowledge sources in the current notebook
- Checkbox per source — select/deselect to scope AI queries to specific files
- "Select all" / "Deselect all" toggle at top
- Shows file count and selected count
- Each source: type icon (📄 PDF, 📊 PPTX/XLSX, etc.), file name, status badge, file size
- Click source name → opens inline PDF viewer (for PDF/PPTX/DOCX sources)
- Delete button per source (hidden for Viewer role, backend-enforced for all non-owner/editor)
- Upload area: drag-and-drop or click to browse files

**Upload behavior:**
- Multiple files can be uploaded at once
- All files enter the processing queue simultaneously
- Each file shows its own independent status badge
- Mixed formats supported in a single upload batch

**Supported formats:**

| Format | Processing Route |
|--------|-----------------|
| PDF | MinerU → Markdown → RAGFlow |
| DOCX | MinerU → Markdown → RAGFlow |
| PPTX | MinerU → Markdown → RAGFlow |
| TXT / MD | Direct read → RAGFlow |
| XLSX / XLS | DuckDB (numerical) + RAGFlow (text) |
| CSV | DuckDB (numerical) + RAGFlow (text) |
| Images (PNG, JPG, etc.) | MinerU OCR → RAGFlow |

**Upload limits:**

| Constraint | Limit |
|-----------|-------|
| Max file size per file | 50 MB |
| Max files per notebook | 50 |
| Supported formats | PDF, DOCX, PPTX, XLSX, XLS, CSV, TXT, MD, PNG, JPG |

**Source status badges:**

```
⏳ Uploading → 🔄 Processing → ✅ Ready
                              → ❌ Failed
```

---

### 5.4 Chat Panel (Center)

#### 5.4.1 Initial State

When sources are ready, the Chat panel shows:

1. **Notebook Overview** — AI-generated summary of all source content (auto-generated on first load)
2. **Suggested Questions** — 3 context-aware starter questions (clickable)
3. **[Clear conversation]** button

#### 5.4.2 Conversation Layout

```
┌──────────────────────────────────────────────────────────┐
│  📒 Notebook Name                 👤N  [Share]            │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  [AI-generated notebook overview]                        │
│                                                          │
│  Suggested questions:                                    │
│  ┌───────────────────────────────────────┐              │
│  │  What action items came out of Feb?   │              │
│  └───────────────────────────────────────┘              │
│                                                          │
│  ── conversation history scrolls ──                      │
│                                                          │
│  👤  What was agreed on pricing in Q4?                  │
│                                                          │
│  🤖  In the October meeting, the team agreed to...      │
│      [1][2]                                              │
│      ▸ [1] minutes_oct.pdf · p.3                        │
│      ▸ [2] minutes_nov.pdf · p.1                        │
│      [Copy]  [Save to note]                              │
│                                                          │
├──────────────────────────────────────────────────────────┤
│  [Ask about your N documents...]                    [→]  │
└──────────────────────────────────────────────────────────┘
```

#### 5.4.3 Conversation Rules

- All messages inline, scrolling
- History persists across sessions and page refreshes (stored in database, per-user per-notebook)
- **Chat history is per-user** — each user in a shared notebook has their own independent chat history
- **[Clear conversation]** clears current user's history only
- Input bar shows how many documents are available
- Full Markdown rendering in AI responses (headers, bold, lists, tables, code blocks)
- Streaming token-by-token via SSE

#### 5.4.4 Citation Traceability

Inline markers `[1]` `[2]` appear as superscript in AI responses. Below each AI response, a citation list shows:
- Source file name (clickable → opens PDF viewer for supported types)
- File type badge
- Excerpt from the source

**Clicking a citation:**
- For PDF/DOCX/PPTX sources: opens the inline PDF viewer at the cited page/slide
- The citation marker `[1]` in the response text is also clickable

**Citation data structure:**
```typescript
interface Citation {
  index: number;
  source_id: string;
  filename: string;
  file_type: 'pdf' | 'docx' | 'pptx' | 'txt' | 'md' | 'xlsx' | 'csv';
  location: { page?: number; slide?: number; paragraph?: number };
  excerpt: string;
}
```

---

### 5.5 Studio Panel (Right)

The Studio panel provides AI-generated outputs from the notebook's knowledge sources. Features are triggered by clicking the corresponding tab button.

**Available tabs:**

| Tab | Description | Status |
|-----|-------------|--------|
| 📝 Summary | Structured summary of all sources | ✅ Implemented |
| 🗂 FAQ | Auto-generated Q&A list | ✅ Implemented |
| 📖 Study Guide | Key concepts and outline | ✅ Implemented |
| 📊 PPT | Export PowerPoint deck | ✅ Implemented |
| 🧠 Mind Map | Interactive visual concept map (React Flow) | ✅ Implemented |
| 🎧 Podcast | AI two-voice audio overview (TTS required) | ✅ Implemented |
| 📌 Saved Notes | Notes saved from chat via [Save to note] | ✅ Implemented |

**Tab behavior:**
- Click tab → auto-generates content if not yet generated (for Summary/FAQ/Study Guide/Mind Map)
- Click active tab → collapses/hides content area
- Spinner shown during generation
- Saved Notes tab shows count badge
- Tabs disabled when no ready sources (except Saved Notes)

**Studio output details:**

**Summary / FAQ / Study Guide:**
- Generated by Qwen based on RAGFlow-retrieved context from all sources
- Rendered as Markdown in the Studio panel
- [Regenerate] button available

**PPT Generation:**
- Qwen generates structured slide outline (title, sections, bullet points)
- Rendered as .pptx using `python-pptx`
- One-click download
- Users can edit in PowerPoint or Google Slides

**Mind Map:**
- Qwen generates JSON with nodes and parent relationships
- Rendered interactively using React Flow
- Drag, zoom, and pan support
- Auto-layout with hierarchical structure

**Podcast:**
- Qwen scripts a two-voice conversation
- Text-to-speech via Alibaba Cloud TTS
- Output: MP3, playable inline with audio player
- Requires `ALIBABA_TTS_APPKEY` and `ALIBABA_TTS_TOKEN` env vars
- Returns HTTP 501 with graceful error when TTS not configured

**Inline PDF Viewer (replaces Studio panel):**
- Triggered by clicking a source name or citation
- Uses `react-pdf` (PDF.js) for rendering
- Page navigation (prev/next), page indicator
- Zoom in/out controls
- Close button returns to Studio
- When a new citation is clicked, viewer navigates to the cited page without reloading

---

### 5.6 Member Management

Member management is handled within the Share modal (accessible via [Share] button).

**Owner capabilities:**
- Generate/revoke invite links with role selection
- View member list with roles
- Change member roles (Editor ↔ Viewer)
- Remove individual members
- Transfer ownership to another member
- Stop sharing (remove all members)

**Non-owner actions:**
- Leave notebook (via dashboard card `⋮` menu or API)

---

### 5.7 Document Processing

#### 5.7.1 Processing Pipeline

```
Upload → FastAPI stores file locally
  │
  ├─ PDF / DOCX / PPTX ──► MinerU ──────────────────────► Markdown
  │                                                            │
  ├─ XLSX / XLS / CSV ───► DuckDB registration ────────────► Ready (for SQL queries)
  │                     └► Markdown conversion ─────────────► RAGFlow (for RAG queries)
  │
  ├─ Images (PNG/JPG) ──► MinerU OCR ──────────────────────► Markdown
  │
  └─ TXT / MD ──────────► Direct read
                                │
                          RAGFlow Chunking
                                │
                          Qwen Embedding (text-embedding-v3)
                                │
                       Elasticsearch (Vector + BM25)
                                │
                            Ready ✅
```

**SSE status updates:** The frontend polls source status via API. Status transitions:
`uploading` → `processing` → `ready` (or `failed`)

#### 5.7.2 Excel/CSV Processing

Excel and CSV files use a **dual-route architecture** depending on file size and question type:

**Route 1 — LLM-Native (preferred for files ≤ 60K chars as Markdown):**
```
Excel/CSV → convert to Markdown table
  │
  ▼
Entire table injected into Qwen context window (128K context)
  │
  ▼
Qwen answers directly from the data — no SQL needed
```

This approach is simpler and handles most spreadsheets (up to ~300 rows × 10 columns).

**Route 2 — SQL via DuckDB (fallback for large files):**
```
User question
  │
  ▼
Query Router classifies as "sql" or "rag" (Qwen-Turbo, ~80 lines)
  │
  ├── "sql" → Qwen generates SQL → DuckDB executes → formatted answer
  └── "rag" → RAGFlow retrieval → Qwen generates answer with citations
```

**Pre-processing:**
- Merged cells forward-filled
- Header row identified
- DuckDB table registered with `duckdb_path` on Source model
- CSV/XLSX → Markdown conversion for RAGFlow indexing

---

## 6. Permission System

### 6.1 Role Definitions

| Action | Owner | Editor | Viewer |
|--------|:-----:|:------:|:------:|
| View notebook & sources | ✅ | ✅ | ✅ |
| Ask AI questions | ✅ | ✅ | ✅ |
| View own chat history | ✅ | ✅ | ✅ |
| Clear own chat history | ✅ | ✅ | ✅ |
| Use Studio features | ✅ | ✅ | ✅ |
| Upload sources | ✅ | ✅ | ❌ |
| Delete sources | ✅ | ✅ | ❌ |
| Rename notebook | ✅ | ✅ | ❌ |
| Delete notebook | ✅ | ❌ | ❌ |
| Share notebook / generate invite | ✅ | ❌ | ❌ |
| View member list | ✅ | ✅ | ✅ |
| Change member roles | ✅ | ❌ | ❌ |
| Remove members | ✅ | ❌ | ❌ |
| Transfer ownership | ✅ | ❌ | ❌ |
| Stop sharing | ✅ | ❌ | ❌ |
| Leave notebook | ❌ | ✅ | ✅ |

### 6.2 Notebook State Transitions

```
Personal Notebook (owner only)
      │
      │  Owner clicks [Share] → generates invite link → someone joins
      ▼
Shared Notebook   ←──── invited members join via link
      │
      │  Owner clicks "Stop sharing" / removes all members
      ▼
Personal Notebook (reverted, owner only)
```

### 6.3 Chat Isolation

Each user's chat history is **independent per notebook**. In a shared notebook:
- User A's questions and answers are only visible to User A
- User B has their own separate conversation thread
- Clearing chat only affects the current user

---

## 7. Technical Architecture

### 7.1 Technology Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| **Frontend** | Next.js 15 (App Router) + Tailwind CSS + Zustand | SSR, responsive, minimal state management |
| **Backend** | Python FastAPI + SQLAlchemy + Alembic | AI-ecosystem-native, async-first, ORM |
| **RAG Engine** | RAGFlow (self-hosted, Docker) | Built-in hybrid retrieval + Elasticsearch |
| **Document Parsing** | MinerU (CPU mode) | Best open-source PDF/Word/PPT parser |
| **LLM** | Qwen-Plus (Tongyi Qianwen, Alibaba Cloud) | Best Chinese comprehension, 128K context |
| **Embedding** | text-embedding-v3 (Alibaba Cloud) | Same ecosystem as Qwen |
| **Vector + Text Search** | Elasticsearch (bundled with RAGFlow) | Hybrid: 70% vector + 30% BM25 |
| **Relational DB** | PostgreSQL | Users, notebooks, permissions, metadata |
| **File Storage** | Local filesystem (Docker volume) | Simple, no cloud dependency |
| **Excel/CSV Queries** | DuckDB (in-process) + LLM-native Markdown | Dual approach: small files via LLM, large via SQL |
| **Excel Router** | Custom FastAPI function + Qwen-Turbo | ~80 lines, classifies queries as "sql" vs "rag" |
| **PPT Generation** | python-pptx | Generate .pptx from Qwen-structured outline |
| **Mind Map** | React Flow (frontend) | Interactive node graph visualization |
| **PDF Viewer** | react-pdf (PDF.js) | Inline document viewing with page navigation |
| **Podcast** | Alibaba Cloud TTS + pydub | Two-voice MP3 generation |
| **Reverse Proxy** | Nginx | Routes `/api/*` → FastAPI:8000, `/*` → Next.js:3000 |
| **Containerization** | Docker Compose | One-command deployment |

### 7.2 Data Model

```
User
  id, email, name, avatar, created_at

Notebook
  id, name, emoji, cover_color, owner_id
  is_shared: BOOLEAN
  created_at, updated_at

NotebookMember              ← created when notebook is shared
  notebook_id, user_id
  role: ENUM(owner, editor, viewer)
  joined_at

InviteLink
  id, notebook_id, token (unique)
  role: ENUM(editor, viewer)
  created_by
  expires_at, created_at

Source
  id, notebook_id, uploaded_by
  filename, file_type, file_size
  storage_url (local path)
  status: ENUM(uploading, processing, ready, failed)
  error_message (nullable)
  ragflow_dataset_id, ragflow_doc_id
  duckdb_path (nullable — for Excel/CSV files)
  created_at

ChatMessage
  id, notebook_id, user_id
  role: ENUM(user, assistant)
  content: TEXT
  citations: JSON (array of Citation objects)
  created_at

SavedNote
  id, notebook_id, user_id
  source_message_id (nullable FK → ChatMessage)
  content: TEXT
  created_at
```

### 7.3 System Architecture

```
                  ┌──────────────────────────────────────┐
                  │           Nginx (port 80)             │
                  │   /api/* → FastAPI:8000               │
                  │   /*     → Next.js:3000               │
                  └──────────────────┬────────────────────┘
                                     │
              ┌──────────────────────┼────────────────────────┐
              │                      │                        │
┌─────────────▼──────────┐  ┌───────▼────────────────┐      │
│   Next.js Frontend      │  │   FastAPI Backend       │      │
│   (Docker container)    │  │   (Docker container)    │      │
│                         │  │                         │      │
│   Zustand stores:       │  │   Auth (JWT)            │      │
│   - authStore           │  │   Notebook CRUD         │      │
│   - notebookStore       │  │   Source Management     │      │
│   - chatStore           │  │   Chat (SSE streaming)  │      │
│   - studioStore         │  │   Studio Generation     │      │
│   - sourceStore         │  │   Sharing & Permissions │      │
│   - sharingStore        │  │   Excel Query Router    │      │
│                         │  │   Document Pipeline     │      │
└─────────────────────────┘  └──┬────────┬────────┬───┘      │
                                │        │        │           │
         ┌──────────────────────┘        │        └───────────┤
         │                               │                    │
┌────────▼────────┐  ┌──────────────────▼──────┐  ┌──────────▼──────────┐
│  RAGFlow        │  │  PostgreSQL              │  │  MinerU Service     │
│  (Docker)       │  │  (Docker)                │  │  (Docker)           │
│                 │  │                          │  │                     │
│  Elasticsearch  │  │  Users, Notebooks        │  │  PDF/DOCX/PPTX     │
│  Chunking       │  │  Members, Sources        │  │  → Markdown         │
│  Qwen Embedding │  │  Chat, Notes             │  │  OCR for images     │
│  Hybrid Search  │  │  Invite Links            │  │                     │
└─────────────────┘  └──────────────────────────┘  └─────────────────────┘

         ┌──────────────────────────────────────┐
         │  DuckDB (in-process, per-query)       │
         │  Excel/CSV → SQL execution            │
         │  No persistent server needed          │
         └──────────────────────────────────────┘
```

### 7.4 Notebook Isolation in RAGFlow

Each notebook maps to one RAGFlow **dataset**. Access control lives in FastAPI + PostgreSQL — RAGFlow is a pure retrieval engine.

```
Notebook A (user X)       →  RAGFlow dataset: nb_<uuid_a>
Notebook B (shared X+Y)   →  RAGFlow dataset: nb_<uuid_b>
```

### 7.5 API Design

**Auth APIs:**
```
POST   /api/auth/register              Register new user
POST   /api/auth/login                 Login (returns JWT)
POST   /api/auth/refresh               Refresh access token
GET    /api/auth/profile               Get current user profile
```

**Notebook APIs:**
```
POST   /api/notebooks                  Create notebook
GET    /api/notebooks                  List all notebooks for current user
GET    /api/notebooks/{id}             Get notebook detail
PATCH  /api/notebooks/{id}             Rename / update emoji / cover
DELETE /api/notebooks/{id}             Delete notebook
```

**Source APIs:**
```
POST   /api/notebooks/{id}/sources              Upload file(s)
GET    /api/notebooks/{id}/sources              List sources + status
DELETE /api/notebooks/{id}/sources/{sid}        Delete source
GET    /api/notebooks/{id}/sources/{sid}/file   Download/view source file
```

**Chat APIs:**
```
POST   /api/notebooks/{id}/chat                 Send message (SSE streaming response)
GET    /api/notebooks/{id}/chat/history          Get full chat history
DELETE /api/notebooks/{id}/chat/history          Clear chat history
```

**Notes APIs:**
```
POST   /api/notebooks/{id}/notes                Save note from chat
GET    /api/notebooks/{id}/notes                List saved notes
DELETE /api/notebooks/{id}/notes/{nid}          Delete saved note
```

**Studio APIs:**
```
POST   /api/notebooks/{id}/studio/{type}        Generate content (summary/faq/study_guide/mindmap)
POST   /api/notebooks/{id}/studio/ppt           Generate and download PPT
POST   /api/notebooks/{id}/studio/podcast        Generate podcast audio
```

**Sharing APIs:**
```
POST   /api/notebooks/{id}/share                Generate invite link
DELETE /api/notebooks/{id}/share                Stop sharing (remove all members)
POST   /api/join/{token}                         Join via invite link
GET    /api/notebooks/{id}/members              Get member list
PATCH  /api/notebooks/{id}/members/{uid}        Change member role
DELETE /api/notebooks/{id}/members/{uid}        Remove member
POST   /api/notebooks/{id}/leave                Leave notebook
PATCH  /api/notebooks/{id}/owner                Transfer ownership
```

---

## 8. Non-Functional Requirements

### 8.1 Performance

| Metric | Target | Actual |
|--------|--------|--------|
| Page first contentful paint | < 2s | ✅ |
| AI first token (streaming) | < 3s | ✅ |
| PDF parsing (20 MB) | < 60s | ✅ |
| Excel/CSV processing | < 15s | ✅ (typically < 10s) |
| Vector search latency | < 1s | ✅ |
| PPT generation | < 90s | ✅ |
| Mind map generation | < 60s | ✅ |

### 8.2 Security

- Nginx reverse proxy — no direct backend exposure
- JWT access tokens (24h expiry) + refresh token rotation
- All file access requires valid JWT token (passed as query parameter for PDF viewer)
- Notebook access enforced at API layer — permission checks on every endpoint
- Chinese filenames handled via RFC 5987 URL encoding in Content-Disposition headers

### 8.3 Deployment

- All services containerized via Docker Compose
- Server: Ubuntu 24.04, 16 cores, 16GB RAM, no GPU
- RAGFlow runs in separate Docker Compose stack (`/opt/ragflow/`)
- Noteflow stack at `/opt/noteflow/` with volume mount for backend code
- MinerU runs in CPU mode (no GPU required)

---

## 9. Milestone Roadmap

### Phase 1 · Core Knowledge Base ✅ COMPLETE

| Feature | Status |
|---------|--------|
| User registration / login (JWT) | ✅ Done |
| Dashboard: My Notebooks + Shared with Me sections | ✅ Done |
| Create notebook (name + emoji + color) | ✅ Done |
| Upload PDF / DOCX / PPTX / TXT / MD | ✅ Done |
| MinerU parsing pipeline | ✅ Done |
| RAGFlow integration (chunking + Qwen embedding) | ✅ Done |
| AI Q&A with Qwen-Plus (SSE streaming) | ✅ Done |
| Citation traceability (file + page/slide) | ✅ Done |
| Source checkbox selection (scope queries) | ✅ Done |
| Auto-generated notebook overview | ✅ Done |
| AI-suggested starter questions (clickable) | ✅ Done |
| Save to note → Studio panel | ✅ Done |
| Chat history (per-user, persistent) + Clear | ✅ Done |
| Studio: Summary / FAQ / Study Guide | ✅ Done |

### Phase 2 · Notebook Sharing ✅ COMPLETE

| Feature | Status |
|---------|--------|
| [Share] button in header | ✅ Done |
| Invite link generation with role selection | ✅ Done |
| Join via invite link (auto-redirect) | ✅ Done |
| Owner / Editor / Viewer permissions (backend-enforced) | ✅ Done |
| Member list in Share modal | ✅ Done |
| Change member roles | ✅ Done |
| Remove member | ✅ Done |
| Member count badge on notebook cards | ✅ Done |
| Role badge on shared notebook cards | ✅ Done |
| Leave notebook | ✅ Done |
| Transfer ownership | ✅ Done |
| Stop sharing (revert to personal) | ✅ Done |

### Phase 3 · Advanced Features ✅ COMPLETE

| Feature | Status |
|---------|--------|
| Excel/CSV upload + DuckDB processing | ✅ Done |
| Excel LLM-native query (Markdown in context) | ✅ Done |
| Excel SQL query (DuckDB fallback for large files) | ✅ Done |
| Query router (sql vs rag classification) | ✅ Done |
| Inline PDF viewer (react-pdf) | ✅ Done |
| Citation click → PDF viewer at cited page | ✅ Done |
| PPT generation (python-pptx) | ✅ Done |
| Mind Map (React Flow, interactive) | ✅ Done |
| Podcast (Alibaba TTS, two-voice) | ✅ Done (requires TTS config) |
| Image upload support (OCR via MinerU) | ✅ Done |

### Phase 4 · Future Enhancements (Planned)

| Feature | Description |
|---------|-------------|
| Mobile responsive layout | Optimize for 375px viewport |
| Subscription plans | Free / Pro / Business tiers |
| Usage Dashboard | Storage, queries, member analytics |
| SSO integration (SAML / OIDC) | Enterprise IdP support |

### Phase 5 · Intelligence Enhancements (Planned)

| Feature | Description |
|---------|-------------|
| Vanna.ai integration | Self-learning SQL for Excel/CSV queries — trains on user corrections to improve accuracy over time |
| Chart/diagram understanding | Vision LLM (Qwen-VL) extracts structured data from charts, diagrams, and visual content in uploaded images |
| Presenton PPT with GPU | Deploy Presenton on GPU server for AI-generated images, rich layouts, and professional slide design (current CPU-only server causes Ollama crash) |
| Google SSO (OAuth 2.0) | Requires public domain (Google rejects IP-only redirect URIs). Code ready in backend/services/google_auth_service.py + frontend login/register pages. Need: domain → Google Cloud OAuth credentials → Admin Panel config |
| Subscription plans | Free / Pro / Business tiers with usage limits |
| Private deployment package | Documented Docker Compose one-click deployment for enterprises |
| Open API | External REST API for programmatic notebook queries |

---

## 10. Success Metrics

### 10.1 Phase 1 KPIs (1 month post-launch)

| Metric | Target |
|--------|--------|
| DAU | 50 (internal + seed users) |
| Notebooks created | 200 |
| AI queries / user / day | ≥ 5 |
| Document parse success rate | ≥ 92% |
| AI answer quality (user satisfaction) | ≥ 65% |

### 10.2 Phase 2 KPIs

| Metric | Target |
|--------|--------|
| % of users with ≥1 shared notebook | ≥ 30% |
| Avg. members per shared notebook | ≥ 2.5 |
| D7 retention | ≥ 40% |

### 10.3 Phase 3 KPIs

| Metric | Target |
|--------|--------|
| Studio output generation rate | ≥ 40% of users |
| PPT export downloads per active user / week | ≥ 2 |
| PDF viewer usage (citation clicks) | ≥ 50% of chat sessions |

---

## Appendix

### A. Competitive Comparison

| Feature | Noteflow | NotebookLM | Notion AI | 印象笔记 AI |
|---------|:--------:|:----------:|:---------:|:----------:|
| One-click notebook sharing | ✅ | ❌ | ✅ | Limited |
| Member list per notebook | ✅ | ❌ | ✅ | ❌ |
| Citation traceability | ✅ | ✅ | ❌ | ❌ |
| Inline PDF viewer | ✅ | ❌ | ❌ | ❌ |
| Excel/CSV understanding | ✅ | ❌ | ❌ | ❌ |
| PPT support (input) | ✅ | ✅ | ❌ | ❌ |
| PPT generation (output) | ✅ | ❌ | ✅ | ❌ |
| Mind Map generation | ✅ | ❌ | ❌ | ❌ |
| Podcast generation | ✅ | ✅ | ❌ | ❌ |
| Chinese LLM optimization | ✅ | ❌ | ❌ | ✅ |
| Private deployment | ✅ | ❌ | ❌ | ❌ |

### B. Glossary

| Term | Definition |
|------|-----------|
| **Notebook** | A knowledge container holding one or more source documents |
| **Source** | A single uploaded document (PDF, DOCX, PPTX, XLSX, CSV, TXT, MD, image) |
| **RAGFlow** | Open-source RAG framework: chunking, embedding, hybrid retrieval |
| **MinerU** | Alibaba open-source document parser (Magic-PDF) for PDF/Word/PPT/image OCR |
| **DuckDB** | In-process SQL engine for Excel/CSV analytical queries |
| **Qwen** | Tongyi Qianwen (通义千问) — Alibaba LLM powering all AI features |
| **SSE** | Server-Sent Events — streaming AI responses token-by-token |
| **Dual-route** | Excel query approach: LLM-native for small files, SQL+DuckDB for large files |
| **Studio** | Right panel with AI-generated outputs (Summary, FAQ, Mind Map, PPT, Podcast, etc.) |
| **Citation** | Reference linking AI answer text to specific source document and location |

### C. Known Limitations

| Item | Description | Planned Fix |
|------|-------------|-------------|
| Delete button visible to Viewers | UI shows delete button but backend blocks the action | Hide button for Viewer role in frontend |
| Share button visible to Editors | UI shows Share button but backend enforces owner-only | Hide button for non-owner roles |
| Podcast requires TTS config | Returns HTTP 501 without Alibaba TTS credentials | Document setup process |

---

*Document Version: v5.0 | Last Updated: 2026-03-10*
