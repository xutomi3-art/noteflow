# PRD · Noteflow
**Product Requirements Document**
Version 4.4 | Date 2026-03-08 | Author Tommy

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

There is only **one notebook type**. Every notebook starts as personal and private. The owner can share it at any time via the **[Share]** button inside the notebook. Once shared, it moves to the "Shared Notebooks" section on the Home Page automatically.

> No "team" entity exists. No "create shared notebook" flow. You always create a notebook first, then optionally share it from inside.

### 1.3 Core Value Propositions

| Dimension | Value |
|-----------|-------|
| **Personal Efficiency** | Private notebooks + AI Q&A for instant retrieval of personal knowledge |
| **Frictionless Sharing** | Share any notebook with one click — no team setup overhead |
| **Meeting Intelligence** | Upload meeting minutes and let AI surface decisions, action items, and context across sessions |
| **Citation Traceability** | Every AI answer traces back to the exact source paragraph — no hallucinations |
| **Enterprise Formats** | Full support for PDF, Word, PPT, and Excel including table semantics |
| **China-Optimized** | Powered by Qwen (通义千问) for superior Chinese language understanding |

### 1.4 Key Differentiators from NotebookLM

| Feature | This Product | NotebookLM |
|---------|:------------:|:----------:|
| Notebook-level sharing (no team setup) | ✅ | ❌ |
| Member list per shared notebook | ✅ | ❌ |
| Meeting minutes Q&A | ✅ | Limited |
| Excel semantic understanding | ✅ | ❌ |
| Private deployment | ✅ | ❌ |
| Chinese LLM (Qwen) | ✅ | ❌ |
| Citation traceability | ✅ | ✅ |

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
> A user uploads 20 industry reports and asks "What are the AI healthcare trends across these reports?" The AI synthesizes a structured answer with every claim linked to the exact page of the source document.

**Use Case B — Meeting Minutes Intelligence**
> A product team uploads meeting minutes from the past 6 months into a shared notebook. Any member can ask: "What did we decide about the pricing model in Q4?" or "What action items are still unresolved?" The AI retrieves answers across all sessions with source attribution to the specific meeting date and document.

**Use Case C — Team Knowledge Hub**
> A sales team uploads client case studies, product manuals, and competitive analyses into a shared notebook. New hires ask the AI anything without interrupting senior colleagues.

**Use Case D — Excel Data Q&A**
> A finance team uploads a quarterly report (.xlsx) and asks "What is the revenue breakdown by region in Q3?" The AI understands the table structure and returns accurate, data-grounded answers.

**Use Case E — Project Document Center**
> A consulting team shares one notebook per engagement. All project docs — proposals, research, deliverables — live together. Anyone can ask "What constraints did the client mention in the kickoff?" and get a cited answer.

---

## 3. Information Architecture

### 3.1 Home Page Layout

```
┌──────────────────────────────────────────────────────────────────────┐
│  🔵 Logo                                    [Settings]  [Avatar]     │
├──────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  Personal Notebooks                                 [+ Create new]   │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────────┐   │
│  │ 📒       │ │ 🤖       │ │ 🛡        │ │         +            │   │
│  │ Research │ │ AI Notes │ │ Security │ │   Create notebook    │   │
│  │ 8 Mar    │ │ 16 Oct   │ │ 17 Feb   │ │                      │   │
│  │ 3 sources│ │ 1 source │ │14 sources│ │                      │   │
│  └──────────┘ └──────────┘ └──────────┘ └──────────────────────┘   │
│                                                                       │
│  Shared Notebooks                                                     │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐                             │
│  │ 📁       │ │ 📊       │ │ 🏫        │                             │
│  │ JOTO AI  │ │ Harrow   │ │ Q1 Mtgs  │                             │
│  │ Product  │ │ Project  │ │ Minutes  │                             │
│  │ 5 Mar    │ │ 1 Mar    │ │ 3 Mar    │                             │
│  │ 8 sources│ │ 4 sources│ │12 sources│                             │
│  │ 👤 6     │ │ 👤 3     │ │ 👤 4     │                             │
│  └──────────┘ └──────────┘ └──────────┘                             │
│                                                                       │
└──────────────────────────────────────────────────────────────────────┘
```

**Section rules:**
- **Personal Notebooks** — notebooks not yet shared with anyone. Has [+ Create new] shortcut.
- **Shared Notebooks** — notebooks the user has shared OR been invited to. No [+ Create new] here. You always create first, then share from inside.
- Shared notebook cards show a `👤 N` member count badge. Personal cards do not.
- Both sections are auto-populated by the system; the user never chooses "create shared notebook."

### 3.2 Notebook Interior — Three-Panel Layout

