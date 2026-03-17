# Noteflow User Guide

## What is Noteflow?

Noteflow is an AI-powered knowledge base tool that helps you quickly understand and manage documents. Upload files in multiple formats (PDF, Word, PowerPoint, Excel, images), then ask questions in natural language — AI answers with precise citations pointing to the exact source.

## Core Features

- **Multi-format document support**: PDF, DOCX, PPTX, XLSX, CSV, TXT, Markdown, images (OCR)
- **AI-powered Q&A**: Ask questions about your documents with cross-document analysis
- **Citation traceability**: Every answer includes [1][2] markers linking to original text
- **Studio tools**: One-click Summary, FAQ, Mind Map, Slide Deck, Podcast, Action Items
- **Team collaboration**: Share notebooks with Owner/Editor/Viewer roles
- **Private deployment**: Docker one-click deploy, fully self-hosted

## Getting Started

### Step 1: Create a Notebook
Click **"Create New"** on the Dashboard. Each notebook is an independent knowledge workspace that can hold multiple documents and conversations.

### Step 2: Upload Documents
In the **Sources** panel (left side), click **"Add sources"** to upload:
- Drag & drop files into the upload area
- Click to browse and select files
- Paste images with Ctrl+V / Cmd+V
- Enter a webpage URL to automatically scrape content

### Step 3: Ask Questions
Once documents are processed, type your question in the **Chat** panel:
1. Select documents using checkboxes in the Sources panel
2. Type a natural language question (e.g., "What are the key findings?")
3. AI streams the answer with inline citation markers [1][2]
4. Click any citation to view the original text excerpt

### Step 4: Use Studio
The **Studio** panel (right side) provides one-click content generation:
- **Summary** — Extract key points into a structured summary
- **FAQ** — Auto-generate 10 Q&A pairs from your documents
- **Mind Map** — Visualize document structure as an interactive mind map
- **Slide Deck** — Convert content into a professional PowerPoint presentation
- **Podcast** — Generate a two-person dialogue audio from your documents
- **Action Items** — Extract tasks, owners, and deadlines from meeting notes

## Advanced Features

### Think Mode
Click the **"Think"** button next to the chat input to enable deep reasoning (powered by DeepSeek R1). AI will show its complete thought process — ideal for complex analysis questions.

### Multi-document Cross-analysis
Select multiple documents and ask questions that span across them. AI correlates information from different sources and provides comprehensive answers.

### Excel & CSV Analysis
Upload spreadsheets and ask data questions in natural language. Noteflow uses DuckDB to run SQL queries behind the scenes and returns formatted results.

## Team Collaboration

### Sharing a Notebook
Click **"Share with Team"** in the top bar to:
- Invite members by email
- Generate a shareable invite link
- Set permission levels: Owner (full control), Editor (can edit), Viewer (read-only)

### How to Convert a Personal Notebook to a Team Notebook
1. Open your personal notebook
2. Click **"Share with Team"** button
3. Invite team members via email or share the invite link
4. Once shared, the notebook appears under "Team Notebooks" for all members

## Data Security
- All documents stored on your private server — no third-party access
- Docker one-click deployment for full data control
- JWT authentication with Google & Microsoft SSO support
- End-to-end HTTPS encryption

## FAQ

**Q: What is the maximum file size?**
A: 50MB by default. Admins can adjust this in the Admin Panel.

**Q: How long does document parsing take?**
A: TXT/MD files process instantly. PDF/DOCX takes 5-30 seconds. Large PDFs (100+ pages) may take 1-2 minutes.

**Q: Can I query multiple documents at once?**
A: Yes! Select multiple documents, then ask your question. AI performs cross-document analysis with citations pointing to each specific source.

**Q: How accurate are AI answers?**
A: AI generates answers strictly from your uploaded documents. Every answer includes citation links so you can verify the source.

**Q: What languages are supported?**
A: Optimized for Chinese and English, with basic support for other languages.