```
┌─────────────────────┬──────────────────────────────────┬─────────────────┐
│   SOURCES           │           CHAT                   │   STUDIO        │
│   (Left Panel)      │       (Center Panel)             │ (Right Panel)   │
│                     │                                  │                 │
│  [+ Add sources]    │  📒 Notebook Name    [Share] ✦  │ 📝 Summary      │
│                     │                                  │ 🗂 FAQ          │
│  ───────────────    │  Auto-generated overview...      │ 📖 Study Guide  │
│  ☑ Select all       │  [Save to note]  📋  👍  👎     │ 📌 Saved Notes  │
│                     │  ──────────────────────────      │                 │
│  📄 minutes_jan.pdf │  Suggested questions:            │ ── if shared ── │
│  📄 minutes_feb.pdf │  • What was decided in ...?      │                 │
│  📊 roadmap.xlsx    │  • Who owns action item X?       │ 👥 Members (4)  │
│  📊 Q1_report.xlsx  │                                  │ ┌─────────────┐ │
│  📑 proposal.pptx   │  ──────────────────────────      │ │🟢 Tommy(You)│ │
│                     │                                  │ │   Owner     │ │
│                     │  👤 [User question]              │ │🟢 Alice     │ │
│                     │                                  │ │   Editor    │ │
│                     │  🤖 [AI answer... [1][2]]        │ │⚪ Bob       │ │
│                     │  ▸ [1] minutes_jan.pdf · p.4    │ │   Viewer    │ │
│                     │  ▸ [2] minutes_feb.pdf · p.2    │ │⚪ Carol     │ │
│                     │  [Save to note]  📋  👍  👎     │ │   Viewer    │ │
│                     ├──────────────────────────────────┤ └─────────────┘ │
│                     │ [Type here...]    4 sources  [→] │ [+ Invite]      │
│                     │                      [🗑 Clear]  │                 │
└─────────────────────┴──────────────────────────────────┴─────────────────┘
```

**Panel rules:**
- **Sources panel (left)** — documents only. No members section here.
- **Chat panel (center)** — contains the **[Share]** button in the header, always visible regardless of notebook type.
- **Studio panel (right)** — shows the Members section at the bottom **only when the notebook has been shared**. Personal notebooks show nothing in that area.

---

## 4. User Flows

### 4.1 Create a Notebook

```
Home Page → [+ Create new] (under Personal Notebooks)
      │
      ▼
Enter notebook name + choose emoji + cover color
      │
      ▼
Notebook opens → Add Sources modal appears
      │
      ▼
Upload files → Processing pipeline → Chat ready
      │
      ▼
Notebook lives in "Personal Notebooks" on Home Page
```

### 4.2 Share a Notebook

```
Inside any notebook → click [Share] in Chat panel header
      │
      ▼
Share modal opens:
  ├── Generate invite link  (expiry: 24h / 7 days / permanent)
  └── Enter emails to invite directly  (set role: Editor / Viewer)
      │
      ▼
First member added → notebook moves to "Shared Notebooks" on Home Page
Members section appears in Studio panel (right)
```

### 4.3 Joining a Shared Notebook via Invite

```
Receive invite link / email
      │
      ├── Not logged in → Register / Login → Auto-join
      └── Already logged in → Confirm join
      │
      ▼
Notebook appears under "Shared Notebooks" on their Home Page
```

### 4.4 Revert Shared → Personal

```
Inside shared notebook → [Share] → "Manage sharing"
      │
      ▼
Remove all members (or click "Stop sharing")
      │
      ▼
Notebook reverts to Personal, moves back to Personal section on Home Page
```

---

## 5. Feature Specifications

### 5.1 Home Page

#### 5.1.1 "Personal Notebooks" Section

- Always shown at the top of the Home Page
- Card grid: 4 columns desktop, 2 columns mobile
- Each card: emoji cover, notebook name, last updated date, source count
- Last card is always the [+ Create new] shortcut
- Hover `⋮` menu: Rename / Share / Duplicate / Delete

#### 5.1.2 "Shared Notebooks" Section

- Shown below Personal Notebooks
- Same card grid layout
- Cards additionally show: `👤 N` member count badge
- Section is hidden if user has no shared notebooks
- Hover `⋮` menu: Rename / Manage members / Duplicate / Leave / Delete (Owner only)
- Sorted by most recently active

#### 5.1.3 Notebook Card

| Element | Personal | Shared |
|---------|----------|--------|
| Cover (emoji + color) | ✅ | ✅ |
| Notebook name | ✅ | ✅ |
| Last updated + source count | ✅ | ✅ |
| `👤 N` member count | ❌ | ✅ |
| `⋮` overflow menu | ✅ | ✅ |

---

### 5.2 [Share] Button & Modal

The [Share] button sits in the Chat panel header, always visible.

**When notebook is personal (not yet shared):**

```
┌────────────────────────────────────────────────┐
│  Share "Research Notes"                    [×] │
│                                                │
│  Invite link                                   │
│  ┌──────────────────────────────┐ [Copy link]  │
│  │ https://app.xyz/join/abc123  │              │
│  └──────────────────────────────┘              │
│  Expiry: [7 days ▾]   [Revoke]                 │
│                                                │
│  Or invite by email                            │
│  ┌──────────────────────────────────────────┐  │
│  │ alice@company.com, bob@company.com       │  │
│  └──────────────────────────────────────────┘  │
│  Role for invitees: [Editor ▾]                 │
│                                                │
│  [Send invites]                                │
└────────────────────────────────────────────────┘
```

**When notebook is already shared:**
Clicking [Share] opens the Member Management modal (see §5.6).

---

### 5.3 Sources Panel (Left)

- Lists all knowledge sources in the current notebook
- Checkbox per source — select/deselect to scope AI queries to specific files
- "Select all sources" toggle at top
- Each source: type icon, file name, status badge, `⋮` (Rename / Delete)
- Click source name → inline preview or download
- **No members section here** — Sources panel is documents only

**Upload behavior:**
- Users can select and upload **multiple files at once** via the file picker or drag-and-drop
- All files enter the processing queue simultaneously
- Each file shows its own independent status badge
- Mixed formats supported in a single upload batch (e.g. PDF + XLSX + PPTX together)

**Upload limits (Phase 1):**

| Constraint | Limit |
|-----------|-------|
| Max file size per file | 50 MB |
| Max files per notebook | 50 |
| Max files per upload batch | 20 |
| Supported formats | PDF, DOCX, PPTX, XLSX, XLS, TXT, MD |

**Source status badges:**

```
⏳ Uploading → 🔄 Parsing → ⚡ Vectorizing → ✅ Ready
                                             ❌ Failed  [Retry]
```

---

### 5.4 Chat Panel (Center)

#### 5.4.1 Initial State

After all sources reach "Ready," the Chat panel auto-shows:

1. **Notebook Overview** — AI-generated summary of all source content
2. **Suggested Questions** — 3 context-aware starter questions
   - For meeting minutes: "What action items came out of the last session?"
   - For research docs: "What is the central argument across these papers?"
3. `[Save to note]` + 📋 + 👍 👎 under the overview

#### 5.4.2 Conversation Layout

```
┌──────────────────────────────────────────────────────────┐
│  📒 Notebook Name                  [Share] ✦  [⚙ Menu]  │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  🤖  [Auto-generated notebook overview]                  │
│      [Save to note]  📋  👍  👎                         │
│                                                          │
│  Suggested questions:                                    │
│  ┌───────────────────────────────────────┐              │
│  │  What action items came out of Feb?   │              │
│  └───────────────────────────────────────┘              │
│                                                          │
│  ── conversation history scrolls upward ──               │
│                                                          │
│  👤  What was agreed on pricing in Q4?                  │
│                                                          │
│  🤖  In the October meeting, the team agreed to...      │
│      [1][2]                                              │
│      ▸ [1] minutes_oct.pdf · Oct 15 · p.3              │
│      ▸ [2] minutes_nov.pdf · Nov 2 · p.1               │
│      [Save to note]  📋  👍  👎                         │
│                                                          │
├──────────────────────────────────────────────────────────┤
│  [Start typing...]                4 sources   [→]        │
│                                           [🗑 Clear]     │
└──────────────────────────────────────────────────────────┘
```

#### 5.4.3 Conversation Rules

- No separate history sidebar — all messages inline, scrolling upward
- History persists across sessions and page refreshes
- **[🗑 Clear]** bottom-right → confirmation dialog → irreversible
- Input bar shows how many sources are currently selected (reflects checkboxes)
- Full Markdown rendering in AI responses

#### 5.4.4 Citation Traceability

Inline markers `[1]` `[2]` appear in AI responses. Each expands to show:
- Source file name
- Location: page number (PDF/Word) · slide number (PPT) · Sheet + row (Excel) · meeting date (if detected)
- Verbatim excerpt from the source

**Meeting-specific citation format:**
`minutes_2026-01-15.pdf · Jan 15 · p.2`

---

### 5.5 Studio Panel (Right)

The Studio panel provides AI-generated outputs and artifacts from the notebook's knowledge sources. Features are triggered on-demand by clicking the corresponding card.

**Phase 1 — Core outputs (all notebooks):**

| Feature | Description |
|---------|-------------|
| 📝 Summary | Structured summary of all selected sources |
| 🗂 FAQ | Auto-generated Q&A list |
| 📖 Study Guide | Outline / key concepts list |
| 📌 Saved Notes | Notes pinned from chat via [Save to note] |
| 🗺 Mind Map | Visual concept map of the notebook's key topics and relationships, rendered interactively |
| 🎙 Podcast | AI-generated conversational audio overview — two AI voices discuss the notebook content in a podcast format |
| 📊 Generate PPT | Export a ready-to-present PowerPoint deck summarizing the notebook's key findings, structured by topic |

**Output generation flow:**

```
User clicks output card (e.g. 🗺 Mind Map)
      │
      ▼
Studio card shows loading spinner
      │
      ▼
AI generates output based on currently selected sources
      │
      ▼
Output renders inline in Studio panel
Options: [Regenerate] [Download] [Save to Notes]
```

**Podcast generation detail:**
- Qwen scripts a two-voice conversation covering the notebook's key topics
- Text-to-speech via Alibaba Cloud TTS
- Output: MP3 file, playable inline with a mini audio player in Studio
- Duration: ~5–10 minutes depending on source volume

**Generate PPT detail:**
- Qwen generates a structured slide outline from the notebook content (title, key sections, bullet points, conclusion)
- Rendered as a .pptx file using `python-pptx`
- Slide structure: Title → Overview → Key Topics (1 slide per major theme) → Summary
- Download triggered immediately; also saved to notebook for re-download
- Users can open the .pptx in PowerPoint or Google Slides for further editing

**Visible only for Shared Notebooks (bottom of Studio panel):**

```
── Members (4) ──────────────────────────
🟢 Tommy (You)               Owner
🟢 Alice                     Editor
⚪ Bob                        Viewer
⚪ Carol                      Viewer

[+ Invite]    [Manage]
```

- 🟢 = active within 7 days · ⚪ = inactive
- **[+ Invite]** → opens the Share modal
- **[Manage]** → opens Member Management modal (Owner only)
- Personal notebooks: this section does not appear

---

### 5.6 Member Management Modal (Owner only)

| Column | Description |
|--------|-------------|
| Avatar + Name | User profile |
| Email | Contact |
| Role | Owner / Editor / Viewer — editable inline |
| Joined | Date joined |
| Last active | Last time accessed this notebook |
| Actions | Change role ▾ / Remove |

Additional actions:
- **Transfer Ownership** — Owner can assign ownership to another Editor
- **Stop Sharing** — removes all members; notebook reverts to Personal
- **Leave Notebook** — available to non-owners from `⋮` menu on card

---

### 5.7 Document Processing

#### 5.7.1 Processing Pipeline

```
Upload
  │
  ├─ PDF / DOCX / PPTX ──► MinerU ──────────────────────► Markdown + Images
  │
  ├─ XLSX / XLS ──────────► Excel Specialist Pipeline ──► Dual-track output
  │                         (openpyxl + pandas)
  │
  └─ TXT / MD ────────────► Direct read
                                   │
                             RAGFlow Chunking
                                   │
                             Qwen Embedding (text-embedding-v3)
                                   │
                          Elasticsearch (Vector + BM25)
                                   │
                               Ready ✅
```

#### 5.7.2 Excel Processing — Technical Approach

Excel is the hardest document format to handle accurately in a RAG system. Research shows that **pure RAG is insufficient** — a dual-route architecture is required depending on the question type.

**Two question types, two routes:**

| Question Type | Example | Route |
|--------------|---------|-------|
| Numerical / aggregation | "Total Q1 revenue?" "Which region grew fastest?" | Text-to-SQL → DuckDB |
| Text / description | "What does the status column mean?" "List all pending items" | RAG → RAGFlow |

A **custom lightweight router** built in FastAPI (not Dify — see §7.3) classifies each question and dispatches to the correct engine.

---

**Custom Router — Why not Dify?**

Dify is a full orchestration platform and is too heavy to embed here. Since we already have a FastAPI backend, the router is simply a Python function (~80 lines) that calls Qwen-Turbo with a classification prompt:

```python
# router.py — simplified
ROUTER_PROMPT = """
Classify this question as either:
- "sql"   : requires counting, summing, filtering, ranking, or comparing numbers
- "rag"   : requires understanding text, descriptions, or context

Question: {question}
Answer with only "sql" or "rag".
"""

async def route_excel_query(question: str, notebook_id: str) -> str:
    response = await qwen_turbo.chat(ROUTER_PROMPT.format(question=question))
    return response.strip()  # "sql" or "rag"
```

This keeps full control in our codebase, adds no external dependencies, and costs ~0.001 RMB per classification call with Qwen-Turbo.

---

**Cross-Excel Queries — Multiple Files in One Notebook**

A notebook may contain many Excel files (personal research, team reports, multi-period data). DuckDB handles this natively — all Excel files in a notebook are registered as **named tables in a single isolated DuckDB session** at query time.

```python
# Each notebook gets its own DuckDB connection
conn = duckdb.connect()  # in-memory, isolated per notebook

# Register all Excel files in this notebook as tables
for source in notebook.excel_sources:
    table_name = slugify(source.filename)   # e.g. "sales_q1", "sales_q2"
    conn.execute(f"""
        CREATE TABLE {table_name} AS 
        SELECT * FROM read_xlsx('{source.local_path}')
    """)
```

Users can then ask questions that span multiple files naturally:

```
"Compare Q1 and Q2 revenue by region"
→ SQL: SELECT q1.region, q1.revenue AS q1_rev, q2.revenue AS q2_rev
        FROM sales_q1 q1 JOIN sales_q2 q2 ON q1.region = q2.region

"Which product appears in both the inventory and the sales report?"
→ SQL: SELECT product FROM inventory
        INTERSECT
        SELECT product FROM sales_report

"Total headcount across all team rosters"
→ SQL: SELECT SUM(headcount) FROM (
          SELECT headcount FROM team_roster_eng
          UNION ALL SELECT headcount FROM team_roster_sales
        )
```

**Schema awareness**: Before generating SQL, Qwen is given a schema summary of all tables in the notebook — table names, column names, and data types. This allows it to write accurate cross-table queries even without seeing the raw data.

```python
schema_context = "\n".join([
    f"Table `{t.name}`: columns {t.columns}"
    for t in notebook.excel_tables
])
# Injected into SQL generation prompt
```

---

**Route A — Text-to-SQL via DuckDB (numerical queries)**

```
User question (numerical / cross-file OK)
      │
      ▼
FastAPI router: classifies as "sql"
      │
      ▼
Schema context of all Excel tables in notebook injected into prompt
      │
      ▼
Qwen-Plus generates SQL (single or multi-table)
      │
      ▼
DuckDB executes SQL → verified result
      │
      ▼
Qwen formats result as natural language + cites source file(s) + row(s)
```

**Route B — RAG via RAGFlow (text/description queries)**

```
User question (descriptive)
      │
      ▼
FastAPI router: classifies as "rag"
      │
      ▼
Each Excel row stored as dual-track chunks in RAGFlow:

  Track A (Natural Language → vector search):
    "In Q1, East China region achieved ¥1,200,000 revenue, +12% YoY"

  Track B (Markdown Table → citation display):
    | Region | Quarter | Revenue   | YoY  |
    | 华东区  |   Q1    | 1,200,000 | +12% |
      │
      ▼
Hybrid retrieval: 70% vector + 30% BM25, across all Excel chunks in notebook
      │
      ▼
Retrieved rows + full sheet header → Qwen generates answer with citation
```

---

**Pre-processing (shared by both routes):**

```
openpyxl reads .xlsx:
  → Expands merged cells (forward-fill)
  → Identifies header row (first row / bold row; LLM fallback)
  → Strips empty rows/columns
  → Splits each Sheet as independent table
  → Tags every chunk with: filename + Sheet name + row index
```

**Error recovery (SQL route):**
```
SQL fails → Qwen reads error + retries (up to 3x)
Still failing → fall back to RAG route + surface warning to user
```

---

**Tools evaluated:**

| Tool | Decision | Reason |
|------|----------|--------|
| **DuckDB** | ✅ Adopt | In-process, cross-file queries, no server, reads .xlsx natively |
| **openpyxl** | ✅ Adopt | Best structural parser for .xlsx |
| **pandas** | ✅ Adopt | Backup for transforms DuckDB can't handle |
| **xlrd** | ✅ Adopt | Legacy .xls support |
| **Custom FastAPI router** | ✅ Adopt | Replaces Dify — 80 lines, full control, near-zero cost |
| **DB-GPT** | 🔍 Monitor | Full ChatBI; too heavy to embed, good for standalone deployments |
| **Vanna.ai** | 🔍 Phase 3 | Self-learning SQL accuracy; evaluate after MVP |
| **Chat2DB** | 🔍 Monitor | Strong UX but overkill for embedded use case |
| **TableGPT2** (Zhejiang Univ + Qwen) | 🔭 Phase 4 | Native table encoder; evaluate when production-stable |

**Phased approach:**
- **Phase 1**: openpyxl + DuckDB + RAGFlow + custom FastAPI router (no Dify)
- **Phase 3**: Evaluate Vanna.ai for self-learning SQL improvement
- **Phase 4**: Evaluate TableGPT2 for native table semantic understanding

**Challenge → Solution:**

| Challenge | Solution |
|-----------|----------|
| Merged cells lose semantics | `openpyxl` forward-fill |
| Multi-sheet / multi-file context | Sheet name + filename tagged on every chunk and SQL table |
| Header row not identified | Bold/first row rule + LLM fallback |
| Numerical computation unreliable | DuckDB SQL execution — verified, not guessed |
| Cross-file queries | All Excel files in notebook registered as DuckDB tables in one session |
| SQL generation errors | Auto-retry up to 3x, fallback to RAG |
| Empty rows/columns | Pre-processing strip pass |
| Charts / pivot tables | Phase 1: skip. Phase 4: chart model |

#### 5.7.4 PPT Processing

- `python-pptx` extracts: text per slide, speaker notes, shape labels
- Embedded images → MinerU OCR
- Each slide = one chunk; slide number preserved for citation

---

## 6. Permission System

### 6.1 Role Definitions

| Action | Owner | Editor | Viewer |
|--------|:-----:|:------:|:------:|
| View notebook & sources | ✅ | ✅ | ✅ |
| Ask AI questions | ✅ | ✅ | ✅ |
| Clear own chat history | ✅ | ✅ | ✅ |
| Upload sources | ✅ | ✅ | ❌ |
| Delete sources | ✅ | ✅ | ❌ |
| Rename notebook | ✅ | ✅ | ❌ |
| Delete notebook | ✅ | ❌ | ❌ |
| Share notebook / invite members | ✅ | ✅ | ❌ |
| View member list | ✅ | ✅ | ✅ |
| Change member roles | ✅ | ❌ | ❌ |
| Remove members | ✅ | ❌ | ❌ |
| Transfer ownership | ✅ | ❌ | ❌ |
| Stop sharing (revert to personal) | ✅ | ❌ | ❌ |

### 6.2 Notebook State Transitions

```
Personal Notebook
      │
      │  Owner clicks [Share] → adds first member
      ▼
Shared Notebook   ←──── invited members join here
      │
      │  Owner clicks "Stop sharing" / removes all members
      ▼
Personal Notebook (reverted)
```

---

## 7. Technical Architecture

### 7.1 Technology Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| **Frontend** | Next.js + Tailwind CSS | SSR, responsive |
| **Backend** | Python FastAPI | AI-ecosystem-native, async-first |
| **RAG Engine** | RAGFlow (open-source) | Built-in hybrid retrieval + citation tracing |
| **Document Parsing** | MinerU (Magic-PDF, Alibaba) | Best-in-class open-source PDF/Word parser |
| **LLM** | Qwen-Plus / Qwen-Max (Tongyi) | Best Chinese comprehension, cost-effective |
| **LLM Router** | Custom FastAPI function + Qwen-Turbo | ~80 lines, classifies Excel queries as "sql" vs "rag"; no Dify needed |
| **Embedding** | text-embedding-v3 (Alibaba Cloud) | Same ecosystem as Qwen |
| **Vector Store** | Elasticsearch (bundled with RAGFlow) | No extra deployment needed |
| **Relational DB** | PostgreSQL | Users, notebooks, permissions, metadata |
| **Object Storage** | Alibaba Cloud OSS | Co-located with Qwen/RAGFlow, low latency |
| **Excel — Structural Parse** | openpyxl + xlrd | Merged cells, multi-sheet, header detection |
| **Excel — Numerical Queries** | DuckDB (in-process) | Text-to-SQL execution, no server required |
| **Excel — Text Queries** | RAGFlow dual-track | Natural language + Markdown table chunks |
| **PPT Input Parsing** | python-pptx + MinerU OCR | Text + image extraction per slide |
| **PPT Output Generation** | python-pptx | Generate .pptx from Qwen-structured outline |
| **Podcast Generation** | Alibaba Cloud TTS | Text-to-speech for two-voice podcast output |
| **Containerization** | Docker Compose | One-command deployment, private-deploy ready |

---

### 7.2 Data Model

```
User
  id, email, name, avatar, created_at

Notebook
  id, name, emoji, cover_color, owner_id
  is_shared: BOOLEAN  (false = personal, true = shared)
  created_at, updated_at

NotebookMember              ← only exists when is_shared = true
  notebook_id, user_id
  role: ENUM(owner, editor, viewer)
  joined_at, last_active_at

Source
  id, notebook_id, uploaded_by
  filename, file_type, file_size, storage_url
  status: ENUM(uploading, parsing, vectorizing, ready, failed)
  ragflow_dataset_id, ragflow_doc_id
  meeting_date  (nullable — extracted for meeting minutes)
  created_at

ChatMessage
  id, notebook_id, user_id
  role: ENUM(user, assistant)
  content, citations (JSON)
  created_at

SavedNote
  id, notebook_id, source_message_id
  content, created_at
```

---

### 7.3 System Architecture

```
                  ┌──────────────────────────────────────┐
                  │        Next.js Frontend               │
                  └──────────────────┬────────────────────┘
                                     │  REST API + SSE
                  ┌──────────────────▼────────────────────┐
                  │           FastAPI Backend              │
                  │                                        │
                  │  Auth · Notebook CRUD                  │
                  │  Member Management                     │
                  │  Source Upload & Queue                 │
                  │  Chat History                          │
                  │                                        │
                  │  ┌─────────────────────────────────┐  │
                  │  │   Excel Query Router (~80 lines) │  │
                  │  │   Qwen-Turbo classifier:         │  │
                  │  │   "sql" → DuckDB                 │  │
                  │  │   "rag" → RAGFlow                │  │
                  │  └──────────┬──────────────┬────────┘  │
                  └─────────────┼──────────────┼───────────┘
         ┌──────────────────────┘              └────────────────────┐
         │                                                           │
┌────────▼───────────────────────────┐          ┌───────────────────▼──────────┐
│  DuckDB (in-process, per notebook) │          │        RAGFlow               │
│                                    │          │  Chunking · Qwen Embedding   │
│  All Excel files in notebook       │          │  Elasticsearch (Vec + BM25)  │
│  registered as named tables:       │          │  Reranker · Qwen LLM Q&A     │
│    sales_q1, sales_q2, roster...   │          │                              │
│                                    │          │  (PDF/Word/PPT/Excel text    │
│  Cross-file SQL supported:         │          │   chunks live here)          │
│  SELECT * FROM sales_q1            │          └──────────────────────────────┘
│  JOIN sales_q2 USING (region)      │
└────────────────────────────────────┘

           ┌──────────────┐  ┌───────────┐  ┌─────────────────┐
           │  PostgreSQL   │  │  Ali OSS  │  │  MinerU Service  │
           │  Users/NBs    │  │  Raw      │  │  PDF/Word/PPT   │
           │  Members/Meta │  │  Files    │  │  Parsing + OCR  │
           └──────────────┘  └───────────┘  └─────────────────┘
```

**No Dify in the stack.** Orchestration logic lives entirely in FastAPI. The Excel router is a plain Python function — lightweight, fully controllable, near-zero latency overhead.

### 7.4 Notebook Isolation in RAGFlow

Each notebook maps to one RAGFlow **dataset**. Access control lives entirely in FastAPI + PostgreSQL — RAGFlow is used as a pure retrieval engine.

```
Notebook A (personal, user X)  →  RAGFlow dataset: nb_001  (user X only)
Notebook B (shared, users X+Y) →  RAGFlow dataset: nb_002  (users X, Y)
Notebook C (personal, user Y)  →  RAGFlow dataset: nb_003  (user Y only)
```

### 7.5 API Design (Summary)

**Notebook APIs:**
```
POST   /api/notebooks                    Create notebook
GET    /api/notebooks                    List all notebooks for current user
GET    /api/notebooks/{id}               Get notebook detail
PATCH  /api/notebooks/{id}               Rename / update emoji / cover
DELETE /api/notebooks/{id}               Delete notebook
```

**Sharing APIs:**
```
POST   /api/notebooks/{id}/share         Generate invite link / send email invites
DELETE /api/notebooks/{id}/share         Stop sharing (revert to personal)
GET    /api/notebooks/{id}/members       Get member list
PATCH  /api/notebooks/{id}/members/{uid} Change member role
DELETE /api/notebooks/{id}/members/{uid} Remove member
POST   /api/notebooks/{id}/leave         Current user leaves notebook
PATCH  /api/notebooks/{id}/owner         Transfer ownership
```

**Source APIs:**
```
POST   /api/notebooks/{id}/sources                 Upload file(s)
GET    /api/notebooks/{id}/sources                 List sources + status
DELETE /api/notebooks/{id}/sources/{sid}           Delete source
GET    /api/notebooks/{id}/sources/{sid}/status    Poll status (WebSocket)
```

**Chat APIs:**
```
POST   /api/notebooks/{id}/chat          Send message (SSE streaming)
GET    /api/notebooks/{id}/chat/history  Get full chat history
DELETE /api/notebooks/{id}/chat/history  Clear chat history
POST   /api/notebooks/{id}/notes         Save AI message as note
GET    /api/notebooks/{id}/notes         List saved notes
```

---

## 8. Non-Functional Requirements

### 8.1 Performance

| Metric | Target |
|--------|--------|
| Page first contentful paint | < 2s |
| AI first token (streaming) | < 3s |
| PDF parsing (20 MB) | < 60s |
| Excel processing (1,000 rows) | < 10s |
| Meeting minutes (10-page PDF) | < 30s |
| Vector search latency | < 1s |
| System availability | ≥ 99.5% |

### 8.2 Security

- All traffic HTTPS / TLS 1.2+
- Document storage encrypted at rest (OSS AES-256)
- Notebook access enforced at API layer — no cross-notebook data leakage
- File access via signed URLs (15-min expiry)
- JWT 24h expiry + refresh token rotation
- Audit logs retained 90 days

### 8.3 Scalability

- All services containerized via Docker Compose
- MinerU and RAGFlow fully self-hostable — no cloud dependency
- LLM is pluggable: swap Qwen for any OpenAI-compatible endpoint via config
- OSS replaceable with MinIO for air-gapped deployments

---

## 9. Milestone Roadmap

### Phase 1 · Document Knowledge Base MVP (6 weeks)
**Goal: Personal notebooks with AI Q&A end-to-end**

| Feature | Priority |
|---------|----------|
| User registration / login (JWT) | P0 |
| Home page: Personal + Shared Notebooks sections | P0 |
| Create notebook (name + emoji + color) | P0 |
| Upload PDF / DOCX → MinerU parsing | P0 |
| Upload PPTX → python-pptx + MinerU | P0 |
| Upload XLSX / XLS → Excel specialist pipeline | P0 |
| RAGFlow integration (chunking + Qwen embedding) | P0 |
| AI Q&A with Qwen-Plus (streaming SSE) | P0 |
| Citation traceability (file + page/slide/row) | P0 |
| Source checkbox selection | P1 |
| Auto-generated notebook overview | P1 |
| AI-suggested starter questions | P1 |
| [Save to note] → Studio panel | P1 |
| In-line chat history + [Clear] button | P1 |
| Processing status WebSocket push | P1 |
| Studio: Summary / FAQ / Study Guide | P2 |

---

### Phase 2 · Notebook Sharing (4 weeks)
**Goal: Any notebook can be shared with one click**

| Feature | Priority |
|---------|----------|
| [Share] button in Chat panel header | P0 |
| Invite via link + email | P0 |
| Owner / Editor / Viewer permissions | P0 |
| Members section in Studio panel (shared notebooks only) | P0 |
| `👤 N` badge on Shared Notebook cards | P0 |
| Notebook auto-moves to "Shared" section on first share | P0 |
| Leave notebook / Transfer ownership | P1 |
| Stop sharing (revert to Personal) | P1 |
| Revoke invite link | P1 |

---

### Phase 3 · Experience Enhancement (4 weeks)
**Goal: Richer outputs, better viewing, mobile support**

| Feature | Priority |
|---------|----------|
| Inline PDF viewer (PDF.js) | P0 |
| Excel structured table preview | P1 |
| Mobile responsive layout | P1 |
| Code Interpreter for Excel calculations (pandas) | P1 |
| Chart / diagram understanding (PPT, PDF) | P2 |

---

### Phase 4 · Monetization (future)

| Feature | Description |
|---------|-------------|
| Subscription plans (Free / Pro / Business) | Billing system |
| Usage Dashboard | Storage, queries, members |
| SSO integration (SAML / OIDC) | Enterprise IdP |
| Private deployment package | Docker Compose one-click |
| Open API | Notebook query API for integrations |

---

## 10. Success Metrics

### 10.1 Phase 1 KPIs (1 month post-launch)

| Metric | Target |
|--------|--------|
| DAU | 50 (internal + seed users) |
| Notebooks created | 200 |
| AI queries / user / day | ≥ 5 |
| Document parse success rate | ≥ 92% |
| AI answer thumbs-up rate | ≥ 65% |

### 10.2 Phase 2 KPIs

| Metric | Target |
|--------|--------|
| % of users with ≥1 shared notebook | ≥ 30% |
| Avg. members per shared notebook | ≥ 2.5 |
| D7 retention | ≥ 40% |
| NPS | ≥ 40 |

### 10.3 Phase 3 KPIs

| Metric | Target |
|--------|--------|
| Studio output generation rate (% users who generate ≥1 output) | ≥ 40% |
| PPT export downloads per active user / week | ≥ 2 |
| Mobile DAU share | ≥ 20% |

---

## Appendix

### A. Competitive Comparison

| Feature | Noteflow | NotebookLM | Notion AI | 印象笔记 AI |
|---------|:--------:|:----------:|:---------:|:----------:|
| One-click notebook sharing | ✅ | ❌ | ✅ | Limited |
| Member list per notebook | ✅ | ❌ | ✅ | ❌ |
| Citation traceability | ✅ | ✅ | ❌ | ❌ |
| Excel semantic understanding | ✅ | ❌ | ❌ | ❌ |
| PPT support | ✅ | ✅ | ❌ | ❌ |
| Mind Map generation | ✅ | ❌ | ❌ | ❌ |
| Podcast generation | ✅ | ✅ | ❌ | ❌ |
| PPT generation | ✅ | ❌ | ✅ | ❌ |
| Chinese LLM optimization | ✅ | ❌ | ❌ | ✅ |
| Private deployment | ✅ | ❌ | ❌ | ❌ |

### B. Glossary

| Term | Definition |
|------|-----------|
| **Notebook** | A knowledge container holding one or more source documents |
| **Personal Notebook** | A notebook not shared with anyone (is_shared = false) |
| **Shared Notebook** | A notebook with at least one member besides the owner (is_shared = true) |
| **Source** | A single uploaded document or pasted text snippet |
| **RAGFlow** | Open-source RAG framework: chunking, embedding, retrieval, generation |
| **MinerU** | Alibaba open-source document parser (Magic-PDF) |
| **Chunk** | The minimum unit a document is split into for vector search |
| **Qwen** | Tongyi Qianwen (通义千问) — Alibaba LLM powering all AI responses |
| **Dual-track** | Excel processing: natural language + structured Markdown stored in parallel |
| **SSE** | Server-Sent Events — streaming AI responses token-by-token |
| **Code Interpreter** | Mode where LLM writes pandas code to execute numerical calculations reliably |

---

*Document Version: v4.4 | Last Updated: 2026-03-08*
